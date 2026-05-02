import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

export const createCoverLetterTool: McpTool = {
  name: "create_cover_letter",
  description:
    "Create a polished one-page cover letter. Optional resume/profile/job context may be provided; if omitted, returns a useful editable starter cover letter. Returns HTML plus a base64 one-page PDF.",
  inputSchema: {
    type: "object",
    properties: {
      resume_text: { type: "string" },
      profile: { type: "object" },
      job_id: { type: "string" },
      job_context: { type: "object" },
      company: { type: "string" },
      role: { type: "string" },
      instructions: { type: "string" },
    },
  },
};

export interface CreateCoverLetterArgs {
  resume_text?: string;
  profile?: Record<string, unknown>;
  job_id?: string;
  job_context?: Record<string, unknown>;
  company?: string;
  role?: string;
  instructions?: string;
}

export async function runCreateCoverLetter(
  client: JobsApiClient,
  args: CreateCoverLetterArgs
): Promise<unknown> {
  return client.callAgentTool("create_cover_letter", args);
}
