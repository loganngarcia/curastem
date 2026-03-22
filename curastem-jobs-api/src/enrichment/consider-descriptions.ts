/**
 * Backfill job descriptions for Consider-sourced jobs (e.g. cn-a16z-portfolio).
 *
 * The Consider search API returns no descriptions — only title, salary, location,
 * and an applyUrl pointing to the real ATS. This module follows that URL to the
 * native ATS API and fetches the full description + any fields Consider omitted.
 *
 * Supported ATS (covers ~80% of a16z portfolio):
 *   Greenhouse — REST API: GET /v1/boards/{handle}/jobs/{id}
 *   Lever      — REST API: GET /v0/postings/{company}/{id}
 *   Ashby      — HTML page with application/ld+json schema.org JobPosting
 *
 * For all other ATS (Workday, custom career pages, etc.) we skip gracefully.
 * Those jobs will have description_raw = null and rely on AI summary from title alone.
 *
 * Rate limiting: we process BATCH_SIZE jobs per cron run, with a 200ms delay
 * between requests to avoid hammering any single ATS.
 */

import { backfillJobDescription, getConsiderJobsNeedingDescription } from "../db/queries.ts";
import { logger } from "../utils/logger.ts";
import { normalizeWorkplaceType } from "../utils/normalize.ts";

// 200 jobs/run × 24 runs/day = 4,800/day → 15k a16z jobs fully described in ~3 days.
// 200 × 200ms delay = 40s added to cron — acceptable given the 900s budget.
const BATCH_SIZE = 200;
const REQUEST_DELAY_MS = 200;

const HEADERS = {
  "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
  Accept: "application/json",
};

// ── ATS URL parsers ────────────────────────────────────────────────────────────

function parseApplyUrl(url: string): {
  ats: "greenhouse" | "lever" | "ashby" | "unknown";
  handle: string;
  jobId: string;
} | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // Greenhouse: boards.greenhouse.io/{handle}/jobs/{id} or boards-api.greenhouse.io/...
    const ghMatch = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if ((host === "boards.greenhouse.io" || host === "boards-api.greenhouse.io") && ghMatch) {
      return { ats: "greenhouse", handle: ghMatch[1], jobId: ghMatch[2] };
    }

    // Lever: jobs.lever.co/{handle}/{uuid}
    const lvMatch = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
    if (host === "jobs.lever.co" && lvMatch) {
      return { ats: "lever", handle: lvMatch[1], jobId: lvMatch[2] };
    }

    // Ashby: jobs.ashbyhq.com/{handle}/{uuid}
    const abMatch = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
    if (host === "jobs.ashbyhq.com" && abMatch) {
      return { ats: "ashby", handle: abMatch[1], jobId: abMatch[2] };
    }

    return { ats: "unknown", handle: "", jobId: "" };
  } catch {
    return null;
  }
}

// ── Per-ATS fetchers ───────────────────────────────────────────────────────────

interface FetchedDetail {
  description: string;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  location?: string | null;
  workplace_type?: string | null;
  employment_type?: string | null;
}

async function fetchGreenhouse(handle: string, jobId: string): Promise<FetchedDetail | null> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${handle}/jobs/${jobId}`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const j = await res.json() as {
    content?: string;
    location?: { name?: string };
    metadata?: Array<{ name: string; value: unknown }>;
  };
  const desc = j.content;
  if (!desc) return null;
  const loc = j.location?.name ?? null;
  return {
    description: desc,
    location: loc,
    workplace_type: normalizeWorkplaceType(null, loc),
  };
}

async function fetchLever(handle: string, jobId: string): Promise<FetchedDetail | null> {
  const res = await fetch(
    `https://api.lever.co/v0/postings/${handle}/${jobId}`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const j = await res.json() as {
    text?: string;
    descriptionPlain?: string;
    lists?: Array<{ text?: string; content?: string }>;
    categories?: { location?: string; commitment?: string };
    salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  };
  // Lever description is split into named sections in `lists`
  const parts = (j.lists ?? []).map((l) => {
    const heading = l.text ? `<h3>${l.text}</h3>` : "";
    return heading + (l.content ?? "");
  });
  const desc = (j.descriptionPlain ?? "") + parts.join("");
  if (!desc.trim()) return null;

  const loc = j.categories?.location ?? null;
  const sal = j.salaryRange;
  const periodMap: Record<string, string> = { yearly: "year", monthly: "month", hourly: "hour" };

  return {
    description: desc,
    location: loc,
    workplace_type: normalizeWorkplaceType(null, loc),
    salary_min: sal?.min ?? null,
    salary_max: sal?.max ?? null,
    salary_currency: sal?.currency ?? null,
    salary_period: sal?.interval ? (periodMap[sal.interval.toLowerCase()] ?? null) : null,
  };
}

async function fetchAshby(applyUrl: string): Promise<FetchedDetail | null> {
  // Strip utm params — the clean URL is what the browser loads
  const cleanUrl = applyUrl.split("?")[0];
  const res = await fetch(cleanUrl, {
    headers: { ...HEADERS, Accept: "text/html" },
  });
  if (!res.ok) return null;
  const html = await res.text();

  // Ashby embeds a schema.org JobPosting in application/ld+json
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;

  let data: {
    description?: string;
    employmentType?: string;
    jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
    baseSalary?: {
      currency?: string;
      value?: { minValue?: number; maxValue?: number; unitText?: string };
    };
  };
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const desc = data.description;
  if (!desc) return null;

  const addr = data.jobLocation?.address;
  const locParts = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry].filter(Boolean);
  const loc = locParts.length > 0 ? locParts.join(", ") : null;

  const sal = data.baseSalary;
  const unitMap: Record<string, string> = { year: "year", month: "month", hour: "hour", yearly: "year", hourly: "hour" };
  const empMap: Record<string, string> = {
    FULL_TIME: "full_time", PART_TIME: "part_time", CONTRACTOR: "contract",
    TEMPORARY: "temporary", INTERN: "internship",
  };

  return {
    description: desc,
    location: loc,
    workplace_type: normalizeWorkplaceType(null, loc),
    employment_type: data.employmentType ? (empMap[data.employmentType] ?? null) : null,
    salary_min: sal?.value?.minValue ?? null,
    salary_max: sal?.value?.maxValue ?? null,
    salary_currency: sal?.currency ?? null,
    salary_period: sal?.value?.unitText ? (unitMap[sal.value.unitText.toLowerCase()] ?? null) : null,
  };
}

// ── Main backfill pass ─────────────────────────────────────────────────────────

export async function backfillConsiderDescriptions(
  db: D1Database,
  limit = BATCH_SIZE
): Promise<{ succeeded: number; skipped: number; failed: number }> {
  const jobs = await getConsiderJobsNeedingDescription(db, limit);
  if (jobs.length === 0) return { succeeded: 0, skipped: 0, failed: 0 };

  logger.info("consider_description_backfill_started", { count: jobs.length });

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    const parsed = parseApplyUrl(job.apply_url);
    if (!parsed || parsed.ats === "unknown") {
      skipped++;
      continue;
    }

    try {
      let detail: FetchedDetail | null = null;

      if (parsed.ats === "greenhouse") {
        detail = await fetchGreenhouse(parsed.handle, parsed.jobId);
      } else if (parsed.ats === "lever") {
        detail = await fetchLever(parsed.handle, parsed.jobId);
      } else if (parsed.ats === "ashby") {
        detail = await fetchAshby(job.apply_url);
      }

      if (!detail) {
        skipped++;
        continue;
      }

      await backfillJobDescription(db, job.id, {
        description_raw: detail.description,
        salary_min:      job.salary_min     ?? detail.salary_min,
        salary_max:      job.salary_max     ?? detail.salary_max,
        salary_currency: job.salary_currency ?? detail.salary_currency,
        salary_period:   job.salary_period  ?? detail.salary_period,
        locations:       job.locations      ?? (detail.location ? JSON.stringify([detail.location]) : null),
        workplace_type:  job.workplace_type ?? detail.workplace_type,
        employment_type: detail.employment_type ?? null,
      });

      succeeded++;
    } catch (err) {
      failed++;
      logger.warn("consider_description_fetch_failed", {
        job_id: job.id,
        apply_url: job.apply_url,
        error: String(err),
      });
    }

    // Polite delay between ATS requests
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  logger.info("consider_description_backfill_completed", { succeeded, skipped, failed });
  return { succeeded, skipped, failed };
}
