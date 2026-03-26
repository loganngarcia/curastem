/**
 * Meta careers — public jobsearch sitemap + per-role HTML with schema.org JobPosting JSON-LD.
 *
 * `base_url` is the sitemap URL (default below). The official sitemap is listed in
 * https://www.metacareers.com/robots.txt as `jobsearch/sitemap.xml`.
 *
 * Unauthenticated GraphQL on `/api/graphql/` returns generic errors from Workers; the sitemap
 * is the reliable way to enumerate every URL Meta exposes to crawlers.
 */

import type { JobSource, NormalizedJob, SalaryPeriod, SourceRow, WorkplaceType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";
import { logger } from "../../utils/logger.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const DEFAULT_SITEMAP = "https://www.metacareers.com/jobsearch/sitemap.xml";

/** Parallel HTML fetches — bounded to avoid memory spikes on large boards. */
const FETCH_CONCURRENCY = 12;
const FETCH_ATTEMPTS = 3;
const SECOND_PASS_ATTEMPTS = 6;
const SECOND_PASS_DELAY_MS = 80;

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
  identifier?: { value?: string | number };
  datePosted?: string;
  employmentType?: string;
  jobLocation?: unknown;
  jobLocationType?: string;
  baseSalary?: SchemaMonetaryAmount;
  hiringOrganization?: { name?: string; sameAs?: string; logo?: string };
}

function isJobPostingType(t: unknown): boolean {
  if (t === "JobPosting") return true;
  if (Array.isArray(t)) {
    return t.some((x) => typeof x === "string" && /JobPosting$/i.test(x));
  }
  if (typeof t === "string") {
    if (t === "JobPosting") return true;
    // schema.org JSON-LD often uses a URI for @type
    if (/schema\.org\/JobPosting$/i.test(t)) return true;
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

/** Meta and other SPAs emit `<script type="application/ld+json" nonce="…">` — fixed needles miss the `>`. */
function extractJobPostingJson(html: string): SchemaJobPosting | null {
  const re = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const found: SchemaJobPosting[] = [];
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const jp = coerceJobPosting(parsed);
      if (jp) found.push(jp);
    } catch {
      /* try next block */
    }
  }
  const withTitle = found.find((j) => Boolean(j.title?.trim()));
  if (withTitle) return withTitle;
  return found[0] ?? null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Meta pages always carry og:title even when JSON-LD is incomplete or still hydrating. */
function extractMetaTitle(html: string): string | null {
  const patterns = [
    /<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i,
    /<meta\s+content=["']([^"']*)["']\s+property=["']og:title["']/i,
    /<meta\s+name=["']title["']\s+content=["']([^"']*)["']/i,
    /<meta\s+content=["']([^"']*)["']\s+name=["']title["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const v = m?.[1]?.trim();
    if (v) return decodeHtmlEntities(v);
  }
  return null;
}

function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i,
    /<meta\s+content=["']([^"']*)["']\s+property=["']og:description["']/i,
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const v = m?.[1]?.trim();
    if (v) return decodeHtmlEntities(v);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJobHtml(jobUrl: string, attempts: number): Promise<string | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetch(jobUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        await sleep(200 * (a + 1) + Math.floor(Math.random() * 120));
        continue;
      }
      if (!res.ok) return null;
      return await res.text();
    } catch {
      await sleep(150 * (a + 1));
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

function parsePlace(place: unknown): string | null {
  if (!place || typeof place !== "object") return null;
  const p = place as {
    name?: string;
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string | { name?: string | string[] };
    };
  };
  if (typeof p.name === "string" && p.name.trim()) {
    return normalizeLocation(p.name.trim());
  }
  const addr = p.address;
  if (!addr || typeof addr !== "object") return null;
  const locality = addr.addressLocality;
  const region = addr.addressRegion;
  let countryStr: string | undefined;
  const c = addr.addressCountry;
  if (typeof c === "string") countryStr = c;
  else if (c && typeof c === "object" && "name" in c) {
    const n = (c as { name?: unknown }).name;
    if (Array.isArray(n) && n[0] !== undefined) countryStr = String(n[0]);
    else if (typeof n === "string") countryStr = n;
  }
  const parts = [locality, region, countryStr].filter((x): x is string => Boolean(x?.trim()));
  if (parts.length === 0) return null;
  return normalizeLocation(parts.join(", "));
}

function parseMetacareersPage(html: string, jobUrl: string, companyName: string): NormalizedJob | null {
  const jp = extractJobPostingJson(html);
  const title = (jp?.title?.trim() || extractMetaTitle(html) || "").trim() || null;
  if (!title) return null;

  const m = /\/job_details\/(\d+)/i.exec(jobUrl);
  const ext =
    m?.[1] ??
    (jp?.identifier?.value !== undefined && jp?.identifier?.value !== null
      ? String(jp.identifier.value)
      : jobUrl);

  const descriptionRaw = jp?.description?.trim() || extractMetaDescription(html) || null;

  const { location: locStr, workplace: wpDirect } = jp
    ? locationsFromPosting(jp)
    : { location: null, workplace: null };

  const postedAt = jp?.datePosted ? parseEpochSeconds(jp.datePosted) : null;

  const { min: salaryMin, max: salaryMax, currency: salaryCurrency, period: salaryPeriod } = jp
    ? parseSalaryFields(jp.baseSalary)
    : { min: null, max: null, currency: null, period: null };

  const org = jp?.hiringOrganization;
  let website: string | undefined;
  if (org?.sameAs) {
    const s = org.sameAs.trim();
    website = s.startsWith("http") ? s : `https://${s}`;
  }

  const logo = typeof org?.logo === "string" && org.logo.startsWith("http") ? org.logo : undefined;

  const workplace =
    wpDirect ??
    (jp
      ? normalizeWorkplaceType(jp.jobLocationType === "TELECOMMUTE" ? "remote" : null, locStr ?? "")
      : null);

  return {
    external_id: ext,
    title,
    location: locStr,
    employment_type: jp ? normalizeEmploymentType(jp.employmentType ?? null) : null,
    workplace_type: workplace,
    apply_url: jobUrl,
    source_url: jobUrl,
    description_raw: descriptionRaw,
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: salaryCurrency,
    salary_period: salaryPeriod,
    posted_at: postedAt,
    company_name: org?.name?.trim() || companyName,
    company_website_url: website,
    company_logo_url: logo ?? null,
  };
}

function locationsFromPosting(jp: SchemaJobPosting): { location: string | null; workplace: WorkplaceType | null } {
  if (jp.jobLocationType === "TELECOMMUTE") {
    return { location: normalizeLocation("Remote"), workplace: "remote" };
  }

  const jl = jp.jobLocation;
  if (jl == null) return { location: null, workplace: null };

  const places = Array.isArray(jl) ? jl : [jl];
  const norm: string[] = [];
  for (const pl of places) {
    const s = parsePlace(pl);
    if (s) norm.push(s);
  }
  if (norm.length === 0) return { location: null, workplace: null };

  const uniq = [...new Set(norm)];
  const combined = uniq.join("; ");
  const lower = combined.toLowerCase();
  let workplace: WorkplaceType | null = null;
  if (lower.includes("remote")) workplace = "remote";
  else if (lower.includes("hybrid")) workplace = "hybrid";
  else workplace = normalizeWorkplaceType("on-site", combined);

  return { location: combined, workplace };
}

function parseLocTags(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  for (const m of xml.matchAll(re)) {
    const u = m[1]?.trim();
    if (u) out.push(u);
  }
  return out;
}

function isJobDetailsUrl(url: string): boolean {
  return /^https:\/\/www\.metacareers\.com\/profile\/job_details\/\d+$/i.test(url.trim());
}

/**
 * Follow sitemap index children (depth-limited). Meta currently serves a flat urlset.
 */
async function collectJobDetailUrls(sitemapUrl: string, depth: number): Promise<string[]> {
  const res = await fetch(sitemapUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
  });
  if (!res.ok) {
    throw new Error(`Meta careers sitemap HTTP ${res.status} (${sitemapUrl})`);
  }
  const xml = await res.text();
  const lower = xml.slice(0, 500).toLowerCase();
  if (lower.includes("<sitemapindex") && depth < 4) {
    const childLocs = parseLocTags(xml);
    const nested: string[] = [];
    for (const loc of childLocs) {
      nested.push(...(await collectJobDetailUrls(loc, depth + 1)));
    }
    return [...new Set(nested)].filter(isJobDetailsUrl);
  }
  return parseLocTags(xml).filter(isJobDetailsUrl);
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

export const metacareersFetcher: JobSource = {
  sourceType: "metacareers",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    let sitemapUrl = source.base_url.trim();
    if (!sitemapUrl) sitemapUrl = DEFAULT_SITEMAP;
    const origin = new URL(sitemapUrl);
    if (origin.hostname !== "www.metacareers.com") {
      throw new Error(`metacareers base_url must be on www.metacareers.com, got ${source.base_url}`);
    }

    const urls = await collectJobDetailUrls(sitemapUrl, 0);
    if (urls.length === 0) {
      throw new Error(`No profile/job_details URLs in Meta careers sitemap (${source.company_handle})`);
    }

    const companyName = source.name.replace(/\s*\(Meta careers\)\s*/i, "").trim() || "Meta";

    const jobs = await parallelMap(urls, FETCH_CONCURRENCY, async (jobUrl) => {
      try {
        const html = await fetchJobHtml(jobUrl, FETCH_ATTEMPTS);
        if (!html) return null;
        return parseMetacareersPage(html, jobUrl, companyName);
      } catch {
        return null;
      }
    });

    // Sequential retry with more attempts — reduces gaps from 429s when many parallel fetches hit Meta at once.
    for (let i = 0; i < urls.length; i++) {
      if (jobs[i] !== null) continue;
      await sleep(SECOND_PASS_DELAY_MS);
      try {
        const html = await fetchJobHtml(urls[i]!, SECOND_PASS_ATTEMPTS);
        if (!html) continue;
        const row = parseMetacareersPage(html, urls[i]!, companyName);
        if (row) jobs[i] = row;
      } catch {
        /* keep null */
      }
    }

    const ok = jobs.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0 && urls.length > 0) {
      throw new Error(
        `metacareers: ${urls.length} sitemap URL(s) but 0 valid JobPosting JSON-LD payloads (${source.company_handle})`
      );
    }

    if (ok.length < urls.length) {
      logger.warn("metacareers_partial_parse", {
        source_id: source.id,
        company_handle: source.company_handle,
        sitemap_urls: urls.length,
        jobs_parsed: ok.length,
        gap: urls.length - ok.length,
      });
    }

    return ok;
  },
};
