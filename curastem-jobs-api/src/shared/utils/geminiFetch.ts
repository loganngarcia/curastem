const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_STATUSES = new Set([400, 404, 429, 500, 502, 503, 504]);

export async function fetchGeminiWithFallback(
  apiKey: string,
  primaryModel: string,
  action: string,
  body: unknown
): Promise<Response> {
  const fetchModel = (model: string) => {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:${action}?key=${apiKey}`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
