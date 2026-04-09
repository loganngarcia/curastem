/**
 * iCIMS Talent Cloud job portals (multi-host hub search).
 *
 * Many employers embed `*.icims.com/jobs/search?...` on the corporate site; listings can link to
 * role-specific hosts (`stores-na-*.icims.com`, `homeoffice-*.icims.com`, etc.). The hub search
 * paginates with `pr=`; each job page serves full copy when loaded with `in_iframe=1` (JSON-LD
 * JobPosting with HTML `description`).
 *
 * `base_url` is the hub search URL (page 1), including any `hashed=` portal id required by the
 * tenant — e.g. `https://hub-urbn.icims.com/jobs/search?hashed=-625912878&in_iframe=1`
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";
import { logger } from "../../utils/logger.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const LISTING_CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 14;
const MAX_SEARCH_PAGES = 200;

interface JobPostingLd {
  "@type"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  url?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: unknown;
  baseSalary?: {
    currency?: string;
    minValue?: number;
    maxValue?: number;
    unitText?: string;
  };
}

function stripParenName(name: string): string {
  return name.replace(/\s*\([^)]*iCIMS[^)]*\)\s*/i, "").trim();
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function buildSearchPageUrl(base: string, pageIndex: number): string {
  const u = new URL(base.trim());
  u.searchParams.set("in_iframe", "1");
  if (pageIndex > 0) u.searchParams.set("pr", String(pageIndex));
  else u.searchParams.delete("pr");
  return u.toString();
}

function maxPageFromListing(html: string): number {
  const m = /Page \d+ of (\d+)/i.exec(html);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Canonical `https://{host}/jobs/{id}/{slug}/job` (no query). */
function extractCanonicalJobUrls(html: string): string[] {
  const re = /href="(https:\/\/[a-z0-9.-]*\.icims\.com\/jobs\/\d+\/[^"?]+)/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const raw = m[1].replace(/&amp;/g, "&");
    try {
      const u = new URL(raw);
      const canon = `${u.origin}${u.pathname}`.replace(/\/$/, "");
      if (!/\/jobs\/\d+\//.test(canon)) continue;
      if (!seen.has(canon)) {
        seen.add(canon);
        out.push(canon);
      }
    } catch {
      continue;
    }
  }
  return out;
}

function externalIdFromCanon(url: string): string | null {
  const m = /\/jobs\/(\d+)\//.exec(url);
  return m?.[1] ?? null;
}

function extractJobPostingLd(html: string): JobPostingLd | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = JSON.parse(m[1]) as JobPostingLd | JobPostingLd[];
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
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function descriptionFromLd(ld: JobPostingLd): string | null {
  const d = ld.description;
  if (typeof d !== "string" || !d.trim()) return null;
  const t = htmlToText(d);
  return t.length > 0 ? t : null;
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
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

export const icimsPortalFetcher: JobSource = {
  sourceType: "icims_portal",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const fallbackCompany = stripParenName(source.name);
    const firstUrl = buildSearchPageUrl(source.base_url, 0);
    const firstHtml = await fetchText(firstUrl);
    if (!firstHtml) {
      throw new Error(`icims_portal: listing HTTP failed (${firstUrl})`);
    }

    const totalPages = Math.min(maxPageFromListing(firstHtml), MAX_SEARCH_PAGES);
    const pageHtmls: string[] = new Array(totalPages);
    pageHtmls[0] = firstHtml;

    if (totalPages > 1) {
      const restIdx = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);
      await parallelMap(restIdx, LISTING_CONCURRENCY, async (pageIndex) => {
        const u = buildSearchPageUrl(source.base_url, pageIndex);
        const h = await fetchText(u);
        pageHtmls[pageIndex] = h ?? "";
      });
    }

    const jobUrls = new Set<string>();
    for (const h of pageHtmls) {
      if (!h) continue;
      for (const u of extractCanonicalJobUrls(h)) jobUrls.add(u);
    }

    const urls = [...jobUrls];
    if (urls.length === 0) {
      throw new Error(`icims_portal: 0 job URLs from hub listing (${source.company_handle})`);
    }

    const jobs = await parallelMap(urls, DETAIL_CONCURRENCY, async (canon) => {
      const detailUrl = `${canon}?in_iframe=1`;
      const html = await fetchText(detailUrl);
      if (!html) return null;
      const ld = extractJobPostingLd(html);
      if (!ld?.title) return null;

      const ext = externalIdFromCanon(canon);
      if (!ext) return null;

      const locStr = locationFromLd(ld);
      const locNorm = locStr ? normalizeLocation(locStr) : null;
      const etRaw = Array.isArray(ld.employmentType) ? ld.employmentType[0] : ld.employmentType;
      const etHint =
        typeof etRaw === "string" ? etRaw.replace(/_/g, " ").toLowerCase() : null;

      let salary_min: number | null = null;
      let salary_max: number | null = null;
      let salary_currency: string | null = null;
      let salary_period: "year" | "month" | "hour" | null = null;
      const bs = ld.baseSalary;
      if (bs && typeof bs === "object") {
        if (typeof bs.minValue === "number") salary_min = bs.minValue;
        if (typeof bs.maxValue === "number") salary_max = bs.maxValue;
        else if (typeof bs.minValue === "number") salary_max = bs.minValue;
        if (typeof bs.currency === "string") salary_currency = bs.currency;
        const ut = (bs.unitText ?? "").toLowerCase();
        if (ut.includes("hour") || ut === "h") salary_period = "hour";
        else if (ut.includes("year") || ut === "y") salary_period = "year";
        else if (ut.includes("month")) salary_period = "month";
        else if (salary_min != null && salary_max != null) salary_period = "hour";
      }

      const applyUrl = typeof ld.url === "string" && /^https?:\/\//i.test(ld.url) ? ld.url : canon;

      const row: NormalizedJob = {
        external_id: ext,
        title: ld.title,
        location: locNorm,
        employment_type: normalizeEmploymentType(etHint),
        workplace_type: normalizeWorkplaceType(null, `${ld.title} ${ld.description ?? ""}`),
        apply_url: applyUrl,
        source_url: canon,
        description_raw: descriptionFromLd(ld),
        salary_min,
        salary_max,
        salary_currency,
        salary_period,
        posted_at: parseEpochSeconds(ld.datePosted ?? null),
        company_name: ld.hiringOrganization?.name?.trim() || fallbackCompany,
        company_logo_url: null,
        company_website_url: null,
      };
      return row;
    });

    const ok = jobs.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0) {
      throw new Error(`icims_portal: ${urls.length} job URL(s) but 0 parsed (${source.company_handle})`);
    }
    if (ok.length < urls.length) {
      logger.warn("icims_portal_partial_parse", {
        source_id: source.id,
        company_handle: source.company_handle,
        urls: urls.length,
        parsed: ok.length,
      });
    }

    return ok;
  },
};
