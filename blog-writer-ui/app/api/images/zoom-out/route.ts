import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadImageToFramer } from "@/lib/framer";

const EXPAND_RATIO = 0.25; // 25% size increase (12.5% left/right, 25% top)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const imageUrl = body?.imageUrl as string;

    if (!imageUrl || typeof imageUrl !== "string") {
      return NextResponse.json(
        { error: "imageUrl is required" },
        { status: 400 }
      );
    }

    let inputBuffer: Buffer;

    if (imageUrl.startsWith("data:")) {
      const base64 = imageUrl.split(",")[1];
      if (!base64) {
        return NextResponse.json({ error: "Invalid data URL" }, { status: 400 });
      }
      inputBuffer = Buffer.from(base64, "base64");
    } else if (
      imageUrl.startsWith("http://") ||
      imageUrl.startsWith("https://")
    ) {
      const res = await fetch(imageUrl);
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image: ${res.status}` },
          { status: 400 }
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      inputBuffer = Buffer.from(arrayBuffer);
    } else {
      return NextResponse.json(
        { error: "imageUrl must be a data URL or http(s) URL" },
        { status: 400 }
      );
    }

    let pipeline = sharp(inputBuffer);
    const meta = await pipeline.metadata();
    let width = meta.width ?? 0;
    let height = meta.height ?? 0;

    if (!width || !height || typeof width !== "number" || typeof height !== "number") {
      return NextResponse.json(
        { error: "Could not determine image dimensions" },
        { status: 400 }
      );
    }

    const MAX_DIM = 2400;
    if (width > MAX_DIM || height > MAX_DIM) {
      const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      inputBuffer = await pipeline.resize(width, height).png().toBuffer();
      pipeline = sharp(inputBuffer);
    }

    const { dominant } = await sharp(inputBuffer).stats();
    const { r, g, b } = dominant;

    const top = Math.round(height * EXPAND_RATIO);
    const leftRight = Math.round(width * (EXPAND_RATIO / 2));
    const bottom = 0;

    const outputBuffer = await sharp(inputBuffer)
      .extend({
        top,
        bottom,
        left: leftRight,
        right: leftRight,
        background: { r, g, b, alpha: 1 },
      })
      .png()
      .toBuffer();

    const dataUrl = `data:image/png;base64,${outputBuffer.toString("base64")}`;
    const framerUrl = await uploadImageToFramer(dataUrl);

    return NextResponse.json({ zoomOutUrl: framerUrl });
  } catch (error) {
    console.error("[zoom-out] Error:", error);
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Zoom-out failed: ${message}` },
      { status: 500 }
    );
  }
}
