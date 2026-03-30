/**
 * Backfill job descriptions for Workday-sourced jobs.
 *
 * The Workday list API (`POST .../jobs`) only returns `bulletFields` — a 3-4
 * line teaser — not the full job description. However, every Workday job page
 * embeds a complete `application/ld+json` schema.org `JobPosting` block that
 * includes the full plaintext description, employment type, and location.
 *
 * Strategy: fetch the human-readable HTML page stored in `source_url` and
 * parse the embedded JSON-LD. No CXS API quirks or CSRF headers required.
 *
 * Cookie preflight:
 *   Workday tenants sit behind Cloudflare bot protection. One session cookie
 *   preflight per unique origin avoids IP-based blocking in the Worker.
 *
 * Rate limiting: 100 jobs/run × 200 ms delay ≈ 20 s added to cron.
 * At 24 runs/day, a backlog of ~5 k jobs clears in ~2 days.
 */

import { backfillJobDescription, getWorkdayJobsNeedingDescription } from "../db/queries.ts";
import { extractSchemaJobPostingDescription } from "../ingestion/sources/workday.ts";
import { logger } from "../utils/logger.ts";

const BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 200;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────────────────────
// Cookie preflight
// ─────────────────────────────────────────────────────────────────────────────

/** GET the Workday board page to extract session cookies for bot protection bypass. */
async function fetchSessionCookie(origin: string, tenant: string): Promise<string> {
  try {
    const res = await fetch(`${origin}/en-US/${tenant}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const raw = res.headers.get("set-cookie") ?? "";
    return raw
      .split(",")
      .map((c) => c.trim().split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  } catch {
    return "";
  }
}

/** Extract the Workday tenant name from `/wday/cxs/{company}/{tenant}/jobs`. */
function tenantFromBaseUrl(baseUrl: string): string {
  try {
    const parts = new URL(baseUrl).pathname.split("/").filter(Boolean);
    return parts[3] ?? "jobs";
  } catch {
    return "jobs";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML / JSON-LD parser
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedDetail {
  description: string;
  employment_type?: string | null;
}

/**
 * Fetch the Workday HTML job page and extract the schema.org JobPosting
 * JSON-LD block embedded in every public Workday job listing.
 * Uses the same parser as ingest-time fetches (`@graph`, multiple scripts).
 */
async function fetchWorkdayHtmlDetail(
  pageUrl: string,
  cookie: string,
): Promise<ParsedDetail | null> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (cookie) headers["Cookie"] = cookie;

  const res = await fetch(pageUrl, { headers });
  if (!res.ok) return null;

  const html = await res.text();

  const desc = extractSchemaJobPostingDescription(html)?.trim();
  if (!desc) return null;

  return {
    description: desc,
    employment_type: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main backfill pass
// ─────────────────────────────────────────────────────────────────────────────

export async function backfillWorkdayDescriptions(
  db: D1Database,
  limit = BATCH_SIZE,
): Promise<{ succeeded: number; skipped: number; failed: number }> {
  const jobs = await getWorkdayJobsNeedingDescription(db, limit);
  if (jobs.length === 0) return { succeeded: 0, skipped: 0, failed: 0 };

  logger.info("workday_description_backfill_started", { count: jobs.length });

  // One cookie preflight per unique Workday origin — avoids N preflights for N jobs.
  const cookieCache = new Map<string, string>();

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    let origin: string;
    try {
      origin = new URL(job.source_url).origin;
    } catch {
      skipped++;
      continue;
    }

    if (!cookieCache.has(origin)) {
      cookieCache.set(origin, await fetchSessionCookie(origin, tenantFromBaseUrl(job.base_url)));
    }
    const cookie = cookieCache.get(origin) ?? "";

    try {
      const detail = await fetchWorkdayHtmlDetail(job.source_url, cookie);
      if (!detail) {
        skipped++;
        continue;
      }

      await backfillJobDescription(db, job.id, {
        description_raw: detail.description,
        employment_type: detail.employment_type ?? null,
      });
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn("workday_description_fetch_failed", {
        job_id: job.id,
        source_url: job.source_url,
        error: String(err),
      });
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  logger.info("workday_description_backfill_completed", { succeeded, skipped, failed });
  return { succeeded, skipped, failed };
}
