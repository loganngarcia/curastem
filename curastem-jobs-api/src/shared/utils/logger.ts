/**
 * Structured ingestion logger.
 *
 * Cloudflare Workers stream console output to the Cloudflare dashboard and
 * Workers Logs. This logger produces structured JSON lines so that log entries
 * can be filtered and aggregated without custom tooling.
 *
 * During ingestion we want to track:
 *   - how many jobs were fetched per source
 *   - how many were inserted, updated, skipped, or deduplicated
 *   - any errors per source
 *
 * Structured output makes it easy to grep or forward to an external log store
 * later (e.g. Cloudflare Logpush, Axiom, Datadog).
 */

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  ts: string;          // ISO 8601
  msg: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(msg: string, fields?: Record<string, unknown>): void {
    emit("info", msg, fields);
  },

  warn(msg: string, fields?: Record<string, unknown>): void {
    emit("warn", msg, fields);
  },

  error(msg: string, fields?: Record<string, unknown>): void {
    emit("error", msg, fields);
  },

  /**
   * Log a completed ingestion run for a single source.
   * This is the primary observability signal for cron health.
   */
  ingestionResult(result: {
    source_id: string;
    source_name: string;
    fetched: number;
    inserted: number;
    updated: number;
    skipped: number;
    deduplicated: number;
    failed: number;
    error: string | null;
    duration_ms: number;
  }): void {
    const level: LogLevel = result.error ? "warn" : "info";
    emit(level, "ingestion_result", result);
  },

  /**
   * Log a summary across all sources after a full cron run.
   */
  ingestionSummary(summary: {
    sources_processed: number;
    sources_errored: number;
    total_fetched: number;
    total_inserted: number;
    total_updated: number;
    total_skipped: number;
    total_deduplicated: number;
    total_failed: number;
    duration_ms: number;
  }): void {
    emit("info", "ingestion_summary", summary);
  },
};
