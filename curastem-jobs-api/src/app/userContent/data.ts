/**
 * Shared D1 read/write helpers for per-user data (chats, messages, docs, apps,
 * tombstones). Route handlers import from here so they all use the same
 * cursor encoding, batch discipline, and index shapes.
 *
 * Cursor format:
 *   chats:         base64(`${updated_at}:${id}`)        // seconds
 *   messages:      base64(`${created_at_ms}:${seq}`)
 *   docs/apps:     base64(`${updated_at}:${id}`)
 *
 * All cursors are opaque to the client — it just passes them back unchanged.
 */

import type {
  AppRow,
  ChatMessageRow,
  ChatRow,
  DocRow,
  ProfileRow,
  TombstoneRow,
} from "../../shared/types.ts";
import { ensureUserDataTables } from "../../shared/db/queries.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers
// ─────────────────────────────────────────────────────────────────────────────

export function encodeCursor(parts: Array<string | number>): string {
  return btoa(parts.map((p) => String(p)).join("\u0001"));
}

export function decodeCursor(cursor: string): string[] | null {
  try {
    return atob(cursor).split("\u0001");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chats (sidebar pagination)
// ─────────────────────────────────────────────────────────────────────────────

export interface ListChatsOptions {
  limit: number;
  cursor?: string | null;
  /** Only return chats whose updated_at (seconds) is strictly greater. */
  sinceSec?: number | null;
}

export interface ListChatsResult {
  chats: ChatRow[];
  next_cursor: string | null;
}

/**
 * Sidebar order:
 *   1. Pinned chats first, by pinned_at DESC
 *   2. Then unpinned, by updated_at DESC
 *   3. Ties broken by id DESC (stable)
 *
 * Cursor format for *this* listing is the tuple
 *   (is_pinned DESC, pinned_at DESC, updated_at DESC, id DESC)
 * which is painful to express in SQL. We approximate by paging in two phases:
 *   phase 1: all pinned chats (small set, almost always fits one page)
 *   phase 2: unpinned, by (updated_at, id)
 *
 * The encoded cursor is `${phase}:${k1}:${k2}`.
 */
export async function listChats(
  db: D1Database,
  userId: string,
  opts: ListChatsOptions
): Promise<ListChatsResult> {
  await ensureUserDataTables(db);
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit)));

  const cursorParts = opts.cursor ? decodeCursor(opts.cursor) : null;
  let phase: "pinned" | "unpinned" = "pinned";
  let pinnedAtCursor = Number.MAX_SAFE_INTEGER;
  let idCursorPinned = "\uFFFF";
  let updatedAtCursor = Number.MAX_SAFE_INTEGER;
  let idCursorUnpinned = "\uFFFF";

  if (cursorParts && cursorParts.length >= 3) {
    phase = cursorParts[0] === "unpinned" ? "unpinned" : "pinned";
    if (phase === "pinned") {
      pinnedAtCursor = Number(cursorParts[1]) || 0;
      idCursorPinned = cursorParts[2] ?? "\uFFFF";
    } else {
      updatedAtCursor = Number(cursorParts[1]) || 0;
      idCursorUnpinned = cursorParts[2] ?? "\uFFFF";
    }
  }

  const rows: ChatRow[] = [];
  let nextCursor: string | null = null;

  // Phase 1: pinned
  if (phase === "pinned") {
    const sinceClause = opts.sinceSec != null ? `AND updated_at > ?` : "";
    const sql = `SELECT * FROM chats
                   WHERE user_id = ? AND is_pinned = 1
                     AND (pinned_at, id) < (?, ?)
                     ${sinceClause}
                   ORDER BY pinned_at DESC, id DESC
                   LIMIT ?`;
    const binds: unknown[] = [userId, pinnedAtCursor, idCursorPinned];
    if (opts.sinceSec != null) binds.push(opts.sinceSec);
    binds.push(limit + 1);
    const { results } = await db
      .prepare(sql)
      .bind(...binds)
      .all<ChatRow>();
    const page = (results ?? []).slice(0, limit);
    rows.push(...page);
    if ((results ?? []).length > limit) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor(["pinned", last.pinned_at ?? 0, last.id]);
    } else {
      // Phase 1 done — switch to phase 2 in this same call if room remains.
      phase = "unpinned";
      pinnedAtCursor = 0;
      idCursorPinned = "";
    }
  }

  if (phase === "unpinned" && rows.length < limit) {
    const remaining = limit - rows.length;
    const sinceClause = opts.sinceSec != null ? `AND updated_at > ?` : "";
    const sql = `SELECT * FROM chats
                   WHERE user_id = ? AND is_pinned = 0
                     AND (updated_at, id) < (?, ?)
                     ${sinceClause}
                   ORDER BY updated_at DESC, id DESC
                   LIMIT ?`;
    const binds: unknown[] = [userId, updatedAtCursor, idCursorUnpinned];
    if (opts.sinceSec != null) binds.push(opts.sinceSec);
    binds.push(remaining + 1);
    const { results } = await db
      .prepare(sql)
      .bind(...binds)
      .all<ChatRow>();
    const page = (results ?? []).slice(0, remaining);
    rows.push(...page);
    if ((results ?? []).length > remaining) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor(["unpinned", last.updated_at, last.id]);
    }
  }

  return { chats: rows, next_cursor: nextCursor };
}

export async function getChatById(
  db: D1Database,
  userId: string,
  chatId: string
): Promise<ChatRow | null> {
  await ensureUserDataTables(db);
  const row = await db
    .prepare(`SELECT * FROM chats WHERE id = ? AND user_id = ?`)
    .bind(chatId, userId)
    .first<ChatRow>();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat messages
// ─────────────────────────────────────────────────────────────────────────────

export interface ListMessagesOptions {
  limit: number;
  /**
   * Cursor = exclusive upper bound of (created_at_ms, seq). Used to request
   * older messages than the ones already rendered. If null, returns the
   * newest `limit` messages.
   */
  before?: string | null;
  /**
   * Only return messages whose created_at is strictly greater (delta pulls).
   * Mutually exclusive with `before` in practice; if both are provided,
   * `sinceMs` wins (delta sync is server-initiated).
   */
  sinceMs?: number | null;
}

export interface ListMessagesResult {
  /** Ordered newest first — easier to reason about on the client. */
  messages: ChatMessageRow[];
  older_cursor: string | null;
}

export async function listChatMessages(
  db: D1Database,
  userId: string,
  chatId: string,
  opts: ListMessagesOptions
): Promise<ListMessagesResult> {
  await ensureUserDataTables(db);
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit)));

  if (opts.sinceMs != null) {
    // Delta mode — newest first, above the watermark.
    const { results } = await db
      .prepare(
        `SELECT * FROM chat_messages
           WHERE chat_id = ? AND user_id = ? AND created_at > ?
           ORDER BY created_at DESC, seq DESC
           LIMIT ?`
      )
      .bind(chatId, userId, opts.sinceMs, limit)
      .all<ChatMessageRow>();
    return { messages: results ?? [], older_cursor: null };
  }

  let beforeMs = Number.MAX_SAFE_INTEGER;
  let beforeSeq = Number.MAX_SAFE_INTEGER;
  if (opts.before) {
    const parts = decodeCursor(opts.before);
    if (parts && parts.length >= 2) {
      beforeMs = Number(parts[0]) || Number.MAX_SAFE_INTEGER;
      beforeSeq = Number(parts[1]) || Number.MAX_SAFE_INTEGER;
    }
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM chat_messages
         WHERE chat_id = ? AND user_id = ?
           AND (created_at, seq) < (?, ?)
         ORDER BY created_at DESC, seq DESC
         LIMIT ?`
    )
    .bind(chatId, userId, beforeMs, beforeSeq, limit + 1)
    .all<ChatMessageRow>();

  const page = (results ?? []).slice(0, limit);
  let olderCursor: string | null = null;
  if ((results ?? []).length > limit && page.length > 0) {
    const oldest = page[page.length - 1];
    olderCursor = encodeCursor([oldest.created_at, oldest.seq]);
  }
  return { messages: page, older_cursor: olderCursor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Docs / Apps (paginated)
// ─────────────────────────────────────────────────────────────────────────────

export async function listDocs(
  db: D1Database,
  userId: string,
  opts: { limit: number; cursor?: string | null; sinceSec?: number | null }
): Promise<{ docs: DocRow[]; next_cursor: string | null }> {
  await ensureUserDataTables(db);
  return listByUpdatedAt<DocRow>(db, "docs", userId, opts).then((r) => ({
    docs: r.rows,
    next_cursor: r.next_cursor,
  }));
}

export async function listApps(
  db: D1Database,
  userId: string,
  opts: { limit: number; cursor?: string | null; sinceSec?: number | null }
): Promise<{ apps: AppRow[]; next_cursor: string | null }> {
  await ensureUserDataTables(db);
  return listByUpdatedAt<AppRow>(db, "apps", userId, opts).then((r) => ({
    apps: r.rows,
    next_cursor: r.next_cursor,
  }));
}

async function listByUpdatedAt<T extends { id: string; updated_at: number }>(
  db: D1Database,
  table: "docs" | "apps",
  userId: string,
  opts: { limit: number; cursor?: string | null; sinceSec?: number | null }
): Promise<{ rows: T[]; next_cursor: string | null }> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit)));
  let updatedAtCursor = Number.MAX_SAFE_INTEGER;
  let idCursor = "\uFFFF";
  if (opts.cursor) {
    const parts = decodeCursor(opts.cursor);
    if (parts && parts.length >= 2) {
      updatedAtCursor = Number(parts[0]) || Number.MAX_SAFE_INTEGER;
      idCursor = parts[1] ?? "\uFFFF";
    }
  }
  const sinceClause = opts.sinceSec != null ? `AND updated_at > ?` : "";
  const binds: unknown[] = [userId, updatedAtCursor, idCursor];
  if (opts.sinceSec != null) binds.push(opts.sinceSec);
  binds.push(limit + 1);

  const { results } = await db
    .prepare(
      `SELECT * FROM ${table}
         WHERE user_id = ?
           AND (updated_at, id) < (?, ?)
           ${sinceClause}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`
    )
    .bind(...binds)
    .all<T>();
  const page = (results ?? []).slice(0, limit);
  let next: string | null = null;
  if ((results ?? []).length > limit && page.length > 0) {
    const last = page[page.length - 1];
    next = encodeCursor([last.updated_at, last.id]);
  }
  return { rows: page, next_cursor: next };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk loaders (used by merges / exports)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadAllChats(db: D1Database, userId: string): Promise<ChatRow[]> {
  await ensureUserDataTables(db);
  const { results } = await db
    .prepare(`SELECT * FROM chats WHERE user_id = ?`)
    .bind(userId)
    .all<ChatRow>();
  return results ?? [];
}

export async function loadAllDocs(db: D1Database, userId: string): Promise<DocRow[]> {
  await ensureUserDataTables(db);
  const { results } = await db
    .prepare(`SELECT * FROM docs WHERE user_id = ?`)
    .bind(userId)
    .all<DocRow>();
  return results ?? [];
}

export async function loadAllApps(db: D1Database, userId: string): Promise<AppRow[]> {
  await ensureUserDataTables(db);
  const { results } = await db
    .prepare(`SELECT * FROM apps WHERE user_id = ?`)
    .bind(userId)
    .all<AppRow>();
  return results ?? [];
}

export async function loadChatMessagesForChats(
  db: D1Database,
  userId: string,
  chatIds: string[]
): Promise<ChatMessageRow[]> {
  if (chatIds.length === 0) return [];
  // Batch in chunks of 100 to keep binds small.
  const out: ChatMessageRow[] = [];
  const CHUNK = 100;
  for (let i = 0; i < chatIds.length; i += CHUNK) {
    const slice = chatIds.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT * FROM chat_messages
           WHERE user_id = ? AND chat_id IN (${placeholders})`
      )
      .bind(userId, ...slice)
      .all<ChatMessageRow>();
    out.push(...(results ?? []));
  }
  return out;
}

export async function loadTombstones(
  db: D1Database,
  userId: string,
  sinceMs?: number | null
): Promise<TombstoneRow[]> {
  await ensureUserDataTables(db);
  if (sinceMs != null) {
    const { results } = await db
      .prepare(
        `SELECT * FROM tombstones WHERE user_id = ? AND deleted_at > ? ORDER BY deleted_at ASC`
      )
      .bind(userId, sinceMs)
      .all<TombstoneRow>();
    return results ?? [];
  }
  const { results } = await db
    .prepare(`SELECT * FROM tombstones WHERE user_id = ?`)
    .bind(userId)
    .all<TombstoneRow>();
  return results ?? [];
}

export async function loadProfile(db: D1Database, userId: string): Promise<ProfileRow | null> {
  await ensureUserDataTables(db);
  const row = await db
    .prepare(`SELECT * FROM profile WHERE user_id = ?`)
    .bind(userId)
    .first<ProfileRow>();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writers
// ─────────────────────────────────────────────────────────────────────────────

/** D1 batch cap is 100 statements per call; chunk at 80 for safety margin. */
const BATCH_CHUNK = 80;

async function runBatched(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += BATCH_CHUNK) {
    await db.batch(stmts.slice(i, i + BATCH_CHUNK));
  }
}

export async function persistChats(db: D1Database, rows: ChatRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((c) =>
    db
      .prepare(
        `INSERT INTO chats
           (id, user_id, title, is_pinned, pinned_at, created_at, updated_at,
            last_message_at, last_message_preview, message_count, next_seq,
            meta_json, meta_hash, payload_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           is_pinned = excluded.is_pinned,
           pinned_at = excluded.pinned_at,
           updated_at = excluded.updated_at,
           last_message_at = excluded.last_message_at,
           last_message_preview = excluded.last_message_preview,
           message_count = excluded.message_count,
           next_seq = MAX(chats.next_seq, excluded.next_seq),
           meta_json = excluded.meta_json,
           meta_hash = excluded.meta_hash,
           payload_json = excluded.payload_json,
           content_hash = excluded.content_hash`
      )
      .bind(
        c.id,
        c.user_id,
        c.title,
        c.is_pinned,
        c.pinned_at,
        c.created_at,
        c.updated_at,
        c.last_message_at,
        c.last_message_preview,
        c.message_count,
        c.next_seq,
        c.meta_json,
        c.meta_hash,
        c.meta_json,
        c.meta_hash
      )
  );
  await runBatched(db, stmts);
}

export async function persistChatMessages(
  db: D1Database,
  rows: ChatMessageRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((m) =>
    db
      .prepare(
        `INSERT INTO chat_messages
           (chat_id, user_id, seq, created_at, role, content_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, seq) DO UPDATE SET
           created_at = excluded.created_at,
           role = excluded.role,
           content_json = excluded.content_json,
           content_hash = excluded.content_hash
         WHERE excluded.created_at > chat_messages.created_at
            OR (
              excluded.created_at = chat_messages.created_at
              AND excluded.content_hash <> chat_messages.content_hash
            )`
      )
      .bind(
        m.chat_id,
        m.user_id,
        m.seq,
        m.created_at,
        m.role,
        m.content_json,
        m.content_hash
      )
  );
  await runBatched(db, stmts);
}

export async function persistDocs(db: D1Database, rows: DocRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((d) =>
    db
      .prepare(
        `INSERT INTO docs (id, user_id, chat_id, kind, title, doc_company, html, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           chat_id = excluded.chat_id,
           kind = excluded.kind,
           title = excluded.title,
           doc_company = excluded.doc_company,
           html = excluded.html,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`
      )
      .bind(
        d.id,
        d.user_id,
        d.chat_id,
        d.kind,
        d.title,
        d.doc_company,
        d.html,
        d.content_hash,
        d.created_at,
        d.updated_at
      )
  );
  await runBatched(db, stmts);
}

export async function persistApps(db: D1Database, rows: AppRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((a) =>
    db
      .prepare(
        `INSERT INTO apps (id, user_id, chat_id, kind, title, payload_json, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           chat_id = excluded.chat_id,
           kind = excluded.kind,
           title = excluded.title,
           payload_json = excluded.payload_json,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`
      )
      .bind(
        a.id,
        a.user_id,
        a.chat_id,
        a.kind,
        a.title,
        a.payload_json,
        a.content_hash,
        a.created_at,
        a.updated_at
      )
  );
  await runBatched(db, stmts);
}

export async function persistTombstones(
  db: D1Database,
  rows: TombstoneRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((t) =>
    db
      .prepare(
        `INSERT INTO tombstones (user_id, kind, entity_id, deleted_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, kind, entity_id) DO UPDATE SET
           deleted_at = MAX(tombstones.deleted_at, excluded.deleted_at)`
      )
      .bind(t.user_id, t.kind, t.entity_id, t.deleted_at)
  );
  await runBatched(db, stmts);
}

export async function persistProfile(db: D1Database, p: ProfileRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile (user_id, you_name, you_school, you_work, you_interests, dismissed_interest_chips,
                            resume_plain, resume_doc_html, resume_file_r2_key, resume_file_name,
                            resume_file_mime, resume_file_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         you_name = excluded.you_name,
         you_school = excluded.you_school,
         you_work = excluded.you_work,
         you_interests = excluded.you_interests,
         dismissed_interest_chips = excluded.dismissed_interest_chips,
         resume_plain = excluded.resume_plain,
         resume_doc_html = excluded.resume_doc_html,
         resume_file_r2_key = excluded.resume_file_r2_key,
         resume_file_name = excluded.resume_file_name,
         resume_file_mime = excluded.resume_file_mime,
         resume_file_size = excluded.resume_file_size,
         updated_at = excluded.updated_at`
    )
    .bind(
      p.user_id,
      p.you_name,
      p.you_school,
      p.you_work,
      p.you_interests,
      p.dismissed_interest_chips,
      p.resume_plain,
      p.resume_doc_html,
      p.resume_file_r2_key,
      p.resume_file_name,
      p.resume_file_mime,
      p.resume_file_size,
      p.updated_at
    )
    .run();
}

export async function deleteChat(
  db: D1Database,
  userId: string,
  chatId: string
): Promise<void> {
  await ensureUserDataTables(db);
  // chat_messages and (docs/apps chat_id refs) are handled by ON DELETE
  // CASCADE / SET NULL from the schema, so one statement is enough.
  await db
    .prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`)
    .bind(chatId, userId)
    .run();
}
