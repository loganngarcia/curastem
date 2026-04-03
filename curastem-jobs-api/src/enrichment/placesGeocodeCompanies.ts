/**
 * Places API (New) geocoding for company HQ coordinates.
 *
 * Company pass: runs each cron cycle, picks up any company that gained a city
 * or address from Exa enrichment but has no coordinates yet. On failure the
 * hq_geocode_failed_at timestamp is set so the company is never retried —
 * unless its hq_city/hq_country/hq_address is later updated (which clears the flag).
 *
 * Per-job geocoding is handled inline during ingestion (runner.ts Phase 4b)
 * using two-tier routing from retailGeocode.ts:
 *   - Retail/franchise company slugs + retail job titles → Photon (free, city-level)
 *   - Title-embedded street addresses (Dominos-style) → Nominatim (free, precise)
 *   - Professional companies → Places API ($0.032/req, precise)
 *
 * Cost reference: $0.032 per Places API (New) Text Search request (2025).
 *   Company pass: only new companies without coords, so volume is always small.
 */

import { listCompaniesNeedingPlacesGeocode, updateCompanyEnrichment } from "../db/queries.ts";
import { placesGeocode } from "../utils/placesGeocode.ts";
import { logger } from "../utils/logger.ts";

/** Max companies to geocode per cron run. Small because new companies trickle in slowly. */
const COMPANY_GEOCODE_BATCH = 20;


/**
 * Geocode HQ coordinates for companies that have city/address data but no coords.
 * Runs once per cron; fast because volume is small (only newly-enriched companies).
 */
export async function runCompanyPlacesGeocode(
  db: D1Database,
  apiKey: string,
  kv?: KVNamespace,
): Promise<void> {
  const companies = await listCompaniesNeedingPlacesGeocode(db, COMPANY_GEOCODE_BATCH);
  if (companies.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  logger.info("company_places_geocode_started", { count: companies.length });
  let updated = 0, failed = 0;

  for (const company of companies) {
    // Prefer existing address for highest precision; fall back to name + city
    const query = company.hq_address
      ? company.hq_address
      : company.hq_city
        ? `${company.name} ${company.hq_city}${company.hq_country ? ` ${company.hq_country}` : ""}`
        : company.name;

    const result = await placesGeocode(query, apiKey, kv);

    if (result) {
      await updateCompanyEnrichment(db, company.id, {
        hq_lat: result.lat,
        hq_lng: result.lng,
        // Only backfill address if we don't already have one
        hq_address: company.hq_address ?? result.formattedAddress,
      });
      updated++;
      logger.info("company_places_geocoded", { company_id: company.id, name: company.name, query });
    } else {
      await updateCompanyEnrichment(db, company.id, { hq_geocode_failed_at: now });
      failed++;
      logger.warn("company_places_geocode_failed", { company_id: company.id, name: company.name, query });
    }

    // 50ms between requests — well within Places API limits
    await new Promise((r) => setTimeout(r, 50));
  }

  logger.info("company_places_geocode_completed", { updated, failed });
}

