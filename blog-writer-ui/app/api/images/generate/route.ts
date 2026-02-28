import { NextRequest, NextResponse } from "next/server";
import { generateImageViaImagen } from "@/lib/gemini";
import { uploadImageToFramer } from "@/lib/framer";
import { getRandomAccentColor } from "@/lib/blog-generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subject, aspect = "16:9", imageSize = "1K" } = body;

    if (!subject) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    console.log(`Generating image for subject: ${subject} at ${imageSize}`);

    // Generate image via Nano Banana 2 — returns a base64 data URL
    const accentHue = getRandomAccentColor();
    const dataUrl = await generateImageViaImagen(subject, accentHue, aspect, imageSize);

    // Upload base64 data URL to Framer
    console.log("Uploading generated image to Framer...");
    const framerUrl = await uploadImageToFramer(dataUrl);

    console.log("Image generated and uploaded successfully:", framerUrl);
    return NextResponse.json({ url: framerUrl });
  } catch (error) {
    console.error("Failed to generate image:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to generate image: ${errorMessage}` },
      { status: 500 }
    );
  }
}
