/**
 * Split a client ChatSession into normalized rows (and back).
 *
 * Client shape (web.tsx: interface ChatSession):
 *   { id, title, timestamp, messages, notes, docs?, app?, whiteboard?, ... }
 *
 * Stored shape:
 *   chats           — metadata only (title/pin/refs/preview/counters).
 *   chat_messages   — one row per message, with per-chat monotonic `seq`
 *                     and millisecond `created_at` for stable ordering.
 *   docs            — one row per ChatDocEntry.
 *   apps            — one row per (chat.app + chat.whiteboard), discriminator `kind`.
 *
 * meta_hash covers NON-message fields only (title, pin flags, refs, meta_json)
 * so streaming messages don't churn it. Messages dedup via
 * chat_messages.content_hash.
 */

import type {
  AppRow,
  ChatMessageRow,
  ChatRow,
  DocRow,
} from "../../shared/types.ts";
import { canonicalize, hashContent, sha256Hex } from "./merge.ts";

export interface ClientChatSession {
  id: string;
  title?: string;
  timestamp?: number;
  messages?: ClientChatMessage[];
  notes?: string;
  docType?: "doc" | "resume" | "cover_letter";
  docCompany?: string;
  docs?: ClientChatDoc[];
  activeDocId?: string;
  whiteboard?: unknown;
  app?: { code: string; mode: "editor" | "player" };
  isPinned?: boolean;
  pinnedAt?: number;
  suggestions?: unknown[];
  miniIdeLastEdited?: number;
  docEditorLastEdited?: number;
  whiteboardLastEdited?: number;
}

export interface ClientChatMessage {
  role?: string;
  content?: unknown;
  timestamp?: number; // millis — client-supplied if available
  [key: string]: unknown;
}

export interface ClientChatDoc {
  id: string;
  content: string;
  docType: "doc" | "resume" | "cover_letter";
  docCompany?: string;
  lastEdited: number;
}

export interface Extracted {
  chat: ChatRow;
  messages: ChatMessageRow[];
  docs: DocRow[];
  apps: AppRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract: client → normalized rows
// ─────────────────────────────────────────────────────────────────────────────

export async function extractChatSession(
  input: ClientChatSession,
  userId: string,
  nowSec: number
): Promise<Extracted> {
  const chatId = input.id;
  const nowMs = nowSec * 1000;

  // ── Docs
  const docs: DocRow[] = [];
  const docRefs: Array<{
    id: string;
    kind: "doc" | "resume" | "cover_letter";
    last_edited: number;
  }> = [];
  if (Array.isArray(input.docs)) {
    for (const d of input.docs) {
      if (!d || typeof d.id !== "string" || typeof d.content !== "string") continue;
      const kind =
        d.docType === "resume" || d.docType === "cover_letter" ? d.docType : "doc";
      const updatedAt =
        typeof d.lastEdited === "number" ? Math.floor(d.lastEdited / 1000) : nowSec;
      const hash = await hashContent({
        kind,
        title: null,
        doc_company: d.docCompany ?? null,
        html: d.content,
      });
      docs.push({
        id: d.id,
        user_id: userId,
        chat_id: chatId,
        kind,
        title: null,
        doc_company: d.docCompany ?? null,
        html: d.content,
        content_hash: hash,
        created_at: updatedAt,
        updated_at: updatedAt,
      });
      docRefs.push({ id: d.id, kind, last_edited: updatedAt });
    }
  }

  // ── Apps (mini IDE + whiteboard)
  const apps: AppRow[] = [];

  let appRef: { id: string; updated_at: number } | null = null;
  if (input.app && typeof input.app.code === "string") {
    const updatedAt =
      typeof input.miniIdeLastEdited === "number"
        ? Math.floor(input.miniIdeLastEdited / 1000)
        : nowSec;
    const id = `app_${chatId}`;
    const hash = await hashContent({
      kind: "app",
      code: input.app.code,
      mode: input.app.mode,
    });
    apps.push({
      id,
      user_id: userId,
      chat_id: chatId,
      kind: "app",
      title: null,
      payload_json: JSON.stringify({ code: input.app.code, mode: input.app.mode }),
      content_hash: hash,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
    appRef = { id, updated_at: updatedAt };
  }

  let whiteboardRef: { id: string; updated_at: number } | null = null;
  if (input.whiteboard != null) {
    const updatedAt =
      typeof input.whiteboardLastEdited === "number"
        ? Math.floor(input.whiteboardLastEdited / 1000)
        : nowSec;
    const id = `wb_${chatId}`;
    const hash = await hashContent({ kind: "whiteboard", wb: input.whiteboard });
    apps.push({
      id,
      user_id: userId,
      chat_id: chatId,
      kind: "whiteboard",
      title: null,
      payload_json: JSON.stringify(input.whiteboard),
      content_hash: hash,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
    whiteboardRef = { id, updated_at: updatedAt };
  }

  // ── Messages — build in chat creation order, assign seq 1..N.
  const clientMessages = Array.isArray(input.messages) ? input.messages : [];
  const messages: ChatMessageRow[] = [];
  const createdAtMs = typeof input.timestamp === "number" ? input.timestamp : nowMs;
  let lastMsgMs = 0;
  let lastPreview: string | null = null;
  for (let i = 0; i < clientMessages.length; i++) {
    const m = clientMessages[i];
    if (!m || typeof m !== "object") continue;
    const role = typeof m.role === "string" ? m.role : "assistant";
    const ts =
      typeof m.timestamp === "number" ? m.timestamp : createdAtMs + i; // preserve order
    const contentJson = JSON.stringify(m);
    const contentHash = await sha256Hex(canonicalize(m));
    messages.push({
      chat_id: chatId,
      user_id: userId,
      seq: i + 1,
      created_at: ts,
      role,
      content_json: contentJson,
      content_hash: contentHash,
    });
    if (ts >= lastMsgMs) {
      lastMsgMs = ts;
      lastPreview = extractPreview(m);
    }
  }

  // ── Meta (non-message fields)
  const meta = {
    suggestions: Array.isArray(input.suggestions) ? input.suggestions : [],
    notes: typeof input.notes === "string" ? input.notes : "",
    docType: input.docType ?? null,
    docCompany: input.docCompany ?? null,
    activeDocId: input.activeDocId ?? null,
    refs: {
      docs: docRefs,
      app: appRef,
      whiteboard: whiteboardRef,
    },
  };
  const metaJson = JSON.stringify(meta);

  const title = typeof input.title === "string" ? input.title : null;
  const isPinned = input.isPinned ? 1 : 0;
  const pinnedAt =
    typeof input.pinnedAt === "number" ? Math.floor(input.pinnedAt / 1000) : null;

  // meta_hash is over the scalar metadata only — NOT messages.
  const metaHash = await sha256Hex(
    canonicalize({ title, isPinned, pinnedAt, meta })
  );

  const updatedAt = deriveChatUpdatedAt(input, docs, apps, messages, nowSec);
  const chatCreatedAtSec =
    typeof input.timestamp === "number" ? Math.floor(input.timestamp / 1000) : updatedAt;

  const chat: ChatRow = {
    id: chatId,
    user_id: userId,
    title,
    is_pinned: isPinned,
    pinned_at: pinnedAt,
    created_at: chatCreatedAtSec,
    updated_at: updatedAt,
    last_message_at: messages.length > 0 ? lastMsgMs : null,
    last_message_preview: lastPreview,
    message_count: messages.length,
    next_seq: messages.length + 1,
    meta_json: metaJson,
    meta_hash: metaHash,
  };

  return { chat, messages, docs, apps };
}

function deriveChatUpdatedAt(
  input: ClientChatSession,
  docs: DocRow[],
  apps: AppRow[],
  messages: ChatMessageRow[],
  nowSec: number
): number {
  const cands: number[] = [];
  if (typeof input.timestamp === "number") cands.push(Math.floor(input.timestamp / 1000));
  if (typeof input.miniIdeLastEdited === "number") cands.push(Math.floor(input.miniIdeLastEdited / 1000));
  if (typeof input.docEditorLastEdited === "number") cands.push(Math.floor(input.docEditorLastEdited / 1000));
  if (typeof input.whiteboardLastEdited === "number") cands.push(Math.floor(input.whiteboardLastEdited / 1000));
  for (const d of docs) cands.push(d.updated_at);
  for (const a of apps) cands.push(a.updated_at);
  for (const m of messages) cands.push(Math.floor(m.created_at / 1000));
  if (cands.length === 0) return nowSec;
  return Math.max(...cands);
}

function extractPreview(m: ClientChatMessage): string | null {
  const c = m?.content;
  let text: string | null = null;
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    for (const part of c) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Rehydrate: normalized rows → client ChatSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuild a client-shaped ChatSession. Messages are passed in already
 * ordered oldest-first (chronological) so the UI message list works as-is.
 * Callers typically fetch only the last N messages and let the client scroll
 * up to request more.
 */
export function rehydrateChatSession(
  chat: ChatRow,
  messages: ChatMessageRow[],
  docsById: Map<string, DocRow>,
  appsById: Map<string, AppRow>
): ClientChatSession {
  let meta: {
    suggestions?: unknown[];
    notes?: string;
    docType?: "doc" | "resume" | "cover_letter" | null;
    docCompany?: string | null;
    activeDocId?: string | null;
    refs?: {
      docs?: Array<{ id: string }>;
      app?: { id: string } | null;
      whiteboard?: { id: string } | null;
    };
  } = {};
  try {
    meta = JSON.parse(chat.meta_json || "{}");
  } catch {
    meta = {};
  }

  const docs: ClientChatDoc[] = [];
  for (const ref of meta.refs?.docs ?? []) {
    const row = docsById.get(ref.id);
    if (!row) continue;
    const kind =
      row.kind === "resume" || row.kind === "cover_letter" ? row.kind : "doc";
    docs.push({
      id: row.id,
      content: row.html,
      docType: kind,
      docCompany: row.doc_company ?? undefined,
      lastEdited: row.updated_at * 1000,
    });
  }

  let app: { code: string; mode: "editor" | "player" } | undefined;
  if (meta.refs?.app) {
    const row = appsById.get(meta.refs.app.id);
    if (row && row.kind === "app") {
      try {
        const parsed = JSON.parse(row.payload_json) as {
          code?: string;
          mode?: "editor" | "player";
        };
        if (typeof parsed.code === "string") {
          app = {
            code: parsed.code,
            mode: parsed.mode === "player" ? "player" : "editor",
          };
        }
      } catch {
        /* skip malformed app payload */
      }
    }
  }

  let whiteboard: unknown = undefined;
  if (meta.refs?.whiteboard) {
    const row = appsById.get(meta.refs.whiteboard.id);
    if (row && row.kind === "whiteboard") {
      try {
        whiteboard = JSON.parse(row.payload_json);
      } catch {
        whiteboard = undefined;
      }
    }
  }

  // Messages — parse content_json and return in ascending seq order. The
  // caller decides how many to include; `older_cursor` signals more behind.
  const parsedMessages: unknown[] = messages
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((m) => {
      try {
        return JSON.parse(m.content_json);
      } catch {
        return null;
      }
    })
    .filter((x) => x != null);

  return {
    id: chat.id,
    title: chat.title ?? "",
    // Use updated_at (not created_at) so the pull-snapshot merge correctly
    // identifies the server version as newer when chat metadata has changed
    // on another device.
    timestamp: chat.updated_at * 1000,
    messages: parsedMessages as ClientChatMessage[],
    notes: typeof meta.notes === "string" ? meta.notes : "",
    docType: meta.docType ?? undefined,
    docCompany: meta.docCompany ?? undefined,
    docs: docs.length > 0 ? docs : undefined,
    activeDocId: meta.activeDocId ?? undefined,
    whiteboard,
    app,
    isPinned: chat.is_pinned === 1,
    pinnedAt: chat.pinned_at != null ? chat.pinned_at * 1000 : undefined,
    suggestions: Array.isArray(meta.suggestions) ? (meta.suggestions as string[]) : undefined,
  };
}
