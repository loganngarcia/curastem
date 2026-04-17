/**
 * Cloudflare edge cache key + helpers for GET /jobs.
 *
 * Goal: popular searches ("software engineer", "product manager") hit a shared
 * cache across all users, and `near_lat`/`near_lng` are snapped to a grid so
 * everyone within roughly the same area shares a single cache entry instead of
 * each city block producing a new key.
 *
 * The Cache API itself is free (no storage or op fees). Only GETs are cached,
 * only 200 OKs are written, and cache keys are fully deterministic across
 * equivalent requests, including personalization params that materially affect
 * what should be returned.
 *
 * See: https://developers.cloudflare.com/workers/runtime-apis/cache/
 */

/** Bump when response shape or filtering semantics change so stale entries retire. */
export const JOBS_LIST_CACHE_VERSION = "v2";

/** Edge TTL. 1h matches the ingestion cron cadence — new jobs surface within an hour. */
export const JOBS_LIST_CACHE_MAX_AGE_SECONDS = 3600;

/** Response header exposed to clients so we can observe HIT/MISS in devtools/logs. */
export const JOBS_LIST_CACHE_HDR = "X-Curastem-Jobs-Cache";

/*
 * No caller-specific params are intentionally omitted from cache keys anymore.
 * Correctness over absolute key reuse for personalized request variants.
 */

/**
 * Snap a lat/lng to a coarser grid the bigger the requested radius.
 * Users within the same grid cell share one cached response.
 *
 *   radius ≤ 25 km  → 0.25° (~28 km)
 *   radius ≤ 75 km  → 0.5°  (~56 km)
 *   radius ≤ 200 km → 1°    (~111 km)
 *   otherwise       → 2°    (~222 km)
 */
function gridDegForRadiusKm(radiusKm: number): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return 0.5;
  if (radiusKm <= 25) return 0.25;
  if (radiusKm <= 75) return 0.5;
  if (radiusKm <= 200) return 1;
  return 2;
}

function snapNumber(raw: string | null, gridDeg: number): string | null {
  if (raw == null || raw === "") return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const snapped = Math.round(n / gridDeg) * gridDeg;
  // Round to 4 decimals so 0.25 * 3 doesn't serialize as 0.7500000000000001.
  return snapped.toFixed(4).replace(/\.?0+$/, "");
}

/** Round radius_km to a small set of canonical buckets so the cache key stays coarse. */
function bucketRadiusKm(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const buckets = [10, 25, 50, 100, 200, 500];
  for (const b of buckets) {
    if (n <= b) return String(b);
  }
  return String(500);
}

/** Hour-granularity snap for `since=<unix-seconds>`. Empty / 0 collapse to "0". */
function snapSinceHour(raw: string | null): string {
  if (raw == null || raw === "") return "0";
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.floor(n / 3600) * 3600);
}

/** Lowercase, trim, collapse internal whitespace. Makes `q`/`title` case/space-insensitive. */
function normalizeText(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return s.length > 0 ? s : null;
}

/** Normalize comma-separated values so parameter order does not fragment cache keys. */
function normalizeCommaSeparated(raw: string | null): string | null {
  if (raw == null) return null;
  const normalized = Array.from(
    new Set(
      raw
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean)
        .sort()
    )
  ).join(",");
  return normalized.length > 0 ? normalized : null;
}

/**
 * Build the canonical cache-key query string from request params.
 *
 * - Keys are sorted alphabetically (order-insensitive).
 * - `q`/`title` are case + whitespace normalized.
 * - `near_lat`/`near_lng` snap to a grid sized by `radius_km`.
 * - `radius_km` itself is bucketed.
 * - `since` snaps to the hour.
 * - `exclude_ids` is included as a sorted, comma-separated list.
 */
export function buildJobsListCacheKeySearchString(searchParams: URLSearchParams): string {
  const radiusBucket = bucketRadiusKm(searchParams.get("radius_km"));
  const radiusKmNumeric = radiusBucket ? parseFloat(radiusBucket) : NaN;
  const gridDeg = gridDegForRadiusKm(radiusKmNumeric);

  const out: Array<[string, string]> = [];
  const add = (k: string, v: string | null | undefined) => {
    if (v == null || v === "") return;
    out.push([k, v]);
  };

  for (const [rawKey, rawVal] of searchParams.entries()) {
    const key = rawKey.toLowerCase();

    switch (key) {
      case "q":
      case "title":
      case "location":
      case "company":
        add(key, normalizeText(rawVal));
        break;
      case "exclude_ids":
      case "location_or":
        add(key, normalizeCommaSeparated(rawVal));
        break;
      case "near_lat":
      case "near_lng":
        add(key, snapNumber(rawVal, gridDeg));
        break;
      case "radius_km":
        add(key, radiusBucket);
        break;
      case "since":
        add(key, snapSinceHour(rawVal));
        break;
      case "country":
      case "location_region":
        add(key, rawVal.trim().toUpperCase().slice(0, 2));
        break;
      default:
        add(key, rawVal.trim());
    }
  }

  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

  const p = new URLSearchParams();
  for (const [k, v] of out) p.append(k, v);
  return `${JOBS_LIST_CACHE_VERSION}&${p.toString()}`;
}

/**
 * Canonical GET Request used as the Cache API key. We key off the Worker's
 * public hostname to follow Cloudflare's guidance (avoids DNS weirdness).
 */
export function jobsListCacheKeyRequest(requestUrl: string, searchParams: URLSearchParams): Request {
  const origin = (() => {
    try {
      return new URL(requestUrl).origin;
    } catch {
      return "https://api.curastem.org";
    }
  })();
  const qs = buildJobsListCacheKeySearchString(searchParams);
  return new Request(`${origin}/__cache/jobs?${qs}`, { method: "GET" });
}

/**
 * All `/jobs` requests are cacheable at this layer. Paginated queries are
 * included so page 2+ can also reuse prior work.
 */
export function isJobsListRequestCacheable(_searchParams: URLSearchParams): boolean {
  return true;
}
