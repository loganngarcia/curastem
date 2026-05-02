import type { ApiKeyRow, Env, PublicUsageLedgerRow } from "../types.ts";
import {
  debitDeveloperBalance,
  getDeveloperAccount,
  insertPublicUsageLedger,
} from "../db/queries.ts";
import { Errors } from "./errors.ts";

export const USD_MICROS = 1_000_000;
export const PUBLIC_SERVICE_MULTIPLIER = 5;

export interface TokenUsage {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  raw_cost_usd_micros: number;
  charged_usd_micros: number;
}

export interface MeteredPrincipal {
  key: ApiKeyRow;
  account_id: string;
  request_id: string;
}

export function usdToMicros(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * USD_MICROS);
}

export function microsToUsd(micros: number): number {
  return Math.round((micros / USD_MICROS) * 1_000_000) / 1_000_000;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateApiKey(): { raw: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const raw = `cstk_live_${body}`;
  return { raw, prefix: raw.slice(0, 18) };
}

export function requireAdmin(request: Request, env: Env): Response | null {
  const configured = env.ADMIN_API_SECRET?.trim();
  if (!configured || configured.length < 24) {
    return Errors.internal("ADMIN_API_SECRET is not configured");
  }
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== configured) return Errors.forbidden("Admin authorization required");
  return null;
}

export function requestId(request: Request): string {
  const fromHeader = request.headers.get("Idempotency-Key") || request.headers.get("X-Request-ID");
  if (fromHeader && /^[a-zA-Z0-9._:-]{8,120}$/.test(fromHeader)) return fromHeader;
  return crypto.randomUUID();
}

export async function requireMeteredPrincipal(
  request: Request,
  key: ApiKeyRow
): Promise<MeteredPrincipal | Response> {
  if (!key.account_id) return Errors.forbidden("API key is not linked to a developer account");
  return {
    key,
    account_id: key.account_id,
    request_id: requestId(request),
  };
}

function pricePerMillion(envValue: string | undefined, fallbackUsd: number): number {
  const n = Number(envValue);
  return Number.isFinite(n) && n >= 0 ? n : fallbackUsd;
}

export function estimateTokenUsageCost(
  env: Env,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
): TokenUsage {
  const input = Math.max(0, Math.floor(usage.input_tokens ?? 0));
  const output = Math.max(0, Math.floor(usage.output_tokens ?? 0));
  const total = Math.max(input + output, Math.floor(usage.total_tokens ?? 0));
  // Defaults are intentionally conservative and can be overridden by env vars
  // when provider pricing changes.
  const inputUsdPer1M = pricePerMillion(env.AGENT_MODEL_INPUT_USD_PER_1M, 0.1);
  const outputUsdPer1M = pricePerMillion(env.AGENT_MODEL_OUTPUT_USD_PER_1M, 0.4);
  const rawMicros = Math.ceil(
    (input / 1_000_000) * inputUsdPer1M * USD_MICROS +
      (output / 1_000_000) * outputUsdPer1M * USD_MICROS
  );
  return {
    provider: "google-vertex-ai",
    model,
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    raw_cost_usd_micros: rawMicros,
    charged_usd_micros: Math.ceil(rawMicros * PUBLIC_SERVICE_MULTIPLIER),
  };
}

export function minimumEstimatedChargeForTool(toolName: string): number {
  if (toolName === "create_resume" || toolName === "create_cover_letter") {
    // Preflight reserve for a 1-page document generation. Final billing is exact.
    return 1_000; // $0.001
  }
  return 0;
}

export async function ensureSufficientBalance(
  env: Env,
  accountId: string,
  estimatedChargeUsdMicros: number
): Promise<Response | null> {
  if (estimatedChargeUsdMicros <= 0) return null;
  const account = await getDeveloperAccount(env.JOBS_DB, accountId);
  if (!account || account.status !== "active") return Errors.forbidden("Developer account is not active");
  if (account.balance_usd_micros < estimatedChargeUsdMicros) {
    return Errors.forbidden("Insufficient account balance");
  }
  return null;
}

export async function finalizeMeteredUsage(
  env: Env,
  principal: MeteredPrincipal,
  route: string,
  toolName: string | null,
  usage: TokenUsage | null,
  status: PublicUsageLedgerRow["status"],
  metadata: Record<string, unknown> = {}
): Promise<{ charged_usd: number; balance_after_usd: number | null }> {
  const now = Math.floor(Date.now() / 1000);
  const charged = usage?.charged_usd_micros ?? 0;
  const after = charged > 0
    ? await debitDeveloperBalance(env.JOBS_DB, principal.account_id, charged, now)
    : (await getDeveloperAccount(env.JOBS_DB, principal.account_id))?.balance_usd_micros ?? null;
  await insertPublicUsageLedger(env.JOBS_DB, {
    id: crypto.randomUUID(),
    account_id: principal.account_id,
    api_key_id: principal.key.id,
    request_id: principal.request_id,
    route,
    tool_name: toolName,
    status: after === null && charged > 0 ? "rejected" : status,
    provider: usage?.provider ?? null,
    model: usage?.model ?? null,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    raw_cost_usd_micros: usage?.raw_cost_usd_micros ?? 0,
    charge_multiplier: PUBLIC_SERVICE_MULTIPLIER,
    charged_usd_micros: after === null ? 0 : charged,
    balance_after_usd_micros: after,
    metadata_json: JSON.stringify(metadata).slice(0, 4000),
    created_at: now,
  });
  return {
    charged_usd: after === null ? 0 : microsToUsd(charged),
    balance_after_usd: after == null ? null : microsToUsd(after),
  };
}
