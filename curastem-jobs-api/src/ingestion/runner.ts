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

import { batchCheckCrossSourceDups, batchGetExistingJobs, batchMarkJobsEmbedded, batchUpsertJobs, getJobsNeedingEmbedding, getLocationsNeedingGeocode, getSourceById, listEnabledSources, updateJobsWithCoords, updateSourceFetchResult, upsertCompany } from "../db/queries.ts";
import { embedJob } from "../enrichment/ai.ts";
import { runCompanyEnrichment } from "../enrichment/company.ts";
import { getFetcher } from "./registry.ts";
import { geocode } from "../utils/geocode.ts";
import type { Env, IngestionResult, SourceRow } from "../types.ts";
import { buildDedupKey, buildJobId, normalizeLocation, slugify, uuidv4 } from "../utils/normalize.ts";
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
  const companyCache = new Map<string, string>();
  for (const normalized of jobsToProcess) {
    const slug = slugify(normalized.company_name);
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
    const slug    = slugify(normalized.company_name);
    const companyId = companyCache.get(slug);
    if (!companyId) { result.failed++; continue; }
    jobMetas.push({
      jobId:    buildJobId(source.id, normalized.external_id),
      companyId,
      dedupKey: buildDedupKey(normalized.title, slug),
      normalized,
    });
  }

  // ── Phase 3: Batch cross-source dedup check — 1 D1 subrequest total ───────
  const dupSet = await batchCheckCrossSourceDups(
    db,
    jobMetas.map(({ dedupKey }) => ({ dedupKey, sourceId: source.id }))
  );

  const nonDupMetas = jobMetas.filter(({ dedupKey }) => {
    if (dupSet.has(dedupKey)) { result.deduplicated++; return false; }
    return true;
  });

  // ── Phase 4: Batch check existing jobs — 1 D1 subrequest total ────────────
  const existingMap = await batchGetExistingJobs(
    db,
    source.id,
    nonDupMetas.map((m) => m.normalized.external_id)
  );

  // ── Phase 4b: Inline geocode unique primary locations (locations[0] = normalizeLocation(raw))
  // Coords are keyed off the normalized string, which is what ends up in locations[0] in the DB.
  const INLINE_GEOCODE_CAP = 50;
  const uniqueLocations = [...new Set(
    nonDupMetas
      .map((m) => normalizeLocation(m.normalized.location))
      .filter((l): l is string => Boolean(l?.trim()))
  )].slice(0, INLINE_GEOCODE_CAP);
  const locationToCoords = new Map<string, { lat: number; lng: number }>();
  for (const loc of uniqueLocations) {
    try {
      const result = await geocode(loc, env.RATE_LIMIT_KV);
      if (result) {
        locationToCoords.set(loc, { lat: result.lat, lng: result.lng });
        if (result.usedNominatim) await new Promise((r) => setTimeout(r, 1100)); // Nominatim 1 req/sec
      }
    } catch (err) {
      logger.warn("geocode_inline_failed", { location: loc, error: String(err) });
    }
  }

  // ── Phase 5: Batch INSERT new + UPDATE existing — 2 D1 subrequests total ──
  const upsertInputs = nonDupMetas.map(({ jobId, companyId, dedupKey, normalized }) => {
    const normLoc = normalizeLocation(normalized.location);
    const coords = normLoc ? locationToCoords.get(normLoc) : null;
    return {
      id:           jobId,
      company_id:   companyId,
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
  } catch (err) {
    result.failed += upsertInputs.length;
    logger.warn("batch_upsert_failed", { source_id: source.id, error: String(err) });
    upsertResults = [];
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
          normalized.location,
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
// Workers Paid: 10K subrequests. Ingestion ≈ 600. Backfill 500 ≈ 1,100 total.
// 500 × 24/day = 12,000 embeddings/day. Backlog of 22K clears in ~2 days.
// Each embed ~250ms sequential → 500 ≈ 125s, well within the 15-min cron CPU budget.
const EMBEDDING_BACKFILL_BATCH = 500;

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
      const values = await embedJob(
        env.GEMINI_API_KEY,
        job.title,
        job.company_name,
        job.location,
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

// Photon has no rate limit so we can process many more per run.
// Only Nominatim fallbacks need the 1.1s delay; at ~150 locations/run
// worst-case (all Nominatim) is ~165s — safe within Workers CPU budget.
const GEOCODE_BACKFILL_BATCH = 150;

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

  // Process 6 sources per cron run (oldest-first via last_fetched_at ASC).
  // Workers Paid: 10K subrequests. 6 sources + backfill ≈ 800 subrequests. See BILLING_AUDIT.md.
  const sources = await listEnabledSources(env.JOBS_DB, 6);
  logger.info("ingestion_sources_loaded", { count: sources.length });

  const results: IngestionResult[] = [];

  for (const source of sources) {
    logger.info("ingestion_source_started", { source_id: source.id, source_name: source.name });
    // Inline embedding: each new job gets embedded during ingestion (up to 50/source).
    // Excess jobs go to backfill. Backfill still runs at end for any missed embeddings.
    const result = await processSource(env, source, false);
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

  // Company enrichment runs after ingestion as a best-effort background task.
  // Failures here do not affect the ingestion success status.
  if (env.GEMINI_API_KEY) {
    try {
      await runCompanyEnrichment(env.JOBS_DB, env.GEMINI_API_KEY, env.BRANDFETCH_CLIENT_ID);
    } catch (err) {
      logger.error("company_enrichment_cron_failed", { error: String(err) });
    }
  } else {
    logger.warn("company_enrichment_skipped", { reason: "GEMINI_API_KEY not set" });
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
}
