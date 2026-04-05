/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Workday public job board fetcher.
 *
 * Workday is used heavily by large enterprises, healthcare companies,
 * retailers, and non-tech employers — which aligns directly with Curastem's
 * mission of covering jobs beyond the tech sector.
 *
 * Workday does not have a single unified public API. Each company hosts its
 * own Workday tenant at a URL like:
 *   https://{company}.wd5.myworkdayjobs.com/{tenant}/jobs
 *
 * However, Workday job boards expose a public REST-like JSON API used by
 * their own frontend at:
 *   https://{company}.wd5.myworkdayjobs.com/wday/cxs/{company}/{tenant}/jobs
 *
 * This fetcher uses that internal API endpoint, which is public and requires
 * no authentication. It uses a POST request with filter/pagination parameters.
 *
 * IMPORTANT: This is an undocumented public endpoint. It is used by the
 * Workday job board UI itself, which means it is available as long as the
 * job board is publicly visible. However, it may change without notice.
 * The source registry entry's base_url encodes the full CXS endpoint.
 *
 * Example base_url for a source:
 *   https://walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternalCareers/jobs
 *
 * ── Cookie preflight ──────────────────────────────────────────────────────
 * Workday tenants sit behind Cloudflare's bot protection. A valid
 * PLAY_SESSION cookie (and sometimes wd-browser-id) is required. We perform
 * a lightweight GET of the job board HTML page first, collect all Set-Cookie
 * headers, and attach them to every subsequent request for that source.
 *
 * ── Two-phase ingestion ───────────────────────────────────────────────────
 * Large Workday tenants (Petco 2 k, Morgan Stanley 1.5 k at 1.3 s/page)
 * would exhaust the 90 s Worker timeout if list pagination and per-job HTML
 * fetches were interleaved in a single loop. We split the work:
 *
 *   Phase 1 — collect stubs: paginate the CXS list API, building an array of
 *             job stubs with no per-job network calls. Capped at MAX_TOTAL_JOBS
 *             so even slow tenants finish Phase 1 within ~45 s.
 *
 *   Phase 2 — enrich descriptions: batch-fetch the canonical HTML detail page
 *             for the first MAX_DETAIL_JOBS stubs using DETAIL_FETCH_CONCURRENCY
 *             parallel requests. Each page embeds schema.org JobPosting JSON-LD
 *             with a full `description`. Stubs beyond the cap get
 *             description_raw = null (AI enrichment fills them in later).
 *
 * ── postedOn format ───────────────────────────────────────────────────────
 * The API returns relative strings ("Posted Today", "Posted 3 Days Ago",
 * "Posted 30+ Days Ago") rather than ISO dates. We convert these to epoch
 * seconds at ingest time using the current date as the reference point.
 * Jobs older than 30 days are stored as (now - 30 days) as a conservative
 * lower bound.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

interface WorkdayJobListing {
  title: string;                          // plain string in current API
  externalPath: string;
  timeType?: string | null;               // "Full time" | "Part time" | null
  locationsText?: string | null;
  postedOn?: string | null;               // "Posted Today" | "Posted N Days Ago" | "Posted 30+ Days Ago"
  bulletFields?: string[];
  id?: string | null;
  jobPostingURL?: string | null;
}

interface WorkdayJobsResponse {
  total?: number;
  jobPostings?: WorkdayJobListing[];
}

// Workday tenants enforce a hard limit of 20 results per page; requesting more returns HTTP 400.
const PAGE_SIZE = 20;

/** Parallel detail-page GETs per batch in Phase 2. */
const DETAIL_FETCH_CONCURRENCY = 16;

/**
 * Maximum job stubs collected from the list API (Phase 1).
 * Slow tenants run at ~1.3 s/page; 100 pages × 1.3 s = 130 s, safely inside the
 * 150 s Workday timeout. This covers mid-size tenants (e.g. Salesforce ~1442) in one
 * run; very large tenants (CVS 8k+) pick up the 2000 most-recent jobs per cron cycle.
 */
const MAX_TOTAL_JOBS = 2000;

/**
 * Maximum per-job HTML detail fetches in Phase 2.
 * ceil(400 / 16) × ~0.6 s ≈ 15 s. Jobs beyond this cap get
 * description_raw = null for AI enrichment to fill in later.
 */
const MAX_DETAIL_JOBS = 400;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────────────────────
// Cookie preflight
//
// GET the job board HTML page to obtain a PLAY_SESSION cookie. Without it,
// Workday's Cloudflare WAF returns 400 for requests from datacenter IPs.
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic pseudo-UUID v4 derived from the tenant origin (no crypto dependency). */
function pseudoUuid(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i);
  const hex = (Math.abs(h) >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0,4)}-4${hex.slice(1,4)}-a${hex.slice(2,5)}-${hex}${hex.slice(0,4)}`;
}

async function fetchSessionCookie(origin: string, tenant: string): Promise<string> {
  // Try /{tenant} first (shorter, works on all Workday instances); fall back
  // to /en-US/{tenant} which some tenants redirect to.
  const pageUrl = `${origin}/${tenant}`;
  const res = await fetch(pageUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  });
  // Collect ALL Set-Cookie headers (PLAY_SESSION + wd-browser-id).
  // `get("set-cookie")` only returns the first; some tenants (Nordstrom, BofA)
  // require both cookies for the WAF to accept subsequent requests.
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const lines =
    typeof h.getSetCookie === "function"
      ? h.getSetCookie()
      : (() => {
          const single = res.headers.get("set-cookie");
          return single ? [single] : [];
        })();
  const cookies = lines
    .map((line) => line.trim().split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // Some WAF-protected tenants (amat, micron, northrop, rtx, salesforce, itw) block the CXS
  // POST unless wd-browser-id is present. Inject a stable synthetic value when missing.
  if (!cookies.includes("wd-browser-id")) {
    const browserId = pseudoUuid(origin);
    return cookies ? `${cookies}; wd-browser-id=${browserId}` : `wd-browser-id=${browserId}`;
  }
  return cookies;
}

// ─────────────────────────────────────────────────────────────────────────────
// postedOn parser
//
// Converts Workday's relative date strings to epoch seconds.
// "Posted Today"          → now
// "Posted Yesterday"      → now - 1 day
// "Posted N Days Ago"     → now - N days
// "Posted 30+ Days Ago"   → now - 30 days (conservative lower bound)
// Anything else / null    → null (unknown)
// ─────────────────────────────────────────────────────────────────────────────

function parseWorkdayPostedOn(raw: string | null | undefined, nowSec: number): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === "posted today") return nowSec;
  if (lower === "posted yesterday") return nowSec - 86400;
  const daysAgoMatch = lower.match(/posted\s+(\d+)\+?\s+days?\s+ago/);
  if (daysAgoMatch) return nowSec - parseInt(daysAgoMatch[1], 10) * 86400;
  return null;
}

/** Recursively find schema.org JobPosting `description` (handles `@graph` arrays). */
function findJobPostingDescriptionLd(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const t = o["@type"];
  if (t === "JobPosting" && typeof o.description === "string") {
    const d = o.description.trim();
    return d || null;
  }
  if (Array.isArray(o["@graph"])) {
    for (const node of o["@graph"]) {
      const d = findJobPostingDescriptionLd(node);
      if (d) return d;
    }
  }
  return null;
}

/** Extract `description` from the first `application/ld+json` JobPosting block. */
export function extractSchemaJobPostingDescription(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim()) as unknown;
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const d = findJobPostingDescriptionLd(item);
        if (d) return d;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchWorkdayJobDescriptionFromDetailPage(
  applyUrl: string,
  cookieHeader: string,
  origin: string,
  tenant: string
): Promise<string | null> {
  const res = await fetch(applyUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US",
      Cookie: cookieHeader,
      Referer: `${origin}/en-US/${tenant}`,
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  return extractSchemaJobPostingDescription(html);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────────────────────

export const workdayFetcher: JobSource = {
  sourceType: "workday",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const url = new URL(source.base_url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // pathname: /wday/cxs/{company}/{tenant}/jobs
    const tenant = pathParts[pathParts.length - 2] ?? "jobs";
    const origin = url.origin;

    const cookieHeader = await fetchSessionCookie(origin, tenant);

    const listHeaders: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": origin,
      "Referer": `${origin}/en-US/${tenant}`,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };
    if (cookieHeader) listHeaders["Cookie"] = cookieHeader;

    const nowSec = Math.floor(Date.now() / 1000);

    // ── Phase 1: collect stubs (list API only, no per-job fetches) ────────────
    type Stub = {
      posting: WorkdayJobListing;
      titleText: string;
      locationRaw: string | null;
      applyUrl: string;
      externalId: string;
    };
    const stubs: Stub[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total && stubs.length < MAX_TOTAL_JOBS) {
      const res = await fetch(source.base_url, {
        method: "POST",
        headers: listHeaders,
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: "" }),
      });

      if (!res.ok) {
        throw new Error(`Workday list API ${res.status} for ${source.company_handle}`);
      }

      // Guard against truncated responses (SyntaxError: Unexpected end of JSON input).
      let data: WorkdayJobsResponse;
      try {
        data = (await res.json()) as WorkdayJobsResponse;
      } catch {
        // Retry once — large tenants (Home Depot, Kohl's) occasionally return partial bodies.
        const retry = await fetch(source.base_url, {
          method: "POST",
          headers: listHeaders,
          body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: "" }),
        });
        if (!retry.ok) break;
        try { data = (await retry.json()) as WorkdayJobsResponse; } catch { break; }
      }
      const batch = data.jobPostings ?? [];
      if (batch.length === 0) break;

      // `total` is unreliable on pages after the first (some tenants return 0).
      if (typeof data.total === "number") {
        if (data.total > 0) total = data.total;
        else if (offset === 0) total = 0;
      } else if (offset === 0) {
        total = Infinity;
      }

      for (const posting of batch) {
        try {
          const titleText = typeof posting.title === "string" ? posting.title.trim() : "";
          if (!titleText) continue;

          const locationRaw = posting.locationsText ?? null;

          // externalPath is relative (/job/Location/Title_ID); it needs the /en-US/{tenant}
          // prefix — omitting it redirects to the Workday maintenance page.
          const applyUrl = posting.jobPostingURL?.startsWith("http")
            ? posting.jobPostingURL
            : `${origin}/en-US/${tenant}${posting.externalPath ?? ""}`;

          // id is null on most modern tenants; externalPath is the stable unique key.
          const externalId = (posting.id ?? posting.externalPath ?? titleText) as string;

          stubs.push({ posting, titleText, locationRaw, applyUrl, externalId });
        } catch {
          continue;
        }
      }

      if (batch.length < PAGE_SIZE) break;
      offset += batch.length;
    }

    // ── Phase 2: enrich descriptions (capped batch of detail page GETs) ──────
    // The CXS list response has no job body text; `bulletFields` is a bare req ID.
    // Each canonical detail page embeds schema.org JobPosting JSON-LD with the
    // full description. We cap detail fetches so Phase 2 stays well under 45 s.
    const toEnrich = stubs.slice(0, MAX_DETAIL_JOBS);
    const descriptions = await mapWithConcurrency(
      toEnrich,
      DETAIL_FETCH_CONCURRENCY,
      (s) => fetchWorkdayJobDescriptionFromDetailPage(s.applyUrl, cookieHeader, origin, tenant)
    );

    // ── Build normalised job list ──────────────────────────────────────────────
    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < stubs.length; i++) {
      const { posting, titleText, locationRaw, applyUrl, externalId } = stubs[i];
      try {
        const descriptionFromLd = i < MAX_DETAIL_JOBS ? descriptions[i] : null;
        const fallbackBullets = posting.bulletFields?.join("\n").trim() || null;
        // Prefer JSON-LD body. bulletFields is usually a bare req ID (no spaces).
        const descriptionRaw =
          descriptionFromLd ??
          (fallbackBullets && /\s/.test(fallbackBullets) ? fallbackBullets : null);

        jobs.push({
          external_id: String(externalId),
          title: titleText,
          location: normalizeLocation(locationRaw),
          employment_type: normalizeEmploymentType(posting.timeType ?? null),
          workplace_type: normalizeWorkplaceType(null, locationRaw),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: descriptionRaw,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseWorkdayPostedOn(posting.postedOn, nowSec),
          company_name: source.name.replace(/\s*\(Workday\)\s*/i, "").trim(),
          company_logo_url: null,
          company_website_url: null,
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
