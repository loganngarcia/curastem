/**
 * Curastem Jobs MCP Server — Cloudflare Worker entry point.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * OVERVIEW
 * ──────────────────────────────────────────────────────────────────────────
 * Implements the Model Context Protocol (MCP) over HTTP using JSON-RPC 2.0.
 * All tool calls are proxied to the curastem-jobs-api — no business logic
 * or database access lives in this server.
 *
 * This server is intentionally provider-agnostic. It works with any
 * MCP-compatible client: OpenAI, Anthropic Claude, Gemini, OpenRouter,
 * LlamaIndex, LangChain, or any custom agent. The transport is standard
 * JSON-RPC 2.0 over HTTP POST — no vendor-specific extensions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AVAILABLE TOOLS (5 total)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Discovery & search:
 *   search_jobs          — keyword + filter search; pass company= or posted_within_days= for recency
 *
 * Detail & comparison:
 *   get_job_details      — full job with AI-enriched structured description
 *   get_job_keywords     — skill/tech keywords extracted from a job description
 *   suggest_similar_jobs — jobs similar to one the user is viewing
 *
 * Market context:
 *   get_market_overview  — aggregate stats: counts, top companies, breakdowns
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TRANSPORT
 * ──────────────────────────────────────────────────────────────────────────
 * HTTP POST to / with Content-Type: application/json
 * JSON-RPC 2.0 protocol (https://www.jsonrpc.org/specification)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT SECRETS
 * ──────────────────────────────────────────────────────────────────────────
 * Required:
 *   JOBS_API_BASE_URL — base URL of curastem-jobs-api
 *   JOBS_API_KEY      — service account key for the jobs API
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ADDING A TOOL
 * ──────────────────────────────────────────────────────────────────────────
 * 1. Create src/tools/yourTool.ts with a McpTool schema and run() function.
 * 2. Import both exports below.
 * 3. Add the schema to ALL_TOOLS.
 * 4. Add a case to handleToolCall().
 * See ARCHITECTURE.md for the full step-by-step guide.
 */

import { JobsApiClient, JobsApiError } from "./client.ts";

// Tool definitions (JSON Schema for tools/list)
import { getJobDetailsTool } from "./tools/getJobDetails.ts";
import { searchJobsTool } from "./tools/searchJobs.ts";
import { suggestSimilarJobsTool } from "./tools/suggestSimilarJobs.ts";
import { getMarketOverviewTool } from "./tools/getMarketOverview.ts";
import { getJobKeywordsTool } from "./tools/getJobKeywords.ts";

// Tool runners (called on tools/call)
import { runGetJobDetails, type GetJobDetailsArgs } from "./tools/getJobDetails.ts";
import { runSearchJobs, type SearchJobsArgs } from "./tools/searchJobs.ts";
import { runSuggestSimilarJobs, type SuggestSimilarJobsArgs } from "./tools/suggestSimilarJobs.ts";
import { runGetMarketOverview } from "./tools/getMarketOverview.ts";
import { runGetJobKeywords, type GetJobKeywordsArgs } from "./tools/getJobKeywords.ts";

import type {
  Env,
  McpErrorResponse,
  McpListToolsRequest,
  McpRequest,
  McpSuccessResponse,
  McpToolCallRequest,
} from "./types.ts";
import { McpErrorCode } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Tool registry
//
// This is the complete list of tools exposed by this MCP server.
// Every tool here is schema-only — the runner logic lives in src/tools/.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TOOLS = [
  searchJobsTool,
  getJobDetailsTool,
  getJobKeywordsTool,
  suggestSimilarJobsTool,
  getMarketOverviewTool,
];

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 helpers
// ─────────────────────────────────────────────────────────────────────────────

function success(id: string | number, result: unknown): McpSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string
): McpErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Wrap a tool result in the MCP content envelope. */
function toolResult(id: string | number, data: unknown): McpSuccessResponse {
  return success(id, {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP method handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleListTools(req: McpListToolsRequest): McpSuccessResponse {
  return success(req.id, { tools: ALL_TOOLS });
}

async function handleToolCall(
  req: McpToolCallRequest,
  env: Env
): Promise<McpSuccessResponse | McpErrorResponse> {
  const { name, arguments: args } = req.params;
  const client = new JobsApiClient(env);

  try {
    let result: unknown;

    switch (name) {
      case "search_jobs":
        result = await runSearchJobs(client, args as SearchJobsArgs);
        break;

      case "get_job_details": {
        const detailArgs = args as unknown as GetJobDetailsArgs;
        if (!detailArgs.job_id) {
          return rpcError(req.id, McpErrorCode.InvalidParams, "job_id is required");
        }
        result = await runGetJobDetails(client, detailArgs);
        break;
      }

      case "suggest_similar_jobs": {
        const similarArgs = args as unknown as SuggestSimilarJobsArgs;
        if (!similarArgs.job_id) {
          return rpcError(req.id, McpErrorCode.InvalidParams, "job_id is required");
        }
        result = await runSuggestSimilarJobs(client, similarArgs);
        break;
      }

      case "get_job_keywords": {
        const kwArgs = args as unknown as GetJobKeywordsArgs;
        if (!kwArgs.job_id) {
          return rpcError(req.id, McpErrorCode.InvalidParams, "job_id is required");
        }
        result = await runGetJobKeywords(client, kwArgs);
        break;
      }

      case "get_market_overview":
        result = await runGetMarketOverview(client, {});
        break;

      default:
        return rpcError(req.id, McpErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return toolResult(req.id, result);
  } catch (err) {
    if (err instanceof JobsApiError) {
      if (err.status === 404) {
        return rpcError(req.id, McpErrorCode.InvalidParams, err.message);
      }
      if (err.status === 429) {
        return rpcError(req.id, McpErrorCode.InternalError, "Jobs API rate limit exceeded. Try again shortly.");
      }
      return rpcError(req.id, McpErrorCode.InternalError, `Jobs API error: ${err.message}`);
    }
    return rpcError(req.id, McpErrorCode.InternalError, `Tool execution failed: ${String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP method dispatcher
// ─────────────────────────────────────────────────────────────────────────────

async function dispatch(
  req: McpRequest,
  env: Env
): Promise<McpSuccessResponse | McpErrorResponse> {
  switch (req.method) {
    case "initialize":
      return success(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "curastem-jobs-mcp",
          version: "1.0.0",
          description: "Curastem Jobs MCP server — search, browse, and explore job listings",
        },
      });

    case "tools/list":
      return handleListTools(req as McpListToolsRequest);

    case "tools/call":
      return handleToolCall(req as McpToolCallRequest, env);

    default:
      return rpcError(req.id, McpErrorCode.MethodNotFound, `Method not found: ${req.method}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker export
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        rpcError(null, McpErrorCode.InvalidRequest, "MCP requires POST requests"),
        405
      );
    }

    if (!env.JOBS_API_BASE_URL || !env.JOBS_API_KEY) {
      return jsonResponse(
        rpcError(null, McpErrorCode.InternalError, "MCP server is misconfigured: JOBS_API_BASE_URL and JOBS_API_KEY must be set"),
        500
      );
    }

    let body: McpRequest;
    try {
      body = (await request.json()) as McpRequest;
    } catch {
      return jsonResponse(rpcError(null, McpErrorCode.ParseError, "Invalid JSON"), 400);
    }

    if (!body.jsonrpc || body.jsonrpc !== "2.0" || !body.method) {
      return jsonResponse(
        rpcError(body.id ?? null, McpErrorCode.InvalidRequest, "Invalid JSON-RPC 2.0 request"),
        400
      );
    }

    const result = await dispatch(body, env);
    return jsonResponse(result);
  },
};
