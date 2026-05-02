import { readSession } from "../auth/session.ts";
import type { Env } from "../../shared/types.ts";
import { jsonOk, Errors } from "../../shared/utils/errors.ts";
import { fetchAgentPlatform } from "../../shared/utils/agentPlatform.ts";
import { geminiQuotaResponse, reserveGeminiQuota } from "../../shared/utils/geminiQuota.ts";
import { logger } from "../../shared/utils/logger.ts";
import { AGENT_TOOL_DECLARATIONS, executeAgentTool } from "./tools.ts";
import type { AgentEvent, AgentToolName } from "./types.ts";

const AGENT_MODEL = "gemini-3.1-flash-lite-preview";
const MAX_TOOL_LOOPS = 4;
const TERMINAL_UI_TOOLS = new Set<AgentToolName>([
  "open_job_details",
  "open_docs",
  "open_maps",
  "open_whiteboard",
  "open_app_editor",
  "create_resume",
  "create_cover_letter",
  "create_doc",
  "edit_doc",
  "create_app",
  "edit_app",
  "draw_whiteboard",
  "edit_whiteboard",
  "erase_whiteboard",
]);

interface AgentChatRequest {
  contents?: unknown[];
  systemInstruction?: unknown;
  generationConfig?: Record<string, unknown>;
  model?: string;
  clientContext?: {
    selectedJobId?: string | null;
    memories?: string[];
  };
}

interface AgentToolRequest {
  name?: AgentToolName;
  args?: unknown;
  searchParams?: string;
  selectedJobId?: string | null;
  clientMemories?: string[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{
        text?: string;
        thoughtSignature?: string;
        functionCall?: {
          name?: AgentToolName;
          args?: unknown;
        };
      }>;
    };
  }>;
}

function textFromGemini(data: GeminiResponse): string {
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

function functionCallsFromGemini(data: GeminiResponse, toolNames = new Set(AGENT_TOOL_DECLARATIONS.map((tool) => tool.name))): Array<{ name: AgentToolName; args: unknown }> {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const calls: Array<{ name: AgentToolName; args: unknown }> = [];
  for (const part of parts) {
    const fc = part.functionCall;
    if (fc?.name && toolNames.has(fc.name)) {
      calls.push({ name: fc.name as AgentToolName, args: fc.args ?? {} });
    }
  }
  return calls;
}

function functionCallPartsFromGemini(data: GeminiResponse, toolNames = new Set(AGENT_TOOL_DECLARATIONS.map((tool) => tool.name))): Array<Record<string, unknown>> {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.functionCall?.name && toolNames.has(part.functionCall.name))
    .map((part) => ({
      functionCall: part.functionCall,
      ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
    }));
}

function normalizeVertexSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeVertexSchema);
  if (!value || typeof value !== "object") return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    normalized[key] =
      key === "type" && typeof nested === "string"
        ? nested.toLowerCase()
        : normalizeVertexSchema(nested);
  }
  return normalized;
}

function vertexAgentToolDeclarations(excludedToolNames = new Set<AgentToolName>()) {
  return AGENT_TOOL_DECLARATIONS
    .filter((tool) => !excludedToolNames.has(tool.name))
    .map((tool) => ({
    ...tool,
    parameters: normalizeVertexSchema(tool.parameters),
  }));
}

function safeTerminalFunctionResponse(name: AgentToolName, response: Record<string, unknown>): Record<string, unknown> {
  if (name === "create_resume" || name === "create_cover_letter" || name === "create_doc" || name === "edit_doc") {
    return {
      ok: true,
      document_ready: true,
      pdf_ready: Boolean(response.pdf_base64),
      pdf_filename: response.pdf_filename,
    };
  }
  if (name === "create_app") {
    return { ok: true, app_ready: true };
  }
  if (name === "edit_app") {
    return { ok: true, app_updated: true, operations_count: response.operations_count };
  }
  if (name === "draw_whiteboard" || name === "edit_whiteboard" || name === "erase_whiteboard") {
    return { ok: true, whiteboard_updated: true };
  }
  return response;
}

async function callModel(env: Env, body: unknown, model: string): Promise<GeminiResponse> {
  const resp = await fetchAgentPlatform(env, {
    model,
    action: "generateContent",
    body,
  });
  if (!resp.ok) {
    throw new Error(`Agent model call failed ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  return (await resp.json()) as GeminiResponse;
}

async function hasRetrievableResume(env: Env, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const row = await env.JOBS_DB.prepare(
    `SELECT resume_plain, resume_doc_html FROM profile WHERE user_id = ?`
  )
    .bind(userId)
    .first<{ resume_plain: string | null; resume_doc_html: string | null }>();
  return Boolean(row?.resume_plain?.trim() || row?.resume_doc_html?.trim());
}

export async function handleAgentTools(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  const excludedToolNames = new Set<AgentToolName>();
  if (!(await hasRetrievableResume(env, session?.user.id))) {
    excludedToolNames.add("retrieve_resume");
  }
  const functionDeclarations = AGENT_TOOL_DECLARATIONS.filter((tool) => !excludedToolNames.has(tool.name));
  return jsonOk({ tools: [{ functionDeclarations }] });
}

export async function handleAgentTool(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  const body = (await request.json().catch(() => null)) as AgentToolRequest | null;
  if (!body?.name) return Errors.badRequest("Missing tool name");
  const searchParams = body.searchParams ? new URLSearchParams(body.searchParams) : undefined;
  const result = await executeAgentTool(env, body.name, body.args ?? {}, {
    searchParams,
    selectedJobId: body.selectedJobId,
    userId: session?.user.id ?? null,
    clientMemories: body.clientMemories,
  });
  return jsonOk(result);
}

export async function handleAgentChat(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return Errors.internal("Agent Platform credentials not configured");
  }
  const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_agent_chat");
  if (!quota.allowed) return geminiQuotaResponse(quota);

  const body = (await request.json().catch(() => null)) as AgentChatRequest | null;
  if (!body || !Array.isArray(body.contents)) return Errors.badRequest("contents required");

  const model = body.model?.trim() || AGENT_MODEL;
  const contents = [...body.contents];
  const events: AgentEvent[] = [];
  const generationConfig = {
    temperature: 1,
    maxOutputTokens: 2048,
    thinkingConfig: { thinkingBudget: 0 },
    ...body.generationConfig,
  };

  try {
    const excludedToolNames = new Set<AgentToolName>();
    if (!(await hasRetrievableResume(env, session?.user.id))) {
      excludedToolNames.add("retrieve_resume");
    }
    const toolDeclarations = vertexAgentToolDeclarations(excludedToolNames);
    const toolNames = new Set(toolDeclarations.map((tool) => tool.name));
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const response = await callModel(
        env,
        {
          contents,
          tools: [{ functionDeclarations: toolDeclarations }],
          generationConfig,
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          systemInstruction: body.systemInstruction,
        },
        model
      );
      const text = textFromGemini(response);
      const calls = functionCallsFromGemini(response, toolNames);
      if (text.trim()) events.push({ type: "assistant_text", text });
      if (calls.length === 0) {
        return jsonOk({ events });
      }

      const modelParts = functionCallPartsFromGemini(response, toolNames);
      contents.push({ role: "model", parts: modelParts });
      const responseParts = [];
      for (const call of calls) {
        const toolResult = await executeAgentTool(env, call.name, call.args, {
          selectedJobId: body.clientContext?.selectedJobId ?? null,
          userId: session?.user.id ?? null,
          clientMemories: body.clientContext?.memories,
        });
        events.push(...toolResult.events);
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: TERMINAL_UI_TOOLS.has(call.name)
              ? safeTerminalFunctionResponse(call.name, toolResult.functionResponse)
              : toolResult.functionResponse,
          },
        });
      }
      if (calls.some((call) => TERMINAL_UI_TOOLS.has(call.name))) {
        contents.push({ role: "user", parts: responseParts });
        const followUp = await callModel(
          env,
          {
            contents,
            generationConfig: {
              ...generationConfig,
              maxOutputTokens: 384,
            },
            systemInstruction: body.systemInstruction,
          },
          model
        );
        const followUpText = textFromGemini(followUp).trim();
        if (followUpText) events.push({ type: "assistant_text", text: followUpText });
        return jsonOk({ events });
      }
      contents.push({ role: "user", parts: responseParts });
    }
    return jsonOk({ events });
  } catch (err) {
    logger.error("agent_chat_failed", { error: String(err) });
    return Errors.internal("Agent chat failed");
  }
}
