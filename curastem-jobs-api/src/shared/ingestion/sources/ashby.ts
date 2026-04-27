/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
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
 * Fallback when REST returns an empty `jobs` array: same public GraphQL the hosted board SPA
 * uses — `POST https://app.ashbyhq.com/api/non-user-graphql?op=JobBoardWithTeams` with
 * `jobBoardWithTeams(organizationHostedJobsPageName: …)`. If both are empty, the tenant has
 * not exposed listings to unauthenticated APIs (Ashby admin / job visibility), not a client bug.
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

/** GraphQL `jobBoardWithTeams.jobPostings[]` brief (public non-user schema). */
interface AshbyGqlJobBrief {
  id: string;
  title: string;
  locationName: string;
  employmentType?: string;
  workplaceType?: string | null;
  publishedAt?: string | null;
}

const ASHBY_GRAPHQL_BASE = "https://app.ashbyhq.com/api/non-user-graphql";

const JOB_BOARD_WITH_TEAMS_GQL = `
query JobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings {
      id
      title
      locationName
      employmentType
      workplaceType
      publishedAt
    }
  }
}`;

// Some Ashby boards (e.g. Trigger.dev) use an older schema where `publishedAt`
// is not available on jobBoardWithTeams. Fall back to a query without it.
const JOB_BOARD_WITH_TEAMS_GQL_NO_DATE = `
query JobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings {
      id
      title
      locationName
      employmentType
      workplaceType
    }
  }
}`;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
  Accept: "application/json",
};

/** Hosted jobs page slug from posting-api URL, else company_handle (handles %20 in path). */
function hostedJobsPageNameFromSource(source: SourceRow): string {
  const fromUrl = source.base_url.match(/\/job-board\/([^?]+)/i)?.[1];
  if (fromUrl) {
    try {
      return decodeURIComponent(fromUrl);
    } catch {
      return fromUrl;
    }
  }
  return source.company_handle;
}

async function fetchAshbyHostedOrgNameGraphql(slug: string): Promise<string | null> {
  const query = `query { organizationFromHostedJobsPageName(organizationHostedJobsPageName: ${JSON.stringify(slug)}) { name } }`;
  const res = await fetch(`${ASHBY_GRAPHQL_BASE}?op=OrganizationFromHostedJobsPageName`, {
    method: "POST",
    headers: { ...FETCH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    data?: { organizationFromHostedJobsPageName?: { name?: string } | null };
  };
  return j.data?.organizationFromHostedJobsPageName?.name ?? null;
}

/**
 * Public GraphQL list — same data the jobs.ashbyhq.com SPA loads. Used when REST `jobs` is empty.
 */
async function fetchJobsViaAshbyGraphql(
  source: SourceRow,
  slug: string,
): Promise<NormalizedJob[]> {
  const res = await fetch(`${ASHBY_GRAPHQL_BASE}?op=JobBoardWithTeams`, {
    method: "POST",
    headers: { ...FETCH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "JobBoardWithTeams",
      query: JOB_BOARD_WITH_TEAMS_GQL,
      variables: { organizationHostedJobsPageName: slug },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ashby GraphQL error ${res.status} for ${source.company_handle}`);
  }
  let json = (await res.json()) as {
    data?: { jobBoardWithTeams?: { jobPostings?: AshbyGqlJobBrief[] } };
    errors?: Array<{ message?: string }>;
  };
  // Retry without `publishedAt` if the board uses an older schema that lacks this field.
  if (json.errors?.some((e) => e.message?.includes("publishedAt"))) {
    const retry = await fetch(`${ASHBY_GRAPHQL_BASE}?op=JobBoardWithTeams`, {
      method: "POST",
      headers: { ...FETCH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "JobBoardWithTeams",
        query: JOB_BOARD_WITH_TEAMS_GQL_NO_DATE,
        variables: { organizationHostedJobsPageName: slug },
      }),
    });
    if (!retry.ok) throw new Error(`Ashby GraphQL retry error ${retry.status}`);
    json = (await retry.json()) as typeof json;
  }
  if (json.errors?.length) {
    throw new Error(`Ashby GraphQL: ${json.errors[0]?.message ?? "unknown"}`);
  }
  const briefs = json.data?.jobBoardWithTeams?.jobPostings ?? [];
  const fallbackName = source.name.replace(/\s*\(Ashby\)\s*/i, "").trim();
  const orgName = (await fetchAshbyHostedOrgNameGraphql(slug)) ?? fallbackName;
  const encodedSlug = encodeURIComponent(slug);

  return briefs.map((job) => {
    const locationStr = job.locationName ?? "";
    const applyUrl = `https://jobs.ashbyhq.com/${encodedSlug}/${job.id}`;
    return {
      external_id: job.id,
      title: job.title.trim(),
      location: normalizeLocation(locationStr),
      employment_type: normalizeEmploymentType(normalizeAshbyEmploymentType(job.employmentType)),
      workplace_type: normalizeWorkplaceType(job.workplaceType ?? null, locationStr),
      apply_url: applyUrl,
      source_url: applyUrl,
      description_raw: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      posted_at: parseEpochSeconds(job.publishedAt ?? undefined),
      company_name: orgName,
      company_logo_url: null,
      company_website_url: null,
    };
  });
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
    const slug = hostedJobsPageNameFromSource(source);
    const res = await fetch(source.base_url, {
      headers: FETCH_HEADERS,
    });

    if (!res.ok) {
      if (res.status === 404) {
        return fetchJobsViaAshbyGraphql(source, slug);
      }
      throw new Error(`Ashby API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as AshbyJobBoardResponse;
    const restJobs = data.jobs ?? [];
    if (restJobs.length === 0) {
      return fetchJobsViaAshbyGraphql(source, slug);
    }

    const jobs: NormalizedJob[] = [];
    const companyName = data.organization?.name
      ?? source.name.replace(/\s*\(Ashby\)\s*/i, "").trim();

    for (const job of restJobs) {
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
          apply_url: job.applyUrl ?? job.jobUrl ?? `https://jobs.ashbyhq.com/${encodeURIComponent(source.company_handle)}/${job.id}`,
          source_url: job.jobUrl ?? `https://jobs.ashbyhq.com/${encodeURIComponent(source.company_handle)}/${job.id}`,
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
