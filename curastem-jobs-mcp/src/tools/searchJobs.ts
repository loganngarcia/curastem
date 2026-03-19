/**
 * MCP tool: search_jobs
 *
 * Searches Curastem's job listings by keyword, location, and job type.
 * Designed for Gemini tool-calling — returns a concise list of job snippets
 * suitable for display in a conversational interface.
 *
 * When a user says "find me remote customer service jobs in Texas" or
 * "show me part-time retail jobs", this tool handles that query.
 */

import type { JobsApiClient } from "../client.ts";
import type { Job, McpTool } from "../types.ts";

export const searchJobsTool: McpTool = {
  name: "search_jobs",
  description:
    "Search Curastem's job listings. Use this when a user asks to find, search, or browse jobs by keyword, location, job type, or work arrangement. Returns a list of matching job snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search keywords — job title, role, skill, or company name. Examples: 'cashier', 'software engineer', 'Walmart', 'customer service'",
      },
      location: {
        type: "string",
        description: "City, state, or region to filter by. Examples: 'Austin TX', 'New York', 'Chicago'. Leave empty for all locations.",
      },
      employment_type: {
        type: "string",
        description: "Type of employment contract",
        enum: ["full_time", "part_time", "contract", "internship", "temporary"],
      },
      workplace_type: {
        type: "string",
        description: "Work arrangement",
        enum: ["remote", "hybrid", "on_site"],
      },
      limit: {
        type: "number",
        description: "Number of results to return. Default 10, max 20.",
        minimum: 1,
        maximum: 20,
      },
    },
  },
};

export interface SearchJobsArgs {
  query?: string;
  location?: string;
  employment_type?: string;
  workplace_type?: string;
  limit?: number;
}

/** Format a job into a compact snippet for agent display. */
function formatJobSnippet(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    company: job.company.name,
    location: job.locations?.[0] ?? "Not specified",
    employment_type: job.employment_type ?? "Not specified",
    workplace_type: job.workplace_type ?? "Not specified",
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

export async function runSearchJobs(
  client: JobsApiClient,
  args: SearchJobsArgs
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 10, 20);

  const response = await client.listJobs({
    q: args.query,
    location: args.location,
    employment_type: args.employment_type,
    workplace_type: args.workplace_type,
    limit,
  });

  const jobs = response.data.map(formatJobSnippet);

  return {
    jobs,
    total_available: response.meta.total,
    returned: jobs.length,
    has_more: response.meta.next_cursor !== null,
    next_cursor: response.meta.next_cursor,
    // Provide hint to the agent for follow-up calls
    usage_hint: response.meta.next_cursor
      ? "Pass next_cursor to get_recent_jobs or search_jobs to see more results."
      : null,
  };
}
