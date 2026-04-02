/**
 * Radancy TalentBrew career sites (TMP / schwabjobs.com, jobs.pge.com, etc.).
 *
 * Listing: server-rendered `search-jobs` HTML with `href="/job/{city}/{slug}/{orgId}/{jobId}"`
 * and `data-total-pages` on `#search-results`. Paginate with `?p=N`.
 *
 * Detail: each `/job/...` page includes full HTML in `div.job-description__description` and/or
 * `div.ats-description`, plus `a.job-apply` for the apply URL (often iCIMS or SuccessFactors).
 *
 * `base_url` must be the search root, e.g. `https://www.schwabjobs.com/search-jobs` or
 * `https://jobs.pge.com/search-jobs`.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeLocation } from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;
const MAX_SEARCH_PAGES = 80;
/**
 * Cap detail page fetches per run. 7-Eleven has 336 search pages (~6k jobs);
 * fetching all detail pages serially (8 concurrent) would exceed the 90s Worker timeout.
 * Remaining jobs are fetched in subsequent hourly cron runs.
 */
const MAX_DETAIL_JOBS = 500;

function parseSearchRoot(input: string): { origin: string; searchPath: string } {
  const u = new URL(input.trim());
  let path = u.pathname.replace(/\/$/, "");
  if (!path.endsWith("/search-jobs")) {
    path = path === "" ? "/search-jobs" : `${path}/search-jobs`;
  }
  return { origin: u.origin, searchPath: path };
}

function searchPageUrl(origin: string, searchPath: string, page: number): string {
  const q = page <= 1 ? "" : `?p=${page}`;
  return `${origin}${searchPath}${q}`;
}

function extractTotalPages(html: string): number {
  const m = html.match(/data-total-pages="(\d+)"/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  return 1;
}

/** Collect unique `/job/...` paths from a search-results HTML page. */
function extractJobPaths(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href="(\/job\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const p = m[1].split("?")[0];
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Inner HTML of the div whose `class` contains `classMarker` (balanced divs). */
function extractDivByClassMarker(html: string, classMarker: string): string | null {
  const si = html.indexOf(classMarker);
  if (si === -1) return null;
  const openIdx = html.lastIndexOf("<div", si);
  if (openIdx === -1) return null;
  const contentStart = html.indexOf(">", openIdx) + 1;
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = contentStart;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html)) !== null) {
    if (mm[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) return html.slice(contentStart, mm.index).trim();
  }
  return null;
}

function extractDescription(html: string): string | null {
  const primary = extractDivByClassMarker(html, "job-description__description");
  if (primary) return primary;
  return extractDivByClassMarker(html, "ats-description");
}

function decodeBasicEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function extractTitle(html: string): string | null {
  let m = html.match(/<div class="job-description__title"[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i);
  if (m) return decodeBasicEntities(m[1].trim());
  m = html.match(/<div class="job-title"[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i);
  if (m) return decodeBasicEntities(m[1].trim());
  // PG&E and some tenants use Radancy "AJD" header markup instead of job-description__title.
  m = html.match(
    /<h1[^>]*class="[^"]*\bajd_header__job-title\b[^"]*"[^>]*>([^<]+)<\/h1>/i
  );
  if (m) return decodeBasicEntities(m[1].trim());
  m = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return m ? decodeBasicEntities(m[1].trim()) : null;
}

function extractLocation(html: string): string | null {
  const m = html.match(/<span class="job-location[^"]*"[^>]*>([^<]+)<\/span>/i);
  if (m) return m[1].replace(/^[^A-Za-z0-9]*/, "").trim();
  const m2 = html.match(/<span class="job-location[^"]*"[^>]*><b>[^<]*<\/b>([^<]+)<\/span>/i);
  return m2 ? m2[1].trim() : null;
}

function extractApplyUrl(html: string, origin: string): string | null {
  const m = html.match(/<a[^>]*class="[^"]*job-apply[^"]*"[^>]*href="([^"]+)"/i);
  if (m) {
    const href = m[1].replace(/&amp;/g, "&");
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return `https:${href}`;
    return `${origin}${href.startsWith("/") ? href : `/${href}`}`;
  }
  return null;
}

function extractOrgAndJobIds(html: string): { orgId: string; jobId: string } | null {
  const m = html.match(/data-org-id="(\d+)"[^>]*data-job-id="(\d+)"/i);
  if (m) return { orgId: m[1], jobId: m[2] };
  const m2 = html.match(/data-job-id="(\d+)"[^>]*data-org-id="(\d+)"/i);
  if (m2) return { orgId: m2[2], jobId: m2[1] };
  return null;
}

function isExpiredOrError(html: string): boolean {
  return (
    /posting has expired|no longer accepting applications|error with your search/i.test(html) &&
    !extractDescription(html)
  );
}

async function parallelMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const talentbrewFetcher: JobSource = {
  sourceType: "talentbrew",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, searchPath } = parseSearchRoot(source.base_url);
    const companyName = source.name.replace(/\s*\(TalentBrew\)\s*/i, "").trim();

    const page1Url = searchPageUrl(origin, searchPath, 1);
    const res1 = await fetch(page1Url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
    if (!res1.ok) {
      throw new Error(`talentbrew: search ${res1.status} (${page1Url})`);
    }
    const html1 = await res1.text();
    const totalPages = Math.min(MAX_SEARCH_PAGES, extractTotalPages(html1));

    const pathSet = new Set<string>(extractJobPaths(html1));
    for (let p = 2; p <= totalPages; p++) {
      const url = searchPageUrl(origin, searchPath, p);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const h = await res.text();
      for (const path of extractJobPaths(h)) pathSet.add(path);
    }

    const paths = [...pathSet].slice(0, MAX_DETAIL_JOBS);
    if (paths.length === 0) {
      throw new Error(`talentbrew: 0 job links from ${page1Url} (${totalPages} pages)`);
    }

    const details = await parallelMap(paths, DETAIL_CONCURRENCY, async (path) => {
      const jobUrl = `${origin}${path}`;
      const res = await fetch(jobUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) return null;
      const html = await res.text();
      if (isExpiredOrError(html)) return null;
      const ids = extractOrgAndJobIds(html);
      const title = extractTitle(html);
      const desc = extractDescription(html);
      const applyUrl = extractApplyUrl(html, origin);
      const loc = extractLocation(html);
      if (!title || !ids || !desc?.trim()) return null;
      return {
        external_id: `${ids.orgId}-${ids.jobId}`,
        title,
        locationRaw: loc,
        description_raw: desc,
        apply_url: applyUrl ?? jobUrl,
        source_url: jobUrl,
      };
    });

    const jobs: NormalizedJob[] = [];
    for (const d of details) {
      if (!d) continue;
      try {
        jobs.push({
          external_id: d.external_id,
          title: d.title,
          location: normalizeLocation(d.locationRaw, source.company_handle),
          employment_type: null,
          workplace_type: null,
          apply_url: d.apply_url,
          source_url: d.source_url,
          description_raw: d.description_raw,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: null,
          company_name: companyName,
          company_logo_url: null,
          company_website_url: null,
        });
      } catch {
        continue;
      }
    }
    return jobs;
  },
};
