/**
 * Opaque server-side sessions.
 *
 * The client holds a random 32-byte token (base64url, 43 chars). The server
 * stores HMAC-SHA256(SESSION_SIGNING_KEY, token) as the primary key in the
 * `sessions` table. A raw DB leak therefore cannot be replayed — attackers
 * would need the signing key too.
 *
 * Transport:
 *   - Primary: `curastem_session` cookie, HttpOnly + Secure + SameSite=None,
 *     Domain=.curastem.org. Used by first-party web and blog-writer-ui.
 *   - Fallback: Authorization: Bearer <token>. Used by Framer preview hosts
 *     (*.framer.website / *.framer.app / *.framer.ai) where the apex-domain cookie isn't
 *     set. The Framer client keeps the token in localStorage and attaches it
 *     on every request.
 *
 * Cookie scope: SameSite=None requires Secure, and is needed because the
 * Worker (api.curastem.org) is cross-site relative to the app origin.
 *
 * Lifetime: 90 days sliding (Slack/Notion/Linear pattern).
 *   - `last_seen_at` is refreshed on each auth hit (rate-limited to once per
 *     minute to avoid D1 write amplification).
 *   - `expires_at` is extended by (TTL - now) on each auth hit once we're
 *     past the halfway point of the current window. This gives active users
 *     an effectively infinite session without doing a DB write on every
 *     request.
 *   - Expired rows are swept opportunistically in readSession.
 *
 * A user who goes inactive for 90 days is signed out silently (no UX
 * change). A user who opens the app once every ~44 days stays signed in
 * forever. The upper bound is intentional: an abandoned laptop shouldn't
 * grant indefinite access to whoever finds it.
 */

import type { Env, SessionRow, UserRow } from "../../shared/types.ts";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
// Threshold past which we extend expires_at. Re-issuing on every request
// is wasteful; re-issuing at the halfway point keeps the sliding window
// effectively alive for any active user.
const SESSION_RENEW_THRESHOLD = 60 * 60 * 24 * 45; // 45 days
const COOKIE_NAME = "curastem_session";
const COOKIE_DOMAIN = ".curastem.org";

export interface MintedSession {
  /** Raw token to hand to the client (cookie value / Bearer token). */
  token: string;
  expiresAt: number;
}

export interface ActiveSession {
  user: UserRow;
  session: SessionRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mint
// ─────────────────────────────────────────────────────────────────────────────

export async function mintSession(
  env: Env,
  userId: string,
  userAgent: string | null
): Promise<MintedSession> {
  const rawBytes = new Uint8Array(32);
  crypto.getRandomValues(rawBytes);
  const token = base64UrlEncode(rawBytes);
  const tokenHash = await hmacHex(env.SESSION_SIGNING_KEY, token);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;

  await env.JOBS_DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(tokenHash, userId, now, expiresAt, now, userAgent)
    .run();

  return { token, expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up the caller's session from cookie or Authorization header.
 * Returns null when no/invalid/expired session. Refreshes last_seen_at.
 */
export async function readSession(
  request: Request,
  env: Env
): Promise<ActiveSession | null> {
  const token = extractToken(request);
  if (!token) return null;

  const tokenHash = await hmacHex(env.SESSION_SIGNING_KEY, token);
  const now = Math.floor(Date.now() / 1000);

  const row = await env.JOBS_DB.prepare(
    `SELECT s.token_hash, s.user_id, s.created_at, s.expires_at, s.last_seen_at, s.user_agent,
            u.id AS u_id, u.email AS u_email, u.google_sub AS u_google_sub,
            u.firebase_uid AS u_firebase_uid, u.display_name AS u_display_name,
            u.photo_url AS u_photo_url, u.created_at AS u_created_at,
            u.last_login_at AS u_last_login_at,
            u.scheduled_delete_at AS u_scheduled_delete_at,
            u.email_job_alerts AS u_email_job_alerts,
            u.email_local_events AS u_email_local_events,
            u.email_announcements AS u_email_announcements
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first<SessionJoinRow>();

  if (!row) return null;
  if (row.expires_at <= now) {
    // opportunistic sweep
    await env.JOBS_DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
    return null;
  }

  // Refresh last_seen_at at most once per minute to avoid write amplification.
  // If we're past the renewal threshold, also slide expires_at forward so
  // active users never see an unexpected logout.
  const needsLastSeenRefresh = now - row.last_seen_at > 60;
  const remaining = row.expires_at - now;
  const needsRenewal = remaining < SESSION_RENEW_THRESHOLD;
  if (needsLastSeenRefresh || needsRenewal) {
    const newExpiresAt = needsRenewal ? now + SESSION_TTL_SECONDS : row.expires_at;
    await env.JOBS_DB.prepare(
      `UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`
    )
      .bind(now, newExpiresAt, tokenHash)
      .run();
    row.last_seen_at = now;
    row.expires_at = newExpiresAt;
  }

  return {
    user: {
      id: row.u_id,
      email: row.u_email,
      google_sub: row.u_google_sub,
      firebase_uid: row.u_firebase_uid,
      display_name: row.u_display_name,
      photo_url: row.u_photo_url,
      created_at: row.u_created_at,
      last_login_at: row.u_last_login_at,
      scheduled_delete_at: row.u_scheduled_delete_at,
      email_job_alerts: row.u_email_job_alerts,
      email_local_events: row.u_email_local_events,
      email_announcements: row.u_email_announcements,
    },
    session: {
      token_hash: row.token_hash,
      user_id: row.user_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      last_seen_at: row.last_seen_at,
      user_agent: row.user_agent,
    },
  };
}

interface SessionJoinRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  user_agent: string | null;
  u_id: string;
  u_email: string;
  u_google_sub: string;
  u_firebase_uid: string | null;
  u_display_name: string | null;
  u_photo_url: string | null;
  u_created_at: number;
  u_last_login_at: number;
  u_scheduled_delete_at: number | null;
  u_email_job_alerts: number;
  u_email_local_events: number;
  u_email_announcements: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Revoke
// ─────────────────────────────────────────────────────────────────────────────

export async function revokeSessionByToken(env: Env, token: string): Promise<void> {
  const tokenHash = await hmacHex(env.SESSION_SIGNING_KEY, token);
  await env.JOBS_DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(tokenHash)
    .run();
}

export async function revokeAllSessionsForUser(env: Env, userId: string): Promise<void> {
  await env.JOBS_DB.prepare(`DELETE FROM sessions WHERE user_id = ?`)
    .bind(userId)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie + header helpers
// ─────────────────────────────────────────────────────────────────────────────

export function extractToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Build the Set-Cookie header for the session cookie. */
export function buildSessionCookie(token: string, expiresAt: number): string {
  const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Domain=${COOKIE_DOMAIN}`,
    `Path=/`,
    `Max-Age=${maxAge}`,
    `Secure`,
    `HttpOnly`,
    `SameSite=None`,
  ].join("; ");
}

/** Cookie header value that clears the session cookie. */
export function buildClearSessionCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    `Domain=${COOKIE_DOMAIN}`,
    `Path=/`,
    `Max-Age=0`,
    `Secure`,
    `HttpOnly`,
    `SameSite=None`,
  ].join("; ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers
// ─────────────────────────────────────────────────────────────────────────────

async function hmacHex(signingKey: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bufToHex(sig);
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
