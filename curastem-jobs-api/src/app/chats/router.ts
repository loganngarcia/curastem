import { extractToken } from "../auth/session.ts";
import { enforceUserRateLimit } from "../security/rateLimit.ts";
import {
  handleAppendMessage,
  handleCreateChat,
  handleDeleteChat,
  handleGenerateChatTitle,
  handleGetChat,
  handleListChats,
  handleListMessages,
  handlePatchChat,
} from "./handlers.ts";
import type { Env } from "../../shared/types.ts";
import { requireAppCsrf, withAppCors } from "../security.ts";

export async function handleChatRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/chats" && method === "GET") {
    return withAppCors(request, await handleListChats(request, env));
  }
  if (path === "/chats" && method === "POST") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    return withAppCors(request, await handleCreateChat(request, env));
  }

  const messagesMatch = path.match(/^\/chats\/([^/]+)\/messages$/);
  if (messagesMatch) {
    const chatId = decodeURIComponent(messagesMatch[1]);
    if (method === "GET") {
      return withAppCors(request, await handleListMessages(request, env, chatId));
    }
    if (method === "POST") {
      const csrf = requireAppCsrf(request);
      if (csrf) return withAppCors(request, csrf);
      return withAppCors(request, await handleAppendMessage(request, env, chatId));
    }
  }

  const titleMatch = path.match(/^\/chats\/([^/]+)\/title$/);
  if (titleMatch) {
    const chatId = decodeURIComponent(titleMatch[1]);
    if (method === "POST") {
      const csrf = requireAppCsrf(request);
      if (csrf) return withAppCors(request, csrf);
      const sess = extractToken(request);
      const rl = await enforceUserRateLimit(env, request, {
        scope: "chat_title",
        limit: 60,
        userId: sess,
      });
      if (rl) return withAppCors(request, rl);
      return withAppCors(request, await handleGenerateChatTitle(request, env, chatId));
    }
  }

  const chatMatch = path.match(/^\/chats\/([^/]+)$/);
  if (chatMatch) {
    const chatId = decodeURIComponent(chatMatch[1]);
    if (method === "GET") {
      return withAppCors(request, await handleGetChat(request, env, chatId));
    }
    if (method === "PATCH") {
      const csrf = requireAppCsrf(request);
      if (csrf) return withAppCors(request, csrf);
      return withAppCors(request, await handlePatchChat(request, env, chatId));
    }
    if (method === "DELETE") {
      const csrf = requireAppCsrf(request);
      if (csrf) return withAppCors(request, csrf);
      return withAppCors(request, await handleDeleteChat(request, env, chatId));
    }
  }

  return null;
}
