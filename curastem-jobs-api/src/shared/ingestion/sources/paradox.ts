/**
 * Paradox AI career sites (SSR job lists + per-job pages with schema.org JobPosting).
 *
 * Listing pages expose job links as `href="/…/job/…"` (e.g. `/bartender/job/P1-…` or Appcast
 * permalinks `/job/{slug}/{market}/{id}/`); pagination is `/page/{n}{search}`.
 * Job detail HTML embeds `application/ld+json` `@type: JobPosting` (description, dates, location).
 * Some newer Paradox boards expose data only through `window.__PRELOAD_STATE__` and still expose
 * detail pages with schema.org JobPosting JSON-LD.
 *
 * `base_url` is the board root or filtered listing (page 1), e.g.
 * `https://careers.amctheatres.com/` or the same URL with `?filter[...]` query params.
 */

import type { EmploymentType, JobSource, NormalizedJob, SalaryPeriod, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;
const MAX_LISTING_PAGES = 200;
const MAX_SITEMAP_DISCOVERY_ROUNDS = 2;

/**
 * Appcast-style boards use pretty permalinks `/job/{title-slug}/{city-st}/{id}/`;
 * classic Paradox boards use `/bartender/job/P1-2025630-6`.
 */
const JOB_HREF_RE = /href="(\/(?:[^"]*\/)?job\/[^"]+)"/gi;

/** Cap sitemap-driven discovery for very large Appcast+Paradox hybrids (detail fetch cost). */
const PIZZA_HUT_SITEMAP_JOB_CAP = 2500;
const PRELOAD_STATE_MARKER = "window.__PRELOAD_STATE__ = ";

const SCHEMA_EMPLOYMENT: Record<string, EmploymentType> = {
  FULL_TIME: "full_time",
  PART_TIME: "part_time",
  CONTRACTOR: "contract",
  TEMPORARY: "temporary",
};

interface JobPostingLd {
  "@type"?: string;
  title?: string;
  description?: string;
  url?: string;
  datePosted?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string };
  jobLocation?: {
    "@type"?: string;
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
      streetAddress?: string;
    };
    name?: string;
  };
  identifier?: { value?: string; name?: string };
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number; maxValue?: number; unitText?: string };
  };
}

function normalizeListingBase(input: string): { origin: string; search: string } {
  const u = new URL(input.trim());
  let path = u.pathname.replace(/\/$/, "");
  path = path.replace(/\/page\/\d+$/, "");
  const search = u.search || "";
  const origin = path === "" || path === "/" ? u.origin : `${u.origin}${path}`;
  return { origin, search };
}

function listingUrl(origin: string, search: string, page: number): string {
  const base = origin.replace(/\/$/, "");
  if (page <= 1) return `${base}${search || ""}`;
  return `${base}/page/${page}${search || ""}`;
}

function normalizeJobPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  let normalized = trimmed;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = new URL(normalized).pathname;
    } catch {
      return null;
    }
  } else if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (!normalized.includes("/job/")) return null;

  const noQuery = normalized.split(/[?#]/, 1)[0];
  return noQuery.endsWith("/") ? noQuery.slice(0, -1) : noQuery;
}

function extractExternalId(path: string): string | null {
  const normalized = normalizeJobPath(path);
  if (!normalized || !normalized.includes("/job/")) return null;
  const parts = normalized.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  return decodeURIComponent(last);
}

function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>(.*?)<\/loc>/gi)) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    out.push(raw);
  }
  return out;
}

function extractPreloadStateJobs(html: string): { paths: string[]; totalJobs: number | null } {
  const markerIndex = html.indexOf(PRELOAD_STATE_MARKER);
  if (markerIndex < 0) return { paths: [], totalJobs: null };

  const start = markerIndex + PRELOAD_STATE_MARKER.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let quote: "'" | '"' | null = null;
  let end = -1;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
  }

  if (end < 0) return { paths: [], totalJobs: null };

  let state: unknown = null;
  try {
    state = JSON.parse(html.slice(start, end));
  } catch {
    return { paths: [], totalJobs: null };
  }

  const jobSearch = (state as { jobSearch?: unknown })?.jobSearch;
  if (!jobSearch || typeof jobSearch !== "object") return { paths: [], totalJobs: null };

  const list = (jobSearch as { jobs?: unknown }).jobs;
  if (!Array.isArray(list)) return { paths: [], totalJobs: null };

  const totalJobsRaw = (jobSearch as { totalJob?: unknown }).totalJob;
  const totalJobs = typeof totalJobsRaw === "number" ? totalJobsRaw : null;

  const paths = new Set<string>();
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const raw = (row as { originalURL?: unknown; applyURL?: unknown }).originalURL ??
      (row as { applyURL?: unknown }).applyURL;
    if (typeof raw !== "string") continue;
    const normalized = normalizeJobPath(raw);
    if (normalized) paths.add(normalized);
  }

  return { paths: [...paths], totalJobs };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function discoverJobPathsFromSitemap(baseOrigin: string, targetCountHint: number | null): Promise<string[]> {
  const sitemapUrl = `${baseOrigin}/sitemap.xml`;
  const visited = new Set<string>([sitemapUrl]);
  const toVisit = [sitemapUrl];
  const paths = new Set<string>();

  for (let round = 0; round < MAX_SITEMAP_DISCOVERY_ROUNDS && toVisit.length > 0; round++) {
    const currentRound = [...toVisit];
    toVisit.length = 0;

    for (const url of currentRound) {
      const xml = await fetchText(url);
      if (!xml) continue;

      for (const loc of extractSitemapLocs(xml)) {
        if (targetCountHint != null && paths.size >= targetCountHint) {
          return [...paths];
        }
        if (/\.xml$/i.test(loc)) {
          if (!visited.has(loc)) {
            visited.add(loc);
            toVisit.push(loc);
          }
          continue;
        }
        const normalized = normalizeJobPath(loc);
        if (normalized) paths.add(normalized);
      }
    }

    if (targetCountHint != null && paths.size >= targetCountHint) break;
  }

  return [...paths];
}

function extractJobPathsFromListing(html: string): string[] {
  const paths = new Set<string>();
  JOB_HREF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JOB_HREF_RE.exec(html)) !== null) {
    const normalized = normalizeJobPath(m[1]);
    if (normalized) paths.add(normalized);
  }
  return [...paths];
}

function maxPageFromListing(html: string): number {
  let max = 1;
  for (const m of html.matchAll(/href="\/page\/(\d+)"/gi)) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

function extractJobPostingLd(html: string): JobPostingLd | null {
  const regex = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    if (!match[1]) continue;
    try {
      const raw = JSON.parse(match[1]) as JobPostingLd | JobPostingLd[];
      if (!Array.isArray(raw)) {
        if (raw["@type"] === "JobPosting") return raw;
        continue;
      }
      const found = raw.find((x) => x?.["@type"] === "JobPosting");
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
}

function locationFromLd(ld: JobPostingLd): string | null {
  const jl = ld.jobLocation;
  if (!jl) return null;
  if (typeof jl.name === "string" && jl.name.trim()) return jl.name.trim();
  const addr = jl.address;
  if (!addr) return null;
  const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return parts.length ? parts.join(", ") : null;
}

function employmentFromLd(ld: JobPostingLd): EmploymentType | null {
  const et = ld.employmentType;
  const raw = Array.isArray(et) ? et[0] : et;
  if (!raw || typeof raw !== "string") return null;
  return SCHEMA_EMPLOYMENT[raw.toUpperCase()] ?? normalizeEmploymentType(raw);
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

export const paradoxFetcher: JobSource = {
  sourceType: "paradox",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, search } = normalizeListingBase(source.base_url);
    const boardOrigin = new URL(source.base_url).origin;
    let preloadState: { paths: string[]; totalJobs: number | null } | null = null;

    const seenPaths = new Set<string>();
    let maxPage = 1;

    for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
      const url = listingUrl(origin, search, page);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) {
        if (page === 1) throw new Error(`paradox: listing ${res.status} (${url})`);
        break;
      }

      const html = await res.text();
      let paths = new Set(extractJobPathsFromListing(html));
      if (page === 1) preloadState = extractPreloadStateJobs(html);
      if (preloadState && preloadState.paths.length > 0) {
        for (const p of preloadState.paths) paths.add(p);
      }

      if (page === 1 && paths.size === 0) {
        throw new Error(`paradox: no job links on first listing page (${url})`);
      }
      for (const p of paths) seenPaths.add(p);

      const mp = maxPageFromListing(html);
      if (mp > maxPage) maxPage = mp;

      if (page >= maxPage) break;
      if (paths.size === 0) break;
      if (page === 1 && (preloadState?.paths.length ?? 0) > 0) break;
    }

    if (preloadState?.totalJobs != null && preloadState.totalJobs > seenPaths.size) {
      for (const p of await discoverJobPathsFromSitemap(boardOrigin, preloadState.totalJobs)) {
        seenPaths.add(p);
      }
    }

    if (source.id === "px-pizzahut") {
      for (const p of await discoverJobPathsFromSitemap(boardOrigin, PIZZA_HUT_SITEMAP_JOB_CAP)) {
        seenPaths.add(p);
        if (seenPaths.size >= PIZZA_HUT_SITEMAP_JOB_CAP) break;
      }
    }

    const jobPaths = [...seenPaths];
    if (jobPaths.length === 0) {
      throw new Error(`paradox: 0 job links from listing pages (${source.company_handle})`);
    }

    const rows = await parallelMap<string, NormalizedJob | null>(jobPaths, DETAIL_CONCURRENCY, async (path): Promise<NormalizedJob | null> => {
      const canonicalUrl = new URL(path, `${boardOrigin}/`).href;
      const externalId = extractExternalId(path);
      if (!externalId) return null;

      const res = await fetch(canonicalUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) return null;

      const ld = extractJobPostingLd(await res.text());
      if (!ld?.title?.trim()) return null;

      const title = ld.title.trim();
      const locRaw = locationFromLd(ld);
      const employment = employmentFromLd(ld);
      const workplace = normalizeWorkplaceType(null, locRaw);

      const sal = ld.baseSalary?.value;
      const unitMap: Record<string, string> = { YEAR: "year", MONTH: "month", HOUR: "hour" };
      const unitRaw = sal?.unitText && typeof sal.unitText === "string" ? sal.unitText.toUpperCase() : "";
      const unit = (unitMap[unitRaw] as SalaryPeriod | undefined) ?? null;

      const fromSource = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const companyName = fromSource || ld.hiringOrganization?.name?.trim() || "Unknown";

      const job: NormalizedJob = {
        external_id: externalId,
        title,
        location: normalizeLocation(locRaw),
        employment_type: employment,
        workplace_type: workplace,
        apply_url: typeof ld.url === "string" && ld.url.startsWith("http") ? ld.url : canonicalUrl,
        source_url: canonicalUrl,
        description_raw: ld.description?.trim() || null,
        salary_min: sal?.minValue ?? null,
        salary_max: sal?.maxValue ?? null,
        salary_currency: ld.baseSalary?.currency ?? null,
        salary_period: unit,
        posted_at: parseEpochSeconds(ld.datePosted ?? null),
        company_name: companyName,
        company_logo_url: null,
        company_website_url: null,
      };
      return job;
    });

    const ok = rows.filter((j) => j !== null);
    if (ok.length === 0 && jobPaths.length > 0) {
      throw new Error(`paradox: ${jobPaths.length} job link(s) but 0 parsed (${source.company_handle})`);
    }
    return ok;
  },
};
