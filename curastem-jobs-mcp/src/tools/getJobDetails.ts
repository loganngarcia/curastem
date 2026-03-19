/**
 * MCP tool: get_job_details
 *
 * Fetches a single job by ID with full AI-enriched details.
 * Triggers lazy AI extraction on the API side for jobs not yet enriched.
 *
 * Use this when a user clicks on a job, asks "tell me more about this job",
 * or when you need the full structured job_description (responsibilities,
 * qualifications) to answer a detailed question.
 *
 * Returns more information than search_jobs/get_recent_jobs because it
 * calls the detail endpoint which includes:
 *   - Full structured job_description (responsibilities, qualifications)
 *   - AI-generated job_summary (if not already present)
 *   - Full company metadata
 */

import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

export const getJobDetailsTool: McpTool = {
  name: "get_job_details",
  description:
    "Fetch detailed information about a specific job, including full responsibilities, qualifications, and company details. Use this after search_jobs or get_recent_jobs when a user wants to know more about a particular job. Requires the job's ID from a previous search result.",
  inputSchema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID from a previous search_jobs or get_recent_jobs result.",
      },
    },
    required: ["job_id"],
  },
};

export interface GetJobDetailsArgs {
  job_id: string;
}

export async function runGetJobDetails(
  client: JobsApiClient,
  args: GetJobDetailsArgs
): Promise<unknown> {
  const job = await client.getJob(args.job_id);

  // Return the full structured job — agent can use any field to answer user questions
  return {
    id: job.id,
    title: job.title,
    posted_at: job.posted_at,
    apply_url: job.apply_url,
    location: job.locations?.[0] ?? "Not specified",
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    source_name: job.source_name,
    salary: job.salary
      ? {
          range: formatSalaryRange(job.salary),
          ...job.salary,
        }
      : null,
    summary: job.job_summary ?? null,
    description: job.job_description
      ? {
          responsibilities: job.job_description.responsibilities,
          minimum_qualifications: job.job_description.minimum_qualifications,
          preferred_qualifications: job.job_description.preferred_qualifications,
        }
      : null,
    company: {
      name: job.company.name,
      description: job.company.description ?? null,
      website: job.company.website_url ?? null,
      linkedin: job.company.linkedin_url ?? null,
      glassdoor: job.company.glassdoor_url ?? null,
      x: job.company.x_url ?? null,
      logo: job.company.logo_url ?? null,
    },
  };
}

interface SalaryInput {
  min: number | null;
  max: number | null;
  currency: string;
  period: string;
}

function formatSalaryRange(salary: SalaryInput): string | null {
  const { min, max, currency, period } = salary;
  if (!min && !max) return null;
  const range =
    min && max
      ? `${min.toLocaleString()}–${max.toLocaleString()}`
      : min
        ? `${min.toLocaleString()}+`
        : `up to ${max!.toLocaleString()}`;
  return `${currency} ${range}/${period}`;
}
