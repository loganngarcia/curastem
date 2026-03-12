/**
 * KV-backed sliding window rate limiter.
 *
 * Strategy: fixed-window per minute keyed on (key_hash, minute_bucket).
 * This is not a true sliding window but is simple, cheap, and sufficient
 * for the early stage. Each counter expires after 90 seconds automatically
 * via KV TTL, so no cleanup job is needed.
 *
 * Key format: ratelimit:{key_hash}:{YYYYMMDDHHMM}
 *
 * At 60 req/min default with 90s TTL, the maximum number of KV entries
 * alive at once per API key is 2 (current minute + partial previous minute).
 * This is extremely cheap in Cloudflare KV pricing.
 */

import type { ApiKeyRow } from "../types.ts";
import { Errors } from "../utils/errors.ts";

function minuteBucket(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const m = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}${h}${m}`;
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; response: Response };

/**
 * Check whether the given API key is within its rate limit.
 *
 * Returns { allowed: true, remaining } on success.
 * Returns { allowed: false, response } when the limit is exceeded.
 *
 * The counter is incremented atomically using a KV read-then-write.
 * Under concurrent traffic, this can slightly over-count, but for
 * internal early-stage use this approximation is acceptable. A Durable
 * Object would provide exact atomicity if needed later.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: ApiKeyRow
): Promise<RateLimitResult> {
  try {
    const bucket = minuteBucket();
    const kvKey = `ratelimit:${key.key_hash}:${bucket}`;
    const limit = key.rate_limit_per_minute;

    const currentStr = await kv.get(kvKey);
    const current = currentStr ? parseInt(currentStr, 10) : 0;

    if (current >= limit) {
      return { allowed: false, response: Errors.rateLimited(60) };
    }

    // Fire-and-forget the counter increment — a failed write must not block
    // the request. If KV is temporarily over its daily write limit or
    // unavailable, the API stays up and rate limiting is simply skipped.
    kv.put(kvKey, String(current + 1), { expirationTtl: 90 }).catch(() => {});

    return { allowed: true, remaining: limit - current - 1 };
  } catch {
    // KV unavailable — allow the request through rather than rejecting all traffic
    return { allowed: true, remaining: -1 };
  }
}
