/**
 * North American cities with ~500k+ population (city proper / large municipalities).
 * Used to route per-job geocoding: Mapbox forward geocode in-metro, Photon elsewhere.
 *
 * Centroids are approximate downtown / municipal centers for proximity bias only.
 */

export interface MetroCentroid {
  lat: number;
  lng: number;
}

/** Haversine distance in km between two WGS84 points. */
export function haversineKm(a: MetroCentroid, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Normalize a city token for lookup (lowercase ASCII, trim). */
export function normalizeMetroToken(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\./g, "")
    .trim();
}

/** Build lookup: multiple aliases per metro (e.g. NYC, Ciudad de México). */
function buildMetroMap(): Map<string, MetroCentroid> {
  const m = new Map<string, MetroCentroid>();
  const add = (names: string[], c: MetroCentroid) => {
    for (const n of names) {
      const k = normalizeMetroToken(n);
      if (k) m.set(k, c);
    }
  };

  // United States
  add(["New York", "New York City", "NYC", "Manhattan"], { lat: 40.7128, lng: -74.006 });
  add(["Los Angeles", "LA"], { lat: 34.0522, lng: -118.2437 });
  add(["Chicago"], { lat: 41.8781, lng: -87.6298 });
  add(["Houston"], { lat: 29.7604, lng: -95.3698 });
  add(["Phoenix"], { lat: 33.4484, lng: -112.074 });
  add(["Philadelphia"], { lat: 39.9526, lng: -75.1652 });
  add(["San Antonio"], { lat: 29.4241, lng: -98.4936 });
  add(["San Diego"], { lat: 32.7157, lng: -117.1611 });
  add(["Dallas"], { lat: 32.7767, lng: -96.797 });
  add(["San Jose"], { lat: 37.3382, lng: -121.8863 });
  add(["Austin"], { lat: 30.2672, lng: -97.7431 });
  add(["Charlotte"], { lat: 35.2271, lng: -80.8431 });
  add(["Columbus"], { lat: 39.9612, lng: -82.9988 });
  add(["Indianapolis"], { lat: 39.7684, lng: -86.1581 });
  add(["San Francisco"], { lat: 37.7749, lng: -122.4194 });
  add(["Seattle"], { lat: 47.6062, lng: -122.3321 });
  add(["Denver"], { lat: 39.7392, lng: -104.9903 });
  add(["Washington", "Washington DC", "Washington, D.C.", "District of Columbia"], {
    lat: 38.9072,
    lng: -77.0369,
  });
  add(["Boston"], { lat: 42.3601, lng: -71.0589 });
  add(["Nashville", "Nashville-Davidson"], { lat: 36.1627, lng: -86.7816 });
  add(["Detroit"], { lat: 42.3314, lng: -83.0458 });
  add(["Portland"], { lat: 45.5152, lng: -122.6784 });
  add(["Las Vegas"], { lat: 36.1699, lng: -115.1398 });
  add(["Memphis"], { lat: 35.1495, lng: -90.049 });
  add(["Sacramento"], { lat: 38.5816, lng: -121.4944 });
  add(["Mesa"], { lat: 33.4152, lng: -111.8315 });
  add(["Atlanta"], { lat: 33.749, lng: -84.388 });
  add(["Kansas City"], { lat: 39.0997, lng: -94.5786 });
  add(["Miami"], { lat: 25.7617, lng: -80.1918 });
  add(["Oakland"], { lat: 37.8044, lng: -122.2712 });
  add(["Minneapolis"], { lat: 44.9778, lng: -93.265 });
  add(["Tampa"], { lat: 27.9506, lng: -82.4572 });
  add(["New Orleans"], { lat: 29.9511, lng: -90.0715 });
  add(["St Louis", "St. Louis"], { lat: 38.627, lng: -90.1994 });
  add(["Pittsburgh"], { lat: 40.4406, lng: -79.9959 });
  add(["Honolulu"], { lat: 21.3069, lng: -157.8583 });
  add(["Long Beach"], { lat: 33.7701, lng: -118.1937 });
  add(["Colorado Springs"], { lat: 38.8339, lng: -104.8214 });

  // Canada
  add(["Toronto"], { lat: 43.6532, lng: -79.3832 });
  add(["Montreal", "Montréal"], { lat: 45.5017, lng: -73.5673 });
  add(["Calgary"], { lat: 51.0447, lng: -114.0719 });
  add(["Ottawa"], { lat: 45.4215, lng: -75.6972 });
  add(["Edmonton"], { lat: 53.5461, lng: -113.4938 });
  add(["Winnipeg"], { lat: 49.8951, lng: -97.1384 });
  add(["Vancouver"], { lat: 49.2827, lng: -123.1207 });
  add(["Quebec City", "Québec", "Quebec"], { lat: 46.8139, lng: -71.208 });

  // Mexico (large municipalities)
  add(["Mexico City", "Ciudad de México", "CDMX"], { lat: 19.4326, lng: -99.1332 });
  add(["Guadalajara"], { lat: 20.6597, lng: -103.3496 });
  add(["Monterrey"], { lat: 25.6866, lng: -100.3161 });

  return m;
}

const METRO_BY_NAME = buildMetroMap();

/** Normalized tokens for `findMetroForLocation` — use for D1 scripts that filter “in major metro”. */
export const MAJOR_METRO_NORMALIZED_KEYS: readonly string[] = [...METRO_BY_NAME.keys()].sort();

/**
 * Normalized city token for a full location string (first segment before comma),
 * e.g. "Montréal, QC" → "montreal". Matches the key used in `findMetroForLocation`.
 */
export function metroNormalizedCityToken(locationKey: string): string {
  const t = locationKey.trim();
  if (!t) return "";
  const cityPart = t.split(",")[0]?.trim() ?? t;
  return normalizeMetroToken(cityPart);
}

/**
 * Returns a metro centroid when `locationKey` names a known major city
 * (first comma-separated segment, e.g. "Houston, TX" → Houston).
 */
export function findMetroForLocation(locationKey: string): MetroCentroid | null {
  const k = metroNormalizedCityToken(locationKey);
  if (!k) return null;
  return METRO_BY_NAME.get(k) ?? null;
}
