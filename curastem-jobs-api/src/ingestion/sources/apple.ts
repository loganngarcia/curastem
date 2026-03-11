/**
 * Apple Jobs public search API fetcher.
 *
 * Apple exposes a public, unauthenticated JSON search API for all their
 * global job listings. No API key required. Uses HTTP POST.
 *
 * API format: POST https://jobs.apple.com/api/role/search
 * Body: { "query": "", "filters": {}, "page": 1, "locale": "en-us", "sort": "newest" }
 *
 * Apple is a single-source fetcher — covers Apple's entire global job catalog:
 *   - Apple Retail Store positions worldwide (non-tech, customer-facing)
 *   - Corporate roles at Apple Park and regional offices
 *   - Engineering, design, marketing, operations
 *   - AppleCare support specialists (non-tech / entry-level)
 *
 * Apple Retail is one of the largest global retail employers and strongly
 * aligns with Curastem's mission to include non-tech and customer-service roles.
 *
 * Pagination: page-based (1-indexed), ~20 results per page. We cap at
 * MAX_PAGES per cron run to manage latency.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface AppleRoleLocation {
  city: string | null;
  state: string | null;
  countryCode: string | null;
  name: string | null;    // pre-formatted name, e.g. "Cupertino, CA, United States"
}

interface AppleRole {
  positionId: string;
  postingTitle: string;
  locations: AppleRoleLocation[];
  employmentType: string | null;   // "Full-time" | "Part-time"
  isRemote: boolean | null;
  postingDate: string | null;      // ISO 8601 or "YYYY-MM-DD"
  transformedPostingTitle: string; // URL slug for the job detail page
  team: { teamName: string | null } | null;
}

interface AppleSearchResponse {
  searchResults: AppleRole[];
  totalRecords: number;
}

const API_URL = "https://jobs.apple.com/api/role/search";
const PAGE_SIZE = 20;
// Cap at 50 pages (1,000 jobs) per cron run; Apple has ~1,500–3,000 open
// roles at any time, so 50 pages gives us strong coverage.
const MAX_PAGES = 50;

/**
 * Build location string from Apple's locations array.
 * Apple can list multiple locations per role — we use the first one.
 */
function buildLocation(locations: AppleRoleLocation[]): string | null {
  if (!locations || locations.length === 0) return null;
  const first = locations[0];
  if (first.name) return first.name;
  const parts = [first.city, first.state, first.countryCode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const appleFetcher: JobSource = {
  sourceType: "apple",

  async fetch(_source: SourceRow): Promise<NormalizedJob[]> {
    const jobs: NormalizedJob[] = [];
    let page = 1;

    while (page <= MAX_PAGES) {
      const body = JSON.stringify({
        query: "",
        filters: {},
        page,
        locale: "en-us",
        sort: "newest",
      });

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });

      if (!res.ok) {
        throw new Error(`Apple Jobs API error ${res.status} on page ${page}`);
      }

      const data = (await res.json()) as AppleSearchResponse;
      const results = data.searchResults ?? [];

      if (results.length === 0) break;

      for (const role of results) {
        try {
          const locationStr = buildLocation(role.locations ?? []);
          const workplaceHint = role.isRemote ? "remote" : locationStr;
          const applyUrl = `https://jobs.apple.com/en-us/details/${role.positionId}/${role.transformedPostingTitle}`;

          jobs.push({
            external_id: role.positionId,
            title: role.postingTitle,
            location: normalizeLocation(locationStr),
            employment_type: normalizeEmploymentType(role.employmentType),
            workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Apple's search API does not return full descriptions.
            // The detail page is behind a JS-rendered frontend.
            description_raw: null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(role.postingDate),
            company_name: "Apple",
          });
        } catch {
          continue;
        }
      }

      if (results.length < PAGE_SIZE) break;
      page++;
    }

    return jobs;
  },
};
