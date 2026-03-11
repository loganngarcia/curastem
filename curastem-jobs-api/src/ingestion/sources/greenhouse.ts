/**
 * Greenhouse public board API fetcher.
 *
 * Greenhouse exposes a fully public, unauthenticated JSON API for all companies
 * that use it for hiring. No API key required. This is the highest-quality
 * free structured job data source available.
 *
 * API format: https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true
 *
 * The `content=true` parameter includes the full job description HTML in each
 * response, which we preserve as description_raw.
 *
 * Greenhouse is the highest-trust source in the registry:
 *   - Direct from the employer's ATS
 *   - Structured fields: title, location, departments, metadata
 *   - Reliable external_id (numeric job ID)
 *   - Posted date sometimes absent from the board API (only on the detail endpoint)
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface GreenhouseMetadataField {
  id: number;
  name: string;
  value: string | null;
}

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at: string | null;   // ISO 8601
  location: { name: string };
  content: string | null;      // HTML description, present with ?content=true
  metadata: GreenhouseMetadataField[];
  absolute_url: string;        // canonical application URL
  departments: Array<{ name: string }>;
}

interface GreenhouseJobsResponse {
  jobs: GreenhouseJob[];
  meta: { total: number };
}

/**
 * Attempt to extract a salary hint from Greenhouse metadata fields.
 * Companies sometimes include salary as a custom metadata field.
 */
function extractSalaryFromMetadata(metadata: GreenhouseMetadataField[]): string | null {
  for (const field of metadata) {
    const name = field.name.toLowerCase();
    if ((name.includes("salary") || name.includes("compensation") || name.includes("pay")) && field.value) {
      return field.value;
    }
  }
  return null;
}

/**
 * Guess workplace type from location string and metadata.
 */
function extractWorkplaceFromMetadata(
  metadata: GreenhouseMetadataField[],
  locationName: string
): string | null {
  for (const field of metadata) {
    const val = field.value?.toLowerCase() ?? "";
    if (val.includes("remote") || val.includes("hybrid") || val.includes("on-site")) {
      return val;
    }
  }
  return locationName;
}

export const greenhouseFetcher: JobSource = {
  sourceType: "greenhouse",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    // Append ?content=true to get full description HTML
    const url = `${source.base_url}?content=true`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Greenhouse API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as GreenhouseJobsResponse;
    const jobs: NormalizedJob[] = [];

    for (const job of data.jobs ?? []) {
      try {
        const locationName = job.location?.name ?? "";
        const salaryHint = extractSalaryFromMetadata(job.metadata ?? []);
        const workplaceHint = extractWorkplaceFromMetadata(job.metadata ?? [], locationName);
        const salary = parseSalary(salaryHint);

        // Always construct the canonical Greenhouse URL — companies like Stripe
        // configure absolute_url to point at their own jobs search page
        // (e.g. stripe.com/jobs/search?gh_jid=123) which shows all jobs, not
        // the specific posting. The direct board URL is always reliable.
        const directUrl = `https://job-boards.greenhouse.io/${source.company_handle}/jobs/${job.id}`;

        jobs.push({
          external_id: String(job.id),
          title: job.title,
          location: normalizeLocation(locationName),
          employment_type: normalizeEmploymentType(null), // Greenhouse rarely includes this at board level
          workplace_type: normalizeWorkplaceType(workplaceHint, locationName),
          apply_url: directUrl,
          source_url: job.absolute_url, // company's own URL — preserved for reference
          description_raw: job.content ?? null,
          salary_min: salary.min,
          salary_max: salary.max,
          salary_currency: salary.currency,
          salary_period: salary.period,
          posted_at: parseEpochSeconds(job.updated_at), // best available date from board API
          company_name: source.name.replace(/\s*\(Greenhouse\)\s*/i, "").trim(),
        });
      } catch {
        // Skip individual malformed job records rather than failing the entire source
        continue;
      }
    }

    return jobs;
  },
};
