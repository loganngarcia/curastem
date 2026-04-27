/**
 * Private Curastem app API router.
 *
 * Public Jobs API consumers should never depend on these browser-session
 * routes. Keep URLs stable for web.tsx, but keep implementation ownership
 * separate from the public API product surface.
 */
import { handleAuthRoute } from "./auth/router.ts";
import { handleChatRoute } from "./chats/router.ts";
import { handlePlatformRoute } from "./platform/router.ts";
import { appCorsPreflight, isAppRoute, withAppCors } from "./security.ts";
import { handleSyncRoute } from "./sync/router.ts";
import { handleUploadRoute } from "./uploads/router.ts";
import { handleUserContentRoute } from "./userContent/router.ts";
import type { Env } from "../shared/types.ts";

export { appCorsPreflight, isAppRoute, withAppCors };

export async function handleAppRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  method: string
): Promise<Response | null> {
  return (
    (await handlePlatformRoute(request, env, path, method)) ??
    (await handleAuthRoute(request, env, path, method)) ??
    (await handleSyncRoute(request, env, path, method)) ??
    (await handleChatRoute(request, env, path, method)) ??
    (await handleUserContentRoute(request, env, path, method)) ??
    (await handleUploadRoute(request, env, ctx, path, method))
  );
}
