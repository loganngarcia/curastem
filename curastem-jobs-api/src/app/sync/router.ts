import { extractToken } from "../auth/session.ts";
import { enforceUserRateLimit } from "../security/rateLimit.ts";
import { handleSyncDelta, handleSyncPull, handleSyncPush, handleSyncStream } from "./handlers.ts";
import type { Env } from "../../shared/types.ts";
import { Errors } from "../../shared/utils/errors.ts";
import { logger } from "../../shared/utils/logger.ts";
import { requireAppCsrf, withAppCors } from "../security.ts";

export async function handleSyncRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/sync/pull" && method === "GET") {
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "sync_pull",
      limit: 30,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleSyncPull(request, env));
  }
  if (path === "/sync/push" && method === "POST") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "sync_push",
      limit: 10,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    try {
      return withAppCors(request, await handleSyncPush(request, env));
    } catch (err) {
      logger.error("sync_push_failed", { error: String(err) });
      return withAppCors(
        request,
        Errors.internal(`Sync push failed: ${String(err).slice(0, 300)}`)
      );
    }
  }
  if (path === "/sync/delta" && method === "POST") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "sync_delta",
      limit: 120,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    try {
      return withAppCors(request, await handleSyncDelta(request, env));
    } catch (err) {
      logger.error("sync_delta_failed", { error: String(err) });
      return withAppCors(
        request,
        Errors.internal(`Sync delta failed: ${String(err).slice(0, 300)}`)
      );
    }
  }
  if (path === "/sync/stream" && method === "GET") {
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "sync_stream",
      limit: 20,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleSyncStream(request, env));
  }
  return null;
}
