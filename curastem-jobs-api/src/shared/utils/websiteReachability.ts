/**
 * Shared HTTP reachability for company website_url validation (probe + Wikidata backfill).
 * Conservative: 401/403/429 count as ok (bot walls); 404/410 dead; 5xx/timeout defer.
 */

export type WebsiteReachability = "ok" | "dead" | "defer";

const FETCH_TIMEOUT_MS = 12_000;

// AbortSignal.timeout is not available in all Workers compatibility dates.
function makeTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function classifyStatus(status: number): WebsiteReachability {
  if (status >= 200 && status < 400) return "ok";
  if (status === 401 || status === 403 || status === 429) return "ok";
  if (status === 404 || status === 410) return "dead";
  if (status >= 500) return "defer";
  if (status >= 400) return "dead";
  return "defer";
}

/**
 * Returns whether the URL resolves over HTTP(s) and returns an acceptable status after redirects.
 */
export async function probeHttpUrlReachability(
  url: string,
  init?: { method?: "GET" | "HEAD" }
): Promise<WebsiteReachability> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "dead";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "dead";

  const method = init?.method ?? "GET";
  try {
    const res = await fetch(parsed.href, {
      method,
      redirect: "follow",
      signal: makeTimeoutSignal(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; CurastemJobs/1.0; +https://curastem.org) jobs-indexing",
      },
    });
    return classifyStatus(res.status);
  } catch {
    return "defer";
  }
}
