const POE_API_KEY = process.env.POE_API_KEY;
const POE_API_URL = "https://api.poe.com/v1/chat/completions";

// Models available via Poe API
export const POE_MODELS = {
  GEMINI_3_FLASH: "Gemini-3-Flash",
  NANO_BANANA: "nano-banana-pro",
} as const;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  aspect?: string;
}

export async function* streamChatCompletion(
  options: ChatCompletionOptions
): AsyncGenerator<string, void, unknown> {
  const apiKey = (process.env.POE_API_KEY || "").trim();
  
  if (!apiKey) {
    throw new Error("POE_API_KEY not configured");
  }

    const response = await fetch(POE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
        aspect: options.aspect,
      }),
    });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Poe API error: ${response.status} - ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}

export async function generateChatCompletion(
  options: ChatCompletionOptions
): Promise<string> {
  const apiKey = (process.env.POE_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("POE_API_KEY not configured");
  }

  const response = await fetch(POE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
      temperature: options.temperature ?? 0.7,
      aspect: options.aspect,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Poe API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Image generation using nano-banana-pro
export async function generateImageViaPoe(
  subject: string,
  accentHue: string,
  aspect: string = "16:9"
): Promise<string> {
  const prompt = `Subject: ${subject}
Accent Hue: ${accentHue}

PROMPT:
A flat, minimalist vector illustration of ${subject}.
STRICT COLOR PALETTE (3 COLORS ONLY):
1. OUTLINES: Heavy, Mono-weight Black (#000000).
2. BACKGROUND: A very pale, near-white tint of ${accentHue}.
3. ACCENTS: A vibrant, solid ${accentHue}.

COLOR APPLICATION RULES (CRITICAL):
- The BACKGROUND color must be used for the background canvas AND for character skin/faces/negative space.
- The ACCENT color must generally be used ONLY for clothing, hair, props, and key details.
- Do NOT fill the entire character with the accent color.

NEGATIVE CONSTRAINTS:
- NO TEXT, NO LETTERS, NO SIGNAGE.
- NO shading, NO gradients, NO shadows.
- NO other colors.
- NO stereotype character types or gender roles.

STYLE:
- Flat 2D vector art.
- Thick, uniform "marker style" outlines.
- "Rubber hose" style simplified anatomy.`;

  const content = await generateChatCompletion({
    model: POE_MODELS.NANO_BANANA,
    messages: [{ role: "user", content: prompt }],
    aspect,
  });

  // Extract image URL from markdown or direct URL
  const urlMatch =
    content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/) ??
    content.match(/https?:\/\/[^\s)"']+\.(png|jpg|jpeg|webp)/i);
  const url = urlMatch ? urlMatch[1] ?? urlMatch[0] : null;

  if (!url || !url.startsWith("http")) {
    throw new Error("No image URL in Poe response");
  }

  return url;
}

// Delay utility for rate limiting
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
