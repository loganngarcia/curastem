import { NextRequest, NextResponse } from "next/server";
import {
  getBlog,
  createOrUpdateBlog,
  deleteBlog,
} from "@/lib/framer";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const blog = await getBlog(slug);
    if (!blog) {
      return NextResponse.json(
        { error: "Blog not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(blog);
  } catch (error) {
    console.error("Failed to fetch blog:", error);
    return NextResponse.json(
      { error: "Failed to fetch blog" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    console.log(`[PUT /api/blogs/${slug}] Updating blog with data:`, {
      slug,
      hasContent: !!body.content,
      hasTitle: !!body.title,
      hasDate: !!body.date,
      hasCoverImage: !!body.coverImageUrl,
      contentLength: body.content?.length || 0,
    });
    
    const blog = await createOrUpdateBlog({
      ...body,
      slug,
    });
    
    console.log(`[PUT /api/blogs/${slug}] Successfully updated blog:`, {
      id: blog.id,
      title: blog.title,
      contentLength: blog.content?.length || 0,
    });
    
    return NextResponse.json(blog);
  } catch (error) {
    const { slug: errorSlug } = await params;
    console.error(`[PUT /api/blogs/${errorSlug}] Failed to update blog:`, error);
    
    // Log full error details
    if (error instanceof Error) {
      console.error(`[PUT /api/blogs/${errorSlug}] Error message:`, error.message);
      console.error(`[PUT /api/blogs/${errorSlug}] Error stack:`, error.stack);
      console.error(`[PUT /api/blogs/${errorSlug}] Error name:`, error.name);
    } else {
      console.error(`[PUT /api/blogs/${errorSlug}] Error (non-Error):`, JSON.stringify(error));
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { 
        error: "Failed to update blog", 
        message: errorMessage,
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    await deleteBlog(slug);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete blog:", error);
    return NextResponse.json(
      { error: "Failed to delete blog" },
      { status: 500 }
    );
  }
}
