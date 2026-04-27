/**
 * IP + user-scoped rate limiter for unauthenticated and credentialed auth
 * endpoints (auth, sync, uploads). This is distinct from middleware/rateLimit.ts
 * which is keyed by API key row — auth routes don't have API keys yet when
 * they're hit.
 *
 * Strategy: fixed-window per minute keyed on (scope, identifier, minute_bucket).
 * Counters expire after 90 seconds via KV TTL so no cleanup job is needed.
 *
 * Failure mode: if KV is unreachable we fail OPEN. The alternative (fail
 * closed) would take down auth for everyone any time KV has an incident,
 * which is a worse outcome than briefly accepting traffic we'd have
 * throttled. We log so we can spot anomalies.
 *
 * Identifier derivation:
 *   - If we have an authenticated user, key by `uid:{user_id}` — this is the
 *     most accurate signal since IP rotates on mobile and cellular.
 *   - Otherwise key by `ip:{cf-connecting-ip}`. The header is set by
 *     Cloudflare's edge and cannot be spoofed from outside.
 */

import type { Env } from "../../shared/types.ts";
import { logger } from "../../shared/utils/logger.ts";
import { Errors } from "../../shared/utils/errors.ts";

function minuteBucket(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const m = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}${h}${m}`;
}

/**
 * Return the best stable identifier for this request, preferring the user
 * id when present and falling back to the Cloudflare-set client IP.
 */
function identifierFor(request: Request, userId?: string | null): string {
  if (userId) return `uid:${userId}`;
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  return `ip:${ip}`;
}

export interface UserRateLimitOptions {
  /** Logical scope, e.g. "auth_firebase", "sync_delta". */
  scope: string;
  /** Max requests per minute for this identifier + scope. */
  limit: number;
  /** Optional user id; if present, rate-limits by uid instead of IP. */
  userId?: string | null;
}

/**
 * Enforce the rate limit. Returns null when allowed, or a 429 Response when
 * the caller should abort with that response.
 */
export async function enforceUserRateLimit(
  env: Env,
  request: Request,
  opts: UserRateLimitOptions
): Promise<Response | null> {
  try {
    const id = identifierFor(request, opts.userId);
    const bucket = minuteBucket();
    const kvKey = `urate:${opts.scope}:${id}:${bucket}`;
    const currentStr = await env.RATE_LIMIT_KV.get(kvKey);
    const current = currentStr ? parseInt(currentStr, 10) : 0;
    if (current >= opts.limit) {
      logger.warn("user_rate_limited", { scope: opts.scope, id, limit: opts.limit });
      return Errors.rateLimited(60);
    }
    // Fire-and-forget; rate limiting must never block the hot path.
    env.RATE_LIMIT_KV.put(kvKey, String(current + 1), { expirationTtl: 90 }).catch(() => {});
    return null;
  } catch (err) {
    logger.warn("user_rate_limit_check_failed", { error: String(err) });
    // Fail open — see module docstring for rationale.
    return null;
  }
}
