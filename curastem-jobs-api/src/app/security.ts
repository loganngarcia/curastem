import { Errors } from "../shared/utils/errors.ts";

const APP_ROUTE_PREFIXES = [
  "/auth/",
  "/agent/",
  "/proxy/gemini",
  "/proxy/gemini-live",
  "/sync/",
  "/uploads/",
  "/profile/",
  "/chats",
  "/docs",
  "/apps",
  "/geo",
];

const CSRF_HEADER = "X-Curastem-Client";
const NULL_ORIGIN_AGENT_PATHS = new Set(["/agent/chat", "/agent/tools", "/agent/tool"]);

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

function isNullOriginAgentRequest(request: Request, path?: string): boolean {
  if (request.headers.get("Origin") !== "null") return false;
  if (!path || !NULL_ORIGIN_AGENT_PATHS.has(path)) return false;
  const requestedHeaders = (
    request.headers.get("Access-Control-Request-Headers") ?? ""
  ).toLowerCase();
  const hasClientHeader =
    request.headers.get(CSRF_HEADER) === "web" ||
    requestedHeaders
      .split(",")
      .map((h) => h.trim())
      .includes(CSRF_HEADER.toLowerCase());
  const hasCredentialHeader = request.headers.has("Cookie");
  return hasClientHeader && !hasCredentialHeader;
}

export function appCorsPreflight(request: Request, path?: string): Response {
  const origin = request.headers.get("Origin");
  const allowNullOrigin = isNullOriginAgentRequest(request, path);
  if (!isAllowedAppOrigin(origin) && !allowNullOrigin) {
    return new Response(null, { status: 403 });
  }
  const reqHeaders =
    request.headers.get("Access-Control-Request-Headers") ??
    "Authorization, Content-Type";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowNullOrigin ? "null" : origin!,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (!allowNullOrigin) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return new Response(null, {
    headers,
  });
}

export function withAppCors(request: Request, resp: Response, path?: string): Response {
  const origin = request.headers.get("Origin");
  if (isAllowedAppOrigin(origin)) {
    resp.headers.set("Access-Control-Allow-Origin", origin!);
    resp.headers.set("Vary", "Origin");
    resp.headers.set("Access-Control-Allow-Credentials", "true");
  } else if (isNullOriginAgentRequest(request, path)) {
    resp.headers.set("Access-Control-Allow-Origin", "null");
    resp.headers.set("Vary", "Origin");
    resp.headers.delete("Access-Control-Allow-Credentials");
  }
  if (!resp.headers.has("Cache-Control")) {
    resp.headers.set("Cache-Control", "private, no-store");
  }
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("Referrer-Policy", "no-referrer");
  return resp;
}

export function requireAppCsrf(request: Request, path?: string): Response | null {
  const m = request.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  if (isNullOriginAgentRequest(request, path)) return null;
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedAppOrigin(origin)) {
    return Errors.forbidden("Origin");
  }
  if (!request.headers.get(CSRF_HEADER)) {
    return Errors.forbidden("CSRF");
  }
  return null;
}
