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
  batchUpsertJobs,
  batchGetCompanyLocationCoords,
  upsertCompanyLocationGeocode,
  getJobsNeedingEmbedding,
  getJobsNeedingLanguageDetection,
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
import { embedJob } from "../enrichment/ai.ts";
import { runCompanyEnrichment, runExaEnrichment } from "../enrichment/company.ts";
import { runCompanyPlacesGeocode } from "../enrichment/placesGeocodeCompanies.ts";
import { runCompanyWebsiteProbeBatch } from "../enrichment/websiteProbe.ts";
import { getFetcher, getSourcePriority } from "./registry.ts";
import { geocode } from "../utils/geocode.ts";
import { placesGeocode, hasGeocodeableCity, normalizeLocationForGeocode } from "../utils/placesGeocode.ts";
import type { Env, IngestionResult, SourceRow } from "../types.ts";
import {
  buildDedupKey,
  buildJobId,
  locationsJsonToEmbedString,
  locationsRawToEmbedString,
  primaryNormalizedLocation,
  slugify,
  uuidv4,
} from "../utils/normalize.ts";
import { logger } from "../utils/logger.ts";

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
  jobLimit?: number
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
    rawJobs = await fetcher.fetch(source, env);
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

  // Apply optional job limit for admin trigger calls
  const jobsToProcess = jobLimit ? rawJobs.slice(0, jobLimit) : rawJobs;

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

  const nonDupMetas = jobMetas.filter(({ dedupKey }) => {
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
  // Strategy (unified for all companies):
  //   1. Check company_location_geocodes D1 table — free, instant, persistent cache.
  //   2. Cache miss + GOOGLE_MAPS_API_KEY → Places API "{Company} {City, ST}"
  //      → saves result to D1 cache so the same (company, city) is never billed twice.
  //   3. No API key or Places API failure → fall back to Photon/Nominatim (free,
  //      city-level accuracy — better than nothing).
  // Cap at 50 Places API calls per source run to stay within Worker CPU budget.
  const INLINE_GEOCODE_CAP = 50;

  // Build unique (companyId, normalizedLocation) pairs for this run
  const pairsToCheck: Array<{ company_id: string; location_key: string; company_name: string }> = [];
  const seenPairKeys = new Set<string>();
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
  }

  // Batch-lookup D1 cache first
  const cachedCoords = await batchGetCompanyLocationCoords(db, pairsToCheck);

  // locationToCoords: keyed by original raw location string (before normalization)
  // so we can look up coords when building upsert inputs below
  const locationToCoords = new Map<string, { lat: number; lng: number }>();

  // Populate from D1 cache hits
  for (const { company_id, location_key, company_name: _ } of pairsToCheck) {
    const cached = cachedCoords.get(`${company_id}|${location_key}`);
    if (cached) locationToCoords.set(location_key, { lat: cached.lat, lng: cached.lng });
  }

  // Call Places API for cache misses (capped to avoid Worker timeout)
  const misses = pairsToCheck.filter(
    (p) => !cachedCoords.has(`${p.company_id}|${p.location_key}`) && hasGeocodeableCity(p.location_key)
  ).slice(0, INLINE_GEOCODE_CAP);

  let placesApiCalls = 0;
  if (env.GOOGLE_MAPS_API_KEY) {
    for (const { company_id, location_key, company_name } of misses) {
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

  // Fallback: Photon/Nominatim for anything still unresolved (free, city-level)
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
  const upsertInputs = nonDupMetas.map(({ jobId, companyId, dedupKey, normalized }) => {
    const company_slug =
      aliasCache.get(slugify(normalized.company_name)) ?? slugify(normalized.company_name);
    const normLoc = primaryNormalizedLocation(normalized.location, company_slug);
    // Look up by normalized (geocoder-friendly) location key, not the raw ATS string
    const locationKey = normLoc ? normalizeLocationForGeocode(normLoc) : null;
    const coords = locationKey ? locationToCoords.get(locationKey) : null;
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

  let upsertResults: Array<{ inserted: boolean; needsEmbedding: boolean }>;
  try {
    upsertResults = await batchUpsertJobs(db, upsertInputs, existingMap);
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
 * At 500/run × 24 runs/day = 12,000 embeddings/day. The initial 42K-job
 * backfill completes in ~3.5 days. On a paid Gemini API account the rate
 * limit is 150 RPM (9,000/hour), so 500 per 1-hour cron window is very
 * conservative and will never hit rate limits.
 *
 * Increase this number if you want the backfill to complete faster.
 * Each embedding takes ~200–400ms, so 500 ≈ 100–200 seconds of wall clock time.
 */
// 1000 × 24/day = 24,000 embeddings/day. Backlog of ~15k a16z jobs clears in <1 day.
// Each embed ~250ms sequential → 1000 ≈ 250s. Total cron CPU with 50 sources ≈ 450s (50%).
const EMBEDDING_BACKFILL_BATCH = 1000;

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

  // Phase 1: call Gemini for each job sequentially (can't batch these —
  // each job needs its own embedding vector from the external API).
  // Collect successes; failures stay NULL and are retried next run.
  const vectors: Array<{ id: string; values: number[] }> = [];
  let failed = 0;

  for (const job of jobs) {
    try {
      const locText = locationsJsonToEmbedString(job.locations) ?? job.location_primary;
      const values = await embedJob(
        env.GEMINI_API_KEY,
        job.title,
        job.company_name,
        locText,
        job.description_raw
      );
      vectors.push({ id: job.id, values });
    } catch (err) {
      failed++;
      logger.warn("embedding_backfill_job_failed", { job_id: job.id, error: String(err) });
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

// Photon (primary) has no rate limit and resolves in ~100ms — 500 locations ≈ 50s.
// Only Nominatim fallbacks (rare, <5% of locations) add the 1.1s delay.
// Worst case (all Nominatim): 500 × 1.1s = 550s — acceptable since it never happens in practice.
// At 500/run × 24/day = 12,000/day, the 13k geocode backlog clears in ~1 day.
const GEOCODE_BACKFILL_BATCH = 500;

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

/**
 * Run ingestion for a single source by ID.
 * Used by the POST /admin/trigger?source=<id> endpoint for synchronous,
 * single-source runs that complete within the 30s Worker request budget.
 * Returns an error message string if the source is not found.
 */
export async function processSourceById(
  env: Env,
  sourceId: string,
  limit?: number
): Promise<IngestionResult | { error: string }> {
  const source = await getSourceById(env.JOBS_DB, sourceId);
  if (!source) {
    return { error: `Source not found: ${sourceId}` };
  }
  // Skip embeddings so this fits within the 30s Worker request budget.
  // The hourly backfill cron will generate embeddings for all new jobs.
  return processSource(env, source, true, limit);
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
      // Unexpected error that escaped processSource's own error handling — log and continue
      logger.error("ingestion_source_crashed", { source_id: source.id, error: String(err) });
      result = {
        source_id: source.id, source_name: source.name,
        fetched: 0, inserted: 0, updated: 0, skipped: 0,
        deduplicated: 0, failed: 0,
        error: String(err), duration_ms: 0,
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
      await runExaEnrichment(env.JOBS_DB, env.EXA_API_KEY);
    } catch (err) {
      logger.error("exa_enrichment_cron_failed", { error: String(err) });
    }
  } else {
    logger.warn("exa_enrichment_skipped", { reason: "EXA_API_KEY not set" });
  }

  // Brandfetch + AI description — fallback for fields Exa left null.
  if (env.GEMINI_API_KEY) {
    try {
      await runCompanyEnrichment(env.JOBS_DB, env.GEMINI_API_KEY, env.BRANDFETCH_CLIENT_ID);
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

  // Language detection backfill — runs the heuristic detector on jobs that have a
  // description but no language tag yet (e.g. jobs ingested before this feature shipped).
  // Pure CPU, no network calls, so 2,000/run is fast (~200ms) and clears the backlog quickly.
  try {
    await backfillLanguage(env);
  } catch (err) {
    logger.error("language_backfill_cron_failed", { error: String(err) });
  }
}
