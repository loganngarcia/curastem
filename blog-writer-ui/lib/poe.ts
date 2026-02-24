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
  parameters?: Record<string, unknown>;
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

  try {
    const response = await fetch(POE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.aspect 
          ? options.messages.map(msg => ({
              ...msg,
              ...(msg.role === "user" && { parameters: { aspect_ratio: options.aspect } }),
            }))
          : options.messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {
        errorText = `HTTP ${response.status} ${response.statusText}`;
      }
      throw new Error(`Poe API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from Poe API");
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
        // Skip empty lines
        if (!line.trim()) continue;
        
        // Handle SSE format: "data: {...}" or "data: [DONE]"
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          
          // End of stream marker
          if (data === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            
            // Handle OpenAI-compatible format
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
            
            // Check for errors in the response
            if (parsed.error) {
              throw new Error(`Poe API error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
            }
          } catch (parseError) {
            // If it's not valid JSON, it might be an error message
            if (data && !data.startsWith("{")) {
              console.warn("Non-JSON data received:", data);
            }
            // Continue processing other lines
          }
        } else if (line.trim()) {
          // Some APIs send data without "data: " prefix
          try {
            const parsed = JSON.parse(line);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unknown error in Poe API stream: ${String(error)}`);
  }
}

export async function generateChatCompletion(
  options: ChatCompletionOptions
): Promise<string> {
  const apiKey = (process.env.POE_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("POE_API_KEY not configured");
  }

  try {
    const response = await fetch(POE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.aspect 
          ? options.messages.map(msg => ({
              ...msg,
              ...(msg.role === "user" && { parameters: { aspect_ratio: options.aspect } }),
            }))
          : options.messages,
        stream: false,
        temperature: options.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {
        errorText = `HTTP ${response.status} ${response.statusText}`;
      }
      throw new Error(`Poe API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Check for errors in response
    if (data.error) {
      throw new Error(`Poe API error: ${data.error.message || JSON.stringify(data.error)}`);
    }
    
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("No content in Poe API response");
    }
    
    return content;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unknown error in Poe API: ${String(error)}`);
  }
}

// Image generation using nano-banana-pro
export async function generateImageViaPoe(
  subject: string,
  accentHue: string,
  aspect: string = "16:9"
): Promise<string> {
  // Include aspect ratio in prompt as well, in case parameters aren't supported
  const prompt = `Subject: ${subject}
Accent Hue: ${accentHue}
Aspect Ratio: ${aspect}

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
- "Rubber hose" style simplified anatomy.
- Aspect ratio: ${aspect}`;

  try {
    console.log(`Generating image via Poe: subject="${subject}", aspect="${aspect}"`);
    
    const content = await generateChatCompletion({
      model: POE_MODELS.NANO_BANANA,
      messages: [{ role: "user", content: prompt }],
      aspect, // Also pass as parameter for API support
      temperature: 0.7,
    });

    console.log(`Poe image generation response received (${content.length} chars)`);

    // Extract image URL from markdown or direct URL
    // Try multiple patterns to catch different response formats
    const urlMatch =
      content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/) ??
      content.match(/https?:\/\/[^\s)"']+\.(png|jpg|jpeg|webp|gif)/i) ??
      content.match(/(https?:\/\/[^\s<"]+)/i);
    
    const url = urlMatch ? (urlMatch[1] ?? urlMatch[0]) : null;

    if (!url || !url.startsWith("http")) {
      console.error("No valid image URL found in Poe response:", content.substring(0, 500));
      throw new Error(`No image URL in Poe response. Response preview: ${content.substring(0, 200)}...`);
    }

    console.log(`Successfully extracted image URL: ${url.substring(0, 50)}...`);
    return url;
  } catch (error) {
    console.error("Image generation error:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to generate image via Poe: ${error.message}`);
    }
    throw new Error(`Failed to generate image via Poe: ${String(error)}`);
  }
}

// Delay utility for rate limiting
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
