/**
 * Avature-hosted career sites expose a public RSS feed at
 * `{locale}/careers/SearchJobs/feed/` (locale prefix optional in practice).
 * Example: `https://delta.avature.net/careers/SearchJobs/feed/`
 *
 * Items include title, link, guid, pubDate; `<description>` is often only ` - {jobId}`.
 * Tenants expose a **recent-postings** feed on `…/careers/SearchJobs/feed/` (row count varies;
 * no historical backfill). After RSS parse we **best-effort fetch each JobDetail page** on the
 * same origin (cookie-warmed from the careers/opportunities listing path) and extract the
 * “Description & Requirements” HTML from `article__content__view__field__value`. If a detail
 * fetch fails or HTML layout differs, we keep RSS-derived `description_raw` (often title-only).
 *
 * `base_url` must be the feed URL (ends with `feed/` or `feed`). Some tenants use a
 * locale prefix, e.g. `https://careers.lululemon.com/en_US/careers/SearchJobs/feed/`.
 * Others use `…/opportunities/SearchJobs/feed/` instead of `…/careers/…` (e.g. Baker McKenzie).
 *
 * Akamai and similar CDNs often block non-browser or overly custom `User-Agent` strings
 * (503 / connection errors). Use a normal Chrome desktop UA; identify the pipeline in code
 * and logs, not the UA string, so tenants like Lululemon accept the RSS request.
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

/** Chrome-like UA — Akamai-fronted Avature hosts reject many custom bot strings. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Parallel JobDetail fetches after RSS (typical feed size ~20 rows). */
const DETAIL_CONCURRENCY = 8;
/** Ignore tiny field__value blocks (labels / one-line metadata). */
const MIN_DESC_HTML_LEN = 120;

/** Headers that mimic a same-origin RSS fetch in Chrome (helps L’Oréal and other strict Akamai rules). */
function rssFetchHeaders(feedUrl: string): Record<string, string> {
  let origin = "";
  try {
    origin = new URL(feedUrl).origin;
  } catch {
    return {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    };
  }
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${origin}/`,
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

/** `…/careers/SearchJobs/feed/` → `…/careers` (locale segment preserved). */
function careersWarmupUrlFromFeed(feedUrl: string): string | null {
  try {
    const u = new URL(feedUrl);
    const path = u.pathname;
    const idx = path.indexOf("/SearchJobs/feed");
    if (idx === -1) return null;
    u.pathname = path.slice(0, idx) || "/";
    return u.toString();
  } catch {
    return null;
  }
}

/** Merge `Set-Cookie` name=value pairs (latest wins per cookie name). */
function mergeSetCookiesIntoJar(res: Response, jar: Map<string, string>): void {
  const raw = res.headers as unknown as { getSetCookie?: () => string[] };
  const list = raw.getSetCookie?.();
  if (list?.length) {
    for (const line of list) {
      const nv = line.split(";")[0]?.trim();
      if (nv?.includes("=")) jar.set(nv.split("=")[0]!, nv);
    }
    return;
  }
  const one = res.headers.get("set-cookie");
  if (one) {
    const nv = one.split(";")[0]?.trim();
    if (nv?.includes("=")) jar.set(nv.split("=")[0]!, nv);
  }
}

function cookieHeaderFromJar(jar: Map<string, string>): string {
  return [...jar.values()].join("; ");
}

/**
 * Navigate like a browser through redirects while keeping a cookie jar. `redirect: "follow"`
 * only exposes the final response — Akamai often sets cookies on 301/302 hops before the 200.
 */
async function fetchCareersHtmlWithCookies(startUrl: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  let url = startUrl;
  const navHeaders = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none" as const,
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  for (let hop = 0; hop < 12; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        ...navHeaders,
        Cookie: cookieHeaderFromJar(jar),
      },
    });
    mergeSetCookiesIntoJar(res, jar);

    if (res.status >= 200 && res.status < 300) {
      await res.arrayBuffer().catch(() => undefined);
      break;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      await res.arrayBuffer().catch(() => undefined);
      if (!loc) break;
      url = new URL(loc, url).toString();
      continue;
    }
    await res.arrayBuffer().catch(() => undefined);
    break;
  }
  return jar;
}

/**
 * Akamai on careers.loreal.com returns 403 to cold edge fetches; loading the careers HTML
 * first sets cookies so the RSS URL succeeds (same pattern as a browser).
 */
async function fetchRssXml(feedUrl: string): Promise<Response> {
  const headers = rssFetchHeaders(feedUrl);
  let res = await fetch(feedUrl, { headers });
  if (res.ok) return res;
  if (res.status !== 403) return res;

  const warmUrl = careersWarmupUrlFromFeed(feedUrl);
  if (!warmUrl) return res;

  let jar = await fetchCareersHtmlWithCookies(warmUrl);
  // Locale path often 301s to `/careers`; a second entry point ensures we pick up portal cookies.
  if (jar.size === 0) {
    try {
      const origin = new URL(feedUrl).origin;
      jar = await fetchCareersHtmlWithCookies(`${origin}/careers`);
    } catch {
      /* ignore */
    }
  }

  const cookie = cookieHeaderFromJar(jar);
  if (!cookie) return res;

  res = await fetch(feedUrl, {
    headers: {
      ...headers,
      Cookie: cookie,
    },
  });
  return res;
}

/**
 * Akamai blocks subrequests from Cloudflare Workers to careers.loreal.com (403 before any
 * Set-Cookie). Browser Rendering egress is treated like a normal client and can load the RSS.
 */
async function fetchRssTextViaBrowser(feedUrl: string, env: Env): Promise<string> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "font" || type === "media" || type === "stylesheet") {
        req.abort();
      } else {
        req.continue();
      }
    });

    let res = await page.goto(feedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!res?.ok()) {
      const origin = new URL(feedUrl).origin;
      await page.goto(`${origin}/careers`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      res = await page.goto(feedUrl, { waitUntil: "networkidle0", timeout: 45_000 });
    }
    if (!res?.ok()) {
      throw new Error(`browser RSS ${res?.status() ?? "no response"}`);
    }
    const xmlText = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return r.text();
    }, feedUrl);
    if (!xmlText.includes("<rss") && !xmlText.includes("<item>")) {
      throw new Error("browser RSS body did not look like XML");
    }
    return xmlText;
  } finally {
    await browser.close();
  }
}

/** Inner HTML of a `<div>` whose opening tag ends at `contentStart` (first char inside the div). */
function innerHtmlUntilOuterDivCloses(html: string, contentStart: number): string | null {
  let depth = 1;
  let i = contentStart;
  while (i < html.length && depth > 0) {
    if (html.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) return html.slice(contentStart, i).trim();
      i += 6;
      continue;
    }
    if (i + 4 <= html.length && html.slice(i, i + 4).toLowerCase() === "<div") {
      const after = html[i + 4];
      if (after === " " || after === ">" || after === "/" || after === "\n" || after === "\r" || after === "\t") {
        depth += 1;
        const gt = html.indexOf(">", i);
        if (gt < 0) return null;
        i = gt + 1;
        continue;
      }
    }
    i += 1;
  }
  return null;
}

const FIELD_VALUE_OPEN_RE =
  /<div[^>]*\bclass="[^"]*article__content__view__field__value[^"]*"[^>]*>/gi;

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Avature JobDetail templates expose the JD in a `field__value` under “Description & Requirements”,
 * or as the largest such block on the page. Falls back to `og:description` / meta Description.
 */
function extractAvatureDescriptionHtml(html: string): string | null {
  FIELD_VALUE_OPEN_RE.lastIndex = 0;
  const markerIdx = html.search(/Description\s*&(?:amp;|#38;)?\s*Requirements/i);
  if (markerIdx >= 0) {
    const tail = html.slice(markerIdx);
    FIELD_VALUE_OPEN_RE.lastIndex = 0;
    const m = FIELD_VALUE_OPEN_RE.exec(tail);
    if (m) {
      const afterOpen = markerIdx + m.index + m[0].length;
      const inner = innerHtmlUntilOuterDivCloses(html, afterOpen);
      if (inner && inner.length >= MIN_DESC_HTML_LEN) return inner;
    }
  }

  let best: string | null = null;
  FIELD_VALUE_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_VALUE_OPEN_RE.exec(html)) !== null) {
    const afterOpen = m.index + m[0].length;
    const inner = innerHtmlUntilOuterDivCloses(html, afterOpen);
    if (inner && inner.length >= MIN_DESC_HTML_LEN && (!best || inner.length > best.length)) best = inner;
  }
  if (best) return best;

  const og =
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]*name=["']Description["'][^>]*content=["']([^"']*)["']/i);
  const plain = og?.[1]?.trim();
  if (plain && plain.length >= 80) return `<p>${decodeBasicHtmlEntities(plain)}</p>`;

  return null;
}

async function parallelMapJobs<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function enrichJobsWithAvatureJobDetailHtml(jobs: NormalizedJob[], feedUrl: string): Promise<NormalizedJob[]> {
  const warmUrl = careersWarmupUrlFromFeed(feedUrl);
  let jar = new Map<string, string>();
  if (warmUrl) jar = await fetchCareersHtmlWithCookies(warmUrl);
  if (jar.size === 0) {
    try {
      jar = await fetchCareersHtmlWithCookies(new URL(feedUrl).origin + "/");
    } catch {
      /* keep empty */
    }
  }
  const cookie = cookieHeaderFromJar(jar);
  const referer = warmUrl ?? `${new URL(feedUrl).origin}/`;

  const detailHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: referer,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1",
  };
  if (cookie) detailHeaders.Cookie = cookie;

  return parallelMapJobs(jobs, DETAIL_CONCURRENCY, async (job) => {
    const url = job.apply_url;
    if (!url) return job;
    try {
      const res = await fetch(url, { redirect: "follow", headers: detailHeaders });
      if (!res.ok) return job;
      const html = await res.text();
      const descHtml = extractAvatureDescriptionHtml(html);
      if (descHtml && descHtml.length >= MIN_DESC_HTML_LEN) {
        return { ...job, description_raw: descHtml };
      }
    } catch {
      /* RSS snapshot only */
    }
    return job;
  });
}

function getTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;
  let content = match[1].trim();
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdataMatch) content = cdataMatch[1];
  return content || null;
}

function externalIdFromAvatureLink(link: string): string | null {
  try {
    const u = new URL(link.split("&amp;").join("&"));
    const m = u.pathname.match(/\/(\d+)\/?$/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  return null;
}

/** RSS `<description>` is often ` - {internalRef}` only — not a place string; do not geocode it. */
function isAvatureInternalRefOnlyDescription(raw: string | null | undefined): boolean {
  const s = raw?.trim() ?? "";
  if (!s) return false;
  return /^-\s*\d+\s*$/.test(s);
}

function parseItem(itemXml: string, companyName: string): NormalizedJob | null {
  const title = getTagContent(itemXml, "title");
  if (!title) return null;

  const link = getTagContent(itemXml, "link");
  if (!link) return null;

  const linkNorm = link.split("&amp;").join("&");
  const externalId = externalIdFromAvatureLink(linkNorm) ?? linkNorm;

  const description = getTagContent(itemXml, "description");
  const pubDate = getTagContent(itemXml, "pubDate");

  const refOnlyDesc = isAvatureInternalRefOnlyDescription(description);
  const location = refOnlyDesc
    ? null
    : normalizeLocation(description ?? "") ?? normalizeLocation(title);

  // RSS `<description>` is usually a job id (` - 12345`) or a location line, not pay — `parseSalary`
  // would treat any digits as dollars. Only parse when currency / explicit money markers appear.
  const d = description?.trim() ?? "";
  const salary =
    d && /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD)\b/i.test(d) ? parseSalary(description) : parseSalary("");

  let postedAt: number | null = null;
  if (pubDate) {
    const parsed = Date.parse(pubDate);
    if (!Number.isNaN(parsed)) postedAt = Math.floor(parsed / 1000);
  }

  const descTrim = description?.trim() || null;
  const descriptionRaw =
    descTrim && descTrim.length > 8 && !/^[\s-]*\d+[\s.]*$/.test(descTrim)
      ? descTrim
      : title;

  return {
    external_id: externalId,
    title: title.trim(),
    location,
    employment_type: normalizeEmploymentType(null),
    workplace_type: normalizeWorkplaceType(null, title),
    apply_url: linkNorm,
    source_url: linkNorm,
    description_raw: descriptionRaw,
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: salary.currency,
    salary_period: salary.period,
    posted_at: postedAt,
    company_name: companyName,
  };
}

export const avatureFetcher: JobSource = {
  sourceType: "avature",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const feedUrl = source.base_url.trim();
    const res = await fetchRssXml(feedUrl);

    let xmlText: string;
    if (!res.ok) {
      let hostIsLoreal = false;
      try {
        hostIsLoreal = new URL(feedUrl).hostname.includes("loreal.com");
      } catch {
        hostIsLoreal = false;
      }
      if (res.status === 403 && hostIsLoreal && env?.BROWSER) {
        xmlText = await fetchRssTextViaBrowser(feedUrl, env);
      } else {
        throw new Error(`avature: RSS ${res.status} for ${source.company_handle}`);
      }
    } else {
      xmlText = await res.text();
    }
    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || source.company_handle;

    const jobs: NormalizedJob[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xmlText)) !== null) {
      try {
        const job = parseItem(match[1], companyName);
        if (job) jobs.push(job);
      } catch {
        continue;
      }
    }

    if (jobs.length === 0) {
      throw new Error(`avature: 0 items parsed from ${source.base_url}`);
    }

    return enrichJobsWithAvatureJobDetailHtml(jobs, feedUrl);
  },
};
