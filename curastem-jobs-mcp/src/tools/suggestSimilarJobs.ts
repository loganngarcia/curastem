/**
 * MCP tool: suggest_similar_jobs
 *
 * Given a job the user is looking at, returns other open jobs with a
 * similar title at different companies.
 *
 * WHY THIS EXISTS:
 *   "If I like this role, show me similar ones elsewhere" is one of the
 *   most natural follow-up requests in a jobs chat interface. This tool
 *   supports that interaction without requiring the user to re-state
 *   their criteria from scratch.
 *
 * HOW IT WORKS:
 *   1. Fetches the source job to extract its title, location, and type.
 *   2. Searches for jobs with similar title keywords.
 *   3. Filters out the original job from results.
 *
 *   This is a best-effort similarity — it uses keyword overlap rather
 *   than vector embeddings. For the early stage this is fast, free, and
 *   good enough. A semantic similarity layer can replace the search call
 *   later when vector infrastructure is available.
 *
 * AGENT USAGE:
 *   Call this after get_job_details or when the user says "show me
 *   more jobs like this one" after viewing a specific role.
 */

import type { JobsApiClient } from "../client.ts";
import type { Job, McpTool } from "../types.ts";

export const suggestSimilarJobsTool: McpTool = {
  name: "suggest_similar_jobs",
  description: [
    "Suggests other open jobs similar to a job the user is currently viewing.",
    "Use this when a user says 'show me more like this', 'similar roles elsewhere',",
    "or 'other jobs like this one'. Requires a job_id from a previous search result.",
    "Finds jobs with matching title keywords at other companies.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The ID of the job to find similar roles for.",
      },
      limit: {
        type: "number",
        description: "Number of similar jobs to return. Default 5, max 10.",
        minimum: 1,
        maximum: 10,
      },
    },
    required: ["job_id"],
  },
};

export interface SuggestSimilarJobsArgs {
  job_id: string;
  limit?: number;
}

/**
 * Extract a useful search query from a job title.
 * We strip seniority prefixes and suffixes so "Senior Software Engineer"
 * searches for "software engineer" and finds adjacent levels too.
 */
function extractSearchQuery(title: string): string {
  return title
    .replace(/\b(senior|junior|lead|principal|staff|associate|entry.level|mid.level)\b/gi, "")
    .replace(/\bI{1,3}$|\bIV$|\b[0-9]+$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function formatSimilarJob(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    company: job.company.name,
    location: job.locations?.[0] ?? "Not specified",
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    posted_at: job.posted_at,
    apply_url: job.apply_url,
    salary: job.salary
      ? { min: job.salary.min, max: job.salary.max, currency: job.salary.currency, period: job.salary.period }
      : null,
  };
}

export async function runSuggestSimilarJobs(
  client: JobsApiClient,
  args: SuggestSimilarJobsArgs
): Promise<unknown> {
  const limit = Math.min(args.limit ?? 5, 10);

  // Step 1: fetch the source job to learn its title and context
  let sourceJob: Job;
  try {
    sourceJob = await client.getJob(args.job_id);
  } catch {
    return {
      similar_jobs: [],
      source_job: null,
      note: `Could not find job with ID '${args.job_id}'. The job may have been removed.`,
    };
  }

  // Step 2: build a keyword query from the source job title
  const query = extractSearchQuery(sourceJob.title);

  // Request more than needed so we can filter out the exact source job
  const response = await client.listJobs({
    q: query,
    limit: limit + 1,
  });

  // Step 3: exclude the source job from results
  const similar = response.data
    .filter((j) => j.id !== args.job_id)
    .slice(0, limit)
    .map(formatSimilarJob);

  return {
    source_job: {
      id: sourceJob.id,
      title: sourceJob.title,
      company: sourceJob.company.name,
    },
    search_query_used: query,
    similar_jobs: similar,
    returned: similar.length,
    note:
      similar.length === 0
        ? `No similar roles found for '${query}'. The job database may not have matching titles yet.`
        : null,
  };
}
