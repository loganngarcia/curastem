import { handleAuthPopup } from "../auth/popup.ts";
import {
  handleGeminiProxy,
  handleGeminiToken,
  handleMapsKey,
} from "./handlers.ts";
import type { Env } from "../../shared/types.ts";

export async function handlePlatformRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  // These bootstrap helpers intentionally keep their existing public CORS
  // behavior because Framer preview/runtime domains may call them before a
  // Curastem session exists.
  if (path === "/geo" && method === "GET") {
    const cf = (request as Request & {
      cf?: {
        latitude?: string;
        longitude?: string;
        city?: string;
        country?: string;
        region?: string;
      };
    }).cf;
    const lat = cf?.latitude ? parseFloat(cf.latitude) : null;
    const lng = cf?.longitude ? parseFloat(cf.longitude) : null;
    return new Response(
      JSON.stringify({
        lat,
        lng,
        city: cf?.city ?? null,
        region: cf?.region ?? null,
        country: cf?.country ?? null,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      }
    );
  }
  if (path === "/auth/maps-key" && method === "GET") {
    return handleMapsKey(env);
  }
  if (path === "/auth/gemini-token" && method === "GET") {
    return handleGeminiToken(env);
  }
  if (path === "/proxy/gemini" && method === "POST") {
    return handleGeminiProxy(request, env);
  }
  if (path === "/auth/popup" && method === "GET") {
    return handleAuthPopup();
  }
  return null;
}
