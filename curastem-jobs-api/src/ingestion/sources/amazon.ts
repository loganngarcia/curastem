/**
 * Amazon Jobs public search API fetcher.
 *
 * Amazon exposes a public, unauthenticated JSON search API for all their
 * global job listings. No API key required.
 *
 * API format: GET https://www.amazon.jobs/en/search.json?offset=0&result_limit=100
 *
 * Amazon is a single-source fetcher — it covers Amazon's entire global job
 * catalog in one endpoint rather than per-company. This includes:
 *   - Amazon warehouse and fulfillment center roles (hourly)
 *   - Amazon Logistics / delivery associate roles
 *   - Retail and Go store positions
 *   - Amazon Web Services (AWS) corporate and engineering roles
 *   - Corporate roles at Amazon HQ, regional offices
 *
 * This directly serves Curastem's mission to include non-tech and hourly work
 * alongside tech roles — Amazon is one of the largest global employers.
 *
 * Pagination: offset-based, 100 results per page, up to 10,000 total results
 * (Amazon returns error beyond that cap). We fetch up to MAX_PAGES pages per
 * cron run to keep latency and cost manageable.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface AmazonJobHit {
  id_icims: string;
  title: string;
  city: string | null;
  state: string | null;
  country_code: string | null;
  location: string | null;
  normalized_location: string | null;
  job_schedule_type: string | null;  // "full-time" | "part-time"
  posted_date: string | null;        // "Month Day, Year" e.g. "January 15, 2026"
  job_path: string;
  description_short: string | null;
}

interface AmazonSearchResponse {
  jobs: AmazonJobHit[];  // API returns jobs array; hits is total count (number)
  hits: number;
}

const BASE_URL = "https://www.amazon.jobs/en/search.json";
const PAGE_SIZE = 100;
// Limit total pages per run — Amazon has ~50K+ jobs globally;
// fetching all would be very slow. Cap at 20 pages (2,000 jobs) per run.
// The cron runs hourly so we pick up new listings over successive runs.
const MAX_PAGES = 20;

/**
 * Build a location string from Amazon's split city/state/country fields.
 */
function buildLocation(job: AmazonJobHit): string | null {
  if (job.location) return job.location;
  const parts = [job.city, job.state, job.country_code].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const amazonFetcher: JobSource = {
  sourceType: "amazon",

  async fetch(_source: SourceRow): Promise<NormalizedJob[]> {
    const jobs: NormalizedJob[] = [];
    let offset = 0;
    let page = 0;

    while (page < MAX_PAGES) {
      const url = `${BASE_URL}?offset=${offset}&result_limit=${PAGE_SIZE}&normalized_country_code[]=USA&normalized_country_code[]=GBR&normalized_country_code[]=DEU&normalized_country_code[]=CAN&normalized_country_code[]=AUS`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Amazon Jobs API error ${res.status} at offset ${offset}`);
      }

      const data = (await res.json()) as AmazonSearchResponse;
      // API returns jobs[]; legacy/alternate format used hits[] — support both
      const raw = data as unknown;
      const jobList = Array.isArray(data.jobs)
        ? data.jobs
        : Array.isArray((raw as { hits?: unknown[] }).hits)
          ? ((raw as { hits: AmazonJobHit[] }).hits)
          : [];

      if (jobList.length === 0) break;

      for (const hit of jobList) {
        try {
          const locationStr = buildLocation(hit) ?? hit.normalized_location;
          const applyUrl = `https://www.amazon.jobs${hit.job_path}`;

          jobs.push({
            external_id: hit.id_icims,
            title: hit.title,
            location: normalizeLocation(locationStr),
            employment_type: normalizeEmploymentType(hit.job_schedule_type),
            workplace_type: normalizeWorkplaceType(null, locationStr),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Amazon's public search does not include full descriptions —
            // only a short summary. We store the short summary for AI context.
            description_raw: hit.description_short ?? null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(hit.posted_date),
            company_name: "Amazon",
          });
        } catch {
          continue;
        }
      }

      if (jobList.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      page++;
    }

    return jobs;
  },
};
