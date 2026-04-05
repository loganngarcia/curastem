/**
 * Shared types for the curastem-jobs-mcp server.
 *
 * These mirror the public API contract of curastem-jobs-api.
 * They are intentionally duplicated here (not imported from the API project)
 * so the MCP server has no build-time dependency on the API codebase —
 * only a runtime HTTP dependency.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Worker env
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  /** Base URL of the curastem-jobs-api (e.g. https://api.curastem.org) */
  JOBS_API_BASE_URL: string;
  /** Service account API key used by the MCP server to call the jobs API */
  JOBS_API_KEY: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// API response types (mirrors curastem-jobs-api public contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface JobCompany {
  name: string;
  logo_url: string | null;
  description: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  glassdoor_url: string | null;
  x_url: string | null;
  employee_count_range: string | null;
  employee_count: number | null;
  founded_year: number | null;
  headquarters: {
    address: string | null;
    city: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  industry: string | null;
  company_type: string | null;
  total_funding_usd: number | null;
  /** Unique job locations aggregated from all open postings. */
  locations: string[] | null;
}

export interface JobSalary {
  min: number | null;
  max: number | null;
  currency: string;
  period: "year" | "month" | "hour";
}

export interface JobDescription {
  responsibilities: string[];
  minimum_qualifications: string[];
  preferred_qualifications: string[];
}

export interface Job {
  id: string;
  title: string;
  company: JobCompany;
  posted_at: string;
  apply_url: string;
  /** Normalized location array. locations[0] is the primary display value. */
  locations: string[] | null;
  employment_type: string | null;
  workplace_type: string | null;
  seniority_level: string | null;
  source_name: string;
  source_url: string | null;
  salary: JobSalary | null;
  job_summary: string | null;
  job_description: JobDescription | null;
  /** Minimum years of experience required; e.g. "2-3 years" → 2. */
  experience_years_min: number | null;
  /** Street address from the posting. */
  job_address: string | null;
  /** Normalized city from the posting. */
  job_city: string | null;
  /** Country from the posting. */
  job_country: string | null;
  /** AI-extracted from posting text when explicit. */
  visa_sponsorship?: "yes" | "no" | null;
  /** Skill/technology keywords extracted from the description. Present on detail endpoint only. */
  keywords?: string[];
}

export interface JobsListResponse {
  data: Job[];
  meta: {
    total: number;
    limit: number;
    next_cursor: string | null;
  };
}

/** Response shape from GET /stats on the jobs API */
export interface MarketStatsResponse {
  total_jobs: number;
  jobs_last_24h: number;
  jobs_last_7d: number;
  jobs_last_30d: number;
  by_employment_type: Array<{ employment_type: string | null; count: number }>;
  by_workplace_type: Array<{ workplace_type: string | null; count: number }>;
  top_companies: Array<{ company_name: string; count: number }>;
  total_companies: number;
  total_sources: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP protocol types
// ─────────────────────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, McpPropertySchema>;
    required?: string[];
  };
}

export interface McpPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

export interface McpToolCallRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "tools/call";
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface McpListToolsRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "tools/list";
  params?: Record<string, never>;
}

export interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface McpSuccessResponse {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface McpErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
  };
}

// Standard JSON-RPC error codes
export const McpErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;
