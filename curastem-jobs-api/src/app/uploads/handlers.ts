/**
 * Resume uploads via R2.
 *
 *   PUT    /uploads/resume          Body: raw file bytes. Headers: Content-Type, X-Filename.
 *                                   Stores in R2 under `users/{user_id}/resume/{uuid}-{filename}`,
 *                                   updates the profile row, returns { key, name, mime, size }.
 *   GET    /uploads/resume          Streams the current resume file back to the caller.
 *   DELETE /uploads/resume          Removes the R2 object and clears the profile resume_file_*.
 *
 * Why proxy through the Worker instead of presigned URLs:
 *   - Resume files are ≤ 10MB. A single Worker request trivially handles that.
 *   - We never need to hand R2 credentials (or even an S3 endpoint) to the
 *     client — the Worker is the only thing with write access.
 *   - Ownership enforcement is implicit: the key includes user_id and the
 *     session identifies the caller; there's no surface for IDOR.
 *
 * Accepted MIME types: PDF, common Office formats, plain text, Markdown.
 * Anything else is rejected so we don't accept arbitrary binary blobs.
 */

import type { Env } from "../../shared/types.ts";
import { readSession } from "../auth/session.ts";
import { processResumeForUser } from "../resume/process.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { logger } from "../../shared/utils/logger.ts";

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
  "text/markdown",
]);
const DIRTY_FLAG_TTL_SECONDS = 5 * 60;

async function markUserDirty(kv: KVNamespace, userId: string): Promise<void> {
  try {
    await kv.put(`sync_dirty:${userId}`, String(Date.now()), {
      expirationTtl: DIRTY_FLAG_TTL_SECONDS,
    });
  } catch {
    // Best-effort. Polling still reconciles if KV is temporarily unavailable.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /uploads/resume
// ─────────────────────────────────────────────────────────────────────────────

export async function handleResumeUpload(
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  const user = active.user;

  const mime = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return Errors.badRequest(`Unsupported Content-Type "${mime}"`);
  }
  const name = (request.headers.get("X-Filename") ?? "resume").slice(0, 200);
  // Strip path separators — keys stay flat under users/{id}/resume/
  const safeName = name.replace(/[\\/]/g, "_");

  const contentLength = parseInt(request.headers.get("Content-Length") ?? "0", 10);
  if (contentLength > MAX_RESUME_BYTES) {
    return Errors.badRequest(`File exceeds ${MAX_RESUME_BYTES} bytes`);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return Errors.badRequest("Empty body");
  if (body.byteLength > MAX_RESUME_BYTES) {
    return Errors.badRequest(`File exceeds ${MAX_RESUME_BYTES} bytes`);
  }

  const key = `users/${user.id}/resume/${crypto.randomUUID()}-${safeName}`;
  try {
    await env.USER_FILES.put(key, body, {
      httpMetadata: { contentType: mime, contentDisposition: `attachment; filename="${safeName}"` },
      customMetadata: { user_id: user.id, uploaded_at: String(Math.floor(Date.now() / 1000)) },
    });
  } catch (err) {
    logger.error("r2_put_failed", { user_id: user.id, error: String(err) });
    return Errors.internal("Upload failed");
  }

  // Read existing profile to clean up any prior key (single resume per user).
  const prior = await env.JOBS_DB.prepare(
    `SELECT resume_file_r2_key FROM profile WHERE user_id = ?`
  )
    .bind(user.id)
    .first<{ resume_file_r2_key: string | null }>();

  await env.JOBS_DB.prepare(
    `INSERT INTO profile (user_id, resume_file_r2_key, resume_file_name, resume_file_mime, resume_file_size, resume_plain, resume_doc_html, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       resume_file_r2_key = excluded.resume_file_r2_key,
       resume_file_name = excluded.resume_file_name,
       resume_file_mime = excluded.resume_file_mime,
       resume_file_size = excluded.resume_file_size,
       resume_plain = NULL,
       resume_doc_html = NULL,
       updated_at = excluded.updated_at`
  )
    .bind(user.id, key, safeName, mime, body.byteLength, Math.floor(Date.now() / 1000))
    .run();

  if (prior?.resume_file_r2_key && prior.resume_file_r2_key !== key) {
    try {
      await env.USER_FILES.delete(prior.resume_file_r2_key);
    } catch (err) {
      logger.warn("r2_delete_prior_failed", { key: prior.resume_file_r2_key, error: String(err) });
    }
  }

  await markUserDirty(env.RATE_LIMIT_KV, user.id);
  ctx?.waitUntil(
    processResumeForUser(env, user.id, key).catch((err) => {
      logger.error("resume_background_process_failed", {
        user_id: user.id,
        error: String(err),
      });
    })
  );

  return jsonOk({ key, name: safeName, mime, size: body.byteLength, processing: "queued" });
}

export async function handleResumeProcess(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  const result = await processResumeForUser(env, active.user.id);
  return jsonOk(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /uploads/resume
// ─────────────────────────────────────────────────────────────────────────────

export async function handleResumeDownload(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  const user = active.user;

  const row = await env.JOBS_DB.prepare(
    `SELECT resume_file_r2_key, resume_file_name, resume_file_mime
       FROM profile WHERE user_id = ?`
  )
    .bind(user.id)
    .first<{ resume_file_r2_key: string | null; resume_file_name: string | null; resume_file_mime: string | null }>();

  if (!row?.resume_file_r2_key) return Errors.notFound("Resume");

  const obj = await env.USER_FILES.get(row.resume_file_r2_key);
  if (!obj) return Errors.notFound("Resume");

  const headers = new Headers();
  headers.set("Content-Type", row.resume_file_mime ?? "application/octet-stream");
  if (row.resume_file_name) {
    headers.set("Content-Disposition", `attachment; filename="${row.resume_file_name}"`);
  }
  headers.set("Cache-Control", "private, no-store");
  return new Response(obj.body, { headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /uploads/resume
// ─────────────────────────────────────────────────────────────────────────────

export async function handleResumeDelete(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  const user = active.user;

  const row = await env.JOBS_DB.prepare(
    `SELECT resume_file_r2_key FROM profile WHERE user_id = ?`
  )
    .bind(user.id)
    .first<{ resume_file_r2_key: string | null }>();

  if (row?.resume_file_r2_key) {
    try {
      await env.USER_FILES.delete(row.resume_file_r2_key);
    } catch (err) {
      logger.warn("r2_delete_failed", { key: row.resume_file_r2_key, error: String(err) });
    }
  }

  await env.JOBS_DB.prepare(
    `UPDATE profile SET resume_plain = NULL, resume_doc_html = NULL,
                        resume_file_r2_key = NULL, resume_file_name = NULL,
                        resume_file_mime = NULL, resume_file_size = NULL, updated_at = ?
       WHERE user_id = ?`
  )
    .bind(Math.floor(Date.now() / 1000), user.id)
    .run();

  await markUserDirty(env.RATE_LIMIT_KV, user.id);

  return jsonOk({ status: "deleted" });
}
