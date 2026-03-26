/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * USAJOBS federal government job board fetcher.
 *
 * USAJOBS is the official US federal job board. Requires a free API key from
 * developer.usajobs.gov. Key is stored via wrangler secret put USAJOBS_API_KEY.
 *
 * API: https://data.usajobs.gov/api/Search
 * Auth: Host, User-Agent (email), Authorization-Key headers
 */

import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const BASE_URL = "https://data.usajobs.gov/api/Search";
const USER_AGENT = "developers@curastem.org";
const RESULTS_PER_PAGE = 500;
/** Cap pages per run to stay within Worker CPU budget (~30s). 4 pages ≈ 2K jobs. */
const MAX_PAGES = 4;

interface USAJobsRemuneration {
  MinimumRange?: string;
  MaximumRange?: string;
  RateIntervalCode?: string;
  Description?: string;
}

interface USAJobsSearchItem {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionID?: string;
    PositionTitle: string;
    PositionURI?: string;
    ApplyURI?: string[];
    PositionLocationDisplay?: string;
    PositionLocation?: Array<{ LocationName?: string; CityName?: string; CountrySubDivisionCode?: string }>;
    OrganizationName?: string;
    DepartmentName?: string;
    PositionSchedule?: Array<{ Name?: string; Code?: string }>;
    PositionRemuneration?: USAJobsRemuneration[];
    PublicationStartDate?: string;
    ApplicationCloseDate?: string;
    QualificationSummary?: string;
    UserArea?: {
      Details?: {
        JobSummary?: string;
        MajorDuties?: string;
        Education?: string;
      };
    };
  };
}

interface USAJobsResponse {
  SearchResult?: {
    SearchResultItems?: USAJobsSearchItem[];
    SearchResultCount?: number;
  };
}

function mapScheduleToEmployment(scheduleName?: string): string | null {
  if (!scheduleName) return null;
  const lower = scheduleName.toLowerCase();
  if (lower.includes("full") || lower.includes("full-time")) return "full_time";
  if (lower.includes("part") || lower.includes("part-time")) return "part_time";
  if (lower.includes("intermittent") || lower.includes("temporary")) return "temporary";
  return null;
}

export const usajobsFetcher: JobSource = {
  sourceType: "usajobs",

  async fetch(_source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const apiKey = env?.USAJOBS_API_KEY;
    if (!apiKey) {
      throw new Error("USAJOBS_API_KEY secret not configured — set via wrangler secret put USAJOBS_API_KEY");
    }

    const jobs: NormalizedJob[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES) {
      const url = new URL(BASE_URL);
      url.searchParams.set("ResultsPerPage", String(RESULTS_PER_PAGE));
      url.searchParams.set("Page", String(page));
      url.searchParams.set("WhoMayApply", "public");
      url.searchParams.set("Fields", "full");

      const res = await fetch(url.toString(), {
        headers: {
          Host: "data.usajobs.gov",
          "User-Agent": USER_AGENT,
          "Authorization-Key": apiKey,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`USAJOBS API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as USAJobsResponse;
      const items = data.SearchResult?.SearchResultItems ?? [];

      for (const item of items) {
        const desc = item.MatchedObjectDescriptor;
        if (!desc?.PositionTitle) continue;

        const applyUrl = desc.ApplyURI?.[0] ?? desc.PositionURI ?? "";
        if (!applyUrl) continue;

        const locationStr = desc.PositionLocationDisplay
          ?? desc.PositionLocation?.[0]?.LocationName
          ?? desc.PositionLocation?.[0]?.CityName
          ?? "";

        const schedule = desc.PositionSchedule?.[0]?.Name;
        const employmentType = normalizeEmploymentType(mapScheduleToEmployment(schedule));

        const rem = desc.PositionRemuneration?.[0];
        let salaryMin: number | null = null;
        let salaryMax: number | null = null;
        if (rem?.MinimumRange) salaryMin = parseInt(rem.MinimumRange, 10);
        if (rem?.MaximumRange) salaryMax = parseInt(rem.MaximumRange, 10);
        if (Number.isNaN(salaryMin)) salaryMin = null;
        if (Number.isNaN(salaryMax)) salaryMax = null;

        const period = rem?.RateIntervalCode === "PA" ? "year" as const
          : rem?.RateIntervalCode === "PH" ? "hour" as const
          : rem?.RateIntervalCode === "PM" ? "month" as const
          : null;

        const descriptionParts: string[] = [];
        if (desc.QualificationSummary) descriptionParts.push(desc.QualificationSummary);
        const details = desc.UserArea?.Details;
        if (details?.JobSummary) descriptionParts.push(details.JobSummary);
        if (details?.MajorDuties) descriptionParts.push(details.MajorDuties);
        if (details?.Education) descriptionParts.push(details.Education);
        const descriptionRaw = descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null;

        let postedAt: number | null = null;
        if (desc.PublicationStartDate) {
          const parsed = Date.parse(desc.PublicationStartDate);
          if (!Number.isNaN(parsed)) postedAt = Math.floor(parsed / 1000);
        }

        const companyName = desc.OrganizationName ?? desc.DepartmentName ?? "U.S. Government";

        jobs.push({
          external_id: item.MatchedObjectId,
          title: desc.PositionTitle,
          location: normalizeLocation(locationStr),
          employment_type: employmentType,
          workplace_type: normalizeWorkplaceType(null, locationStr),
          apply_url: applyUrl,
          source_url: desc.PositionURI ?? applyUrl,
          description_raw: descriptionRaw,
          salary_min: salaryMin,
          salary_max: salaryMax,
          salary_currency: "USD",
          salary_period: period,
          posted_at: postedAt,
          company_name: companyName,
        });
      }

      hasMore = items.length >= RESULTS_PER_PAGE;
      page++;
    }

    return jobs;
  },
};
