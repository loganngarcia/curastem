/**
 * GET /stats — market overview endpoint.
 *
 * Returns aggregate statistics about the current state of the job database.
 * Designed for:
 *   - The Curastem web app's homepage counters and visualizations
 *   - The MCP get_market_overview tool
 *   - Internal monitoring of ingestion health
 *
 * All counts are fetched in a single D1 batch (one round-trip) so this
 * endpoint is fast even on a large dataset. Results are not cached at
 * the API layer — the database query itself is cheap enough that caching
 * adds more complexity than it saves at this scale.
 *
 * Response shape is intentionally flat and simple so frontends can
 * consume it without transformation.
 */

import { getMarketStats } from "../db/queries.ts";
import type { Env } from "../types.ts";
import { jsonOk } from "../utils/errors.ts";
import { authenticate, recordKeyUsage } from "../middleware/auth.ts";
import { checkRateLimit } from "../middleware/rateLimit.ts";

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

  const stats = await getMarketStats(env.JOBS_DB);
  return jsonOk(stats);
}
