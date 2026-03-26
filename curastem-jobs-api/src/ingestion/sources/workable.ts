/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Workable public widget API fetcher.
 *
 * Workable exposes an unauthenticated public widget endpoint for every company
 * that has enabled the careers page. No API key required.
 *
 * API format: https://apply.workable.com/api/v1/widget/accounts/{handle}
 *
 * ⚠️ Description note: The public v1 widget endpoint does NOT return full job
 * descriptions. That requires the employer-authenticated v3 API. Jobs ingested
 * here will have `description_raw: null`. When the job detail is first fetched
 * via GET /jobs/:id, the AI enrichment step will gracefully skip extraction and
 * fall back to generating a summary from title and company name only.
 *
 * Workable is strong in SaaS companies, agencies, and mid-market businesses
 * globally, with a meaningful presence in Europe, MENA, and Latin America.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface WorkableJob {
  shortcode: string;    // Workable's unique job identifier (e.g. "CCBE25DC0C")
  title: string;
  city: string | null;
  state: string | null;
  country: string | null;
  location_str: string | null;   // pre-formatted location string (may not exist)
  employment_type: string | null;  // "Full-time" | "Part-time" etc.
  telecommuting: boolean | null;   // true = remote
  published_on: string | null;   // "YYYY-MM-DD"
  url: string;                   // canonical application URL
  locations: Array<{ country: string; city: string; region: string }> | null;
}

interface WorkableResponse {
  jobs: WorkableJob[];
  company: {
    name: string;
    url: string;
  };
}

/**
 * Build a human-readable location string from Workable's location fields.
 * Prefers the structured `locations` array (multi-location support), falls back
 * to the top-level city/state/country fields for older API responses.
 */
function buildLocation(job: WorkableJob): string | null {
  if (job.locations && job.locations.length > 0) {
    const loc = job.locations[0];
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  const parts = [job.city, job.state, job.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const workableFetcher: JobSource = {
  sourceType: "workable",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Workable API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as WorkableResponse;
    const jobs: NormalizedJob[] = [];

    for (const job of data.jobs ?? []) {
      try {
        const locationStr = buildLocation(job);

        // Infer workplace type: telecommuting=true → remote, otherwise derive from location
        const workplaceType = job.telecommuting
          ? "remote"
          : normalizeWorkplaceType(null, locationStr);

        jobs.push({
          external_id: job.shortcode,
          title: job.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(job.employment_type),
          workplace_type: workplaceType,
          apply_url: job.url,
          source_url: job.url,
          // Public v1 widget does not expose description — AI extraction will skip gracefully
          description_raw: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(job.published_on),
          company_name: source.name.replace(/\s*\(Workable\)\s*/i, "").trim(),
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
