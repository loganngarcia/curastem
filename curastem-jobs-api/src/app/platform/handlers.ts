/**
 * Public endpoints for the Framer web.tsx client: Maps key, Gemini Live proxy,
 * and Gemini REST proxy. No Curastem API key auth — credentials live in Worker secrets.
 */
import type { Env } from "../../shared/types.ts";
import { readSession } from "../auth/session.ts";
import { AGENT_TOOL_DECLARATIONS, executeAgentTool } from "../agent/tools.ts";
import type { AgentToolName } from "../agent/types.ts";
import {
  agentPlatformHost,
  agentPlatformModelName,
  fetchAgentPlatform,
  getAgentPlatformAccessToken,
  getAgentPlatformLiveLocation,
  getAgentPlatformLiveModel,
} from "../../shared/utils/agentPlatform.ts";
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
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return new Response(JSON.stringify({ error: "Agent Platform credentials not configured" }), {
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
    await getAgentPlatformAccessToken(env);
    return new Response(JSON.stringify({ status: "use_websocket_proxy" }), { headers: JSON_CORS });
  } catch (err) {
    logger.error("framer_agent_platform_auth_failed", { error: String(err) });
    return new Response(JSON.stringify({ error: "agent_platform_auth_failed", detail: String(err) }), {
      status: 502,
      headers: JSON_CORS,
    });
  }
}

const ALLOWED_ACTIONS = new Set(["generateContent", "streamGenerateContent", "countTokens"]);

function isAgentToolName(name: unknown): name is AgentToolName {
  return typeof name === "string" && AGENT_TOOL_DECLARATIONS.some((tool) => tool.name === name);
}

async function maybeHandleLiveAgentToolCall(
  env: Env,
  upstream: WebSocket,
  client: WebSocket,
  raw: string,
  userId: string | null,
  clientMemoryState?: { memories: string[] }
): Promise<boolean> {
  let data: {
    toolCall?: {
      functionCalls?: Array<{
        id?: string;
        name?: unknown;
        args?: unknown;
      }>;
    };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  const calls = data.toolCall?.functionCalls ?? [];
  const supported = calls.filter((call) => isAgentToolName(call.name));
  if (supported.length === 0) return false;

  const functionResponses = [];
  for (const call of supported) {
    const result = await executeAgentTool(env, call.name as AgentToolName, call.args ?? {}, { userId, clientMemories: clientMemoryState?.memories });
    const memoryEvent = result.events.find((event) => event.type === "memory_update");
    const nextMemories = Array.isArray(memoryEvent?.result?.memories)
      ? memoryEvent.result.memories.filter((item): item is string => typeof item === "string")
      : null;
    if (nextMemories && clientMemoryState) clientMemoryState.memories = nextMemories;
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ serverToolEvents: result.events }));
    }
    functionResponses.push({
      id: call.id,
      name: call.name,
      response: result.functionResponse,
    });
  }
  if (upstream.readyState === WebSocket.OPEN) {
    upstream.send(JSON.stringify({ toolResponse: { functionResponses } }));
  }
  return supported.length === calls.length;
}

export async function handleGeminiProxy(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return new Response(JSON.stringify({ error: "Agent Platform credentials not configured" }), {
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
  try {
    const body = await request.json();
    const upResp = await fetchAgentPlatform(env, {
      model,
      action: action as "generateContent" | "streamGenerateContent" | "countTokens",
      body,
      alt,
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

function normalizeClientMemories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function toVertexLiveSetupMessage(env: Env, raw: string): { raw: string; clientMemories?: string[] } {
  try {
    const data = JSON.parse(raw) as {
      setup?: {
        model?: string;
        generationConfig?: unknown;
        generation_config?: unknown;
        clientContext?: { memories?: unknown };
      };
    };
    if (!data.setup) return { raw };
    const clientMemories = normalizeClientMemories(data.setup.clientContext?.memories);
    delete data.setup.clientContext;
    const location = getAgentPlatformLiveLocation(env);
    data.setup.model = agentPlatformModelName(env, getAgentPlatformLiveModel(env), location);
    const generationConfig = data.setup.generationConfig ?? data.setup.generation_config;
    if (generationConfig && typeof generationConfig === "object" && !Array.isArray(generationConfig)) {
      delete (generationConfig as Record<string, unknown>).thinkingConfig;
      delete (generationConfig as Record<string, unknown>).thinking_config;
    }
    if (data.setup.generationConfig && !data.setup.generation_config) {
      data.setup.generation_config = data.setup.generationConfig;
      delete data.setup.generationConfig;
    }
    return {
      raw: JSON.stringify(data),
      ...(clientMemories.length > 0 ? { clientMemories } : {}),
    };
  } catch {
    return { raw };
  }
}

export async function handleGeminiLiveProxy(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426, headers: JSON_CORS });
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return new Response(JSON.stringify({ error: "Agent Platform credentials not configured" }), {
      status: 503,
      headers: JSON_CORS,
    });
  }
  const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_gemini_live_proxy");
  if (!quota.allowed) {
    const resp = geminiQuotaResponse(quota);
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  const session = await readSession(request, env);
  const userId = session?.user.id ?? null;

  let upstream: WebSocket | null = null;
  let setupForwarded = false;
  const liveClientMemoryState: { memories: string[] } = { memories: [] };
  const pendingClientMessages: Array<string | ArrayBuffer> = [];

  const forwardClientMessage = (data: string | ArrayBuffer): void => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      pendingClientMessages.push(data);
      return;
    }
    if (!setupForwarded && typeof data === "string") {
      setupForwarded = true;
      const setup = toVertexLiveSetupMessage(env, data);
      liveClientMemoryState.memories = setup.clientMemories ?? [];
      upstream.send(setup.raw);
      return;
    }
    upstream.send(data);
  };

  server.addEventListener("message", (event) => {
    forwardClientMessage(event.data);
  });
  server.addEventListener("close", () => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.close();
  });
  server.addEventListener("error", () => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.close();
  });

  const connectUpstream = async (): Promise<void> => {
    try {
      const location = getAgentPlatformLiveLocation(env);
      const accessToken = await getAgentPlatformAccessToken(env);
      const upstreamResp = await fetch(
        `https://${agentPlatformHost(location)}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Upgrade": "websocket",
          },
        }
      );
      upstream = upstreamResp.webSocket;
      if (!upstream) {
        logger.error("framer_gemini_live_upstream_rejected", { status: upstreamResp.status });
        server.close(1011, `Agent Platform Live rejected WebSocket (${upstreamResp.status})`);
        return;
      }
      upstream.accept();
      upstream.addEventListener("message", (event) => {
        const data =
          typeof event.data === "string"
            ? event.data
            : event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : null;
        if (data) {
          void maybeHandleLiveAgentToolCall(env, upstream!, server, data, userId, liveClientMemoryState)
            .then((handled) => {
              if (!handled && server.readyState === WebSocket.OPEN) server.send(event.data);
            })
            .catch((err) => {
              logger.error("framer_gemini_live_tool_intercept_failed", { error: String(err) });
              if (server.readyState === WebSocket.OPEN) server.send(event.data);
            });
          return;
        }
        if (server.readyState === WebSocket.OPEN) server.send(event.data);
      });
      upstream.addEventListener("close", (event) => {
        logger.info("framer_gemini_live_upstream_closed", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        if (server.readyState === WebSocket.OPEN) server.close();
      });
      upstream.addEventListener("error", () => {
        logger.error("framer_gemini_live_upstream_error", {});
        if (server.readyState === WebSocket.OPEN) server.close(1011, "Agent Platform Live socket error");
      });
      while (pendingClientMessages.length > 0) {
        forwardClientMessage(pendingClientMessages.shift()!);
      }
    } catch (err) {
      logger.error("framer_gemini_live_proxy_failed", { error: String(err) });
      server.close(1011, "Agent Platform Live proxy failed");
    }
  };

  void connectUpstream();

  return new Response(null, { status: 101, webSocket: client });
}
