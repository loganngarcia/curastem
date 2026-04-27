/**
 * Chat API — signed-in user's cloud chat + message store.
 *
 *   GET    /chats?cursor=&limit=20
 *   GET    /chats/:id
 *   POST   /chats                    body: { id?, title?, meta? }
 *   PATCH  /chats/:id                body: { title?, is_pinned?, pinned_at?, meta? }
 *   POST   /chats/:id/title          body: { first_message_text }
 *   DELETE /chats/:id
 *   GET    /chats/:id/messages?before=&limit=10
 *   POST   /chats/:id/messages       body: { role, content, timestamp? }
 *
 * The client caps local history by count, so "listing chats" is always a
 * sidebar-driven paginated pull from here once signed in. Messages inside a
 * chat load in reverse-chronological pages so the newest exchange is on
 * screen instantly and scroll-up prepends older messages.
 */

import type { ChatMessageRow, ChatRow, Env } from "../../shared/types.ts";
import { readSession } from "../auth/session.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { fetchGeminiWithFallback } from "../../shared/utils/geminiFetch.ts";
import { reserveGeminiQuota } from "../../shared/utils/geminiQuota.ts";
import { canonicalize, sha256Hex } from "../sync/merge.ts";
import {
  deleteChat,
  getChatById,
  listChatMessages,
  listChats,
  persistChatMessages,
  persistChats,
  persistTombstones,
} from "../userContent/data.ts";

const CHAT_TITLE_MODEL = "gemini-3.1-flash-lite-preview";
const DIRTY_FLAG_TTL_SECONDS = 5 * 60;
const CHAT_TITLE_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /chats
// ─────────────────────────────────────────────────────────────────────────────

export async function handleListChats(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const url = new URL(request.url);
  const limit = parseIntOr(url.searchParams.get("limit"), 20);
  const cursor = url.searchParams.get("cursor");
  const sinceStr = url.searchParams.get("since");
  const sinceSec = sinceStr != null ? parseIntOr(sinceStr, 0) : null;

  const result = await listChats(env.JOBS_DB, active.user.id, {
    limit,
    cursor,
    sinceSec,
  });

  return jsonOk({
    chats: result.chats.map(toPublicChatSummary),
    next_cursor: result.next_cursor,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /chats/:id
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetChat(
  request: Request,
  env: Env,
  chatId: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const chat = await getChatById(env.JOBS_DB, active.user.id, chatId);
  if (!chat) return Errors.notFound("Chat not found");

  const url = new URL(request.url);
  const initialLimit = parseIntOr(url.searchParams.get("messages_limit"), 10);

  const { messages, older_cursor } = await listChatMessages(
    env.JOBS_DB,
    active.user.id,
    chatId,
    { limit: initialLimit }
  );

  return jsonOk({
    chat: toPublicChatDetail(chat),
    // Return messages in ascending order so the client can render them without
    // reversing; older_cursor lets it paginate upward.
    messages: messages
      .slice()
      .sort((a, b) => (a.created_at - b.created_at) || (a.seq - b.seq))
      .map(toPublicMessage),
    older_cursor,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /chats/:id/messages?before=&limit=10
// ─────────────────────────────────────────────────────────────────────────────

export async function handleListMessages(
  request: Request,
  env: Env,
  chatId: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const chat = await getChatById(env.JOBS_DB, active.user.id, chatId);
  if (!chat) return Errors.notFound("Chat not found");

  const url = new URL(request.url);
  const limit = parseIntOr(url.searchParams.get("limit"), 10);
  const before = url.searchParams.get("before");

  const { messages, older_cursor } = await listChatMessages(
    env.JOBS_DB,
    active.user.id,
    chatId,
    { limit, before }
  );

  return jsonOk({
    messages: messages
      .slice()
      .sort((a, b) => (a.created_at - b.created_at) || (a.seq - b.seq))
      .map(toPublicMessage),
    older_cursor,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /chats  (create — usually driven by the client with its own id)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCreateChat(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  let body: {
    id?: string;
    title?: string | null;
    is_pinned?: boolean;
    pinned_at?: number | null;
    meta?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Errors.badRequest("Body must be JSON");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const id = typeof body.id === "string" && body.id.length > 0 ? body.id : crypto.randomUUID();
  const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
  const metaJson = JSON.stringify(meta);
  const title = typeof body.title === "string" ? body.title : null;
  const isPinned = body.is_pinned ? 1 : 0;
  const pinnedAt = typeof body.pinned_at === "number" ? Math.floor(body.pinned_at / 1000) : null;

  const metaHash = await sha256Hex(
    canonicalize({ title, isPinned, pinnedAt, meta })
  );

  const chat: ChatRow = {
    id,
    user_id: active.user.id,
    title,
    is_pinned: isPinned,
    pinned_at: pinnedAt,
    created_at: nowSec,
    updated_at: nowSec,
    last_message_at: null,
    last_message_preview: null,
    message_count: 0,
    next_seq: 1,
    meta_json: metaJson,
    meta_hash: metaHash,
  };

  await persistChats(env.JOBS_DB, [chat]);
  return jsonOk({ chat: toPublicChatDetail(chat) }, 201);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /chats/:id  (title, pin, meta)
// ─────────────────────────────────────────────────────────────────────────────

export async function handlePatchChat(
  request: Request,
  env: Env,
  chatId: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const existing = await getChatById(env.JOBS_DB, active.user.id, chatId);
  if (!existing) return Errors.notFound("Chat not found");

  let body: {
    title?: string | null;
    is_pinned?: boolean;
    pinned_at?: number | null;
    meta?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Errors.badRequest("Body must be JSON");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const next: ChatRow = { ...existing, updated_at: nowSec };

  if (body.title !== undefined) next.title = body.title;
  if (body.is_pinned !== undefined) {
    next.is_pinned = body.is_pinned ? 1 : 0;
    next.pinned_at = body.is_pinned ? (next.pinned_at ?? nowSec) : null;
  }
  if (body.pinned_at !== undefined) {
    next.pinned_at = typeof body.pinned_at === "number" ? Math.floor(body.pinned_at / 1000) : null;
  }
  if (body.meta !== undefined && body.meta !== null && typeof body.meta === "object") {
    next.meta_json = JSON.stringify(body.meta);
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(next.meta_json || "{}");
  } catch {
    meta = {};
  }
  next.meta_hash = await sha256Hex(
    canonicalize({
      title: next.title,
      isPinned: next.is_pinned,
      pinnedAt: next.pinned_at,
      meta,
    })
  );

  await persistChats(env.JOBS_DB, [next]);
  return jsonOk({ chat: toPublicChatDetail(next) });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /chats/:id/title  (generate once, server-owned)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGenerateChatTitle(
  request: Request,
  env: Env,
  chatId: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const existing = await getChatById(env.JOBS_DB, active.user.id, chatId);
  if (!existing) return Errors.notFound("Chat not found");
  if (!isPlaceholderChatTitle(existing.title)) {
    return jsonOk({ title: existing.title, chat: toPublicChatSummary(existing) });
  }

  let body: { first_message_text?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Errors.badRequest("Body must be JSON");
  }

  const firstMessageText =
    typeof body.first_message_text === "string"
      ? body.first_message_text.trim()
      : "";
  if (!firstMessageText) return Errors.badRequest("first_message_text required");

  let title = fallbackChatTitleFromMessage(firstMessageText);
  const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_chat_title");
  if (quota.allowed) {
    title = await generateChatTitle(env.GEMINI_API_KEY, firstMessageText);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const meta = parseMeta(existing.meta_json);
  const next: ChatRow = {
    ...existing,
    title,
    updated_at: nowSec,
    meta_hash: await sha256Hex(
      canonicalize({
        title,
        isPinned: existing.is_pinned,
        pinnedAt: existing.pinned_at,
        meta,
      })
    ),
  };

  await persistChats(env.JOBS_DB, [next]);
  await markUserDirty(env.RATE_LIMIT_KV, active.user.id);
  return jsonOk({ title, chat: toPublicChatSummary(next) });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /chats/:id
// ─────────────────────────────────────────────────────────────────────────────

export async function handleDeleteChat(
  request: Request,
  env: Env,
  chatId: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const existing = await getChatById(env.JOBS_DB, active.user.id, chatId);
  if (!existing) return Errors.notFound("Chat not found");

  await deleteChat(env.JOBS_DB, active.user.id, chatId);
  await persistTombstones(env.JOBS_DB, [
    {
      user_id: active.user.id,
      kind: "chat",
      entity_id: chatId,
      deleted_at: Date.now(),
    },
  ]);
  return jsonOk({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /chats/:id/messages  (append)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAppendMessage(
  request: Request,
  env: Env,
  chatId: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const chat = await getChatById(env.JOBS_DB, active.user.id, chatId);
  if (!chat) return Errors.notFound("Chat not found");

  let body: {
    role?: string;
    content?: unknown;
    timestamp?: number;
    [k: string]: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Errors.badRequest("Body must be JSON");
  }

  const role = typeof body.role === "string" ? body.role : "assistant";
  const createdAtMs = typeof body.timestamp === "number" ? body.timestamp : Date.now();
  const seq = chat.next_seq;
  // The client's Message object shape is opaque to us — store the whole body
  // minus our own dispatch fields.
  const raw = { ...body };
  const contentJson = JSON.stringify(raw);
  const contentHash = await sha256Hex(canonicalize(raw));

  const msg: ChatMessageRow = {
    chat_id: chatId,
    user_id: active.user.id,
    seq,
    created_at: createdAtMs,
    role,
    content_json: contentJson,
    content_hash: contentHash,
  };
  await persistChatMessages(env.JOBS_DB, [msg]);

  const preview = previewOf(body.content);
  const nextChat: ChatRow = {
    ...chat,
    next_seq: seq + 1,
    message_count: chat.message_count + 1,
    last_message_at: createdAtMs,
    last_message_preview: preview ?? chat.last_message_preview,
    updated_at: Math.max(chat.updated_at, Math.floor(createdAtMs / 1000)),
  };
  await persistChats(env.JOBS_DB, [nextChat]);

  return jsonOk(
    {
      message: toPublicMessage(msg),
      chat: toPublicChatSummary(nextChat),
    },
    201
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseIntOr(v: string | null | undefined, def: number): number {
  if (v == null) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseMeta(metaJson: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metaJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isPlaceholderChatTitle(title: string | null): boolean {
  const normalized = (title ?? "").trim().toLowerCase();
  return normalized.length === 0 || normalized === "new chat";
}

async function markUserDirty(kv: KVNamespace, userId: string): Promise<void> {
  try {
    await kv.put(`sync_dirty:${userId}`, String(Date.now()), {
      expirationTtl: DIRTY_FLAG_TTL_SECONDS,
    });
  } catch {
    // Best-effort. Regular sync pulls still reconcile if KV is unavailable.
  }
}

async function generateChatTitle(apiKey: string, firstMessageText: string): Promise<string> {
  const fallback = fallbackChatTitleFromMessage(firstMessageText);
  if (!apiKey) return fallback;
  const prompt = `Summarize this message into a short title (3-5 words). Just the title, no quotes: "${firstMessageText}"`;
  const resp = await fetchGeminiWithFallback(apiKey, CHAT_TITLE_MODEL, "generateContent", {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, maxOutputTokens: 20 },
      safetySettings: CHAT_TITLE_SAFETY_SETTINGS,
  }).catch(() => null);
  if (!resp?.ok) return fallback;
  const data = (await resp.json().catch(() => null)) as
    | {
        candidates?: Array<{
          finishReason?: string;
          content?: { parts?: Array<{ text?: string }> };
        }>;
      }
    | null;
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text?.trim();
  if (
    !text ||
    candidate?.finishReason === "RECITATION" ||
    candidate?.finishReason === "SAFETY"
  ) {
    return fallback;
  }
  return text.replace(/^["']|["']$/g, "").slice(0, 80) || fallback;
}

function fallbackChatTitleFromMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").split(" ").slice(0, 4).join(" ") || "New chat";
}

function previewOf(content: unknown): string | null {
  let text: string | null = null;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        text = (part as { text: string }).text;
        break;
      }
    }
  }
  if (!text) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 160 ? trimmed.slice(0, 160) : trimmed;
}

function toPublicChatSummary(c: ChatRow) {
  return {
    id: c.id,
    title: c.title,
    is_pinned: c.is_pinned === 1,
    pinned_at: c.pinned_at != null ? c.pinned_at * 1000 : null,
    created_at: c.created_at * 1000,
    updated_at: c.updated_at * 1000,
    last_message_at: c.last_message_at,
    last_message_preview: c.last_message_preview,
    message_count: c.message_count,
  };
}

function toPublicChatDetail(c: ChatRow) {
  let meta: unknown = {};
  try {
    meta = JSON.parse(c.meta_json || "{}");
  } catch {
    meta = {};
  }
  return {
    ...toPublicChatSummary(c),
    meta,
  };
}

function toPublicMessage(m: ChatMessageRow) {
  let content: unknown = null;
  try {
    content = JSON.parse(m.content_json);
  } catch {
    content = null;
  }
  return {
    chat_id: m.chat_id,
    seq: m.seq,
    created_at: m.created_at,
    role: m.role,
    content,
  };
}
