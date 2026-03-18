/**
 * MCP tool: get_job_keywords
 *
 * Returns only the skill and technology keywords extracted from a job description,
 * stripping away all narrative clutter (responsibilities prose, culture copy,
 * boilerplate requirements). Keywords are matched server-side from a curated
 * phrase list and returned as a clean array — no AI calls, no extra endpoints.
 *
 * Use this as the focused signal when generating resumes or cover letters:
 * passing the full job description to an AI for tailoring pollutes the context
 * with noise that degrades output quality. These keywords are the distilled
 * skill/tech surface area of the role.
 *
 * Use cases:
 *   - Tailoring resumes and cover letters to a specific job (primary)
 *   - Assessing skill overlap between a candidate profile and a role
 *   - Skills-gap analysis without processing noisy full descriptions
 */

import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

export const getJobKeywordsTool: McpTool = {
  name: "get_job_keywords",
  description:
    "Get only the skill and technology keywords extracted from a job description — " +
    "stripped of all narrative prose, responsibilities copy, and boilerplate clutter. " +
    "Use this as the focused input when tailoring a resume or cover letter to a specific " +
    "role: getting the full job description degrades resume/cover letter quality because the " +
    "extra words are too confusing. These keywords are the distilled skill/tech surface area " +
    "of the role. Also useful for skill-overlap assessment and skills-gap analysis. " +
    "Returns job_id, title, company, keywords array, and keyword_count. " +
    "Requires the job's ID from a previous search_jobs or get_recent_jobs result.",
  inputSchema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID to fetch keywords for.",
      },
    },
    required: ["job_id"],
  },
};

export interface GetJobKeywordsArgs {
  job_id: string;
}

export async function runGetJobKeywords(
  client: JobsApiClient,
  args: GetJobKeywordsArgs
): Promise<unknown> {
  const job = await client.getJob(args.job_id);

  return {
    job_id: job.id,
    title: job.title,
    company: job.company.name,
    keywords: (job as any).keywords ?? [],
    keyword_count: ((job as any).keywords ?? []).length,
  };
}
