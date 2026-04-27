/**
 * The Chronicle of Higher Education Jobs — `jobs.chronicle.com` (higher ed listings).
 *
 * **List:** RSS at `GET /jobsrss/?…` (same query string as the site’s “Subscribe to RSS” for a
 * search or category; e.g. Education: `PositionType=24&countrycode=US`).
 * **Detail:** `GET /job/{id}/…` — full body from `JobPosting` JSON-LD `description` when the HTML
 * response is real (not a Cloudflare interstitial). When the origin blocks plain `fetch` (typical
 * for RSS and HTML from datacenters), we fall back to the **Jina Reader** mirror
 * `GET https://r.jina.ai/https://jobs.chronicle.com/...` (still plain `fetch`, no headless
 * browser) and parse the returned markdown. If that fails, use RSS `<description>` (teaser) or
 * a short synthetic blurb.
 *
 * `base_url`: **Feed URL** `https://jobs.chronicle.com/jobsrss/?…`, or a **home/browse URL** (UTM
 * stripped) to use the default US `jobsrss` feed.
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

const ORIGIN = "https://jobs.chronicle.com";

/**
 * Jina AI Reader fetches a URL and returns stable markdown+metadata. The Chronicle job board
 * is behind a Cloudflare browser challenge for most non-browser clients; the reader endpoint
 * is a plain-HTTP way to get the public RSS and job pages without Puppeteer.
 */
const JINA_READER_PREFIX = "https://r.jina.ai/";

/**
 * Jina Reader often returns **403** when `User-Agent` looks like a desktop browser (Chrome/Safari).
 * Use a simple, identifyable bot string for `r.jina.ai` only — keep browser-like headers for
 * direct `jobs.chronicle.com` fetches.
 */
const JINA_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": "CurastemJobsBot/1.0 (+https://curastem.org)",
  Accept: "text/plain, text/markdown, */*",
};

/** Lower concurrency for Jina-backed detail fetches to reduce 429s. */
const JINA_DETAIL_CONCURRENCY = 4;

const MAX_JOBS_PER_RUN = 2000;
const MAX_DETAIL_CONCURRENCY = 12;

const CHRONICLE_FOOTER = "Listing source: Chronicle of Higher Education Jobs (higher ed job board).";

/** Browser-like `fetch` headers only (not Cloudflare Browser Rendering). */
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/html, */*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${ORIGIN}/`,
};

function getTagFromItem(itemXml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = itemXml.match(regex);
  if (!match) return null;
  let content = match[1]!.trim();
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) content = cdata[1]!;
  return content || null;
}

function absLink(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `${ORIGIN}${href}`;
  return `${ORIGIN}/${href.replace(/^\//, "")}`;
}

function jobIdFromHref(href: string): string | null {
  const m = href.match(/\/job\/(\d+)(?:\/|\?|#|$)/i);
  return m ? m[1]! : null;
}

/**
 * If `base_url` is not already a `jobsrss` feed, use a default US-wide RSS (broad; narrow with a
 * full jobsrss URL from the Chronicle UI).
 */
export function resolveChronicleFeedUrl(baseUrl: string): string {
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    return `${ORIGIN}/jobsrss/?countrycode=US`;
  }
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "gclid", "ref"]) {
    u.searchParams.delete(k);
  }
  const host = u.hostname.toLowerCase();
  if (host !== "jobs.chronicle.com") {
    return `${ORIGIN}/jobsrss/?countrycode=US`;
  }
  if (u.pathname.toLowerCase().includes("jobsrss")) {
    if (!u.toString().startsWith("https:")) u.protocol = "https:";
    return u.toString();
  }
  return `${ORIGIN}/jobsrss/?countrycode=US`;
}

function isCloudflareChallengeHtml(html: string): boolean {
  return (
    (html.includes("Just a moment...") && html.includes("_cf_chl")) ||
    (html.length < 800 && /challenge-platform|cf-browser-verification|__cf_chl_f_tk/i.test(html))
  );
}

function isLikelyRssXml(s: string): boolean {
  const t = s.slice(0, 500);
  return /<rss[\s>]/i.test(t) || /<feed[\s>]/i.test(t) || (t.includes("<item") && t.includes("</item>"));
}

type JobDetailRow = {
  title: string;
  company: string;
  loc: string;
  body: string | null;
  posted: number | null;
  remote: boolean;
};

function parseRssItemEntries(xml: string): Array<{
  id: string;
  link: string;
  title: string;
  desc: string | null;
  posted: number | null;
}> {
  const out: Array<{
    id: string;
    link: string;
    title: string;
    desc: string | null;
    posted: number | null;
  }> = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const item = m[1]!;
    const linkRaw = getTagFromItem(item, "link");
    const title = getTagFromItem(item, "title");
    if (!linkRaw || !title) continue;
    const link = absLink(linkRaw.trim());
    const jid = jobIdFromHref(link);
    if (!jid) continue;
    const desc = getTagFromItem(item, "description");
    const pub = getTagFromItem(item, "pubDate");
    let posted: number | null = null;
    if (pub) {
      const p = Date.parse(pub);
      if (!Number.isNaN(p)) posted = Math.floor(p / 1000);
    }
    if (!out.some((x) => x.id === jid)) {
      out.push({ id: jid, link, title, desc, posted });
    }
  }
  return out;
}

async function fetchRssXmlOnce(feedUrl: string): Promise<string | null> {
  const res = await fetch(feedUrl, { headers: { ...FETCH_HEADERS, Accept: "application/rss+xml, */*" } });
  if (!res.ok) return null;
  const t = await res.text();
  if (isCloudflareChallengeHtml(t) || !isLikelyRssXml(t)) return null;
  return t;
}

function jinaReaderUrlFor(jobsChronicleUrl: string): string {
  return `${JINA_READER_PREFIX}${jobsChronicleUrl}`;
}

function isUnusableJinaResponse(t: string): boolean {
  if (!t || t.length < 120) return true;
  if (/failed to (fetch|load|retrieve)/i.test(t) && t.length < 2_000) return true;
  if (t.includes("Just a moment...") && t.includes("_cf_chl")) return true;
  return false;
}

async function fetchJinaMarkdown(jobsChronicleUrl: string, attempt = 0): Promise<string | null> {
  const u = jinaReaderUrlFor(jobsChronicleUrl);
  const res = await fetch(u, { headers: JINA_FETCH_HEADERS });
  if (!res.ok) {
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
      return fetchJinaMarkdown(jobsChronicleUrl, attempt + 1);
    }
    return null;
  }
  const t = await res.text();
  if (isUnusableJinaResponse(t)) return null;
  return t;
}

/** Pull `Markdown Content:` (or strip reader preamble) for job detail / list bodies. */
function jinaTextAfterMarkdownContent(md: string): string {
  const m = md.match(/Markdown Content:\s*([\s\S]+)/i);
  if (m) return m[1]!.trim();
  return md
    .replace(/^(?:Title|URL Source|Published Time):\s*[^\n]*\n+/gim, "")
    .trim();
}

/**
 * Jina’s RSS mirror turns each item into a markdown block: heading link, optional teaser, duplicate
 * link line, then an RFC-2822 `pubDate` line.
 */
function parseJinaFeedMarkdownToItemEntries(
  md: string
): Array<{ id: string; link: string; title: string; desc: string | null; posted: number | null }> {
  const body = jinaTextAfterMarkdownContent(md);
  const out: Array<{
    id: string;
    link: string;
    title: string;
    desc: string | null;
    posted: number | null;
  }> = [];
  const re = /^###\s+\[([^\]]*)\]\((https:\/\/jobs\.chronicle\.com\/job\/\d+[^)]+)\)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = m[1]!.trim() || "Position";
    const link = m[2]!.trim();
    const idMatch = link.match(/\/job\/(\d+)\b/i);
    if (!idMatch) continue;
    const jid = idMatch[1]!;

    const blockStart = m.index + m[0]!.length;
    const rest = body.slice(blockStart);
    const nextH3 = /(^|\n)###\s+\[/m.exec(rest);
    const block = nextH3 && nextH3.index !== undefined ? rest.slice(0, nextH3.index) : rest;

    const teaserLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("[https://jobs.chronicle.com")) break;
      teaserLines.push(t);
    }
    const desc = teaserLines.length > 0 ? teaserLines.join(" ").replace(/\s+/g, " ").trim() : null;

    let posted: number | null = null;
    for (const L of block.split(/\r?\n/)) {
      const s = L.trim();
      if (!/^\S{3,},\s+\d{1,2}\s+/.test(s) && !/^\d{4}-\d{2}-\d{2}T/.test(s)) continue;
      const p = Date.parse(s);
      if (!Number.isNaN(p)) {
        posted = Math.floor(p / 1000);
        break;
      }
    }
    if (!out.some((x) => x.id === jid)) {
      out.push({ id: jid, link, title, desc, posted });
    }
  }
  return out;
}

function jobPostingFromJinaReaderMarkdown(
  md: string,
  fallbackTitle: string
): JobDetailRow | null {
  if (isUnusableJinaResponse(md)) return null;
  const titleLine = md.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const timeLine = md.match(/^Published Time:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const body = jinaTextAfterMarkdownContent(md);
  if (!body || body.length < 40) return null;

  let title = fallbackTitle;
  let company = "College or university";
  let loc = "United States";
  if (titleLine) {
    const tjm = titleLine.match(
      /^(.+?)\s+-\s+(.+?)\s+job with\s+(.+?)(?:\s*\|\s*(\d+))?\s*$/i
    );
    if (tjm) {
      title = tjm[1]!.trim() || title;
      loc = tjm[2]!.trim() || loc;
      company = tjm[3]!.trim() || company;
    } else {
      const simple = titleLine.split("|")[0]!.trim();
      if (simple.length > 0 && !/^https?:/i.test(simple)) title = simple;
    }
  }

  let postedSec: number | null = null;
  if (timeLine) {
    const p = Date.parse(timeLine);
    if (!Number.isNaN(p)) postedSec = Math.floor(p / 1000);
  }

  const tLower = (titleLine + body).toLowerCase();
  const remote =
    /\b(telecommute|fully remote|work from home|remote work)\b/.test(tLower) || /\bTELECOMMUTE\b/.test(
      titleLine
    );

  return { title, company, loc, body, posted: postedSec, remote };
}

async function fetchRssWithJinaFallback(feedUrl: string): Promise<{
  entries: ReturnType<typeof parseRssItemEntries>;
  feedFromJina: boolean;
}> {
  const xml = await fetchRssXmlOnce(feedUrl);
  if (xml) {
    return { entries: parseRssItemEntries(xml), feedFromJina: false };
  }
  const md = await fetchJinaMarkdown(feedUrl);
  if (!md) {
    throw new Error(
      "chronicle_jobs: could not load RSS (direct and Jina reader both failed; Cloudflare or rate limit). Try again later or verify the feed URL."
    );
  }
  const entries = parseJinaFeedMarkdownToItemEntries(md);
  if (entries.length === 0) {
    throw new Error(
      "chronicle_jobs: Jina reader returned no job links. Check the jobsrss URL in a browser (Subscribe to RSS)."
    );
  }
  return { entries, feedFromJina: true };
}

async function fetchJobDetailFromNetwork(
  jobId: string,
  itemLink: string,
  options: { feedFromJina: boolean; itemTitle: string }
): Promise<JobDetailRow | null> {
  if (!options.feedFromJina) {
    const d = await fetchJobDetailFromNetworkDirect(jobId, itemLink);
    if (d) return d;
  }
  const u =
    itemLink && itemLink.includes(`/job/${jobId}`)
      ? itemLink
      : `${ORIGIN}/job/${jobId}/`;
  const clean = u.split("#")[0] ?? u;
  const md = await fetchJinaMarkdown(clean);
  if (!md) return null;
  return jobPostingFromJinaReaderMarkdown(md, options.itemTitle);
}

async function fetchJobDetailFromNetworkDirect(
  jobId: string,
  itemLink: string
): Promise<JobDetailRow | null> {
  const u = itemLink && itemLink.includes(`/job/${jobId}`) ? itemLink : `${ORIGIN}/job/${jobId}/`;
  const res = await fetch(u, { headers: { ...FETCH_HEADERS, Accept: "text/html" } });
  if (!res.ok) return null;
  return jobPostingFromHtmlDocument(await res.text());
}

function extractJobPostingFromHtml(html: string): Record<string, unknown> | null {
  const re = /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const o = parseJsonLenientObject(m[1]!.trim());
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
    const t = htmlToText(unescapeJsonDescription(desc));
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

function jobPostingFromHtmlDocument(html: string): JobDetailRow | null {
  if (isCloudflareChallengeHtml(html) || html.length < 2_000) return null;
  const j = extractJobPostingFromHtml(html);
  if (!j) return null;
  const p = textFromJsonLd(j);
  if (!String(p.title ?? "").trim()) return null;
  const postedSec =
    p.posted && !Number.isNaN(Date.parse(p.posted)) ? Math.floor(Date.parse(p.posted) / 1000) : null;
  return { title: p.title, company: p.company, loc: p.loc, body: p.body, posted: postedSec, remote: p.remote };
}

function rssTextToMaybeBody(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const t = raw.includes("<") ? htmlToText(raw) : String(raw).trim();
  return t.length >= 30 ? t : null;
}

function hasStashedReal(footer: string, d: string | null | undefined): boolean {
  if (!d || !d.trim()) return false;
  if (d.includes(footer)) return false;
  return d.trim().length >= 40;
}

function syntheticFallback(title: string, company: string, loc: string): string {
  return [`Organization: ${company}`, `Role: ${title}`, `Location: ${loc}`, CHRONICLE_FOOTER].join("\n");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

async function runChronicleIngest(
  source: SourceRow,
  env: Env | undefined,
  maxJobs: number
): Promise<NormalizedJob[]> {
  const feedUrl = resolveChronicleFeedUrl(source.base_url);
  const nowSec = Math.floor(Date.now() / 1000);

  const { entries: allEntries, feedFromJina } = await fetchRssWithJinaFallback(feedUrl);
  const cap = Math.max(1, Math.min(maxJobs, MAX_JOBS_PER_RUN, allEntries.length));
  const entries = allEntries.slice(0, cap);
  if (entries.length === 0) {
    throw new Error("chronicle_jobs: no <item> entries in feed (empty category or wrong URL?)");
  }

  const existingByEid =
    env?.JOBS_DB && entries.length > 0
      ? await batchGetExistingJobs(
          env.JOBS_DB,
          source.id,
          entries.map((e) => e.id)
        )
      : new Map();

  const detailConcurrency = feedFromJina ? JINA_DETAIL_CONCURRENCY : MAX_DETAIL_CONCURRENCY;
  const details = await mapWithConcurrency(entries, detailConcurrency, async (e) => {
    const d = await fetchJobDetailFromNetwork(e.id, e.link, { feedFromJina, itemTitle: e.title });
    return { e, d } as { e: (typeof entries)[0]; d: JobDetailRow | null };
  });

  const out: NormalizedJob[] = [];
  for (const { e, d } of details) {
    const apply = e.link.split("#")[0]!.split("?")[0]!;
    const storedDesc = existingByEid.get(e.id)?.description_raw;
    const stashed = hasStashedReal(CHRONICLE_FOOTER, storedDesc);

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
      posted = d.posted ?? e.posted ?? nowSec;
      remote = d.remote;
      if (stashed && storedDesc) {
        descriptionRaw = storedDesc.trim();
      } else if (d.body && d.body.length >= 40) {
        descriptionRaw = d.body;
      } else {
        const rssfb = rssTextToMaybeBody(e.desc);
        descriptionRaw = rssfb ?? syntheticFallback(d.title, d.company, d.loc);
      }
    } else {
      title = (e.title || "").trim() || "Position";
      const rssCo = (() => {
        const t = (e.title || "").trim();
        const em = t.match(/(?:^|[\s,])\bat\s+(.+)$/i);
        if (em) return em[1]!.trim();
        return "College or university";
      })();
      company = rssCo;
      loc = "United States";
      posted = e.posted ?? nowSec;
      remote = false;
      const rssfb = rssTextToMaybeBody(e.desc);
      descriptionRaw =
        (stashed && storedDesc && storedDesc.trim().length > 0 ? storedDesc.trim() : null) ??
        rssfb ??
        syntheticFallback(title, company, loc);
    }

    if (!title.trim()) continue;

    out.push({
      external_id: e.id,
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
}

/**
 * Fetches a bounded sample (default 5) for local or CI checks that RSS + Jina + job pages work.
 * Not used in production crons; use the provider `fetch` instead.
 */
export async function smokeChronicleIngestion(
  maxJobs: number = 5
): Promise<{ jobs: NormalizedJob[]; jobCount: number; substantiveDescriptionCount: number }> {
  const source: SourceRow = {
    id: "chronicle-smoke",
    name: "Chronicle smoke",
    source_type: "chronicle_jobs",
    company_handle: "chronicle",
    base_url: "https://jobs.chronicle.com/?utm_source=curastem",
    enabled: 1,
    last_fetched_at: null,
    last_job_count: null,
    last_error: null,
    fetch_interval_hours: null,
    created_at: 0,
  };
  const jobs = await runChronicleIngest(source, undefined, maxJobs);
  // Real listing text: above RSS teaser + above the 3-line synthetic fallback.
  const substantiveDescriptionCount = jobs.filter(
    (j) => (j.description_raw?.length ?? 0) >= 150
  ).length;
  return { jobs, jobCount: jobs.length, substantiveDescriptionCount };
}

export const chronicleJobsFetcher: JobSource = {
  sourceType: "chronicle_jobs",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    return runChronicleIngest(source, env, MAX_JOBS_PER_RUN);
  },
};
