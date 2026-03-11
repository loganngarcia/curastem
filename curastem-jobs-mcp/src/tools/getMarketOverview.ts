/**
 * MCP tool: get_market_overview
 *
 * Returns aggregate statistics about the current state of the job market
 * as indexed by Curastem.
 *
 * WHY THIS EXISTS:
 *   Agents — and the humans working with them — often start a session
 *   with a broad question: "what does the job market look like?", "how
 *   many remote jobs are available?", "which companies are hiring the
 *   most right now?". This tool answers those questions with real numbers
 *   rather than leaving the model to invent them.
 *
 *   It is also useful for enterprise customers who want a programmatic
 *   view of hiring trends, labor market signals, or sourcing data.
 *
 * DATA FRESHNESS:
 *   Statistics reflect the live D1 database at query time. Ingestion
 *   runs hourly so numbers are at most 1 hour stale. The response
 *   includes a note about data freshness for agents to surface to users.
 *
 * WHAT IT RETURNS:
 *   - Total jobs indexed, broken down by recency (24h / 7d / 30d)
 *   - Breakdown by employment type (full_time, part_time, contract, etc.)
 *   - Breakdown by workplace type (remote, hybrid, on_site)
 *   - Top 10 companies by open role count
 *   - Total companies and active sources in the index
 */

import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

export const getMarketOverviewTool: McpTool = {
  name: "get_market_overview",
  description: [
    "Returns aggregate statistics about the current job market as indexed by Curastem.",
    "Use this when a user asks broad questions like 'what jobs are available?',",
    "'how many remote jobs are there?', 'which companies are hiring the most?',",
    "or 'what does the job market look like right now?'.",
    "Also useful for enterprise users who want hiring trend data or sourcing signals.",
    "No parameters required — just call it.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export type GetMarketOverviewArgs = Record<string, never>;

export async function runGetMarketOverview(
  client: JobsApiClient,
  _args: GetMarketOverviewArgs
): Promise<unknown> {
  const stats = await client.getStats();

  // Compute human-readable summaries for the agent to surface naturally
  const remoteCount =
    stats.by_workplace_type.find((t) => t.workplace_type === "remote")?.count ?? 0;
  const remotePercent =
    stats.total_jobs > 0
      ? Math.round((remoteCount / stats.total_jobs) * 100)
      : 0;

  const fullTimeCount =
    stats.by_employment_type.find((t) => t.employment_type === "full_time")?.count ?? 0;
  const partTimeCount =
    stats.by_employment_type.find((t) => t.employment_type === "part_time")?.count ?? 0;

  return {
    summary: {
      total_jobs: stats.total_jobs,
      jobs_added_last_24h: stats.jobs_last_24h,
      jobs_added_last_7_days: stats.jobs_last_7d,
      jobs_added_last_30_days: stats.jobs_last_30d,
      total_companies: stats.total_companies,
      active_ingestion_sources: stats.total_sources,
    },
    highlights: {
      remote_jobs: remoteCount,
      remote_percentage: `${remotePercent}%`,
      full_time_jobs: fullTimeCount,
      part_time_jobs: partTimeCount,
    },
    by_employment_type: stats.by_employment_type,
    by_workplace_type: stats.by_workplace_type,
    top_hiring_companies: stats.top_companies,
    data_note: "Job counts reflect Curastem's indexed data, updated hourly from public ATS sources.",
  };
}
