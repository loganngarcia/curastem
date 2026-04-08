/**
 * Mapbox Geocoding API v6 — forward geocoding for "{company} {city, ST}" style queries.
 * Uses the default temporary tier; coords are still written to D1/KV so ingestion stays idempotent.
 *
 * Docs: https://docs.mapbox.com/api/search/geocoding-v6/
 */

import type { PlacesGeocodeResult } from "./placesGeocode.ts";
import { haversineKm, type MetroCentroid } from "./majorMetros.ts";

const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";
const CACHE_PREFIX = "mapbox:";
const CACHE_TTL = 86400 * 365;

/** Stay under Mapbox temporary free-tier monthly ceiling (soft guard). */
export const MAPBOX_MONTHLY_SOFT_CAP = 95_000;

/** Reject features farther than this from the expected metro centroid (km). */
const MAX_DISTANCE_KM = 75;

function usageKey(): string {
  const y = new Date();
  const ym = `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, "0")}`;
  return `mapbox_usage_${ym}`;
}

async function getMonthlyUsage(kv: KVNamespace | undefined): Promise<number> {
  if (!kv) return 0;
  const raw = await kv.get(usageKey());
  const n = parseInt(raw ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

async function bumpMonthlyUsage(kv: KVNamespace | undefined): Promise<void> {
  if (!kv) return;
  const key = usageKey();
  const cur = await getMonthlyUsage(kv);
  await kv.put(key, String(cur + 1), { expirationTtl: 86400 * 45 });
}

interface MapboxFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: {
    feature_type?: string;
    place_formatted?: string;
    name?: string;
    coordinates?: { longitude?: number; latitude?: number };
  };
}

interface MapboxForwardResponse {
  type?: string;
  features?: MapboxFeature[];
}

/**
 * Forward geocode with proximity bias. Returns null on miss, over cap, or out-of-range results.
 */
export async function mapboxGeocode(
  query: string,
  metro: MetroCentroid,
  accessToken: string,
  kv?: KVNamespace,
): Promise<PlacesGeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed || !accessToken) return null;

  const cacheKey = `${CACHE_PREFIX}${trimmed}`;
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached !== null) {
      if (cached === "null") return null;
      const pipeIdx = cached.indexOf("|");
      const pipe2Idx = cached.indexOf("|", pipeIdx + 1);
      const lat = parseFloat(cached.slice(0, pipeIdx));
      const lng = parseFloat(cached.slice(pipeIdx + 1, pipe2Idx));
      const addr = cached.slice(pipe2Idx + 1);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng, formattedAddress: addr || trimmed };
    }
  }

  if ((await getMonthlyUsage(kv)) >= MAPBOX_MONTHLY_SOFT_CAP) {
    return null;
  }

  const params = new URLSearchParams({
    q: trimmed,
    access_token: accessToken,
    proximity: `${metro.lng},${metro.lat}`,
    limit: "5",
    autocomplete: "false",
    // v6: no POI type — address / place / street / locality per docs
    types: "address,place,street,locality,neighborhood",
  });

  try {
    const res = await fetch(`${GEOCODE_URL}?${params}`);
    await bumpMonthlyUsage(kv);

    if (!res.ok) return null;

    const data = (await res.json()) as MapboxForwardResponse;
    const features = data.features ?? [];

    for (const f of features) {
      let lng: number | undefined;
      let lat: number | undefined;
      if (f.geometry?.coordinates?.length === 2) {
        [lng, lat] = f.geometry.coordinates;
      } else if (f.properties?.coordinates) {
        lng = f.properties.coordinates.longitude;
        lat = f.properties.coordinates.latitude;
      }
      if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) continue;
      if (haversineKm(metro, { lat, lng }) > MAX_DISTANCE_KM) continue;

      const formatted =
        f.properties?.place_formatted ??
        f.properties?.name ??
        trimmed;

      const result: PlacesGeocodeResult = { lat, lng, formattedAddress: formatted };

      if (kv) {
        await kv.put(
          cacheKey,
          `${result.lat}|${result.lng}|${result.formattedAddress}`,
          { expirationTtl: CACHE_TTL },
        );
      }

      return result;
    }

    if (kv) await kv.put(cacheKey, "null", { expirationTtl: CACHE_TTL });
    return null;
  } catch {
    return null;
  }
}
