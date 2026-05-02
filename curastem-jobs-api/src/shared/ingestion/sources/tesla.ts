/**
 * Tesla Careers — `tesla.com/careers/search`.
 *
 * **Discovery:** `GET` the configured search URL (same query filters as in the browser, e.g.
 * `?department=vehicle-software&site=US`). Job rows link to `/careers/search/job/{slug}-{numericId}`.
 * We collect unique numeric ids from the HTML and from an embedded `__NEXT_DATA__` script when present.
 * **Detail:** `GET /cua-api/careers/job/{id}` (same origin JSON used by the live site when you open a
 * posting). Requests use browser-like headers and a job-page `Referer`.
 *
 * **Akamai:** Plain `fetch` from many datacenter IPs returns “Access Denied”; Cloudflare Workers
 * egress may or may not pass. When HTML and API both fail, the fetcher throws a descriptive error.
 *
 * `base_url` must be a `https://www.tesla.com/careers/search/` URL (path + filters you want), e.g.
 *   https://www.tesla.com/careers/search/?site=US
 *   https://www.tesla.com/careers/search/?department=vehicle-software&site=US
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { parseJsonLenientObject } from "../../utils/jsonLenientParse.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const ORIGIN = "https://www.tesla.com";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_JOBS_PER_RUN = 2000;
const DETAIL_CONCURRENCY = 8;

const HTML_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function isAkamaiDenial(html: string): boolean {
  return html.includes("Access Denied") && html.includes("Akamai");
}

function idFromJobPath(fullPath: string): string | null {
  const p = fullPath.replace(/^careers\/search\/job\//, "").replace(/\/$/, "");
  const m = p.match(/-(\d{5,})$/);
  if (m) return m[1]!;
  if (/^\d{5,}$/.test(p)) return p;
  return null;
}

function titleGuessFromSlug(slug: string): string {
  const p = slug.replace(/^\/+/, "").replace(/\/$/, "");
  const titleSlug = p.replace(/-(\d{5,})$/, "").replace(/^\d{5,}$/, "");
  if (!titleSlug) return "Tesla job posting";
  return titleSlug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function canonicalJobUrl(slug: string): string {
  return `${ORIGIN}/careers/search/job/${slug.replace(/^\/+/, "")}`;
}

function applyUrlForId(id: string): string {
  return `${ORIGIN}/careers/search/job/apply/${encodeURIComponent(id)}`;
}

function apiHeadersForJobReferer(slug: string): Record<string, string> {
  const referer = canonicalJobUrl(slug);
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: referer,
    Origin: ORIGIN,
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

export interface TeslaJobStub {
  id: string;
  /** Path segment after `/careers/search/job/` (slug or numeric id). */
  slug: string;
}

function mergeStub(map: Map<string, TeslaJobStub>, pathOrSlug: string): void {
  let slug = pathOrSlug.replace(/^\/+/, "").replace(/\/$/, "");
  if (slug.startsWith("careers/search/job/")) {
    slug = slug.slice("careers/search/job/".length);
  }
  const id = idFromJobPath(`careers/search/job/${slug}`);
  if (!id) return;
  if (!map.has(id)) map.set(id, { id, slug });
}

/** Collect `/careers/search/job/...` paths from raw HTML / serialized JSON text. */
export function collectTeslaJobPathsFromHtml(html: string): TeslaJobStub[] {
  const map = new Map<string, TeslaJobStub>();
  const re = /\/careers\/search\/job\/([a-z0-9][a-z0-9-]*-\d{5,}|\d{5,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    mergeStub(map, m[1]!);
  }
  return [...map.values()];
}

function walkForJobPaths(val: unknown, out: Set<string>): void {
  if (val === null || val === undefined) return;
  if (typeof val === "string") {
    if (val.includes("/careers/search/job/")) {
      const re = /\/careers\/search\/job\/([a-z0-9][a-z0-9-]*-\d{5,}|\d{5,})/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(val)) !== null) out.add(m[1]!);
    }
    return;
  }
  if (Array.isArray(val)) {
    for (const x of val) walkForJobPaths(x, out);
    return;
  }
  if (typeof val === "object") {
    for (const v of Object.values(val as Record<string, unknown>)) walkForJobPaths(v, out);
  }
}

function stubsFromNextData(html: string): TeslaJobStub[] {
  const map = new Map<string, TeslaJobStub>();
  const block = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!block) return [];
  try {
    const root = JSON.parse(block[1]!) as unknown;
    const paths = new Set<string>();
    walkForJobPaths(root, paths);
    for (const slug of paths) mergeStub(map, slug);
  } catch {
    /* ignore */
  }
  return [...map.values()];
}

function stringifyLocationPiece(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const city = typeof o.city === "string" ? o.city : typeof o.locality === "string" ? o.locality : "";
  const region =
    typeof o.state === "string"
      ? o.state
      : typeof o.region === "string"
        ? o.region
        : typeof o.administrativeArea === "string"
          ? o.administrativeArea
          : "";
  const country = typeof o.country === "string" ? o.country : "";
  const parts: string[] = [];
  if (city && region) parts.push(`${city}, ${region}`);
  else if (city) parts.push(city);
  else if (region) parts.push(region);
  if (country && !parts.some((p) => p.includes(country))) parts.push(country);
  const s = parts.join(", ").trim();
  return s || null;
}

function locationFromApiPayload(o: Record<string, unknown>): string {
  if (typeof o.location === "string" && o.location.trim()) return o.location.trim();
  const loc = o.location;
  if (loc && typeof loc === "object") {
    const s = stringifyLocationPiece(loc);
    if (s) return s;
  }
  if (Array.isArray(o.locations)) {
    const parts: string[] = [];
    for (const item of o.locations) {
      if (typeof item === "string" && item.trim()) parts.push(item.trim());
      else {
        const s = stringifyLocationPiece(item);
        if (s) parts.push(s);
      }
    }
    if (parts.length > 0) return parts.join("; ");
  }
  if (typeof o.locationName === "string" && o.locationName.trim()) return o.locationName.trim();
  if (typeof o.jobLocation === "string" && o.jobLocation.trim()) return o.jobLocation.trim();
  return "United States";
}

function titleFromApiPayload(o: Record<string, unknown>): string {
  return String(
    o.title ?? o.jobTitle ?? o.name ?? o.positionTitle ?? o.roleTitle ?? ""
  ).trim();
}

function descriptionFromApiPayload(o: Record<string, unknown>): string | null {
  const candidates = [
    o.description,
    o.jobDescription,
    o.details,
    o.jobDescriptionHtml,
    o.postingDescription,
  ];
  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    const t = c.includes("<") ? htmlToText(c) : c.trim();
    if (t.length >= 40) return t;
  }
  return null;
}

function postedFromApiPayload(o: Record<string, unknown>, nowSec: number): number {
  const raw =
    o.postedDate ??
    o.postedAt ??
    o.datePosted ??
    o.createdAt ??
    o.publishDate ??
    o.openDate ??
    o.posted_on;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const sec = raw > 1e12 ? Math.floor(raw / 1000) : raw;
    if (sec > 946684800) return sec;
  }
  if (typeof raw === "string") {
    const p = parseEpochSeconds(raw);
    if (p !== null) return p;
  }
  return nowSec;
}

function remoteFromApiPayload(o: Record<string, unknown>, locStr: string): boolean {
  const w = o.workplaceType ?? o.workLocationType ?? o.remoteType;
  const s = `${typeof w === "string" ? w : ""} ${locStr}`.toLowerCase();
  return /\bremote\b|\bhybrid\b|\btelecommut/i.test(s);
}

function employmentFromApiPayload(o: Record<string, unknown>): string | null {
  const e = o.employmentType ?? o.jobType ?? o.type ?? o.timeType;
  return typeof e === "string" ? e : null;
}

/** Unwrap `{ data: { ... } }` or `{ job: { ... } }` style envelopes. */
function unwrapJobJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  let cur: unknown = raw;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const o = cur as Record<string, unknown>;
    if (typeof o.title === "string" || typeof o.jobTitle === "string" || typeof o.description === "string") {
      return o;
    }
    const next = o.data ?? o.job ?? o.result ?? o.payload ?? o.position;
    if (next && typeof next === "object") cur = next;
    else break;
  }
  return cur && typeof cur === "object" ? (cur as Record<string, unknown>) : null;
}

async function fetchJobJson(id: string, slug: string): Promise<Record<string, unknown> | null> {
  const url = `${ORIGIN}/cua-api/careers/job/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: apiHeadersForJobReferer(slug) });
  if (!res.ok) return null;
  const text = await res.text();
  if (text.startsWith("<") || isAkamaiDenial(text)) return null;
  const parsed = parseJsonLenientObject(text);
  if (!parsed) return null;
  return unwrapJobJson(parsed);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

export const teslaFetcher: JobSource = {
  sourceType: "tesla",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const listUrl = new URL(source.base_url.trim());
    if (listUrl.hostname !== "www.tesla.com" || !listUrl.pathname.includes("/careers/search")) {
      throw new Error(
        `tesla: base_url must be a www.tesla.com careers search URL (…/careers/search/…), got ${source.base_url}`
      );
    }

    const htmlRes = await fetch(listUrl.toString(), { headers: HTML_HEADERS, redirect: "follow" });
    if (!htmlRes.ok) {
      throw new Error(`tesla: search page HTTP ${htmlRes.status} for ${listUrl}`);
    }
    const html = await htmlRes.text();
    if (isAkamaiDenial(html)) {
      throw new Error(
        "tesla: Akamai blocked the search page (Access Denied). Try running ingestion from egress that passes Tesla WAF, or narrow filters."
      );
    }

    const stubMap = new Map<string, TeslaJobStub>();
    for (const s of collectTeslaJobPathsFromHtml(html)) stubMap.set(s.id, s);
    for (const s of stubsFromNextData(html)) stubMap.set(s.id, s);

    let stubs = [...stubMap.values()].slice(0, MAX_JOBS_PER_RUN);
    if (stubs.length === 0) {
      throw new Error(
        `tesla: no job links found in search HTML for ${listUrl}. The page structure may have changed.`
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const rows = await mapWithConcurrency(stubs, DETAIL_CONCURRENCY, async (stub) => {
      const payload = await fetchJobJson(stub.id, stub.slug);
      return { stub, payload } as const;
    });

    if (rows.every((r) => !r.payload)) {
      throw new Error(
        "tesla: cua-api returned no JSON for any job (Akamai/API change or blocked egress). Search HTML was readable."
      );
    }

    const out: NormalizedJob[] = [];
    for (const { stub, payload } of rows) {
      const apply = applyUrlForId(stub.id);
      const sourceUrl = canonicalJobUrl(stub.slug);

      if (payload) {
        const title = titleFromApiPayload(payload);
        if (!title) continue;
        const loc = locationFromApiPayload(payload);
        const desc = descriptionFromApiPayload(payload);
        const posted = postedFromApiPayload(payload, nowSec);
        const remote = remoteFromApiPayload(payload, loc);
        out.push({
          external_id: stub.id,
          title,
          location: normalizeLocation(loc),
          employment_type: normalizeEmploymentType(employmentFromApiPayload(payload)),
          workplace_type: remote ? "remote" : normalizeWorkplaceType(null, loc),
          apply_url: apply,
          source_url: sourceUrl,
          description_raw: desc ?? `See full description on Tesla Careers: ${sourceUrl}`,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: posted,
          company_name: "Tesla",
          company_logo_url: null,
          company_website_url: null,
        });
        continue;
      }

      out.push({
        external_id: stub.id,
        title: titleGuessFromSlug(stub.slug),
        location: normalizeLocation("United States"),
        employment_type: null,
        workplace_type: normalizeWorkplaceType(null, null),
        apply_url: apply,
        source_url: sourceUrl,
        description_raw: `See Tesla Careers for full description: ${sourceUrl}`,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: nowSec,
        company_name: "Tesla",
        company_logo_url: null,
        company_website_url: null,
      });
    }

    return out;
  },
};
