/**
 * Normalized cache key for GET /jobs/map so nearby pans and zooms hit the same
 * Cloudflare Cache API entry. Optional `q` is part of the key when set (title-filtered chips).
 *
 * Grid step is zoom-adaptive (large span → coarser snap) so world views share cache entries.
 */

/** Match MAP_SPREAD_VIEWPORT_MAX_SPAN_DEG in queries.ts / web.tsx. */
const SPREAD_SPAN_DEG = 4.2;

function gridDegFromSpan(spanMaxDeg: number): number {
  if (spanMaxDeg > 20) return 4;
  if (spanMaxDeg >= SPREAD_SPAN_DEG) return 2;
  return 0.5;
}

function spanMaxFromParams(searchParams: URLSearchParams): number | null {
  const minLat = parseFloat(searchParams.get("min_lat") ?? "");
  const maxLat = parseFloat(searchParams.get("max_lat") ?? "");
  const minLng = parseFloat(searchParams.get("min_lng") ?? "");
  const maxLng = parseFloat(searchParams.get("max_lng") ?? "");
  if ([minLat, maxLat, minLng, maxLng].some((x) => Number.isNaN(x))) return null;
  return Math.max(maxLat - minLat, maxLng - minLng);
}

function snapCoord(raw: string | null, gridDeg: number): string {
  if (raw == null || raw === "") return "";
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return "";
  const snapped = Math.round(n / gridDeg) * gridDeg;
  return String(snapped);
}

function snapSince(raw: string | null): string {
  if (raw == null || raw === "") return "0";
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return "0";
  return String(Math.floor(n / 3600) * 3600);
}

/**
 * Stable query string for `caches.default` — same logical viewport shares one key.
 */
export function buildJobsMapCacheKeySearchString(searchParams: URLSearchParams): string {
  const span = spanMaxFromParams(searchParams);
  const gridDeg = span != null ? gridDegFromSpan(span) : 0.5;

  const p = new URLSearchParams();
  p.set("min_lat", snapCoord(searchParams.get("min_lat"), gridDeg));
  p.set("max_lat", snapCoord(searchParams.get("max_lat"), gridDeg));
  p.set("min_lng", snapCoord(searchParams.get("min_lng"), gridDeg));
  p.set("max_lng", snapCoord(searchParams.get("max_lng"), gridDeg));
  p.set("center_lat", snapCoord(searchParams.get("center_lat"), gridDeg));
  p.set("center_lng", snapCoord(searchParams.get("center_lng"), gridDeg));
  p.set("since", snapSince(searchParams.get("since")));

  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  p.set("limit", !Number.isNaN(limit) && limit > 0 ? String(Math.min(limit, 500)) : "100");

  const et = searchParams.get("employment_type");
  if (et) p.set("employment_type", et);

  const sl = searchParams.get("seniority_level");
  if (sl) p.set("seniority_level", sl);

  const q = searchParams.get("q")?.trim();
  if (q) p.set("q", q);

  return p.toString();
}

/** Canonical GET request used as the Cache API cache key. */
export function jobsMapCacheKeyRequest(searchParams: URLSearchParams): Request {
  const qs = buildJobsMapCacheKeySearchString(searchParams);
  return new Request(`https://jobs-map-cache.internal/v1?${qs}`, { method: "GET" });
}
