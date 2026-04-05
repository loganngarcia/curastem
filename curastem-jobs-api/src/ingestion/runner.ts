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
  batchSetLanguage,
  batchSetHeuristicFields,
  batchSetHeuristicSalary,
  batchUpsertJobs,
  batchGetCompanyLocationCoords,
  upsertCompanyLocationGeocode,
  getJobsNeedingEmbedding,
  getJobsNeedingHeuristicEnrichment,
  getJobsNeedingLanguageDetection,
  getJobsNeedingSalaryEnrichment,
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
import { runCompanyWebsiteProbeBatch } from "../enrichment/websiteProbe.ts";
import { getFetcher, getSourcePriority } from "./registry.ts";
import { geocode, geocodeAddress } from "../utils/geocode.ts";
import { placesGeocode, hasGeocodeableCity, normalizeLocationForGeocode } from "../utils/placesGeocode.ts";
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

  let rawJobs: Awaited<ReturnType<typeof fetcher.fetch>>;
  try {
    const fetchTimeoutMs =
      source.source_type === "getro" ? GETRO_FETCH_TIMEOUT_MS :
      source.source_type === "workday" ? WORKDAY_FETCH_TIMEOUT_MS :
      source.source_type === "phenom" ? PHENOM_FETCH_TIMEOUT_MS :
      source.source_type === "activate_careers" ? ACTIVATE_CAREERS_FETCH_TIMEOUT_MS :
      source.source_type === "eightfold" ? EIGHTFOLD_FETCH_TIMEOUT_MS :
      // Google: ~4000 jobs × PAGE_CONCURRENCY=4 pages at ~650ms each = ~650s if fully sequential;
      // with concurrency and early-stop, real runs land around 90-180s. Give generous budget.
      source.source_type === "google" ? 300_000 :
      // Netflix: sitemap (1 req) + ~640 position_details at DETAIL_CONCURRENCY=6 ≈ 60-90s total.
      source.source_type === "netflix" ? 180_000 :
      // TikTok: ~3400 global jobs at 100/page = ~35 POST requests ≈ 30-60s.
      source.source_type === "tiktok" ? 120_000 :
      source.source_type === "hca_careers" ? HCA_CAREERS_FETCH_TIMEOUT_MS :
      source.source_type === "oracle_ce" ? ORACLE_CE_FETCH_TIMEOUT_MS :
      source.source_type === "aramark_careers" ? ARAMARK_CAREERS_FETCH_TIMEOUT_MS :
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
  const jobsToProcess = sliceStart > 0 || sliceEnd != null ? rawJobs.slice(sliceStart, sliceEnd) : rawJobs;

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
      nonDupMetas.map((m) => m.dedupKey)
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
  //   0. If job has a full street address (extracted from title or AI-enriched body)
  //      + city + state → Nominatim address geocode (free, precise).
  //      Franchise ATSes like Dominos embed the store address in the title
  //      ("Dishwasher (01272) - 3275 Henry St") while `locations` has the city.
  //      Combining them gives exact store coords at zero cost.
  //   1. Check company_location_geocodes D1 table — free, instant, persistent cache.
  //   2. Cache miss, professional company → Places API "{Company} {City, ST}" ($0.032/req).
  //      Retail/franchise companies route directly to step 3 (city-level is sufficient).
  //   3. Photon/Nominatim fallback — free, city-level accuracy.
  // 500 per source run — each result is cached in D1 forever so the billing is one-time.
  // Cron runs are fast after the initial backfill because all known locations hit the D1 cache.
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
      const result = await geocodeAddress(fullAddress, env.GOOGLE_MAPS_API_KEY, env.RATE_LIMIT_KV);
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

  // Build unique (companyId, normalizedLocation) pairs for this run.
  // Also track whether any job at each pair matches the retail profile so we
  // can route cheaply to Photon instead of burning a Places API credit.
  const pairsToCheck: Array<{ company_id: string; location_key: string; company_name: string }> = [];
  const seenPairKeys = new Set<string>();
  // pairKey → true if any job at that (company, location) is a retail role
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
    // Mark pair as retail if company is blacklisted OR job title signals a retail role
    if (!pairIsRetail.get(pairKey)) {
      const isRetail = RETAIL_GEOCODE_SLUGS.has(slug) || RETAIL_TITLE_RE.test(m.normalized.title ?? "");
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

  // Split cache misses into two tiers:
  //   professionalMisses → Google Maps Places API (precise building coords)
  //   retailMisses       → Photon/Nominatim (free city-level, sufficient for franchise listings)
  //
  // Routing logic (in priority order):
  //   1. Company slug in RETAIL_GEOCODE_SLUGS → Photon
  //   2. Any job at this (company, location) matches RETAIL_TITLE_RE → Photon
  //   3. Otherwise → Places API (capped at INLINE_GEOCODE_CAP per source run)
  const allMisses = pairsToCheck.filter(
    (p) => !cachedCoords.has(`${p.company_id}|${p.location_key}`) && hasGeocodeableCity(p.location_key)
  );
  const professionalMisses = allMisses
    .filter((p) => !pairIsRetail.get(`${p.company_id}|${p.location_key}`))
    .slice(0, INLINE_GEOCODE_CAP);

  let placesApiCalls = 0;
  if (env.GOOGLE_MAPS_API_KEY) {
    for (const { company_id, location_key, company_name } of professionalMisses) {
      if (locationToCoords.has(location_key)) continue; // already resolved by earlier pair
      try {
        const result = await placesGeocode(
          `${company_name} ${location_key}`,
          env.GOOGLE_MAPS_API_KEY,
          env.RATE_LIMIT_KV,
        );
        if (result) {
          locationToCoords.set(location_key, { lat: result.lat, lng: result.lng });
          // Persist to D1 so future jobs for this (company, city) skip the API call
          await upsertCompanyLocationGeocode(db, {
            company_id,
            location_key,
            lat: result.lat,
            lng: result.lng,
            address: result.formattedAddress,
          });
          placesApiCalls++;
        }
      } catch (err) {
        logger.warn("places_geocode_inline_failed", { company_name, location_key, error: String(err) });
      }
    }
  }

  // Photon/Nominatim for: retail pairs (by design) + professional failures + no-API-key fallback.
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

  if (placesApiCalls > 0) {
    logger.info("inline_geocode_places_calls", { source_id: source.id, calls: placesApiCalls });
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
  // No cap — embed all jobs that need it. Backfill catches any that fail or timeout.
  for (let i = 0; i < upsertResults.length; i++) {
    const { inserted, needsEmbedding } = upsertResults[i];
    if (inserted) result.inserted++; else result.updated++;

    if (
      !skipEmbeddings &&
      needsEmbedding &&
      env.JOBS_VECTORS &&
      env.GEMINI_API_KEY
    ) {
      const { jobId, normalized } = nonDupMetas[i];
      try {
        const vector = await embedJob(
          env.GEMINI_API_KEY,
          normalized.title,
          normalized.company_name,
          locationsRawToEmbedString(normalized.location),
          normalized.description_raw
        );
        pendingVectors.push({ id: jobId, values: vector });
      } catch (embedErr) {
        logger.warn("job_embedding_failed", { job_id: jobId, error: String(embedErr) });
      }
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
 *   100  embedding Gemini fetches ← this constant
 *   100  geocode Photon fetches
 *   ~50  Workday/Consider description backfills
 *   ~30  Exa / Brandfetch enrichment fetches
 *   ─────────────────────────────────────────────────────────
 *   ~962 total — under the 1,000 ceiling with ~38 headroom
 *
 * Speed: requests run 5 concurrent → 100 / 5 = 20 batches × ~250ms = ~5s wall clock.
 */
const EMBEDDING_BACKFILL_BATCH = 100;
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
      const result = await geocode(location, env.RATE_LIMIT_KV);
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

// Pure CPU — no network. 2,000 jobs × ~0.1ms each ≈ 200ms per run.
const LANGUAGE_BACKFILL_BATCH = 2000;

async function backfillLanguage(env: Env): Promise<void> {
  const { detectLanguage } = await import("../enrichment/language.ts");
  const jobs = await getJobsNeedingLanguageDetection(env.JOBS_DB, LANGUAGE_BACKFILL_BATCH);
  if (jobs.length === 0) return;

  const detected: Array<{ id: string; description_language: string }> = [];
  for (const job of jobs) {
    const lang = detectLanguage(job.description_raw);
    if (lang) detected.push({ id: job.id, description_language: lang });
  }

  await batchSetLanguage(env.JOBS_DB, detected);
  logger.info("language_backfill_completed", {
    processed: jobs.length,
    detected: detected.length,
    null_result: jobs.length - detected.length,
  });
}

// Pure CPU regex — no network. 5,000 jobs × ~0.2ms each ≈ 1s per run.
const HEURISTIC_BACKFILL_BATCH = 5000;

/**
 * Backfill heuristic employment_type and seniority_level for existing jobs that
 * have a description but were ingested before regex detection was added.
 *
 * Runs at the end of every cron, newest-first so recently posted jobs are
 * classified first. A job is skipped once both fields are non-null.
 */
async function backfillHeuristicFields(env: Env): Promise<void> {
  const { detectEmploymentTypeFromText, detectSeniorityFromText } = await import("../utils/normalize.ts");
  const jobs = await getJobsNeedingHeuristicEnrichment(env.JOBS_DB, HEURISTIC_BACKFILL_BATCH);
  if (jobs.length === 0) return;

  const rows: Array<{ id: string; employment_type: string | null; seniority_level: string | null }> = [];
  for (const job of jobs) {
    const et = job.employment_type ?? detectEmploymentTypeFromText(job.title, job.description_raw);
    const sl = job.seniority_level ?? detectSeniorityFromText(job.title, job.description_raw);
    // Only write if we detected at least one new value
    if (et !== job.employment_type || sl !== job.seniority_level) {
      rows.push({ id: job.id, employment_type: et, seniority_level: sl });
    }
  }

  await batchSetHeuristicFields(env.JOBS_DB, rows);
  logger.info("heuristic_backfill_completed", {
    processed: jobs.length,
    updated: rows.length,
    no_change: jobs.length - rows.length,
  });
}

// Pure CPU regex — no network. 5,000 jobs × ~0.2ms each ≈ 1s per run.
const SALARY_BACKFILL_BATCH = 5000;

/**
 * Backfill regex-detected salary fields for jobs that have a description but
 * no salary data yet. Runs after the heuristic fields pass — same "pure CPU,
 * no network" budget. Newest-first so recently posted jobs get salary first.
 */
async function backfillHeuristicSalary(env: Env): Promise<void> {
  const { extractSalaryFromText } = await import("../utils/normalize.ts");
  const jobs = await getJobsNeedingSalaryEnrichment(env.JOBS_DB, SALARY_BACKFILL_BATCH);
  if (jobs.length === 0) return;

  const rows: Array<{ id: string; salary_min: number; salary_max: number | null; salary_currency: string; salary_period: string }> = [];
  for (const job of jobs) {
    const detected = extractSalaryFromText(job.description_raw);
    if (detected.min !== null && detected.period !== null && detected.currency !== null) {
      rows.push({
        id:              job.id,
        salary_min:      detected.min,
        salary_max:      detected.max,
        salary_currency: detected.currency,
        salary_period:   detected.period,
      });
    }
  }

  await batchSetHeuristicSalary(env.JOBS_DB, rows);
  logger.info("salary_backfill_completed", {
    processed: jobs.length,
    detected:  rows.length,
    no_match:  jobs.length - rows.length,
  });
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
  /** When set (e.g. metacareers single-job ingest), overrides `sources.base_url` for this run only. */
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
 * Main ingestion entry point called by the scheduled Worker handler.
 */
export async function runIngestion(env: Env): Promise<void> {
  const overallStart = Date.now();
  logger.info("ingestion_started");

  // Fetch up to MAX_SOURCES candidates; stop early if elapsed time exceeds the
  // SOURCE_BUDGET_MS threshold so backfill passes always get a guaranteed time slice.
  // Workers Paid cron limit: 15 minutes (900s). We reserve 500s for backfills,
  // leaving 400s for source ingestion. Any run that hits a cluster of slow sources
  // (Workday ~15s, a16z ~46s) will stop early rather than starving the backfills.
  const MAX_SOURCES = 50;
  const SOURCE_BUDGET_MS = 400_000; // 400s — leaves 500s for embedding + desc + geocode backfills

  const sources = await listEnabledSources(env.JOBS_DB, MAX_SOURCES);
  logger.info("ingestion_sources_loaded", { count: sources.length });
  if (env.RATE_LIMIT_KV) {
    await env.RATE_LIMIT_KV.put(
      "cron_stage",
      `run_ingestion:${sources.length}_sources`,
      { expirationTtl: 3600 }
    );
  }

  const results: IngestionResult[] = [];

  for (const source of sources) {
    const elapsed = Date.now() - overallStart;
    if (elapsed > SOURCE_BUDGET_MS) {
      logger.warn("ingestion_source_budget_exceeded", {
        elapsed_ms: elapsed,
        sources_processed: results.length,
        sources_remaining: sources.length - results.length,
      });
      break;
    }
    logger.info("ingestion_source_started", { source_id: source.id, source_name: source.name });
    let result: IngestionResult;
    try {
      result = await processSource(env, source, false);
    } catch (err) {
      // Unexpected error that escaped processSource's own error handling — log and continue.
      // Always mark last_fetched_at so this source doesn't permanently block the queue.
      const errStr = String(err);
      logger.error("ingestion_source_crashed", { source_id: source.id, error: errStr });
      try {
        await updateSourceFetchResult(env.JOBS_DB, source.id, Math.floor(Date.now() / 1000), 0, errStr);
      } catch { /* ignore — best effort */ }
      result = {
        source_id: source.id, source_name: source.name,
        fetched: 0, inserted: 0, updated: 0, skipped: 0,
        deduplicated: 0, failed: 0,
        error: errStr, duration_ms: 0,
      };
    }
    logger.ingestionResult(result);
    results.push(result);
  }

  const summary = {
    sources_processed: results.length,
    sources_errored: results.filter((r) => r.error !== null).length,
    total_fetched: results.reduce((s, r) => s + r.fetched, 0),
    total_inserted: results.reduce((s, r) => s + r.inserted, 0),
    total_updated: results.reduce((s, r) => s + r.updated, 0),
    total_skipped: results.reduce((s, r) => s + r.skipped, 0),
    total_deduplicated: results.reduce((s, r) => s + r.deduplicated, 0),
    total_failed: results.reduce((s, r) => s + r.failed, 0),
    duration_ms: Date.now() - overallStart,
  };
  logger.ingestionSummary(summary);

  // Exa enrichment — primary source for company profile, social links, HQ, etc.
  // Runs before Brandfetch so Brandfetch only fills what Exa left null.
  if (env.EXA_API_KEY) {
    try {
      await runExaEnrichment(env.JOBS_DB, env.EXA_API_KEY, env.LOGO_DEV_TOKEN);
    } catch (err) {
      logger.error("exa_enrichment_cron_failed", { error: String(err) });
    }
  } else {
    logger.warn("exa_enrichment_skipped", { reason: "EXA_API_KEY not set" });
  }

  // Brandfetch + AI description — fallback for fields Exa left null.
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

  // Embedding backfill — generates Vectorize vectors for any jobs that were
  // ingested but never embedded (e.g. from a previous cron run that timed out
  // mid-embedding, or jobs that predated the Vectorize integration).
  // Runs last so ingestion always completes even if the backfill is slow.
  try {
    await backfillEmbeddings(env);
  } catch (err) {
    logger.error("embedding_backfill_cron_failed", { error: String(err) });
  }

  // Geocode backfill — populates location_lat/lng for distance-based "jobs near you".
  // Nominatim: 1 req/sec. We do 10 locations per run.
  try {
    await backfillGeocode(env);
  } catch (err) {
    logger.error("geocode_backfill_cron_failed", { error: String(err) });
  }

  // Places API geocoding — company HQ coords for newly enriched companies only.
  // Per-job geocoding for retail chains runs inline during ingestion (above), not here.
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      await runCompanyPlacesGeocode(env.JOBS_DB, env.GOOGLE_MAPS_API_KEY, env.RATE_LIMIT_KV);
    } catch (err) {
      logger.error("company_places_geocode_cron_failed", { error: String(err) });
    }
  }

  // Consider description backfill — fetches full job descriptions from the native
  // ATS (Greenhouse/Lever/Ashby) for jobs ingested via the Consider portfolio API,
  // which does not include descriptions in its search response.
  // 50 jobs/run × 200ms delay = ~10s. At 24 runs/day, 15k jobs clear in ~12.5 days.
  try {
    await backfillConsiderDescriptions(env.JOBS_DB);
  } catch (err) {
    logger.error("consider_description_backfill_cron_failed", { error: String(err) });
  }

  // Workday list API only returns bulletFields (a brief teaser), not the full description.
  // 100 jobs/run × 200ms delay = ~20s. At 24 runs/day, ~5k jobs clear in ~2 days.
  try {
    await backfillWorkdayDescriptions(env.JOBS_DB);
  } catch (err) {
    logger.error("workday_description_backfill_cron_failed", { error: String(err) });
  }

  // Language detection backfill — runs the heuristic detector on jobs that have a
  // description but no language tag yet (e.g. jobs ingested before this feature shipped).
  // Pure CPU, no network calls, so 2,000/run is fast (~200ms) and clears the backlog quickly.
  try {
    await backfillLanguage(env);
  } catch (err) {
    logger.error("language_backfill_cron_failed", { error: String(err) });
  }

  // Heuristic field backfill — populates employment_type and seniority_level for
  // existing jobs that were ingested before regex detection was introduced.
  // Pure CPU regex, no network — 5,000/run ≈ 1s. At 24 runs/day, the backlog
  // of ~170k jobs clears in ~1–2 days.
  try {
    await backfillHeuristicFields(env);
  } catch (err) {
    logger.error("heuristic_backfill_cron_failed", { error: String(err) });
  }

  // Salary backfill — regex-scans descriptions for pay transparency disclosures
  // (California requires salary ranges on every posting). Pure CPU, no network.
  // 5,000/run × 24/day clears a 120k-job backlog in ~1 day.
  try {
    await backfillHeuristicSalary(env);
  } catch (err) {
    logger.error("salary_heuristic_backfill_cron_failed", { error: String(err) });
  }
}
