/**
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
  // Extract just the name=value part of every Set-Cookie header
  const raw = res.headers.get("set-cookie") ?? "";
  return raw
    .split(",")
    .map((c) => c.trim().split(";")[0].trim())
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
      // total is sometimes missing on paginated responses — treat as done
      if (typeof data.total === "number") total = data.total;
      else total = offset; // stop after this page

      for (const posting of data.jobPostings ?? []) {
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

          jobs.push({
            external_id: String(externalId),
            title: titleText,
            location: normalizeLocation(locationRaw),
            employment_type: normalizeEmploymentType(posting.timeType ?? null),
            workplace_type: normalizeWorkplaceType(null, locationRaw),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Bullet fields are a brief teaser — better than nothing until a
            // detail-fetch backfill is added for Workday.
            description_raw: posting.bulletFields?.join("\n") ?? null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Lazy job detail — listing API has no full description; CXS exposes HTML body.
// ─────────────────────────────────────────────────────────────────────────────

interface WorkdayJobPostingInfoResponse {
  jobPostingInfo?: { jobDescription?: string };
}

/**
 * Fetch full job posting HTML from the Workday CXS job detail endpoint.
 * @param cxsJobsListUrl source.base_url ending in `/jobs` (CXS list POST URL)
 * @param externalPath job external_id e.g. `/job/VA---Lynchburg/Role_R123`
 */
export async function fetchWorkdayJobPostingHtml(
  cxsJobsListUrl: string,
  externalPath: string
): Promise<string | null> {
  const url = new URL(cxsJobsListUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenant = pathParts[pathParts.length - 2] ?? "jobs";
  const origin = url.origin;

  const cookieHeader = await fetchSessionCookie(origin, tenant);
  const cxsBase = cxsJobsListUrl.replace(/\/jobs\/?$/i, "");
  const detailUrl = `${cxsBase}${externalPath}`;

  const res = await fetch(detailUrl, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Origin: origin,
      Referer: `${origin}/en-US/${tenant}`,
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as WorkdayJobPostingInfoResponse;
  const html = data.jobPostingInfo?.jobDescription;
  return typeof html === "string" && html.length > 0 ? html : null;
}
