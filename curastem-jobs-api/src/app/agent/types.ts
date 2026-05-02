import type { PublicJob } from "../../shared/types.ts";

export type AgentToolName =
  | "search_jobs"
  | "get_job_details"
  | "open_job_details"
  | "open_docs"
  | "open_maps"
  | "open_whiteboard"
  | "open_app_editor"
  | "create_resume"
  | "create_cover_letter"
  | "create_app"
  | "create_doc"
  | "edit_doc"
  | "edit_app"
  | "draw_whiteboard"
  | "edit_whiteboard"
  | "erase_whiteboard"
  | "save_resume"
  | "retrieve_resume"
  | "retrieve_resources"
  | "retrieve_memories"
  | "save_memories"
  | "edit_memories";

export interface AgentFunctionDeclaration {
  name: AgentToolName;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentJobSnippet {
  id: string;
  title: string;
  company: string;
  company_logo: string | null;
  locations: string[] | null;
  employment_type: string | null;
  workplace_type: string | null;
  seniority_level: string | null;
  posted_at: string | null;
  apply_url: string | null;
  summary: string | null;
  salary: string | null;
  visa_sponsorship: string | null;
}

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "job_cards"; jobs: AgentJobSnippet[] }
  | { type: "job_detail"; job: PublicJob | Record<string, unknown> | null }
  | { type: "screen_open"; target: "job_details" | "docs" | "maps" | "whiteboard" | "app_editor"; job?: PublicJob | Record<string, unknown> | null; company?: string | null }
  | { type: "doc_update"; html: string; docType?: "doc" | "resume" | "cover_letter"; pdf_base64?: string; pdf_filename?: string }
  | { type: "doc_patch"; operations: Array<Record<string, unknown>>; docType?: "doc" | "resume" | "cover_letter" }
  | { type: "app_update"; html: string }
  | { type: "app_patch"; operations: Array<Record<string, unknown>> }
  | { type: "resume_update"; content: string | null }
  | { type: "resources"; resources: Array<Record<string, unknown>> }
  | { type: "whiteboard_command"; command: Record<string, unknown> }
  | { type: "memory_update"; result: Record<string, unknown> }
  | { type: "tool_error"; tool: string; message: string };

export interface AgentToolResult {
  events: AgentEvent[];
  functionResponse: Record<string, unknown>;
  usage?: {
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    raw_cost_usd_micros: number;
    charged_usd_micros: number;
  };
}
