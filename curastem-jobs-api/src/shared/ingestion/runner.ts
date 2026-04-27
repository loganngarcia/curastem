/**
 * Ingestion cron runner.
 *
 * Called by the Cloudflare Scheduled Worker trigger (every hour, cron: "0 * * * *").
 *
 * Flow per source:
 *   1. Fetch all open jobs from the source API.
 *   2. For each job:
 *      a. Upsert the company record.
 *      b. Check cross-source deduplication.
 *      c. Upsert the job record.
 *   3. Update the source's last_fetched_at and job count in D1.
 *   4. Log structured results.
 *
 * After all sources are processed, company enrichment runs as a
 * best-effort background task (does not affect ingestion success/failure).
 *
 * All source failures are isolated — one bad source never blocks others.
 */

import {
  batchCheckCrossSourceDups,
  batchDeleteJobsSupersededByHigherPriority,
  batchGetExistingJobs,
  batchMarkJobsEmbedded,
  batchUpsertJobs,
  batchGetCompanyLocationCoords,
  getGeocodeByLocationKeyFromAnyCompany,
  upsertCompanyLocationGeocode,
  getJobsNeedingEmbedding,
  getLocationsNeedingGeocode,
  getSourceById,
  listEnabledSources,
  resolveCompanySlug,
  updateCompanyLocations,
  updateJobsWithCoords,
  updateSourceFetchResult,
  upsertCompany,
} from "../db/queries.ts";
import { backfillConsiderDescriptions } from "../enrichment/consider-descriptions.ts";
import { backfillWorkdayDescriptions } from "../enrichment/workday-descriptions.ts";
import { embedJob } from "../enrichment/ai.ts";
import { runCompanyEnrichment, runExaEnrichment } from "../enrichment/company.ts";
import { runCompanyPlacesGeocode } from "../enrichment/placesGeocodeCompanies.ts";
import { runWikidataEducationWebsiteBatch } from "../enrichment/wikidataEducationWebsite.ts";
import { runCompanyWebsiteProbeBatch } from "../enrichment/websiteProbe.ts";
import { getFetcher, getSourcePriority, SOURCE_PRIORITY } from "./registry.ts";
import { geocode, geocodeAddress, geocodeWithMapboxFirst } from "../utils/geocode.ts";
import { mapboxGeocodeIngestForJobPair } from "../utils/mapboxGeocode.ts";
import {
  placesGeocode,
  hasGeocodeableCity,
  normalizeLocationForGeocode,
  type PlacesGeocodeResult,
} from "../utils/placesGeocode.ts";
import { RETAIL_GEOCODE_SLUGS, RETAIL_TITLE_RE } from "../utils/retailGeocode.ts";
import type { Env, IngestionResult, SourceRow } from "../types.ts";
import {
  buildDedupKey,
  buildJobId,
  extractFullUsAddressFromDescription,
  extractLocationStreetAddress,
  extractTitleStreetAddress,
  locationsJsonToEmbedString,
  locationsRawToEmbedString,
  primaryNormalizedLocation,
  slugify,
  uuidv4,
} from "../utils/normalize.ts";
import { logger } from "../utils/logger.ts";

/**
 * Maximum wall-clock time for a single source's fetch() call.
 *
 * Retail chains and other large sources (Dick's, Nordstrom, Macy's, etc.) can
 * have tens of thousands of jobs and paginate for many minutes on their first
 * run. Without a cap, a single slow source kills the entire cron — the Worker
 * hits Cloudflare's 15-minute scheduled-handler limit and is forcefully
 * terminated before the catch block can write to KV or update last_fetched_at
 * for any source, causing an infinite deadlock.
 *
 * 90 seconds: comfortably covers the ~15s Workday sources we already handle
 * and the ~46s a16z first-run. Large-company first-run jobs are ingested
 * incrementally over multiple cron cycles rather than all at once.
 */
const SOURCE_FETCH_TIMEOUT_MS = 90_000;
/** Getro: sitemap + up to 1k `/_next/data` JSON fetches per run — needs headroom vs 90s default. */
const GETRO_FETCH_TIMEOUT_MS = 180_000;
/**
 * Workday: two-phase fetcher (list pagination + detail page GETs) on large enterprise tenants
 * (Walmart, CVS, Boeing, etc.) can take 90-120s. Give it extra headroom without hitting
 * the cron 900s wall — each source still finishes well under the SOURCE_BUDGET_MS cap.
 */
const WORKDAY_FETCH_TIMEOUT_MS = 150_000;
/**
 * Phenom + Activate Careers: large retail tenants (Lowe's 10k+, Ross, Panera) paginate
 * many sitemap chunks and fetch individual job detail pages — same problem as Workday.
 */
const PHENOM_FETCH_TIMEOUT_MS = 150_000;
/** SAP SF RMK: sitemap + parallel job HTML pages (Burberry ~150 × ~1 MB responses). */
const SUCCESSFACTORS_RMK_FETCH_TIMEOUT_MS = 150_000;
/** Oracle Activate: list + thousands of parallel jobdetail GETs (Darden, Ross). */
const ACTIVATE_CAREERS_FETCH_TIMEOUT_MS = 600_000;
/**
 * Eightfold: parallel list page fan-out + per-position detail fetches. Microsoft alone
 * has ~2400 positions. With LIST_CONCURRENCY=20 the list phase takes ~5s, but detail
 * fetches for 2000+ positions at DETAIL_CONCURRENCY=16 can take 60-90s on their own.
 */
const EIGHTFOLD_FETCH_TIMEOUT_MS = 300_000;
/** HCA: ~430 regional search GETs + up to 500 parallel detail GETs — needs headroom vs 90s default. */
const HCA_CAREERS_FETCH_TIMEOUT_MS = 300_000;
/** Oracle CE (Marriott): list + ~11k parallel ById detail GETs for ExternalDescriptionStr HTML. */
const ORACLE_CE_FETCH_TIMEOUT_MS = 300_000;
/** Aramark: JSON list + ~5k parallel job-page GETs for JSON-LD descriptions. */
const ARAMARK_CAREERS_FETCH_TIMEOUT_MS = 300_000;
/** BrassRing: GET home + paginated PowerSearchJobs POSTs (~50 rows per page); large tenants (e.g. Walgreens ~500) need headroom. */
const BRASSRING_FETCH_TIMEOUT_MS = 300_000;
/** Jobsyn: paginated listing + optional per-job detail fetches; needs headroom for large tenant crawls. */
const JOBSYN_FETCH_TIMEOUT_MS = 180_000;
/** Taleo InFlight: multiple portals × paginated POST searchjobs (list-only, no per-job HTML). */
const TALEO_FETCH_TIMEOUT_MS = 120_000;

/**
 * Process a single ingestion source.
 * Returns an IngestionResult with counts and timing for observability.
 *
 * Receives the full Env so it can access Vectorize and the Gemini API key
 * for embedding generation. Embedding is fire-and-forget per job — a failed
 * embedding never blocks ingestion and will be retried on the next cron run
 * (since embedding_generated_at stays NULL until explicitly marked).
 */
async function processSource(
  env: Env,
  source: SourceRow,
  skipEmbeddings = false,
  jobLimit?: number,
  /** Slice into `fetch()` results after download — `POST /admin/trigger?offset=&limit=` for huge sources (e.g. IBM). */
  jobOffset?: number
): Promise<IngestionResult> {
  const db = env.JOBS_DB;
  const start = Date.now();
  const result: IngestionResult = {
    source_id: source.id,
    source_name: source.name,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    deduplicated: 0,
    failed: 0,
    error: null,
    duration_ms: 0,
  };

  const fetcher = getFetcher(source.source_type);
  if (!fetcher) {
    result.error = `No fetcher registered for source_type: ${source.source_type}`;
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Dedup uses getSourcePriority(source_name); missing SOURCE_PRIORITY entry silently becomes 50.
  if (
    getSourcePriority(source.source_type) === 50 &&
    !Object.prototype.hasOwnProperty.call(SOURCE_PRIORITY, source.source_type)
  ) {
    logger.warn("source_type_default_priority_not_in_source_priority", {
      source_id: source.id,
      source_type: source.source_type,
    });
  }

  let rawJobs: Awaited<ReturnType<typeof fetcher.fetch>>;
  try {
    const fetchTimeoutMs =
      source.source_type === "getro" ? GETRO_FETCH_TIMEOUT_MS :
      source.source_type === "workday" ? WORKDAY_FETCH_TIMEOUT_MS :
      source.source_type === "phenom" ? PHENOM_FETCH_TIMEOUT_MS :
      source.source_type === "successfactors_rmk" ? SUCCESSFACTORS_RMK_FETCH_TIMEOUT_MS :
      source.source_type === "activate_careers" ? ACTIVATE_CAREERS_FETCH_TIMEOUT_MS :
      source.source_type === "eightfold" ? EIGHTFOLD_FETCH_TIMEOUT_MS :
      // Google: ~4000 jobs × PAGE_CONCURRENCY=4 pages at ~650ms each = ~650s if fully sequential;
      // with concurrency and early-stop, real runs land around 90-180s. Give generous budget.
      source.source_type === "google" ? 300_000 :
      // Netflix: sitemap (1 req) + ~640 position_details at DETAIL_CONCURRENCY=6 ≈ 60-90s total.
      source.source_type === "netflix" ? 180_000 :
      // TikTok: ~3400 global jobs at 100/page = ~35 POST requests ≈ 30-60s.
      source.source_type === "tiktok" ? 120_000 :
      source.source_type === "hca" ? HCA_CAREERS_FETCH_TIMEOUT_MS :
      // Hub listing + ~1k iframe job pages (JSON-LD detail)
      source.source_type === "icims_portal" ? 240_000 :
      source.source_type === "oracle_ce" ? ORACLE_CE_FETCH_TIMEOUT_MS :
      source.source_type === "aramark" ? ARAMARK_CAREERS_FETCH_TIMEOUT_MS :
      source.source_type === "brassring" ? BRASSRING_FETCH_TIMEOUT_MS :
      source.source_type === "jobsyn" ? JOBSYN_FETCH_TIMEOUT_MS :
      source.source_type === "taleo" ? TALEO_FETCH_TIMEOUT_MS :
      // WFN: list pages + one detail GET per job (parallel batches)
      source.source_type === "adp_wfn_recruitment" ? 150_000 :
      // Avature: RSS + one JobDetail HTML fetch per item (parallel)
      source.source_type === "avature" ? 120_000 :
      SOURCE_FETCH_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`fetch timed out after ${fetchTimeoutMs}ms`)),
        fetchTimeoutMs
      )
    );
    rawJobs = await Promise.race([fetcher.fetch(source, env), timeoutPromise]);
    result.fetched = rawJobs.length;
  } catch (err) {
    result.error = String(err);
    result.duration_ms = Date.now() - start;
    await updateSourceFetchResult(db, source.id, Math.floor(Date.now() / 1000), 0, result.error);
    return result;
  }

  const now = Math.floor(Date.now() / 1000);

  // Collect embeddings generated during this source run so they can be
  // flushed to Vectorize in a single batch call rather than one call per job.
  const pendingVectors: Array<{ id: string; values: number[] }> = [];

  // Optional slice for admin trigger — large single-source runs can exceed D1 limits if processed at once.
  const sliceStart = jobOffset != null && jobOffset > 0 ? jobOffset : 0;
  const sliceEnd = jobLimit != null ? sliceStart + jobLimit : undefined;
  let jobsToProcess =
    sliceStart > 0 || sliceEnd != null ? rawJobs.slice(sliceStart, sliceEnd) : rawJobs;
  // ── Phase 1: Upsert unique companies ──────────────────────────────────────
  // Cache slug → companyId so single-company sources (Greenhouse, Lever, Ashby,
  // Workday) only pay 1 D1 subrequest for the company instead of N (one per job).
  // slug → canonical slug (after alias resolution) → company id
  const aliasCache  = new Map<string, string>(); // raw slug → canonical slug
  const companyCache = new Map<string, string>(); // canonical slug → company id
  for (const normalized of jobsToProcess) {
    const rawSlug = slugify(normalized.company_name);
    if (!aliasCache.has(rawSlug)) {
      try {
        aliasCache.set(rawSlug, await resolveCompanySlug(db, rawSlug));
      } catch {
        aliasCache.set(rawSlug, rawSlug); // fall back to raw slug on DB error
      }
    }
    const slug = aliasCache.get(rawSlug)!;
    if (!companyCache.has(slug)) {
      try {
        const id = await upsertCompany(
          db, uuidv4(), normalized.company_name, slug, now,
          normalized.company_logo_url, normalized.company_website_url
        );
        companyCache.set(slug, id);
      } catch (err) {
        logger.warn("company_upsert_failed", { slug, error: String(err) });
      }
    }
  }

  // ── Phase 2: Build per-job metadata ───────────────────────────────────────
  type JobMeta = {
    jobId: string;
    companyId: string;
    dedupKey: string;
    normalized: (typeof jobsToProcess)[number];
  };
  const jobMetas: JobMeta[] = [];
  for (const normalized of jobsToProcess) {
    // Skip jobs with missing required fields rather than letting them crash the batch
    if (!normalized.external_id || !normalized.title || !normalized.company_name) {
      result.failed++;
      logger.warn("job_skipped_missing_fields", {
        source_id: source.id,
        external_id: normalized.external_id,
        title: normalized.title,
        company: normalized.company_name,
      });
      continue;
    }
    const slug    = aliasCache.get(slugify(normalized.company_name)) ?? slugify(normalized.company_name);
    const companyId = companyCache.get(slug);
    if (!companyId) { result.failed++; continue; }
    jobMetas.push({
      jobId:    buildJobId(source.id, normalized.external_id),
      companyId,
      dedupKey: buildDedupKey(normalized.title, slug),
      normalized,
    });
  }

  // ── Phase 3: Cross-source dedup ───────────────────────────────────────────
  // Resolve priority once; pass a resolver callback so queries.ts stays free
  // of any dependency on the ingestion registry.
  const incomingPriority = getSourcePriority(source.source_type);

  let dupSet: Set<string>;
  try {
    dupSet = await batchCheckCrossSourceDups(
      db,
      source.id,
      incomingPriority,
      getSourcePriority,
      jobMetas.map((m) => m.dedupKey)
    );
  } catch (err) {
    logger.warn("dedup_check_failed", { source_id: source.id, error: String(err) });
    dupSet = new Set(); // proceed without dedup rather than dropping all jobs
  }

  let nonDupMetas = jobMetas.filter(({ dedupKey }) => {
    if (dupSet.has(dedupKey)) { result.deduplicated++; return false; }
    return true;
  });

  // ── Phase 3b: Drop lower-priority rows so this source can own the dedup_key ─
  try {
    const superseded = await batchDeleteJobsSupersededByHigherPriority(
      db,
      source.id,
      incomingPriority,
      getSourcePriority,
      nonDupMetas.map((m) => m.dedupKey),
      env.JOBS_VECTORS
    );
    if (superseded > 0) {
      logger.info("dedup_superseded_lower_priority", { source_id: source.id, deleted: superseded });
    }
  } catch (err) {
    logger.warn("dedup_supersede_failed", { source_id: source.id, error: String(err) });
  }

  // ── Phase 4: Batch check existing jobs — 1 D1 subrequest total ────────────
  let existingMap: Map<string, { id: string; description_raw: string | null }>;
  try {
    existingMap = await batchGetExistingJobs(
      db,
      source.id,
      nonDupMetas.map((m) => m.normalized.external_id)
    );
  } catch (err) {
    logger.warn("existing_jobs_check_failed", { source_id: source.id, error: String(err) });
    existingMap = new Map(); // treat all as new inserts
  }

  // ── Phase 4b: Inline geocode unique primary locations ──────────────────────
  // Strategy:
  //   0. Full street address + city → geocodeAddress() (Mapbox, then Google Geocoding, etc.).
  //   1. company_location_geocodes D1 cache.
  //   2. Cache miss (non-retail) → Mapbox "company + city" (metro then CONUS loose), then
  //      Google Places. Previously metro-only; non-metro locations use the same premium stack.
  //   3. Otherwise → geocode(): majorMetros first (no HTTP), then Photon/Nominatim.
  // 500 premium calls per source run; D1/KV cache keeps repeat work cheap.
  const INLINE_GEOCODE_CAP = 500;

  // Step 0: Precise address geocoding for jobs that have a full street address.
  //
  // Uses Geocoding API ($0.005/req) with Nominatim fallback (free).
  // Deduplicates by full address first so multiple jobs at the same store
  // (e.g. "Dishwasher" + "Delivery Driver" both at "3275 Henry St, Watertown, WI")
  // share one API call — subsequent lookups hit KV cache at zero cost.
  //
  // keyed by jobId → {lat, lng} so it can be applied at upsert time.
  const jobAddressCoords = new Map<string, { lat: number; lng: number }>();

  // Collect (jobId, fullAddress) pairs
  const addrJobs: Array<{ jobId: string; fullAddress: string }> = [];
  for (const m of nonDupMetas) {
    // Priority: AI-enriched job_address → title-embedded → ATS location field →
    // full address in HTML description (Carvana "Working Location:", Foundever, etc.)
    const streetAddr =
      (m.normalized as { job_address?: string | null }).job_address?.trim() ||
      extractTitleStreetAddress(m.normalized.title ?? "") ||
      extractLocationStreetAddress(m.normalized.location);

    const slug = aliasCache.get(slugify(m.normalized.company_name)) ?? slugify(m.normalized.company_name);
    const rawLoc = primaryNormalizedLocation(m.normalized.location, slug);
    if (!rawLoc || /^\d|\bremote\b/i.test(rawLoc)) continue;
    const locKey = normalizeLocationForGeocode(rawLoc);
    if (!locKey || !hasGeocodeableCity(locKey)) continue;

    if (!streetAddr) {
      const descFull = extractFullUsAddressFromDescription(m.normalized.description_raw);
      if (descFull) {
        addrJobs.push({ jobId: m.jobId, fullAddress: descFull });
      }
      continue;
    }

    addrJobs.push({ jobId: m.jobId, fullAddress: `${streetAddr}, ${locKey}` });
  }

  // Geocode each unique address once; all jobs at the same address share the result
  const addrCache = new Map<string, { lat: number; lng: number } | null>();
  for (const { fullAddress } of addrJobs) {
    if (addrCache.has(fullAddress)) continue;
    try {
      const result = await geocodeAddress(
        fullAddress,
        env.GOOGLE_MAPS_API_KEY,
        env.RATE_LIMIT_KV,
        env.MAPBOX_ACCESS_TOKEN
      );
      addrCache.set(fullAddress, result ? { lat: result.lat, lng: result.lng } : null);
      if (result?.usedNominatim) await new Promise((r) => setTimeout(r, 1100));
    } catch {
      addrCache.set(fullAddress, null);
    }
  }

  for (const { jobId, fullAddress } of addrJobs) {
    const coords = addrCache.get(fullAddress);
    if (coords) jobAddressCoords.set(jobId, coords);
  }

  // Build unique (companyId, normalizedLocation) pairs; flag retail-like pairs so we
  // skip Mapbox/Places and use Photon (city-level) — saves quota for Dominos-type volume.
  const pairsToCheck: Array<{ company_id: string; location_key: string; company_name: string }> = [];
  const seenPairKeys = new Set<string>();
  const pairIsRetail = new Map<string, boolean>();
  for (const m of nonDupMetas) {
    const slug =
      aliasCache.get(slugify(m.normalized.company_name)) ?? slugify(m.normalized.company_name);
    const rawLoc = primaryNormalizedLocation(m.normalized.location, slug);
    if (!rawLoc?.trim()) continue;
    const locationKey = normalizeLocationForGeocode(rawLoc);
    const pairKey = `${m.companyId}|${locationKey}`;
    if (!seenPairKeys.has(pairKey)) {
      seenPairKeys.add(pairKey);
      pairsToCheck.push({ company_id: m.companyId, location_key: locationKey, company_name: m.normalized.company_name });
    }
    if (!pairIsRetail.get(pairKey)) {
      const isRetail =
        RETAIL_GEOCODE_SLUGS.has(slug) || RETAIL_TITLE_RE.test(m.normalized.title ?? "");
      if (isRetail) pairIsRetail.set(pairKey, true);
    }
  }

  // Batch-lookup D1 cache first — wrap in try/catch so a D1 variable-limit error
  // (sources with >90 unique locations) degrades to cache-miss, not a source crash.
  let cachedCoords: Awaited<ReturnType<typeof batchGetCompanyLocationCoords>>;
  try {
    cachedCoords = await batchGetCompanyLocationCoords(db, pairsToCheck);
  } catch (err) {
    logger.warn("geocode_cache_lookup_failed", { source_id: source.id, error: String(err) });
    cachedCoords = new Map();
  }

  // locationToCoords: keyed by original raw location string (before normalization)
  // so we can look up coords when building upsert inputs below
  const locationToCoords = new Map<string, { lat: number; lng: number }>();

  // Populate from D1 cache hits
  for (const { company_id, location_key, company_name: _ } of pairsToCheck) {
    const cached = cachedCoords.get(`${company_id}|${location_key}`);
    if (cached) locationToCoords.set(location_key, { lat: cached.lat, lng: cached.lng });
  }

  // Non-retail cache misses → Mapbox (major-metro or CONUS loose) then Places; cap per run.
  // Retail pairs skip premium APIs and go to Photon below.
  const allMisses = pairsToCheck.filter(
    (p) => !cachedCoords.has(`${p.company_id}|${p.location_key}`) && hasGeocodeableCity(p.location_key)
  );
  const premiumMisses = allMisses
    .filter((p) => !pairIsRetail.get(`${p.company_id}|${p.location_key}`))
    .slice(0, INLINE_GEOCODE_CAP);

  let mapboxApiCalls = 0;
  let placesApiCalls = 0;
  /** location_key values where Mapbox/Places ran and returned no usable hit — peer city fallback applies */
  const placeSearchMissKeys = new Set<string>();
  for (const { company_id, location_key, company_name } of premiumMisses) {
    if (locationToCoords.has(location_key)) continue;

    let result: PlacesGeocodeResult | null = null;
    let placeSearchAttempted = false;
    try {
      if (env.MAPBOX_ACCESS_TOKEN) {
        placeSearchAttempted = true;
        result = await mapboxGeocodeIngestForJobPair(
          company_name,
          location_key,
          env.MAPBOX_ACCESS_TOKEN,
          env.RATE_LIMIT_KV,
        );
        if (result) mapboxApiCalls++;
      }
      if (!result && env.GOOGLE_MAPS_API_KEY) {
        placeSearchAttempted = true;
        result = await placesGeocode(
          `${company_name} ${location_key}`,
          env.GOOGLE_MAPS_API_KEY,
          env.RATE_LIMIT_KV,
        );
        if (result) placesApiCalls++;
      }
      if (result) {
        locationToCoords.set(location_key, { lat: result.lat, lng: result.lng });
        await upsertCompanyLocationGeocode(db, {
          company_id,
          location_key,
          lat: result.lat,
          lng: result.lng,
          address: result.formattedAddress,
        });
      } else if (placeSearchAttempted) {
        placeSearchMissKeys.add(location_key);
      }
    } catch (err) {
      logger.warn("metro_geocode_inline_failed", { company_name, location_key, error: String(err) });
      if (placeSearchAttempted) placeSearchMissKeys.add(location_key);
    }
  }

  // After place search misses: reuse another company’s city-level coords for the same location string (D1).
  const peerKeys = [...placeSearchMissKeys].filter((k) => !locationToCoords.has(k));
  if (peerKeys.length > 0) {
    let peerCoords: Map<string, { lat: number; lng: number; address: string | null }>;
    try {
      peerCoords = await getGeocodeByLocationKeyFromAnyCompany(db, peerKeys);
    } catch (err) {
      logger.warn("geocode_peer_lookup_failed", { source_id: source.id, error: String(err) });
      peerCoords = new Map();
    }
    const peerKeySet = new Set(peerKeys);
    for (const p of pairsToCheck) {
      if (!peerKeySet.has(p.location_key)) continue;
      if (cachedCoords.has(`${p.company_id}|${p.location_key}`)) continue;
      const hit = peerCoords.get(p.location_key);
      if (!hit) continue;
      if (!locationToCoords.has(p.location_key)) {
        locationToCoords.set(p.location_key, { lat: hit.lat, lng: hit.lng });
      }
      try {
        await upsertCompanyLocationGeocode(db, {
          company_id: p.company_id,
          location_key: p.location_key,
          lat: hit.lat,
          lng: hit.lng,
          address: hit.address,
        });
      } catch (err) {
        logger.warn("geocode_peer_upsert_failed", { source_id: source.id, error: String(err) });
      }
    }
  }

  // Photon/Nominatim for non-metro and metro failures.
  // Build a reverse lookup so Photon results can also be persisted to D1 —
  // this ensures the batch D1 cache (batchGetCompanyLocationCoords) serves
  // these on the next cron run instead of always falling through to KV.
  const locationKeyToCompanyPairs = new Map<string, Array<{ company_id: string }>>();
  for (const p of pairsToCheck) {
    const arr = locationKeyToCompanyPairs.get(p.location_key) ?? [];
    arr.push({ company_id: p.company_id });
    locationKeyToCompanyPairs.set(p.location_key, arr);
  }

  const stillUnresolved = [...new Set(
    pairsToCheck
      .map((p) => p.location_key)
      .filter((k) => !locationToCoords.has(k))
  )];
  for (const loc of stillUnresolved) {
    try {
      const result = await geocode(loc, env.RATE_LIMIT_KV);
      if (result) {
        locationToCoords.set(loc, { lat: result.lat, lng: result.lng });
        // Persist to D1 so the next cron batch cache lookup skips Photon entirely
        const pairs = locationKeyToCompanyPairs.get(loc) ?? [];
        for (const { company_id } of pairs) {
          await upsertCompanyLocationGeocode(db, {
            company_id,
            location_key: loc,
            lat: result.lat,
            lng: result.lng,
            address: null,
          });
        }
        if (result.usedNominatim) await new Promise((r) => setTimeout(r, 1100));
      }
    } catch (err) {
      logger.warn("geocode_inline_fallback_failed", { location: loc, error: String(err) });
    }
  }

  if (mapboxApiCalls > 0 || placesApiCalls > 0) {
    logger.info("inline_geocode_metro_calls", {
      source_id: source.id,
      mapbox: mapboxApiCalls,
      places: placesApiCalls,
    });
  }

  // ── Phase 5: Batch INSERT new + UPDATE existing — 2 D1 subrequests total ──
  let upsertInputs = nonDupMetas.map(({ jobId, companyId, dedupKey, normalized }) => {
    const company_slug =
      aliasCache.get(slugify(normalized.company_name)) ?? slugify(normalized.company_name);
    const normLoc = primaryNormalizedLocation(normalized.location, company_slug);
    // Look up by normalized (geocoder-friendly) location key, not the raw ATS string
    const locationKey = normLoc ? normalizeLocationForGeocode(normLoc) : null;
    const cityCoords  = locationKey ? locationToCoords.get(locationKey) : null;
    // Per-job address coords (from title extraction or AI enrichment) take precedence
    // over city-level city coords — they give exact store/office coordinates for free.
    const coords = jobAddressCoords.get(jobId) ?? cityCoords;
    return {
      id:           jobId,
      company_id:   companyId,
      company_slug,
      source_id:    source.id,
      external_id:  normalized.external_id,
      source_name:  source.source_type,
      dedup_key:    dedupKey,
      normalized,
      now,
      location_lat: coords?.lat ?? null,
      location_lng: coords?.lng ?? null,
    };
  });

  // Guard: some ATS boards echo the same posting in multiple portfolio categories.
  // Deduplicate by external_id before upserting — first occurrence wins.
  const seenExternalIds = new Set<string>();
  const dedupedIndices: number[] = [];
  for (let i = 0; i < upsertInputs.length; i++) {
    const eid = upsertInputs[i].external_id;
    if (!seenExternalIds.has(eid)) {
      seenExternalIds.add(eid);
      dedupedIndices.push(i);
    }
  }
  if (dedupedIndices.length < upsertInputs.length) {
    logger.info("upsert_inputs_deduped", {
      source_id: source.id,
      before: upsertInputs.length,
      after: dedupedIndices.length,
    });
    upsertInputs = dedupedIndices.map((i) => upsertInputs[i]);
    nonDupMetas = dedupedIndices.map((i) => nonDupMetas[i]);
  }

  // D1 enforces a hard limit of 100 statements per db.batch() call.
  // UPSERT_JOBS_PER_DB_BATCH controls how many jobs are passed to batchUpsertJobs at once;
  // batchUpsertJobs itself further chunks into UPSERT_CHUNK=35 statements per db.batch().
  const UPSERT_JOBS_PER_DB_BATCH = 600;

  let upsertResults: Array<{ inserted: boolean; needsEmbedding: boolean }>;
  try {
    upsertResults = [];
    for (let start = 0; start < upsertInputs.length; start += UPSERT_JOBS_PER_DB_BATCH) {
      const slice = upsertInputs.slice(start, start + UPSERT_JOBS_PER_DB_BATCH);
      const part = await batchUpsertJobs(db, slice, existingMap);
      upsertResults.push(...part);
    }
  } catch (batchErr) {
    // Batch failed — retry one-by-one so a single bad job doesn't drop the whole source
    logger.warn("batch_upsert_failed_retrying_individually", { source_id: source.id, count: upsertInputs.length, error: String(batchErr) });
    upsertResults = [];
    for (const input of upsertInputs) {
      try {
        const [r] = await batchUpsertJobs(db, [input], existingMap);
        upsertResults.push(r);
      } catch (singleErr) {
        result.failed++;
        logger.warn("job_upsert_failed", { source_id: source.id, external_id: input.external_id, error: String(singleErr) });
        upsertResults.push({ inserted: false, needsEmbedding: false });
      }
    }
  }

  // ── Phase 6: Embed new/changed jobs at insert time ─────────────────────────
  // skipEmbeddings=true for single-source admin triggers (30s request limit).
  // Batched like embedding backfill — same concurrency as cron backfill pass.
  type EmbedTask = { jobId: string; normalized: (typeof jobsToProcess)[number] };
  const embedTasks: EmbedTask[] = [];
  for (let i = 0; i < upsertResults.length; i++) {
    const { inserted, needsEmbedding } = upsertResults[i];
    if (inserted) result.inserted++;
    else result.updated++;

    if (
      !skipEmbeddings &&
      needsEmbedding &&
      env.JOBS_VECTORS &&
      env.GEMINI_API_KEY
    ) {
      embedTasks.push({ jobId: nonDupMetas[i].jobId, normalized: nonDupMetas[i].normalized });
    }
  }

  for (let i = 0; i < embedTasks.length; i += EMBEDDING_CONCURRENCY) {
    const chunk = embedTasks.slice(i, i + EMBEDDING_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(({ jobId, normalized }) =>
        embedJob(
          env.GEMINI_API_KEY!,
          normalized.title,
          normalized.company_name,
          locationsRawToEmbedString(normalized.location),
          normalized.description_raw
        ).then((values) => ({ id: jobId, values }))
      )
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled") pendingVectors.push(r.value);
      else logger.warn("job_embedding_failed", { job_id: chunk[j].jobId, error: String(r.reason) });
    }
  }

  // Flush all vectors for this source in one Vectorize call and one D1 batch,
  // instead of N individual calls. Vectorize accepts up to 1,000 vectors per
  // upsert; at current source sizes we never approach that limit.
  if (pendingVectors.length > 0 && env.JOBS_VECTORS) {
    try {
      await env.JOBS_VECTORS.upsert(pendingVectors);
      await batchMarkJobsEmbedded(db, pendingVectors.map((v) => v.id), now);
    } catch (flushErr) {
      // Non-fatal: jobs are in D1, backfill will retry the embeddings next run
      logger.warn("job_embedding_batch_flush_failed", {
        source_id: source.id,
        count: pendingVectors.length,
        error: String(flushErr),
      });
    }
  }

  // Aggregate job locations into each affected company record
  const uniqueCompanyIds = new Set(nonDupMetas.map((m) => m.companyId));
  for (const cid of uniqueCompanyIds) {
    try {
      await updateCompanyLocations(db, cid);
    } catch (locErr) {
      logger.warn("company_locations_update_failed", { source_id: source.id, company_id: cid, error: String(locErr) });
    }
  }

  if (env.ENRICHMENT_QUEUE && uniqueCompanyIds.size > 0) {
    const ids = [...uniqueCompanyIds];
    const ENRICH_SEND_CHUNK = 100;
    try {
      for (let i = 0; i < ids.length; i += ENRICH_SEND_CHUNK) {
        await env.ENRICHMENT_QUEUE.sendBatch(
          ids.slice(i, i + ENRICH_SEND_CHUNK).map((companyId) => ({ body: { companyId } }))
        );
      }
    } catch (qErr) {
      logger.warn("enrichment_queue_send_failed", { source_id: source.id, error: String(qErr) });
    }
  }

  await updateSourceFetchResult(db, source.id, now, result.fetched, null);
  result.duration_ms = Date.now() - start;
  return result;
}

/**
 * How many jobs to embed per cron run during the backfill pass.
 *
 * Workers Paid hard cap: 1,000 subrequests per invocation (cron included).
 * Subrequests are outbound fetch() calls; D1 queries are internal and free.
 *
 * Worst-case budget per run (5 Getro + 7 Consider sources in initial batch):
 *   500  Getro detail fetches     (5 boards × 100 GETRO_JOBS_PER_RUN + overhead)
 *   182  Consider search-jobs     (7 boards × ~26 fetches each)
 *   125  embedding Gemini fetches ← this constant
 *   100  geocode Photon fetches
 *   ~50  Workday/Consider description backfills
 *   ~30  Exa / Brandfetch enrichment fetches
 *   ─────────────────────────────────────────────────────────
 *   ~962 total — under the 1,000 ceiling with ~38 headroom
 *
 * Speed: requests run 5 concurrent → 100 / 5 = 20 batches × ~250ms = ~5s wall clock.
 */
// Slightly higher because queue-driven ingestion can still leave gaps if a source times out.
const EMBEDDING_BACKFILL_BATCH = 125;
const EMBEDDING_CONCURRENCY    = 5;

/**
 * Backfill Vectorize embeddings for jobs that were ingested but never embedded.
 *
 * This runs at the end of every cron invocation. It is the safety net for
 * three failure scenarios:
 *   1. The cron timed out mid-embedding on a previous run.
 *   2. The Gemini API was unavailable when the job was first ingested.
 *   3. Jobs were inserted before Vectorize was configured.
 *
 * It processes at most EMBEDDING_BACKFILL_BATCH jobs per run, ordered
 * newest-first so recently posted jobs become searchable before old ones.
 * A missed embedding on one run is simply retried on the next hourly run.
 */
export async function backfillEmbeddings(env: Env, limit = EMBEDDING_BACKFILL_BATCH): Promise<{
  succeeded: number;
  failed: number;
  total: number;
}> {
  if (!env.JOBS_VECTORS || !env.GEMINI_API_KEY) {
    logger.warn("embedding_backfill_skipped", { reason: "Vectorize or GEMINI_API_KEY not configured" });
    return { succeeded: 0, failed: 0, total: 0 };
  }

  const jobs = await getJobsNeedingEmbedding(env.JOBS_DB, limit);

  if (jobs.length === 0) {
    logger.info("embedding_backfill_skipped", { reason: "no jobs missing embeddings" });
    return { succeeded: 0, failed: 0, total: 0 };
  }

  logger.info("embedding_backfill_started", { count: jobs.length });
  const now = Math.floor(Date.now() / 1000);

  // Phase 1: call Gemini for each job — EMBEDDING_CONCURRENCY concurrent at a time.
  // Parallel requests stay well within the 150 RPM Gemini limit while cutting
  // wall-clock time from ~50s sequential to ~10s for 200 jobs.
  // Collect successes; failures stay NULL and are retried next run.
  const vectors: Array<{ id: string; values: number[] }> = [];
  let failed = 0;

  for (let i = 0; i < jobs.length; i += EMBEDDING_CONCURRENCY) {
    const batch = jobs.slice(i, i + EMBEDDING_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((job) => {
        const locText = locationsJsonToEmbedString(job.locations) ?? job.location_primary;
        return embedJob(
          env.GEMINI_API_KEY!,
          job.title,
          job.company_name,
          locText,
          job.description_raw
        ).then((values) => ({ id: job.id, values }));
      })
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        vectors.push(r.value);
      } else {
        failed++;
        logger.warn("embedding_backfill_job_failed", { error: String(r.reason) });
      }
    }
  }

  // Phase 2: flush all successful vectors in ONE Vectorize call and ONE D1
  // batch instead of N individual calls each. Vectorize supports up to 1,000
  // vectors per upsert; our EMBEDDING_BACKFILL_BATCH (500) stays under that.
  if (vectors.length > 0) {
    await env.JOBS_VECTORS.upsert(vectors);
    await batchMarkJobsEmbedded(env.JOBS_DB, vectors.map((v) => v.id), now);
  }

  logger.info("embedding_backfill_completed", {
    succeeded: vectors.length,
    failed,
    total: jobs.length,
  });
  return { succeeded: vectors.length, failed, total: jobs.length };
}

// Photon ~100ms each → 100 × 100ms = 10s. Nominatim (rare) adds 1.1s/call.
// Reduced from 200 to preserve subrequest budget (see EMBEDDING_BACKFILL_BATCH comment).
// At 100/run × 24/day = 2,400 geocodes/day — still clears a 50k backlog in ~21 days.
const GEOCODE_BACKFILL_BATCH = 100;

async function backfillGeocode(env: Env): Promise<void> {
  const locations = await getLocationsNeedingGeocode(env.JOBS_DB, GEOCODE_BACKFILL_BATCH);
  if (locations.length === 0) return;
  let updated = 0;
  for (const { location } of locations) {
    try {
      const result = await geocodeWithMapboxFirst(
        location,
        env.RATE_LIMIT_KV,
        env.MAPBOX_ACCESS_TOKEN
      );
      if (result) {
        const n = await updateJobsWithCoords(env.JOBS_DB, location, result.lat, result.lng);
        updated += n;
        // Only Nominatim fallback is rate-limited; Photon needs no delay
        if (result.usedNominatim) await new Promise((r) => setTimeout(r, 1100));
      }
    } catch (err) {
      logger.warn("geocode_backfill_location_failed", { location, error: String(err) });
    }
  }
  if (updated > 0) {
    logger.info("geocode_backfill_completed", { locations_processed: locations.length, jobs_updated: updated });
  }
}

/**
 * Run ingestion for a single source by ID.
 * Used by the POST /admin/trigger?source=<id> endpoint for synchronous,
 * single-source runs that complete within the 30s Worker request budget.
 * Returns an error message string if the source is not found.
 */
export async function processSourceById(
  env: Env,
  sourceId: string,
  limit?: number,
  /** When set (e.g. Meta careers single-job ingest), overrides `sources.base_url` for this run only. */
  baseUrlOverride?: string,
  /** When set with `limit`, processes `rawJobs.slice(offset, offset+limit)` after fetch. */
  jobOffset?: number
): Promise<IngestionResult | { error: string }> {
  const source = await getSourceById(env.JOBS_DB, sourceId);
  if (!source) {
    return { error: `Source not found: ${sourceId}` };
  }
  const effective =
    baseUrlOverride !== undefined && baseUrlOverride !== ""
      ? { ...source, base_url: baseUrlOverride }
      : source;
  // Skip embeddings so this fits within the 30s Worker request budget.
  // The hourly backfill cron will generate embeddings for all new jobs.
  return processSource(env, effective, true, limit, jobOffset);
}

/**
 * Hourly :00 scheduler — enqueue one message per enabled source (see INGESTION_QUEUE consumer).
 */
export async function enqueueIngestionSources(env: Env): Promise<{ enqueued: number }> {
  const sources = await listEnabledSources(env.JOBS_DB, 150);
  if (!env.INGESTION_QUEUE) {
    throw new Error("INGESTION_QUEUE binding missing — check wrangler.jsonc queues.producers");
  }
  const bodies = sources.map((s) => ({ body: { sourceId: s.id } }));
  let enqueued = 0;
  const CHUNK = 100;
  for (let i = 0; i < bodies.length; i += CHUNK) {
    await env.INGESTION_QUEUE.sendBatch(bodies.slice(i, i + CHUNK));
    enqueued += Math.min(CHUNK, bodies.length - i);
  }
  logger.info("ingestion_sources_enqueued", { count: enqueued });
  return { enqueued };
}

/**
 * INGESTION_QUEUE consumer — one source per invocation (isolated CPU / subrequest budget).
 * Inline embeddings enabled; companies are sent to ENRICHMENT_QUEUE after upsert.
 */
export async function ingestSourceFromQueue(env: Env, sourceId: string): Promise<void> {
  const source = await getSourceById(env.JOBS_DB, sourceId);
  if (!source) {
    logger.warn("ingestion_queue_unknown_source", { source_id: sourceId });
    return;
  }
  try {
    await processSource(env, source, false);
  } catch (err) {
    const errStr = String(err);
    logger.error("ingestion_queue_source_crashed", { source_id: source.id, error: errStr });
    try {
      await updateSourceFetchResult(env.JOBS_DB, source.id, Math.floor(Date.now() / 1000), 0, errStr);
    } catch { /* best effort */ }
    throw err;
  }
}

/**
 * :30 cron — batch Exa/company enrichment backlog, website probes, embedding/geocode/description backfills.
 * Per-source ingestion + per-company enrichment run via queues on their own schedules.
 */
export async function runBackfillPipelineBody(env: Env): Promise<void> {
  if (env.EXA_API_KEY) {
    try {
      await runExaEnrichment(env.JOBS_DB, env.EXA_API_KEY, env.LOGO_DEV_TOKEN, {
        rateLimitKv: env.RATE_LIMIT_KV,
        mapboxAccessToken: env.MAPBOX_ACCESS_TOKEN,
        googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
      });
    } catch (err) {
      logger.error("exa_enrichment_cron_failed", { error: String(err) });
    }
  } else {
    logger.warn("exa_enrichment_skipped", { reason: "EXA_API_KEY not set" });
  }

  if (env.GEMINI_API_KEY) {
    try {
      await runCompanyEnrichment(env.JOBS_DB, env.GEMINI_API_KEY, env.BRANDFETCH_CLIENT_ID, env.LOGO_DEV_TOKEN, 50);
    } catch (err) {
      logger.error("company_enrichment_cron_failed", { error: String(err) });
    }
  } else {
    logger.warn("company_enrichment_skipped", { reason: "GEMINI_API_KEY not set" });
  }

  try {
    await runCompanyWebsiteProbeBatch(env.JOBS_DB);
  } catch (err) {
    logger.error("website_probe_cron_failed", { error: String(err) });
  }

  const wikiRetryIfAttemptedBefore = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60; // 60d between Wikidata miss retries
  try {
    await runWikidataEducationWebsiteBatch(env, wikiRetryIfAttemptedBefore);
  } catch (err) {
    logger.error("wikidata_website_cron_failed", { error: String(err) });
  }

  try {
    await backfillEmbeddings(env);
  } catch (err) {
    logger.error("embedding_backfill_cron_failed", { error: String(err) });
  }
  try {
    await backfillGeocode(env);
  } catch (err) {
    logger.error("geocode_backfill_cron_failed", { error: String(err) });
  }

  try {
    await runCompanyPlacesGeocode(
      env.JOBS_DB,
      env.GOOGLE_MAPS_API_KEY,
      env.RATE_LIMIT_KV,
      env.MAPBOX_ACCESS_TOKEN
    );
  } catch (err) {
    logger.error("company_hq_geocode_cron_failed", { error: String(err) });
  }

  try {
    await backfillConsiderDescriptions(env.JOBS_DB);
  } catch (err) {
    logger.error("consider_description_backfill_cron_failed", { error: String(err) });
  }
  try {
    await backfillWorkdayDescriptions(env.JOBS_DB);
  } catch (err) {
    logger.error("workday_description_backfill_cron_failed", { error: String(err) });
  }
}
