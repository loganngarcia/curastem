import type { Env } from "../../shared/types.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import {
  generateApiKey,
  requireAdmin,
  sha256Hex,
  usdToMicros,
  microsToUsd,
} from "../../shared/utils/publicBilling.ts";
import {
  adjustDeveloperBalance,
  createDeveloperAccount,
  insertDeveloperApiKey,
  listDeveloperAccounts,
  listDeveloperApiKeys,
  revokeDeveloperApiKey,
} from "../../shared/db/queries.ts";

const KEY_ID_PATTERN = /^\/admin\/api-keys\/([^/]+)$/;
const ACCOUNT_TOP_UP_PATTERN = /^\/admin\/developer-accounts\/([^/]+)\/top-up$/;

function adminActor(request: Request): string | null {
  return request.headers.get("X-Curastem-Admin-Actor")?.slice(0, 120) ?? null;
}

function publicKeyShape(key: Awaited<ReturnType<typeof listDeveloperApiKeys>>[number]): Record<string, unknown> {
  return {
    id: key.id,
    account_id: key.account_id,
    name: key.name,
    key_prefix: key.key_prefix,
    owner_email: key.owner_email,
    description: key.description,
    scopes: key.scopes ? JSON.parse(key.scopes) : null,
    rate_limit_per_minute: key.rate_limit_per_minute,
    daily_limit_usd: key.daily_limit_usd_micros == null ? null : microsToUsd(key.daily_limit_usd_micros),
    monthly_limit_usd: key.monthly_limit_usd_micros == null ? null : microsToUsd(key.monthly_limit_usd_micros),
    active: key.active === 1,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
  };
}

export async function handleDeveloperAdminRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (
    path !== "/admin/developer-accounts" &&
    path !== "/admin/api-keys" &&
    !KEY_ID_PATTERN.test(path) &&
    !ACCOUNT_TOP_UP_PATTERN.test(path)
  ) {
    return null;
  }

  const adminError = requireAdmin(request, env);
  if (adminError) return adminError;
  const now = Math.floor(Date.now() / 1000);

  if (path === "/admin/developer-accounts" && method === "GET") {
    const accounts = await listDeveloperAccounts(env.JOBS_DB);
    return jsonOk({
      data: accounts.map((a) => ({
        ...a,
        balance_usd: microsToUsd(a.balance_usd_micros),
      })),
    });
  }

  if (path === "/admin/developer-accounts" && method === "POST") {
    const body = await request.json().catch(() => null) as {
      name?: string;
      owner_email?: string;
      initial_balance_usd?: number | string;
    } | null;
    if (!body?.name?.trim() || !body.owner_email?.trim()) {
      return Errors.badRequest("name and owner_email are required");
    }
    const initial = usdToMicros(body.initial_balance_usd ?? 0);
    if (initial == null || initial < 0) return Errors.badRequest("initial_balance_usd must be non-negative");
    const account = await createDeveloperAccount(env.JOBS_DB, {
      id: crypto.randomUUID(),
      name: body.name.trim(),
      owner_email: body.owner_email.trim().toLowerCase(),
      initial_balance_usd_micros: initial,
      admin_actor: adminActor(request),
      now,
    });
    return jsonOk({ account: { ...account, balance_usd: microsToUsd(initial) } }, 201);
  }

  const topUpMatch = path.match(ACCOUNT_TOP_UP_PATTERN);
  if (topUpMatch && method === "POST") {
    const body = await request.json().catch(() => null) as {
      amount_usd?: number | string;
      description?: string;
    } | null;
    const amount = usdToMicros(body?.amount_usd);
    if (amount == null || amount <= 0) return Errors.badRequest("amount_usd must be positive");
    const balance = await adjustDeveloperBalance(
      env.JOBS_DB,
      topUpMatch[1],
      amount,
      "top_up",
      body?.description?.slice(0, 500) ?? null,
      adminActor(request),
      now
    );
    return jsonOk({ account_id: topUpMatch[1], balance_usd: microsToUsd(balance) });
  }

  if (path === "/admin/api-keys" && method === "GET") {
    const url = new URL(request.url);
    const keys = await listDeveloperApiKeys(env.JOBS_DB, url.searchParams.get("account_id") ?? undefined);
    return jsonOk({ data: keys.map(publicKeyShape) });
  }

  if (path === "/admin/api-keys" && method === "POST") {
    const body = await request.json().catch(() => null) as {
      account_id?: string;
      owner_email?: string;
      name?: string;
      description?: string;
      scopes?: string[];
      rate_limit_per_minute?: number;
      daily_limit_usd?: number | string | null;
      monthly_limit_usd?: number | string | null;
    } | null;
    if (!body?.account_id || !body.owner_email?.trim()) {
      return Errors.badRequest("account_id and owner_email are required");
    }
    const { raw, prefix } = generateApiKey();
    const key = await insertDeveloperApiKey(env.JOBS_DB, {
      id: crypto.randomUUID(),
      key_hash: await sha256Hex(raw),
      key_prefix: prefix,
      account_id: body.account_id,
      owner_email: body.owner_email.trim().toLowerCase(),
      name: body.name?.slice(0, 120) ?? null,
      description: body.description?.slice(0, 500) ?? null,
      scopes: JSON.stringify(body.scopes?.length ? body.scopes : ["agent:tools", "jobs:read"]),
      rate_limit_per_minute: Math.min(Math.max(Math.floor(body.rate_limit_per_minute ?? 60), 1), 600),
      daily_limit_usd_micros: body.daily_limit_usd == null ? null : usdToMicros(body.daily_limit_usd),
      monthly_limit_usd_micros: body.monthly_limit_usd == null ? null : usdToMicros(body.monthly_limit_usd),
      now,
    });
    return jsonOk({ api_key: raw, key: publicKeyShape(key) }, 201);
  }

  const keyMatch = path.match(KEY_ID_PATTERN);
  if (keyMatch && method === "DELETE") {
    await revokeDeveloperApiKey(env.JOBS_DB, keyMatch[1]);
    return jsonOk({ status: "revoked", id: keyMatch[1] });
  }

  return Errors.methodNotAllowed();
}
