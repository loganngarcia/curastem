/**
 * Gusto Recruiting public job boards (`jobs.gusto.com/postings/...`).
 *
 * These boards are Next.js SSR with `__NEXT_DATA__` on first paint and often
 * `application/ld+json` JobPosting on job pages. The host is behind Cloudflare;
 * plain `fetch` often receives a challenge page. We fall back to a public
 * HTTP mirror (`r.jina.ai` with `X-Return-Format: html`) so ingestion works
 * without the Browser binding; Puppeteer remains an optional last resort.
 *
 * `base_url` may be:
 * - `https://jobs.gusto.com/boards/{slug}-{orgUuid}` — preferred when the
 *   employer lists multiple roles (all `/postings/...` links are collected), or
 * - any `https://jobs.gusto.com/postings/{slug}` URL (sibling postings are
 *   discovered from page HTML / JSON when present).
 *
 * Caps at 60 posting pages per run.
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const ORIGIN = "https://jobs.gusto.com";
/** Public mirror that bypasses Cloudflare browser challenges for `jobs.gusto.com`. */
const JINA_HTML_MIRROR = "https://r.jina.ai/http://";
const MAX_POSTING_PAGES = 60;
const FETCH_CONCURRENCY = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBaseUrl(input: string): URL {
  const u = new URL(input.trim());
  if (u.hostname !== "jobs.gusto.com") {
    throw new Error(`gusto_recruiting base_url must be on jobs.gusto.com, got ${input}`);
  }
  const path = u.pathname.replace(/\/$/, "") || "/";
  const okPosting = path.startsWith("/postings/") && path.length > "/postings/x".length;
  const okBoard = path.startsWith("/boards/") && path.length > "/boards/x".length;
  if (!okPosting && !okBoard) {
    throw new Error(
      `gusto_recruiting base_url must be a /postings/{slug} or /boards/{slug} URL. Got ${input}`
    );
  }
  return u;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function isCfChallenge(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("__cf_chl_opt") ||
    html.includes("cf-browser-verification") ||
    html.includes("Enable JavaScript and cookies")
  );
}

function extractNextDataJson(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function isJobPostingNode(n: unknown): n is Record<string, unknown> {
  if (!n || typeof n !== "object") return false;
  const o = n as Record<string, unknown>;
  const t = o["@type"];
  const types = (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x));
  return types.some((x) => x === "JobPosting" || x.endsWith("/JobPosting"));
}

function flattenJsonLdNodes(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.flatMap(flattenJsonLdNodes);
  if (typeof raw !== "object") return [raw];
  const o = raw as Record<string, unknown>;
  if ("@graph" in o && Array.isArray(o["@graph"])) {
    return o["@graph"].flatMap(flattenJsonLdNodes);
  }
  return [raw];
}

function extractJsonLdJobPosting(html: string): Record<string, unknown> | null {
  const typed = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = typed.exec(html)) !== null) {
    const parsed = tryParseJobPostingJson(m[1]);
    if (parsed) return parsed;
  }
  // Some stacks omit `type=` or use `application/json` for the same payload.
  const loose = /<script[^>]*>(\s*\{[\s\S]*?"@type"\s*:\s*"[^"]*JobPosting[\s\S]*?\})\s*<\/script>/gi;
  while ((m = loose.exec(html)) !== null) {
    const parsed = tryParseJobPostingJson(m[1]);
    if (parsed) return parsed;
  }
  return null;
}

function tryParseJobPostingJson(jsonText: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(jsonText) as unknown;
    for (const n of flattenJsonLdNodes(raw)) {
      if (isJobPostingNode(n)) return n as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/** schema.org JobPosting fields are often `string | { "@type": "...", text/value/@value" }`. */
function ldTextField(ld: Record<string, unknown>, key: string): string | null {
  const v = ld[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0].trim();
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.value === "string") return o.value.trim();
    if (typeof o["@value"] === "string") return o["@value"].trim();
  }
  return null;
}

/** Collect `/postings/...` URLs embedded in HTML (NEXT_DATA + anchors). */
function extractPostingUrls(html: string): string[] {
  const seen = new Set<string>();
  const addAbs = (href: string) => {
    try {
      const u = new URL(href, ORIGIN);
      if (u.hostname === "jobs.gusto.com" && u.pathname.startsWith("/postings/")) {
        seen.add(u.origin + u.pathname.replace(/\/$/, ""));
      }
    } catch {
      /* ignore */
    }
  };
  for (const m of html.matchAll(/https:\/\/jobs\.gusto\.com\/postings\/[a-z0-9-]+/gi)) {
    addAbs(m[0]);
  }
  for (const m of html.matchAll(/"\/postings\/([^"]+)"/g)) {
    addAbs("/postings/" + m[1]);
  }
  for (const m of html.matchAll(/href="(\/postings\/[^"]+)"/gi)) {
    addAbs(m[1]);
  }
  return [...seen];
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function nestedString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : null;
}

/** Prefer explicit fields; then any long string value that looks like HTML body copy. */
function longestEmbeddedHtmlString(val: unknown, depth: number, best: { len: number; s: string }): void {
  if (depth > 42) return;
  if (typeof val === "string") {
    const t = val.trim();
    if (t.length > best.len && t.length >= 120 && (t.includes("<p") || t.includes("<ul") || t.includes("<h2"))) {
      best.len = t.length;
      best.s = val;
    }
    return;
  }
  if (!val || typeof val !== "object") return;
  if (Array.isArray(val)) {
    for (const x of val) longestEmbeddedHtmlString(x, depth + 1, best);
    return;
  }
  for (const k of Object.keys(val as object)) {
    longestEmbeddedHtmlString((val as Record<string, unknown>)[k], depth + 1, best);
  }
}

function pickDescription(o: Record<string, unknown>): string | null {
  const html =
    pickString(
      o.descriptionHtml,
      o.jobDescriptionHtml,
      o.description_html,
      o.richDescription,
      o.bodyHtml,
      o.contentHtml,
      o.detailsHtml
    ) ?? null;
  if (html) return html;
  const plain = pickString(o.description, o.jobDescription, o.summary, o.roleDescription);
  if (plain) return plain;
  const best = { len: 0, s: "" };
  longestEmbeddedHtmlString(o, 0, best);
  return best.s || null;
}

/**
 * Depth-first search for objects that look like a Gusto job posting (uuid id + title).
 */
function collectPostingLikeObjects(val: unknown, depth: number, out: Record<string, unknown>[]): void {
  if (depth > 40) return;
  if (!val || typeof val !== "object") return;
  if (Array.isArray(val)) {
    for (const x of val) collectPostingLikeObjects(x, depth + 1, out);
    return;
  }
  const o = val as Record<string, unknown>;
  const idRaw = o.id ?? o.uuid ?? o.postingId ?? o.jobPostingId;
  const title = pickString(o.title, o.name, o.jobTitle, o.positionTitle);
  const id = typeof idRaw === "string" ? idRaw : null;
  if (id && UUID_RE.test(id) && title && title.length > 2) {
    out.push(o);
  }
  for (const k of Object.keys(o)) {
    collectPostingLikeObjects(o[k], depth + 1, out);
  }
}

function uuidFromPostingUrl(pageUrl: string): string | null {
  const m = pageUrl.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i
  );
  return m ? m[1] : null;
}

/** Title from `<title>` (strip common site suffixes). */
function extractTitleFromHtml(html: string): string | null {
  const m = html.match(/<title>([^<]{4,280})<\/title>/i);
  if (!m) return null;
  return m[1]
    .replace(/\s*\|\s*Gusto.*$/i, "")
    .replace(/\s+-\s*jobs\.gusto\.com.*$/i, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** When JSON-LD / __NEXT_DATA__ are missing (App Router shells), strip tags for substantive plain text. */
function extractReadableTextFromHtml(html: string): string | null {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const chunk = (main ? main[1] : html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = chunk
    .replace(/<[^>]+>/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 180) return null;
  return text.slice(0, 100_000);
}

function mergePostingRecords(records: Record<string, unknown>[]): Record<string, unknown> | null {
  if (records.length === 0) return null;
  const scored = records.map((r) => {
    const desc = pickDescription(r) ?? "";
    let score = desc.length;
    if (pickString(r.companyName, nestedString(r, "company", "name"))) score += 50;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

function postingObjectToNormalized(
  o: Record<string, unknown>,
  pageUrl: string,
  ld: Record<string, unknown> | null,
  sourceNameHint: string
): NormalizedJob | null {
  const idRaw = o.id ?? o.uuid ?? o.postingId;
  const id =
    (typeof idRaw === "string" && UUID_RE.test(idRaw) ? idRaw : null) ?? uuidFromPostingUrl(pageUrl);
  const title = pickString(o.title, o.name, o.jobTitle);
  if (!id || !title) return null;

  let description =
    pickDescription(o) ??
    (ld?.description && typeof ld.description === "string" ? ld.description : null);
  if (!description && ld?.description) {
    const d = ld.description as unknown;
    if (typeof d === "object" && d && "@value" in (d as object)) {
      const v = (d as { "@value"?: unknown })["@value"];
      if (typeof v === "string") description = v;
    }
  }

  const companyName =
    pickString(
      o.companyName,
      nestedString(o, "company", "name"),
      o.employerName,
      nestedString(o, "organization", "name"),
      nestedString(o, "hiringOrganization", "name"),
      ld?.hiringOrganization &&
        typeof ld.hiringOrganization === "object" &&
        (ld.hiringOrganization as { name?: string }).name
    ) ?? sourceNameHint;

  const locRaw =
    pickString(
      o.locationName,
      nestedString(o, "location", "name"),
      nestedString(o, "primaryLocation", "name"),
      nestedString(o, "jobLocation", "displayName"),
      typeof o.jobLocation === "string" ? o.jobLocation : null
    ) ??
    (() => {
      const jl = ld?.jobLocation;
      if (jl && typeof jl === "object") {
        const addr = (jl as { address?: unknown }).address;
        if (addr && typeof addr === "object") {
          const a = addr as Record<string, unknown>;
          return pickString(
            a.addressLocality as string,
            [a.addressLocality, a.addressRegion].filter(Boolean).join(", ")
          );
        }
        if (typeof (jl as { name?: string }).name === "string") {
          return (jl as { name: string }).name;
        }
      }
      return null;
    })();

  const employmentType = pickString(o.employmentType, o.employmentTypeLabel, o.positionType) ??
    (typeof ld?.employmentType === "string" ? ld.employmentType : null);

  const applyPath = pickString(o.applyPath, o.publicApplyPath) ?? "";
  const slug = pickString(o.slug, o.publicSlug, o.urlSlug, o.fullSlug);
  let applyUrl = pickString(o.applyUrl, o.applicationUrl, o.url, o.canonicalUrl);
  if (!applyUrl && slug) applyUrl = `${ORIGIN}/postings/${slug}`;
  if (!applyUrl) applyUrl = pageUrl.split("?")[0];
  if (applyPath && applyPath.startsWith("/")) {
    applyUrl = `${ORIGIN}${applyPath}`;
  }

  const remoteFlag = Boolean(o.isRemote ?? o.remoteOk ?? o.workplaceType === "REMOTE");
  const workplace = normalizeWorkplaceType(remoteFlag ? "remote" : null, locRaw ?? "");

  const postedRaw = pickString(o.publishedAt, o.postedAt, o.createdAt, o.openedAt, ld?.datePosted as string);
  const postedAt = postedRaw ? parseEpochSeconds(postedRaw) : null;

  return {
    external_id: id,
    title,
    location: locRaw ? normalizeLocation(locRaw) : null,
    employment_type: normalizeEmploymentType(employmentType),
    workplace_type: workplace,
    apply_url: applyUrl,
    source_url: pageUrl.split("?")[0],
    description_raw: description,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: postedAt,
    company_name: companyName,
  };
}

function htmlToJob(
  html: string,
  pageUrl: string,
  sourceNameHint: string
): NormalizedJob | null {
  const pageUuid = uuidFromPostingUrl(pageUrl);
  const ldFirst = extractJsonLdJobPosting(html);
  if (ldFirst && pageUuid) {
    const t = ldTextField(ldFirst, "title");
    const d = ldTextField(ldFirst, "description");
    if (t && d?.trim()) {
      const row = postingObjectToNormalized(
        { id: pageUuid, title: t, description: d },
        pageUrl,
        ldFirst,
        sourceNameHint
      );
      if (row?.description_raw?.trim()) return row;
    }
  }

  const next = extractNextDataJson(html);
  const ld = ldFirst ?? extractJsonLdJobPosting(html);
  const candidates: Record<string, unknown>[] = [];
  if (next) collectPostingLikeObjects(next, 0, candidates);
  const merged = mergePostingRecords(candidates);
  if (merged) {
    const row = postingObjectToNormalized(merged, pageUrl, ld, sourceNameHint);
    if (row?.description_raw?.trim()) return row;
    if (row) {
      const fromLd = ld?.description;
      if (typeof fromLd === "string" && fromLd.trim()) {
        return { ...row, description_raw: fromLd };
      }
      if (next) {
        const best = { len: 0, s: "" };
        longestEmbeddedHtmlString(next, 0, best);
        if (best.s.trim()) return { ...row, description_raw: best.s };
      }
    }
  }
  if (ld) {
    const synthetic: Record<string, unknown> = {
      title: ldTextField(ld, "title") ?? ld.title,
      description: ldTextField(ld, "description") ?? ld.description,
    };
    const id = typeof ld.identifier === "string" ? ld.identifier : null;
    if (id && UUID_RE.test(id)) synthetic.id = id;
    else {
      const m = pageUrl.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      );
      if (m) synthetic.id = m[0];
    }
    const o = mergePostingRecords([synthetic, ...(merged ? [merged] : [])]);
    if (o) {
      const row = postingObjectToNormalized(o, pageUrl, ld, sourceNameHint);
      if (row?.description_raw?.trim()) return row;
    }
  }
  // Last resort: UUID from URL + `<title>` + longest HTML blob in __NEXT_DATA__ (Gusto nests copy deeply).
  const titleGuess = extractTitleFromHtml(html);
  if (pageUuid && titleGuess && next) {
    const best = { len: 0, s: "" };
    longestEmbeddedHtmlString(next, 0, best);
    if (best.s.trim().length > 80) {
      const row = postingObjectToNormalized(
        { id: pageUuid, title: titleGuess, description: best.s },
        pageUrl,
        ld,
        sourceNameHint
      );
      if (row) return row;
    }
  }
  const readable = extractReadableTextFromHtml(html);
  if (pageUuid && titleGuess && readable?.trim()) {
    const row = postingObjectToNormalized(
      { id: pageUuid, title: titleGuess, description: readable },
      pageUrl,
      ld,
      sourceNameHint
    );
    if (row) return row;
  }
  return null;
}

/** True when `htmlToJob` can produce a row with description (or JSON payloads are present). */
function postingHtmlLooksComplete(html: string, pageUrl: string, companyHint: string): boolean {
  if (isCfChallenge(html)) return false;
  if (extractJsonLdJobPosting(html) || html.includes("__NEXT_DATA__")) return true;
  const job = htmlToJob(html, pageUrl, companyHint);
  return Boolean(job?.description_raw?.trim());
}

/** Fetches the same URL through r.jina.ai so Workers receive real HTML instead of a CF challenge. */
async function fetchHtmlViaMirror(originalUrl: string): Promise<string | null> {
  try {
    const u = new URL(originalUrl);
    const mirrorUrl = `${JINA_HTML_MIRROR}${u.host}${u.pathname}${u.search}`;
    const res = await fetch(mirrorUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "X-Return-Format": "html",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function loadHtmlWithBrowser(url: string, env: Env): Promise<string | null> {
  if (!env.BROWSER) return null;
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "image" || t === "font" || t === "media" || t === "stylesheet") req.abort();
      else req.continue();
    });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 55000 });
    // App Router may omit classic __NEXT_DATA__; wait for visible job copy to hydrate.
    await page
      .waitForFunction(
        "document.body && document.body.innerText && document.body.innerText.trim().length > 400",
        { timeout: 35000 }
      )
      .catch(() => null);
    return await page.content();
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

async function loadPostingHtml(url: string, env: Env | undefined, companyHint: string): Promise<string | null> {
  let html = await fetchText(url);
  if (html && postingHtmlLooksComplete(html, url, companyHint)) {
    return html;
  }

  const mirrored = await fetchHtmlViaMirror(url);
  if (mirrored && postingHtmlLooksComplete(mirrored, url, companyHint)) {
    return mirrored;
  }

  if (env?.BROWSER) {
    const viaBrowser = await loadHtmlWithBrowser(url, env);
    if (viaBrowser && postingHtmlLooksComplete(viaBrowser, url, companyHint)) {
      return viaBrowser;
    }
    if (viaBrowser?.includes("__NEXT_DATA__") || extractJsonLdJobPosting(viaBrowser ?? "")) {
      return viaBrowser;
    }
    if (viaBrowser) return viaBrowser;
  }

  if (html && !isCfChallenge(html)) return html;
  if (mirrored && !isCfChallenge(mirrored)) return mirrored;
  return null;
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const gustoRecruitingFetcher: JobSource = {
  sourceType: "gusto_recruiting",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const base = parseBaseUrl(source.base_url);
    const basePageUrl = base.origin + base.pathname.replace(/\/$/, "");
    const isBoard = base.pathname.startsWith("/boards/");
    const shortName = source.name.replace(/\s*\(Gusto Recruiting\)\s*/i, "").trim() || source.company_handle;

    const firstHtml = await loadPostingHtml(basePageUrl, env, shortName);
    if (!firstHtml) {
      throw new Error(`gusto_recruiting: failed to load HTML for ${basePageUrl}`);
    }

    const urls = new Set<string>(extractPostingUrls(firstHtml));
    if (!isBoard) {
      urls.add(basePageUrl);
    }
    const urlList = [...urls].slice(0, MAX_POSTING_PAGES);
    if (urlList.length === 0) {
      throw new Error(
        `gusto_recruiting: no /postings/... links found from ${basePageUrl} (${source.company_handle})`
      );
    }

    const pages = await parallelMap(urlList, FETCH_CONCURRENCY, async (u) => {
      const h = u === basePageUrl ? firstHtml : await loadPostingHtml(u, env, shortName);
      return { u, h };
    });

    const jobs: NormalizedJob[] = [];
    const seenIds = new Set<string>();

    for (const { u, h } of pages) {
      if (!h) continue;
      const job = htmlToJob(h, u, shortName);
      if (!job?.apply_url) continue;
      if (!job.description_raw?.trim()) continue;
      if (seenIds.has(job.external_id)) continue;
      seenIds.add(job.external_id);
      jobs.push(job);
    }

    if (jobs.length === 0) {
      throw new Error(
        `gusto_recruiting: no jobs with descriptions parsed from ${urlList.length} page(s) (${source.company_handle}).`
      );
    }

    return jobs;
  },
};
