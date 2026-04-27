/**
 * GET /stats — market overview endpoint.
 *
 * Returns aggregate statistics about the current state of the job database.
 * Designed for:
 *   - The Curastem web app's homepage counters and visualizations
 *   - The MCP get_market_overview tool
 *   - Internal monitoring of ingestion health
 *
 * All counts are fetched in a single D1 batch (one round-trip). Responses are
 * cached in KV for five minutes to cap load as the jobs table grows.
 *
 * Response shape is intentionally flat and simple so frontends can
 * consume it without transformation.
 */

import { getMarketStats } from "../../shared/db/queries.ts";
import type { Env } from "../../shared/types.ts";
import { jsonOk } from "../../shared/utils/errors.ts";
import { authenticate, recordKeyUsage } from "../../shared/middleware/auth.ts";
import { checkRateLimit } from "../../shared/middleware/rateLimit.ts";

export async function handleGetStats(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const auth = await authenticate(request, env.JOBS_DB);
  if (!auth.ok) return auth.response;

  const rateCheck = await checkRateLimit(env.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;

  recordKeyUsage(env.JOBS_DB, auth.key.id, ctx);

  const stats = await getMarketStats(env.JOBS_DB, env.RATE_LIMIT_KV);
  return jsonOk(stats);
}
