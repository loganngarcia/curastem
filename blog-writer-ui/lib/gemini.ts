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
  {
    name: "edit_blog",
    description:
      "Edit the currently open blog by replacing specific text. Call this when the user asks to improve, fix, rewrite, shorten, or change any content. Make targeted changes — only edit what the user asked to change. Each operation must specify EXACT text from the current blog HTML and what to replace it with.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        operations: {
          type: Type.ARRAY,
          description: "Array of find-and-replace operations. Each must have 'find' (exact text in the blog) and 'replace' (new text).",
          items: {
            type: Type.OBJECT,
            properties: {
              find: {
                type: Type.STRING,
                description: "The exact text or HTML to find in the current blog content (case-sensitive, must match exactly).",
              },
              replace: {
                type: Type.STRING,
                description: "The new text or HTML to replace it with.",
              },
            },
            required: ["find", "replace"],
          },
        },
      },
      required: ["operations"],
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
  edit_blog: (operations: Array<{ find: string; replace: string }>) => Promise<unknown>;
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

    // Accumulate function calls + raw parts across chunks.
    // We capture the raw Part objects (not the SDK abstractions) so that any
    // thought_signature fields survive into the history we send back — Vertex AI
    // rejects multi-turn requests if a function call part's thought_signature is
    // stripped out between turns.
    type RawPart = Record<string, unknown>;
    const collectedFunctionCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      thoughtSignature?: string;
    }> = [];
    const modelParts: RawPart[] = [];

    for await (const chunk of response) {
      // Use raw parts to preserve thought_signature (SDK abstractions drop it)
      const rawParts = (
        (chunk as unknown as { candidates?: Array<{ content?: { parts?: RawPart[] } }> })
          .candidates?.[0]?.content?.parts ?? []
      ) as RawPart[];

      if (rawParts.length > 0) {
        for (const part of rawParts) {
          if (part.functionCall) {
            const fc = part.functionCall as { name?: string; args?: Record<string, unknown> };
            collectedFunctionCalls.push({
              name: fc.name ?? "",
              args: (fc.args ?? {}) as Record<string, unknown>,
              thoughtSignature: part.thoughtSignature as string | undefined,
            });
            // Preserve the full part (including thoughtSignature) in history
            modelParts.push(part);
          } else if (part.text && !part.thought) {
            // Pure text — stream to client and record
            const event: ChatSSEEvent = { t: "text", c: part.text as string };
            yield `data: ${JSON.stringify(event)}\n\n`;
            modelParts.push(part);
          } else {
            // Thought/thinking parts — capture for history but don't emit to client
            modelParts.push(part);
          }
        }
      } else {
        // Fallback: use SDK abstractions if raw parts are unavailable
        const text = chunk.text;
        const calls = chunk.functionCalls;
        if (calls?.length) {
          for (const call of calls) {
            collectedFunctionCalls.push({
              name: call.name ?? "",
              args: (call.args ?? {}) as Record<string, unknown>,
            });
            modelParts.push({ functionCall: { name: call.name ?? "", args: call.args ?? {} } });
          }
        } else if (text) {
          const event: ChatSSEEvent = { t: "text", c: text };
          yield `data: ${JSON.stringify(event)}\n\n`;
          modelParts.push({ text });
        }
      }
    }

    if (collectedFunctionCalls.length === 0) {
      // No tool calls — we're done
      break;
    }

    // Add the model's turn (with full raw parts, preserving thought_signature) to history
    contents.push({ role: "model", parts: modelParts as unknown as Array<{ text: string }> });

    // Execute each tool and collect results
    const functionResponseParts: RawPart[] = [];

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
        } else if (call.name === "edit_blog") {
          result = await handlers.edit_blog(
            call.args.operations as Array<{ find: string; replace: string }>
          );
        } else {
          result = { error: `Unknown tool: ${call.name}` };
        }

        yield `data: ${JSON.stringify({ t: "tool_done", n: call.name, r: result } satisfies ChatSSEEvent)}\n\n`;

        // Echo thought_signature in the function response (required by Vertex AI)
        const responsePart: RawPart = {
          functionResponse: { name: call.name, response: { output: result } },
        };
        if (call.thoughtSignature) {
          responsePart.thoughtSignature = call.thoughtSignature;
        }
        functionResponseParts.push(responsePart);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        yield `data: ${JSON.stringify({ t: "tool_error", n: call.name, err: errMsg } satisfies ChatSSEEvent)}\n\n`;
        const errPart: RawPart = {
          functionResponse: { name: call.name, response: { output: { error: errMsg } } },
        };
        if (call.thoughtSignature) {
          errPart.thoughtSignature = call.thoughtSignature;
        }
        functionResponseParts.push(errPart);
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

// ---------------------------------------------------------------------------
// Image editing — takes an existing image URL + edit prompt, runs it through
// Nano Banana 2 with the image as context to generate a modified version.
// ---------------------------------------------------------------------------
export async function editImageViaGemini(
  existingImageUrl: string,
  editPrompt: string,
  accentHue: string = "Purple",
  aspect: string = "16:9",
  imageSize: string = "1K"
): Promise<string> {
  const ai = getClient();

  // Fetch existing image from URL and convert to base64 (server-side, no CORS issues)
  const imageRes = await fetch(existingImageUrl);
  if (!imageRes.ok) throw new Error(`Failed to fetch source image: ${imageRes.status}`);
  const imageBuffer = await imageRes.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const mimeType = imageRes.headers.get("content-type") || "image/jpeg";

  const stylePrompt = `Edit this flat minimalist vector illustration. The requested change: ${editPrompt}.
Maintain the same art style: flat 2D vector art, thick uniform marker-style outlines, 3-color palette (black outlines, pale ${accentHue} background, vibrant ${accentHue} accents). NO text, NO shading, NO gradients. Keep the same composition and aspect ratio.`;

  console.log(`[NanaBanana2/Edit] Editing image with prompt="${editPrompt}", aspect="${aspect}"`);

  const response = await ai.models.generateContent({
    model: GEMINI_MODELS.NANO_BANANA_2,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: stylePrompt },
      ],
    }],
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
    throw new Error(`No image returned from image edit. Response: ${JSON.stringify(response).substring(0, 400)}`);
  }
  const { mimeType: outMime, data: b64 } = imagePart.inlineData;
  console.log(`[NanaBanana2/Edit] Edited image generated (${b64.length} chars, ${outMime})`);
  return `data:${outMime};base64,${b64}`;
}
