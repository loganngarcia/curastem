import { NextRequest, NextResponse } from "next/server";
import { generateImageViaPoe } from "@/lib/poe";
import { uploadImageToFramer } from "@/lib/framer";
import { getRandomAccentColor } from "@/lib/blog-generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subject, aspect = "16:9" } = body;

    if (!subject) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    console.log(`Generating image for subject: ${subject}`);
    
    // Generate image via Poe
    const accentHue = getRandomAccentColor();
    const poeUrl = await generateImageViaPoe(subject, accentHue, aspect);
    
    // Upload to Framer
    console.log("Uploading generated image to Framer...");
    const framerUrl = await uploadImageToFramer(poeUrl);
    
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
