/**
 * HigherEdJobs — `higheredjobs.com` (college and university roles).
 *
 * **Detail** (plain `fetch`): `GET /details.cfm?JobCode={id}` embeds `application/ld+json` `JobPosting`
 * (description, title, `hiringOrganization`, `jobLocation`, `datePosted`).
 *
 * **List:** RSS (`categoryFeed.cfm` / `rss.cfm`) or **search** (`search.cfm` + `StartRow`) with
 * browser-like HTTP headers. When Incapsula blocks direct `fetch` (typical from datacenters), we
 * fall back to **Jina Reader** (`r.jina.ai`) for the feed and job detail pages — same pattern as
 * `chronicle_jobs`.
 *
 * `base_url` options:
 * - RSS: `https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=101` (Chemistry, etc.)
 * - Search: `https://www.higheredjobs.com/executive/search.cfm?JobCat=249` (paginated via `StartRow`)
 */

import { batchGetExistingJobs } from "../../db/queries.ts";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { parseJsonLenientObject } from "../../utils/jsonLenientParse.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";
import { parseRssXmlToJobs } from "./rssParse.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const ORIGIN = "https://www.higheredjobs.com";

/** Jina Reader bypasses Incapsula for RSS and HTML when plain `fetch` gets an interstitial. */
const JINA_READER_PREFIX = "https://r.jina.ai/";

/**
 * Jina often returns **403** when `User-Agent` looks like a desktop browser; use a simple bot string
 * for `r.jina.ai` only.
 */
const JINA_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": "CurastemJobsBot/1.0 (+https://curastem.org)",
  Accept: "text/plain, text/markdown, */*",
};

const MAX_JOBS_PER_RUN = 2000;
const MAX_DETAIL_CONCURRENCY = 12;
/** Lower concurrency when detail fetches go through Jina (rate limits). */
const JINA_DETAIL_CONCURRENCY = 4;
const LIST_PAGE_SIZE = 25;

const HEJ_FOOTER = "Listing source: HigherEdJobs (higher education job board).";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${ORIGIN}/`,
};

function jobCodeFromUrl(url: string): string | null {
  const m = url.match(/[?&]JobCode=(\d+)/i);
  return m ? m[1]! : null;
}

function jobCodesFromHtml(html: string): string[] {
  const re = /[?&]JobCode=(\d+)/gi;
  const s = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) s.add(m[1]!);
  return [...s];
}

function isRssUrl(url: string): boolean {
  return url.includes("categoryFeed.cfm") || url.includes("/rss/") || /rss\.cfm/i.test(url);
}

function isBlockedInterstitial(html: string): boolean {
  return (
    html.includes("Pardon Our Interruption") ||
    (html.includes("Incapsula") && !html.includes("JobPosting")) ||
    (html.length < 1200 && !html.includes("<item") && !html.includes("JobCode="))
  );
}

function jinaReaderUrlFor(targetUrl: string): string {
  return `${JINA_READER_PREFIX}${targetUrl}`;
}

function isUnusableJinaResponse(t: string): boolean {
  if (!t || t.length < 120) return true;
  if (/failed to (fetch|load|retrieve)/i.test(t) && t.length < 2_000) return true;
  if (t.includes("Pardon Our Interruption")) return true;
  return false;
}

async function fetchJinaMarkdown(targetUrl: string, attempt = 0): Promise<string | null> {
  const u = jinaReaderUrlFor(targetUrl);
  const res = await fetch(u, { headers: JINA_FETCH_HEADERS });
  if (!res.ok) {
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
      return fetchJinaMarkdown(targetUrl, attempt + 1);
    }
    return null;
  }
  const t = await res.text();
  if (isUnusableJinaResponse(t)) return null;
  return t;
}

function jinaTextAfterMarkdownContent(md: string): string {
  const m = md.match(/Markdown Content:\s*([\s\S]+)/i);
  if (m) return m[1]!.trim();
  return md
    .replace(/^(?:Title|URL Source|Published Time):\s*[^\n]*\n+/gim, "")
    .trim();
}

/** Jina’s RSS mirror uses ### headings with `details.cfm?JobCode=` links (same shape as Chronicle). */
function parseHejJinaFeedMarkdown(md: string): Map<string, { title: string; orgLine: string | null }> {
  const byCode = new Map<string, { title: string; orgLine: string | null }>();
  const body = jinaTextAfterMarkdownContent(md);
  const re =
    /^###\s+\[([^\]]*)\]\((https:\/\/www\.higheredjobs\.com\/details\.cfm\?JobCode=\d+[^)]*)\)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = m[1]!.trim() || "Position";
    const link = m[2]!.trim();
    const idMatch = link.match(/JobCode=(\d+)/i);
    if (!idMatch) continue;
    const code = idMatch[1]!;

    const blockStart = m.index + m[0]!.length;
    const rest = body.slice(blockStart);
    const nextH3 = /(^|\n)###\s+\[/m.exec(rest);
    const block = nextH3 && nextH3.index !== undefined ? rest.slice(0, nextH3.index) : rest;

    let orgLine: string | null = null;
    for (const line of block.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("[https://www.higheredjobs.com")) break;
      orgLine = t;
      break;
    }
    if (!byCode.has(code)) byCode.set(code, { title, orgLine });
  }
  return byCode;
}

function orgAndLocFromFeedLine(orgLine: string | null): { company: string; loc: string } {
  if (!orgLine || !orgLine.trim() || orgLine.length > 240) {
    return { company: "College or university", loc: "United States" };
  }
  const paren = orgLine.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    return { company: paren[1]!.trim(), loc: paren[2]!.trim() };
  }
  return { company: orgLine.trim(), loc: "United States" };
}

function detailFromHejJinaMarkdown(md: string, feedOrgLine: string | null): {
  title: string;
  company: string;
  loc: string;
  body: string | null;
  posted: number | null;
  remote: boolean;
} | null {
  if (isUnusableJinaResponse(md)) return null;
  const titleLine = md.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const timeLine = md.match(/^Published Time:\s*(.+)$/m)?.[1]?.trim() ?? "";
  let body = jinaTextAfterMarkdownContent(md);
  body = body.replace(/^!\[[^\]]*]\([^)]+\)\s*/m, "").trim();
  if (!body || body.length < 40) return null;

  let title = titleLine || "Position";
  const { company: feedCo, loc: feedLoc } = orgAndLocFromFeedLine(feedOrgLine);
  let company = feedCo;
  let loc = feedLoc;

  let postedSec: number | null = null;
  if (timeLine) {
    const p = Date.parse(timeLine);
    if (!Number.isNaN(p)) postedSec = Math.floor(p / 1000);
  }

  const tLower = (title + body).toLowerCase();
  const remote =
    /\b(telecommute|fully remote|work from home|remote work|hybrid)\b/.test(tLower) ||
    /\bTELECOMMUTE\b/.test(title);

  return { title, company, loc, body, posted: postedSec, remote };
}

function detailPageUrl(jobCode: string): string {
  return `${ORIGIN}/details.cfm?JobCode=${encodeURIComponent(jobCode)}`;
}

function withStartRow(u: string, startRow: number): string {
  const x = new URL(u);
  x.searchParams.set("StartRow", String(startRow));
  return x.toString();
}

function extractJobPostingJson(html: string): Record<string, unknown> | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const o = parseJsonLenientObject(m[1]!);
    if (!o) continue;
    const t = o["@type"];
    if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return o;
  }
  return null;
}

function unescapeJsonDescription(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textFromJsonLd(
  j: Record<string, unknown>
): { title: string; body: string | null; company: string; loc: string; posted: string | null; remote: boolean } {
  const title = String(j.title ?? "").trim();
  const desc = j.description;
  let body: string | null = null;
  if (typeof desc === "string" && desc.trim()) {
    const un = unescapeJsonDescription(desc);
    const t = htmlToText(un);
    body = t.length > 0 ? t : null;
  }
  let company = "College or university";
  const ho = j.hiringOrganization;
  if (ho && typeof ho === "object" && (ho as { name?: string }).name) {
    company = String((ho as { name: string }).name).trim();
  } else if (typeof ho === "string") company = ho.trim();

  let loc = "United States";
  const jl = j.jobLocation;
  if (Array.isArray(jl) && jl[0] && typeof jl[0] === "object") {
    const a = (jl[0] as { address?: Record<string, string> }).address;
    if (a) {
      const city = a.addressLocality;
      const st = a.addressRegion;
      if (city && st) loc = `${city}, ${st}`;
      else if (st) loc = st;
    }
  } else if (jl && typeof jl === "object" && (jl as { address?: { addressLocality?: string; addressRegion?: string } }).address) {
    const a = (jl as { address: { addressLocality?: string; addressRegion?: string } }).address;
    if (a.addressLocality && a.addressRegion) loc = `${a.addressLocality}, ${a.addressRegion}`;
  }

  const posted = typeof j.datePosted === "string" ? j.datePosted : null;
  const jlt = j.jobLocationType;
  const remote = typeof jlt === "string" && /TELECOMMUTE|remote/i.test(jlt);
  return { title, body, company, loc, posted, remote };
}

async function fetchDetailFromPage(
  jobCode: string,
  feedFromJina: boolean,
  hejOrgLine: string | null
): Promise<{
  title: string;
  company: string;
  loc: string;
  body: string | null;
  posted: number | null;
  remote: boolean;
} | null> {
  if (!feedFromJina) {
    const res = await fetch(detailPageUrl(jobCode), { headers: { ...BROWSER_HEADERS, Accept: "text/html" } });
    if (res.ok) {
      const html = await res.text();
      const j = extractJobPostingJson(html);
      if (j) {
        const p = textFromJsonLd(j);
        const postedSec =
          p.posted && !Number.isNaN(Date.parse(p.posted)) ? Math.floor(Date.parse(p.posted) / 1000) : null;
        return {
          title: p.title,
          company: p.company,
          loc: p.loc,
          body: p.body,
          posted: postedSec,
          remote: p.remote,
        };
      }
    }
  }
  const md = await fetchJinaMarkdown(detailPageUrl(jobCode));
  if (!md) return null;
  return detailFromHejJinaMarkdown(md, hejOrgLine);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

function hasStashedReal(footer: string, d: string | null | undefined): boolean {
  if (!d || !d.trim()) return false;
  if (d.includes(footer)) return false;
  return d.trim().length >= 40;
}

function syntheticFallback(title: string, company: string, loc: string): string {
  return [`Organization: ${company}`, `Role: ${title}`, `Location: ${loc}`, HEJ_FOOTER].join("\n");
}

function rssTextToMaybeBody(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const t = raw.includes("<") ? htmlToText(raw) : raw.trim();
  return t.length >= 30 ? t : null;
}

async function fetchRssXmlOnce(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/xml, */*",
      Referer: `${ORIGIN}/`,
    },
  });
  if (!res.ok) return null;
  const t = await res.text();
  if (isBlockedInterstitial(t) || !t.includes("<item")) return null;
  return t;
}

function jobCodesAndRssMap(xml: string): {
  codes: string[];
  byCode: Map<string, { desc: string | null; title: string; hejOrgLine?: string | null }>;
} {
  const jobs = parseRssXmlToJobs(xml, "HigherEdJobs");
  const byCode = new Map<string, { desc: string | null; title: string; hejOrgLine?: string | null }>();
  const codes: string[] = [];
  for (const j of jobs) {
    const c = jobCodeFromUrl(j.apply_url) || (j.source_url ? jobCodeFromUrl(j.source_url) : null);
    if (!c) continue;
    if (!byCode.has(c)) {
      codes.push(c);
      byCode.set(c, { desc: j.description_raw, title: j.title });
    }
  }
  return { codes, byCode };
}

async function collectSearchJobCodesFetch(listUrl: string): Promise<string[]> {
  const acc = new Set<string>();
  for (let sr = 1; acc.size < MAX_JOBS_PER_RUN && sr < 12_000; sr += LIST_PAGE_SIZE) {
    const u = withStartRow(listUrl, sr);
    const res = await fetch(u, { headers: BROWSER_HEADERS });
    if (!res.ok) break;
    const html = await res.text();
    if (isBlockedInterstitial(html)) break;
    const found = jobCodesFromHtml(html);
    if (found.length === 0) break;
    for (const c of found) {
      if (acc.size >= MAX_JOBS_PER_RUN) break;
      acc.add(c);
    }
  }
  return [...acc];
}

export const higheredjobsFetcher: JobSource = {
  sourceType: "higheredjobs",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const base = source.base_url.trim();
    const nowSec = Math.floor(Date.now() / 1000);
    let jobCodes: string[] = [];
    let rssByCode = new Map<string, { desc: string | null; title: string; hejOrgLine?: string | null }>();
    let feedFromJina = false;

    if (isRssUrl(base)) {
      const xml = await fetchRssXmlOnce(base);
      if (xml) {
        const p = jobCodesAndRssMap(xml);
        jobCodes = p.codes;
        rssByCode = p.byCode;
      } else {
        const md = await fetchJinaMarkdown(base);
        if (!md) {
          throw new Error(
            "higheredjobs: RSS blocked (Incapsula) and Jina reader failed. Retry later or check the feed URL."
          );
        }
        const jinaMap = parseHejJinaFeedMarkdown(md);
        if (jinaMap.size === 0) {
          throw new Error(
            "higheredjobs: Jina reader returned no job links. Verify the RSS URL in a browser."
          );
        }
        feedFromJina = true;
        jobCodes = [...jinaMap.keys()];
        rssByCode = new Map();
        for (const [c, v] of jinaMap) {
          rssByCode.set(c, { title: v.title, desc: v.orgLine, hejOrgLine: v.orgLine });
        }
      }
    } else {
      jobCodes = await collectSearchJobCodesFetch(base);
    }

    jobCodes = jobCodes.slice(0, MAX_JOBS_PER_RUN);

    if (jobCodes.length === 0) {
      throw new Error(
        "higheredjobs: no jobs discovered (Incapsula or empty feed). Try a search.cfm list URL, another RSS, or a different egress IP."
      );
    }

    const existingByEid =
      env?.JOBS_DB && jobCodes.length > 0
        ? await batchGetExistingJobs(env.JOBS_DB, source.id, jobCodes)
        : new Map();

    const detailLimit = feedFromJina ? JINA_DETAIL_CONCURRENCY : MAX_DETAIL_CONCURRENCY;
    const details = await mapWithConcurrency(jobCodes, detailLimit, async (code) => {
      const orgLine = rssByCode.get(code)?.hejOrgLine ?? null;
      const d = await fetchDetailFromPage(code, feedFromJina, orgLine);
      return { code, d } as const;
    });

    const out: NormalizedJob[] = [];
    for (const { code, d } of details) {
      const apply = detailPageUrl(code);
      const storedDesc = existingByEid.get(code)?.description_raw;
      const stashed = hasStashedReal(HEJ_FOOTER, storedDesc);

      let title: string;
      let company: string;
      let loc: string;
      let posted: number;
      let remote: boolean;
      let descriptionRaw: string;

      if (d?.title) {
        title = d.title;
        company = d.company;
        loc = d.loc;
        posted = d.posted ?? nowSec;
        remote = d.remote;
        if (stashed && storedDesc) {
          descriptionRaw = storedDesc.trim();
        } else if (d.body && d.body.length >= 40) {
          descriptionRaw = d.body;
        } else {
          const rssfb = rssTextToMaybeBody(rssByCode.get(code)?.desc ?? null);
          descriptionRaw = rssfb ?? syntheticFallback(d.title, d.company, d.loc);
        }
      } else {
        const rss = rssByCode.get(code);
        title = (rss?.title || "").trim() || "Position";
        company = "College or university";
        loc = "United States";
        posted = nowSec;
        remote = false;
        const rssfb = rssTextToMaybeBody(rss?.desc ?? null);
        descriptionRaw =
          (stashed && storedDesc && storedDesc.trim().length > 0 ? storedDesc.trim() : null) ?? rssfb ?? syntheticFallback(title, company, loc);
      }

      if (!title.trim()) continue;

      out.push({
        external_id: code,
        title: title.trim(),
        location: normalizeLocation(loc),
        employment_type: normalizeEmploymentType(null),
        workplace_type: remote ? "remote" : normalizeWorkplaceType(null, loc),
        apply_url: apply,
        source_url: apply,
        description_raw: descriptionRaw,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: posted,
        company_name: company,
        company_logo_url: null,
        company_website_url: null,
      });
    }

    return out;
  },
};
