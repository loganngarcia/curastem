/**
 * Brillio careers — WordPress job listing HTML (`careers.brillio.com/job-listing/`).
 *
 * No public ATS JSON; listings are server-rendered with `job-details?job-id=` links.
 * Listing pages are parsed with a regex; each job detail page is fetched for
 * `description_raw` from `<div class="_detail-content">` (HTML fragment).
 *
 * `base_url` should be the listing root, e.g. `https://careers.brillio.com/job-listing/`
 * (pagination uses `/job-listing/page/2/`, etc.).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeLocation } from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const MAX_PAGES = 25;
const DETAIL_CONCURRENCY = 8;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseListingHtml(html: string): Array<{ id: string; title: string; location: string }> {
  const out: Array<{ id: string; title: string; location: string }> = [];
  /** Matches the job-card block after each empty apply `<a>`. */
  const re =
    /<a href="https:\/\/careers\.brillio\.com\/job-details\?job-id=(\d+)"[^>]*><\/a>\s*<div class="job-card">\s*<h4>([^<]+)<\/h4>\s*<p class="infoline">\s*<span>([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({
      id: m[1],
      title: decodeHtmlEntities(m[2]).trim(),
      location: decodeHtmlEntities(m[3]).trim(),
    });
  }
  return out;
}

/** Inner HTML of the job description block (includes `<h1>` and body copy). */
function extractDetailContentHtml(html: string): string | null {
  const open = '<div class="_detail-content">';
  const start = html.indexOf(open);
  if (start === -1) return null;
  const contentStart = start + open.length;
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = contentStart;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (tag.startsWith("</")) depth--;
    else depth++;
    if (depth === 0) {
      return html.slice(contentStart, m.index).trim();
    }
  }
  return null;
}

async function fetchDetailDescriptionHtml(jobId: string): Promise<string | null> {
  const url = `https://careers.brillio.com/job-details?job-id=${jobId}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return extractDetailContentHtml(await res.text());
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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

export const brillioFetcher: JobSource = {
  sourceType: "brillio",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const root = source.base_url.trim().replace(/\/?$/, "");
    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || "Brillio";

    const byId = new Map<string, { id: string; title: string; location: string }>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? `${root}/` : `${root}/page/${page}/`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
      if (!res.ok) break;

      const html = await res.text();
      const rows = parseListingHtml(html);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }

    const listingRows = Array.from(byId.values());
    const descriptions = await parallelMap(listingRows, DETAIL_CONCURRENCY, async (row) =>
      fetchDetailDescriptionHtml(row.id)
    );

    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < listingRows.length; i++) {
      const row = listingRows[i];
      const applyUrl = `https://careers.brillio.com/job-details?job-id=${row.id}`;
      try {
        jobs.push({
          external_id: row.id,
          title: row.title,
          location: normalizeLocation(row.location),
          employment_type: null,
          workplace_type: null,
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: descriptions[i] ?? null,
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
