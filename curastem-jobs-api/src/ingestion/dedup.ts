/**
 * Deduplication logic.
 *
 * Two levels of deduplication:
 *
 * 1. EXACT MATCH (primary, per-source)
 *    Detected by: source_id + external_id UNIQUE constraint in D1.
 *    Handled by: upsertJob in queries.ts — same record = update in place.
 *    This covers the normal case of re-ingesting the same source.
 *
 * 2. CROSS-SOURCE MATCH (secondary, across sources)
 *    Detected by: dedup_key = lower(title) + "|" + company_slug
 *    Logic: If a job with the same dedup_key already exists from a
 *    higher-priority source, skip insertion of the lower-priority duplicate.
 *    This prevents the same role from appearing twice in results (e.g. a
 *    company's Greenhouse posting and a SmartRecruiters aggregated copy).
 *
 * Source priority is defined in registry.ts. Higher priority always wins.
 * Equal-priority sources are both kept (e.g. two different Greenhouse boards
 * for the same company but different regions — these are legitimately distinct).
 */

import { getSourcePriority } from "./registry.ts";

interface DedupCheckRow {
  id: string;
  source_name: string;
}

/**
 * Check whether a cross-source duplicate of higher or equal priority already
 * exists for the given dedup_key.
 *
 * Returns true if the incoming job should be SKIPPED (i.e. a better or equal
 * record already exists).
 *
 * Returns false if the job should be inserted/updated normally.
 */
export async function isCrossSourceDuplicate(
  db: D1Database,
  dedupKey: string,
  incomingSourceType: string,
  incomingSourceId: string
): Promise<boolean> {
  const existing = await db
    .prepare(
      `SELECT id, source_name FROM jobs
       WHERE dedup_key = ? AND source_id != ?
       LIMIT 1`
    )
    .bind(dedupKey, incomingSourceId)
    .first<DedupCheckRow>();

  if (!existing) return false;

  const existingPriority = getSourcePriority(existing.source_name);
  const incomingPriority = getSourcePriority(incomingSourceType);

  // Skip the incoming job if the existing one came from a higher-priority source.
  // If priorities are equal, we keep both (they may be legitimately different postings).
  return existingPriority > incomingPriority;
}
