import {
  handleListUserApps,
  handleListUserDocs,
} from "./handlers.ts";
import type { Env } from "../../shared/types.ts";
import { withAppCors } from "../security.ts";

export async function handleUserContentRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/docs" && method === "GET") {
    return withAppCors(request, await handleListUserDocs(request, env));
  }
  if (path === "/apps" && method === "GET") {
    return withAppCors(request, await handleListUserApps(request, env));
  }
  return null;
}
