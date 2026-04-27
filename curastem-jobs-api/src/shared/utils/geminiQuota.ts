import { logger } from "./logger.ts";

const GEMINI_PAID_TIER_RPM = 120;
const GEMINI_PAID_TIER_RPD = 1200;
const MINUTE_TTL_SECONDS = 90;
const DAY_TTL_SECONDS = 36 * 60 * 60;

export type GeminiQuotaResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: "minute" | "day" };

function minuteBucket(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const m = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}${h}${m}`;
}

function pacificDayBucket(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}${parts.month}${parts.day}`;
}

/**
 * Project-level Gemini guard for Google AI Studio paid Tier 1.
 *
 * Google applies Gemini limits per project, not per API key. The exact live
 * limit must be checked in AI Studio, and preview models can be stricter.
 * Tier 1 is commonly much higher than this, so these caps leave room for
 * Google-side variance while still stopping runaway browser retry loops.
 */
export async function reserveGeminiQuota(
  kv: KVNamespace,
  scope: string,
  requestCost = 1
): Promise<GeminiQuotaResult> {
  const cost = Math.max(1, Math.floor(requestCost));
  const minuteKey = `gemini_quota:minute:${minuteBucket()}`;
  const dayKey = `gemini_quota:day:${pacificDayBucket()}`;
  try {
    const [minuteRaw, dayRaw] = await Promise.all([kv.get(minuteKey), kv.get(dayKey)]);
    const minuteCount = minuteRaw ? parseInt(minuteRaw, 10) || 0 : 0;
    const dayCount = dayRaw ? parseInt(dayRaw, 10) || 0 : 0;

    if (minuteCount + cost > GEMINI_PAID_TIER_RPM) {
      logger.warn("gemini_quota_limited", {
        scope,
        reason: "minute",
        limit: GEMINI_PAID_TIER_RPM,
        current: minuteCount,
        cost,
      });
      return { allowed: false, retryAfterSeconds: 60, reason: "minute" };
    }
    if (dayCount + cost > GEMINI_PAID_TIER_RPD) {
      logger.warn("gemini_quota_limited", {
        scope,
        reason: "day",
        limit: GEMINI_PAID_TIER_RPD,
        current: dayCount,
        cost,
      });
      return { allowed: false, retryAfterSeconds: 60 * 60, reason: "day" };
    }

    await Promise.all([
      kv.put(minuteKey, String(minuteCount + cost), {
        expirationTtl: MINUTE_TTL_SECONDS,
      }),
      kv.put(dayKey, String(dayCount + cost), {
        expirationTtl: DAY_TTL_SECONDS,
      }),
    ]);
    return { allowed: true };
  } catch (err) {
    logger.warn("gemini_quota_check_failed", { scope, error: String(err) });
    return { allowed: true };
  }
}

export function geminiQuotaResponse(result: Exclude<GeminiQuotaResult, { allowed: true }>): Response {
  const resp = new Response(
    JSON.stringify({
      error: {
        code: "GEMINI_RATE_LIMITED",
        message: "Gemini project quota is temporarily busy. Please retry shortly.",
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSeconds),
      },
    }
  );
  return resp;
}
