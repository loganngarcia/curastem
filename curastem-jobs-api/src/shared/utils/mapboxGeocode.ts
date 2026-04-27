/**
 * Mapbox Geocoding API v6 — forward geocoding for "{company} {city, ST}" style queries.
 * Uses the default temporary tier; coords are still written to D1/KV so ingestion stays idempotent.
 *
 * Docs: https://docs.mapbox.com/api/search/geocoding-v6/
 *
 * Ingestion: {@link mapboxGeocode} (explicit metro), {@link mapboxGeocodeIngestForJobPair}
 * (metro then CONUS loose on `"company + city"`), {@link mapboxGeocodeIngestForAddress}
 * (street addresses — metro from comma tails). HQ cron: {@link mapboxGeocodeForCompanyHq}.
 */

import type { PlacesGeocodeResult } from "./placesGeocode.ts";
import { findMetroForLocation, haversineKm, type MetroCentroid } from "./majorMetros.ts";

const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";
const CACHE_PREFIX = "mapbox:";
/** KV prefix for HQ path — separate from job-ingest so feature-type filter does not change job pins. */
const CACHE_PREFIX_HQ = "mapbox:hq1:";
const CACHE_TTL = 86400 * 365;

/** Stay under Mapbox temporary free-tier monthly ceiling (soft guard). */
export const MAPBOX_MONTHLY_SOFT_CAP = 95_000;

/**
 * v6 `properties.feature_type` — used for company HQ: accept street-level and place
 * (city/neighborhood) matches; skip `region` / `country` / `postcode` so Google can
 * disambiguate when Mapbox’s top hit is too coarse.
 */
export const MAPBOX_HQ_FEATURE_TYPES = new Set(
  "address,street,place,locality,neighborhood".split(",")
);

/** Reject features farther than this from the expected metro centroid (km). */
const MAX_DISTANCE_KM = 75;

const CONUS_CENTROID: MetroCentroid = { lat: 39.8283, lng: -98.5795 };
const CONUS_LOOSE_MAX_KM = 2800;

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

type GeocodeMode = { kind: "ingest" } | { kind: "hq" };

/** Try each comma-separated tail so `123 St, Austin, TX` can bias to the Austin metro. */
function findMetroForAddressString(address: string): MetroCentroid | null {
  const parts = address.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join(", ");
    const m = findMetroForLocation(tail);
    if (m) return m;
  }
  return null;
}

/**
 * Full street/address string: try metro (from any `city, ST` tail), else CONUS loose.
 * Ingest mode — all feature types. Used by {@link geocodeAddress} before Google.
 */
export async function mapboxGeocodeIngestForAddress(
  address: string,
  accessToken: string,
  kv?: KVNamespace
): Promise<PlacesGeocodeResult | null> {
  const t = address.trim();
  if (!t || !accessToken) return null;
  const metro = findMetroForAddressString(t);
  if (metro) {
    const h = await mapboxGeocodeImpl(t, accessToken, kv, metro, MAX_DISTANCE_KM, { kind: "ingest" });
    if (h) return h;
  }
  return mapboxGeocodeImpl(t, accessToken, kv, CONUS_CENTROID, CONUS_LOOSE_MAX_KM, { kind: "ingest" });
}

/**
 * Per-job `company + location_key` (e.g. `Austin, TX`): metro bias when `location_key` is
 * a known major city, else CONUS loose. Single entry point for inline job geocoding.
 */
export async function mapboxGeocodeIngestForJobPair(
  companyName: string,
  locationKey: string,
  accessToken: string,
  kv?: KVNamespace
): Promise<PlacesGeocodeResult | null> {
  const q = `${companyName} ${locationKey}`.trim();
  if (!q || !accessToken) return null;
  const metro = findMetroForLocation(locationKey);
  if (metro) {
    const h = await mapboxGeocodeImpl(q, accessToken, kv, metro, MAX_DISTANCE_KM, { kind: "ingest" });
    if (h) return h;
  }
  return mapboxGeocodeImpl(q, accessToken, kv, CONUS_CENTROID, CONUS_LOOSE_MAX_KM, { kind: "ingest" });
}

/**
 * Company HQ: metro (75 km) then US-loose, only accepting
 * {@link MAPBOX_HQ_FEATURE_TYPES} so we “use Mapbox when it really hits a place/address”
 * and let Places handle the rest. KV cache is separate from job-ingest.
 */
export async function mapboxGeocodeForCompanyHq(
  query: string,
  accessToken: string,
  kv?: KVNamespace
): Promise<PlacesGeocodeResult | null> {
  const t = query.trim();
  if (!t) return null;
  const firstSeg = t.split(/[,;]/)[0]?.trim() ?? t;
  const metro = findMetroForLocation(firstSeg) ?? findMetroForLocation(t) ?? null;
  if (metro) {
    const h = await mapboxGeocodeImpl(
      t,
      accessToken,
      kv,
      metro,
      MAX_DISTANCE_KM,
      { kind: "hq" }
    );
    if (h) return h;
  }
  return mapboxGeocodeImpl(
    t,
    accessToken,
    kv,
    CONUS_CENTROID,
    CONUS_LOOSE_MAX_KM,
    { kind: "hq" }
  );
}

/** @deprecated use {@link mapboxGeocodeForCompanyHq} (same implementation). */
export const mapboxGeocodeForEducationHq = mapboxGeocodeForCompanyHq;

/**
 * Ingestion / job line: all feature types; distance is the only filter (existing behavior).
 */
export async function mapboxGeocode(
  query: string,
  metro: MetroCentroid,
  accessToken: string,
  kv?: KVNamespace
): Promise<PlacesGeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed || !accessToken) return null;
  return mapboxGeocodeImpl(trimmed, accessToken, kv, metro, MAX_DISTANCE_KM, { kind: "ingest" });
}

async function mapboxGeocodeImpl(
  trimmed: string,
  accessToken: string,
  kv: KVNamespace | undefined,
  ref: MetroCentroid,
  maxDistanceKm: number,
  mode: GeocodeMode
): Promise<PlacesGeocodeResult | null> {
  if (!accessToken) return null;

  const cacheKey =
    (mode.kind === "hq" ? CACHE_PREFIX_HQ : CACHE_PREFIX) + trimmed;
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
    proximity: `${ref.lng},${ref.lat}`,
    limit: "5",
    autocomplete: "false",
    types: "address,place,street,locality,neighborhood",
  });

  const featureOk = (f: MapboxFeature): boolean => {
    if (mode.kind === "ingest") return true;
    const ft = (f.properties?.feature_type ?? "").toLowerCase();
    return Boolean(ft) && MAPBOX_HQ_FEATURE_TYPES.has(ft);
  };

  try {
    const res = await fetch(`${GEOCODE_URL}?${params}`);
    await bumpMonthlyUsage(kv);

    if (!res.ok) return null;

    const data = (await res.json()) as MapboxForwardResponse;
    const features = data.features ?? [];

    for (const f of features) {
      if (!featureOk(f)) continue;
      let lng: number | undefined;
      let lat: number | undefined;
      if (f.geometry?.coordinates?.length === 2) {
        [lng, lat] = f.geometry.coordinates;
      } else if (f.properties?.coordinates) {
        lng = f.properties.coordinates.longitude;
        lat = f.properties.coordinates.latitude;
      }
      if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) continue;
      if (haversineKm(ref, { lat, lng }) > maxDistanceKm) continue;

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
