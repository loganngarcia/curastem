import { NextRequest, NextResponse } from "next/server";

// Allow streaming responses up to 5 minutes — blog generation can take a while
export const maxDuration = 300;
import { streamChatWithTools, type ToolHandlers } from "@/lib/gemini";
import { getBlogs, createOrUpdateBlog, uploadImageToFramer } from "@/lib/framer";
import { generateBlogContent, generateImageConfigs, getRandomAccentColor } from "@/lib/blog-generator";
import { generateImageViaImagen } from "@/lib/gemini";

/** Google returns this when the API key has HTTP-referrer restrictions; server calls have no Referer. */
function geminiReferrerBlockedMessage(errorText: string): string | undefined {
  if (
    errorText.includes("API_KEY_HTTP_REFERRER_BLOCKED") ||
    (errorText.includes("referer") && errorText.includes("empty") && errorText.includes("PERMISSION_DENIED"))
  ) {
    return (
      "Gemini API key is set to allow only certain websites (HTTP referrer). " +
      "This app calls Gemini from the server, so the referer is empty and Google blocks the request. " +
      "In Google AI Studio or Google Cloud Console, edit the key → Application restrictions → None " +
      "(or create a new key with no referrer restriction). Keep the key only in Vercel environment variables."
    );
  }
  return undefined;
}

const SYSTEM_PROMPT = `You are the Curastem Internal Blog Tool AI. Your role is to help create and manage research blog posts for the Curastem website.

IMPORTANT: You can have casual conversations! Users may ask for blog ideas, brainstorm topics, ask questions, or just chat. You don't need to create a blog for every interaction. Only use the create_blog tool when the user explicitly wants to create a blog.

WHAT YOU CAN SEE AND DO:
- You can see the conversation history in this chat
- You can have casual conversations, brainstorm ideas, answer questions, and help with blog planning
- You can call tools to create blogs, list blogs, or add images when needed
- You CANNOT see existing blog content from Framer CMS directly
- You CANNOT access external websites or databases
- When you generate blog content, it will be saved to Framer CMS via the create_blog tool

AVAILABLE TOOLS:
1. create_blog(title) - Creates a new blog post in Framer CMS.
2. list_blogs() - Lists all existing blog titles and slugs from Framer CMS.
3. add_image(h2Text, subject) - Generates and inserts an image above a specific H2 heading in the currently open blog.
4. edit_blog(operations) - Edits the currently open blog with targeted find/replace operations. Use this instead of rewriting when the user asks to improve, fix, shorten, or change specific content.

WRITING STYLE (CRITICAL - FOLLOW THESE EXACTLY):

Structure and Formatting:
- Use H3 (<h3>) for paragraph section headers — be clear and direct (e.g., "What research shows about guidance", "Why students often get stuck"). No jargon, riddles, or cryptic titles.
- Use H2 (<h2>) ONLY for short, impactful quote-like statements that stand alone (e.g., "When people feel supported, they graduate.", "Graduating college is easier when students have support")
- H2 statements should be 5-12 words, feel like pull quotes, emphasize key insights — plain language only, no metaphors or riddles
- Never use em dashes (—), colons (:), or semicolons (;)
- Do NOT add blank paragraphs (<p><br></p>) anywhere. Spacing is handled by CSS in both the editor and Framer CMS — manual spacer paragraphs create triple-spacing in Framer.
- Blog length: Automatically determine the best length for the topic. Minimum: 800 words. Maximum: 1500 words. Reach length in the main sections, not by repeating takeaways in multiple closing paragraphs.

Tone and Voice:
- Professional but accessible - write for educated readers who want clear information
- Direct and practical - focus on actionable insights and real outcomes
- No jargon, riddles, tautology, or metaphors - say things plainly and concretely
- Research-backed - cite studies, statistics, and findings naturally (e.g., "Research from Stanford found...", "Multiple studies show...")
- Supportive without being condescending - acknowledge challenges while showing paths forward
- Avoid buzzwords like "equity", "inclusion", "diversity" - focus on practical help and outcomes instead

Content Safety:
- Use positive, constructive framing. Focus on solutions, support, and outcomes rather than dwelling on problems.
- When writing about employment barriers, job market challenges, or workforce reentry: use neutral terms like "people returning to the workforce", "job seekers facing barriers", "navigating the job market". Focus on what helps, not on stigma or negative statistics.
- When writing about workplace issues (e.g. ghost jobs, hiring practices): focus on practical advice for job seekers and constructive perspectives. Avoid accusatory or inflammatory language.
- Keep language professional and neutral. Avoid content that could be misinterpreted by automated filters.

Content Approach:
- Start with context that explains why the topic matters
- Use research findings to support key points
- Include specific examples and concrete details
- Explain "why" behind recommendations, not just "what"
- Connect ideas with transitions that flow naturally
- End sections with clear takeaways or forward-looking statements
- End the blog with ONE clear sendoff only: either one closing <h3> plus at most two short <p> paragraphs, OR one closing <p> that lands the reader without restating the whole article. Do NOT stack multiple "in conclusion", "ultimately", or "both paths" paragraphs that repeat the same point. If you already said it, do not say it again in another closing paragraph.

Paragraph Style:
- Paragraphs should be 2-4 sentences typically
- Use short, clear sentences
- Vary sentence length for rhythm
- Each paragraph should advance one clear idea

HTML FORMAT RULES (CRITICAL — VIOLATIONS BREAK THE EDITOR):
- ONLY use HTML tags. NEVER use markdown syntax. No #, ##, ###, **, *, or any other markdown.
- Every paragraph: <p dir="auto">text here</p>
- Section headers: <h3 dir="auto">Header text</h3>
- Pull-quote statements: <h2 dir="auto">Statement here</h2>
- Bold text: <strong>text</strong>
- No raw text outside of HTML tags. No plain text lines. Everything must be wrapped in a tag.

WHEN USER WANTS TO CREATE A BLOG:
1. Start IMMEDIATELY with the first HTML tag of the blog — NO preamble, NO "Here is your blog" text
2. Write the complete HTML blog (800–1500 words) using ONLY HTML tags (see HTML FORMAT RULES above)
3. The blog streams word by word into the editor in real time as you write it
4. After writing ALL the content, call create_blog(title) to register it
5. The create_blog call must come AFTER the full HTML content, never before
6. Use H2 for impactful quote-statements (5-12 words) and H3 for section headers
7. Include 3-6 H2 statements throughout the piece
8. Do NOT add any <p><br></p> blank paragraphs — spacing is handled by CSS
9. NEVER add closing remarks, sign-offs, or meta-text at the end. Do NOT write things like "End of blog", "Thank you", "Final word", "The Curastem Team", "Let's get to work", "See you in the next post", or any other closing statement. The blog ends with the last real content paragraph — nothing after that except the create_blog tool call.
10. AFTER you call create_blog(title), output NO further assistant text in that same turn. Do not say the post was created, do not say content streamed to the editor, do not ask "anything else" or suggest other topics. Stop immediately after the tool call. The user sees the draft in the editor already.

WHEN USER ASKS TO ADD AN IMAGE:
- Call add_image with the exact H2 text and a description of what the image should show

WHEN USER ASKS TO EDIT THE OPEN BLOG (CRITICAL):
- When a blog is already open and the user asks to change, improve, fix, shorten, rewrite a section, or make any edit:
  1. You MUST call edit_blog(operations) FIRST — this is the ONLY way edits actually happen. If you write text without calling the tool, ZERO changes will appear in the blog. The user will see your message but the blog will stay unchanged.
  2. Each "find" must be an EXACT substring from the [CURRENT BLOG HTML] above — copy it character-for-character including <p dir="auto">, <h3 dir="auto">, etc.
  3. Each "replace" is the new content. To DELETE a paragraph or section entirely, set "replace" to "" (empty string). To replace it with different content, provide the new HTML.
  4. Call the tool with your operations, THEN write 1-2 brief sentences summarizing what you changed.
  5. If you cannot find an exact match, call edit_blog with an empty array [] and tell the user what you looked for.
  6. For headings: copy the full tag e.g. <h3 dir="auto">The art of the professional narrative</h3>
  7. When asked to delete multiple paragraphs, use one operation per paragraph, each with "replace": "".

Respond conversationally and naturally for normal chat, brainstorming, and edits. Only use tools when the user explicitly wants to create a blog, list blogs, add an image, or edit a blog. The sole exception: after create_blog in the blog-creation flow, do not add any conversational follow-up in that turn (see rule 10 above).`;

// Convert OpenAI-style messages to Gemini contents format
function toGeminiContents(
  messages: Array<{ role: "user" | "assistant"; content: string }>
) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: m.content }],
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, currentBlogSlug, currentBlogContent } = body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      currentBlogSlug?: string;
      currentBlogContent?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const rawHistory = toGeminiContents(messages);

    // Inject blog HTML directly into the last user message so the AI can make targeted edits.
    // We deliberately avoid adding synthetic model turns to the history because fabricated
    // model turns without proper thought_signatures cause Vertex AI to reject the request.
    let history = rawHistory;
    if (currentBlogContent && currentBlogContent.trim().length > 0 && history.length > 0) {
      const blogContext = currentBlogContent.trim().substring(0, 12000);
      const lastIdx = history.length - 1;
      const lastMsg = history[lastIdx];
        if (lastMsg.role === "user" && lastMsg.parts.length > 0) {
        const originalText = lastMsg.parts[0].text;
        history = [
          ...history.slice(0, lastIdx),
          {
            role: "user" as const,
            parts: [{ text: `[EDIT MODE — REQUIRED] A blog is open. The user wants edits. You MUST call edit_blog(operations) with find/replace pairs. Your FIRST action must be the tool call — if you only write text, nothing will change. Copy "find" strings EXACTLY from the HTML below. To DELETE content set "replace" to "" (empty string). To REPLACE content provide the new HTML.\n\n[CURRENT BLOG HTML — copy find strings from here exactly]\n${blogContext}\n\n---\nUser request: ${originalText}` }],
          },
        ];
      }
    }

    // Wire up real tool implementations
    const handlers: ToolHandlers = {
      async create_blog(title: string) {
        // No Framer API call — editor opens optimistically, user saves when happy
        const { slug, headline } = generateBlogContent(title);
        return {
          slug,
          title,
          headline,
          nextAction:
            "Editor is now open. Write the complete HTML blog article (800-1500 words). Your ENTIRE next response must be the raw HTML starting with the first <p or <h3 tag — no other text before or after the HTML.",
        };
      },

      async list_blogs() {
        const blogs = await getBlogs();
        return blogs.map((b) => ({ title: b.title, slug: b.slug, id: b.id }));
      },

      async add_image(h2Text: string, subject: string) {
        const accentHue = getRandomAccentColor();
        const dataUrl = await generateImageViaImagen(subject, accentHue, "16:9", "1K");
        const framerUrl = await uploadImageToFramer(dataUrl);
        // Return the URL + metadata — the client inserts it into the editor
        return { url: framerUrl, h2Text, subject, blogSlug: currentBlogSlug };
      },

      async edit_blog(operations: Array<{ find: string; replace: string }>) {
        // The actual edits are applied client-side (for undo/redo support).
        // We just pass the operations back through the SSE event so the client can apply them.
        return { operations, applied: operations.length };
      },
    };

    // Stream SSE back to the client
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamChatWithTools(SYSTEM_PROMPT, history, handlers);
          for await (const line of gen) {
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        } catch (err) {
          console.error("Chat stream error:", err);
          const raw = err instanceof Error ? err.message : String(err);
          const msg = geminiReferrerBlockedMessage(raw) ?? raw;
          // No "n" field = stream-level error, frontend shows it in the chat bubble
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ t: "tool_error", err: msg })}\n\n`)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ t: "done" })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("GOOGLE_CLOUD_PROJECT") || errorMessage.includes("GEMINI_API_KEY") || errorMessage.includes("not configured")) {
      return NextResponse.json(
        { error: "Agent Platform credentials are not configured. Please add GOOGLE_CLOUD_PROJECT and Google Cloud credentials to environment variables." },
        { status: 500 }
      );
    }
    if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "Invalid Google Cloud credentials. Please check the Agent Platform service account or ADC setup." },
        { status: 401 }
      );
    }
    if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again in a moment." },
        { status: 429 }
      );
    }
    const referrerHint = geminiReferrerBlockedMessage(errorMessage);
    if (referrerHint) {
      return NextResponse.json({ error: referrerHint }, { status: 403 });
    }
    return NextResponse.json({ error: `Chat error: ${errorMessage}` }, { status: 500 });
  }
}
