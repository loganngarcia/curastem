import { NextRequest, NextResponse } from "next/server";

// Allow streaming responses up to 5 minutes — blog generation can take a while
export const maxDuration = 300;
import { streamChatWithTools, type ToolHandlers } from "@/lib/gemini";
import { getBlogs, createOrUpdateBlog, uploadImageToFramer } from "@/lib/framer";
import { generateBlogContent, generateImageConfigs, getRandomAccentColor } from "@/lib/blog-generator";
import { generateImageViaImagen } from "@/lib/gemini";

const SYSTEM_PROMPT = `You are the Curastem Internal Blog Tool AI. Your role is to help create and edit research blog posts for the Curastem website.

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

WRITING STYLE (CRITICAL - FOLLOW THESE EXACTLY):

Structure and Formatting:
- Use H3 (<h3>) for paragraph section headers (e.g., "What research shows about guidance", "Why students often get stuck")
- Use H2 (<h2>) ONLY for short, impactful quote-like statements that stand alone (e.g., "When people feel supported, they graduate.", "Graduating college is easier when students have support")
- H2 statements should be 5-12 words, feel like pull quotes, and emphasize key insights
- Never use em dashes (—), colons (:), or semicolons (;)
- CRITICAL: Add exactly ONE blank paragraph (<p><br></p>) immediately before every H2 and ONE immediately after every H2. Do NOT add blank paragraphs before or after H3 headings.
- Blog length: Automatically determine the best length for the topic. Minimum: 800 words. Maximum: 1500 words.

Tone and Voice:
- Professional but accessible - write for educated readers who want clear information
- Direct and practical - focus on actionable insights and real outcomes
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
8. Add exactly ONE <p><br></p> before and after every H2 — no blank paragraphs around H3

WHEN USER ASKS TO ADD AN IMAGE:
- Call add_image with the exact H2 text and a description of what the image should show

Respond conversationally and naturally. Help with ideas, questions, or casual chat. Only use tools when the user explicitly wants to create a blog, list blogs, or add an image.`;

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
    const { messages, currentBlogSlug } = body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      currentBlogSlug?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const history = toGeminiContents(messages);

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
          const msg = err instanceof Error ? err.message : String(err);
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

    if (errorMessage.includes("GEMINI_API_KEY") || errorMessage.includes("not configured")) {
      return NextResponse.json(
        { error: "Gemini API key not configured. Please add GEMINI_API_KEY to environment variables." },
        { status: 500 }
      );
    }
    if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "Invalid Gemini API key. Please check your GEMINI_API_KEY in settings." },
        { status: 401 }
      );
    }
    if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again in a moment." },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: `Chat error: ${errorMessage}` }, { status: 500 });
  }
}
