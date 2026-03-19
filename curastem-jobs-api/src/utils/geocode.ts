/**
 * Geocoding with two providers in sequence:
 *   1. Photon (komoot) — no rate limit, no key, OSM-based. Primary for speed.
 *   2. Nominatim (OpenStreetMap) — 1 req/sec limit, used as fallback only.
 *
 * All results are cached in KV for 1 year so each unique location string is
 * only ever geocoded once. Callers should check `fromCache` to decide whether
 * to add a delay between requests (only needed for Nominatim fallback hits).
 */

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_PREFIX = "geo:";
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
