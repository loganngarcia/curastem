/**
 * Company HQ coordinates: try **Mapbox** when the top hit is address/place-quality
 * ({@link mapboxGeocodeForCompanyHq}), then **Google Places (New) Text Search** if
 * Mapbox misses or is too coarse. Requires at least one of `MAPBOX_ACCESS_TOKEN` or
 * `GOOGLE_MAPS_API_KEY`.
 *
 * Runs each cron cycle for companies with city/address but no `hq_lat`. On total
 * failure `hq_geocode_failed_at` is set — cleared when `hq_city` / `hq_country` /
 * `hq_address` is updated by enrichment.
 *
 * Cost: Places ~$0.032 per uncached Text Search (2025); Mapbox temporary tier + KV cache.
 */

import { listCompaniesNeedingPlacesGeocode, updateCompanyEnrichment } from "../db/queries.ts";
import { mapboxGeocodeForCompanyHq } from "../utils/mapboxGeocode.ts";
import { placesGeocode } from "../utils/placesGeocode.ts";
import { logger } from "../utils/logger.ts";

const COMPANY_GEOCODE_BATCH = 50;

/**
 * Geocode HQ for companies missing coordinates. Mapbox first when token present, then Places.
 */
export async function runCompanyPlacesGeocode(
  db: D1Database,
  googleMapsApiKey: string | undefined,
  kv: KVNamespace | undefined,
  mapboxAccessToken: string | undefined
): Promise<void> {
  const hasGoogle = Boolean(googleMapsApiKey?.trim());
  const hasMapbox = Boolean(mapboxAccessToken?.trim());
  if (!hasGoogle && !hasMapbox) {
    logger.warn("company_hq_geocode_skipped", { reason: "no_geocode_providers" });
    return;
  }

  const companies = await listCompaniesNeedingPlacesGeocode(db, COMPANY_GEOCODE_BATCH);
  if (companies.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  logger.info("company_hq_geocode_started", {
    count: companies.length,
    mapbox: hasMapbox,
    places: hasGoogle,
  });

  let updated = 0;
  let failed = 0;
  let viaMapbox = 0;
  let viaPlaces = 0;

  for (const company of companies) {
    const query = company.hq_address
      ? company.hq_address
      : company.hq_city
        ? `${company.name} ${company.hq_city}${company.hq_country ? ` ${company.hq_country}` : ""}`
        : company.name;

    let result: Awaited<ReturnType<typeof mapboxGeocodeForCompanyHq>> = null;
    let provider: "mapbox" | "places" | null = null;

    if (hasMapbox) {
      result = await mapboxGeocodeForCompanyHq(query, mapboxAccessToken!.trim(), kv);
      if (result) provider = "mapbox";
    }
    if (!result && hasGoogle) {
      result = await placesGeocode(query, googleMapsApiKey!.trim(), kv);
      if (result) provider = "places";
    }

    if (result && provider) {
      await updateCompanyEnrichment(db, company.id, {
        hq_lat: result.lat,
        hq_lng: result.lng,
        hq_address: company.hq_address ?? result.formattedAddress,
      });
      updated++;
      if (provider === "mapbox") viaMapbox++;
      else viaPlaces++;
      logger.info("company_hq_geocoded", {
        company_id: company.id,
        name: company.name,
        query,
        provider,
      });
    } else {
      await updateCompanyEnrichment(db, company.id, { hq_geocode_failed_at: now });
      failed++;
      logger.warn("company_hq_geocode_failed", { company_id: company.id, name: company.name, query });
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  logger.info("company_hq_geocode_completed", {
    updated,
    failed,
    via_mapbox: viaMapbox,
    via_places: viaPlaces,
  });
}
