/**
 * SAP SuccessFactors Recruitment Marketing Cloud (RMK) — career sites on `*.successfactors.com`
 * and custom hosts (e.g. careers.coty.com, burberrycareers.com). Jobs are listed in `/sitemap.xml`
 * as `/job/{slug}/{reqId}/`.
 * Detail pages expose schema.org JobPosting microdata (`itemprop` title/description) plus
 * `span.jobdescription` HTML (full JD). Apply links are `/talentcommunity/apply/{reqId}/`.
 *
 * `base_url` is either `https://{host}/sitemap.xml` or any URL on that host (we resolve `{origin}/sitemap.xml`),
 * or a single job URL `https://{host}/job/.../{reqId}/` for one-off ingest.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";
import { logger } from "../../utils/logger.ts";

/** Match Workday/Jibe — some RMK tenants sit behind CDNs that throttle non-browser UAs. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FETCH_ATTEMPTS = 3;
const FETCH_CONCURRENCY = 12;
const SECOND_PASS_ATTEMPTS = 5;
const SECOND_PASS_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function refererForRequest(url: string): string {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return "";
  }
}

async function fetchText(url: string, accept: string, attempts: number): Promise<string | null> {
  const referer = refererForRequest(url);
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: accept,
          "Accept-Language": "en-US,en;q=0.9",
          ...(referer ? { Referer: referer } : {}),
        },
        redirect: "follow",
      });
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        await sleep(200 * (a + 1) + Math.floor(Math.random() * 100));
        continue;
      }
      if (!res.ok) return null;
      return await res.text();
    } catch {
      await sleep(120 * (a + 1));
    }
  }
  return null;
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

function isRmkJobUrl(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    return /\/job\/.+\/\d+\/?$/.test(p);
  } catch {
    return false;
  }
}

function externalIdFromJobUrl(jobUrl: string): string | null {
  const m = /\/(\d+)\/?$/.exec(new URL(jobUrl).pathname);
  return m?.[1] ?? null;
}

function resolveSitemapUrl(baseUrl: string): string {
  const t = baseUrl.trim();
  if (/\.xml(\?|$)/i.test(t)) return t;
  const u = new URL(t);
  return `${u.origin}/sitemap.xml`;
}

async function collectJobUrlsFromSitemap(sitemapUrl: string, depth: number): Promise<string[]> {
  const xml = await fetchText(sitemapUrl, "application/xml,text/xml,*/*", FETCH_ATTEMPTS);
  if (!xml) {
    throw new Error(`successfactors_rmk: sitemap HTTP failed (${sitemapUrl})`);
  }
  const head = xml.slice(0, 800).toLowerCase();
  if (head.includes("<sitemapindex") && depth < 5) {
    const childLocs = parseLocTags(xml);
    const nested: string[] = [];
    for (const loc of childLocs) {
      nested.push(...(await collectJobUrlsFromSitemap(loc, depth + 1)));
    }
    return [...new Set(nested)].filter(isRmkJobUrl);
  }
  return parseLocTags(xml).filter(isRmkJobUrl);
}

/**
 * Extract inner HTML of the job-description span by balancing `<span` / `</span>`.
 * Class name is matched case-insensitively; some tenants vary attribute order or casing.
 */
function extractJobDescriptionInnerHtml(html: string): string | null {
  const openRe = /<span[^>]*\bclass\s*=\s*["'][^"']*\bjobdescription\b[^"']*["'][^>]*>/i;
  const openMatch = html.match(openRe);
  if (!openMatch || openMatch.index === undefined) return null;
  const innerStart = openMatch.index + openMatch[0].length;
  let pos = innerStart;
  let depth = 1;
  while (pos < html.length && depth > 0) {
    const open = html.toLowerCase().indexOf("<span", pos);
    const close = html.toLowerCase().indexOf("</span>", pos);
    if (close === -1) return null;
    if (open !== -1 && open < close) {
      depth++;
      pos = open + 5;
    } else {
      depth--;
      pos = close + 7;
    }
  }
  const contentEnd = pos - 7;
  return html.slice(innerStart, contentEnd);
}

function metaContent(html: string, itemprop: string): string | null {
  const re = new RegExp(
    `<meta\\s+itemprop=["']${itemprop}["']\\s+content=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}

function spanItempropText(html: string, prop: "title" | "description"): string | null {
  const re = new RegExp(
    `<span[^>]*itemprop=["']${prop}["'][^>]*>([\\s\\S]*?)</span>`,
    "i"
  );
  const m = html.match(re);
  if (!m?.[1]) return null;
  return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

function extractJobGeoLine(html: string): string | null {
  const m = html.match(/<span class="jobGeoLocation">([^<]+)<\/span>/i);
  return m?.[1]?.trim() ?? null;
}

function extractApplyPath(html: string): string | null {
  const m = html.match(/href="(\/talentcommunity\/apply\/\d+\/[^"]*)"/i);
  return m?.[1] ?? null;
}

function formatEmployerName(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.length <= 48 && t === t.toLowerCase()) {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return t;
}

function parseRmkJobPage(html: string, jobUrl: string, fallbackCompany: string): NormalizedJob | null {
  const ext = externalIdFromJobUrl(jobUrl);
  if (!ext) return null;

  const titleFromProp = spanItempropText(html, "title");
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i)?.[1]?.trim();
  const title = (titleFromProp || ogTitle || "").trim();
  if (!title) return null;

  const descHtml = extractJobDescriptionInnerHtml(html);
  const descFromProp = spanItempropText(html, "description");
  const descriptionRaw =
    (descHtml ? htmlToText(descHtml) : null) ||
    (descFromProp ? htmlToText(descFromProp) : null) ||
    null;

  const locality = metaContent(html, "addressLocality");
  const region = metaContent(html, "addressRegion");
  const postal = metaContent(html, "postalCode");
  const country = metaContent(html, "addressCountry");
  const geoLine = extractJobGeoLine(html);
  const location =
    normalizeLocation(geoLine) ??
    normalizeLocation([locality, region, country].filter(Boolean).join(", ")) ??
    normalizeLocation([locality, postal, country].filter(Boolean).join(", "));

  const datePostedRaw = metaContent(html, "datePosted");
  const postedAt = datePostedRaw ? parseEpochSeconds(datePostedRaw) : null;

  const orgRaw = metaContent(html, "hiringOrganization");
  const companyName = formatEmployerName(orgRaw || "") || fallbackCompany;

  const origin = new URL(jobUrl).origin;
  const applyPath = extractApplyPath(html);
  const applyUrl = applyPath ? new URL(applyPath, origin).href : jobUrl;

  const workplace = normalizeWorkplaceType(null, `${title} ${descriptionRaw ?? ""}`);

  return {
    external_id: ext,
    title,
    location,
    employment_type: null,
    workplace_type: workplace,
    apply_url: applyUrl,
    source_url: jobUrl,
    description_raw: descriptionRaw,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: postedAt,
    company_name: companyName,
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

export const successfactorsRmkFetcher: JobSource = {
  sourceType: "successfactors_rmk",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const trimmed = source.base_url.trim();
    const fallbackCompany =
      source.name.replace(/\s*\([^)]*SuccessFactors[^)]*\)\s*/i, "").trim() ||
      source.company_handle.replace(/-/g, " ");

    if (isRmkJobUrl(trimmed)) {
      const html = await fetchText(trimmed, "text/html,*/*", FETCH_ATTEMPTS);
      if (!html) {
        throw new Error(`successfactors_rmk: failed to fetch job page ${trimmed}`);
      }
      const row = parseRmkJobPage(html, trimmed, fallbackCompany);
      if (!row) {
        throw new Error(`successfactors_rmk: could not parse JobPosting microdata for ${trimmed}`);
      }
      return [row];
    }

    try {
      new URL(trimmed);
    } catch {
      throw new Error(`successfactors_rmk: invalid base_url ${source.base_url}`);
    }

    const sitemapUrl = resolveSitemapUrl(trimmed);
    const urls = await collectJobUrlsFromSitemap(sitemapUrl, 0);
    if (urls.length === 0) {
      throw new Error(`successfactors_rmk: no /job/.../{id} URLs in sitemap (${sitemapUrl})`);
    }

    const jobs = await parallelMap(urls, FETCH_CONCURRENCY, async (jobUrl) => {
      try {
        const html = await fetchText(jobUrl, "text/html,*/*", FETCH_ATTEMPTS);
        if (!html) return null;
        return parseRmkJobPage(html, jobUrl, fallbackCompany);
      } catch {
        return null;
      }
    });

    for (let i = 0; i < urls.length; i++) {
      if (jobs[i] !== null) continue;
      await sleep(SECOND_PASS_DELAY_MS);
      try {
        const html = await fetchText(urls[i]!, "text/html,*/*", SECOND_PASS_ATTEMPTS);
        if (!html) continue;
        const row = parseRmkJobPage(html, urls[i]!, fallbackCompany);
        if (row) jobs[i] = row;
      } catch {
        /* keep null */
      }
    }

    const ok = jobs.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0 && urls.length > 0) {
      throw new Error(
        `successfactors_rmk: ${urls.length} sitemap job URL(s) but 0 parsed (${source.company_handle})`
      );
    }

    if (ok.length < urls.length) {
      logger.warn("successfactors_rmk_partial_parse", {
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
