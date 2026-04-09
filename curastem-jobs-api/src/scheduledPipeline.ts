/**
 * Shared body of the scheduled Worker — also invoked via POST /admin/cron
 * for testing without waiting for the real trigger.
 *
 * :00 cron — seeds D1, then enqueues one INGESTION_QUEUE message per enabled source.
 * :30 cron — Exa/company backlog, website probes, embedding + geocode + description backfills.
 */

import {
  applyCompanyMetadataCorrections,
  migrateRenameCrunchbaseSource,
  seedCompanyWebsites,
  seedSources,
} from "./db/migrate.ts";
import {
  backfillLocationPrimary,
  ensureCompanyExaColumns,
  ensureCompanyWebsiteProbeColumns,
  ensureJobIndexes,
  ensureJobMapCellsTable,
  ensureNewJobColumns,
  rebuildJobMapCells,
} from "./db/queries.ts";
import { enqueueIngestionSources, runBackfillPipelineBody } from "./ingestion/runner.ts";
import type { Env } from "./types.ts";
import { recordCronFailure, recordCronSuccess, shouldSkipCron } from "./utils/cronCircuit.ts";
import { logger } from "./utils/logger.ts";

export type ScheduledPipelineOptions = {
  /**
   * When false (default), the circuit breaker can skip the whole run after repeated failures.
   * Admin routes should pass true so manual runs always execute.
   */
  skipCircuitBreaker?: boolean;
  /**
   * When true (default), updates `cron_last_invoked_at` in KV so GET /health reflects this run.
   * POST /admin/trigger full-run passes false to avoid clobbering the real cron heartbeat.
   */
  recordHeartbeat?: boolean;
};

/**
 * :00 hourly path — migrations + enqueue parallel source ingestion (queue consumers).
 */
export async function runSchedulerPipeline(
  env: Env,
  opts: ScheduledPipelineOptions = {}
): Promise<void> {
  const skipCircuit = opts.skipCircuitBreaker === true;
  const recordHeartbeat = opts.recordHeartbeat !== false;

  const kv = env.RATE_LIMIT_KV;
  const stage = (s: string) => kv.put("cron_stage", s, { expirationTtl: 3600 });

  if (recordHeartbeat) {
    await kv.put("cron_last_invoked_at", String(Math.floor(Date.now() / 1000)), {
      expirationTtl: 7 * 24 * 3600,
    });
  }
  await stage("started");

  if (!skipCircuit && (await shouldSkipCron(kv))) {
    logger.info("scheduled_handler_skipped", { reason: "circuit_open" });
    await stage("skipped_circuit");
    return;
  }

  try {
    await stage("seed_sources");
    await seedSources(env.JOBS_DB);
    await stage("migrations");
    await migrateRenameCrunchbaseSource(env.JOBS_DB);
    await ensureCompanyWebsiteProbeColumns(env.JOBS_DB);
    await ensureCompanyExaColumns(env.JOBS_DB);
    await ensureNewJobColumns(env.JOBS_DB);
    // Non-fatal: index builds on large tables can OOM if a migration hasn't been pre-applied.
    // Ingestion proceeds; the failed index will be retried on the next cron run.
    try {
      await ensureJobIndexes(env.JOBS_DB);
    } catch (indexErr) {
      logger.warn("ensure_job_indexes_failed", { error: String(indexErr) });
    }
    try {
      await ensureJobMapCellsTable(env.JOBS_DB);
    } catch (cellTableErr) {
      logger.warn("ensure_job_map_cells_table_failed", { error: String(cellTableErr) });
    }
    await stage("seed_company_websites");
    await seedCompanyWebsites(env.JOBS_DB);
    await stage("metadata_corrections");
    await applyCompanyMetadataCorrections(env.JOBS_DB, env.LOGO_DEV_TOKEN);
    await stage("enqueue_ingestion");
    await enqueueIngestionSources(env);
    await stage("done");
    await recordCronSuccess(kv);
  } catch (err) {
    const msg = String(err);
    logger.error("scheduled_handler_failed", { error: msg });
    await kv.put("cron_last_error", msg, { expirationTtl: 7 * 24 * 3600 });
    await recordCronFailure(kv);
  }
}

/**
 * :30 hourly path — backlog enrichment + backfills (full CPU budget, no ingestion).
 */
export async function runBackfillPipeline(env: Env): Promise<void> {
  const kv = env.RATE_LIMIT_KV;
  const stage = (s: string) => kv.put("cron_stage", s, { expirationTtl: 3600 });
  await kv.put("backfill_last_invoked_at", String(Math.floor(Date.now() / 1000)), {
    expirationTtl: 7 * 24 * 3600,
  });
  await stage("backfill_started");
  try {
    // Isolated: batch errors must not skip the rest of the backfill pipeline.
    try {
      await backfillLocationPrimary(env.JOBS_DB);
    } catch (bfErr) {
      logger.warn("backfill_location_primary_failed", { error: String(bfErr) });
    }
    try {
      await ensureJobMapCellsTable(env.JOBS_DB);
      const { rowsInserted } = await rebuildJobMapCells(env.JOBS_DB);
      logger.info("job_map_cells_rebuilt", { rowsInserted });
    } catch (cellErr) {
      logger.warn("rebuild_job_map_cells_failed", { error: String(cellErr) });
    }
    await runBackfillPipelineBody(env);
    await stage("backfill_done");
  } catch (err) {
    const msg = String(err);
    logger.error("backfill_pipeline_failed", { error: msg });
    await kv.put("cron_last_error", msg, { expirationTtl: 7 * 24 * 3600 });
    // Do not trip circuit breaker — :00 scheduler already succeeded; backfill is best-effort.
  }
}

/**
 * Full pipeline for POST /admin/cron — scheduler then backfills (mirrors both crons in one call).
 */
export async function runScheduledPipeline(
  env: Env,
  opts: ScheduledPipelineOptions = {}
): Promise<void> {
  await runSchedulerPipeline(env, opts);
  await runBackfillPipeline(env);
}
