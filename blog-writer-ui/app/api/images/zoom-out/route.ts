import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadImageToFramer } from "@/lib/framer";

// 30% size increase: adds 30% of the original height to the top,
// and 15% to each side, keeping the original aspect ratio.
const EXPAND_RATIO = 0.30;

/**
 * Compute the mean RGB color of the outermost pixel strip on each edge.
 * Sampling raw pixels and averaging gives a much more accurate fill color
 * than sharp's dominant-color bucket — especially for gradient backgrounds.
 *
 * The top strip is weighted 2× since that's where most expansion is added.
 */
async function getEdgeMeanColor(
  imgBuffer: Buffer,
  width: number,
  height: number
): Promise<{ r: number; g: number; b: number }> {
  // Sample a thin strip — 3px or 1% of the shorter dimension, whichever is larger
  const stripPx = Math.max(3, Math.round(Math.min(width, height) * 0.01));

  const strips = [
    // top — 2× weight because we expand most from there
    { left: 0, top: 0,                          width,      height: Math.min(stripPx, height) },
    { left: 0, top: 0,                          width,      height: Math.min(stripPx, height) },
    // left
    { left: 0, top: 0,                          width: Math.min(stripPx, width), height },
    // right
    { left: Math.max(0, width - stripPx), top: 0, width: Math.min(stripPx, width), height },
  ];

  let rSum = 0, gSum = 0, bSum = 0, totalCount = 0;

  for (const region of strips) {
    try {
      const { data, info } = await sharp(imgBuffer)
        .extract(region)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels; // 4 (RGBA)
      for (let i = 0; i < data.length; i += channels) {
        const alpha = data[i + 3] ?? 255;
        if (alpha < 10) continue; // skip fully transparent pixels
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        totalCount++;
      }
    } catch {
      // skip a strip if it fails (e.g. tiny image edge case)
    }
  }

  if (totalCount === 0) {
    // Fallback: mean of the whole image
    const stats = await sharp(imgBuffer).stats();
    return {
      r: Math.round(stats.channels[0].mean),
      g: Math.round(stats.channels[1].mean),
      b: Math.round(stats.channels[2].mean),
    };
  }

  return {
    r: Math.round(rSum / totalCount),
    g: Math.round(gSum / totalCount),
    b: Math.round(bSum / totalCount),
  };
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

    const { r, g, b } = await getEdgeMeanColor(inputBuffer, width, height);

    // Distribute padding: all expansion on top (keeps subject visible), equal left/right
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
