/**
 * Geocoding via Nominatim (OpenStreetMap). Free, 1 req/sec max.
 * Caches results in KV to avoid repeated calls.
 *
 * Run backfill via: wrangler d1 execute curastem-jobs --remote --file=migrations/003_add_job_location_coords.sql
 * Then trigger geocode backfill (see runner or a separate script).
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_PREFIX = "geo:";
const CACHE_TTL = 86400 * 365; // 1 year — locations don't move

export interface GeocodeResult {
  lat: number;
  lng: number;
}

export interface GeocodeResultWithCache extends GeocodeResult {
  fromCache: boolean;
}

/**
 * Geocode a location string. Returns null on failure or if location is empty/remote.
 * Skips strings that look like "Remote" or "Remote (US)" etc.
 * When KV is provided, returns fromCache: true when served from cache (no Nominatim call).
 */
export async function geocode(
  location: string | null,
  kv?: KVNamespace
): Promise<GeocodeResultWithCache | null> {
  if (!location || !location.trim()) return null;
  const trimmed = location.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("remote") ||
    lower === "remote" ||
    /^remote\s*[\(\-]/.test(lower)
  ) {
    return null;
  }

  const cacheKey = `${CACHE_PREFIX}${trimmed}`;
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const [lat, lng] = cached.split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng, fromCache: true };
    }
  }

  const params = new URLSearchParams({
    q: trimmed,
    format: "json",
    limit: "1",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      "User-Agent": "CurastemJobs/1.0 (https://curastem.org; jobs geocoding)",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  const lat = parseFloat(first?.lat ?? "");
  const lng = parseFloat(first?.lon ?? "");
  if (isNaN(lat) || isNaN(lng)) return null;

  if (kv) {
    await kv.put(cacheKey, `${lat},${lng}`, { expirationTtl: CACHE_TTL });
  }
  return { lat, lng, fromCache: false };
}
