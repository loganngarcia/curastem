import type { Env } from "../../shared/types.ts";
import { Errors } from "../../shared/utils/errors.ts";
import { handleAgentChat, handleAgentTool, handleAgentTools } from "./handlers.ts";

export async function handleAgentRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/agent/tools" && method === "GET") return handleAgentTools(request, env);
  if (path === "/agent/tool" && method === "POST") return handleAgentTool(request, env);
  if (path === "/agent/chat" && method === "POST") return handleAgentChat(request, env);
  if (path === "/agent/tools" || path === "/agent/tool" || path === "/agent/chat") {
    return Errors.methodNotAllowed();
  }
  return null;
}
