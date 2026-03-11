/**
 * Typed HTTP client for the curastem-jobs-api.
 *
 * This module is the only place in the MCP server that makes HTTP requests
 * to the jobs API. It handles authentication, error normalization, and
 * type-safe response parsing.
 *
 * The MCP tools call this client — they do not construct URLs or handle
 * auth headers directly. This keeps all API coupling in one file.
 */

import type { Env, Job, JobsListResponse, MarketStatsResponse } from "./types.ts";

export class JobsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "JobsApiError";
  }
}

export interface ListJobsParams {
  q?: string | undefined;
  location?: string | undefined;
  employment_type?: string | undefined;
  workplace_type?: string | undefined;
  company?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/**
 * Typed client for the Curastem Jobs REST API.
 * Constructed per-request with the current environment bindings.
 */
export class JobsApiClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(env: Env) {
    this.baseUrl = env.JOBS_API_BASE_URL.replace(/\/$/, "");
    this.authHeader = `Bearer ${env.JOBS_API_KEY}`;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "User-Agent": "curastem-jobs-mcp/1.0",
      },
    });

    if (!res.ok) {
      let code = "API_ERROR";
      let message = `Jobs API returned ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: { code?: string; message?: string } };
        code = errBody.error?.code ?? code;
        message = errBody.error?.message ?? message;
      } catch {
        // Non-JSON error body — use defaults
      }
      throw new JobsApiError(res.status, code, message);
    }

    return res.json() as Promise<T>;
  }

  /**
   * List jobs with optional filtering and cursor pagination.
   */
  async listJobs(params: ListJobsParams): Promise<JobsListResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.location) qs.set("location", params.location);
    if (params.employment_type) qs.set("employment_type", params.employment_type);
    if (params.workplace_type) qs.set("workplace_type", params.workplace_type);
    if (params.company) qs.set("company", params.company);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);

    const query = qs.toString();
    return this.request<JobsListResponse>(`/jobs${query ? `?${query}` : ""}`);
  }

  /**
   * Fetch a single job by ID. Triggers lazy AI enrichment on first call.
   */
  async getJob(id: string): Promise<Job> {
    return this.request<Job>(`/jobs/${encodeURIComponent(id)}`);
  }

  /**
   * Fetch aggregate market statistics (total jobs, top companies, breakdowns).
   * Calls GET /stats on the jobs API.
   */
  async getStats(): Promise<MarketStatsResponse> {
    return this.request<MarketStatsResponse>("/stats");
  }
}
