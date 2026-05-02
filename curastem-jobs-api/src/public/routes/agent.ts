import { AGENT_TOOL_DECLARATIONS, executeAgentTool } from "../../app/agent/tools.ts";
import type { AgentToolName } from "../../app/agent/types.ts";
import { authenticate, recordKeyUsage } from "../../shared/middleware/auth.ts";
import { checkRateLimit } from "../../shared/middleware/rateLimit.ts";
import type { Env } from "../../shared/types.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import {
  ensureSufficientBalance,
  finalizeMeteredUsage,
  minimumEstimatedChargeForTool,
  requireMeteredPrincipal,
} from "../../shared/utils/publicBilling.ts";

interface PublicAgentToolRequest {
  name?: AgentToolName;
  args?: unknown;
  searchParams?: string;
}

function isPublicAgentTool(name: unknown): name is AgentToolName {
  return name === "search_jobs" ||
    name === "get_job_details" ||
    name === "create_resume" ||
    name === "create_cover_letter";
}

export function handlePublicAgentTools(): Response {
  const publicTools = AGENT_TOOL_DECLARATIONS.filter((tool) => isPublicAgentTool(tool.name));
  return jsonOk({ tools: [{ functionDeclarations: publicTools }] });
}

export async function handlePublicAgentTool(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const auth = await authenticate(request, env.JOBS_DB);
  if (!auth.ok) return auth.response;
  const rateCheck = await checkRateLimit(env.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;
  recordKeyUsage(env.JOBS_DB, auth.key.id, ctx);

  const principal = await requireMeteredPrincipal(request, auth.key);
  if (principal instanceof Response) return principal;

  const body = await request.json().catch(() => null) as PublicAgentToolRequest | null;
  if (!body?.name || !isPublicAgentTool(body.name)) {
    return Errors.badRequest("name must be one of search_jobs, get_job_details, create_resume, create_cover_letter");
  }

  const preflight = await ensureSufficientBalance(
    env,
    principal.account_id,
    minimumEstimatedChargeForTool(body.name)
  );
  if (preflight) {
    await finalizeMeteredUsage(env, principal, "/agent/tool", body.name, null, "rejected", {
      reason: "insufficient_balance_preflight",
    });
    return preflight;
  }

  const searchParams = body.searchParams ? new URLSearchParams(body.searchParams) : undefined;
  const result = await executeAgentTool(env, body.name, body.args ?? {}, { searchParams });
  const billing = await finalizeMeteredUsage(
    env,
    principal,
    "/agent/tool",
    body.name,
    result.usage ?? null,
    "succeeded",
    { event_count: result.events.length }
  );
  return jsonOk({
    ...result,
    billing,
  });
}
