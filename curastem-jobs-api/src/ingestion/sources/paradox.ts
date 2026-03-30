/**
 * Paradox AI career sites (SSR job lists + per-job pages with schema.org JobPosting).
 *
 * Listing pages expose `href="/…/job/P{n}-{n}-{n}"` links; pagination is `/page/{n}{search}`.
 * Job detail HTML embeds `application/ld+json` `@type: JobPosting` (description, dates, location).
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

/** `href="/bartender/job/P1-2025630-6"` → path + id */
const JOB_HREF_RE = /href="(\/[^"]*\/job\/(P\d+-\d+-\d+))"/gi;

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
  if (page <= 1) return `${base}/${search || ""}`;
  return `${base}/page/${page}${search || ""}`;
}

function extractJobPathsFromListing(html: string): string[] {
  const paths = new Set<string>();
  JOB_HREF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JOB_HREF_RE.exec(html)) !== null) {
    paths.add(m[1]);
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
  const match = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]) as JobPostingLd | JobPostingLd[];
    if (!Array.isArray(raw)) {
      if (raw["@type"] === "JobPosting") return raw;
      return null;
    }
    return raw.find((x) => x?.["@type"] === "JobPosting") ?? null;
  } catch {
    return null;
  }
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
      const paths = extractJobPathsFromListing(html);
      if (page === 1 && paths.length === 0) {
        throw new Error(`paradox: no job links on first listing page (${url})`);
      }
      for (const p of paths) seenPaths.add(p);

      const mp = maxPageFromListing(html);
      if (mp > maxPage) maxPage = mp;

      if (page >= maxPage) break;
      if (paths.length === 0) break;
    }

    const jobPaths = [...seenPaths];
    if (jobPaths.length === 0) {
      throw new Error(`paradox: 0 job links from listing pages (${source.company_handle})`);
    }

    const rows = await parallelMap<string, NormalizedJob | null>(jobPaths, DETAIL_CONCURRENCY, async (path): Promise<NormalizedJob | null> => {
      const canonicalUrl = new URL(path, `${origin}/`).href;
      const externalId = path.match(/\/job\/(P\d+-\d+-\d+)/)?.[1];
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
