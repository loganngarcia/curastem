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
    "Use for any job-finding request: 'find remote software engineer roles', 'what is Stripe hiring for?',",
    "'show me entry-level marketing jobs posted this week'.",
    "Pass company as a lowercase slug (e.g. 'stripe', 'whole-foods-market') to filter to one company.",
    "Pass cursor from a previous response to paginate.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search keywords — job title, role, skill, or company name. Examples: 'cashier', 'software engineer', 'customer service'.",
      },
      company: {
        type: "string",
        description:
          "Filter to a specific company by lowercase hyphenated slug. Examples: 'stripe', 'airbnb', 'walmart', 'whole-foods-market'. Derive from the company name the user mentioned.",
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
    },
    location: job.locations?.[0] ?? null,
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    seniority_level: job.seniority_level ?? null,
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
          ? `No open roles found for company '${args.company}'. The slug may differ slightly — try a variation.`
          : "No jobs found matching those criteria. Try broader keywords or remove some filters."
        : null,
  };
}
