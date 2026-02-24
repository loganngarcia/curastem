import { NextRequest, NextResponse } from "next/server";
import { getBlogs } from "@/lib/framer";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    // Get all blogs to extract images
    const blogs = await getBlogs();
    
    const images: Array<{ url: string; alt: string; source: string }> = [];

    // Add cover images and blog list images from all blogs
    blogs.forEach((blog) => {
      if (blog.coverImageUrl) {
        images.push({
          url: blog.coverImageUrl,
          alt: blog.title || "Blog cover image",
          source: `Cover: ${blog.title || blog.slug}`,
        });
      }
      if (blog.blogListImageUrl && blog.blogListImageUrl !== blog.coverImageUrl) {
        images.push({
          url: blog.blogListImageUrl,
          alt: blog.title || "Blog list image",
          source: `List: ${blog.title || blog.slug}`,
        });
      }
    });

    // If slug is provided, also extract images from that blog's content
    if (slug) {
      const blog = blogs.find((b) => b.slug === slug);
      if (blog && blog.content) {
        // Extract image URLs from HTML content
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = imgRegex.exec(blog.content)) !== null) {
          const imgUrl = match[1];
          // Avoid duplicates
          if (!images.some((img) => img.url === imgUrl)) {
            images.push({
              url: imgUrl,
              alt: `Image from ${blog.title || blog.slug}`,
              source: `Content: ${blog.title || blog.slug}`,
            });
          }
        }
      }
    }

    return NextResponse.json({ images });
  } catch (error) {
    console.error("Failed to fetch CMS images:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to fetch images: ${errorMessage}` },
      { status: 500 }
    );
  }
}
