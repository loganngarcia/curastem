import { NextRequest, NextResponse } from "next/server";
import {
  getBlogs,
  getBlog,
  createOrUpdateBlog,
  deleteBlog,
  uploadImageToFramer,
} from "@/lib/framer";
import {
  generateBlogContent,
  generateImageConfigs,
} from "@/lib/blog-generator";

export async function GET() {
  try {
    console.log("Fetching blogs from Framer...");
    const blogs = await getBlogs();
    console.log(`Successfully fetched ${blogs.length} blogs`);
    return NextResponse.json(blogs);
  } catch (error) {
    console.error("Failed to fetch blogs:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error details:", errorMessage);
    return NextResponse.json(
      { 
        error: "Failed to fetch blogs",
        details: errorMessage,
        message: errorMessage.includes("credentials") 
          ? "Framer credentials not configured. Please check your settings."
          : errorMessage.includes("Collection")
          ? "Blog collection not found. Please check the collection name in settings."
          : "Unable to connect to Framer. Please check your configuration."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, action } = body;

    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    // Save a brand-new blog with AI-generated content (no template needed)
    if (action === "save") {
      const { slug, headline = "", content = "", date, coverImageUrl, blogListImageUrl } = body;
      if (!slug) {
        return NextResponse.json({ error: "Slug is required for save action" }, { status: 400 });
      }
      const blog = await createOrUpdateBlog({
        slug,
        title,
        headline,
        content,
        date: date || new Date().toISOString(),
        featured: false,
        coverImageUrl,
        blogListImageUrl: blogListImageUrl ?? coverImageUrl,
      });
      return NextResponse.json(blog);
    }

    if (action === "create") {
      // 1. Generate content only (no images)
      const blogContent = generateBlogContent(title);

      // 2. Add grey placeholder images above each H2 (only if no image already exists)
      let contentWithPlaceholders = blogContent.content || "";
      
      // Get image configs to know what prompts to use
      const imageConfigs = generateImageConfigs(title);
      
      // Find all H2 headings and add placeholders above them
      const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gi;
      const h2Matches = Array.from(contentWithPlaceholders.matchAll(h2Regex));
      
      // Process in reverse order to maintain positions
      for (let i = h2Matches.length - 1; i >= 0; i--) {
        const match = h2Matches[i];
        if (!match) continue;
        
        const h2Text = match[1].replace(/<[^>]*>/g, '').trim(); // Extract text, remove HTML tags
        const insertPosition = match.index || 0;
        
        // Check if there's already an image before this H2 (within 200 chars)
        const beforeH2 = contentWithPlaceholders.slice(Math.max(0, insertPosition - 200), insertPosition);
        if (beforeH2.includes('<img') || beforeH2.includes('image-placeholder')) {
          continue; // Skip if image already exists
        }
        
        // Find matching image config for this H2
        const imageConfig = imageConfigs.find(cfg => 
          cfg.insertBefore && h2Text.toLowerCase().includes(cfg.insertBefore.toLowerCase())
        );
        
        // Generate image prompt from H2 text or use config
        const imagePrompt = imageConfig?.subject || `professional illustration representing ${h2Text.toLowerCase()}`;
        
        // Create placeholder using TipTap node format
        // Store the imagePrompt as the alt text that will be used
        const placeholderHtml = `<p class="image-placeholder" data-type="imagePlaceholder" data-h2-text="${h2Text.replace(/"/g, '&quot;')}" data-image-prompt="${imagePrompt.replace(/"/g, '&quot;')}"></p>`;
        
        // Insert placeholder before the H2
        contentWithPlaceholders = 
          contentWithPlaceholders.slice(0, insertPosition) +
          placeholderHtml +
          contentWithPlaceholders.slice(insertPosition);
      }

      // 3. Create blog item in Framer with placeholders
      const blog = await createOrUpdateBlog({
        slug: blogContent.slug,
        title: blogContent.title,
        headline: blogContent.headline,
        content: contentWithPlaceholders,
        date: new Date().toISOString(),
        featured: false,
      });

      return NextResponse.json(blog);
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to create blog:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Provide specific help for common Framer errors
    let userMessage = `Error: ${errorMessage}`;
    const collectionName = (process.env.FRAMER_BLOG_COLLECTION || "Services").trim();
    
    if (errorMessage.includes("Gemini") || errorMessage.includes("GEMINI_API_KEY") || errorMessage.includes("Imagen") || errorMessage.includes("image")) {
      if (errorMessage.includes("GEMINI_API_KEY") || errorMessage.includes("not configured")) {
        userMessage = "Gemini API key not configured. Please add GEMINI_API_KEY in settings.";
      } else if (errorMessage.includes("No image")) {
        userMessage = "Image generation completed but no image was returned. Please try again.";
      } else {
        userMessage = `Image generation failed: ${errorMessage}. Please check your Gemini API key and try again.`;
      }
    } else if (errorMessage.includes("Collection")) {
      userMessage = `Framer collection "${collectionName}" not found. ${errorMessage}`;
    } else if (errorMessage.includes("field")) {
      userMessage = `Framer field error: ${errorMessage}. Ensure your collection has a "Content" field.`;
    }

    return NextResponse.json(
      { 
        error: "Failed to create blog",
        details: errorMessage,
        message: userMessage
      },
      { status: 500 }
    );
  }
}
