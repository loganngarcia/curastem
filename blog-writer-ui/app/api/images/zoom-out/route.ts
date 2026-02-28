import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadImageToFramer } from "@/lib/framer";

const EXPAND_RATIO = 0.35; // 35% size increase (17.5% left/right, 35% top)

/** Sample dominant color from image edges (where fill will be adjacent) for better match */
async function getEdgeDominantColor(
  imgBuffer: Buffer,
  width: number,
  height: number
): Promise<{ r: number; g: number; b: number }> {
  const edgePct = 0.08; // sample 8% of image from each edge
  const topRows = Math.max(2, Math.min(Math.round(height * edgePct), height));
  const sideCols = Math.max(2, Math.min(Math.round(width * edgePct), width));

  const regions = [
    { left: 0, top: 0, width, height: topRows }, // top edge
    { left: 0, top: 0, width: sideCols, height }, // left edge
    { left: Math.max(0, width - sideCols), top: 0, width: Math.min(sideCols, width), height }, // right edge
  ];

  const colors: Array<{ r: number; g: number; b: number }> = [];
  for (const region of regions) {
    const cropped = await sharp(imgBuffer).extract(region).toBuffer();
    const stats = await sharp(cropped).stats();
    if (stats.dominant) {
      colors.push(stats.dominant);
    }
  }

  if (colors.length === 0) {
    const stats = await sharp(imgBuffer).stats();
    return stats.dominant ?? { r: 245, g: 245, b: 245 };
  }

  const r = Math.round(colors.reduce((s, c) => s + c.r, 0) / colors.length);
  const g = Math.round(colors.reduce((s, c) => s + c.g, 0) / colors.length);
  const b = Math.round(colors.reduce((s, c) => s + c.b, 0) / colors.length);
  return { r, g, b };
}

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

    const { r, g, b } = await getEdgeDominantColor(inputBuffer, width, height);

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
