/**
 * Typed D1 query helpers — the ONLY file that contains SQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE: All SQL lives here. No raw queries in routes, ingestion, or
 * enrichment modules. This keeps SQL auditable in one place and prevents
 * query logic from leaking into business logic.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Naming conventions (follow these when adding functions):
 *   getX(db, id)            Fetch one row by PK or unique key. Returns T | null.
 *   listX(db, filter)       Fetch multiple rows with filters. Returns T[].
 *   upsertX(db, input)      Insert or update. Returns { inserted: boolean }.
 *   updateX(db, id, fields) Partial update by id. Returns void.
 *   getXStats(db)           Aggregate query returning summary data.
 *
 * All timestamps are Unix epoch integers (seconds). Convert to ISO strings
 * in the route layer, never here.
 *
 * Prefer D1 batch() for queries that can run in parallel — one round-trip
 * per batch regardless of how many statements are included.
 */

import type {
  ApiKeyRow,
  CompanyRow,
  NormalizedJob,
  SourceRow,
} from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// companies
// ─────────────────────────────────────────────────────────────────────────────

export async function getCompanyBySlug(
  db: D1Database,
  slug: string
): Promise<CompanyRow | null> {
  const result = await db
    .prepare("SELECT * FROM companies WHERE slug = ?")
    .bind(slug)
    .first<CompanyRow>();
  return result ?? null;
}

export async function getCompanyById(
  db: D1Database,
  id: string
): Promise<CompanyRow | null> {
  const result = await db
    .prepare("SELECT * FROM companies WHERE id = ?")
    .bind(id)
    .first<CompanyRow>();
  return result ?? null;
}

/**
 * Insert or update a company. Returns the company id.
 * Logo and website URL are only written when the source provides one AND the
 * company doesn't already have a value stored — prevents lower-trust sources
 * from overwriting data set by a higher-trust source or manual enrichment.
 */
export async function upsertCompany(
  db: D1Database,
  id: string,
  name: string,
  slug: string,
  now: number,
  logoUrl?: string | null,
  websiteUrl?: string | null
): Promise<string> {
  // RETURNING id eliminates a second SELECT round-trip, halving D1 subrequests per job.
  const row = await db
    .prepare(
      `INSERT INTO companies (id, name, slug, logo_url, website_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET
         name        = excluded.name,
         logo_url    = CASE
                         WHEN excluded.logo_url IS NOT NULL AND companies.logo_url IS NULL
                         THEN excluded.logo_url
                         ELSE companies.logo_url
                       END,
         website_url = CASE
                         WHEN excluded.website_url IS NOT NULL AND companies.website_url IS NULL
                         THEN excluded.website_url
                         ELSE companies.website_url
                       END,
         updated_at  = excluded.updated_at
       RETURNING id`
    )
    .bind(id, name, slug, logoUrl ?? null, websiteUrl ?? null, now, now)
    .first<{ id: string }>();
  return row!.id;
}

/**
 * Update enrichment fields for a company.
 * Only updates the provided (non-undefined) fields.
 */
export async function updateCompanyEnrichment(
  db: D1Database,
  id: string,
  fields: {
    logo_url?: string | null;
    website_url?: string | null;
    linkedin_url?: string | null;
    glassdoor_url?: string | null;
    x_url?: string | null;
    description?: string | null;
    description_enriched_at?: number | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const bindings: unknown[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      bindings.push(val);
    }
  }
  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  bindings.push(now);
  bindings.push(id);

  await db
    .prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...bindings)
    .run();
}

/**
 * List companies that need enrichment.
 * Covers three cases:
 *   1. Never enriched (description_enriched_at IS NULL)
 *   2. Enrichment is stale (> 7 days old) — full re-enrich
 *   3. Recently enriched but still missing logo or social links — retry after 24h
 *      (handles failures where Brandfetch/Clearbit returned nothing first time)
 */
export async function listUnenrichedCompanies(
  db: D1Database,
  staleBefore: number,
  retryMissingBefore: number
): Promise<CompanyRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM companies
       WHERE description_enriched_at IS NULL
          OR description_enriched_at < ?
          OR (
               (logo_url IS NULL OR linkedin_url IS NULL)
               AND description_enriched_at < ?
             )
       LIMIT 50`
    )
    .bind(staleBefore, retryMissingBefore)
    .all<CompanyRow>();
  return result.results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// sources
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the next batch of enabled sources ordered by staleness.
 *
 * Sources with the oldest last_fetched_at (or never fetched) are returned
 * first so that every source rotates through on successive cron runs.
 * The limit caps subrequest usage per invocation: each source consumes
 * roughly 6 subrequests (1 HTTP fetch + 5 D1 batch calls), so 150 sources
 * stays safely under Cloudflare's 1,000-subrequest-per-invocation limit.
 */
export async function listEnabledSources(
  db: D1Database,
  limit = 150
): Promise<SourceRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM sources WHERE enabled = 1 ORDER BY last_fetched_at ASC NULLS FIRST LIMIT ?"
    )
    .bind(limit)
    .all<SourceRow>();
  return result.results ?? [];
}

export async function getSourceById(
  db: D1Database,
  id: string
): Promise<SourceRow | null> {
  const result = await db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(id)
    .first<SourceRow>();
  return result ?? null;
}

export async function updateSourceFetchResult(
  db: D1Database,
  id: string,
  lastFetchedAt: number,
  jobCount: number,
  error: string | null
): Promise<void> {
  await db
    .prepare(
      `UPDATE sources
       SET last_fetched_at = ?, last_job_count = ?, last_error = ?
       WHERE id = ?`
    )
    .bind(lastFetchedAt, jobCount, error, id)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// jobs
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertJobInput {
  id: string;
  company_id: string;
  source_id: string;
  external_id: string;
  source_name: string;
  dedup_key: string;
  normalized: NormalizedJob;
  now: number;
}

/**
 * Insert a new job or update an existing one (matched by source_id + external_id).
 *
 * Crucially: description_raw is only stored on first insert, never replaced
 * on subsequent updates. This preserves source truth for AI re-processing.
 * If the raw description changes, ai_generated_at and embedding_generated_at
 * are both nulled to trigger regeneration of AI fields and the search vector.
 *
 * Returns:
 *   inserted          — true if a new row was created
 *   needsEmbedding    — true when the job is new OR its description changed;
 *                       the caller should regenerate the Vectorize embedding.
 *
 * NOTE: Prefer batchUpsertJobs() when processing many jobs from the same source —
 * it collapses the per-job SELECT + INSERT/UPDATE into two db.batch() calls
 * (one subrequest each) instead of 2N individual subrequests.
 */
export async function upsertJob(
  db: D1Database,
  input: UpsertJobInput
): Promise<{ inserted: boolean; needsEmbedding: boolean }> {
  const { id, company_id, source_id, external_id, source_name, dedup_key, normalized, now } = input;
  const {
    title,
    location,
    employment_type,
    workplace_type,
    apply_url,
    source_url,
    description_raw,
    salary_min,
    salary_max,
    salary_currency,
    salary_period,
    posted_at,
  } = normalized;

  const existing = await db
    .prepare("SELECT id, description_raw FROM jobs WHERE source_id = ? AND external_id = ?")
    .bind(source_id, external_id)
    .first<{ id: string; description_raw: string | null }>();

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO jobs (
          id, company_id, source_id, external_id, title, location,
          employment_type, workplace_type, apply_url, source_url, source_name,
          description_raw, salary_min, salary_max, salary_currency, salary_period,
          posted_at, first_seen_at, dedup_key, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )`
      )
      .bind(
        id, company_id, source_id, external_id, title, location,
        employment_type, workplace_type, apply_url, source_url, source_name,
        description_raw, salary_min, salary_max, salary_currency, salary_period,
        posted_at, now, dedup_key, now, now
      )
      .run();
    return { inserted: true, needsEmbedding: true };
  }

  // Detect if description changed so we can invalidate AI cache and embedding
  const descriptionChanged =
    description_raw !== null &&
    existing.description_raw !== description_raw;

  await db
    .prepare(
      `UPDATE jobs SET
        company_id             = ?,
        title                  = ?,
        location               = ?,
        employment_type        = ?,
        workplace_type         = ?,
        apply_url              = ?,
        source_url             = ?,
        salary_min             = ?,
        salary_max             = ?,
        salary_currency        = ?,
        salary_period          = ?,
        posted_at              = ?,
        dedup_key              = ?,
        updated_at             = ?,
        -- Only update description_raw if it has actually changed
        description_raw        = CASE WHEN ? = 1 THEN ? ELSE description_raw END,
        -- Invalidate AI cache and embedding when description changed
        ai_generated_at        = CASE WHEN ? = 1 THEN NULL ELSE ai_generated_at END,
        embedding_generated_at = CASE WHEN ? = 1 THEN NULL ELSE embedding_generated_at END
      WHERE source_id = ? AND external_id = ?`
    )
    .bind(
      company_id,
      title,
      location,
      employment_type,
      workplace_type,
      apply_url,
      source_url,
      salary_min,
      salary_max,
      salary_currency,
      salary_period,
      posted_at,
      dedup_key,
      now,
      descriptionChanged ? 1 : 0, description_raw,
      descriptionChanged ? 1 : 0,
      descriptionChanged ? 1 : 0,
      source_id, external_id
    )
    .run();

  return { inserted: false, needsEmbedding: descriptionChanged };
}

/**
 * Batch-fetch existing job rows for a source in a single D1 subrequest.
 * Returns a Map of external_id → { id, description_raw } for jobs that exist.
 *
 * Using db.batch() here is critical: N individual SELECT calls each consume a
 * separate subrequest and would easily exceed Cloudflare's 1,000 subrequest
 * limit for sources with hundreds of jobs. db.batch() counts as exactly ONE
 * subrequest regardless of how many statements are included.
 */
export async function batchGetExistingJobs(
  db: D1Database,
  sourceId: string,
  externalIds: string[]
): Promise<Map<string, { id: string; description_raw: string | null }>> {
  if (externalIds.length === 0) return new Map();

  const stmts = externalIds.map((eid) =>
    db
      .prepare("SELECT id, description_raw FROM jobs WHERE source_id = ? AND external_id = ?")
      .bind(sourceId, eid)
  );

  const results = await db.batch<{ id: string; description_raw: string | null }>(stmts);
  const map = new Map<string, { id: string; description_raw: string | null }>();
  for (let i = 0; i < externalIds.length; i++) {
    const row = results[i].results?.[0];
    if (row) map.set(externalIds[i], row);
  }
  return map;
}

/**
 * Batch cross-source dedup check in a single D1 subrequest.
 * Returns a Set of dedup_keys that already exist from a different source.
 */
export async function batchCheckCrossSourceDups(
  db: D1Database,
  checks: Array<{ dedupKey: string; sourceId: string }>
): Promise<Set<string>> {
  if (checks.length === 0) return new Set();

  const stmts = checks.map(({ dedupKey, sourceId }) =>
    db
      .prepare("SELECT dedup_key FROM jobs WHERE dedup_key = ? AND source_id != ? LIMIT 1")
      .bind(dedupKey, sourceId)
  );

  const results = await db.batch<{ dedup_key: string }>(stmts);
  const dupes = new Set<string>();
  for (const r of results) {
    const row = r.results?.[0];
    if (row) dupes.add(row.dedup_key);
  }
  return dupes;
}

/**
 * Batch-insert new jobs and batch-update existing ones — two db.batch() calls
 * (one subrequest each) instead of 2N individual subrequests.
 *
 * Returns per-job { inserted, needsEmbedding } results in the same order as
 * the input array so the caller can drive embedding generation.
 */
export async function batchUpsertJobs(
  db: D1Database,
  inputs: UpsertJobInput[],
  existingMap: Map<string, { id: string; description_raw: string | null }>
): Promise<Array<{ inserted: boolean; needsEmbedding: boolean }>> {
  if (inputs.length === 0) return [];

  const inserts: D1PreparedStatement[] = [];
  const insertIndices: number[] = [];
  const updates: D1PreparedStatement[] = [];
  const updateIndices: number[] = [];
  const descChangedFlags: boolean[] = new Array(inputs.length).fill(false);

  const INSERT_SQL = `INSERT INTO jobs (
    id, company_id, source_id, external_id, title, location,
    employment_type, workplace_type, apply_url, source_url, source_name,
    description_raw, salary_min, salary_max, salary_currency, salary_period,
    posted_at, first_seen_at, dedup_key, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const UPDATE_SQL = `UPDATE jobs SET
    company_id = ?, title = ?, location = ?, employment_type = ?,
    workplace_type = ?, apply_url = ?, source_url = ?,
    salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?,
    posted_at = ?, dedup_key = ?, updated_at = ?,
    description_raw        = CASE WHEN ? = 1 THEN ? ELSE description_raw END,
    ai_generated_at        = CASE WHEN ? = 1 THEN NULL ELSE ai_generated_at END,
    embedding_generated_at = CASE WHEN ? = 1 THEN NULL ELSE embedding_generated_at END
  WHERE source_id = ? AND external_id = ?`;

  for (let i = 0; i < inputs.length; i++) {
    const { id, company_id, source_id, external_id, source_name, dedup_key, normalized, now } = inputs[i];
    const {
      title, location, employment_type, workplace_type, apply_url, source_url,
      description_raw, salary_min, salary_max, salary_currency, salary_period, posted_at,
    } = normalized;

    const existing = existingMap.get(external_id);

    if (!existing) {
      inserts.push(
        db.prepare(INSERT_SQL).bind(
          id, company_id, source_id, external_id, title, location,
          employment_type, workplace_type, apply_url, source_url, source_name,
          description_raw, salary_min, salary_max, salary_currency, salary_period,
          posted_at, now, dedup_key, now, now
        )
      );
      insertIndices.push(i);
    } else {
      const descChanged = description_raw !== null && existing.description_raw !== description_raw;
      descChangedFlags[i] = descChanged;
      updates.push(
        db.prepare(UPDATE_SQL).bind(
          company_id, title, location, employment_type,
          workplace_type, apply_url, source_url,
          salary_min, salary_max, salary_currency, salary_period,
          posted_at, dedup_key, now,
          descChanged ? 1 : 0, description_raw,
          descChanged ? 1 : 0,
          descChanged ? 1 : 0,
          source_id, external_id
        )
      );
      updateIndices.push(i);
    }
  }

  // Two subrequests total regardless of how many jobs — one batch for inserts,
  // one for updates. Each db.batch() call counts as a single D1 subrequest.
  if (inserts.length > 0) await db.batch(inserts);
  if (updates.length > 0) await db.batch(updates);

  const results: Array<{ inserted: boolean; needsEmbedding: boolean }> = new Array(inputs.length);
  for (const i of insertIndices) results[i] = { inserted: true, needsEmbedding: true };
  for (const i of updateIndices) results[i] = { inserted: false, needsEmbedding: descChangedFlags[i] };
  return results;
}

/**
 * Fetch a batch of jobs that are missing their Vectorize embedding.
 *
 * This powers the embedding backfill pass that runs at the end of every cron
 * invocation. Jobs land here when:
 *   - The ingestion Worker timed out before their embedding was generated.
 *   - The Gemini API was temporarily unavailable at ingest time.
 *   - The job was inserted before Vectorize was configured.
 *
 * Results are ordered newest-first so that the most recently posted jobs
 * become searchable before older ones during the multi-run backfill period.
 */
export async function getJobsNeedingEmbedding(
  db: D1Database,
  limit: number
): Promise<Array<{
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  description_raw: string | null;
}>> {
  const { results } = await db
    .prepare(`
      SELECT j.id, j.title, c.name AS company_name, j.location, j.description_raw
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      WHERE j.embedding_generated_at IS NULL
      ORDER BY j.first_seen_at DESC
      LIMIT ?
    `)
    .bind(limit)
    .all<{
      id: string;
      title: string;
      company_name: string;
      location: string | null;
      description_raw: string | null;
    }>();
  return results ?? [];
}

/**
 * Mark a job as successfully embedded in Vectorize.
 * Called by the ingestion runner after a successful embedJob() + vectorize.upsert().
 */
export async function markJobEmbedded(
  db: D1Database,
  jobId: string,
  now: number
): Promise<void> {
  await db
    .prepare("UPDATE jobs SET embedding_generated_at = ? WHERE id = ?")
    .bind(now, jobId)
    .run();
}

/**
 * Mark multiple jobs as embedded in a single D1 batch request.
 *
 * D1's batch() API sends all statements in one HTTP round-trip to Cloudflare,
 * turning N individual UPDATE calls into 1. Use this after batching Vectorize
 * upserts so both operations stay in sync: either all N jobs are marked or
 * none are (on failure the next cron retries the full set).
 */
export async function batchMarkJobsEmbedded(
  db: D1Database,
  jobIds: string[],
  now: number
): Promise<void> {
  if (jobIds.length === 0) return;
  const stmt = db.prepare("UPDATE jobs SET embedding_generated_at = ? WHERE id = ?");
  await db.batch(jobIds.map((id) => stmt.bind(now, id)));
}

/**
 * Maximum IDs per D1 IN() clause.
 *
 * D1 limits bound parameters per statement to roughly 100. The IN() clause
 * consumes one slot per ID, and the filter conditions consume a few more.
 * Keeping ID chunks at 90 leaves headroom for up to 10 additional filter bindings.
 */
const D1_IN_CHUNK = 90;

/**
 * Fetch a set of jobs by their IDs, applying optional secondary filters.
 * Used by the vector search path: Vectorize returns ranked IDs, then we
 * hydrate those rows from D1 and apply location/type/company filters here.
 *
 * IDs are chunked into groups of D1_IN_CHUNK to stay within D1's bound-parameter
 * limit (~100 per statement). Each chunk is a separate D1 call; results are merged
 * and re-sorted by the original Vectorize similarity order.
 *
 * Returns rows in the same ID order they were provided (caller responsibility:
 * pass IDs ordered by descending similarity score from Vectorize).
 */
export async function listJobsByIds(
  db: D1Database,
  ids: string[],
  filter: Pick<ListJobsFilter, "location" | "employment_type" | "workplace_type" | "company">
): Promise<ListJobsRow[]> {
  if (ids.length === 0) return [];

  // Split into chunks that fit within D1's parameter limit
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
    chunks.push(ids.slice(i, i + D1_IN_CHUNK));
  }

  const allRows: ListJobsRow[] = [];
  for (const chunk of chunks) {
    const rows = await listJobsByIdsChunk(db, chunk, filter);
    allRows.push(...rows);
  }

  // Re-sort by the original Vectorize similarity order across all chunks
  const idOrder = new Map(ids.map((id, i) => [id, i]));
  return allRows.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
}

async function listJobsByIdsChunk(
  db: D1Database,
  ids: string[],
  filter: Pick<ListJobsFilter, "location" | "employment_type" | "workplace_type" | "company">
): Promise<ListJobsRow[]> {
  const placeholders = ids.map(() => "?").join(", ");
  const conditions: string[] = [`j.id IN (${placeholders})`];
  const bindings: unknown[] = [...ids];

  if (filter.location) {
    conditions.push("j.location LIKE ?");
    bindings.push(`%${filter.location}%`);
  }
  if (filter.employment_type) {
    conditions.push("j.employment_type = ?");
    bindings.push(filter.employment_type);
  }
  if (filter.workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(filter.workplace_type);
  }
  if (filter.company) {
    conditions.push("c.slug = ?");
    bindings.push(filter.company);
  }

  const where = conditions.join(" AND ");
  // Same explicit column list as listJobs — no description_raw or job_description
  const sql = `
    SELECT
      j.id, j.company_id, j.source_id, j.external_id,
      j.title, j.location, j.employment_type, j.workplace_type,
      j.apply_url, j.source_url, j.source_name,
      j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
      j.job_summary, j.ai_generated_at, j.embedding_generated_at,
      j.posted_at, j.first_seen_at, j.dedup_key, j.created_at, j.updated_at,
      c.name          AS company_name,
      c.logo_url      AS company_logo_url,
      c.description   AS company_description,
      c.website_url   AS company_website_url,
      c.linkedin_url  AS company_linkedin_url,
      c.glassdoor_url AS company_glassdoor_url,
      c.x_url         AS company_x_url
    FROM jobs j
    JOIN companies c ON j.company_id = c.id
    WHERE ${where}
  `;

  const { results } = await db.prepare(sql).bind(...bindings).all<ListJobsRow>();
  return results ?? [];
}

export interface ListJobsFilter {
  q?: string;
  location?: string;
  employment_type?: string;
  workplace_type?: string;
  company?: string;
  limit: number;
  cursor?: string; // opaque cursor = base64(last posted_at:id)
}

/**
 * Columns returned by the list endpoints (/jobs, /jobs?q=).
 *
 * Intentionally EXCLUDES description_raw and job_description — each can be
 * 10–50 KB of raw HTML / JSON that the list endpoint never exposes. Selecting
 * them would multiply D1 data transfer by ~10x for zero benefit.
 *
 * getJobById() still returns a full JobRow with both heavy fields because the
 * detail endpoint needs them for lazy AI enrichment.
 */
export interface ListJobsRow {
  // core job fields (same as JobRow minus the two heavy text columns)
  id: string;
  company_id: string;
  source_id: string;
  external_id: string;
  title: string;
  location: string | null;
  employment_type: import("../types.ts").EmploymentType | null;
  workplace_type: import("../types.ts").WorkplaceType | null;
  apply_url: string;
  source_url: string | null;
  source_name: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: import("../types.ts").SalaryPeriod | null;
  job_summary: string | null;
  ai_generated_at: number | null;
  embedding_generated_at: number | null;
  posted_at: number | null;
  first_seen_at: number;
  dedup_key: string;
  created_at: number;
  updated_at: number;
  // joined company fields
  company_name: string;
  company_logo_url: string | null;
  company_description: string | null;
  company_website_url: string | null;
  company_linkedin_url: string | null;
  company_glassdoor_url: string | null;
  company_x_url: string | null;
}

export async function listJobs(
  db: D1Database,
  filter: ListJobsFilter
): Promise<{ rows: ListJobsRow[]; total: number | null }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filter.q) {
    conditions.push("(j.title LIKE ? OR c.name LIKE ?)");
    const pattern = `%${filter.q}%`;
    bindings.push(pattern, pattern);
  }
  if (filter.location) {
    conditions.push("j.location LIKE ?");
    bindings.push(`%${filter.location}%`);
  }
  if (filter.employment_type) {
    conditions.push("j.employment_type = ?");
    bindings.push(filter.employment_type);
  }
  if (filter.workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(filter.workplace_type);
  }
  if (filter.company) {
    conditions.push("c.slug = ?");
    bindings.push(filter.company);
  }

  // Cursor decoding: cursor encodes the last row's sort key so we can do
  // keyset pagination without page offsets (stable even as new rows arrive).
  if (filter.cursor) {
    try {
      const decoded = atob(filter.cursor);
      const [ts, id] = decoded.split(":");
      conditions.push("(j.posted_at < ? OR (j.posted_at = ? AND j.id < ?))");
      bindings.push(Number(ts), Number(ts), id);
    } catch {
      // Malformed cursor: ignore and start from beginning
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Explicit column list — excludes description_raw and job_description.
  // Each of those can be 10–50 KB of raw HTML/JSON; a 20-job list response
  // without them is ~10–50× smaller, cutting D1 read bytes and Worker memory.
  const selectJoined = `
    SELECT
      j.id, j.company_id, j.source_id, j.external_id,
      j.title, j.location, j.employment_type, j.workplace_type,
      j.apply_url, j.source_url, j.source_name,
      j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
      j.job_summary, j.ai_generated_at, j.embedding_generated_at,
      j.posted_at, j.first_seen_at, j.dedup_key, j.created_at, j.updated_at,
      c.name          AS company_name,
      c.logo_url      AS company_logo_url,
      c.description   AS company_description,
      c.website_url   AS company_website_url,
      c.linkedin_url  AS company_linkedin_url,
      c.glassdoor_url AS company_glassdoor_url,
      c.x_url         AS company_x_url
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    ${where}
  `;

  // Skip COUNT on cursor pages — the client already has the total from page 1,
  // and re-counting the full table on every paginated request is wasteful.
  if (filter.cursor) {
    const dataResult = await db
      .prepare(`${selectJoined} ORDER BY j.posted_at DESC, j.id DESC LIMIT ?`)
      .bind(...bindings, filter.limit)
      .all<ListJobsRow>();
    return { rows: dataResult.results ?? [], total: null };
  }

  // First page: run COUNT and data in parallel (two D1 calls → one round-trip)
  const [countResult, dataResult] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS n FROM jobs j JOIN companies c ON c.id = j.company_id ${where}`)
      .bind(...bindings)
      .first<{ n: number }>(),
    db
      .prepare(`${selectJoined} ORDER BY j.posted_at DESC, j.id DESC LIMIT ?`)
      .bind(...bindings, filter.limit)
      .all<ListJobsRow>(),
  ]);

  return {
    rows: dataResult.results ?? [],
    total: countResult?.n ?? 0,
  };
}

/** Full job row including the heavy description_raw and job_description fields. */
export interface FullJobRow extends ListJobsRow {
  description_raw: string | null;
  job_description: string | null;
}

export async function getJobById(
  db: D1Database,
  id: string
): Promise<FullJobRow | null> {
  const result = await db
    .prepare(
      `SELECT
        j.*,
        c.name          AS company_name,
        c.logo_url      AS company_logo_url,
        c.description   AS company_description,
        c.website_url   AS company_website_url,
        c.linkedin_url  AS company_linkedin_url,
        c.glassdoor_url AS company_glassdoor_url,
        c.x_url         AS company_x_url
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       WHERE j.id = ?`
    )
    .bind(id)
    .first<FullJobRow>();
  return result ?? null;
}

/**
 * 首次懒加载描述时写入description_raw。
 * 不覆盖已有值——若已有描述则跳过（由调用方保证只在null时调用）。
 */
export async function updateJobDescriptionRaw(
  db: D1Database,
  id: string,
  descriptionRaw: string
): Promise<void> {
  await db
    .prepare("UPDATE jobs SET description_raw = ? WHERE id = ? AND description_raw IS NULL")
    .bind(descriptionRaw, id)
    .run();
}

/** Cache AI-generated fields back into the jobs row. */
export async function updateJobAiFields(
  db: D1Database,
  id: string,
  jobSummary: string,
  jobDescription: string, // serialized JSON
  now: number,
  salary?: { min: number; currency: string; period: string } | null
): Promise<void> {
  if (salary) {
    // Write salary only when the model explicitly found it — never overwrite with null
    await db
      .prepare(
        `UPDATE jobs
         SET job_summary = ?, job_description = ?, ai_generated_at = ?,
             salary_min = ?, salary_currency = ?, salary_period = ?
         WHERE id = ?`
      )
      .bind(jobSummary, jobDescription, now, salary.min, salary.currency, salary.period, id)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE jobs
         SET job_summary = ?, job_description = ?, ai_generated_at = ?
         WHERE id = ?`
      )
      .bind(jobSummary, jobDescription, now, id)
      .run();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// api_keys
// ─────────────────────────────────────────────────────────────────────────────

export async function getApiKeyByHash(
  db: D1Database,
  hash: string
): Promise<ApiKeyRow | null> {
  const result = await db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ? AND active = 1")
    .bind(hash)
    .first<ApiKeyRow>();
  return result ?? null;
}

export async function touchApiKeyLastUsed(
  db: D1Database,
  id: string,
  now: number
): Promise<void> {
  await db
    .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
    .bind(now, id)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// stats (market overview)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketStats {
  total_jobs: number;
  jobs_last_24h: number;
  jobs_last_7d: number;
  jobs_last_30d: number;
  by_employment_type: Array<{ employment_type: string | null; count: number }>;
  by_workplace_type: Array<{ workplace_type: string | null; count: number }>;
  top_companies: Array<{ company_name: string; count: number }>;
  total_companies: number;
  total_sources: number;
}

/**
 * Aggregate statistics for the market overview endpoint.
 * All counts are run in a single D1 batch to minimize round-trips.
 */
export async function getMarketStats(db: D1Database): Promise<MarketStats> {
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  const [
    totalResult,
    last24hResult,
    last7dResult,
    last30dResult,
    byEmploymentResult,
    byWorkplaceResult,
    topCompaniesResult,
    totalCompaniesResult,
    totalSourcesResult,
  ] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM jobs"),
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?").bind(now - day),
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?").bind(now - 7 * day),
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?").bind(now - 30 * day),
    db.prepare(
      `SELECT employment_type, COUNT(*) AS count FROM jobs
       GROUP BY employment_type ORDER BY count DESC`
    ),
    db.prepare(
      `SELECT workplace_type, COUNT(*) AS count FROM jobs
       GROUP BY workplace_type ORDER BY count DESC`
    ),
    db.prepare(
      `SELECT c.name AS company_name, COUNT(*) AS count
       FROM jobs j JOIN companies c ON c.id = j.company_id
       GROUP BY j.company_id ORDER BY count DESC LIMIT 10`
    ),
    db.prepare("SELECT COUNT(*) AS n FROM companies"),
    db.prepare("SELECT COUNT(*) AS n FROM sources WHERE enabled = 1"),
  ]);

  return {
    total_jobs: (totalResult.results[0] as { n: number })?.n ?? 0,
    jobs_last_24h: (last24hResult.results[0] as { n: number })?.n ?? 0,
    jobs_last_7d: (last7dResult.results[0] as { n: number })?.n ?? 0,
    jobs_last_30d: (last30dResult.results[0] as { n: number })?.n ?? 0,
    by_employment_type: (byEmploymentResult.results ?? []) as Array<{ employment_type: string | null; count: number }>,
    by_workplace_type: (byWorkplaceResult.results ?? []) as Array<{ workplace_type: string | null; count: number }>,
    top_companies: (topCompaniesResult.results ?? []) as Array<{ company_name: string; count: number }>,
    total_companies: (totalCompaniesResult.results[0] as { n: number })?.n ?? 0,
    total_sources: (totalSourcesResult.results[0] as { n: number })?.n ?? 0,
  };
}

/**
 * Look up a company by slug and return its open job count.
 * Used by the MCP get_jobs_by_company tool to validate the company exists.
 */
export async function getCompanyStats(
  db: D1Database,
  slug: string
): Promise<{ id: string; name: string; job_count: number } | null> {
  const result = await db
    .prepare(
      `SELECT c.id, c.name, COUNT(j.id) AS job_count
       FROM companies c
       LEFT JOIN jobs j ON j.company_id = c.id
       WHERE c.slug = ?
       GROUP BY c.id`
    )
    .bind(slug)
    .first<{ id: string; name: string; job_count: number }>();
  return result ?? null;
}

