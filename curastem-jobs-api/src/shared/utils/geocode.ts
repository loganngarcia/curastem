/**
 * Geocoding helpers:
 *
 * geocode(location) — city/region strings (e.g. "Dallas, TX")
 *   1. majorMetros.ts centroid when the string names a listed city — no HTTP
 *   2. Photon (OSM) — only when not in our table
 *   3. Nominatim (1 req/sec)                      — last resort
 *
 * geocodeAddress(address, apiKey?, kv?, mapboxToken?) — full street addresses
 *   1. Mapbox (metro from city tail, else CONUS loose) — when token present
 *   2. Google Geocoding API ($0.005/req)
 *   3. Nominatim
 *   4. geocode() — majorMetros, Photon, Nominatim
 *
 * geocodeWithMapboxFirst — same KV key as geocode(); tries Mapbox before majorMetros/Photon.
 *
 * geocode + geocodeWithMapboxFirst use `geo:` KV cache; geocodeAddress uses `addr:` so
 * city-level and address-level results do not collide.
 *
 * Deduplication note: callers should group jobs by address before calling
 * geocodeAddress so that multiple jobs at the same store share one API call.
 */

import { findMetroForLocation } from "./majorMetros.ts";
import { mapboxGeocodeIngestForAddress } from "./mapboxGeocode.ts";

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
 * Uses majorMetros when the city is listed, then Photon, then Nominatim.
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

  const metroHit = findMetroForLocation(trimmed);
  if (metroHit) {
    if (kv) await kv.put(cacheKey, `${metroHit.lat},${metroHit.lng}`, { expirationTtl: CACHE_TTL });
    return { lat: metroHit.lat, lng: metroHit.lng, fromCache: false, usedNominatim: false };
  }

  // ── 2. Photon — cities not in majorMetros (or spelling outside our normalization) ──
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

  // ── 3. Nominatim (fallback — 1 req/sec, caller must throttle) ───────────────
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
 * City/region string: after KV cache, try Mapbox before majorMetros / Photon / Nominatim.
 */
export async function geocodeWithMapboxFirst(
  location: string | null,
  kv: KVNamespace | undefined,
  mapboxAccessToken: string | undefined
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

  if (mapboxAccessToken?.trim()) {
    const mb = await mapboxGeocodeIngestForAddress(trimmed, mapboxAccessToken.trim(), kv);
    if (mb) {
      if (kv) await kv.put(cacheKey, `${mb.lat},${mb.lng}`, { expirationTtl: CACHE_TTL });
      return { lat: mb.lat, lng: mb.lng, fromCache: false, usedNominatim: false };
    }
  }

  return geocode(trimmed, kv);
}

/**
 * Geocode a full street address (e.g. "3275 Henry St, Muskegon, MI").
 *
 * Mapbox first (when token present), then Google Geocoding API, Nominatim, then loose geocode.
 * Results are KV-cached under "addr:" prefix for 1 year.
 * Callers MUST deduplicate by address before calling so that multiple jobs at the
 * same store share one API call (e.g. all Dominos jobs at "3275 Henry St, Watertown, WI"
 * resolve together from cache after the first geocode).
 */
export async function geocodeAddress(
  address: string,
  apiKey?: string,
  kv?: KVNamespace,
  mapboxAccessToken?: string
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

  if (mapboxAccessToken?.trim()) {
    const mb = await mapboxGeocodeIngestForAddress(trimmed, mapboxAccessToken.trim(), kv);
    if (mb) {
      if (kv) await kv.put(cacheKey, `${mb.lat},${mb.lng}`, { expirationTtl: CACHE_TTL });
      return { lat: mb.lat, lng: mb.lng, fromCache: false, usedNominatim: false };
    }
  }

  // ── Google Geocoding API — $0.005/req, most reliable for US addresses ────
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
    if (res.ok) {
      const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const lat = parseFloat(first?.lat ?? "");
        const lng = parseFloat(first?.lon ?? "");
        if (!isNaN(lat) && !isNaN(lng)) {
          if (kv) await kv.put(cacheKey, `${lat},${lng}`, { expirationTtl: CACHE_TTL });
          return { lat, lng, fromCache: false, usedNominatim: true };
        }
      }
    }
  } catch {
    // fall through to Photon
  }

  // ── 3. Photon (+ Nominatim inside geocode) — same query pipeline as city strings ──
  const loose = await geocode(trimmed, kv);
  if (loose) {
    if (kv) await kv.put(cacheKey, `${loose.lat},${loose.lng}`, { expirationTtl: CACHE_TTL });
    return {
      lat: loose.lat,
      lng: loose.lng,
      fromCache: false,
      usedNominatim: loose.usedNominatim,
    };
  }
  return null;
}
