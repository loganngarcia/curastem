import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";

// ---------------------------------------------------------------------------
// Client initialisation — Vertex AI via service account credentials.
// GOOGLE_APPLICATION_CREDENTIALS_JSON  — service account key JSON (string)
// GOOGLE_CLOUD_PROJECT                 — GCP project ID
// Falls back to Gemini Developer API (GEMINI_API_KEY) if absent.
//
// In serverless environments (Vercel) we write the JSON to /tmp and point
// GOOGLE_APPLICATION_CREDENTIALS at it — the standard ADC pattern.
// ---------------------------------------------------------------------------
import { writeFileSync, existsSync } from "fs";

const CREDS_TMP_PATH = "/tmp/gcp-sa-credentials.json";

function getClient(): GoogleGenAI {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();

  if (credsJson && project) {
    // Write to /tmp once per cold start so ADC can find it
    if (!existsSync(CREDS_TMP_PATH)) {
      writeFileSync(CREDS_TMP_PATH, credsJson, "utf8");
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDS_TMP_PATH;

    return new GoogleGenAI({
      vertexai: true,
      project,
      location: "global", // gemini-3-flash-preview is only available in the global region
    });
  }

  // Fallback — Gemini Developer API
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("No credentials: set GOOGLE_APPLICATION_CREDENTIALS_JSON or GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

export const GEMINI_MODELS = {
  // Text / chat — Gemini 3 Flash (Public Preview on Vertex AI, region: global)
  FLASH: "gemini-3-flash-preview",
  // Image generation — Gemini 3.1 Flash Image = Nano Banana 2 (Feb 26 2026)
  NANO_BANANA_2: "gemini-3.1-flash-image-preview",
} as const;

// ---------------------------------------------------------------------------
// Tool definitions exposed to the model
// ---------------------------------------------------------------------------
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "create_blog",
    description:
      "Creates a new blog post scaffold in Framer CMS and immediately opens the editor. Call this FIRST, then stream the full blog HTML as your text response so the user watches it appear in real time.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "The title of the blog post to create",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "list_blogs",
    description:
      "Lists all existing blog posts in Framer CMS. Call this when the user asks to see, list, or find existing blogs.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "add_image",
    description:
      "Generates and inserts an image above a specific H2 heading in the currently open blog post.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        h2Text: {
          type: Type.STRING,
          description: "The exact text of the H2 heading to insert the image above",
        },
        subject: {
          type: Type.STRING,
          description:
            "A description of what the image should show (e.g. 'person working at desk in modern office')",
        },
      },
      required: ["h2Text", "subject"],
    },
  },
];

// ---------------------------------------------------------------------------
// SSE event types streamed back to the client
// ---------------------------------------------------------------------------
export interface ChatSSEEvent {
  t: "text" | "tool_start" | "tool_done" | "tool_error" | "done";
  // text event
  c?: string;
  // tool events
  n?: string;
  a?: Record<string, unknown>;
  r?: unknown;
  err?: string;
}

// ---------------------------------------------------------------------------
// Core streaming chat with real Gemini tool calling.
// The generator yields serialised SSE lines: "data: {...}\n\n"
//
// Tool execution callbacks are injected so this function stays pure and the
// route handler can wire in the real implementations.
// ---------------------------------------------------------------------------
export interface ToolHandlers {
  create_blog: (title: string) => Promise<unknown>;
  list_blogs: () => Promise<unknown>;
  add_image: (h2Text: string, subject: string) => Promise<unknown>;
}

export async function* streamChatWithTools(
  systemInstruction: string,
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>,
  handlers: ToolHandlers
): AsyncGenerator<string, void, unknown> {
  const ai = getClient();

  // Keep a mutable contents array for the multi-turn tool loop
  const contents = [...history];

  // The outer loop keeps going while the model keeps calling tools
  let continueLoop = true;
  while (continueLoop) {
    continueLoop = false; // will be set back to true if we handle a tool call

    const response = await ai.models.generateContentStream({
      model: GEMINI_MODELS.FLASH,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: 0.7,
        maxOutputTokens: 8192,
        // Disable thinking to prevent thought_signature multi-turn errors on Vertex AI.
        // Gemini 3 Flash generates thought tokens by default; without re-including their
        // signatures in subsequent turns the API rejects the request with 400.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // Accumulate function calls across chunks (SDK may split them)
    const collectedFunctionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const modelParts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> = [];

    for await (const chunk of response) {
      const text = chunk.text;
      const calls = chunk.functionCalls;

      if (calls?.length) {
        // Function-call chunk — collect the call(s).
        // Do NOT emit chunk.text here: Gemini sometimes serialises the call
        // arguments into chunk.text alongside the functionCall, which would
        // inject raw JSON into the editor content.
        for (const call of calls) {
          collectedFunctionCalls.push({
            name: call.name ?? "",
            args: (call.args ?? {}) as Record<string, unknown>,
          });
          modelParts.push({ functionCall: { name: call.name ?? "", args: (call.args ?? {}) as Record<string, unknown> } });
        }
      } else if (text) {
        // Pure text chunk — stream it to the client and record it.
        const event: ChatSSEEvent = { t: "text", c: text };
        yield `data: ${JSON.stringify(event)}\n\n`;
        modelParts.push({ text });
      }
    }

    if (collectedFunctionCalls.length === 0) {
      // No tool calls — we're done
      break;
    }

    // Add the model's turn (with function calls) to history
    contents.push({ role: "model", parts: modelParts as Array<{ text: string }> });

    // Execute each tool and collect results
    const functionResponseParts: Array<{
      functionResponse: { name: string; response: { output: unknown } };
    }> = [];

    for (const call of collectedFunctionCalls) {
      yield `data: ${JSON.stringify({ t: "tool_start", n: call.name, a: call.args } satisfies ChatSSEEvent)}\n\n`;

      try {
        let result: unknown;
        if (call.name === "create_blog") {
          result = await handlers.create_blog(call.args.title as string);
        } else if (call.name === "list_blogs") {
          result = await handlers.list_blogs();
        } else if (call.name === "add_image") {
          result = await handlers.add_image(
            call.args.h2Text as string,
            call.args.subject as string
          );
        } else {
          result = { error: `Unknown tool: ${call.name}` };
        }

        yield `data: ${JSON.stringify({ t: "tool_done", n: call.name, r: result } satisfies ChatSSEEvent)}\n\n`;

        functionResponseParts.push({
          functionResponse: { name: call.name, response: { output: result } },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        yield `data: ${JSON.stringify({ t: "tool_error", n: call.name, err: errMsg } satisfies ChatSSEEvent)}\n\n`;
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: { output: { error: errMsg } },
          },
        });
      }
    }

    // Add the function responses and loop back for the model's next turn
    contents.push({ role: "user", parts: functionResponseParts as unknown as Array<{ text: string }> });
    continueLoop = true;
  }

  yield `data: ${JSON.stringify({ t: "done" } satisfies ChatSSEEvent)}\n\n`;
}

// ---------------------------------------------------------------------------
// Image generation via Gemini 3.1 Flash Image — "Nano Banana 2"
// Prefers Vertex AI (service account) over the Gemini Developer API (API key)
// so no GEMINI_API_KEY HTTP-referrer restrictions apply.
// Returns a base64 data URL ready to upload to Framer.
// ---------------------------------------------------------------------------
export async function generateImageViaImagen(
  subject: string,
  accentHue: string,
  aspect: string = "16:9",
  imageSize: string = "1K"
): Promise<string> {
  const prompt = `A flat, minimalist vector illustration of ${subject}.
STRICT COLOR PALETTE (3 COLORS ONLY):
1. OUTLINES: Heavy, mono-weight Black (#000000).
2. BACKGROUND: A very pale, near-white tint of ${accentHue}.
3. ACCENTS: A vibrant, solid ${accentHue}.

COLOR APPLICATION RULES (CRITICAL):
- Background color must be used for the canvas AND character skin/faces/negative space.
- Accent color must be used ONLY for clothing, hair, props, and key details.
- Do NOT fill the entire character with the accent color.

NEGATIVE CONSTRAINTS:
- NO TEXT, NO LETTERS, NO SIGNAGE.
- NO shading, NO gradients, NO shadows.
- NO other colors.

STYLE:
- Flat 2D vector art.
- Thick, uniform marker-style outlines.
- Rubber hose simplified anatomy.`;

  console.log(`[NanaBanana2] Generating image: subject="${subject}", aspect="${aspect}", size="${imageSize}"`);

  // Always use Vertex AI — no fallback to the Gemini Developer API
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: GEMINI_MODELS.NANO_BANANA_2,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: aspect, imageSize },
    } as Record<string, unknown>,
  });

  const parts = (response.candidates?.[0]?.content?.parts ?? []) as Array<{
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }>;
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) {
    throw new Error(
      `No image returned from Nano Banana 2 (Vertex). Response: ${JSON.stringify(response).substring(0, 400)}`
    );
  }
  const { mimeType, data: b64 } = imagePart.inlineData;
  console.log(`[NanaBanana2/Vertex] Image generated (${b64.length} chars, ${mimeType})`);
  return `data:${mimeType};base64,${b64}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
