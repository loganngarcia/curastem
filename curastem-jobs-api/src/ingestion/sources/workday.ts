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
 * Workday tenants sit behind Cloudflare's bot protection. Requests from
 * Cloudflare Workers' datacenter IPs are blocked with HTTP 400 unless a
 * valid PLAY_SESSION cookie is present. We perform a lightweight GET of the
 * job board HTML page first, extract the session cookie from Set-Cookie, and
 * attach it to all subsequent POST requests for that source.
 *
 * ── postedOn format ───────────────────────────────────────────────────────
 * The API returns relative strings ("Posted Today", "Posted 3 Days Ago",
 * "Posted 30+ Days Ago") rather than ISO dates. We convert these to epoch
 * seconds at ingest time using the current date as the reference point.
 * Jobs older than 30 days are stored as (now - 30 days) as a conservative
 * lower bound.
 *
 * ── Full job description ─────────────────────────────────────────────────
 * The CXS list response does not include posting body text; `bulletFields` is
 * often just a requisition id. Each public job detail page embeds schema.org
 * `JobPosting` JSON-LD with a full `description` (HTML or plain). We GET the
 * canonical job URL (same cookie session as the API) and parse that block.
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
// Safety cap: prevents runaway pagination on very large employers (e.g. Walmart, Target).
const MAX_OFFSET = 5000;

/** Parallel GETs for job detail pages (JSON-LD extraction). */
const DETAIL_FETCH_CONCURRENCY = 8;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────────────────────
// Cookie preflight
//
// GET the job board HTML page to obtain a PLAY_SESSION cookie. Without it,
// Workday's Cloudflare WAF returns 400 for requests from datacenter IPs.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSessionCookie(origin: string, tenant: string): Promise<string> {
  const pageUrl = `${origin}/en-US/${tenant}`;
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US",
    },
  });
  // Workday sends multiple Set-Cookie headers (PLAY_SESSION, CF, etc.). `get("set-cookie")`
  // only returns the first; missing cookies breaks WAF/session for some tenants.
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const lines =
    typeof h.getSetCookie === "function"
      ? h.getSetCookie()
      : (() => {
          const single = res.headers.get("set-cookie");
          return single ? [single] : [];
        })();
  return lines
    .map((line) => line.trim().split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
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
function extractSchemaJobPostingDescription(html: string): string | null {
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

    // Preflight: get session cookie so Workday's WAF accepts our datacenter IP
    const cookieHeader = await fetchSessionCookie(origin, tenant);

    const commonHeaders: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Language": "en-US",
      "Origin": origin,
      "Referer": `${origin}/en-US/${tenant}`,
    };
    if (cookieHeader) commonHeaders["Cookie"] = cookieHeader;

    const jobs: NormalizedJob[] = [];
    let offset = 0;
    let total = Infinity;
    const nowSec = Math.floor(Date.now() / 1000);

    while (offset < total && offset < MAX_OFFSET) {
      const res = await fetch(source.base_url, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: "" }),
      });

      if (!res.ok) {
        throw new Error(`Workday API error ${res.status} for ${source.company_handle}`);
      }

      const data = (await res.json()) as WorkdayJobsResponse;
      const batch = data.jobPostings ?? [];
      if (batch.length === 0) break;

      // `total` is sometimes wrong on pages after the first (0 or omitted) even when more jobs exist.
      if (typeof data.total === "number") {
        if (data.total > 0) total = data.total;
        else if (offset === 0) total = 0;
        // else: keep prior `total` (e.g. Petco page 2+ returns total: 0)
      } else if (offset === 0) {
        total = Infinity;
      }

      type Pending = {
        posting: WorkdayJobListing;
        titleText: string;
        locationRaw: string | null;
        applyUrl: string;
        externalId: string;
      };
      const pending: Pending[] = [];

      for (const posting of batch) {
        try {
          const titleText = typeof posting.title === "string" ? posting.title.trim() : "";
          if (!titleText) continue;

          const locationRaw = posting.locationsText ?? null;

          // Use jobPostingURL when present and absolute; otherwise build from externalPath.
          // externalPath is relative (e.g. /job/Location/Title_ID) and requires the
          // /en-US/{tenant} prefix — without it Workday redirects to the maintenance page.
          const applyUrl = posting.jobPostingURL?.startsWith("http")
            ? posting.jobPostingURL
            : `${origin}/en-US/${tenant}${posting.externalPath ?? ""}`;

          // id is null on most modern tenants; externalPath is the stable unique key
          const externalId = (posting.id ?? posting.externalPath ?? titleText) as string;

          pending.push({ posting, titleText, locationRaw, applyUrl, externalId });
        } catch {
          continue;
        }
      }

      const descriptions = await mapWithConcurrency(pending, DETAIL_FETCH_CONCURRENCY, (p) =>
        fetchWorkdayJobDescriptionFromDetailPage(p.applyUrl, cookieHeader, origin, tenant)
      );

      for (let i = 0; i < pending.length; i++) {
        const { posting, titleText, locationRaw, applyUrl, externalId } = pending[i];
        try {
          const descriptionFromLd = descriptions[i];
          const fallbackBullets = posting.bulletFields?.join("\n").trim() || null;
          // Prefer JSON-LD body. List `bulletFields` is often a bare requisition id (no spaces);
          // only use bullets as a fallback when they look like real teaser copy.
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
          });
        } catch {
          continue;
        }
      }

      offset += PAGE_SIZE;
    }

    return jobs;
  },
};
