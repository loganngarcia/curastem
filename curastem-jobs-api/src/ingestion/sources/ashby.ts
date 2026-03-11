/**
 * Ashby public job board API fetcher.
 *
 * Ashby is a modern ATS used by fast-growing startups (OpenAI, Ramp, Notion,
 * etc.). It exposes a public, unauthenticated JSON endpoint for each company's
 * hosted job board.
 *
 * API format (as of 2026):
 *   GET https://api.ashbyhq.com/posting-api/job-board/{handle}
 *   Optional: ?includeCompensation=true
 *
 * Note: The older endpoint (jobs.ashbyhq.com/api/non-authenticated-open-application/...)
 * was deprecated and now returns 404. All seeds must use the new base_url format.
 *
 * Ashby provides structured location data, `isRemote`, and an explicit
 * `workplaceType` field ("Remote" | "Hybrid" | "OnSite"), giving us reliable
 * workplace_type signals without guessing from free text.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface AshbyLocation {
  city?: string;
  region?: string;
  country?: string;
  isRemote?: boolean;
}

interface AshbyCompensationTier {
  minValue?: number;
  maxValue?: number;
  currency?: string;
  interval?: string; // "MONTHLY" | "YEARLY" | "HOURLY"
}

interface AshbyJob {
  id: string;
  title: string;
  teamName?: string;
  team?: string;
  // New API uses `location` as a plain string, old API used a nested object.
  // We support both to handle potential API version variations.
  location?: string | AshbyLocation;
  locationName?: string;
  isRemote?: boolean;
  workplaceType?: string;     // "Remote" | "Hybrid" | "OnSite" — new field in v2 API
  employmentType?: string;    // "FullTime" | "PartTime" | "Contract" | "Internship"
  publishedAt?: string;       // ISO 8601 — current field name in v2 API
  publishedDate?: string;     // ISO 8601 — legacy field name from v1 API
  descriptionHtml?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    summaryComponents?: AshbyCompensationTier[];
    compensationTierSummary?: string;
  };
  shouldDisplayCompensationOnJobPostings?: boolean;
}

interface AshbyJobBoardResponse {
  jobs: AshbyJob[];
  organization?: {
    name?: string;
    logoUrl?: string;
    websiteUrl?: string;
  };
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  fulltime: "full_time",
  "full-time": "full_time",
  parttime: "part_time",
  "part-time": "part_time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
};

function normalizeAshbyEmploymentType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s/g, "");
  return EMPLOYMENT_TYPE_MAP[key] ?? null;
}

function normalizeAshbyInterval(interval: string | undefined): string | null {
  if (!interval) return null;
  const map: Record<string, string> = {
    YEARLY: "year",
    MONTHLY: "month",
    HOURLY: "hour",
  };
  return map[interval.toUpperCase()] ?? null;
}

function buildLocationString(job: AshbyJob): string | null {
  if (job.locationName) return job.locationName;
  // v2 API: location is a plain string ("New York, NY (HQ)")
  if (typeof job.location === "string") return job.location || null;
  // v1 API: location was a nested object
  if (job.location && typeof job.location === "object") {
    const loc = job.location as AshbyLocation;
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

export const ashbyFetcher: JobSource = {
  sourceType: "ashby",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Ashby API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as AshbyJobBoardResponse;
    const jobs: NormalizedJob[] = [];
    const companyName = data.organization?.name
      ?? source.name.replace(/\s*\(Ashby\)\s*/i, "").trim();

    for (const job of data.jobs ?? []) {
      try {
        const locationStr = buildLocationString(job);
        // Prefer the explicit workplaceType field (v2 API), then fall back to isRemote
        const locationIsRemote = typeof job.location === "object" ? (job.location as AshbyLocation).isRemote : false;
        const isRemote = job.isRemote ?? locationIsRemote ?? false;
        const workplaceRaw = job.workplaceType ?? (isRemote ? "remote" : locationStr);

        // Extract best salary tier from compensation summary
        let salaryMin: number | null = null;
        let salaryMax: number | null = null;
        let salaryCurrency: string | null = null;
        let salaryPeriod: string | null = null;

        const tiers = job.compensation?.summaryComponents ?? [];
        if (tiers.length > 0) {
          const tier = tiers[0];
          salaryMin = tier.minValue ?? null;
          salaryMax = tier.maxValue ?? null;
          salaryCurrency = tier.currency ?? null;
          salaryPeriod = normalizeAshbyInterval(tier.interval);
        }

        jobs.push({
          external_id: job.id,
          title: job.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(normalizeAshbyEmploymentType(job.employmentType)),
          workplace_type: normalizeWorkplaceType(workplaceRaw, locationStr),
          apply_url: job.applyUrl ?? job.jobUrl ?? `https://jobs.ashbyhq.com/${source.company_handle}/${job.id}`,
          source_url: job.jobUrl ?? `https://jobs.ashbyhq.com/${source.company_handle}/${job.id}`,
          description_raw: job.descriptionHtml ?? null,
          salary_min: salaryMin,
          salary_max: salaryMax,
          salary_currency: salaryCurrency,
          salary_period: salaryPeriod as import("../../types.ts").SalaryPeriod | null,
          // Support both v2 (publishedAt) and v1 (publishedDate) field names
          posted_at: parseEpochSeconds(job.publishedAt ?? job.publishedDate),
          company_name: companyName,
          company_logo_url: data.organization?.logoUrl ?? null,
          company_website_url: data.organization?.websiteUrl ?? null,
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
