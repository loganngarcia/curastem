/**
 * Curastem Jobs Proxy — Cloudflare Worker
 *
 * Sits between public clients (Framer web component, future developer portal)
 * and the private curastem-jobs-api. The upstream API key never touches the
 * browser — it lives as a Worker secret.
 *
 * PROXIED ROUTES (read-only, no auth required from clients):
 *   GET  /jobs          → https://api.curastem.org/jobs
 *   GET  /jobs/:id      → https://api.curastem.org/jobs/:id
 *   GET  /stats         → https://api.curastem.org/stats
 *   GET  /health        → https://api.curastem.org/health
 *
 * All other methods/paths → 404.
 *
 * FUTURE: swap the static JOBS_API_KEY for per-developer key validation
 * once the developer portal is live.
 *
 * SECRETS (set via `wrangler secret put`):
 *   JOBS_API_KEY  — Bearer token for the upstream curastem-jobs-api
 */

interface Env {
  /** Upstream Bearer token — never exposed to clients */
  JOBS_API_KEY: string;
}

const UPSTREAM = "https://api.curastem.org";

// Only these path prefixes are allowed through
const ALLOWED_PATHS = ["/jobs", "/stats", "/health", "/geo"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Only GET is allowed — this proxy is strictly read-only
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Guard: only proxy known safe paths
    const isAllowed = ALLOWED_PATHS.some(
      (prefix) => path === prefix || path.startsWith(prefix + "/")
    );
    if (!isAllowed) {
      return json({ error: "Not found" }, 404);
    }

    // Forward to upstream with the server-side API key
    const upstreamUrl = new URL(path + url.search, UPSTREAM);
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.JOBS_API_KEY}`,
        "Content-Type": "application/json",
        // Pass through CF's real IP header so upstream rate-limiting stays meaningful
        "CF-Connecting-IP": request.headers.get("CF-Connecting-IP") ?? "",
      },
    });

    // Stream the upstream body with our CORS headers added.
    // Forward cache/debug headers so frontend logs can distinguish HIT vs MISS.
    const cacheHeaders = [
      "X-Curastem-Jobs-Cache",
      "X-Curastem-Jobs-Cache-Hash",
      "X-Curastem-Jobs-Cache-Path",
      "X-Curastem-Jobs-Cache-Generated",
      "X-Curastem-Jobs-Map-Cache",
    ];

    const forwardedExposeHeaders = [
      "X-Curastem-Jobs-Cache",
      "X-Curastem-Jobs-Cache-Hash",
      "X-Curastem-Jobs-Cache-Path",
      "X-Curastem-Jobs-Cache-Generated",
      "X-Curastem-Jobs-Map-Cache",
    ];

    const headers: Record<string, string> = {
      "Content-Type":
        upstreamResponse.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
      "Access-Control-Expose-Headers": forwardedExposeHeaders.join(", "),
    };

    for (const headerName of cacheHeaders) {
      const value = upstreamResponse.headers.get(headerName);
      if (value) headers[headerName] = value;
    }
    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });

    return response;
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
