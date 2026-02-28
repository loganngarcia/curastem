/**
 * Export utilities for BlogEditor — PDF (print) and DOCX with embedded images.
 */

/** Convert image URL to data URL for PDF print. Fetches and draws to canvas to avoid CORS. */
export async function imageUrlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        try {
          resolve(canvas.toDataURL("image/png"));
        } catch {
          reject(new Error("toDataURL failed"));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error("Image load failed"));
      };
      img.src = URL.createObjectURL(blob);
    });
  } catch {
    return url; // fallback to original; may not print if cross-origin
  }
}

/** Inline all img src to data URLs in HTML for reliable PDF print. */
export async function htmlWithInlineImages(html: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const imgs = doc.querySelectorAll("img[src]");
  for (const img of imgs) {
    const src = img.getAttribute("src");
    if (!src) continue;
    try {
      const dataUrl = await imageUrlToDataUrl(src);
      img.setAttribute("src", dataUrl);
    } catch {
      // leave as-is
    }
  }
  return doc.body.innerHTML;
}

/** Fetch image as ArrayBuffer + type for DOCX. */
export async function fetchImageAsBuffer(url: string): Promise<{ buffer: ArrayBuffer; type: "png" | "jpg" | "gif"; width: number; height: number } | null> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buffer = bytes.buffer;
    const dimensions = await getImageDimensions(buffer, mime);
    const type = (mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("gif") ? "gif" : "png") as "png" | "jpg" | "gif";
    return { buffer, type, width: dimensions.width, height: dimensions.height };
  }
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const mime = blob.type || "image/png";
    const dimensions = await getImageDimensions(buffer, mime);
    const type = (mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("gif") ? "gif" : "png") as "png" | "jpg" | "gif";
    return { buffer, type, width: dimensions.width, height: dimensions.height };
  } catch {
    return null;
  }
}

function getImageDimensions(buffer: ArrayBuffer, mime: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 400, height: 300 }); // fallback
    };
    img.src = url;
  });
}
