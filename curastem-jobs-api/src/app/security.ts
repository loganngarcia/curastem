import { Errors } from "../shared/utils/errors.ts";

const APP_ROUTE_PREFIXES = [
  "/auth/",
  "/proxy/gemini",
  "/sync/",
  "/uploads/",
  "/profile/",
  "/chats",
  "/docs",
  "/apps",
  "/geo",
];

const CSRF_HEADER = "X-Curastem-Client";

export function isAppRoute(path: string): boolean {
  return APP_ROUTE_PREFIXES.some((p) => {
    if (p.endsWith("/")) return path === p.slice(0, -1) || path.startsWith(p);
    return path === p || path.startsWith(p + "/");
  });
}

function isAllowedAppOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return (
      h === "curastem.org" ||
      h.endsWith(".curastem.org") ||
      h === "framer.com" ||
      h === "framer.website" ||
      h.endsWith(".framer.website") ||
      h === "framer.app" ||
      h.endsWith(".framer.app") ||
      h.endsWith(".framer.com") ||
      h === "framer.ai" ||
      h.endsWith(".framer.ai") ||
      h === "framercanvas.com" ||
      h.endsWith(".framercanvas.com") ||
      h === "localhost" ||
      h === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

export function appCorsPreflight(request: Request): Response {
  const origin = request.headers.get("Origin");
  if (!isAllowedAppOrigin(origin)) {
    return new Response(null, { status: 403 });
  }
  const reqHeaders =
    request.headers.get("Access-Control-Request-Headers") ??
    "Authorization, Content-Type";
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": origin!,
      "Vary": "Origin",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": reqHeaders,
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function withAppCors(request: Request, resp: Response): Response {
  const origin = request.headers.get("Origin");
  if (isAllowedAppOrigin(origin)) {
    resp.headers.set("Access-Control-Allow-Origin", origin!);
    resp.headers.set("Vary", "Origin");
    resp.headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (!resp.headers.has("Cache-Control")) {
    resp.headers.set("Cache-Control", "private, no-store");
  }
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("Referrer-Policy", "no-referrer");
  return resp;
}

export function requireAppCsrf(request: Request): Response | null {
  const m = request.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedAppOrigin(origin)) {
    return Errors.forbidden("Origin");
  }
  if (!request.headers.get(CSRF_HEADER)) {
    return Errors.forbidden("CSRF");
  }
  return null;
}
