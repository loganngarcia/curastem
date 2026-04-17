/**
 * HCA Healthcare — careers.hcahealthcare.com (custom Radancy / Talentegy stack, not jobs.jobvite.com HTML).
 *
 * Discovery: `sitemap.xml` lists hundreds of regional search URLs under `/search/jobs/in/...`.
 * Each page embeds ~25 `href="/jobs/{requisitionId}-{slug}"` links (server-rendered).
 * Detail: each `/jobs/{id}-{slug}` page includes full `application/ld+json` JobPosting (title, HTML description, location).
 *
 * `base_url` may be any URL on the host (e.g. a job posting or `/search/...`); the origin is used for sitemap + fetches.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeLocation, parseEpochSeconds } from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const SEARCH_FETCH_CONCURRENCY = 10;
const DETAIL_CONCURRENCY = 8;
/** Cap detail fetches per run (Worker wall time). Remaining jobs surface on later cron cycles. */
const MAX_DETAIL_JOBS = 500;

function originFromBase(input: string): string {
  const u = new URL(input.trim());
  return u.origin;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xml,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`hca_careers: GET ${res.status} (${url})`);
  return res.text();
}

/** All `<loc>` URLs from sitemap XML that are regional job search pages. */
function extractSearchUrlsFromSitemap(xml: string, origin: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const loc = m[1].trim().split("?")[0];
    if (!loc.startsWith(origin)) continue;
    if (!loc.includes("/search/jobs/in/")) continue;
    if (!seen.has(loc)) {
      seen.add(loc);
      out.push(loc);
    }
  }
  return out;
}

/** `/jobs/12345-slug-name` paths from listing HTML. */
function extractJobPathsFromSearchHtml(html: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const re = /href="(\/jobs\/\d+[^"]*)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html)) !== null) {
    const p = mm[1].split("?")[0];
    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }
  return paths;
}

function externalIdFromJobPath(path: string): string | null {
  const m = path.match(/\/jobs\/(\d+)-/);
  return m ? m[1] : null;
}

interface JobPostingLd {
  "@type"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  url?: string;
  jobLocation?: unknown;
}

function extractJobPostingLd(html: string): JobPostingLd | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = JSON.parse(m[1]);
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        if (item && typeof item === "object" && item["@type"] === "JobPosting") {
          return item as JobPostingLd;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function locationFromLd(ld: JobPostingLd): string | null {
  const jl = ld.jobLocation;
  if (!jl) return null;
  const first = Array.isArray(jl) ? jl[0] : jl;
  if (!first || typeof first !== "object") return null;
  const addr = (first as { address?: Record<string, string> }).address;
  if (!addr) return null;
  const parts = [addr.addressLocality, addr.addressRegion].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
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

export const hcaCareersFetcher: JobSource = {
  sourceType: "hca_careers",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const origin = originFromBase(source.base_url);
    const companyName = source.name.replace(/\s*\(HCA\)\s*/i, "").trim() || "HCA Healthcare";

    const sitemapUrl = `${origin}/sitemap.xml`;
    const sitemapXml = await fetchText(sitemapUrl);
    const searchUrls = extractSearchUrlsFromSitemap(sitemapXml, origin);
    if (searchUrls.length === 0) {
      throw new Error(`hca_careers: no /search/jobs/in/ URLs in sitemap (${sitemapUrl})`);
    }

    const pathSet = new Set<string>();
    await parallelMap(searchUrls, SEARCH_FETCH_CONCURRENCY, async (url) => {
      try {
        const html = await fetchText(url);
        for (const p of extractJobPathsFromSearchHtml(html)) pathSet.add(p);
      } catch {
        /* skip bad region pages */
      }
    });

    const paths = [...pathSet].slice(0, MAX_DETAIL_JOBS);
    if (paths.length === 0) {
      throw new Error(`hca_careers: 0 job paths after scanning ${searchUrls.length} search URLs`);
    }

    const rows = await parallelMap(paths, DETAIL_CONCURRENCY, async (path) => {
      const ext = externalIdFromJobPath(path);
      if (!ext) return null;
      const jobUrl = `${origin}${path}`;
      let html: string;
      try {
        html = await fetchText(jobUrl);
      } catch {
        return null;
      }
      const ld = extractJobPostingLd(html);
      if (!ld?.title?.trim()) return null;
      const desc = (ld.description ?? "").trim();
      if (!desc) return null;

      return {
        external_id: ext,
        title: ld.title.trim(),
        locationRaw: locationFromLd(ld),
        description_raw: desc,
        apply_url: (typeof ld.url === "string" && ld.url.startsWith("http")) ? ld.url : jobUrl,
        source_url: jobUrl,
        posted_at: parseEpochSeconds(ld.datePosted ?? null),
      };
    });

    const jobs: NormalizedJob[] = [];
    for (const r of rows) {
      if (!r) continue;
      try {
        jobs.push({
          external_id: r.external_id,
          title: r.title,
          location: normalizeLocation(r.locationRaw, source.company_handle),
          employment_type: null,
          workplace_type: null,
          apply_url: r.apply_url,
          source_url: r.source_url,
          description_raw: r.description_raw,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: r.posted_at,
          company_name: companyName,
          company_logo_url: null,
          company_website_url: null,
        });
      } catch {
        continue;
      }
    }

    if (jobs.length === 0 && paths.length > 0) {
      throw new Error(`hca_careers: ${paths.length} job URLs but 0 parsed (${source.company_handle})`);
    }
    return jobs;
  },
};
