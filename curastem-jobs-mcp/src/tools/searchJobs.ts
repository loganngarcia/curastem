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
    "Use for ANY job-finding request, including colloquial ones like 'big tech jobs', 'startup roles', 'patient now jobs'.",
    "Expand vague or colloquial terms into concrete search parameters: 'big tech' → query='software engineer' at Google/Meta/Apple/Amazon/Microsoft/NVIDIA/OpenAI.",
    "When a company search returns 0 results, IMMEDIATELY retry with a broader query (remove company filter, use role keywords instead) — never just ask the user to rephrase.",
    "Pass cursor from a previous response to paginate.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search keywords — job title, role, skill, or company name. Expand colloquial terms: 'big tech' → 'software engineer', 'startup' → relevant role title. Examples: 'cashier', 'software engineer', 'customer service'.",
      },
      company: {
        type: "string",
        description:
          "Filter to a specific company. Convert the user's words to a lowercase hyphenated slug: 'patient now' → 'patient-now', 'PatientNow' → 'patientnow', 'Whole Foods' → 'whole-foods-market'. Try the most likely slug first; if 0 results, drop this filter and use query instead.",
      },
      location: {
        type: "string",
        description:
          "City, state, or region to filter by. Examples: 'Austin TX', 'New York'. Leave empty for all locations.",
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
        description: "Experience level of the role.",
        enum: ["new_grad", "entry", "mid", "senior", "staff", "manager", "director", "executive"],
      },
      posted_within_days: {
        type: "number",
        description:
          "Only return jobs posted within this many days. Examples: 1 (today), 7 (this week), 30 (this month).",
        minimum: 1,
      },
      salary_min: {
        type: "number",
        description:
          "Minimum annual salary in the job's listed currency (usually USD). Only returns jobs where a salary is known and meets this threshold. Examples: 100000 for $100k, 150000 for $150k.",
        minimum: 0,
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
  company?: string;
  location?: string;
  employment_type?: string;
  workplace_type?: string;
  seniority_level?: string;
  posted_within_days?: number;
  salary_min?: number;
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
  };
}

export async function runSearchJobs(
  client: JobsApiClient,
  args: SearchJobsArgs
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 10, 50);

  // Convert posted_within_days to a unix timestamp for the `since` param
  const since = args.posted_within_days
    ? Math.floor(Date.now() / 1000) - args.posted_within_days * 86400
    : undefined;

  const response = await client.listJobs({
    q: args.query,
    company: args.company,
    location: args.location,
    employment_type: args.employment_type,
    workplace_type: args.workplace_type,
    seniority_level: args.seniority_level,
    since,
    salary_min: args.salary_min,
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
