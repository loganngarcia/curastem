/**
 * User authentication routes.
 *
 *   POST   /auth/firebase   Exchange a Firebase ID token for a Curastem session.
 *                           Body: { id_token: string }
 *                           Response: { user, token, expires_at }
 *                           Side effect: upserts users row, issues session cookie.
 *   POST   /auth/logout     Revoke the caller's session and clear the cookie.
 *   GET    /auth/me         Return the signed-in user, or 401.
 *   DELETE /auth/me         Delete the user and every row that references them.
 *                           Cascades via FK ON DELETE CASCADE to profile, chats,
 *                           docs, apps, sessions. R2 resume files are removed
 *                           best-effort before the DB delete.
 *
 * CORS: these routes live in an explicit allow-list in index.ts so the
 * session cookie can be set cross-origin (SameSite=None; Secure).
 */

import type { Env, UserRow } from "../../shared/types.ts";
import { verifyFirebaseIdToken, FirebaseVerifyError } from "./firebaseVerify.ts";
import {
  mintSession,
  readSession,
  revokeSessionByToken,
  extractToken,
  buildSessionCookie,
  buildClearSessionCookie,
} from "./session.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { logger } from "../../shared/utils/logger.ts";
import { ensureUserDataTables } from "../../shared/db/queries.ts";

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/firebase
// ─────────────────────────────────────────────────────────────────────────────

export async function handleFirebaseSignIn(request: Request, env: Env): Promise<Response> {
  // First-boot guard: provision user-data tables on the first sign-in of a
  // fresh D1 so `schema.sql` isn't a prerequisite for running the Worker.
  await ensureUserDataTables(env.JOBS_DB);
  let body: { id_token?: unknown };
  try {
    body = (await request.json()) as { id_token?: unknown };
  } catch {
    return Errors.badRequest("Request body must be JSON");
  }

  const idToken = typeof body.id_token === "string" ? body.id_token : null;
  if (!idToken) return Errors.badRequest("id_token is required");

  let claims;
  try {
    claims = await verifyFirebaseIdToken(idToken, env);
  } catch (err) {
    if (err instanceof FirebaseVerifyError) {
      logger.warn("firebase_verify_failed", { code: err.code });
      return Errors.unauthorized(`Invalid Firebase token: ${err.code}`);
    }
    logger.error("firebase_verify_error", { error: String(err) });
    return Errors.unauthorized("Invalid Firebase token");
  }

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (!email) return Errors.unauthorized("Token missing email");
  if (claims.email_verified === false) {
    return Errors.unauthorized("Email not verified");
  }

  const user = await upsertUser(env, {
    googleSub: claims.sub,
    email,
    firebaseUid: claims.sub,
    displayName: typeof claims.name === "string" ? claims.name : null,
    photoUrl: typeof claims.picture === "string" ? claims.picture : null,
  });

  const ua = request.headers.get("User-Agent");
  const session = await mintSession(env, user.id, ua);

  const resp = jsonOk({
    user: publicUser(user),
    token: session.token,
    expires_at: session.expiresAt,
  });
  resp.headers.append("Set-Cookie", buildSessionCookie(session.token, session.expiresAt));
  return resp;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────────────────────────

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (token) {
    try {
      await revokeSessionByToken(env, token);
    } catch (err) {
      logger.warn("logout_revoke_failed", { error: String(err) });
    }
  }
  const resp = jsonOk({ status: "ok" });
  resp.headers.append("Set-Cookie", buildClearSessionCookie());
  return resp;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetMe(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");
  return jsonOk({ user: publicUser(active.user) });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /auth/me  — schedules deletion in 3 days (grace period)
// ─────────────────────────────────────────────────────────────────────────────

const DELETE_GRACE_SECONDS = 3 * 24 * 60 * 60; // 3 days

export async function handleDeleteMe(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const userId = active.user.id;
  const scheduledAt = Math.floor(Date.now() / 1000) + DELETE_GRACE_SECONDS;

  // Mark for deletion rather than hard-delete so the user can recover by
  // signing in again within the grace window. The hourly cron sweeps rows
  // whose scheduled_delete_at has passed and performs the actual removal.
  await env.JOBS_DB.prepare(
    `UPDATE users SET scheduled_delete_at = ? WHERE id = ?`
  )
    .bind(scheduledAt, userId)
    .run();

  logger.info("account_deletion_scheduled", { uid: userId, scheduled_at: scheduledAt });

  // Revoke session so the user is signed out immediately.
  const resp = jsonOk({ status: "deletion_scheduled", deletes_at: scheduledAt });
  resp.headers.append("Set-Cookie", buildClearSessionCookie());
  return resp;
}

// ─────────────────────────────────────────────────────────────────────────────
// User upsert
// ─────────────────────────────────────────────────────────────────────────────

interface UpsertInput {
  googleSub: string;
  email: string;
  firebaseUid: string | null;
  displayName: string | null;
  photoUrl: string | null;
}

/**
 * Find-or-create a user by google_sub. On return, `last_login_at` is fresh
 * and display_name / photo_url have been refreshed from the token so changes
 * in the user's Google profile (e.g. new avatar) flow through.
 *
 * Email is treated as a stable attribute of google_sub; if Google returns a
 * different email for the same sub we trust it (it means the user changed
 * their primary Gmail). The UNIQUE constraint on email catches the rare
 * collision case, in which we fall back to updating by google_sub only.
 */
async function upsertUser(env: Env, input: UpsertInput): Promise<UserRow> {
  const now = Math.floor(Date.now() / 1000);

  const existing = await env.JOBS_DB.prepare(
    `SELECT * FROM users WHERE google_sub = ?`
  )
    .bind(input.googleSub)
    .first<UserRow>();

  if (existing) {
    // Also clears scheduled_delete_at — signing in within the grace window
    // counts as "I changed my mind" and cancels the pending deletion.
    await env.JOBS_DB.prepare(
      `UPDATE users
          SET email = ?, firebase_uid = COALESCE(?, firebase_uid),
              display_name = ?, photo_url = ?, last_login_at = ?,
              scheduled_delete_at = NULL
        WHERE id = ?`
    )
      .bind(
        input.email,
        input.firebaseUid,
        input.displayName,
        input.photoUrl,
        now,
        existing.id
      )
      .run();
    if (existing.scheduled_delete_at) {
      logger.info("account_deletion_cancelled", { uid: existing.id });
    }
    return {
      ...existing,
      email: input.email,
      firebase_uid: input.firebaseUid ?? existing.firebase_uid,
      display_name: input.displayName,
      photo_url: input.photoUrl,
      last_login_at: now,
      scheduled_delete_at: null,
    };
  }

  const id = crypto.randomUUID();
  await env.JOBS_DB.prepare(
    `INSERT INTO users (id, email, google_sub, firebase_uid, display_name, photo_url, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.email,
      input.googleSub,
      input.firebaseUid,
      input.displayName,
      input.photoUrl,
      now,
      now
    )
    .run();

  return {
    id,
    email: input.email,
    google_sub: input.googleSub,
    firebase_uid: input.firebaseUid,
    display_name: input.displayName,
    photo_url: input.photoUrl,
    created_at: now,
    last_login_at: now,
    scheduled_delete_at: null,
    email_job_alerts: 1,
    email_local_events: 1,
    email_announcements: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public shape (what /auth/me returns)
// ─────────────────────────────────────────────────────────────────────────────

function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    photo_url: u.photo_url,
    created_at: u.created_at,
    email_prefs: {
      job_alerts:    (u.email_job_alerts    ?? 1) === 1,
      local_events:  (u.email_local_events  ?? 1) === 1,
      announcements: (u.email_announcements ?? 1) === 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /auth/me/prefs  — update email notification preferences
// ─────────────────────────────────────────────────────────────────────────────

export async function handlePatchPrefs(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Errors.badRequest("Invalid JSON");
  }

  const allowed = ["job_alerts", "local_events", "announcements"] as const;
  const updates: string[] = [];
  const values: (number | string)[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`email_${key} = ?`);
      values.push(body[key] ? 1 : 0);
    }
  }

  if (updates.length === 0) return Errors.badRequest("No valid fields");

  values.push(active.user.id);
  await env.JOBS_DB.prepare(
    `UPDATE users SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...values).run();

  // Re-fetch to return fresh state
  const updated = await env.JOBS_DB.prepare(
    `SELECT * FROM users WHERE id = ?`
  ).bind(active.user.id).first<UserRow>();

  return jsonOk({ email_prefs: publicUser(updated!).email_prefs });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/pending  — device-flow handshake (relay → KV)
// GET  /auth/pending?state=  — poll / claim (main app ← KV)
//
// Used when the relay page opens in a different browser process (e.g. Framer
// canvas on Electron). postMessage can't cross processes, so after sign-in the
// relay stores the {token, user} in KV keyed by a one-time state UUID. The
// main app polls until it finds the entry, then claims+deletes it atomically.
// TTL is 5 minutes — ample for any real sign-in flow.
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_TTL_SECONDS = 300;
const PENDING_KEY_PREFIX = "pending_auth:";

export async function handleStorePending(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return Errors.badRequest("Invalid JSON"); }

  const { state, token, user } = body;
  if (!state || !token || !user) return Errors.badRequest("Missing fields");
  if (typeof state !== "string" || state.length > 128) return Errors.badRequest("Invalid state");

  await env.RATE_LIMIT_KV.put(
    PENDING_KEY_PREFIX + state,
    JSON.stringify({ token, user }),
    { expirationTtl: PENDING_TTL_SECONDS }
  );
  return jsonOk({ ok: true });
}

export async function handleClaimPending(request: Request, env: Env): Promise<Response> {
  const state = new URL(request.url).searchParams.get("state");
  if (!state || state.length > 128) return Errors.badRequest("Invalid state");

  const key = PENDING_KEY_PREFIX + state;
  const raw = await env.RATE_LIMIT_KV.get(key);
  if (!raw) {
    return new Response(JSON.stringify({ pending: true }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Claim-and-delete: subsequent polls return 404
  await env.RATE_LIMIT_KV.delete(key);
  return jsonOk(JSON.parse(raw) as Record<string, unknown>);
}
