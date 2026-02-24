import { NextRequest, NextResponse } from "next/server";
import { streamChatCompletion, POE_MODELS } from "@/lib/poe";

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const systemPrompt = `You are the Curastem Internal Blog Tool AI.
Your goal is to help the user create and edit blog posts for the Curastem website.

Curastem Brand Voice:
- Professional, supportive, and direct.
- Focus on practical career and education guidance.
- No DEI buzzwords like "equity" or "inclusion".
- Use simple, clear language.

Formatting Rules:
- Use H3 for paragraph headers.
- Use H2 for short quote-like statements (e.g., "When people feel supported, they graduate.").
- Never use the characters — (em dash), : (colon), or ; (semicolon).
- Ensure one single space before and after H2 headings.
- Blog posts should be detailed and research-backed (roughly 800-1200 words).

Available Tools:
1. create_blog(title: string) - Use this when the user wants to create a new blog post.
2. list_blogs() - Use this to show the user the existing blog posts.
3. edit_blog(slug: string, changes: string) - Use this when the user wants to modify an existing blog.

When the user wants to CREATE a blog:
1. Confirm the title.
2. If confirmed, output the special command: [TOOL:create_blog{"title":"TITLE_HERE"}]
3. Then continue to generate the content in the chat so they can preview it.

When the user wants to LIST blogs:
1. Output the special command: [TOOL:list_blogs{}]

Respond in a helpful, conversational manner. If you use a tool, include the [TOOL:...] command in your response.`;

    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    // Start the stream completion to catch initial errors
    const stream = streamChatCompletion({
      model: POE_MODELS.GEMINI_3_FLASH,
      messages: fullMessages,
    });

    // Create a readable stream from the generator
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(chunk));
            // Force a small delay to ensure chunks are processed individually if needed
            // await new Promise(resolve => setTimeout(resolve, 10));
          }
          controller.close();
        } catch (e) {
          console.error("Stream error:", e);
          // We can't change the status code here as it's already sent
          // But we can send an error message in the stream
          const errorMsg = e instanceof Error ? e.message : String(e);
          controller.enqueue(encoder.encode(`\n\n[ERROR: ${errorMsg}]`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes("POE_API_KEY")) {
      return NextResponse.json(
        { error: "Poe API key not configured. Please add POE_API_KEY to environment variables." },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: `Chat error: ${errorMessage}` },
      { status: 500 }
    );
  }
}
