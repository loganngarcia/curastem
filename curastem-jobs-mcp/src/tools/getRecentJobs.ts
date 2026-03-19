/**
 * MCP tool: get_recent_jobs
 *
 * Returns the most recently posted jobs, with optional query and filters.
 *
 * WHY THIS EXISTS SEPARATELY FROM search_jobs:
 *   search_jobs is oriented around user-intent matching (find me X jobs).
 *   get_recent_jobs is oriented around recency-first discovery: "what are
 *   the latest barista jobs?" or "what just got posted near me?" The
 *   semantic difference matters in a chat interface — users want to
 *   discover fresh postings, not just search a static index.
 *
 * Both tools use the same underlying jobs API endpoint but differ in how
 * they present themselves to the model and what parameters they emphasize.
 *
 * In Curastem's chat interface this tool is the default when someone opens
 * the jobs feature or asks a general "what's available?" question.
 */

import type { JobsApiClient } from "../client.ts";
import type { Job, McpTool } from "../types.ts";

export const getRecentJobsTool: McpTool = {
  name: "get_recent_jobs",
  description: [
    "Returns the most recently posted jobs, sorted newest first.",
    "Accepts an optional query so you can find the latest jobs matching a role, keyword, or company.",
    "Use this when a user wants to discover what's new, asks 'what jobs are available?',",
    "'show me the latest cashier jobs', or opens the jobs feature without a specific search.",
    "Prefer search_jobs when the user has a precise intent; prefer get_recent_jobs for open-ended browsing.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: [
          "Optional keyword to narrow recent results.",
          "Examples: 'retail associate', 'barista', 'customer service', 'software engineer'.",
          "Leave empty to get the globally most recent jobs across all roles.",
        ].join(" "),
      },
      location: {
        type: "string",
        description: "Filter by city, state, or region. Examples: 'Chicago', 'Remote', 'New York'.",
      },
      employment_type: {
        type: "string",
        description: "Filter by contract type.",
        enum: ["full_time", "part_time", "contract", "internship", "temporary"],
      },
      workplace_type: {
        type: "string",
        description: "Filter by work arrangement.",
        enum: ["remote", "hybrid", "on_site"],
      },
      limit: {
        type: "number",
        description: "Number of results to return. Default 10, max 20.",
        minimum: 1,
        maximum: 20,
      },
      cursor: {
        type: "string",
        description: [
          "Opaque pagination cursor from a previous response's next_cursor.",
          "Pass this to continue loading more results in the same query context.",
        ].join(" "),
      },
    },
  },
};

export interface GetRecentJobsArgs {
  query?: string;
  location?: string;
  employment_type?: string;
  workplace_type?: string;
  limit?: number;
  cursor?: string;
}

function formatRecentJobSnippet(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    company: job.company.name,
    company_description: job.company.description ?? null,
    location: job.locations?.[0] ?? "Not specified",
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    posted_at: job.posted_at,
    apply_url: job.apply_url,
    summary: job.job_summary ?? null,
    salary: job.salary
      ? formatSalary(job.salary)
      : null,
  };
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

export async function runGetRecentJobs(
  client: JobsApiClient,
  args: GetRecentJobsArgs
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 10, 20);

  const response = await client.listJobs({
    q: args.query,
    location: args.location,
    employment_type: args.employment_type,
    workplace_type: args.workplace_type,
    limit,
    cursor: args.cursor,
  });

  const jobs = response.data.map(formatRecentJobSnippet);

  return {
    jobs,
    query: args.query ?? null,
    total_available: response.meta.total,
    returned: jobs.length,
    has_more: response.meta.next_cursor !== null,
    next_cursor: response.meta.next_cursor,
    // Agent hint: surfaced explicitly so the model can tell the user
    // how many more results are available without inferring from counts.
    pagination_note: response.meta.next_cursor
      ? `${response.meta.total - jobs.length} more results available. Pass next_cursor to load more.`
      : null,
  };
}
