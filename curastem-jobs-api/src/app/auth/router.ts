import { enforceUserRateLimit } from "../security/rateLimit.ts";
import {
  handleClaimPending,
  handleDeleteMe,
  handleFirebaseSignIn,
  handleGetMe,
  handleLogout,
  handlePatchPrefs,
  handleStorePending,
} from "./handlers.ts";
import { handleExport, handleExportEstimate } from "./export.ts";
import type { Env } from "../../shared/types.ts";
import { requireAppCsrf, withAppCors } from "../security.ts";

export async function handleAuthRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/auth/firebase" && method === "POST") {
    const rl = await enforceUserRateLimit(env, request, {
      scope: "auth_firebase",
      limit: 10,
    });
    if (rl) return withAppCors(request, rl);
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    return withAppCors(request, await handleFirebaseSignIn(request, env));
  }
  if (path === "/auth/logout" && method === "POST") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    return withAppCors(request, await handleLogout(request, env));
  }
  if (path === "/auth/me" && method === "GET") {
    return withAppCors(request, await handleGetMe(request, env));
  }
  if (path === "/auth/me" && method === "DELETE") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    return withAppCors(request, await handleDeleteMe(request, env));
  }
  if (path === "/auth/me/prefs" && method === "PATCH") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    return withAppCors(request, await handlePatchPrefs(request, env));
  }
  if (path === "/auth/pending" && method === "POST") {
    return withAppCors(request, await handleStorePending(request, env));
  }
  if (path === "/auth/pending" && method === "GET") {
    return withAppCors(request, await handleClaimPending(request, env));
  }
  if (path === "/auth/export/estimate" && method === "GET") {
    const rl = await enforceUserRateLimit(env, request, {
      scope: "export",
      limit: 5,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleExportEstimate(request, env));
  }
  if (path === "/auth/export" && method === "GET") {
    const rl = await enforceUserRateLimit(env, request, {
      scope: "export_full",
      limit: 3,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleExport(request, env));
  }
  return null;
}
