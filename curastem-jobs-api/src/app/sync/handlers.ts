/**
 * Cross-device sync endpoints (v2).
 *
 *   POST /sync/push   Big, one-shot upload of the client's localStorage
 *                     snapshot. Used on FIRST sign-in of a device to seed
 *                     the cloud account with any anonymous local data.
 *                     Returns the full merged metadata + last N messages per
 *                     chat. Subsequent syncs should use /sync/delta.
 *
 *   GET  /sync/pull   Initial pull used by a device that already has a
 *                     session but no local cache (e.g. different browser).
 *                     Returns the same shape as /sync/push minus the
 *                     snapshot upload.
 *
 *   POST /sync/delta  Continuous sync. Body: { since, ... (optional patches) }.
 *                     Returns { chats, messages, tombstones } that changed
 *                     after `since`. If the body contains local patches
 *                     (chat meta changes, appended messages, tombstones)
 *                     they're merged in first, then the server changes are
 *                     returned to the client.
 *
 * Merge semantics (same across all three):
 *   chats     — newest updated_at wins; meta_hash dedups same content under
 *               different client ids.
 *   messages  — newest created_at wins when (chat_id, seq) collide with
 *               different content; content_hash dedups same content under
 *               different seqs.
 *   profile   — account non-empty fields win; local fills empty fields.
 *   tombstones — unioned; suppress matching rows on either side whose
 *                updated_at is not newer than the tombstone.
 */

import type {
  AppRow,
  ChatMessageRow,
  ChatRow,
  DocRow,
  Env,
  ProfileRow,
  TombstoneRow,
  UserRow,
} from "../../shared/types.ts";
import { readSession } from "../auth/session.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { logger } from "../../shared/utils/logger.ts";
import {
  extractChatSession,
  rehydrateChatSession,
  type ClientChatSession,
} from "./extractors.ts";
import {
  buildTombstoneIndex,
  mergeApps,
  mergeChatMessages,
  mergeChats,
  mergeDocs,
  mergeProfile,
  patchProfile,
} from "./merge.ts";
import {
  loadAllApps,
  loadAllChats,
  loadAllDocs,
  loadChatMessagesForChats,
  loadProfile,
  loadTombstones,
  persistApps,
  persistChatMessages,
  persistChats,
  persistDocs,
  persistProfile,
  persistTombstones,
  listChatMessages,
} from "../userContent/data.ts";
import { ensureUserDataTables } from "../../shared/db/queries.ts";

// Cap on /sync/push — the initial merge can be big (a long-time guest's
// entire chat history), but 5MB of JSON is still ~5k chats or ~50k
// messages, which is well past any realistic guest session. Anything
// above that is almost certainly a bug or abuse.
const MAX_PUSH_BYTES = 5 * 1024 * 1024;
// Delta payloads are much smaller (one patch = one chat/message). 1MB is
// generous — a few hundred queued messages worth — while still protecting
// us from a runaway client.
const MAX_DELTA_BYTES = 1 * 1024 * 1024;
/** Last N messages embedded per chat in the /sync/push and /sync/pull responses. */
const INITIAL_MESSAGES_PER_CHAT = 10;

// ─────────────────────────────────────────────────────────────────────────────
// GET /sync/pull
// ─────────────────────────────────────────────────────────────────────────────

export async function handleSyncPull(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  await ensureUserDataTables(env.JOBS_DB);

  const [chats, docs, apps, profile, tombstones] = await Promise.all([
    loadAllChats(env.JOBS_DB, active.user.id),
    loadAllDocs(env.JOBS_DB, active.user.id),
    loadAllApps(env.JOBS_DB, active.user.id),
    loadProfile(env.JOBS_DB, active.user.id),
    loadTombstones(env.JOBS_DB, active.user.id),
  ]);

  // Eager: load only the last N messages per chat to keep the payload small.
  const messagesByChat = await loadTailMessages(
    env.JOBS_DB,
    active.user.id,
    chats,
    INITIAL_MESSAGES_PER_CHAT
  );

  return jsonOk({
    ...buildSnapshot(active.user, chats, messagesByChat, docs, apps, profile),
    tombstones: tombstones.map(toPublicTombstone),
    // Server-side anchor so the client watermark is based on server clock,
    // not the (potentially skewed) client clock.
    sync_watermark: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /sync/push
// ─────────────────────────────────────────────────────────────────────────────

export async function handleSyncPush(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  await ensureUserDataTables(env.JOBS_DB);

  const raw = await request.text();
  if (raw.length > MAX_PUSH_BYTES) {
    return Errors.badRequest(`Payload exceeds ${MAX_PUSH_BYTES} bytes`);
  }

  let body: SyncPushBody;
  try {
    body = JSON.parse(raw) as SyncPushBody;
  } catch {
    return Errors.badRequest("Request body must be JSON");
  }

  const userId = active.user.id;
  const nowSec = Math.floor(Date.now() / 1000);

  // Extract all local rows from the client sessions.
  const localChats: ChatRow[] = [];
  const localMessages: ChatMessageRow[] = [];
  const localDocs: DocRow[] = [];
  const localApps: AppRow[] = [];

  for (const session of body.chats ?? []) {
    if (!session || typeof session.id !== "string") continue;
    try {
      const { chat, messages, docs, apps } = await extractChatSession(
        session,
        userId,
        nowSec
      );
      localChats.push(chat);
      localMessages.push(...messages);
      localDocs.push(...docs);
      localApps.push(...apps);
    } catch (err) {
      logger.warn("extract_chat_failed", {
        chat_id: session.id,
        error: String(err),
      });
    }
  }

  // Normalize local tombstones (client uses millis; we store millis).
  const localTombstones: TombstoneRow[] = (body.tombstones ?? [])
    .filter(
      (t): t is { kind: TombstoneRow["kind"]; entity_id: string; deleted_at: number } =>
        !!t &&
        typeof t === "object" &&
        (t.kind === "chat" || t.kind === "doc" || t.kind === "app" || t.kind === "message") &&
        typeof t.entity_id === "string" &&
        typeof t.deleted_at === "number"
    )
    .map((t) => ({
      user_id: userId,
      kind: t.kind,
      entity_id: t.entity_id,
      deleted_at: t.deleted_at,
    }));

  // Load existing account state.
  const [accountChats, accountDocs, accountApps, accountProfile, accountTombstones] =
    await Promise.all([
      loadAllChats(env.JOBS_DB, userId),
      loadAllDocs(env.JOBS_DB, userId),
      loadAllApps(env.JOBS_DB, userId),
      loadProfile(env.JOBS_DB, userId),
      loadTombstones(env.JOBS_DB, userId),
    ]);

  const tombstoneIndex = buildTombstoneIndex([
    ...accountTombstones,
    ...localTombstones,
  ]);

  // Merge metadata first; we only need the account's existing messages for
  // the chats that touch the merged set.
  const mergedChats = mergeChats(localChats, accountChats, tombstoneIndex);
  const mergedDocs = mergeDocs(localDocs, accountDocs, tombstoneIndex);
  const mergedApps = mergeApps(localApps, accountApps, tombstoneIndex);

  // Messages — pull account-side rows for any chat that appears in either set.
  const touchedChatIds = new Set<string>([
    ...localChats.map((c) => c.id),
    ...mergedChats.map((c) => c.id),
  ]);
  const accountMessages = await loadChatMessagesForChats(
    env.JOBS_DB,
    userId,
    Array.from(touchedChatIds)
  );
  const accountNextSeq = new Map<string, number>();
  for (const c of accountChats) accountNextSeq.set(c.id, c.next_seq);

  const { messages: mergedMessages, nextSeqByChat } = mergeChatMessages(
    localMessages,
    accountMessages,
    tombstoneIndex,
    accountNextSeq
  );

  // Patch next_seq and denormalized last_message_* on merged chat rows so
  // the DB reflects the real tail after the merge.
  const lastMsgPerChat = new Map<string, { ts: number; preview: string | null }>();
  for (const m of mergedMessages) {
    const preview = extractPreview(m);
    const prev = lastMsgPerChat.get(m.chat_id);
    if (!prev || m.created_at > prev.ts) {
      lastMsgPerChat.set(m.chat_id, { ts: m.created_at, preview });
    }
  }

  const chatsToWrite = mergedChats.map((c) => {
    const tail = lastMsgPerChat.get(c.id);
    const nextSeq = nextSeqByChat.get(c.id) ?? c.next_seq;
    const countForChat = mergedMessages.filter((m) => m.chat_id === c.id).length;
    const lastAt = tail ? tail.ts : c.last_message_at;
    const updatedAtSec = Math.max(
      c.updated_at,
      tail ? Math.floor(tail.ts / 1000) : 0
    );
    return {
      ...c,
      next_seq: nextSeq,
      message_count: countForChat,
      last_message_at: lastAt ?? null,
      last_message_preview: tail ? tail.preview : c.last_message_preview,
      updated_at: updatedAtSec,
    } satisfies ChatRow;
  });

  const mergedProfile = mergeProfile(
    {
      account: accountProfile,
      local: normalizeLocalProfile(body.profile ?? null),
    },
    userId,
    nowSec
  );

  // Persist — one table at a time so failures are recoverable.
  await persistChats(env.JOBS_DB, chatsToWrite);
  await persistChatMessages(env.JOBS_DB, mergedMessages);
  await persistDocs(env.JOBS_DB, mergedDocs);
  await persistApps(env.JOBS_DB, mergedApps);
  await persistTombstones(env.JOBS_DB, localTombstones);
  await persistProfile(env.JOBS_DB, mergedProfile);

  // Apply tombstones: hard-delete any currently-existing rows for tombstoned
  // ids whose updated_at is not newer than the tombstone.
  await applyTombstones(env.JOBS_DB, userId);

  // Notify SSE streams on other devices via KV dirty flag.
  void markUserDirty(env.RATE_LIMIT_KV, userId);

  // Response: metadata + last-N messages per chat.
  const finalChats = await loadAllChats(env.JOBS_DB, userId);
  const finalDocs = await loadAllDocs(env.JOBS_DB, userId);
  const finalApps = await loadAllApps(env.JOBS_DB, userId);
  const finalProfile = await loadProfile(env.JOBS_DB, userId);
  const tailMessages = await loadTailMessages(
    env.JOBS_DB,
    userId,
    finalChats,
    INITIAL_MESSAGES_PER_CHAT
  );

  return jsonOk({
    ...buildSnapshot(
      active.user,
      finalChats,
      tailMessages,
      finalDocs,
      finalApps,
      finalProfile
    ),
    sync_watermark: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /sync/delta
// ─────────────────────────────────────────────────────────────────────────────
// Delta sync — the regular background sync. Body:
//   {
//     since: number (millis),                       // server-issued watermark
//     chats?:    ChatPatch[],                       // title/pin/meta edits
//     messages?: MessagePatch[],                    // appended messages only
//     tombstones?: {kind,entity_id,deleted_at}[],
//     profile?: ClientProfilePayload
//   }
//
// Response:
//   {
//     server_changes: {
//       chats:    ChatSummary[],        // chats whose updated_at > since
//       messages: MessagePublic[],      // messages whose created_at_ms > since
//       tombstones: TombstonePublic[],
//       profile?: PublicProfile,        // if profile.updated_at > since
//     },
//     accepted: number,
//     sync_watermark: number            // new watermark for the client
//   }

export async function handleSyncDelta(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  await ensureUserDataTables(env.JOBS_DB);

  const raw = await request.text();
  if (raw.length > MAX_DELTA_BYTES) {
    return Errors.badRequest(`Payload exceeds ${MAX_DELTA_BYTES} bytes`);
  }
  let body: SyncDeltaBody;
  try {
    body = JSON.parse(raw) as SyncDeltaBody;
  } catch {
    return Errors.badRequest("Request body must be JSON");
  }
  const userId = active.user.id;
  const sinceMs = Number.isFinite(body.since) ? Number(body.since) : 0;

  // ── Apply client patches (all optional; delta may be a pure pull) ──
  let accepted = 0;

  if (Array.isArray(body.chats) && body.chats.length > 0) {
    // Load existing rows for these ids so we can honor newest-wins without a
    // blind overwrite.
    const ids = body.chats.map((c) => c.id).filter((id) => typeof id === "string");
    const existingMap = new Map<string, ChatRow>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const { results } = await env.JOBS_DB.prepare(
        `SELECT * FROM chats WHERE user_id = ? AND id IN (${placeholders})`
      )
        .bind(userId, ...ids)
        .all<ChatRow>();
      for (const r of results ?? []) existingMap.set(r.id, r);
    }
    const toWrite: ChatRow[] = [];
    for (const patch of body.chats) {
      const row = await buildChatRowFromPatch(userId, patch, existingMap.get(patch.id));
      if (row) toWrite.push(row);
    }
    await persistChats(env.JOBS_DB, toWrite);
    accepted += toWrite.length;
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const rows: ChatMessageRow[] = [];
    const receivedAtMs = Date.now();
    for (const p of body.messages) {
      if (
        !p ||
        typeof p.chat_id !== "string" ||
        typeof p.seq !== "number" ||
        typeof p.created_at !== "number" ||
        typeof p.role !== "string"
      )
        continue;
      const contentJson = JSON.stringify(p.content ?? null);
      const contentHash = await sha256HexFromString(canonicalizeJson(p.content ?? null));
      rows.push({
        chat_id: p.chat_id,
        user_id: userId,
        seq: p.seq,
        created_at: receivedAtMs + rows.length,
        role: p.role,
        content_json: contentJson,
        content_hash: contentHash,
      });
    }
    // Ensure every referenced chat exists before we try to INSERT messages —
    // otherwise the FK violates if the client sent messages faster than the
    // debounced chat_upsert patch flush. We create minimal placeholder rows
    // for any chat_id that isn't already on disk AND wasn't included in
    // body.chats. A later `chat_upsert` from the client will overwrite the
    // placeholder with real metadata via ON CONFLICT.
    if (rows.length > 0) {
      const referencedChatIds = Array.from(new Set(rows.map((r) => r.chat_id)));
      const placeholders = referencedChatIds.map(() => "?").join(",");
      const existing = await env.JOBS_DB
        .prepare(
          `SELECT id FROM chats WHERE user_id = ? AND id IN (${placeholders})`
        )
        .bind(userId, ...referencedChatIds)
        .all<{ id: string }>();
      const existingIds = new Set((existing.results ?? []).map((r) => r.id));
      const missingChatIds = referencedChatIds.filter((id) => !existingIds.has(id));
      if (missingChatIds.length > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const stubs: ChatRow[] = missingChatIds.map((id) => ({
          id,
          user_id: userId,
          title: null,
          is_pinned: 0,
          pinned_at: null,
          created_at: nowSec,
          updated_at: nowSec,
          last_message_at: null,
          last_message_preview: null,
          message_count: 0,
          next_seq: 1,
          meta_json: "{}",
          meta_hash: "",
        }));
        await persistChats(env.JOBS_DB, stubs);
      }
    }
    await persistChatMessages(env.JOBS_DB, rows);
    accepted += rows.length;

    // Touch chats.updated_at for every chat that just received new messages.
    // Without this, loadChatsChangedSince (used by SSE and delta) won't return
    // those chats to other devices — they'd receive the messages but not the
    // chat summary, causing messages to be silently discarded on the receiving
    // device (since applyServerChanges ignores messages for unknown chats).
    if (rows.length > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const touchedChatIds = [...new Set(rows.map((r) => r.chat_id))];
      await env.JOBS_DB.batch(
        touchedChatIds.map((id) =>
          env.JOBS_DB
            .prepare(
              `UPDATE chats
                  SET updated_at = MAX(updated_at, ?)
                WHERE id = ? AND user_id = ?`
            )
            .bind(nowSec, id, userId)
        )
      );
    }
  }

  if (Array.isArray(body.tombstones) && body.tombstones.length > 0) {
    const rows: TombstoneRow[] = body.tombstones
      .filter(
        (t): t is { kind: TombstoneRow["kind"]; entity_id: string; deleted_at: number } =>
          !!t &&
          typeof t === "object" &&
          (t.kind === "chat" || t.kind === "doc" || t.kind === "app" || t.kind === "message") &&
          typeof t.entity_id === "string" &&
          typeof t.deleted_at === "number"
      )
      .map((t) => ({
        user_id: userId,
        kind: t.kind,
        entity_id: t.entity_id,
        deleted_at: t.deleted_at,
      }));
    await persistTombstones(env.JOBS_DB, rows);
    await applyTombstones(env.JOBS_DB, userId);
    accepted += rows.length;
  }

  if (body.profile) {
    const existing = await loadProfile(env.JOBS_DB, userId);
    // Use patchProfile (client wins) rather than mergeProfile (account wins).
    // Delta is a continuous write-through; the client explicitly sent updated
    // values — silently preferring the DB value would drop user edits.
    const patched = patchProfile(
      existing,
      normalizeProfilePatch(body.profile) ?? {},
      userId,
      Math.floor(Date.now() / 1000)
    );
    await persistProfile(env.JOBS_DB, patched);
    accepted += 1;
  }

  // ── Notify SSE streams on other devices via KV dirty flag ──
  // Fire-and-forget: don't let a KV write delay the delta response.
  if (accepted > 0) {
    void markUserDirty(env.RATE_LIMIT_KV, userId);
  }

  // ── Collect server changes since `since` ──
  const nowMs = Date.now();
  const sinceSec = Math.max(0, Math.floor(sinceMs / 1000) - 1);

  const [changedChats, changedMsgs, tombsSince, profile] = await Promise.all([
    loadChatsChangedSince(env.JOBS_DB, userId, sinceSec),
    loadMessagesChangedSince(env.JOBS_DB, userId, sinceMs),
    loadTombstones(env.JOBS_DB, userId, sinceMs),
    loadProfile(env.JOBS_DB, userId),
  ]);

  return jsonOk({
    server_changes: {
      chats: changedChats.map(toPublicChatSummary),
      messages: changedMsgs.map(toPublicMessage),
      tombstones: tombsSince.map(toPublicTombstone),
      profile:
        profile && profile.updated_at >= sinceSec
          ? toPublicProfile(profile)
          : null,
    },
    accepted,
    sync_watermark: nowMs,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// KV dirty-flag helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// Every write path (push, delta) stamps a tiny "dirty" marker in KV so the
// SSE stream can detect changes by polling KV (~$0.0005 / million reads) instead
// of D1 (~$1 / million reads). This cuts D1 read volume by ~95 % at scale
// because the vast majority of SSE polls find no changes.
//
// Key:   sync_dirty:<userId>
// Value: "<timestampMs>"   (stringified, so KV stores it as UTF-8)
// TTL:   5 min — auto-expires so stale flags never pile up.

const DIRTY_FLAG_TTL_SECONDS = 5 * 60;

function dirtyKey(userId: string): string {
  return `sync_dirty:${userId}`;
}

/** Mark a user's data as dirty so SSE stream detects the change via KV. */
async function markUserDirty(kv: KVNamespace, userId: string): Promise<void> {
  try {
    await kv.put(dirtyKey(userId), String(Date.now()), {
      expirationTtl: DIRTY_FLAG_TTL_SECONDS,
    });
  } catch {
    // Best-effort — if KV write fails the SSE stream falls back to D1 polling.
  }
}

/**
 * Read the dirty timestamp for a user.
 * Returns the stored millis value, or 0 if the key is absent.
 */
async function readUserDirtyTs(kv: KVNamespace, userId: string): Promise<number> {
  try {
    const raw = await kv.get(dirtyKey(userId));
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — body shape & conversion
// ─────────────────────────────────────────────────────────────────────────────

interface SyncPushBody {
  chats?: ClientChatSession[];
  profile?: ClientProfilePayload;
  tombstones?: Array<{
    kind: TombstoneRow["kind"];
    entity_id: string;
    deleted_at: number;
  }>;
}

interface SyncDeltaBody {
  since: number;
  chats?: ChatPatch[];
  messages?: MessagePatch[];
  tombstones?: Array<{
    kind: TombstoneRow["kind"];
    entity_id: string;
    deleted_at: number;
  }>;
  profile?: ClientProfilePayload;
}

interface ChatPatch {
  id: string;
  title?: string | null;
  is_pinned?: boolean;
  pinned_at?: number | null;   // millis
  created_at?: number;          // millis
  updated_at?: number;          // millis
  meta?: Record<string, unknown>;
}

interface MessagePatch {
  chat_id: string;
  seq: number;
  role: string;
  content?: unknown;
  created_at: number; // millis
}

interface ClientProfilePayload {
  you_name?: string | null;
  you_school?: string | null;
  you_work?: string | null;
  you_interests?: string | null;
  profile_clear_fields?: string[] | null;
  dismissed_interest_chips?: string[] | string | null;
  resume_plain?: string | null;
  resume_doc_html?: string | null;
}

function normalizeLocalProfile(p: ClientProfilePayload | null): Partial<ProfileRow> | null {
  if (!p) return null;
  const dismissed =
    Array.isArray(p.dismissed_interest_chips)
      ? JSON.stringify(
          p.dismissed_interest_chips.filter((x) => typeof x === "string")
        )
      : typeof p.dismissed_interest_chips === "string"
        ? p.dismissed_interest_chips
        : null;
  return {
    you_name: nullEmpty(p.you_name),
    you_school: nullEmpty(p.you_school),
    you_work: nullEmpty(p.you_work),
    you_interests: nullEmpty(p.you_interests),
    dismissed_interest_chips: dismissed,
    resume_plain: nullEmpty(p.resume_plain),
    resume_doc_html: nullEmpty(p.resume_doc_html),
  };
}

function normalizeProfilePatch(p: ClientProfilePayload | null): Partial<ProfileRow> | null {
  if (!p) return null;
  const explicitClears = new Set(
    Array.isArray(p.profile_clear_fields)
      ? p.profile_clear_fields.filter((x) => typeof x === "string")
      : []
  );
  const patchText = (
    field: "you_name" | "you_school" | "you_work" | "you_interests",
    value: string | null | undefined
  ): string | null => {
    if (typeof value !== "string") return null;
    if (value.trim()) return value;
    return explicitClears.has(field) ? "" : null;
  };
  const dismissed =
    Array.isArray(p.dismissed_interest_chips)
      ? JSON.stringify(
          p.dismissed_interest_chips.filter((x) => typeof x === "string")
        )
      : typeof p.dismissed_interest_chips === "string"
        ? p.dismissed_interest_chips
        : null;
  return {
    you_name: patchText("you_name", p.you_name),
    you_school: patchText("you_school", p.you_school),
    you_work: patchText("you_work", p.you_work),
    you_interests: patchText("you_interests", p.you_interests),
    dismissed_interest_chips: dismissed,
    resume_plain: typeof p.resume_plain === "string" ? p.resume_plain : null,
    resume_doc_html: typeof p.resume_doc_html === "string" ? p.resume_doc_html : null,
  };
}

function nullEmpty(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  return v.length > 0 ? v : null;
}

async function buildChatRowFromPatch(
  userId: string,
  patch: ChatPatch,
  existing: ChatRow | undefined
): Promise<ChatRow | null> {
  if (!patch || typeof patch.id !== "string") return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const base: ChatRow = existing ?? {
    id: patch.id,
    user_id: userId,
    title: null,
    is_pinned: 0,
    pinned_at: null,
    created_at: nowSec,
    // Use 0 (not nowSec) so the newest-wins check below never drops a patch
    // for a brand-new chat.  The patch's updated_at is the client's chat
    // creation timestamp (seconds/minutes ago), so comparing it against the
    // current server time would always fail and silently discard the row.
    updated_at: 0,
    last_message_at: null,
    last_message_preview: null,
    message_count: 0,
    next_seq: 1,
    meta_json: "{}",
    meta_hash: "",
  };
  const updatedAtSec =
    typeof patch.updated_at === "number"
      ? Math.floor(patch.updated_at / 1000)
      : nowSec;
  // Newest-wins: drop the patch if the account already has a newer row.
  // For brand-new chats (existing === undefined) base.updated_at is 0 so
  // this check is always false — every patch for a new chat is accepted.
  if (updatedAtSec < base.updated_at) return null;

  const title = patch.title !== undefined ? patch.title : base.title;
  const isPinned = patch.is_pinned !== undefined ? (patch.is_pinned ? 1 : 0) : base.is_pinned;
  const pinnedAt =
    patch.pinned_at !== undefined
      ? typeof patch.pinned_at === "number"
        ? Math.floor(patch.pinned_at / 1000)
        : null
      : base.pinned_at;
  let metaJson = base.meta_json;
  if (patch.meta !== undefined) metaJson = JSON.stringify(patch.meta ?? {});

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(metaJson || "{}");
  } catch {
    meta = {};
  }
  const metaHash = await sha256HexFromString(
    canonicalizeJson({ title, isPinned, pinnedAt, meta })
  );

  return {
    ...base,
    title,
    is_pinned: isPinned,
    pinned_at: pinnedAt,
    meta_json: metaJson,
    meta_hash: metaHash,
    updated_at: updatedAtSec,
    created_at:
      typeof patch.created_at === "number"
        ? Math.floor(patch.created_at / 1000)
        : base.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — tombstone enforcement
// ─────────────────────────────────────────────────────────────────────────────

async function applyTombstones(db: D1Database, userId: string): Promise<void> {
  // For each row kind, delete rows whose updated_at (seconds) is <= the
  // tombstone's deleted_at (converted to seconds). Because updated_at is
  // monotonic on writes, a row that survived a tombstone is a legitimate
  // resurrection.
  await db
    .prepare(
      `DELETE FROM chats
         WHERE user_id = ?
           AND id IN (
             SELECT entity_id FROM tombstones
              WHERE user_id = ? AND kind = 'chat'
                AND deleted_at / 1000 >= chats.updated_at
           )`
    )
    .bind(userId, userId)
    .run();
  await db
    .prepare(
      `DELETE FROM docs
         WHERE user_id = ?
           AND id IN (
             SELECT entity_id FROM tombstones
              WHERE user_id = ? AND kind = 'doc'
                AND deleted_at / 1000 >= docs.updated_at
           )`
    )
    .bind(userId, userId)
    .run();
  await db
    .prepare(
      `DELETE FROM apps
         WHERE user_id = ?
           AND id IN (
             SELECT entity_id FROM tombstones
              WHERE user_id = ? AND kind = 'app'
                AND deleted_at / 1000 >= apps.updated_at
           )`
    )
    .bind(userId, userId)
    .run();
  // Message tombstones: entity_id = `${chat_id}:${seq}`; match by concat.
  await db
    .prepare(
      `DELETE FROM chat_messages
         WHERE user_id = ?
           AND EXISTS (
             SELECT 1 FROM tombstones t
              WHERE t.user_id = ?
                AND t.kind = 'message'
                AND t.entity_id = chat_messages.chat_id || ':' || chat_messages.seq
                AND t.deleted_at >= chat_messages.created_at
           )`
    )
    .bind(userId, userId)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — read
// ─────────────────────────────────────────────────────────────────────────────

async function loadChatsChangedSince(
  db: D1Database,
  userId: string,
  sinceSec: number
): Promise<ChatRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM chats WHERE user_id = ? AND updated_at > ? ORDER BY updated_at DESC`
    )
    .bind(userId, sinceSec)
    .all<ChatRow>();
  return results ?? [];
}

async function loadMessagesChangedSince(
  db: D1Database,
  userId: string,
  sinceMs: number
): Promise<ChatMessageRow[]> {
  const lowerBoundMs = Math.max(0, sinceMs - 1000);
  const { results } = await db
    .prepare(
      `SELECT * FROM chat_messages WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC, seq ASC LIMIT 500`
    )
    .bind(userId, lowerBoundMs)
    .all<ChatMessageRow>();
  return results ?? [];
}

async function loadTailMessages(
  db: D1Database,
  userId: string,
  chats: ChatRow[],
  perChat: number
): Promise<Map<string, ChatMessageRow[]>> {
  const out = new Map<string, ChatMessageRow[]>();
  // Simple per-chat query. For users with hundreds of chats this is hot —
  // D1 handles it fine with the chat_recency index; if it ever becomes a
  // bottleneck we can replace with a CTE + window function.
  for (const c of chats) {
    const { messages } = await listChatMessages(db, userId, c.id, {
      limit: perChat,
    });
    out.set(
      c.id,
      messages
        .slice()
        .sort((a, b) => a.seq - b.seq || a.created_at - b.created_at)
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot / public shapes
// ─────────────────────────────────────────────────────────────────────────────

function buildSnapshot(
  user: UserRow,
  chats: ChatRow[],
  messagesByChat: Map<string, ChatMessageRow[]>,
  docs: DocRow[],
  apps: AppRow[],
  profile: ProfileRow | null
) {
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const appsById = new Map(apps.map((a) => [a.id, a]));

  const rehydrated = chats.map((c) => {
    const msgs = messagesByChat.get(c.id) ?? [];
    const session = rehydrateChatSession(c, msgs, docsById, appsById);
    return {
      ...session,
      // Signal to the client that more messages exist than are embedded here.
      _has_older_messages: c.message_count > msgs.length,
      _message_count: c.message_count,
      _last_message_at: c.last_message_at,
    };
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      photo_url: user.photo_url,
    },
    chats: rehydrated,
    profile: profile ? toPublicProfile(profile) : null,
  };
}

function toPublicProfile(profile: ProfileRow) {
  return {
    you_name: profile.you_name,
    you_school: profile.you_school,
    you_work: profile.you_work,
    you_interests: profile.you_interests,
    dismissed_interest_chips: parseJson(profile.dismissed_interest_chips),
    resume_plain: profile.resume_plain,
    resume_doc_html: profile.resume_doc_html,
    resume_file: profile.resume_file_r2_key
      ? {
          name: profile.resume_file_name,
          mime: profile.resume_file_mime,
          size: profile.resume_file_size,
        }
      : null,
    updated_at: profile.updated_at * 1000,
  };
}

function toPublicChatSummary(c: ChatRow) {
  let meta: unknown = {};
  try {
    meta = JSON.parse(c.meta_json || "{}");
  } catch {
    meta = {};
  }
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

function toPublicTombstone(t: TombstoneRow) {
  return { kind: t.kind, entity_id: t.entity_id, deleted_at: t.deleted_at };
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local hashing helpers (avoid a circular dep with sync/merge.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function sha256HexFromString(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalizeJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}

function extractPreview(m: ChatMessageRow): string | null {
  let content: unknown = null;
  try {
    content = JSON.parse(m.content_json);
  } catch {
    return null;
  }
  const c = content && typeof content === "object" ? (content as { content?: unknown }).content : null;
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
// GET /sync/stream — Server-Sent Events for real-time cross-device push
// ─────────────────────────────────────────────────────────────────────────────
//
// Keeps a persistent HTTP connection open and polls D1 every 1.5 s for
// changes since the client's watermark. When changes are found they are
// pushed immediately so the receiving device sees them within ~1–2 s instead
// of waiting for the next 30 s background poll.
//
// Connection lifecycle:
//   1. Client sends ?since=<watermark_ms>
//   2. Server streams SSE events: "connected", "changes", "ping", "reconnect"
//   3. After MAX_DURATION_MS the server sends "reconnect" and closes the
//      stream — the client immediately re-opens with the latest watermark.
//   4. Client disconnects abort the stream via request.signal.
//
// Resource cost: D1 I/O is async; each 1.5 s poll consumes ~1–3 ms of CPU.
// Over 55 s that is ~37 polls × 3 ms ≈ 110 ms CPU per connection — well
// within Cloudflare Workers limits.
export async function handleSyncStream(
  request: Request,
  env: Env
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");
  let watermark = sinceParam ? parseInt(sinceParam, 10) : 0;
  if (isNaN(watermark) || watermark < 0) watermark = 0;

  const userId = active.user.id;
  const encoder = new TextEncoder();
  // Close before Cloudflare's hard limit so the client can reconnect cleanly.
  const MAX_DURATION_MS = 55_000;
  const POLL_INTERVAL_MS = 1_500;
  const startedAt = Date.now();

  // Snapshot the KV dirty timestamp at connection time. We only query D1
  // when this value changes — turning ~95 % of polls into cheap KV reads
  // (~$0.0005/M) rather than D1 reads (~$1/M). At 1 M concurrent users this
  // difference is the line between a $500/month bill and a $50,000 one.
  let lastKnownDirtyTs = await readUserDirtyTs(env.RATE_LIMIT_KV, userId).catch(() => 0);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          // Stream already closed — ignore.
        }
      };

      // Confirm connection and let the client know the starting watermark.
      send("connected", { watermark, ts: Date.now() });

      while (true) {
        // Check for client disconnect first (before sleeping) so cleanup is fast.
        if (request.signal?.aborted) break;

        // Interruptible sleep: resolves early if the client disconnects.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, POLL_INTERVAL_MS);
          request.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });

        if (request.signal?.aborted) break;

        // Graceful close: tell the client to reconnect right away.
        if (Date.now() - startedAt >= MAX_DURATION_MS) {
          send("reconnect", { ts: Date.now() });
          break;
        }

        try {
          // ── Step 1: cheap KV read (skip D1 entirely if nothing changed) ──
          const dirtyTs = await readUserDirtyTs(env.RATE_LIMIT_KV, userId);
          if (dirtyTs <= lastKnownDirtyTs) {
            // No writes since the last poll — send a keepalive and continue.
            send("ping", { ts: Date.now() });
            continue;
          }
          // Something changed on another device — query D1 for the actual rows.
          lastKnownDirtyTs = dirtyTs;

          // ── Step 2: D1 read (only when KV says data changed) ──
          const sinceSec = Math.max(0, Math.floor(watermark / 1000) - 1);
          const [changedChats, changedMsgs, tombstones, profile] = await Promise.all([
            loadChatsChangedSince(env.JOBS_DB, userId, sinceSec),
            loadMessagesChangedSince(env.JOBS_DB, userId, watermark),
            loadTombstones(env.JOBS_DB, userId, watermark),
            loadProfile(env.JOBS_DB, userId),
          ]);
          const changedProfile =
            profile && profile.updated_at >= sinceSec ? toPublicProfile(profile) : null;

          const nowMs = Date.now();

          if (
            changedChats.length > 0 ||
            changedMsgs.length > 0 ||
            tombstones.length > 0 ||
            changedProfile
          ) {
            // Advance watermark so we don't re-send the same rows.
            watermark = nowMs;
            send("changes", {
              chats: changedChats.map(toPublicChatSummary),
              messages: changedMsgs.map(toPublicMessage),
              tombstones: tombstones.map(toPublicTombstone),
              profile: changedProfile,
              sync_watermark: nowMs,
            });
          } else {
            // KV said dirty but D1 returned nothing — possible race between
            // the KV write and D1 commit. Will resolve on the next tick.
            send("ping", { ts: nowMs });
          }
        } catch {
          // Transient KV or D1 error — skip this tick and retry next interval.
        }
      }

      try {
        controller.close();
      } catch {}
    },
    cancel() {
      // Client disconnected — the while loop will exit at the next signal check.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      // Prevent nginx/CDN buffering which would delay event delivery.
      "X-Accel-Buffering": "no",
    },
  });
}
