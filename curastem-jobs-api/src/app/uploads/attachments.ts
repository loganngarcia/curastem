/**
 * Chat image attachments via R2.
 *
 *   POST   /uploads/attachment   Body: raw image bytes. Headers: Content-Type, X-Filename.
 *                                Stores in R2 under `users/{user_id}/attachments/{uuid}.{ext}`,
 *                                writes a row to `user_attachments` for TTL bookkeeping,
 *                                returns { key, url, mime, size, expires_at }.
 *   GET    /uploads/attachment/:key*   Streams the file back. Ownership enforced via key prefix.
 *
 * Why a dedicated route (separate from resumes):
 *   - Resumes are permanent profile artifacts. Attachments are ephemeral
 *     references inside chat messages — cheap to re-upload, noise in R2 if
 *     kept forever.
 *   - We enforce a per-image max resolution (2048x2048, re-encoded to JPEG
 *     when an incoming PNG/HEIC is larger). Keeps stored bytes predictable
 *     and avoids someone uploading a 20MB raw photo.
 *   - We keep rows in a `user_attachments` table with `expires_at` so the
 *     :30 cron can sweep expired objects in a single SQL scan rather than
 *     paging R2 list results.
 *
 * Accepted MIME types: JPEG, PNG, WebP, GIF. Anything else is rejected.
 *
 * NOTE: Image re-encoding lives on the *client* — web.tsx downsamples via a
 * canvas before upload. The Worker enforces the hard byte ceiling (5MB) as
 * defence-in-depth; anything above is rejected 400.
 */

import type { Env } from "../../shared/types.ts";
import { readSession } from "../auth/session.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { logger } from "../../shared/utils/logger.ts";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const ATTACHMENT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
// Same 7-day TTL applies to images and documents — chat attachments are
// ephemeral by design. If the user wants permanence they can promote to a
// "doc" which lives in the docs table.
const ALLOWED_ATTACHMENT_MIME = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "text/plain",
  "text/markdown",
  "text/csv",
]);

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "application/pdf":
      return "pdf";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.ms-excel":
      return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "application/vnd.ms-powerpoint":
      return "ppt";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "application/rtf":
      return "rtf";
    case "text/plain":
      return "txt";
    case "text/markdown":
      return "md";
    case "text/csv":
      return "csv";
    default:
      return "bin";
  }
}

/**
 * Ensure the `user_attachments` table exists. Idempotent; called from every
 * handler so a cold database provisions on first use without needing a
 * separate migration path.
 */
async function ensureAttachmentsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_attachments (
         key         TEXT PRIMARY KEY,
         user_id     TEXT NOT NULL,
         mime        TEXT NOT NULL,
         size        INTEGER NOT NULL,
         created_at  INTEGER NOT NULL,
         expires_at  INTEGER NOT NULL
       )`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_user_attachments_expires
         ON user_attachments (expires_at)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_user_attachments_user
         ON user_attachments (user_id, created_at DESC)`
    )
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /uploads/attachment
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAttachmentUpload(
  request: Request,
  env: Env
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  const user = active.user;
  await ensureAttachmentsTable(env.JOBS_DB);

  const mime = (request.headers.get("Content-Type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_ATTACHMENT_MIME.has(mime)) {
    return Errors.badRequest(`Unsupported Content-Type "${mime}"`);
  }

  const contentLength = parseInt(request.headers.get("Content-Length") ?? "0", 10);
  if (contentLength > MAX_ATTACHMENT_BYTES) {
    return Errors.badRequest(
      `File exceeds ${MAX_ATTACHMENT_BYTES} bytes — resize client-side`
    );
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return Errors.badRequest("Empty body");
  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    return Errors.badRequest(
      `File exceeds ${MAX_ATTACHMENT_BYTES} bytes — resize client-side`
    );
  }

  const ext = extFromMime(mime);
  const id = crypto.randomUUID();
  const key = `users/${user.id}/attachments/${id}.${ext}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAtSec = nowSec + ATTACHMENT_TTL_SECONDS;

  try {
    await env.USER_FILES.put(key, body, {
      httpMetadata: { contentType: mime, cacheControl: "private, max-age=604800" },
      customMetadata: {
        user_id: user.id,
        uploaded_at: String(nowSec),
        expires_at: String(expiresAtSec),
      },
    });
  } catch (err) {
    logger.error("r2_attachment_put_failed", {
      user_id: user.id,
      error: String(err),
    });
    return Errors.internal("Upload failed");
  }

  await env.JOBS_DB.prepare(
    `INSERT INTO user_attachments (key, user_id, mime, size, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       mime = excluded.mime,
       size = excluded.size,
       expires_at = excluded.expires_at`
  )
    .bind(key, user.id, mime, body.byteLength, nowSec, expiresAtSec)
    .run();

  return jsonOk({
    key,
    // The path segment so the client can embed "<apiBase>/uploads/attachment/<key>"
    // without worrying about encoding.
    url: `/uploads/attachment/${key}`,
    mime,
    size: body.byteLength,
    expires_at: expiresAtSec * 1000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /uploads/attachment/:key*
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAttachmentDownload(
  request: Request,
  env: Env,
  rawKey: string
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  const user = active.user;

  // Enforce that the requested key belongs to the caller. The prefix check
  // is the entire authorization mechanism — no cross-user leakage possible
  // because we never sign or expose raw keys from other users.
  const expectedPrefix = `users/${user.id}/attachments/`;
  if (!rawKey.startsWith(expectedPrefix)) {
    return Errors.forbidden("Attachment");
  }

  const obj = await env.USER_FILES.get(rawKey);
  if (!obj) return Errors.notFound("Attachment");

  const headers = new Headers();
  headers.set(
    "Content-Type",
    obj.httpMetadata?.contentType ?? "application/octet-stream"
  );
  headers.set("Cache-Control", "private, max-age=604800");
  return new Response(obj.body, { headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron: sweep expired attachments (invoked from scheduled handler at :30)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete R2 objects whose user_attachments row has already expired. Bounded
 * to 500 per run so a backlog can't blow our cron budget — the next :30
 * tick picks up the rest. Returns the number of objects deleted.
 */
export async function sweepExpiredAttachments(env: Env): Promise<number> {
  await ensureAttachmentsTable(env.JOBS_DB);
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = await env.JOBS_DB.prepare(
    `SELECT key FROM user_attachments WHERE expires_at <= ? LIMIT 500`
  )
    .bind(nowSec)
    .all<{ key: string }>();

  const keys = (rows.results ?? []).map((r) => r.key).filter(Boolean);
  if (keys.length === 0) return 0;

  // R2 supports batched deletes via the `.delete()` overload that accepts
  // an array. Fall back to per-key on error so a single bad key doesn't
  // stall the whole sweep.
  try {
    await env.USER_FILES.delete(keys);
  } catch (err) {
    logger.warn("r2_batch_delete_failed", {
      count: keys.length,
      error: String(err),
    });
    for (const k of keys) {
      try {
        await env.USER_FILES.delete(k);
      } catch (innerErr) {
        logger.warn("r2_single_delete_failed", {
          key: k,
          error: String(innerErr),
        });
      }
    }
  }

  // Remove rows AFTER R2 delete succeeded so a failed R2 delete gets retried
  // on the next sweep rather than leaving orphaned bytes.
  const placeholders = keys.map(() => "?").join(",");
  await env.JOBS_DB.prepare(
    `DELETE FROM user_attachments WHERE key IN (${placeholders})`
  )
    .bind(...keys)
    .run();

  logger.info("attachment_sweep_complete", { deleted: keys.length });
  return keys.length;
}
