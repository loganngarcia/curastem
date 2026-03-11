/**
 * MCP tool: get_jobs_by_company
 *
 * Returns all open jobs at a specific company.
 *
 * WHY THIS EXISTS:
 *   A common agent interaction is "show me all jobs at Stripe" or
 *   "what is Airbnb hiring for right now?". search_jobs supports a
 *   company filter, but this tool makes the intent explicit and surfaces
 *   company metadata (website, LinkedIn, description) alongside the jobs
 *   so the agent has full context in one call.
 *
 * COMPANY IDENTIFICATION:
 *   Companies are identified by slug (lowercase-hyphenated name).
 *   Examples: "stripe", "walmart", "mcdonald-s", "whole-foods-market".
 *   The agent should derive the slug from the company name the user mentions.
 *   If the slug is unknown, the tool gracefully returns an empty jobs list
 *   rather than throwing an error, so the agent can respond helpfully.
 */

import type { JobsApiClient } from "../client.ts";
import type { Job, McpTool } from "../types.ts";

export const getJobsByCompanyTool: McpTool = {
  name: "get_jobs_by_company",
  description: [
    "Returns all currently open jobs at a specific company.",
    "Also returns company metadata (website, LinkedIn, description).",
    "Use this when a user asks 'what is [Company] hiring for?', 'show me jobs at [Company]',",
    "or 'does [Company] have any openings?'.",
    "Pass the company name as a lowercase slug: 'stripe', 'walmart', 'whole-foods-market'.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      company: {
        type: "string",
        description: [
          "Company name as a lowercase hyphenated slug.",
          "Examples: 'stripe', 'airbnb', 'walmart', 'target', 'whole-foods-market'.",
          "Derive this from the company name the user mentioned.",
        ].join(" "),
      },
      employment_type: {
        type: "string",
        description: "Optionally filter to a specific job type.",
        enum: ["full_time", "part_time", "contract", "internship", "temporary"],
      },
      workplace_type: {
        type: "string",
        description: "Optionally filter to a specific work arrangement.",
        enum: ["remote", "hybrid", "on_site"],
      },
      limit: {
        type: "number",
        description: "Max results. Default 20, max 50.",
        minimum: 1,
        maximum: 50,
      },
      cursor: {
        type: "string",
        description: "Pagination cursor from a previous response.",
      },
    },
    required: ["company"],
  },
};

export interface GetJobsByCompanyArgs {
  company: string;
  employment_type?: string;
  workplace_type?: string;
  limit?: number;
  cursor?: string;
}

function formatCompanyJob(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    location: job.location ?? "Not specified",
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    posted_at: job.posted_at,
    apply_url: job.apply_url,
    summary: job.job_summary ?? null,
    salary: job.salary
      ? { min: job.salary.min, max: job.salary.max, currency: job.salary.currency, period: job.salary.period }
      : null,
  };
}

export async function runGetJobsByCompany(
  client: JobsApiClient,
  args: GetJobsByCompanyArgs
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 20, 50);

  const response = await client.listJobs({
    company: args.company,
    employment_type: args.employment_type,
    workplace_type: args.workplace_type,
    limit,
    cursor: args.cursor,
  });

  const jobs = response.data.map(formatCompanyJob);

  // Surface company metadata from the first result (all jobs share the same company)
  const firstJob = response.data[0];
  const company = firstJob
    ? {
        name: firstJob.company.name,
        description: firstJob.company.description ?? null,
        website: firstJob.company.website_url ?? null,
        linkedin: firstJob.company.linkedin_url ?? null,
        glassdoor: firstJob.company.glassdoor_url ?? null,
        x: firstJob.company.x_url ?? null,
        logo: firstJob.company.logo_url ?? null,
      }
    : null;

  return {
    company,
    jobs,
    total_open_roles: response.meta.total,
    returned: jobs.length,
    has_more: response.meta.next_cursor !== null,
    next_cursor: response.meta.next_cursor,
    // Surface a helpful message for the agent when no jobs are found
    empty_note:
      jobs.length === 0
        ? `No open roles found for company slug '${args.company}'. The company may not be in the Curastem index yet, or the slug may be slightly different.`
        : null,
  };
}
