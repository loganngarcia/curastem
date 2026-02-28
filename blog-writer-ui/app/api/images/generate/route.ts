import { NextRequest, NextResponse } from "next/server";
import { generateImageViaImagen, editImageViaGemini } from "@/lib/gemini";
import { uploadImageToFramer } from "@/lib/framer";
import { getRandomAccentColor } from "@/lib/blog-generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subject, aspect = "16:9", imageSize = "1K", existingImageUrl } = body;

    if (!subject) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    const accentHue = getRandomAccentColor();
    let dataUrl: string;

    if (existingImageUrl) {
      // Image editing mode: take existing image + edit prompt → new image
      console.log(`Editing image with prompt: "${subject}" at ${imageSize}`);
      try {
        dataUrl = await editImageViaGemini(existingImageUrl, subject, accentHue, aspect, imageSize);
      } catch (editErr) {
        // Fallback to text-to-image if editing fails (e.g. model doesn't support image input)
        console.warn("Image edit failed, falling back to text-to-image:", editErr);
        dataUrl = await generateImageViaImagen(subject, accentHue, aspect, imageSize);
      }
    } else {
      console.log(`Generating image for subject: ${subject} at ${imageSize}`);
      dataUrl = await generateImageViaImagen(subject, accentHue, aspect, imageSize);
    }

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
