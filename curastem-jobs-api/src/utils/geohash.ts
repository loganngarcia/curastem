/**
 * Geohash encode + bbox coverage for GET /jobs/map spread (pre-aggregated cells).
 * Base32 alphabet per https://en.wikipedia.org/wiki/Geohash
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Encode lat/lng to geohash of length `precision` (1–12). */
export function encodeGeohash(lat: number, lng: number, precision: number): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let isLng = true;
  let bit = 0;
  let ch = 0;
  const n = Math.min(12, Math.max(1, Math.floor(precision)));
  while (hash.length < n) {
    if (isLng) {
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) {
        ch |= 1 << (4 - bit);
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch |= 1 << (4 - bit);
        latMin = mid;
      } else {
        latMax = mid;
      }
    }
    isLng = !isLng;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/**
 * Approximate degree step for sampling a bbox so we cover all geohash cells at `precision`.
 * Finer than cell size so corner cells are not missed.
 */
function sampleStepDeg(precision: number, refLat: number): { dLat: number; dLng: number } {
  const p = Math.min(6, Math.max(3, precision));
  const base = 0.7 / Math.pow(2, p - 3);
  const cos = Math.max(0.2, Math.cos((refLat * Math.PI) / 180));
  return { dLat: base, dLng: base / cos };
}

/**
 * All distinct geohash prefixes of length `precision` overlapping the bbox.
 */
export function geohashesInBoundingBox(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  precision: number
): string[] {
  const set = new Set<string>();
  const midLat = (minLat + maxLat) / 2;
  const { dLat, dLng } = sampleStepDeg(precision, midLat);
  const pad = dLat * 0.25;
  let lat = minLat - pad;
  while (lat <= maxLat + pad) {
    let lng = minLng - pad;
    while (lng <= maxLng + pad) {
      const clat = Math.min(maxLat, Math.max(minLat, lat));
      const clng = Math.min(maxLng, Math.max(minLng, lng));
      set.add(encodeGeohash(clat, clng, precision));
      lng += dLng;
    }
    lat += dLat;
  }
  return Array.from(set);
}
