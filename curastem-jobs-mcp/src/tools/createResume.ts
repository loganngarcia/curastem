import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

export const createResumeTool: McpTool = {
  name: "create_resume",
  description:
    "Create a polished one-page resume. Optional resume/profile/job context may be provided; if omitted, returns a useful editable starter resume. Returns HTML plus a base64 one-page PDF.",
  inputSchema: {
    type: "object",
    properties: {
      resume_text: { type: "string" },
      profile: { type: "object" },
      job_id: { type: "string" },
      job_context: { type: "object" },
      instructions: { type: "string" },
    },
  },
};

export interface CreateResumeArgs {
  resume_text?: string;
  profile?: Record<string, unknown>;
  job_id?: string;
  job_context?: Record<string, unknown>;
  instructions?: string;
}

export async function runCreateResume(client: JobsApiClient, args: CreateResumeArgs): Promise<unknown> {
  return client.callAgentTool("create_resume", args);
}
