/**
 * Two geocoding functions:
 *
 * geocode(location) — city/region strings (e.g. "Dallas, TX")
 *   1. Photon (no rate limit, no key, OSM-based) — primary
 *   2. Nominatim (1 req/sec, OSM-based)           — fallback
 *
 * geocodeAddress(address, apiKey?) — full street addresses (e.g. "3275 Henry St, Muskegon, MI")
 *   1. Google Geocoding API ($0.005/req)            — primary when key is present
 *   2. Nominatim                                    — fallback (free, accurate for US streets)
 *
 * Both functions cache results in KV for 1 year. geocodeAddress uses a separate
 * "addr:" prefix so city-level and address-level caches don't overlap.
 *
 * Deduplication note: callers should group jobs by address before calling
 * geocodeAddress so that multiple jobs at the same store share one API call.
 */

const PHOTON_URL    = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const CACHE_PREFIX      = "geo:";
const ADDR_CACHE_PREFIX = "addr:";
const CACHE_TTL = 86400 * 365; // 1 year — locations don't move

export interface GeocodeResult {
  lat: number;
  lng: number;
}

export interface GeocodeResultWithCache extends GeocodeResult {
  fromCache: boolean;
  /** true when the result came from Nominatim (rate-limited); caller should delay 1.1s) */
  usedNominatim: boolean;
}

const REMOTE_RE = /^remote(\s*[\(\-/]|$)/i;

/**
 * Geocode a location string. Returns null for empty, remote-only, or unresolvable strings.
 * Tries Photon first (no rate limit), falls back to Nominatim on failure.
 * Results are KV-cached so each unique location is fetched at most once.
 */
export async function geocode(
  location: string | null,
  kv?: KVNamespace
): Promise<GeocodeResultWithCache | null> {
  if (!location || !location.trim()) return null;
  const trimmed = location.trim();
  if (REMOTE_RE.test(trimmed)) return null;

  const cacheKey = `${CACHE_PREFIX}${trimmed}`;
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const [lat, lng] = cached.split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng, fromCache: true, usedNominatim: false };
    }
  }

  // ── 1. Photon (primary — no rate limit) ────────────────────────────────────
  try {
    const params = new URLSearchParams({ q: trimmed, limit: "1" });
    const res = await fetch(`${PHOTON_URL}?${params}`, {
      headers: { "User-Agent": "CurastemJobs/1.0 (https://curastem.org)" },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
      };
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (coords && coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
        const [lng, lat] = coords; // GeoJSON is [lng, lat]
        if (kv) await kv.put(cacheKey, `${lat},${lng}`, { expirationTtl: CACHE_TTL });
        return { lat, lng, fromCache: false, usedNominatim: false };
      }
    }
  } catch {
    // fall through to Nominatim
  }

  // ── 2. Nominatim (fallback — 1 req/sec, caller must throttle) ──────────────
  try {
    const params = new URLSearchParams({ q: trimmed, format: "json", limit: "1" });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": "CurastemJobs/1.0 (https://curastem.org; jobs geocoding)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    const lat = parseFloat(first?.lat ?? "");
    const lng = parseFloat(first?.lon ?? "");
    if (isNaN(lat) || isNaN(lng)) return null;
    if (kv) await kv.put(cacheKey, `${lat},${lng}`, { expirationTtl: CACHE_TTL });
    return { lat, lng, fromCache: false, usedNominatim: true };
  } catch {
    return null;
  }
}

/**
 * Geocode a full street address (e.g. "3275 Henry St, Muskegon, MI").
 *
 * Uses Google Geocoding API ($0.005/req) when an API key is provided —
 * much cheaper than Places API ($0.032) and the right tool for a known address.
 * Falls back to Nominatim (free, accurate for US streets) when no key or on failure.
 *
 * Results are KV-cached under "addr:" prefix for 1 year.
 * Callers MUST deduplicate by address before calling so that multiple jobs at the
 * same store share one API call (e.g. all Dominos jobs at "3275 Henry St, Watertown, WI"
 * resolve together from cache after the first geocode).
 */
export async function geocodeAddress(
  address: string,
  apiKey?: string,
  kv?: KVNamespace,
): Promise<GeocodeResultWithCache | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const cacheKey = `${ADDR_CACHE_PREFIX}${trimmed}`;
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const [lat, lng] = cached.split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng, fromCache: true, usedNominatim: false };
    }
  }

  // ── 1. Google Geocoding API — $0.005/req, most reliable for US addresses ────
  if (apiKey) {
    try {
      const params = new URLSearchParams({ address: trimmed, key: apiKey });
      const res = await fetch(`${GEOCODING_URL}?${params}`);
      if (res.ok) {
        const data = (await res.json()) as {
          status: string;
          results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
        };
        if (data.status === "OK" && data.results?.length) {
          const loc = data.results[0].geometry?.location;
          if (loc && !isNaN(loc.lat) && !isNaN(loc.lng)) {
            if (kv) await kv.put(cacheKey, `${loc.lat},${loc.lng}`, { expirationTtl: CACHE_TTL });
            return { lat: loc.lat, lng: loc.lng, fromCache: false, usedNominatim: false };
          }
        }
      }
    } catch {
      // fall through to Nominatim
    }
  }

  // ── 2. Nominatim fallback — free, good accuracy for established US streets ──
  try {
    const params = new URLSearchParams({ q: trimmed, format: "json", limit: "1" });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": "CurastemJobs/1.0 (https://curastem.org; address geocoding)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    const lat = parseFloat(first?.lat ?? "");
    const lng = parseFloat(first?.lon ?? "");
    if (isNaN(lat) || isNaN(lng)) return null;
    if (kv) await kv.put(cacheKey, `${lat},${lng}`, { expirationTtl: CACHE_TTL });
    return { lat, lng, fromCache: false, usedNominatim: true };
  } catch {
    return null;
  }
}
