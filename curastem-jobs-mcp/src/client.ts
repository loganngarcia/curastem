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
  /** Broad search (Vectorize + SQL). Supports `-term` title exclusions. Prefer `title` for role-only matching. */
  q?: string | undefined;
  /** Job title match only — supports comma-separated roles and `-term` exclusions. */
  title?: string | undefined;
  location?: string | undefined;
  /** Comma-separated — match if job locations contain ANY term (multi-metro). */
  location_or?: string | undefined;
  employment_type?: string | undefined;
  workplace_type?: string | undefined;
  seniority_level?: string | undefined;
  /** Comma-separated company slugs = OR match (e.g. meta,google,apple). */
  company?: string | undefined;
  since?: number | undefined;
  salary_min?: number | undefined;
  /** Only jobs where enrichment recorded sponsorship (yes) or explicitly no (no). */
  visa_sponsorship?: "yes" | "no" | undefined;
  /** ISO 639-1 code — e.g. en, es, de */
  description_language?: string | undefined;
  /** ISO 3166-1 alpha-2 — jobs in this country or remote. */
  country?: string | undefined;
  /** Omit these job IDs (comma-separated in the query string). */
  exclude_ids?: string[] | undefined;
  /** With near_lng — return jobs within radius_km (default 50). Requires geocoded listings. */
  near_lat?: number | undefined;
  near_lng?: number | undefined;
  radius_km?: number | undefined;
  /** When using near_* , set false to include remote-only jobs (default true). */
  exclude_remote?: boolean | undefined;
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
    if (params.title) qs.set("title", params.title);
    if (params.location) qs.set("location", params.location);
    if (params.location_or) qs.set("location_or", params.location_or);
    if (params.employment_type) qs.set("employment_type", params.employment_type);
    if (params.workplace_type) qs.set("workplace_type", params.workplace_type);
    if (params.seniority_level) qs.set("seniority_level", params.seniority_level);
    if (params.company) qs.set("company", params.company);
    if (params.since) qs.set("since", String(params.since));
    if (params.salary_min !== undefined) qs.set("salary_min", String(params.salary_min));
    if (params.visa_sponsorship === "yes" || params.visa_sponsorship === "no") {
      qs.set("visa_sponsorship", params.visa_sponsorship);
    }
    if (params.description_language) qs.set("description_language", params.description_language);
    if (params.country) qs.set("country", params.country.slice(0, 2).toUpperCase());
    if (params.exclude_ids?.length) qs.set("exclude_ids", params.exclude_ids.join(","));
    if (params.near_lat !== undefined) qs.set("near_lat", String(params.near_lat));
    if (params.near_lng !== undefined) qs.set("near_lng", String(params.near_lng));
    if (params.radius_km !== undefined) qs.set("radius_km", String(params.radius_km));
    if (params.exclude_remote === false) qs.set("exclude_remote", "false");
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

  async callAgentTool(name: string, args: unknown): Promise<unknown> {
    return this.post<unknown>("/v1/agent/tool", { name, args });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "curastem-jobs-mcp/1.0",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let code = "API_ERROR";
      let message = `Jobs API returned ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: { code?: string; message?: string } };
        code = errBody.error?.code ?? code;
        message = errBody.error?.message ?? message;
      } catch {}
      throw new JobsApiError(res.status, code, message);
    }
    return res.json() as Promise<T>;
  }
}
