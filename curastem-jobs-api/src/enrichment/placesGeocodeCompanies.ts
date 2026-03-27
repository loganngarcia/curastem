/**
 * Places API (New) geocoding for companies and jobs.
 *
 * Company pass: runs each cron cycle, picks up any company that gained a city
 * or address from Exa enrichment but has no coordinates yet. On failure the
 * hq_geocode_failed_at timestamp is set so the company is never retried —
 * unless its hq_city/hq_country/hq_address is later updated (which clears the flag).
 *
 * Job pass: runs each cron cycle for a fixed whitelist of retail/franchise
 * companies whose jobs are spread across many physical locations. These companies
 * have many stores so city-level HQ coords are useless for map placement.
 *
 * Cost reference: $0.032 per Places API (New) Text Search request (2025).
 *   Company pass: only new companies without coords, so volume is always small.
 *   Job pass: capped at JOB_GEOCODE_BATCH per cron run.
 */

import { listCompaniesNeedingPlacesGeocode, listJobsNeedingPlacesGeocode, updateCompanyEnrichment } from "../db/queries.ts";
import { placesGeocode } from "../utils/placesGeocode.ts";
import { logger } from "../utils/logger.ts";

/** Max companies to geocode per cron run. Small because new companies trickle in slowly. */
const COMPANY_GEOCODE_BATCH = 20;

/** Max jobs to geocode per cron run for the whitelisted companies. */
const JOB_GEOCODE_BATCH = 200;

/**
 * Company slugs whose individual job locations are geocoded with Places API
 * instead of city-level Photon/Nominatim. These are retail/franchise chains
 * where precise store addresses matter for map placement.
 *
 * Add a slug here to opt a company in. Slug must match the companies.slug column.
 */
export const PER_JOB_GEOCODE_COMPANY_SLUGS: ReadonlySet<string> = new Set([
  "dominos-pizza",
  "dominos",
  "cvs-health",
  "cvs-pharmacy",
  "dollar-tree-family-dollar",
  "dollar-tree",
  "family-dollar",
  "walgreens",
  "walmart",
  "target",
  "mcdonalds",
  "starbucks",
  "home-depot",
  "lowes",
  "ups",
  "fedex",
  "amazon",
]);

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

/**
 * Geocode individual job locations for whitelisted retail/franchise companies.
 * Each job gets a query like "CVS Health 1234 Main St, Springfield, OH" for
 * precise store-level coordinates instead of city-level HQ coords.
 */
export async function runJobPlacesGeocode(
  db: D1Database,
  apiKey: string,
): Promise<void> {
  const jobs = await listJobsNeedingPlacesGeocode(
    db,
    [...PER_JOB_GEOCODE_COMPANY_SLUGS],
    JOB_GEOCODE_BATCH,
  );
  if (jobs.length === 0) return;

  logger.info("job_places_geocode_started", { count: jobs.length });
  const updates: Array<{ location: string; lat: number; lng: number }> = [];

  // Deduplicate by (company_name, location_primary) so identical store locations
  // in the same batch only cost one API call.
  const seen = new Map<string, { lat: number; lng: number } | null>();

  for (const job of jobs) {
    const cacheKey = `${job.company_name}|${job.location_primary}`;

    if (!seen.has(cacheKey)) {
      const query = `${job.company_name} ${job.location_primary}`;
      const result = await placesGeocode(query, apiKey);
      seen.set(cacheKey, result ? { lat: result.lat, lng: result.lng } : null);
      await new Promise((r) => setTimeout(r, 50));
    }

    const coords = seen.get(cacheKey);
    if (coords) {
      updates.push({ location: job.location_primary, lat: coords.lat, lng: coords.lng });
    }
  }

  // Batch-update jobs by location string (same as the Photon backfill path)
  if (updates.length > 0) {
    const { updateJobsWithCoords } = await import("../db/queries.ts");
    let jobsUpdated = 0;
    for (const { location, lat, lng } of updates) {
      jobsUpdated += await updateJobsWithCoords(db, location, lat, lng);
    }
    logger.info("job_places_geocode_completed", {
      unique_locations: seen.size,
      jobs_updated: jobsUpdated,
    });
  }
}
