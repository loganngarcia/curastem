/**
 * Circuit breaker for the ingestion cron.
 *
 * After 3 consecutive failures, we skip runs for 6 hours to avoid burning
 * Cloudflare/Gemini costs on repeated failing invocations.
 */

const KV_KEY_FAILURES = "cron_consecutive_failures";
const KV_KEY_SKIP_UNTIL = "cron_skip_until";
const FAILURE_THRESHOLD = 3;
const COOLDOWN_SECONDS = 6 * 3600; // 6 hours

export async function shouldSkipCron(kv: KVNamespace): Promise<boolean> {
  const failuresStr = await kv.get(KV_KEY_FAILURES);
  const skipUntilStr = await kv.get(KV_KEY_SKIP_UNTIL);
  const failures = parseInt(failuresStr ?? "0", 10) || 0;
  const skipUntil = parseInt(skipUntilStr ?? "0", 10) || 0;
  const now = Math.floor(Date.now() / 1000);

  if (failures < FAILURE_THRESHOLD) return false;
  if (now >= skipUntil) return false; // Cooldown expired, allow retry
  return true;
}

export async function recordCronSuccess(kv: KVNamespace): Promise<void> {
  await kv.delete(KV_KEY_FAILURES);
  await kv.delete(KV_KEY_SKIP_UNTIL);
}

export async function recordCronFailure(kv: KVNamespace): Promise<void> {
  const failuresStr = await kv.get(KV_KEY_FAILURES);
  const failures = parseInt(failuresStr ?? "0", 10) || 0;
  const now = Math.floor(Date.now() / 1000);
  const skipUntil = now + COOLDOWN_SECONDS;

  await kv.put(KV_KEY_FAILURES, String(failures + 1), { expirationTtl: 86400 * 7 });
  await kv.put(KV_KEY_SKIP_UNTIL, String(skipUntil), { expirationTtl: COOLDOWN_SECONDS + 3600 });
}
