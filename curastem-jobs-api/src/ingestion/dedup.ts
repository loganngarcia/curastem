/**
 * Deduplication logic.
 *
 * Two levels of deduplication:
 *
 * 1. EXACT MATCH (primary, per-source)
 *    Detected by: source_id + external_id UNIQUE constraint in D1.
 *    Handled by: batch upsert in queries.ts — same record = update in place.
 *
 * 2. CROSS-SOURCE MATCH (secondary, across sources)
 *    Detected by: dedup_key = lower(title) + "|" + company_slug (see buildDedupKey).
 *    The batch path lives entirely in queries.ts:
 *    - batchCheckCrossSourceDups — skip incoming rows when another source already
 *      holds the same key with strictly higher SOURCE_PRIORITY.
 *    - batchDeleteJobsSupersededByHigherPriority — before upsert, delete rows from
 *      lower-priority sources that share a dedup_key so the higher-priority feed wins.
 *
 *    Both functions accept a `priorityOf` callback rather than importing the registry
 *    directly — keeps the DB layer free of ingestion-layer dependencies.
 *
 * Rules:
 *   - Higher priority strictly wins (incoming priority > existing → supersede).
 *   - Equal priority → both rows coexist (different boards for the same company are
 *     legitimately distinct postings).
 *   - Lower priority → skip incoming, leave existing untouched.
 *
 * Company name variants (e.g. "US Bancorp" vs "U.S. Bank") must resolve to the same
 * canonical slug via company_aliases in migrate.ts, or dedup keys will not match.
 */

import { getSourcePriority } from "./registry.ts";

/**
 * Single-row ad-hoc check: true if the incoming job should be skipped.
 * Production path uses the batch functions in queries.ts for efficiency.
 */
export async function isCrossSourceDuplicate(
  db: D1Database,
  dedupKey: string,
  incomingSourceType: string,
  incomingSourceId: string
): Promise<boolean> {
  const res = await db
    .prepare(
      `SELECT source_name FROM jobs WHERE dedup_key = ? AND source_id != ?`
    )
    .bind(dedupKey, incomingSourceId)
    .all<{ source_name: string }>();

  let maxP = -1;
  for (const row of res.results ?? []) {
    const p = getSourcePriority(row.source_name);
    if (p > maxP) maxP = p;
  }
  if (maxP < 0) return false;
  return maxP > getSourcePriority(incomingSourceType);
}
