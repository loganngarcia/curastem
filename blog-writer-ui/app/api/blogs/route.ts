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
import { generateImageViaPoe, delay } from "@/lib/poe";

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

    if (action === "create") {
      // 1. Generate content
      const blogContent = generateBlogContent(title);
      const imageConfigs = generateImageConfigs(title);

      // 2. Create initial blog item in Framer
      let blog = await createOrUpdateBlog({
        slug: blogContent.slug,
        title: blogContent.title,
        headline: blogContent.headline,
        content: blogContent.content,
        date: new Date().toISOString(),
        featured: false,
      });

      // 3. Generate and upload images in parallel to save time
      console.log(`Generating ${imageConfigs.length} images for ${blog.slug}...`);
      
      const imagePromises = imageConfigs.map(async (cfg, i) => {
        // Add a small staggered delay to avoid hitting Poe API all at once
        await delay(i * 2000); 
        
        try {
          console.log(`Generating image ${i + 1}/${imageConfigs.length}: ${cfg.subject}`);
          const poeUrl = await generateImageViaPoe(cfg.subject, cfg.accentHue, cfg.aspect);
          console.log(`Image ${i + 1} generated, uploading to Framer...`);
          const framerUrl = await uploadImageToFramer(poeUrl);
          console.log(`Image ${i + 1} uploaded successfully`);
          return { index: i, url: framerUrl, cfg };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to generate image ${i + 1} (${cfg.subject}):`, errorMsg);
          // Don't fail the entire blog creation if one image fails
          return null;
        }
      });

      const results = await Promise.all(imagePromises);
      const validResults = results.filter(r => r !== null);
      const failedCount = results.length - validResults.length;
      
      if (failedCount > 0) {
        console.warn(`${failedCount} image(s) failed to generate, continuing with ${validResults.length} successful image(s)`);
      }
      
      if (validResults.length === 0) {
        console.warn("No images were generated successfully, blog will be created without images");
      }

      // 4. Update blog with images
      if (validResults.length > 0) {
        const coverResult = validResults.find(r => r!.cfg.type === "cover") || validResults[0];
        const coverUrl = coverResult.url;
        
        let finalContent = blog.content || "";
        
        // Insert inline images
        const inlineResults = validResults.filter(r => r!.cfg.type === "inline");
        
        // Sort by index descending to keep positions stable
        inlineResults.sort((a, b) => b!.index - a!.index);
        
        for (const result of inlineResults) {
          const { url, cfg } = result!;
          if (!url || !cfg.insertBefore) continue;
          
          const escaped = cfg.insertBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const pattern = `(<h2[^>]*>[^<]*${escaped}[^<]*)(</h2>)`;
          const re = new RegExp(pattern, "i");
          
          const imgTag = `<p dir="auto"><img alt="${cfg.subject}" src="${url}"></p><br>`;
          finalContent = finalContent.replace(re, imgTag + "$1$2");
        }

        // Clean up spacing (remove excess <br>)
        finalContent = finalContent.replace(/<br><br><br>+/g, "<br><br>");
        finalContent = finalContent.replace(/<p dir="auto">(<br>)+<\/p>/g, "<br>");

        blog = await createOrUpdateBlog({
          slug: blog.slug,
          content: finalContent,
          coverImageUrl: coverUrl,
          blogListImageUrl: coverUrl,
        });
      }

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
    
    if (errorMessage.includes("Poe") || errorMessage.includes("POE_API_KEY") || errorMessage.includes("image")) {
      if (errorMessage.includes("POE_API_KEY") || errorMessage.includes("not configured")) {
        userMessage = "Poe API key not configured. Please add POE_API_KEY in settings.";
      } else if (errorMessage.includes("No image URL")) {
        userMessage = "Image generation completed but no image URL was returned. The Poe bot may not have generated an image.";
      } else {
        userMessage = `Image generation failed: ${errorMessage}. Please check your Poe API key and try again.`;
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
