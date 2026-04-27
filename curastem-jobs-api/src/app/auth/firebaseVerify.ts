/**
 * Firebase ID token verification — no Admin SDK.
 *
 * Firebase ID tokens are RS256 JWTs signed by Google. We verify them against
 * the public keys published at the x509 URL below. The Admin SDK does this
 * too; we re-implement the small spec directly because the Admin SDK pulls
 * ~90MB of deps that don't fit in a Worker bundle.
 *
 * Spec reference:
 *   https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 *
 * Required checks (all enforced below):
 *   1. Header: alg=RS256, kid matches one of Google's current public keys.
 *   2. Signature: valid against the matching RSA public key.
 *   3. iat <= now, exp > now, auth_time <= now  (with a small skew).
 *   4. aud == FIREBASE_PROJECT_ID
 *   5. iss == https://securetoken.google.com/FIREBASE_PROJECT_ID
 *   6. sub is a non-empty string.
 *
 * JWKS caching: Google's x509 endpoint sets Cache-Control with max-age; we
 * honour that by storing the keyset in RATE_LIMIT_KV with a matching TTL so
 * every isolate-cold request doesn't refetch the cert bundle.
 */

import type { Env } from "../../shared/types.ts";

const JWKS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const JWKS_KV_KEY = "firebase:jwks:x509";
const CLOCK_SKEW_SECONDS = 60;

export interface FirebaseIdTokenClaims {
  /** Firebase user id (= google_sub for Google sign-ins). */
  sub: string;
  /** Issuer project id (equals FIREBASE_PROJECT_ID). */
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
    identities?: Record<string, unknown>;
  };
}

export class FirebaseVerifyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FirebaseVerifyError";
  }
}

/**
 * Verify a Firebase ID token. Throws FirebaseVerifyError on any failure.
 * Caller is responsible for mapping errors to HTTP 401.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  env: Env
): Promise<FirebaseIdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new FirebaseVerifyError("MALFORMED", "Token is not a JWT");
  }

  const [rawHeader, rawPayload, rawSig] = parts;
  const header = decodeJson(rawHeader);
  const payload = decodeJson(rawPayload) as unknown as FirebaseIdTokenClaims;

  if (header.alg !== "RS256") {
    throw new FirebaseVerifyError("BAD_ALG", `Unexpected alg ${header.alg}`);
  }
  if (typeof header.kid !== "string" || !header.kid) {
    throw new FirebaseVerifyError("MISSING_KID", "Missing kid");
  }

  // Claim checks first — cheap, no crypto.
  const now = Math.floor(Date.now() / 1000);
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new FirebaseVerifyError("CONFIG", "FIREBASE_PROJECT_ID not set");
  }

  if (payload.aud !== projectId) {
    throw new FirebaseVerifyError("BAD_AUD", "aud does not match project id");
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new FirebaseVerifyError("BAD_ISS", "iss does not match project id");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new FirebaseVerifyError("BAD_SUB", "sub missing or empty");
  }
  if (typeof payload.exp !== "number" || payload.exp <= now - CLOCK_SKEW_SECONDS) {
    throw new FirebaseVerifyError("EXPIRED", "Token is expired");
  }
  if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new FirebaseVerifyError("BAD_IAT", "Token iat in the future");
  }
  if (typeof payload.auth_time === "number" && payload.auth_time > now + CLOCK_SKEW_SECONDS) {
    throw new FirebaseVerifyError("BAD_AUTH_TIME", "auth_time in the future");
  }
  // For Google sign-in via the popup flow, email_verified is always true
  // because Google's OAuth already verified the user owns the address. We
  // enforce this explicitly so:
  //   1. A future email/password flow can't accidentally sign someone in
  //      with an unverified address (phishing risk: attacker signs up with
  //      victim's email, victim never verifies, attacker uses the account).
  //   2. A misconfigured Firebase provider that flips this bit gets caught
  //      here rather than shipping an insecure login silently.
  // If email is absent (edge case — provider didn't request email scope),
  // we allow the sign-in since there's no email to verify.
  if (typeof payload.email === "string" && payload.email_verified !== true) {
    throw new FirebaseVerifyError("EMAIL_UNVERIFIED", "Email not verified");
  }

  // Signature verification.
  const pem = await getPublicKeyPem(header.kid, env);
  const key = await importRsaPublicKey(pem);
  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signature = base64UrlDecode(rawSig);
  const ok = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signature,
    signingInput
  );
  if (!ok) {
    throw new FirebaseVerifyError("BAD_SIG", "Signature verification failed");
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// JWKS fetch + KV cache
// ─────────────────────────────────────────────────────────────────────────────

interface JwksCacheEntry {
  /** kid → PEM-encoded x509 certificate body */
  keys: Record<string, string>;
  /** Unix epoch seconds when this cache entry expires. */
  expires_at: number;
}

async function getPublicKeyPem(kid: string, env: Env): Promise<string> {
  const cached = await readJwksFromKV(env);
  if (cached && cached.keys[kid]) return cached.keys[kid];

  const fresh = await fetchJwks();
  // Fire-and-forget cache write; a miss just means the next request refetches.
  try {
    await env.RATE_LIMIT_KV.put(JWKS_KV_KEY, JSON.stringify(fresh), {
      // KV TTL must be >= 60s. Google returns ~1–6h cache windows.
      expirationTtl: Math.max(60, fresh.expires_at - Math.floor(Date.now() / 1000)),
    });
  } catch {
    // best effort
  }

  const pem = fresh.keys[kid];
  if (!pem) {
    throw new FirebaseVerifyError("UNKNOWN_KID", `kid ${kid} not in JWKS`);
  }
  return pem;
}

async function readJwksFromKV(env: Env): Promise<JwksCacheEntry | null> {
  const raw = await env.RATE_LIMIT_KV.get(JWKS_KV_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JwksCacheEntry;
    if (parsed.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchJwks(): Promise<JwksCacheEntry> {
  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 600 } });
  if (!res.ok) {
    throw new FirebaseVerifyError("JWKS_FETCH_FAILED", `status ${res.status}`);
  }
  const certs = (await res.json()) as Record<string, string>;
  // Honour the Cache-Control max-age so we don't hammer Google.
  const cc = res.headers.get("Cache-Control") ?? "";
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  return {
    keys: certs,
    expires_at: Math.floor(Date.now() / 1000) + maxAge,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Google's JWKS returns x509 certificates in PEM form, not raw SPKI keys.
 * WebCrypto can't import x509 directly, so we extract the DER between the
 * PEM markers and import as "spki" after stripping the cert wrapper.
 *
 * Workers runtime supports importing SPKI RSA keys; the spki bytes are the
 * SubjectPublicKeyInfo inside the cert. We use a tiny ASN.1 scan to find it.
 */
async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  const spki = extractSpkiFromCertificate(der);
  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Walk an X.509 Certificate DER and return the SubjectPublicKeyInfo bytes.
 *
 * X.509 layout:
 *   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
 *   TBSCertificate ::= SEQUENCE {
 *     [0] version, serialNumber, signature, issuer, validity, subject,
 *     subjectPublicKeyInfo, ...
 *   }
 *
 * We parse SEQUENCE headers until we reach `subjectPublicKeyInfo`, which is
 * itself a SEQUENCE — its full TLV is what WebCrypto wants as "spki".
 */
function extractSpkiFromCertificate(der: Uint8Array): ArrayBuffer {
  const cert = readSequence(der, 0);
  const tbs = readSequence(der, cert.contentStart);

  let off = tbs.contentStart;
  // [0] EXPLICIT version (optional, tag 0xA0)
  if (der[off] === 0xa0) off = skipTlv(der, off);
  off = skipTlv(der, off); // serialNumber
  off = skipTlv(der, off); // signature algo
  off = skipTlv(der, off); // issuer
  off = skipTlv(der, off); // validity
  off = skipTlv(der, off); // subject

  const spki = readSequence(der, off);
  const slice = der.subarray(off, spki.end);
  const ab = new ArrayBuffer(slice.byteLength);
  new Uint8Array(ab).set(slice);
  return ab;
}

interface TlvBounds {
  contentStart: number;
  end: number;
}

function readSequence(der: Uint8Array, offset: number): TlvBounds {
  if (der[offset] !== 0x30) {
    throw new FirebaseVerifyError("BAD_CERT", "Expected SEQUENCE");
  }
  return readTlv(der, offset);
}

function skipTlv(der: Uint8Array, offset: number): number {
  return readTlv(der, offset).end;
}

function readTlv(der: Uint8Array, offset: number): TlvBounds {
  const lenByte = der[offset + 1];
  let contentStart: number;
  let length: number;
  if (lenByte < 0x80) {
    contentStart = offset + 2;
    length = lenByte;
  } else {
    const n = lenByte & 0x7f;
    contentStart = offset + 2 + n;
    length = 0;
    for (let i = 0; i < n; i++) length = (length << 8) | der[offset + 2 + i];
  }
  return { contentStart, end: contentStart + length };
}

function base64UrlDecode(input: string): ArrayBuffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    "="
  );
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  // Copy into a fresh ArrayBuffer so the return type is not SharedArrayBuffer.
  const ab = new ArrayBuffer(out.length);
  new Uint8Array(ab).set(out);
  return ab;
}

function decodeJson(segment: string): Record<string, unknown> & { alg?: string; kid?: string } {
  const bytes = new Uint8Array(base64UrlDecode(segment));
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}
