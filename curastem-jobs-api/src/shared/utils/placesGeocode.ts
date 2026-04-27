/**
 * Google Places API (New) — Text Search geocoding.
 *
 * Used for company HQ geocoding and per-job geocoding for retail/franchise
 * companies where precise store addresses matter more than city-level accuracy.
 *
 * Cost: $0.032 per request (Places API New Text Search, as of 2025).
 * Results are KV-cached indefinitely so each unique query is only ever billed once.
 * Always call with specific queries (e.g. "CVS Health Alexandria, MN")
 * to minimise mismatches and avoid wasting API credits on ambiguous names.
 */

export interface PlacesGeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const CACHE_PREFIX = "places:";
const CACHE_TTL = 86400 * 365; // 1 year — store locations don't move

/** Non-geographic workplace labels that should never be geocoded. */
const NON_GEOGRAPHIC_RE = /^\s*(?:remote|fully\s+remote|100%\s+remote|hybrid|work\s+from\s+home|wfh|virtual|flexible|anywhere)\s*$/i;

/**
 * Returns true when a location string is worth sending to Places API.
 * Filters out:
 *   - Remote/hybrid/WFH labels (no physical address to geocode)
 *   - Internal store codes starting with digits ("00212 - Rhode Island CVS...")
 *   - Bare state/country abbreviations ("VA", "US", "GB")
 */
export function hasGeocodeableCity(location: string): boolean {
  const t = location.trim();
  if (!t) return false;
  if (NON_GEOGRAPHIC_RE.test(t)) return false; // workplace label, not a city
  if (/^\d/.test(t)) return false;             // starts with digit = internal store code
  return /[A-Za-z]{4,}/.test(t);              // must contain a word ≥4 letters = real city name
}

/**
 * Normalize ATS location strings to a geocoder-friendly format.
 *   "TX-Houston"        → "Houston, TX"
 *   "GA-Atlanta"        → "Atlanta, GA"
 *   "US-CA-San Jose"    → "San Jose, CA, US"
 *   Anything else       → unchanged
 */
export function normalizeLocationForGeocode(location: string): string {
  const t = location.trim();

  // "{STATE}-{City}" (2-letter state prefix common in Dominos/Dollar Tree ATS)
  const stateCity = t.match(/^([A-Z]{2})-(.+)$/);
  if (stateCity) return `${stateCity[2]}, ${stateCity[1]}`;

  // "{COUNTRY}-{STATE}-{City}" triple-part
  const countryStateCity = t.match(/^([A-Z]{2})-([A-Z]{2})-(.+)$/);
  if (countryStateCity) return `${countryStateCity[3]}, ${countryStateCity[2]}, ${countryStateCity[1]}`;

  return t;
}

/**
 * Geocode a text query via Places API (New) Text Search.
 * Results are KV-cached so each unique query costs at most one API call ever.
 * Returns null when no result is found or the API call fails.
 */
export async function placesGeocode(
  query: string,
  apiKey: string,
  kv?: KVNamespace,
): Promise<PlacesGeocodeResult | null> {
  if (!query?.trim()) return null;
  const trimmed = query.trim();
  const cacheKey = `${CACHE_PREFIX}${trimmed}`;

  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached !== null) {
      if (cached === "null") return null; // cached miss — don't retry
      const pipeIdx = cached.indexOf("|");
      const pipe2Idx = cached.indexOf("|", pipeIdx + 1);
      const lat = parseFloat(cached.slice(0, pipeIdx));
      const lng = parseFloat(cached.slice(pipeIdx + 1, pipe2Idx));
      const addr = cached.slice(pipe2Idx + 1);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng, formattedAddress: addr || trimmed };
    }
  }

  try {
    const res = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: trimmed, maxResultCount: 1 }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      places?: Array<{
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
      }>;
    };

    const place = data.places?.[0];

    if (!place?.location?.latitude || !place?.location?.longitude) {
      // Cache the miss so we don't re-query this exact string again
      if (kv) await kv.put(cacheKey, "null", { expirationTtl: CACHE_TTL });
      return null;
    }

    const result: PlacesGeocodeResult = {
      lat: place.location.latitude,
      lng: place.location.longitude,
      formattedAddress: place.formattedAddress ?? trimmed,
    };

    if (kv) {
      await kv.put(
        cacheKey,
        `${result.lat}|${result.lng}|${result.formattedAddress}`,
        { expirationTtl: CACHE_TTL },
      );
    }

    return result;
  } catch {
    return null;
  }
}
