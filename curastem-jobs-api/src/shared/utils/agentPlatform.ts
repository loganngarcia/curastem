import type { Env } from "../types.ts";

// Google Cloud rebranded Vertex AI generative model access as Agent Platform.
// We use this GCP-billed path because Google Cloud trial/promotional credits
// apply here, while the standalone Gemini Developer API key path may bill
// outside those credits.
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_AGENT_PLATFORM_LOCATION = "global";
const DEFAULT_AGENT_PLATFORM_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_AGENT_PLATFORM_EMBEDDING_LOCATION = "global";
const DEFAULT_AGENT_PLATFORM_LIVE_LOCATION = "us-central1";
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

interface ServiceAccountCredentials {
  client_email?: string;
  private_key?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtSeconds: number;
  clientEmail: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface AgentPlatformRequestOptions {
  model: string;
  action: "generateContent" | "streamGenerateContent" | "countTokens";
  body: unknown;
  alt?: string;
}

interface GeminiContentLike {
  role?: string;
  parts?: unknown;
}

let cachedToken: CachedToken | null = null;

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getServiceAccountCredentials(env: Env): ServiceAccountCredentials {
  const raw = env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured");
  try {
    return JSON.parse(raw) as ServiceAccountCredentials;
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON");
  }
}

async function signJwt(privateKeyPem: string, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function getAgentPlatformProject(env: Env): string {
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not configured");
  return project;
}

export function getAgentPlatformLocation(env: Env): string {
  return env.GOOGLE_CLOUD_LOCATION?.trim() || DEFAULT_AGENT_PLATFORM_LOCATION;
}

export function getAgentPlatformEmbeddingLocation(env: Env): string {
  return env.GOOGLE_CLOUD_EMBEDDING_LOCATION?.trim() || getAgentPlatformLocation(env) || DEFAULT_AGENT_PLATFORM_EMBEDDING_LOCATION;
}

export function getAgentPlatformEmbeddingModel(env: Env): string {
  return env.GOOGLE_CLOUD_EMBEDDING_MODEL?.trim() || DEFAULT_AGENT_PLATFORM_EMBEDDING_MODEL;
}

export function getAgentPlatformLiveLocation(env: Env): string {
  return env.GOOGLE_CLOUD_LIVE_LOCATION?.trim() || DEFAULT_AGENT_PLATFORM_LIVE_LOCATION;
}

export function getAgentPlatformLiveModel(env: Env): string {
  return env.GOOGLE_CLOUD_LIVE_MODEL?.trim() || "gemini-live-2.5-flash-native-audio";
}

export function agentPlatformHost(location: string): string {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

export function agentPlatformModelName(env: Env, model: string, location = getAgentPlatformLocation(env)): string {
  const normalizedModel = model.replace(/^models\//, "");
  return `projects/${getAgentPlatformProject(env)}/locations/${location}/publishers/google/models/${normalizedModel}`;
}

export async function getAgentPlatformAccessToken(env: Env): Promise<string> {
  const credentials = getServiceAccountCredentials(env);
  const clientEmail = credentials.client_email;
  const privateKey = credentials.private_key;
  if (!clientEmail || !privateKey) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is missing client_email or private_key");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    cachedToken &&
    cachedToken.clientEmail === clientEmail &&
    cachedToken.expiresAtSeconds - TOKEN_EXPIRY_SKEW_SECONDS > nowSeconds
  ) {
    return cachedToken.accessToken;
  }

  const jwt = await signJwt(privateKey, {
    iss: clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = (await resp.json().catch(() => null)) as TokenResponse | null;
  if (!resp.ok || !data?.access_token) {
    throw new Error(
      `Agent Platform token exchange failed ${resp.status}: ${data?.error_description ?? data?.error ?? "unknown_error"}`
    );
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAtSeconds: nowSeconds + (data.expires_in ?? 3600),
    clientEmail,
  };
  return cachedToken.accessToken;
}

export async function fetchAgentPlatform(
  env: Env,
  { model, action, body, alt }: AgentPlatformRequestOptions
): Promise<Response> {
  const location = getAgentPlatformLocation(env);
  const endpoint = new URL(
    `https://${agentPlatformHost(location)}/v1/${agentPlatformModelName(env, model, location)}:${action}`
  );
  if (alt) endpoint.searchParams.set("alt", alt);
  const accessToken = await getAgentPlatformAccessToken(env);
  return fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(normalizeGenerateContentBody(body)),
  });
}

function normalizeGenerateContentBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.contents)) return body;
  return {
    ...record,
    contents: record.contents.map((content) => {
      if (!content || typeof content !== "object" || Array.isArray(content)) return content;
      const item = content as GeminiContentLike;
      return item.role ? item : { ...item, role: "user" };
    }),
  };
}

