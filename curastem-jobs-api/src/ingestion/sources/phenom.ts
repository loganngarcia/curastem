/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Phenom People career sites (`careers.{company}.com/...`).
 *
 * Job discovery: locale `sitemap_index.xml` → chunk sitemaps → `<loc>` URLs matching
 * `/job/{requisitionId}/{slug}` (e.g. US Bank) or `/jobs/{id}/{code}/{slug}` (e.g. Intuitive).
 * Job payload: server-rendered `phApp.ddo.jobDetail.data.job`
 * on each job page (title, locations, HTML description, Workday apply URL, posted date).
 *
 * `base_url` is the locale root with trailing slash, e.g.
 * `https://careers.usbank.com/global/en/`, or any job URL under that locale (normalized
 * to the directory above `/job/...` or `/jobs/{id}/{code}/{slug}`).
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow, WorkplaceType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;
/**
 * Large Phenom boards (Panera ~7k, Lowe's ~10k+) have many sub-sitemaps.
 * Fetching all detail pages would exceed the 90s Worker timeout.
 * Cap at 1000 per run; remaining pages are caught on subsequent hourly runs.
 */
const MAX_SITEMAP_JOBS = 1000;

/** Phenom job object from `phApp.ddo.jobDetail.data.job` (partial). */
interface PhenomJobRow {
  title?: string;
  companyName?: string;
  locations?: string;
  type?: string;
  remote?: string;
  description?: string;
  applyUrl?: string;
  postedDate?: string;
}

function parsePhenomBaseUrl(input: string): string {
  const u = new URL(input.trim());
  const path = u.pathname.replace(/\/$/, "");
  // /.../job/requisitionId/slug (most Phenom boards)
  let jobMatch = path.match(/^(.*)\/job\/[^/]+\/[^/]+$/);
  if (jobMatch) return `${u.origin}${jobMatch[1]}/`;
  // /.../jobs/numericId/jobCode/slug (Intuitive and similar tenants)
  jobMatch = path.match(/^(.*)\/jobs\/[^/]+\/[^/]+\/[^/]+$/);
  if (jobMatch) return `${u.origin}${jobMatch[1]}/`;
  return `${u.origin}${path}/`;
}

function extractJsonObject(html: string, start: number): unknown | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = false;
        continue;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, k + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractPhAppDdo(html: string): unknown | null {
  const marker = "phApp.ddo = ";
  const i = html.indexOf(marker);
  if (i === -1) return null;
  let j = i + marker.length;
  while (j < html.length && /\s/.test(html[j])) j++;
  if (html[j] !== "{") return null;
  return extractJsonObject(html, j);
}

function externalIdFromJobUrl(jobUrl: string): string | null {
  try {
    const u = new URL(jobUrl);
    const m1 = u.pathname.match(/\/job\/([^/]+)\/[^/]+\/?$/);
    if (m1) return m1[1];
    const m2 = u.pathname.match(/\/jobs\/([^/]+)\/([^/]+)\/[^/]+\/?$/);
    if (m2) return `${m2[1]}_${m2[2]}`;
    return null;
  } catch {
    return null;
  }
}

/** Collect job posting URLs from any sitemap XML `<loc>` list. */
function addJobUrlsFromLocXml(xml: string, jobUrls: Set<string>): void {
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const loc = m[1].trim().split("?")[0];
    if (/\/job\/[^/]+\/[^/?]+$/.test(loc)) jobUrls.add(loc);
    if (/\/jobs\/[^/]+\/[^/]+\/[^/?]+$/.test(loc)) jobUrls.add(loc);
  }
}

async function fetchSitemapJobUrls(baseUrl: string): Promise<string[]> {
  const indexUrl = new URL("sitemap_index.xml", baseUrl).href;
  let res = await fetch(indexUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
    redirect: "follow",
  });
  // Some tenants expose only `sitemap.xml` (no index) or return 404 for `sitemap_index.xml`.
  if (!res.ok) {
    const flatUrl = new URL("sitemap.xml", baseUrl).href;
    res = await fetch(flatUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`phenom: sitemap ${res.status} (tried sitemap_index.xml and sitemap.xml under ${baseUrl})`);
    }
  }
  const indexXml = await res.text();
  const sitemapLocs = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
  const jobUrls = new Set<string>();

  // Some tenants (e.g. Genentech) use one urlset with job URLs inline — not only nested sitemaps.
  addJobUrlsFromLocXml(indexXml, jobUrls);

  for (const smUrl of sitemapLocs) {
    if (jobUrls.size >= MAX_SITEMAP_JOBS) break;
    const baseLoc = smUrl.split("?")[0];
    if (/\/job\/[^/]+\/[^/?]+$/.test(baseLoc) || /\/jobs\/[^/]+\/[^/]+\/[^/?]+$/.test(baseLoc)) {
      continue;
    }
    const sm = await fetch(smUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
      redirect: "follow",
    });
    if (!sm.ok) continue;
    const xml = await sm.text();
    addJobUrlsFromLocXml(xml, jobUrls);
  }

  return [...jobUrls].slice(0, MAX_SITEMAP_JOBS);
}

function inferWorkplace(job: PhenomJobRow): WorkplaceType | null {
  const r = (job.remote ?? "").toLowerCase().trim();
  if (r === "yes" || r === "fully remote" || r === "remote") return "remote";
  if (r === "hybrid") return "hybrid";
  if (r === "no" || r === "") return normalizeWorkplaceType(null, job.locations ?? null);
  return normalizeWorkplaceType(job.remote, job.locations ?? null);
}

function phenomJobToNormalized(
  job: PhenomJobRow,
  canonicalUrl: string,
  externalId: string,
  source: SourceRow,
  employment: EmploymentType | null,
  workplace: WorkplaceType | null
): NormalizedJob | null {
  const title = job.title?.trim();
  if (!title) return null;

  const applyUrl = job.applyUrl?.trim() || canonicalUrl;
  const fromSource = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const companyName = fromSource || job.companyName?.trim() || "Unknown";

  return {
    external_id: externalId,
    title,
    location: normalizeLocation(job.locations ?? null),
    employment_type: employment,
    workplace_type: workplace,
    apply_url: applyUrl,
    source_url: canonicalUrl,
    description_raw: job.description?.trim() || null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: parseEpochSeconds(job.postedDate ?? null),
    company_name: companyName,
    company_logo_url: null,
    company_website_url: null,
  };
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

export const phenomFetcher: JobSource = {
  sourceType: "phenom",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const baseUrl = parsePhenomBaseUrl(source.base_url);
    const jobUrls = await fetchSitemapJobUrls(baseUrl);
    if (jobUrls.length === 0) {
      throw new Error(`phenom: 0 job URLs from sitemaps under ${baseUrl}`);
    }

    const rows = await parallelMap(jobUrls, DETAIL_CONCURRENCY, async (canonicalUrl) => {
      const externalId = externalIdFromJobUrl(canonicalUrl);
      if (!externalId) return null;

      const res = await fetch(canonicalUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) return null;

      const ddo = extractPhAppDdo(await res.text()) as {
        jobDetail?: { data?: { job?: PhenomJobRow } };
      } | null;
      const job = ddo?.jobDetail?.data?.job;
      if (!job) return null;

      const employment = normalizeEmploymentType(job.type ?? null);
      const workplace = inferWorkplace(job);
      return phenomJobToNormalized(job, canonicalUrl, externalId, source, employment, workplace);
    });

    const ok = rows.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0 && jobUrls.length > 0) {
      throw new Error(`phenom: ${jobUrls.length} sitemap job URL(s) but 0 jobs parsed (${source.company_handle})`);
    }
    return ok;
  },
};
