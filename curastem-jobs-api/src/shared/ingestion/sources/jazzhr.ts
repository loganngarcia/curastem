/**
 * JazzHR career sites on `*.applytojob.com` (legacy Resumator stack).
 *
 * Discovery: the board home `https://{subdomain}.applytojob.com/apply` serves static HTML
 * with `href` links to `/apply/{jobToken}/{url-slug}` for each open role.
 *
 * Detail: each posting page embeds schema.org `JobPosting` in `application/ld+json`
 * (full HTML `description`, location, salary when present).
 *
 * `base_url` is the listing root (`…/apply`) or any single-job URL under the same host
 * (normalized to `…/apply`).
 */

import type { EmploymentType, JobSource, NormalizedJob, SalaryPeriod, SourceRow, WorkplaceType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;

interface SchemaMonetaryAmount {
  "@type"?: string;
  currency?: string;
  value?:
    | {
        minValue?: number;
        maxValue?: number;
        value?: number;
        unitText?: string;
      }
    | number;
}

interface SchemaJobPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  identifier?: { value?: string | number; name?: string };
  datePosted?: string;
  employmentType?: string | string[];
  jobLocation?: unknown;
  jobLocationType?: string;
  baseSalary?: SchemaMonetaryAmount;
  hiringOrganization?: { name?: string; sameAs?: string; logo?: string | { url?: string } };
}

function isJobPostingType(t: unknown): boolean {
  if (t === "JobPosting") return true;
  if (Array.isArray(t)) {
    return t.some((x) => typeof x === "string" && /JobPosting$/i.test(x));
  }
  if (typeof t === "string" && (/schema\.org\/JobPosting$/i.test(t) || t.endsWith("/JobPosting"))) {
    return true;
  }
  return false;
}

function coerceJobPosting(data: unknown): SchemaJobPosting | null {
  if (!data || typeof data !== "object") return null;
  const o = data as SchemaJobPosting;
  if (isJobPostingType(o["@type"])) return o;

  const graph = (o as { "@graph"?: unknown[] })["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      const jp = coerceJobPosting(item);
      if (jp) return jp;
    }
  }
  return null;
}

function extractJobPostingJson(html: string): SchemaJobPosting | null {
  const re = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const jp = coerceJobPosting(parsed);
      if (jp?.title) return jp;
    } catch {
      /* try next block */
    }
  }
  return null;
}

function salaryPeriodFromUnit(unit: string | undefined): SalaryPeriod | null {
  if (!unit) return null;
  const u = unit.toUpperCase();
  if (u === "YEAR" || u === "YEARLY") return "year";
  if (u === "MONTH" || u === "MONTHLY") return "month";
  if (u === "HOUR" || u === "HOURLY") return "hour";
  return null;
}

function parseSalaryFields(bs: SchemaMonetaryAmount | undefined): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
} {
  if (!bs?.value) return { min: null, max: null, currency: null, period: null };
  const v = bs.value;
  if (typeof v === "number") {
    return { min: v, max: v, currency: bs.currency ?? null, period: null };
  }
  const minV = v.minValue ?? v.value ?? null;
  const maxV = v.maxValue ?? v.value ?? null;
  return {
    min: minV,
    max: maxV,
    currency: bs.currency ?? null,
    period: salaryPeriodFromUnit(v.unitText),
  };
}

function locationAndWorkplace(jp: SchemaJobPosting): { location: string | null; workplace: WorkplaceType | null } {
  if (jp.jobLocationType === "TELECOMMUTE") {
    return { location: normalizeLocation("Remote"), workplace: "remote" };
  }

  const loc = jp.jobLocation;
  if (!loc || typeof loc !== "object") {
    return { location: null, workplace: null };
  }

  const place = loc as { address?: Record<string, string> };
  const addr = place.address;
  if (!addr || typeof addr !== "object") {
    return { location: null, workplace: null };
  }

  const locality = addr.addressLocality;
  const region = addr.addressRegion;
  const country = addr.addressCountry;
  const parts = [locality, region, country].filter((x): x is string => Boolean(x?.trim()));
  if (parts.length === 0) {
    return { location: null, workplace: null };
  }

  const raw = parts.join(", ");
  return {
    location: normalizeLocation(raw),
    workplace: normalizeWorkplaceType("on-site", raw),
  };
}

function parseBoardRoot(input: string): { origin: string; listingUrl: string } {
  const u = new URL(input.trim());
  if (!u.hostname.endsWith(".applytojob.com")) {
    throw new Error(`jazzhr base_url must use host *.applytojob.com, got ${input}`);
  }
  const origin = `https://${u.hostname}`;
  return {
    origin,
    listingUrl: `${origin}/apply`,
  };
}

/** Collect canonical job URLs from listing HTML (deduped by job token). */
function collectJobUrls(html: string, origin: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const re = /href="((?:https?:\/\/[^/]+)?\/apply\/[A-Za-z0-9]+\/[^"?#]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (href.startsWith("/")) href = origin + href;
    else if (href.startsWith("http://")) href = "https" + href.slice(4);
    const u = new URL(href);
    if (!u.hostname.endsWith(".applytojob.com")) continue;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] !== "apply" || parts.length < 2) continue;
    const token = parts[1];
    if (seen.has(token)) continue;
    seen.add(token);
    urls.push(`${origin}/apply/${token}/${parts.slice(2).join("/")}`);
  }
  return urls;
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

export const jazzhrFetcher: JobSource = {
  sourceType: "jazzhr",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, listingUrl } = parseBoardRoot(source.base_url);
    const companyName =
      source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() ||
      origin.replace(/^https:\/\//, "").replace(".applytojob.com", "");

    const listRes = await fetch(listingUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
    if (!listRes.ok) {
      throw new Error(`jazzhr: listing ${listRes.status} (${listingUrl})`);
    }
    const listHtml = await listRes.text();
    const jobUrls = collectJobUrls(listHtml, origin);
    if (jobUrls.length === 0) {
      throw new Error(`jazzhr: 0 job links parsed from ${listingUrl}`);
    }

    const payloads = await parallelMap(jobUrls, DETAIL_CONCURRENCY, async (jobUrl) => {
      const res = await fetch(jobUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) return null;
      return extractJobPostingJson(await res.text());
    });

    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < jobUrls.length; i++) {
      const jobUrl = jobUrls[i];
      const jp = payloads[i];
      if (!jp?.title) continue;

      const token = new URL(jobUrl).pathname.split("/").filter(Boolean)[1] ?? String(i);
      const { location: locFromSchema, workplace } = locationAndWorkplace(jp);
      const salary = parseSalaryFields(jp.baseSalary);

      let employment: EmploymentType | null = null;
      const et = jp.employmentType;
      const etStr = Array.isArray(et) ? et[0] : et;
      if (typeof etStr === "string") employment = normalizeEmploymentType(etStr);

      const logo = jp.hiringOrganization?.logo;
      const logoUrl =
        typeof logo === "string" ? logo : typeof logo === "object" && logo?.url ? logo.url : null;

      jobs.push({
        external_id: token,
        title: jp.title.trim(),
        location: locFromSchema,
        employment_type: employment,
        workplace_type: workplace,
        apply_url: jobUrl,
        source_url: jobUrl,
        description_raw: jp.description?.trim() ? jp.description : null,
        salary_min: salary.min,
        salary_max: salary.max,
        salary_currency: salary.currency,
        salary_period: salary.period,
        posted_at: parseEpochSeconds(jp.datePosted),
        company_name: jp.hiringOrganization?.name?.trim() || companyName,
        company_logo_url: logoUrl,
        company_website_url: jp.hiringOrganization?.sameAs?.trim() || null,
      });
    }

    if (jobs.length === 0) {
      throw new Error(`jazzhr: 0 jobs with JSON-LD from ${listingUrl}`);
    }
    return jobs;
  },
};
