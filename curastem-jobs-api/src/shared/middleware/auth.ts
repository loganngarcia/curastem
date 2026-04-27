/**
 * API key authentication middleware.
 *
 * Every request must include:
 *   Authorization: Bearer <api_key>
 *
 * The raw key is never stored. We compute its SHA-256 hex digest and look that
 * up in the api_keys table. This means a compromised database does not expose
 * real keys — the hash is useless without the plaintext prefix.
 *
 * Key issuance is manual for now. Developers request access at:
 *   developers@curastem.org
 */

import { getApiKeyByHash, touchApiKeyLastUsed } from "../db/queries.ts";
import type { ApiKeyRow } from "../types.ts";
import { Errors } from "../utils/errors.ts";

/**
 * Extract the Bearer token from the Authorization header.
 * Returns null if the header is missing or malformed.
 */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Compute the SHA-256 hex digest of a string using the Web Crypto API.
 * Available in all Cloudflare Workers runtimes without additional imports.
 */
async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AuthResult {
  ok: true;
  key: ApiKeyRow;
}

export interface AuthFailure {
  ok: false;
  response: Response;
}

/**
 * Authenticate the incoming request.
 *
 * On success: returns { ok: true, key } where key contains the validated API key row.
 * On failure: returns { ok: false, response } where response is a 401 error ready to return.
 *
 * The caller decides whether to run `touchApiKeyLastUsed` after the request
 * completes — we pass the key row back so this can happen without a second lookup.
 */
export async function authenticate(
  request: Request,
  db: D1Database
): Promise<AuthResult | AuthFailure> {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, response: Errors.unauthorized() };
  }

  const hash = await sha256Hex(token);
  const key = await getApiKeyByHash(db, hash);

  if (!key) {
    return { ok: false, response: Errors.unauthorized() };
  }

  return { ok: true, key };
}

/**
 * Record that this API key was just used.
 * Fire-and-forget — we don't await this in the hot path so it doesn't add latency.
 */
export function recordKeyUsage(db: D1Database, keyId: string, ctx: ExecutionContext): void {
  const now = Math.floor(Date.now() / 1000);
  ctx.waitUntil(touchApiKeyLastUsed(db, keyId, now));
}
