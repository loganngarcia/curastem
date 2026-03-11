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
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface WorkdayJobPostedOn {
  date: string; // ISO 8601
}

interface WorkdayJobType {
  descriptor: string; // "Full time" | "Part time" | "Contract" | etc.
}

interface WorkdayJobListing {
  id: string;
  bulletFields: string[];   // brief description bullets from the posting
  title: {
    instances: Array<{ text: string }>;
  };
  postedOn: WorkdayJobPostedOn | null;
  locationsText: string | null;
  jobPostingURL: string;
  externalPath: string;
  timeType: WorkdayJobType | null;
  jobType: Array<{ descriptor: string }> | null;
}

interface WorkdayJobsResponse {
  total: number;
  jobPostings: WorkdayJobListing[];
}

interface WorkdayRequestBody {
  appliedFacets: Record<string, never>;
  limit: number;
  offset: number;
  searchText: string;
}

const PAGE_SIZE = 100;

export const workdayFetcher: JobSource = {
  sourceType: "workday",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const jobs: NormalizedJob[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const body: WorkdayRequestBody = {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText: "",
      };

      const res = await fetch(source.base_url, {
        method: "POST",
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Workday API error ${res.status} for ${source.company_handle}`);
      }

      const data = (await res.json()) as WorkdayJobsResponse;
      total = data.total ?? 0;

      for (const posting of data.jobPostings ?? []) {
        try {
          const titleText = posting.title?.instances?.[0]?.text ?? "";
          if (!titleText) continue;

          const locationRaw = posting.locationsText ?? null;
          const timeType = posting.timeType?.descriptor ?? null;
          const jobType = posting.jobType?.[0]?.descriptor ?? null;
          const employmentHint = timeType ?? jobType;

          // Use a partial job URL — Workday full apply URLs require their frontend
          const applyUrl = posting.jobPostingURL.startsWith("http")
            ? posting.jobPostingURL
            : `https://${source.company_handle}.myworkdayjobs.com${posting.externalPath ?? ""}`;

          jobs.push({
            external_id: posting.id,
            title: titleText,
            location: normalizeLocation(locationRaw),
            employment_type: normalizeEmploymentType(employmentHint),
            workplace_type: normalizeWorkplaceType(null, locationRaw),
            apply_url: applyUrl,
            source_url: applyUrl,
            // Workday does not return full description in the list API;
            // bullet fields provide a light summary until a detail fetch is added.
            description_raw: posting.bulletFields?.join("\n") ?? null,
            salary_min: null,  // Workday does not include salary in public list API
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(posting.postedOn?.date ?? null),
            company_name: source.name.replace(/\s*\(Workday\)\s*/i, "").trim(),
          });
        } catch {
          continue;
        }
      }

      offset += PAGE_SIZE;

      // Safety cap to avoid runaway pagination on large employers (e.g. Walmart)
      if (offset >= 5000) break;
    }

    return jobs;
  },
};
