import { NextRequest, NextResponse } from "next/server";
import { uploadImageToFramer } from "@/lib/framer";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const imageUrl = formData.get("imageUrl") as string | null;

    if (!file && !imageUrl) {
      return NextResponse.json(
        { error: "Either file or imageUrl is required" },
        { status: 400 }
      );
    }

    let urlToUpload: string;

    if (imageUrl) {
      // If imageUrl is provided, use it directly
      urlToUpload = imageUrl;
    } else if (file) {
      // Convert file to data URL or blob URL
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      const mimeType = file.type || "image/png";
      urlToUpload = `data:${mimeType};base64,${base64}`;
    } else {
      return NextResponse.json(
        { error: "No file or image URL provided" },
        { status: 400 }
      );
    }

    console.log("Uploading image to Framer CMS...");
    const framerUrl = await uploadImageToFramer(urlToUpload);
    console.log("Image uploaded successfully:", framerUrl);

    return NextResponse.json({ url: framerUrl });
  } catch (error) {
    console.error("Failed to upload image:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to upload image: ${errorMessage}` },
      { status: 500 }
    );
  }
}
