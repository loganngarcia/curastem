/**
 * MCP tool: search_jobs
 *
 * Unified job search across all of Curastem's listings. Covers every filter
 * the API supports so agents never need a separate "get_jobs_by_company" call —
 * just pass company: "stripe" alongside any other filters.
 */

import type { JobsApiClient } from "../client.ts";
import type { Job, McpTool } from "../types.ts";

export const searchJobsTool: McpTool = {
  name: "search_jobs",
  description: [
    "Search Curastem's job listings by keyword, company, location, job type, seniority, or recency.",
    "Use for ANY industry (retail, finance, healthcare, tech, etc.). Search is semantic — users do NOT need exact job-title wording.",
    "Role / title text goes in query (+ optional keywords). The API matches job TITLE substrings only for that text — it does not mix company names into the same field. Preserve negative title terms with a leading dash, e.g. 'software engineer, -senior' excludes titles containing senior. Use company when they name an employer (slug). Never concatenate many job titles into one query unless the user supplied comma-separated roles.",
    "Do not add seniority_level, stacks, or resume-derived terms unless they asked. Omit seniority_level unless they explicitly name a level as an inclusion filter (never infer from profile). Expand abbreviations only; umbrella phrases use neutral roles and/or company slugs.",
    "Umbrella or vague phrases ('big tech', 'FAANG', 'top retailers'): interpret intent, then one search_jobs with comma-separated company slugs and/or a broad role query — prefer one API call over many.",
    "company MUST be employer slug(s): one slug, or comma-separated for multiple employers (OR). Example FAANG-style: meta,google,apple,amazon,netflix,microsoft. Never pass display names as query. If unsure of slug, try lowercase hyphenated brand.",
    "Add skills or stack to query/keywords only when the user mentioned them — not from profile by default.",
    "When a company filter returns 0 results, IMMEDIATELY retry with a broader query (drop company, use role keywords) — never stop after one empty result.",
    "Pass cursor from a previous response to paginate.",
    "For visa / H-1B: set visa_sponsorship to 'yes' (plus optional query). Postings must be explicitly tagged.",
    "For regional / nearby intent: near_lat, near_lng, radius_km (e.g. 50–65). Prefer this over the location substring when coordinates are known.",
    "For two or more metros in one user message (e.g. SF or NYC), pass location_or as comma-separated place names — one API request matches ANY listed place. Do not use near_* for multi-metro; use location_or or location with 'or' between cities.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Job title or role phrase (merged with keywords). Sent as API title= — matches job TITLE text only, separate from company. Preserve negative title terms with a leading dash, e.g. 'product manager, software engineer, -senior'. If they want any role / all jobs, omit. Never merge many titles into one string unless the user supplied comma-separated roles. Expand shorthand (swe, pm, sre) when applicable.",
      },
      keywords: {
        type: "string",
        description:
          "Only if the user named skills or stacks in this turn. Omit by default — do not pull from resume or profile.",
      },
      company: {
        type: "string",
        description:
          "Employer slug(s): one slug, or comma-separated for OR (e.g. meta,google,apple for FAANG-style lists). Lowercase hyphenated from URLs or company list. If 0 results, retry without company and use query/keywords.",
      },
      location: {
        type: "string",
        description:
          "Text filter on job location strings (partial match). For metro-area or 'near me' intent, prefer near_lat + near_lng + radius_km (50–65 km typical) so results are not tied to one city spelling. Use location only when you cannot geocode, or as a fallback. Avoid long 'City, Country' strings; use country for country filters. For multiple metros, prefer location_or.",
      },
      location_or: {
        type: "string",
        description:
          "Comma-separated place substrings when the user names two or more metros at once (e.g. San Francisco,New York). The API returns jobs whose location text matches ANY term. Mutually exclusive with distance search (near_lat/near_lng).",
      },
      employment_type: {
        type: "string",
        description: "Type of employment contract.",
        enum: ["full_time", "part_time", "contract", "internship", "temporary"],
      },
      workplace_type: {
        type: "string",
        description: "Work arrangement.",
        enum: ["remote", "hybrid", "on_site"],
      },
      seniority_level: {
        type: "string",
        description:
          "Omit unless the user explicitly asked for a band. Never infer from profile. Enum when set:",
        enum: ["new_grad", "entry", "mid", "senior", "staff", "manager", "director", "executive"],
      },
      posted_within_days: {
        type: "number",
        description:
          "Optional: 1–30. If omitted, the API returns newest matches first without a hard posted-date cutoff. Set when the user asks to limit how far back to search.",
        minimum: 1,
        maximum: 30,
      },
      salary_min: {
        type: "number",
        description:
          "Minimum annual salary in the job's listed currency (usually USD). Only returns jobs where a salary is known and meets this threshold. Examples: 100000 for $100k, 150000 for $150k.",
        minimum: 0,
      },
      visa_sponsorship: {
        type: "string",
        description:
          "Filter by explicit visa sponsorship text in the posting (AI-extracted). Use 'yes' for jobs that sponsor visas (H-1B, etc.). Use 'no' only when the user wants roles that explicitly state no sponsorship. Omit when not relevant.",
        enum: ["yes", "no"],
      },
      description_language: {
        type: "string",
        description:
          "ISO 639-1 code for the language of the job posting body. Examples: en, es, de, fr, pt.",
      },
      country: {
        type: "string",
        description:
          "ISO 3166-1 alpha-2 country filter (e.g. US, GB, DE). Returns jobs in that country or workplace_type remote.",
      },
      exclude_ids: {
        type: "string",
        description:
          "Comma-separated job IDs to exclude (e.g. postings already shown in the conversation).",
      },
      near_lat: {
        type: "number",
        description:
          "Latitude for distance search. Use with near_lng. Typical source: browser geolocation or geocoded city.",
      },
      near_lng: {
        type: "number",
        description: "Longitude for distance search. Required with near_lat.",
      },
      radius_km: {
        type: "number",
        description: "Radius in kilometers around near_lat/near_lng. Default 50, max 500.",
        minimum: 1,
        maximum: 500,
      },
      exclude_remote: {
        type: "boolean",
        description:
          "When using near_lat/near_lng: false includes remote-only jobs; true (default) excludes them so results are geographically local.",
      },
      limit: {
        type: "number",
        description: "Number of results to return. Default 10, max 50.",
        minimum: 1,
        maximum: 50,
      },
      cursor: {
        type: "string",
        description: "Pagination cursor from a previous search_jobs response to fetch the next page.",
      },
    },
  },
};

export interface SearchJobsArgs {
  query?: string;
  /** Extra tokens merged with query into API title=; query may include `-term` title exclusions. */
  keywords?: string;
  company?: string;
  location?: string;
  /** Comma-separated — jobs matching ANY term in location strings (multi-metro). */
  location_or?: string;
  employment_type?: string;
  workplace_type?: string;
  seniority_level?: string;
  posted_within_days?: number;
  salary_min?: number;
  visa_sponsorship?: "yes" | "no";
  description_language?: string;
  country?: string;
  exclude_ids?: string;
  near_lat?: number;
  near_lng?: number;
  radius_km?: number;
  exclude_remote?: boolean;
  limit?: number;
  cursor?: string;
}

function formatSalary(salary: Job["salary"]): string | null {
  if (!salary) return null;
  const range =
    salary.min && salary.max
      ? `${salary.min.toLocaleString()}–${salary.max.toLocaleString()}`
      : salary.min
        ? `${salary.min.toLocaleString()}+`
        : salary.max
          ? `up to ${salary.max.toLocaleString()}`
          : null;
  if (!range) return null;
  return `${salary.currency} ${range}/${salary.period}`;
}

function formatJobSnippet(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    company: {
      name: job.company.name,
      website: job.company.website_url ?? null,
      logo: job.company.logo_url ?? null,
      industry: job.company.industry ?? null,
      employee_count: job.company.employee_count ?? null,
      employee_count_range: job.company.employee_count_range ?? null,
      hq: job.company.headquarters
        ? { city: job.company.headquarters.city, country: job.company.headquarters.country }
        : null,
    },
    locations: job.locations ?? [],
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    seniority_level: job.seniority_level ?? null,
    experience_years_min: job.experience_years_min ?? null,
    job_city: job.job_city ?? null,
    job_country: job.job_country ?? null,
    posted_at: job.posted_at,
    apply_url: job.apply_url,
    summary: job.job_summary ?? null,
    salary: formatSalary(job.salary),
    visa_sponsorship: job.visa_sponsorship ?? null,
  };
}

function parseExcludeIds(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 64);
}

/** Merge query + keywords into GET /jobs `title`; supports `-term` title exclusions. */
function buildListJobsTitle(args: SearchJobsArgs): string | undefined {
  const a = args.query?.trim() ?? "";
  const b = args.keywords?.trim() ?? "";
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

export async function runSearchJobs(
  client: JobsApiClient,
  args: SearchJobsArgs
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 10, 50);

  const MAX_POSTED_DAYS = 30;
  const rawDays = args.posted_within_days;
  const since =
    rawDays != null &&
    Number.isFinite(Number(rawDays)) &&
    Number(rawDays) > 0
      ? Math.floor(Date.now() / 1000) -
        Math.min(
          Math.max(Math.floor(Number(rawDays)), 1),
          MAX_POSTED_DAYS
        ) *
          86400
      : undefined;

  const response = await client.listJobs({
    title: buildListJobsTitle(args),
    company: args.company,
    location: args.location_or ? undefined : args.location,
    location_or: args.location_or,
    employment_type: args.employment_type,
    workplace_type: args.workplace_type,
    seniority_level: args.seniority_level,
    since,
    salary_min: args.salary_min,
    visa_sponsorship: args.visa_sponsorship,
    description_language: args.description_language,
    country: args.country,
    exclude_ids: parseExcludeIds(args.exclude_ids),
    near_lat: args.near_lat,
    near_lng: args.near_lng,
    radius_km: args.radius_km,
    exclude_remote: args.exclude_remote,
    limit,
    cursor: args.cursor,
  });

  const jobs = response.data.map(formatJobSnippet);

  // Surface company metadata when filtering to a single company
  const firstJob = response.data[0];
  const companyMeta =
    args.company && firstJob
      ? {
          name: firstJob.company.name,
          description: firstJob.company.description ?? null,
          website: firstJob.company.website_url ?? null,
          linkedin: firstJob.company.linkedin_url ?? null,
          glassdoor: firstJob.company.glassdoor_url ?? null,
          industry: firstJob.company.industry ?? null,
          company_type: firstJob.company.company_type ?? null,
          employee_count: firstJob.company.employee_count ?? null,
          employee_count_range: firstJob.company.employee_count_range ?? null,
          founded_year: firstJob.company.founded_year ?? null,
          total_funding_usd: firstJob.company.total_funding_usd ?? null,
          headquarters: firstJob.company.headquarters ?? null,
          office_locations: firstJob.company.locations ?? [],
        }
      : null;

  return {
    ...(companyMeta ? { company: companyMeta } : {}),
    jobs,
    total_available: response.meta.total,
    returned: jobs.length,
    has_more: response.meta.next_cursor !== null,
    next_cursor: response.meta.next_cursor,
    empty_note:
      jobs.length === 0
        ? args.company
          ? `No open roles found for '${args.company}'. ACTION REQUIRED: immediately call search_jobs again without the company filter, using relevant role keywords as query instead. Do not ask the user — just show them related results.`
          : "No jobs matched. ACTION REQUIRED: immediately retry with broader keywords or remove filters — do not ask the user to rephrase."
        : null,
  };
}
