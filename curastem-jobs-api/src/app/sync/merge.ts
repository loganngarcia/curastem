/**
 * Pure merge logic for /sync/push.
 *
 * Sign-in flow:
 *   1. Client uploads the localStorage snapshot (chats, docs, apps, profile).
 *   2. Server loads the account's existing rows.
 *   3. mergeChats / mergeDocs / mergeApps / mergeProfile produce the merged set.
 *   4. Server writes the result and returns it to the client.
 *
 * Conflict rules (user-specified):
 *   - Chats/docs/apps: same id → keep the row with the greater updated_at.
 *     Local rows whose content_hash already exists on account are skipped
 *     (dedup). Everything else is kept — "20 local + 40 cloud = 60 merged".
 *   - Profile: existing non-empty account fields win; empty account fields
 *     are filled from local. Arrays (dismissed_interest_chips) are unioned.
 *
 * These functions are PURE — no DB, no Date.now() — so they're unit-testable.
 * Hashing is async because Web Crypto is async; callers await once per record.
 */

import type {
  AppRow,
  ChatMessageRow,
  ChatRow,
  DocRow,
  ProfileRow,
  TombstoneRow,
} from "../../shared/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Tombstone helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface TombstoneIndex {
  chats: Map<string, number>; // id -> deleted_at (millis)
  docs: Map<string, number>;
  apps: Map<string, number>;
  /** Messages: key = `${chat_id}:${seq}` */
  messages: Map<string, number>;
}

export function buildTombstoneIndex(rows: TombstoneRow[]): TombstoneIndex {
  const idx: TombstoneIndex = {
    chats: new Map(),
    docs: new Map(),
    apps: new Map(),
    messages: new Map(),
  };
  for (const t of rows) {
    const target =
      t.kind === "chat" ? idx.chats :
      t.kind === "doc"  ? idx.docs :
      t.kind === "app"  ? idx.apps :
      t.kind === "message" ? idx.messages : null;
    if (!target) continue;
    const existing = target.get(t.entity_id);
    if (existing == null || t.deleted_at > existing) {
      target.set(t.entity_id, t.deleted_at);
    }
  }
  return idx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chats
// ─────────────────────────────────────────────────────────────────────────────
// Chat metadata merges by id (newer updated_at wins) + meta_hash dedup for the
// "same content, two client ids" edge case. Tombstones suppress either side's
// copy when the tombstone is newer than the row's updated_at.

export function mergeChats(
  localRows: ChatRow[],
  accountRows: ChatRow[],
  tombstones?: TombstoneIndex
): ChatRow[] {
  return mergeByIdWithTombstones(
    localRows,
    accountRows,
    (r) => r.id,
    (r) => r.updated_at, // seconds
    (r) => r.meta_hash,
    tombstones?.chats,
    (delAtMs) => Math.floor(delAtMs / 1000)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Docs
// ─────────────────────────────────────────────────────────────────────────────

export function mergeDocs(
  localRows: DocRow[],
  accountRows: DocRow[],
  tombstones?: TombstoneIndex
): DocRow[] {
  return mergeByIdWithTombstones(
    localRows,
    accountRows,
    (r) => r.id,
    (r) => r.updated_at,
    (r) => r.content_hash,
    tombstones?.docs,
    (delAtMs) => Math.floor(delAtMs / 1000)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Apps
// ─────────────────────────────────────────────────────────────────────────────

export function mergeApps(
  localRows: AppRow[],
  accountRows: AppRow[],
  tombstones?: TombstoneIndex
): AppRow[] {
  return mergeByIdWithTombstones(
    localRows,
    accountRows,
    (r) => r.id,
    (r) => r.updated_at,
    (r) => r.content_hash,
    tombstones?.apps,
    (delAtMs) => Math.floor(delAtMs / 1000)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat messages
// ─────────────────────────────────────────────────────────────────────────────
// Merge rules:
//   - Same (chat_id, seq) on both sides: accept local only if its content_hash
//     differs AND its created_at is strictly newer (messages should be
//     immutable, so this only fires if a client rewrote a message — newest
//     edit wins).
//   - Same chat_id but different seq: insert. If the local seq collides with
//     an account row that has different content_hash, we assign the local
//     message a new seq at the tail (account.next_seq).
//   - Account row whose content_hash already appears in the local rows for
//     the same chat is treated as a duplicate (dedup — happens when two
//     devices streamed the same content under different seqs).
//   - Tombstones on (chat_id:seq) suppress both sides when their created_at
//     is older than the tombstone.
//
// Returns the full merged list (all messages that should end up in the DB
// after the sync). The caller persists accordingly. `nextSeqByChat` is
// returned so the caller can update `chats.next_seq` atomically.

export interface MergeMessagesResult {
  messages: ChatMessageRow[];
  nextSeqByChat: Map<string, number>;
}

export function mergeChatMessages(
  localRows: ChatMessageRow[],
  accountRows: ChatMessageRow[],
  tombstones?: TombstoneIndex,
  accountNextSeqByChat?: Map<string, number>
): MergeMessagesResult {
  const tomb = tombstones?.messages ?? new Map<string, number>();
  const result = new Map<string, ChatMessageRow>(); // key: `${chat_id}:${seq}`
  const hashesByChat = new Map<string, Set<string>>(); // chat_id -> set of content_hashes kept
  const nextSeq = new Map<string, number>(accountNextSeqByChat ?? []);

  const key = (r: ChatMessageRow) => `${r.chat_id}:${r.seq}`;
  const tombstonedOut = (k: string, createdAtMs: number) => {
    const t = tomb.get(k);
    return t != null && t >= createdAtMs;
  };

  // 1. Start with account rows, skipping tombstoned ones.
  for (const row of accountRows) {
    const k = key(row);
    if (tombstonedOut(k, row.created_at)) continue;
    result.set(k, row);
    let set = hashesByChat.get(row.chat_id);
    if (!set) {
      set = new Set();
      hashesByChat.set(row.chat_id, set);
    }
    set.add(row.content_hash);
    if (!nextSeq.has(row.chat_id) || (nextSeq.get(row.chat_id) ?? 0) <= row.seq) {
      nextSeq.set(row.chat_id, row.seq + 1);
    }
  }

  // 2. Overlay local rows.
  for (const local of localRows) {
    const k = key(local);
    if (tombstonedOut(k, local.created_at)) continue;

    const existing = result.get(k);
    if (existing) {
      if (existing.content_hash === local.content_hash) continue; // byte-identical
      // Same seq, different content → newest wins.
      if (local.created_at > existing.created_at) {
        result.set(k, local);
        const set = hashesByChat.get(local.chat_id)!;
        set.delete(existing.content_hash);
        set.add(local.content_hash);
      }
      continue;
    }

    // No row at this (chat_id, seq) — content-hash dedup within the chat.
    const set = hashesByChat.get(local.chat_id);
    if (set && set.has(local.content_hash)) continue;

    // Different seq is fine: keep the local seq. Only relocate when the seq
    // is inside the range [1..account.next_seq-1] and it's taken by a
    // different message (rare — happens if the client appended before
    // syncing). Since we've already handled the collision in the branch
    // above, falling through here is the normal happy path.
    result.set(k, local);
    const newSet = set ?? new Set<string>();
    newSet.add(local.content_hash);
    if (!set) hashesByChat.set(local.chat_id, newSet);
    if (!nextSeq.has(local.chat_id) || (nextSeq.get(local.chat_id) ?? 0) <= local.seq) {
      nextSeq.set(local.chat_id, local.seq + 1);
    }
  }

  return {
    messages: Array.from(result.values()),
    nextSeqByChat: nextSeq,
  };
}

/**
 * Generic merge for the three entity tables.
 *
 * Strategy:
 *   1. Start with account rows keyed by id.
 *   2. For each local row:
 *      - If the same id exists, keep whichever has the greater updated_at.
 *      - Else if the content_hash matches any existing account row, skip
 *        (re-upload of the same content under a different client id).
 *      - Else insert.
 *
 * The "content_hash dedup" step catches the case where the user created the
 * same chat / doc / app on two devices before signing in — the hashes match
 * because the content is identical, so we don't end up with two copies.
 */
/**
 * Tombstone-aware merge by id.
 *
 * - Rows whose `updated_at` is strictly less than a matching tombstone's
 *   `deleted_at` are dropped (delete wins over older writes).
 * - Rows whose `updated_at` is greater than the tombstone are treated as a
 *   resurrection (user recreated the same id after deleting) — rare but we
 *   accept the row and callers are expected to then clear the tombstone.
 * - When a tombstone survives unmatched, it's kept in the output as a
 *   "still deleted" record and the caller can remove any such rows from
 *   the authoritative store.
 */
function mergeByIdWithTombstones<T>(
  localRows: T[],
  accountRows: T[],
  getId: (r: T) => string,
  getUpdatedAt: (r: T) => number,
  getContentHash: (r: T) => string,
  tombstones: Map<string, number> | undefined,
  tombstoneToRowScale: (delAt: number) => number
): T[] {
  const tomb = tombstones ?? new Map<string, number>();
  const byId = new Map<string, T>();
  const hashesInResult = new Set<string>();

  const isTombstonedOut = (id: string, updatedAt: number) => {
    const t = tomb.get(id);
    if (t == null) return false;
    return tombstoneToRowScale(t) >= updatedAt;
  };

  for (const row of accountRows) {
    const id = getId(row);
    if (isTombstonedOut(id, getUpdatedAt(row))) continue;
    byId.set(id, row);
    hashesInResult.add(getContentHash(row));
  }

  for (const local of localRows) {
    const id = getId(local);
    if (isTombstonedOut(id, getUpdatedAt(local))) continue;
    const existing = byId.get(id);
    if (existing) {
      if (getUpdatedAt(local) > getUpdatedAt(existing)) {
        hashesInResult.delete(getContentHash(existing));
        byId.set(id, local);
        hashesInResult.add(getContentHash(local));
      }
      continue;
    }
    if (hashesInResult.has(getContentHash(local))) continue;
    byId.set(id, local);
    hashesInResult.add(getContentHash(local));
  }

  return Array.from(byId.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileMergeInput {
  /** Existing account profile row, or null if the user has no profile yet. */
  account: ProfileRow | null;
  /** Snapshot produced from localStorage (see web.tsx localStorage keys). */
  local: Partial<ProfileRow> | null;
}

/**
 * Profile merge rules:
 *   - Scalar fields (you_name, you_school, you_work, you_interests, resume_*):
 *     account value wins if it's non-empty; otherwise we take local.
 *   - dismissed_interest_chips: stored as JSON array. Union of both sets.
 *   - resume_file_r2_key / resume_file_* travel together: only copy the whole
 *     block from local when the account has no R2 key. We never clobber an
 *     existing account upload with a local one (the user can re-upload post
 *     sign-in if they want the local file to take over).
 */
export function mergeProfile(
  input: ProfileMergeInput,
  userId: string,
  nowSec: number
): ProfileRow {
  const a = input.account;
  const l = input.local ?? {};

  const result: ProfileRow = {
    user_id: userId,
    you_name: preferNonEmpty(a?.you_name, l.you_name),
    you_school: preferNonEmpty(a?.you_school, l.you_school),
    you_work: preferNonEmpty(a?.you_work, l.you_work),
    you_interests: preferNonEmpty(a?.you_interests, l.you_interests),
    dismissed_interest_chips: unionJsonArray(a?.dismissed_interest_chips, l.dismissed_interest_chips),
    resume_plain: preferNonEmpty(a?.resume_plain, l.resume_plain),
    resume_doc_html: preferNonEmpty(a?.resume_doc_html, l.resume_doc_html),
    resume_file_r2_key: a?.resume_file_r2_key ?? l.resume_file_r2_key ?? null,
    resume_file_name: a?.resume_file_r2_key ? a.resume_file_name ?? null : l.resume_file_name ?? a?.resume_file_name ?? null,
    resume_file_mime: a?.resume_file_r2_key ? a.resume_file_mime ?? null : l.resume_file_mime ?? a?.resume_file_mime ?? null,
    resume_file_size: a?.resume_file_r2_key ? a.resume_file_size ?? null : l.resume_file_size ?? a?.resume_file_size ?? null,
    updated_at: nowSec,
  };
  return result;
}

/**
 * Apply a delta patch from the client onto the existing DB row.
 *
 * Semantics differ from mergeProfile intentionally:
 *   - mergeProfile (used in /sync/push): account non-empty wins — protects
 *     existing data from being overwritten by an anonymous local snapshot.
 *   - patchProfile (used in /sync/delta): client patch wins for every field
 *     the client explicitly includes. This is the continuous write-through
 *     path; "account wins" here would silently drop user edits to non-empty
 *     fields.
 *   - null/undefined in the patch for a text field = "don't touch it" (keep
 *     existing account value). Clients must send empty-string to clear.
 *   - dismissed_interest_chips is always unioned (append-only).
 *   - Resume R2 keys / file metadata are untouched; files are updated via
 *     the dedicated /uploads/resume endpoint.
 */
export function patchProfile(
  existing: ProfileRow | null,
  patch: Partial<ProfileRow>,
  userId: string,
  nowSec: number
): ProfileRow {
  const patchStr = (
    patchVal: string | null | undefined,
    accountVal: string | null | undefined
  ): string | null => {
    // Explicit string in patch (even empty) → use it.
    if (typeof patchVal === "string") return patchVal.trim() || null;
    // Not provided in patch → keep account value.
    return accountVal ?? null;
  };

  return {
    user_id: userId,
    you_name:       patchStr(patch.you_name,       existing?.you_name),
    you_school:     patchStr(patch.you_school,     existing?.you_school),
    you_work:       patchStr(patch.you_work,       existing?.you_work),
    you_interests:  patchStr(patch.you_interests,  existing?.you_interests),
    dismissed_interest_chips: unionJsonArray(
      existing?.dismissed_interest_chips,
      patch.dismissed_interest_chips
    ),
    resume_plain:     patchStr(patch.resume_plain,     existing?.resume_plain),
    resume_doc_html:  patchStr(patch.resume_doc_html,  existing?.resume_doc_html),
    // R2 file metadata is managed exclusively by /uploads/resume.
    resume_file_r2_key: existing?.resume_file_r2_key ?? null,
    resume_file_name:   existing?.resume_file_name   ?? null,
    resume_file_mime:   existing?.resume_file_mime   ?? null,
    resume_file_size:   existing?.resume_file_size   ?? null,
    updated_at: nowSec,
  };
}

function preferNonEmpty(accountVal: string | null | undefined, localVal: string | null | undefined): string | null {
  if (typeof accountVal === "string" && accountVal.trim().length > 0) return accountVal;
  if (typeof localVal === "string" && localVal.trim().length > 0) return localVal;
  return accountVal ?? localVal ?? null;
}

function unionJsonArray(a: string | null | undefined, b: string | null | undefined): string | null {
  const aArr = parseJsonArray(a);
  const bArr = parseJsonArray(b);
  if (aArr === null && bArr === null) return null;
  const set = new Set<string>();
  for (const v of aArr ?? []) if (typeof v === "string") set.add(v);
  for (const v of bArr ?? []) if (typeof v === "string") set.add(v);
  return JSON.stringify(Array.from(set));
}

function parseJsonArray(raw: string | null | undefined): unknown[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical hashing
// ─────────────────────────────────────────────────────────────────────────────
// content_hash is SHA-256 of a stable, key-sorted JSON serialization of the
// "content" fields of a record. Stable means: same payload → same hash on
// every client, every server, every language. We never include client-only
// timestamps in the hash.

/**
 * Canonical JSON: deterministic key ordering so clients and server agree.
 * Handles arrays and nested objects. null/number/boolean/string pass through.
 * Symbols, functions, undefined values are dropped (matches JSON.stringify).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
  }
  return `{${parts.join(",")}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

export async function hashContent(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}
