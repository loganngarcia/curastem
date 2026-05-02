import type { Env } from "../types.ts";
import { fetchAgentPlatform } from "./agentPlatform.ts";

const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_STATUSES = new Set([400, 404, 429, 500, 502, 503, 504]);

export async function fetchGeminiWithFallback(
  env: Env,
  primaryModel: string,
  action: "generateContent" | "streamGenerateContent" | "countTokens",
  body: unknown,
  alt?: string
): Promise<Response> {
  const fetchModel = (model: string) => {
    return fetchAgentPlatform(env, { model, action, body, alt });
  };

  let primary: Response;
  try {
    primary = await fetchModel(primaryModel);
  } catch (error) {
    if (primaryModel !== GEMINI_FALLBACK_MODEL) {
      console.warn("Gemini primary model request threw; retrying fallback", {
        primaryModel,
        fallbackModel: GEMINI_FALLBACK_MODEL,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      return fetchModel(GEMINI_FALLBACK_MODEL);
    }
    throw error;
  }
  if (
    primaryModel !== GEMINI_FALLBACK_MODEL &&
    GEMINI_FALLBACK_STATUSES.has(primary.status)
  ) {
    console.warn("Gemini primary model failed; retrying fallback", {
      primaryModel,
      fallbackModel: GEMINI_FALLBACK_MODEL,
      action,
      status: primary.status,
      statusText: primary.statusText,
    });
    return fetchModel(GEMINI_FALLBACK_MODEL);
  }
  return primary;
}
