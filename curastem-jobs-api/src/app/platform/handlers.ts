/**
 * Public endpoints for the Framer web.tsx client: Maps key, Gemini Live ephemeral
 * tokens, and Gemini REST proxy. No Curastem API key auth — keys live in Worker secrets.
 */
import { GoogleGenAI } from "@google/genai";
import type { Env } from "../../shared/types.ts";
import { geminiQuotaResponse, reserveGeminiQuota } from "../../shared/utils/geminiQuota.ts";
import { logger } from "../../shared/utils/logger.ts";

const JSON_CORS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export function handleMapsKey(env: Env): Response {
  const key = env.GOOGLE_MAPS_API_KEY ?? "";
  if (!key) {
    return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured" }), {
      status: 503,
      headers: JSON_CORS,
    });
  }
  return new Response(JSON.stringify({ key }), {
    headers: {
      ...JSON_CORS,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function handleGeminiToken(env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 503,
      headers: JSON_CORS,
    });
  }
  const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_gemini_live_token");
  if (!quota.allowed) {
    const resp = geminiQuotaResponse(quota);
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  }
  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const expire = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpire = new Date(Date.now() + 60 * 1000).toISOString();
    // authTokens.create is only exposed on v1alpha. The client must therefore
    // open its Live WebSocket against the v1alpha BidiGenerateContent path —
    // mixing v1alpha tokens with a v1beta WebSocket fails auth silently.
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expire,
        newSessionExpireTime: newSessionExpire,
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    return new Response(JSON.stringify({ token: token.name }), { headers: JSON_CORS });
  } catch (err) {
    logger.error("framer_gemini_token_failed", { error: String(err) });
    return new Response(JSON.stringify({ error: "token_mint_failed", detail: String(err) }), {
      status: 502,
      headers: JSON_CORS,
    });
  }
}

const ALLOWED_ACTIONS = new Set(["generateContent", "streamGenerateContent", "countTokens"]);

export async function handleGeminiProxy(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 503,
      headers: JSON_CORS,
    });
  }
  const url = new URL(request.url);
  const model = url.searchParams.get("model");
  const action = url.searchParams.get("action");
  const alt = url.searchParams.get("alt") ?? "";
  if (!model || !action || !ALLOWED_ACTIONS.has(action)) {
    return new Response(JSON.stringify({ error: "bad_request", message: "model and valid action required" }), {
      status: 400,
      headers: JSON_CORS,
    });
  }
  const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_gemini_proxy");
  if (!quota.allowed) {
    const resp = geminiQuotaResponse(quota);
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  }
  const upstream = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}`
  );
  upstream.searchParams.set("key", env.GEMINI_API_KEY);
  if (alt) upstream.searchParams.set("alt", alt);

  try {
    const upResp = await fetch(upstream.toString(), {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body: request.body,
    });
    const contentType = upResp.headers.get("Content-Type") ?? "application/json";
    return new Response(upResp.body, {
      status: upResp.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("framer_gemini_proxy_failed", { error: String(err) });
    return new Response(JSON.stringify({ error: "upstream_failed", detail: String(err) }), {
      status: 502,
      headers: JSON_CORS,
    });
  }
}
