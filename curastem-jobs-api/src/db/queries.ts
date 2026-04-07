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

import type { VectorizeIndex } from "@cloudflare/workers-types";
import type {
  ApiKeyRow,
  CompanyRow,
  NormalizedJob,
  SourceRow,
} from "../types.ts";
import { CRUNCHBASE_SOURCE_ID, CRUNCHBASE_SOURCE_LEGACY_ID } from "./sourceIds.ts";
import { normalizeLocationForGeocode } from "../utils/placesGeocode.ts";
import {
  companySlugFromSearchQuery,
  companySlugsFromFilterParam,
  titleSearchTokensForSql,
} from "../utils/jobSearchQuery.ts";

// ─────────────────────────────────────────────────────────────────────────────
// companies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an incoming company slug to its canonical slug via the aliases table.
 * Returns the canonical slug if an alias exists, otherwise returns the input unchanged.
 * Used at ingestion time so variant names (e.g. "hadrian" vs "hadrian-automation")
 * collapse to the same company row and share a dedup_key namespace.
 */
export async function resolveCompanySlug(
  db: D1Database,
  slug: string
): Promise<string> {
  const row = await db
    .prepare("SELECT canonical_slug FROM company_aliases WHERE alias_slug = ?")
    .bind(slug)
    .first<{ canonical_slug: string }>();
  return row?.canonical_slug ?? slug;
}

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
 * Resolve a search query to a company when it matches a company name or slug.
 * Used to route company-specific queries (e.g. "alo yoga") to SQL path instead
 * of vector search, since unembedded jobs would otherwise be invisible.
 */
const COMPANY_QUERY_JOB_SUFFIX =
  /\s+(jobs?|careers?|openings?|hiring|roles?|vacancies|positions?|work|employment)\s*$/i;

/**
 * Single-token queries that are almost always role/industry terms, not company names.
 * Prevents LIKE '%software%' from locking onto the wrong employer row.
 */
const GENERIC_JOB_SEARCH_SINGLE_WORD = new Set([
  "software",
  "coding",
  "dev",
  "developer",
  "development",
  "hardware",
  "engineer",
  "engineering",
  "developer",
  "development",
  "manager",
  "director",
  "nursing",
  "nurse",
  "retail",
  "healthcare",
  "finance",
  "sales",
  "marketing",
  "remote",
  "hybrid",
  "contract",
  "internship",
  "intern",
  "cashier",
  "designer",
  "scientist",
  "analyst",
  "recruiter",
  "consultant",
  "specialist",
  "coordinator",
  "associate",
  "support",
  "accounting",
  "legal",
  "attorney",
  "lawyer",
  "therapist",
  "physician",
  "pharmacist",
  "teacher",
  "education",
  "hospitality",
  "warehouse",
  "manufacturing",
  "construction",
]);

/**
 * In a two-word search, if the second token looks like a job title (not a company suffix),
 * do not try the first word alone as a company — avoids "Product Manager" → LIKE '%product%'
 * matching "Consumer Product Safety Commission".
 */
const JOB_TITLE_LIKE_SECOND_WORD = new Set([
  "manager",
  "engineer",
  "engineering",
  "scientist",
  "analyst",
  "developer",
  "designer",
  "architect",
  "lead",
  "director",
  "officer",
  "specialist",
  "coordinator",
  "associate",
  "representative",
  "recruiter",
  "partner",
  "consultant",
  "programmer",
  "administrator",
  "technician",
  "attorney",
  "counsel",
  "assistant",
  "intern",
  "nurse",
  "therapist",
  "writer",
  "editor",
  "producer",
  "supervisor",
  "operator",
  "mechanic",
  "pharmacist",
  "physician",
  "teacher",
  "lawyer",
  "executive",
  "president",
  "controller",
  "accountant",
  "marketing",
  "sales",
  "support",
  "graduate",
  "researcher",
  "planner",
  "buyer",
]);

/**
 * Skip findCompanyByQuery for two-word phrases that look like job titles
 * ("Product Designer"), not employer names — avoids locking onto the wrong company.
 */
export function shouldResolveSearchQueryToCompany(q: string): boolean {
  const parts = q.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2 || !parts[1]) return true;
  return !JOB_TITLE_LIKE_SECOND_WORD.has(parts[1].toLowerCase());
}

async function tryResolveCompanyPhrase(
  db: D1Database,
  phrase: string
): Promise<{ slug: string } | null> {
  const p = phrase.trim();
  if (p.length < 2 || p.length > 80) return null;
  if (!p.includes(" ") && GENERIC_JOB_SEARCH_SINGLE_WORD.has(p.toLowerCase())) {
    return null;
  }
  const slugForm = p.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (!slugForm) return null;
  const qLower = p.toLowerCase();
  const esc = (s: string) => s.replace(/%/g, "\\%").replace(/_/g, "\\_");
  // Short single tokens: only exact slug or exact display name — avoids LIKE '%swe%' false positives.
  if (!p.includes(" ") && p.length <= 5) {
    return (
      (await db
        .prepare(
          "SELECT slug FROM companies WHERE slug = ? OR LOWER(TRIM(name)) = ? LIMIT 1"
        )
        .bind(slugForm, qLower)
        .first<{ slug: string }>()) ?? null
    );
  }
  // Multi-word phrase: name must contain the full string (e.g. "alo yoga", "goldman sachs").
  if (p.includes(" ")) {
    const likePattern = `%${esc(qLower)}%`;
    return (
      (await db
        .prepare(
          "SELECT slug FROM companies WHERE slug = ? OR LOWER(name) LIKE ? ESCAPE '\\' LIMIT 1"
        )
        .bind(slugForm, likePattern)
        .first<{ slug: string }>()) ?? null
    );
  }
  // Single word, length >= 6: prefix match on name — never substring LIKE '%word%',
  // which matched "Consumer Product Safety Commission" for q=product.
  const prefixPattern = `${esc(qLower)}%`;
  return (
    (await db
      .prepare(
        "SELECT slug FROM companies WHERE slug = ? OR LOWER(TRIM(name)) = ? OR LOWER(name) LIKE ? ESCAPE '\\' LIMIT 1"
      )
      .bind(slugForm, qLower, prefixPattern)
      .first<{ slug: string }>()) ?? null
  );
}

/**
 * Resolve a search query to a company when it matches a company name or slug.
 * Strips trailing "jobs", "careers", etc. so "google jobs" resolves to Google.
 */
export async function findCompanyByQuery(
  db: D1Database,
  q: string
): Promise<{ slug: string } | null> {
  const trimmed = q.trim();
  if (!trimmed || trimmed.length > 80) return null;

  const single = trimmed.split(/\s+/);
  if (
    single.length === 1 &&
    GENERIC_JOB_SEARCH_SINGLE_WORD.has(trimmed.toLowerCase())
  ) {
    return null;
  }

  const dejobbed = trimmed.replace(COMPANY_QUERY_JOB_SUFFIX, "").trim();
  const phrases: string[] = [];
  if (dejobbed) phrases.push(dejobbed);
  if (trimmed !== dejobbed) phrases.push(trimmed);
  const parts = dejobbed.split(/\s+/).filter(Boolean);
  // Only consider "Brand" from two-word queries like "Stripe Payments", not three-word titles.
  if (
    parts.length === 2 &&
    parts[0] &&
    parts[0].length >= 2 &&
    parts[1] &&
    !JOB_TITLE_LIKE_SECOND_WORD.has(parts[1].toLowerCase())
  ) {
    phrases.push(parts[0]);
  }

  const seen = new Set<string>();
  for (const phrase of phrases) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const row = await tryResolveCompanyPhrase(db, phrase);
    if (row) return row;
  }
  return null;
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
    // Existing enrichment fields
    logo_url?: string | null;
    website_url?: string | null;
    linkedin_url?: string | null;
    glassdoor_url?: string | null;
    x_url?: string | null;
    description?: string | null;
    description_enriched_at?: number | null;
    website_checked_at?: number | null;
    website_infer_suppressed?: number;
    // Exa enrichment gates
    exa_company_enriched_at?: number | null;
    exa_social_enriched_at?: number | null;
    // New social links
    instagram_url?: string | null;
    youtube_url?: string | null;
    github_url?: string | null;
    huggingface_url?: string | null;
    tiktok_url?: string | null;
    crunchbase_url?: string | null;
    facebook_url?: string | null;
    // Company profile
    employee_count_range?: string | null;
    employee_count?: number | null;
    founded_year?: number | null;
    hq_address?: string | null;
    hq_city?: string | null;
    hq_country?: string | null;
    hq_lat?: number | null;
    hq_lng?: number | null;
    /** Set to epoch timestamp when Places geocode fails; null to clear (retry). */
    hq_geocode_failed_at?: number | null;
    industry?: string | null;
    company_type?: string | null;
    total_funding_usd?: number | null;
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

  // When location data improves, reset the failure flag so Places geocode retries.
  if (
    fields.hq_city !== undefined ||
    fields.hq_country !== undefined ||
    fields.hq_address !== undefined
  ) {
    sets.push("hq_geocode_failed_at = NULL");
  }

  sets.push("updated_at = ?");
  bindings.push(now);
  bindings.push(id);

  await db
    .prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...bindings)
    .run();
}

/**
 * Aggregate unique normalized job locations for a company and write them to
 * `companies.locations`. Called after every batch upsert so the company record
 * always reflects the current open-job office footprint.
 */
export async function updateCompanyLocations(
  db: D1Database,
  companyId: string
): Promise<void> {
  // Pull every non-null locations JSON array from active jobs for this company
  const { results } = await db
    .prepare("SELECT locations FROM jobs WHERE company_id = ? AND locations IS NOT NULL")
    .bind(companyId)
    .all<{ locations: string }>();

  const seen = new Set<string>();
  for (const row of results ?? []) {
    try {
      const arr = JSON.parse(row.locations) as unknown[];
      for (const loc of arr) {
        if (typeof loc === "string" && loc.trim() && loc.toLowerCase() !== "remote") {
          seen.add(loc.trim());
        }
      }
    } catch {
      // Skip malformed rows
    }
  }

  if (seen.size === 0) return;

  await db
    .prepare("UPDATE companies SET locations = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify([...seen].sort()), Math.floor(Date.now() / 1000), companyId)
    .run();
}

/**
 * Ensures `companies` has migration 008 columns (website probe + infer lockout).
 * Cold or pre-migration D1 would otherwise break seed/corrections/probe SQL; this is a no-op when columns exist.
 */
export async function ensureCompanyWebsiteProbeColumns(db: D1Database): Promise<void> {
  const info = await db.prepare("PRAGMA table_info(companies)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((r) => r.name));
  if (!names.has("website_checked_at")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN website_checked_at INTEGER").run();
  }
  if (!names.has("website_infer_suppressed")) {
    await db
      .prepare(
        "ALTER TABLE companies ADD COLUMN website_infer_suppressed INTEGER NOT NULL DEFAULT 0"
      )
      .run();
  }
}

/**
 * Ensures `companies` has all migration 009 columns (Exa enrichment + extended profile).
 * Self-healing: runs on every cron/admin path so the worker never fails on a cold D1.
 */
export async function ensureCompanyExaColumns(db: D1Database): Promise<void> {
  const info = await db.prepare("PRAGMA table_info(companies)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((r) => r.name));

  const missing: Array<[string, string]> = [
    ["exa_company_enriched_at","INTEGER"],
    ["exa_social_enriched_at", "INTEGER"],
    ["instagram_url",         "TEXT"],
    ["youtube_url",           "TEXT"],
    ["github_url",            "TEXT"],
    ["huggingface_url",       "TEXT"],
    ["tiktok_url",            "TEXT"],
    ["crunchbase_url",        "TEXT"],
    ["facebook_url",          "TEXT"],
    ["employee_count_range",  "TEXT"],
    ["employee_count",        "INTEGER"],
    ["founded_year",          "INTEGER"],
    ["hq_address",            "TEXT"],
    ["hq_city",               "TEXT"],
    ["hq_country",            "TEXT"],
    ["hq_lat",                "REAL"],
    ["hq_lng",                "REAL"],
    ["industry",              "TEXT"],
    ["company_type",          "TEXT"],
    ["total_funding_usd",     "INTEGER"],
    ["locations",             "TEXT"],
  ];

  for (const [col, type] of missing) {
    if (!names.has(col)) {
      await db.prepare(`ALTER TABLE companies ADD COLUMN ${col} ${type}`).run();
    }
  }
}

/**
 * Companies that have never had the Exa deep social pass run AND have at
 * least 1 job — avoids Exa spend on empty company records.
 * Run-once: once exa_social_enriched_at is set it never re-runs automatically.
 */
export async function listCompaniesForSocialEnrichment(
  db: D1Database,
  limit: number
): Promise<CompanyRow[]> {
  const result = await db
    .prepare(
      `SELECT c.* FROM companies c
       INNER JOIN (
         SELECT company_id, MAX(COALESCE(posted_at, first_seen_at)) AS newest_job,
                COUNT(*) AS job_count
         FROM jobs GROUP BY company_id
       ) j ON j.company_id = c.id
       WHERE c.exa_social_enriched_at IS NULL
         AND j.job_count >= 1
       ORDER BY j.newest_job DESC NULLS LAST
       LIMIT ?`
    )
    .bind(limit)
    .all<CompanyRow>();
  return result.results ?? [];
}

/**
 * Ensures `jobs` has migration 011 columns (experience_years_min, job address fields).
 * Self-healing: runs on every cron/admin path so the worker never fails on a cold D1.
 *
 * Do not run a full-table `location_primary` backfill here — unbounded UPDATE OOMs D1 in-Worker.
 * Use `backfillLocationPrimary` from the `:30` cron instead.
 */
export async function ensureNewJobColumns(db: D1Database): Promise<void> {
  const info = await db.prepare("PRAGMA table_info(jobs)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((r) => r.name));

  const missing: Array<[string, string]> = [
    ["experience_years_min", "INTEGER"],
    ["job_address",          "TEXT"],
    ["job_city",             "TEXT"],
    ["job_state",            "TEXT"],
    ["job_country",          "TEXT"],
    ["location_primary",     "TEXT"],
  ];

  for (const [col, type] of missing) {
    if (!names.has(col)) {
      await db.prepare(`ALTER TABLE jobs ADD COLUMN ${col} ${type}`).run();
    }
  }
}

/**
 * Batched backfill for rows created before `location_primary` was denormalized.
 * Small LIMIT keeps D1 memory under Worker limits; `:30` cron calls this each hour until drained.
 */
export async function backfillLocationPrimary(db: D1Database, limit = 1000): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE jobs SET location_primary = json_extract(locations, '$[0]')
       WHERE id IN (
         SELECT id FROM jobs
         WHERE locations IS NOT NULL AND location_primary IS NULL
         LIMIT ?
       )`
    )
    .bind(limit)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Idempotent CREATE INDEX for analytics / deep-dive migrations (see schema.sql + migrations/014).
 * Consider backfill index lives in migrations/015 only — avoid building it in-Worker (OOM risk).
 */
export async function ensureJobIndexes(db: D1Database): Promise<void> {
  const stmts = [
    `CREATE INDEX IF NOT EXISTS idx_jobs_location_primary ON jobs (location_primary)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_job_country ON jobs (job_country, posted_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_salary_min ON jobs (salary_min, posted_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_visa_sponsorship ON jobs (visa_sponsorship, posted_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_active_hash ON api_keys (key_hash) WHERE active = 1`,
  ];
  for (const sql of stmts) {
    await db.prepare(sql).run();
  }
}

/**
 * List companies that need enrichment.
 * Covers three cases:
 *   1. Never enriched (description_enriched_at IS NULL)
 *   2. Enrichment is stale (> 7 days old) — full re-enrich
 *   3. Recently enriched but still missing logo or social links — retry after 24h
 *      (handles failures where Brandfetch/Clearbit returned nothing first time)
 */
/**
 * Companies with a Brandfetch wordmark logo (path matches /theme/.* /logo.*) that should
 * be upgraded to a Logo.dev square icon. No staleness gate.
 */
export async function listCompaniesWithWordmarkLogo(
  db: D1Database,
  limit = 50
): Promise<CompanyRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM companies
       WHERE logo_url LIKE '%cdn.brandfetch.io%'
         AND logo_url LIKE '%/theme/%/logo.%'
       LIMIT ?`
    )
    .bind(limit)
    .all<CompanyRow>();
  return result.results ?? [];
}

/**
 * Companies with no logo at all — no staleness gate so cleared logos are re-fetched
 * immediately without waiting for the 24-hour description_enriched_at retry window.
 * Only returns companies with at least one job (avoids empty shells).
 */
export async function listCompaniesNeedingLogo(
  db: D1Database,
  limit = 50
): Promise<CompanyRow[]> {
  // No job-existence gate: companies may have been created by upsertCompany during ingestion
  // but their source hasn't completed yet. We still want to fill logos for them.
  // Prioritize companies with website_url (domain-based lookup) over domain-less ones.
  const result = await db
    .prepare(
      `SELECT * FROM companies
       WHERE logo_url IS NULL OR logo_url = ''
       ORDER BY CASE WHEN website_url IS NOT NULL THEN 0 ELSE 1 END, id
       LIMIT ?`
    )
    .bind(limit)
    .all<CompanyRow>();
  return result.results ?? [];
}

export async function listUnenrichedCompanies(
  db: D1Database,
  staleBefore: number,
  retryMissingBefore: number,
  limit = 50
): Promise<CompanyRow[]> {
  const result = await db
    .prepare(
      `SELECT c.* FROM companies c
       LEFT JOIN (
         SELECT company_id, MAX(COALESCE(posted_at, first_seen_at)) AS newest_job
         FROM jobs GROUP BY company_id
       ) j ON j.company_id = c.id
       WHERE c.description_enriched_at IS NULL
          OR c.description_enriched_at < ?
          OR (
               (  c.logo_url IS NULL
               OR c.logo_url LIKE 'https://www.google.com/s2/favicons%'
               OR c.logo_url LIKE 'https://img.logo.dev/%'
               OR c.linkedin_url IS NULL
               )
               AND c.description_enriched_at < ?
             )
       ORDER BY j.newest_job DESC NULLS LAST
       LIMIT ?`
    )
    .bind(staleBefore, retryMissingBefore, limit)
    .all<CompanyRow>();
  return result.results ?? [];
}

/**
 * Companies that have never had the Exa category pass run AND have at least
 * one job — avoids burning Exa credits on empty shell companies.
 * Run-once: once exa_company_enriched_at is set it never re-runs automatically.
 */
export async function listCompaniesForExaEnrichment(
  db: D1Database,
  limit: number
): Promise<CompanyRow[]> {
  const result = await db
    .prepare(
      `SELECT c.* FROM companies c
       INNER JOIN (
         SELECT company_id, MAX(COALESCE(posted_at, first_seen_at)) AS newest_job,
                COUNT(*) AS job_count
         FROM jobs GROUP BY company_id
       ) j ON j.company_id = c.id
       WHERE c.exa_company_enriched_at IS NULL
         AND j.job_count >= 1
       ORDER BY j.newest_job DESC NULLS LAST
       LIMIT ?`
    )
    .bind(limit)
    .all<CompanyRow>();
  return result.results ?? [];
}

/**
 * Also gate social enrichment the same way — only companies with at least 1 job.
 */

/**
 * Companies with a stored website due for an HTTP reachability probe.
 * Re-checks periodically so parked domains and 404 homepages stop surfacing as links.
 */
export async function listCompaniesForWebsiteProbe(
  db: D1Database,
  checkedBefore: number,
  limit: number
): Promise<CompanyRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM companies
       WHERE website_url IS NOT NULL AND TRIM(website_url) != ''
         AND (website_checked_at IS NULL OR website_checked_at < ?)
       ORDER BY website_checked_at ASC NULLS FIRST, updated_at ASC
       LIMIT ?`
    )
    .bind(checkedBefore, limit)
    .all<CompanyRow>();
  return result.results ?? [];
}

/** Persist website probe outcome (may clear website_url and set infer suppression). */
export async function updateCompanyWebsiteProbeResult(
  db: D1Database,
  id: string,
  patch: {
    website_checked_at: number;
    website_infer_suppressed?: number;
    website_url?: string | null;
  }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const sets: string[] = ["website_checked_at = ?"];
  const bindings: unknown[] = [patch.website_checked_at];
  if (patch.website_infer_suppressed !== undefined) {
    sets.push("website_infer_suppressed = ?");
    bindings.push(patch.website_infer_suppressed);
  }
  if (patch.website_url !== undefined) {
    sets.push("website_url = ?");
    bindings.push(patch.website_url);
  }
  sets.push("updated_at = ?");
  bindings.push(now);
  bindings.push(id);
  await db
    .prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...bindings)
    .run();
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
 *
 * Sources with fetch_interval_hours set are excluded if they were fetched
 * more recently than that interval, so large/slow sources (e.g. full VC
 * portfolio boards) don't consume a cron slot on every hourly run.
 */
export async function listEnabledSources(
  db: D1Database,
  limit = 150
): Promise<SourceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM sources
       WHERE enabled = 1
         AND (
           fetch_interval_hours IS NULL
           OR last_fetched_at IS NULL
           OR last_fetched_at <= (strftime('%s','now') - fetch_interval_hours * 3600)
         )
       ORDER BY last_fetched_at ASC NULLS FIRST
       LIMIT ?`
    )
    .bind(limit)
    .all<SourceRow>();
  return result.results ?? [];
}

export async function getSourceById(
  db: D1Database,
  id: string
): Promise<SourceRow | null> {
  const resolvedId = id === CRUNCHBASE_SOURCE_LEGACY_ID ? CRUNCHBASE_SOURCE_ID : id;
  const result = await db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(resolvedId)
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
  /** Canonical company slug — improves location normalization (ATS quirks per employer). */
  company_slug?: string | null;
  /** Geocoded coords — set at insert time when available. */
  location_lat?: number | null;
  location_lng?: number | null;
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
  const { id, company_id, source_id, external_id, source_name, dedup_key, normalized, now, location_lat, location_lng } = input;
  const {
    title,
    location: locationRaw,
    employment_type,
    workplace_type,
    seniority_level,
    apply_url,
    source_url,
    description_raw,
    salary_min,
    salary_max,
    salary_currency,
    salary_period,
    posted_at,
  } = normalized;

  const { normalizeLocationsList, detectEmploymentTypeFromText, detectSeniorityFromText } = await import("../utils/normalize.ts");
  const locs = normalizeLocationsList(locationRaw, input.company_slug);
  const locationsJson = locs && locs.length > 0 ? JSON.stringify(locs) : null;
  const locationPrimary = locs && locs.length > 0 ? locs[0]! : null;

  const detectedEt = employment_type ?? detectEmploymentTypeFromText(title, description_raw);
  const detectedSl = seniority_level ?? detectSeniorityFromText(title, description_raw);

  const existing = await db
    .prepare("SELECT id, description_raw FROM jobs WHERE source_id = ? AND external_id = ?")
    .bind(source_id, external_id)
    .first<{ id: string; description_raw: string | null }>();

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO jobs (
          id, company_id, source_id, external_id, title, locations, location_primary,
          employment_type, workplace_type, seniority_level, apply_url, source_url, source_name,
          description_raw, salary_min, salary_max, salary_currency, salary_period,
          posted_at, first_seen_at, dedup_key, location_lat, location_lng, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .bind(
        id, company_id, source_id, external_id, title, locationsJson, locationPrimary,
        detectedEt ?? null, workplace_type ?? null, detectedSl ?? null, apply_url, source_url ?? null, source_name,
        description_raw ?? null, salary_min ?? null, salary_max ?? null, salary_currency ?? null, salary_period ?? null,
        posted_at ?? null, now, dedup_key, location_lat ?? null, location_lng ?? null, now, now
      )
      .run();
    return { inserted: true, needsEmbedding: true };
  }

  const descriptionChanged =
    description_raw !== null &&
    existing.description_raw !== description_raw;

  const updatedSl = descriptionChanged ? detectSeniorityFromText(title, description_raw) : null;

  await db
    .prepare(
      `UPDATE jobs SET
        company_id             = ?,
        title                  = ?,
        -- Only fill locations when AI hasn't set it yet; once AI populates it, ingest doesn't overwrite
        locations              = CASE WHEN locations IS NULL THEN ? ELSE locations END,
        location_primary       = CASE WHEN locations IS NULL THEN ? ELSE location_primary END,
        employment_type        = COALESCE(?, employment_type),
        workplace_type         = ?,
        seniority_level        = COALESCE(seniority_level, ?),
        apply_url              = ?,
        source_url             = ?,
        salary_min             = ?,
        salary_max             = ?,
        salary_currency        = ?,
        salary_period          = ?,
        posted_at              = ?,
        dedup_key              = ?,
        location_lat           = COALESCE(?, location_lat),
        location_lng           = COALESCE(?, location_lng),
        updated_at             = ?,
        description_raw        = CASE WHEN ? = 1 THEN ? ELSE description_raw END,
        ai_generated_at        = CASE WHEN ? = 1 THEN NULL ELSE ai_generated_at END,
        embedding_generated_at = CASE WHEN ? = 1 THEN NULL ELSE embedding_generated_at END
      WHERE source_id = ? AND external_id = ?`
    )
    .bind(
      company_id,
      title,
      locationsJson,
      locationPrimary,
      detectedEt ?? null,
      workplace_type ?? null,
      updatedSl ?? null,
      apply_url,
      source_url ?? null,
      salary_min ?? null,
      salary_max ?? null,
      salary_currency ?? null,
      salary_period ?? null,
      posted_at ?? null,
      dedup_key,
      location_lat ?? null,
      location_lng ?? null,
      now,
      descriptionChanged ? 1 : 0, description_raw ?? null,
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
// Each SELECT uses 2 bound variables. D1 may enforce SQLite's 999-variable cap across a whole
// db.batch(); keep chunk small enough that (chunk × 2) ≤ 999.
// D1 may also limit batch() by statement count; 100 stmts × 2 params = 200 total — safe.
// D1 enforces a hard limit of 100 statements per db.batch() call.
// Use 50 for headroom — batchGetExistingJobs sends EXISTING_CHUNK stmts per call.
const EXISTING_CHUNK = 50;

export async function batchGetExistingJobs(
  db: D1Database,
  sourceId: string,
  externalIds: string[]
): Promise<Map<string, { id: string; description_raw: string | null }>> {
  if (externalIds.length === 0) return new Map();

  const map = new Map<string, { id: string; description_raw: string | null }>();
  for (let start = 0; start < externalIds.length; start += EXISTING_CHUNK) {
    const chunk = externalIds.slice(start, start + EXISTING_CHUNK);
    const stmts = chunk.map((eid) =>
      db
        .prepare("SELECT id, description_raw FROM jobs WHERE source_id = ? AND external_id = ?")
        .bind(sourceId, eid)
    );
    const results = await db.batch<{ id: string; description_raw: string | null }>(stmts);
    for (let i = 0; i < chunk.length; i++) {
      const row = results[i].results?.[0];
      if (row) map.set(chunk[i], row);
    }
  }
  return map;
}

/**
 * Batch cross-source dedup check.
 *
 * Returns dedup_keys that the **incoming** source should skip because another source
 * already holds the same key with **strictly higher** priority.
 * Equal priority → both rows may coexist. Lower-priority conflicts are cleared by
 * {@link batchDeleteJobsSupersededByHigherPriority} immediately before upsert.
 *
 * `incomingPriority` is the caller's already-resolved priority number.
 * `priorityOf` maps source_type strings (as stored in `jobs.source_name`) to their
 * priority numbers — both are passed in from the runner so this layer has no
 * dependency on the ingestion registry.
 */
// SQLite allows at most 999 bound parameters per statement.
// IN() queries also bind one extra `source_id != ?` → cap at 998 keys per chunk.
// IN (?) + one extra bind — D1 has been observed to fail near ~350 vars on some queries; stay small.
// D1 per-statement bound-parameter limit is empirically ≤ 90.
// Dedup query adds 1 extra param (sourceId), so cap keys at 50 for comfortable headroom.
const SQL_IN_CHUNK = 50;
/** `DELETE FROM jobs WHERE id IN (...)` — each id is one bound variable; must stay ≤ 999. */
const DELETE_ID_IN_CHUNK = 998;

export async function batchCheckCrossSourceDups(
  db: D1Database,
  sourceId: string,
  incomingPriority: number,
  priorityOf: (sourceType: string) => number,
  dedupKeys: string[]
): Promise<Set<string>> {
  if (dedupKeys.length === 0) return new Set();

  const uniqueKeys = [...new Set(dedupKeys)];
  const dupes = new Set<string>();

  for (let i = 0; i < uniqueKeys.length; i += SQL_IN_CHUNK) {
    const chunk = uniqueKeys.slice(i, i + SQL_IN_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT dedup_key, source_name FROM jobs WHERE dedup_key IN (${placeholders}) AND source_id != ?`
      )
      .bind(...chunk, sourceId)
      .all<{ dedup_key: string; source_name: string }>();

    // Track highest competing priority per key.
    const maxPByKey = new Map<string, number>();
    for (const row of res.results ?? []) {
      const p = priorityOf(row.source_name);
      const cur = maxPByKey.get(row.dedup_key) ?? -1;
      if (p > cur) maxPByKey.set(row.dedup_key, p);
    }
    for (const key of chunk) {
      const maxP = maxPByKey.get(key) ?? -1;
      if (maxP > incomingPriority) dupes.add(key);
    }
  }
  return dupes;
}

/**
 * Delete job rows from **other** sources that share a dedup_key with an incoming batch
 * but have **lower** priority. Lets a higher-priority ingest replace listings previously
 * stored from a lower-priority feed (e.g. Workday 80 supersedes Phenom 77).
 * Equal or higher priority rows on other sources are left untouched.
 *
 * `incomingPriority` and `priorityOf` mirror the parameters of {@link batchCheckCrossSourceDups}.
 * When `vectorIndex` is set, deleted job ids are removed from Vectorize so semantic search stays aligned.
 */
export async function batchDeleteJobsSupersededByHigherPriority(
  db: D1Database,
  incomingSourceId: string,
  incomingPriority: number,
  priorityOf: (sourceType: string) => number,
  dedupKeys: string[],
  vectorIndex?: VectorizeIndex
): Promise<number> {
  if (dedupKeys.length === 0) return 0;

  const uniqueKeys = [...new Set(dedupKeys)];
  let deleted = 0;

  for (let i = 0; i < uniqueKeys.length; i += SQL_IN_CHUNK) {
    const chunk = uniqueKeys.slice(i, i + SQL_IN_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT id, source_name FROM jobs WHERE dedup_key IN (${placeholders}) AND source_id != ?`
      )
      .bind(...chunk, incomingSourceId)
      .all<{ id: string; source_name: string }>();

    const idsToDelete = (res.results ?? [])
      .filter((row) => priorityOf(row.source_name) < incomingPriority)
      .map((row) => row.id);

    // Batch DELETEs — IN(?) must not exceed SQLite's 999 bound-parameter limit (was 1000 → D1 error).
    for (let j = 0; j < idsToDelete.length; j += DELETE_ID_IN_CHUNK) {
      const idChunk = idsToDelete.slice(j, j + DELETE_ID_IN_CHUNK);
      const delPh = idChunk.map(() => "?").join(",");
      await db.prepare(`DELETE FROM jobs WHERE id IN (${delPh})`).bind(...idChunk).run();
      deleted += idChunk.length;
      if (vectorIndex && idChunk.length > 0) {
        try {
          await vectorIndex.deleteByIds(idChunk);
        } catch {
          // Best-effort; D1 rows are already gone — next query may still see stale vectors briefly
        }
      }
    }
  }
  return deleted;
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

  // INSERT OR IGNORE: silently skip rows that would violate the (source_id, external_id)
  // unique constraint — e.g. duplicate external_ids from the API, or jobs already ingested
  // by a previous partially-completed Worker that was killed before last_fetched_at was set.
  // The UPDATE path (below) handles true refreshes when existingMap is correctly populated.
  const INSERT_SQL = `INSERT OR IGNORE INTO jobs (
    id, company_id, source_id, external_id, title, locations, location_primary,
    employment_type, workplace_type, seniority_level, apply_url, source_url, source_name,
    description_raw, description_language,
    salary_min, salary_max, salary_currency, salary_period,
    posted_at, first_seen_at, dedup_key, location_lat, location_lng, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const UPDATE_SQL = `UPDATE jobs SET
    company_id = ?, title = ?,
    locations = CASE WHEN locations IS NULL THEN ? ELSE locations END,
    location_primary = CASE WHEN locations IS NULL THEN ? ELSE location_primary END,
    employment_type = COALESCE(?, employment_type),
    workplace_type = ?, apply_url = ?, source_url = ?,
    salary_min      = COALESCE(?, salary_min),
    salary_max      = COALESCE(?, salary_max),
    salary_currency = COALESCE(?, salary_currency),
    salary_period   = COALESCE(?, salary_period),
    posted_at = ?, dedup_key = ?,
    location_lat           = COALESCE(?, location_lat),
    location_lng           = COALESCE(?, location_lng),
    seniority_level        = COALESCE(seniority_level, ?),
    updated_at = ?,
    description_raw        = CASE WHEN ? = 1 THEN ? ELSE description_raw END,
    description_language   = CASE WHEN ? = 1 THEN ? ELSE description_language END,
    ai_generated_at        = CASE WHEN ? = 1 THEN NULL ELSE ai_generated_at END,
    embedding_generated_at = CASE WHEN ? = 1 THEN NULL ELSE embedding_generated_at END
  WHERE source_id = ? AND external_id = ?`;

  const { normalizeLocationsList, detectEmploymentTypeFromText, detectSeniorityFromText, extractSalaryFromText } = await import("../utils/normalize.ts");
  const { detectLanguage } = await import("../enrichment/language.ts");

  for (let i = 0; i < inputs.length; i++) {
    const { id, company_id, source_id, external_id, source_name, dedup_key, normalized, now, location_lat, location_lng, company_slug } = inputs[i];
    const {
      title, location: locationRaw, employment_type, workplace_type, apply_url, source_url,
      description_raw, salary_min, salary_max, salary_currency, salary_period, posted_at,
      seniority_level,
    } = normalized;

    const locs = normalizeLocationsList(locationRaw, company_slug);
    const locationsJson = locs && locs.length > 0 ? JSON.stringify(locs) : null;
    const locationPrimary = locs && locs.length > 0 ? locs[0]! : null;
    const existing = existingMap.get(external_id);

    // D1 rejects `undefined` bindings with a cryptic type error — coerce every
    // nullable field to null so any fetcher that omits optional fields is safe.
    const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

    // Fill employment_type and seniority_level from heuristic text detection when
    // the ATS/fetcher did not provide them. Runs at ingest so every new job gets
    // at least a best-effort classification without waiting for AI lazy-load.
    const detectedEt = employment_type ?? detectEmploymentTypeFromText(title, description_raw);
    const detectedSl = seniority_level ?? detectSeniorityFromText(title, description_raw);

    // Run heuristic language detection on the raw description at ingest time.
    // AI lazy-load will override this on first GET /jobs/:id if needed.
    const detectedLang = description_raw ? detectLanguage(description_raw) : null;

    // Detect salary from description when the source doesn't provide it structured.
    // COALESCE in the UPDATE path ensures this never overwrites source-provided salary.
    const detectedSalary = (salary_min == null && description_raw)
      ? extractSalaryFromText(description_raw)
      : null;
    const effectiveSalaryMin      = salary_min      ?? detectedSalary?.min      ?? null;
    const effectiveSalaryMax      = salary_max      ?? detectedSalary?.max      ?? null;
    const effectiveSalaryCurrency = salary_currency ?? detectedSalary?.currency ?? null;
    const effectiveSalaryPeriod   = salary_period   ?? detectedSalary?.period   ?? null;

    if (!existing) {
      inserts.push(
        db.prepare(INSERT_SQL).bind(
          id, company_id, source_id, external_id, title, locationsJson, locationPrimary,
          n(detectedEt), n(workplace_type), n(detectedSl), apply_url, n(source_url), source_name,
          n(description_raw), detectedLang,
          n(effectiveSalaryMin), n(effectiveSalaryMax), n(effectiveSalaryCurrency), n(effectiveSalaryPeriod),
          n(posted_at), now, dedup_key, location_lat ?? null, location_lng ?? null, now, now
        )
      );
      insertIndices.push(i);
    } else {
      const descChanged = description_raw !== null && existing.description_raw !== description_raw;
      descChangedFlags[i] = descChanged;
      // Re-detect language when description changes; keep existing value otherwise
      const updatedLang = descChanged ? detectLanguage(description_raw) : null;
      // Re-detect seniority if description changed; bind null otherwise (COALESCE keeps existing)
      const updatedSl = descChanged ? detectSeniorityFromText(title, description_raw) : null;
      // Re-detect salary if description changed; COALESCE in SQL keeps existing when null
      const updatedSalary = descChanged ? extractSalaryFromText(description_raw) : null;
      const updatedSalaryMin      = salary_min      ?? updatedSalary?.min      ?? null;
      const updatedSalaryMax      = salary_max      ?? updatedSalary?.max      ?? null;
      const updatedSalaryCurrency = salary_currency ?? updatedSalary?.currency ?? null;
      const updatedSalaryPeriod   = salary_period   ?? updatedSalary?.period   ?? null;
      updates.push(
        db.prepare(UPDATE_SQL).bind(
          company_id, title,
          locationsJson,
          locationPrimary,
          n(detectedEt),
          n(workplace_type), apply_url, n(source_url),
          n(updatedSalaryMin), n(updatedSalaryMax), n(updatedSalaryCurrency), n(updatedSalaryPeriod),
          n(posted_at), dedup_key, location_lat ?? null, location_lng ?? null,
          n(updatedSl),
          now,
          descChanged ? 1 : 0, n(description_raw),
          descChanged ? 1 : 0, updatedLang,
          descChanged ? 1 : 0,
          descChanged ? 1 : 0,
          source_id, external_id
        )
      );
      updateIndices.push(i);
    }
  }

  // Each INSERT/UPDATE binds ~25 parameters. D1 applies SQLite's bound-parameter limit across
  // the entire db.batch() — keep chunks small (IBM-scale boards hit errors at ~35×25 when combined
  // with other statements in the same Worker invocation).
  const UPSERT_CHUNK = 35;
  for (let i = 0; i < inserts.length; i += UPSERT_CHUNK) {
    await db.batch(inserts.slice(i, i + UPSERT_CHUNK));
  }
  for (let i = 0; i < updates.length; i += UPSERT_CHUNK) {
    await db.batch(updates.slice(i, i + UPSERT_CHUNK));
  }

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
 * Results are ordered: YC first, then Alo/Primark, then others, USAJOBS last.
 * USAJOBS has ~10K jobs; deprioritizing avoids blocking YC/Alo/Primark for days.
 */
export async function getJobsNeedingEmbedding(
  db: D1Database,
  limit: number
): Promise<Array<{
  id: string;
  title: string;
  company_name: string;
  /** Full locations JSON array — preferred for embedding text (all cities). */
  locations: string | null;
  /** Primary location fallback when `locations` is null. */
  location_primary: string | null;
  description_raw: string | null;
}>> {
  const { results } = await db
    .prepare(`
      SELECT j.id, j.title, c.name AS company_name,
             j.locations,
             COALESCE(j.location_primary, json_extract(j.locations, '$[0]')) AS location_primary,
             j.description_raw
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      WHERE j.embedding_generated_at IS NULL
      ORDER BY
        -- USAJOBS last — 10K govt jobs should never block recent tech/retail jobs
        CASE WHEN j.source_id = 'usajobs' THEN 1 ELSE 0 END,
        -- Within each tier: newest first so jobs posted today beat old backlog
        j.first_seen_at DESC
      LIMIT ?
    `)
    .bind(limit)
    .all<{
      id: string;
      title: string;
      company_name: string;
      locations: string | null;
      location_primary: string | null;
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
  // Two binds per statement — keep each db.batch() under SQLite's cumulative cap for large flushes.
  const CHUNK = 400;
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    await db.batch(jobIds.slice(i, i + CHUNK).map((id) => stmt.bind(now, id)));
  }
}

/**
 * Maximum IDs per D1 IN() clause.
 *
 * D1 limits bound parameters per statement to roughly 100. The IN() clause
 * consumes one slot per ID, and the filter conditions consume a few more.
 * Keeping ID chunks at 90 leaves headroom for up to 10 additional filter bindings.
 */
const D1_IN_CHUNK = 90;

/** Comma-separated employment types (e.g. contract,temporary) → SQL fragment + bindings. */
function employmentTypeCondition(employment_type: string | undefined): {
  sql: string;
  bindings: unknown[];
} | null {
  if (!employment_type) return null;
  const types = employment_type
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (types.length === 0) return null;
  if (types.length === 1) {
    return { sql: "j.employment_type = ?", bindings: [types[0]!] };
  }
  return {
    sql: `j.employment_type IN (${types.map(() => "?").join(", ")})`,
    bindings: types,
  };
}

/**
 * Shared SELECT columns for ListJobsRow — listJobs, listJobsNear, listJobsByIdsChunk.
 * Omits description_raw and job_description.
 */
const LIST_JOBS_ROW_SELECT = `      j.id, j.company_id, j.source_id, j.external_id,
      j.title, j.locations, j.location_primary, j.employment_type, j.workplace_type, j.seniority_level,
      j.description_language,
      j.apply_url, j.source_url, j.source_name,
      j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
      j.experience_years_min, j.job_address, j.job_city, j.job_state, j.job_country,
      j.location_lat, j.location_lng,
      j.visa_sponsorship,
      j.job_summary, j.ai_generated_at, j.embedding_generated_at,
      j.posted_at, j.first_seen_at, j.dedup_key, j.created_at, j.updated_at,
      c.name                 AS company_name,
      c.logo_url             AS company_logo_url,
      c.description          AS company_description,
      c.website_url          AS company_website_url,
      c.linkedin_url         AS company_linkedin_url,
      c.glassdoor_url        AS company_glassdoor_url,
      c.x_url                AS company_x_url,
      c.instagram_url        AS company_instagram_url,
      c.youtube_url          AS company_youtube_url,
      c.github_url           AS company_github_url,
      c.huggingface_url      AS company_huggingface_url,
      c.tiktok_url           AS company_tiktok_url,
      c.crunchbase_url       AS company_crunchbase_url,
      c.facebook_url         AS company_facebook_url,
      c.employee_count_range AS company_employee_count_range,
      c.employee_count       AS company_employee_count,
      c.founded_year         AS company_founded_year,
      c.hq_address           AS company_hq_address,
      c.hq_city              AS company_hq_city,
      c.hq_country           AS company_hq_country,
      c.hq_lat               AS company_hq_lat,
      c.hq_lng               AS company_hq_lng,
      c.industry             AS company_industry,
      c.company_type         AS company_type,
      c.total_funding_usd    AS company_total_funding_usd,
      c.locations            AS company_locations`;

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
  filter: Pick<ListJobsFilter, "location" | "location_region" | "location_or" | "exclude_ids" | "employment_type" | "workplace_type" | "seniority_level" | "description_language" | "company" | "posted_since" | "salary_min" | "country" | "visa_sponsorship">
): Promise<ListJobsRow[]> {
  if (ids.length === 0) return [];

  // Split into chunks that fit within D1's parameter limit
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
    chunks.push(ids.slice(i, i + D1_IN_CHUNK));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk) => listJobsByIdsChunk(db, chunk, filter))
  );
  const allRows = chunkResults.flat();

  // Re-sort by the original Vectorize similarity order across all chunks
  const idOrder = new Map(ids.map((id, i) => [id, i]));
  return allRows.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
}

async function listJobsByIdsChunk(
  db: D1Database,
  ids: string[],
  filter: Pick<ListJobsFilter, "location" | "location_region" | "location_or" | "exclude_ids" | "employment_type" | "workplace_type" | "seniority_level" | "description_language" | "company" | "posted_since" | "salary_min" | "country" | "visa_sponsorship">
): Promise<ListJobsRow[]> {
  const placeholders = ids.map(() => "?").join(", ");
  const conditions: string[] = [`j.id IN (${placeholders})`];
  const bindings: unknown[] = [...ids];

  if (filter.location) {
    const locPatterns = expandLocationLikePatterns(filter.location);
    const orParts = locPatterns.map(() => "j.locations LIKE ?");
    conditions.push(`(${orParts.join(" OR ")})`);
    locPatterns.forEach((p) => bindings.push(p));
  }
  if (filter.location_region) {
    conditions.push("j.locations LIKE ?");
    bindings.push(`%${filter.location_region}%`);
  }
  if (filter.location_or && filter.location_or.length > 0) {
    const terms = filter.location_or.slice(0, 12);
    const orParts = terms.map(() => "j.locations LIKE ?");
    conditions.push(`(${orParts.join(" OR ")})`);
    terms.forEach((t) => bindings.push(`%${t}%`));
  }
  if (filter.exclude_ids && filter.exclude_ids.length > 0) {
    const valid = filter.exclude_ids.filter(
      (id) => typeof id === "string" && id.length >= 4 && id.length <= 64
    );
    if (valid.length > 0) {
      conditions.push(`j.id NOT IN (${valid.map(() => "?").join(", ")})`);
      bindings.push(...valid);
    }
  }
  const etChunk = employmentTypeCondition(filter.employment_type);
  if (etChunk) {
    conditions.push(etChunk.sql);
    bindings.push(...etChunk.bindings);
  }
  if (filter.workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(filter.workplace_type);
  }
  if (filter.seniority_level) {
    const levels = filter.seniority_level.split(",").map((s) => s.trim()).filter(Boolean);
    if (levels.length === 1) {
      conditions.push("j.seniority_level = ?");
      bindings.push(levels[0]);
    } else if (levels.length > 1) {
      conditions.push(`j.seniority_level IN (${levels.map(() => "?").join(", ")})`);
      bindings.push(...levels);
    }
  }
  if (filter.description_language) {
    conditions.push("j.description_language = ?");
    bindings.push(filter.description_language);
  }
  appendCompanySlugConditions(conditions, bindings, filter.company);
  if (filter.posted_since) {
    conditions.push("COALESCE(j.posted_at, j.first_seen_at) >= ?");
    bindings.push(filter.posted_since);
  }
  if (filter.salary_min !== undefined) {
    conditions.push("j.salary_min IS NOT NULL AND j.salary_min >= ?");
    bindings.push(filter.salary_min);
  }
  if (filter.country) {
    conditions.push("(j.workplace_type = 'remote' OR j.job_country = ?)");
    bindings.push(filter.country);
  }
  if (filter.visa_sponsorship === "yes" || filter.visa_sponsorship === "no") {
    conditions.push("j.visa_sponsorship = ?");
    bindings.push(filter.visa_sponsorship);
  }

  const where = conditions.join(" AND ");
  const sql = `
    SELECT
${LIST_JOBS_ROW_SELECT}
    FROM jobs j
    JOIN companies c ON j.company_id = c.id
    WHERE ${where}
  `;

  const { results } = await db.prepare(sql).bind(...bindings).all<ListJobsRow>();
  return results ?? [];
}

export interface ListJobsFilter {
  /** Substring match on job title only — use for role searches; avoids company slug / vector noise from `q`. */
  title?: string;
  q?: string;
  location?: string;
  location_region?: string; // e.g. "CA" — requires location to contain this; disambiguates "San Francisco, CA" from "San Francisco, Philippines"
  location_or?: string[]; // OR of location terms — e.g. ["San Francisco", "Oakland", "San Jose"] for Bay Area
  exclude_ids?: string[]; // job IDs to exclude (e.g. already shown on homepage)
  employment_type?: string;
  workplace_type?: string;
  seniority_level?: string;
  description_language?: string;
  /** Exact company slug(s). Comma-separated = OR (e.g. meta,google,apple). */
  company?: string;
  posted_since?: number; // unix timestamp — only return jobs posted/seen at or after this time
  salary_min?: number;   // only return jobs where salary_min >= this value (annual, in salary_currency)
  country?: string;      // ISO 3166-1 alpha-2 — filter to jobs in this country (or remote)
  /** When set, only jobs with this explicit AI-extracted visa_sponsorship value. */
  visa_sponsorship?: import("../types.ts").VisaSponsorship;
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
  locations: string | null;  // serialized JSON array; locations[0] is primary display value
  location_primary: string | null;
  employment_type: import("../types.ts").EmploymentType | null;
  workplace_type: import("../types.ts").WorkplaceType | null;
  seniority_level: import("../types.ts").SeniorityLevel | null;
  description_language: import("../types.ts").DescriptionLanguage | null;
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
  experience_years_min: number | null;
  job_address: string | null;
  job_city: string | null;
  job_state: string | null;
  job_country: string | null;
  location_lat: number | null;
  location_lng: number | null;
  visa_sponsorship: import("../types.ts").VisaSponsorship | null;
  // joined company fields
  company_name: string;
  company_logo_url: string | null;
  company_description: string | null;
  company_website_url: string | null;
  company_linkedin_url: string | null;
  company_glassdoor_url: string | null;
  company_x_url: string | null;
  company_instagram_url: string | null;
  company_youtube_url: string | null;
  company_github_url: string | null;
  company_huggingface_url: string | null;
  company_tiktok_url: string | null;
  company_crunchbase_url: string | null;
  company_facebook_url: string | null;
  company_employee_count_range: string | null;
  company_employee_count: number | null;
  company_founded_year: number | null;
  company_hq_address: string | null;
  company_hq_city: string | null;
  company_hq_country: string | null;
  company_hq_lat: number | null;
  company_hq_lng: number | null;
  company_industry: string | null;
  company_type: string | null;
  company_total_funding_usd: number | null;
  company_locations: string | null;
}

/**
 * Builds several LIKE patterns so a model-supplied "City, California" still matches
 * listings stored as "City, CA", and so the primary city name matches JSON text.
 */
function expandLocationLikePatterns(location: string): string[] {
  const t = location.trim();
  if (!t) return [];
  const patterns = new Set<string>();
  patterns.add(`%${t}%`);

  const stateFullToAbbr: Array<[RegExp, string]> = [
    [/, Alabama\s*$/i, ", AL"],
    [/, Alaska\s*$/i, ", AK"],
    [/, Arizona\s*$/i, ", AZ"],
    [/, Arkansas\s*$/i, ", AR"],
    [/, California\s*$/i, ", CA"],
    [/, Colorado\s*$/i, ", CO"],
    [/, Connecticut\s*$/i, ", CT"],
    [/, Delaware\s*$/i, ", DE"],
    [/, Florida\s*$/i, ", FL"],
    [/, Georgia\s*$/i, ", GA"],
    [/, Hawaii\s*$/i, ", HI"],
    [/, Idaho\s*$/i, ", ID"],
    [/, Illinois\s*$/i, ", IL"],
    [/, Indiana\s*$/i, ", IN"],
    [/, Iowa\s*$/i, ", IA"],
    [/, Kansas\s*$/i, ", KS"],
    [/, Kentucky\s*$/i, ", KY"],
    [/, Louisiana\s*$/i, ", LA"],
    [/, Maine\s*$/i, ", ME"],
    [/, Maryland\s*$/i, ", MD"],
    [/, Massachusetts\s*$/i, ", MA"],
    [/, Michigan\s*$/i, ", MI"],
    [/, Minnesota\s*$/i, ", MN"],
    [/, Mississippi\s*$/i, ", MS"],
    [/, Missouri\s*$/i, ", MO"],
    [/, Montana\s*$/i, ", MT"],
    [/, Nebraska\s*$/i, ", NE"],
    [/, Nevada\s*$/i, ", NV"],
    [/, New Hampshire\s*$/i, ", NH"],
    [/, New Jersey\s*$/i, ", NJ"],
    [/, New Mexico\s*$/i, ", NM"],
    [/, New York\s*$/i, ", NY"],
    [/, North Carolina\s*$/i, ", NC"],
    [/, North Dakota\s*$/i, ", ND"],
    [/, Ohio\s*$/i, ", OH"],
    [/, Oklahoma\s*$/i, ", OK"],
    [/, Oregon\s*$/i, ", OR"],
    [/, Pennsylvania\s*$/i, ", PA"],
    [/, Rhode Island\s*$/i, ", RI"],
    [/, South Carolina\s*$/i, ", SC"],
    [/, South Dakota\s*$/i, ", SD"],
    [/, Tennessee\s*$/i, ", TN"],
    [/, Texas\s*$/i, ", TX"],
    [/, Utah\s*$/i, ", UT"],
    [/, Vermont\s*$/i, ", VT"],
    [/, Virginia\s*$/i, ", VA"],
    [/, Washington\s*$/i, ", WA"],
    [/, West Virginia\s*$/i, ", WV"],
    [/, Wisconsin\s*$/i, ", WI"],
    [/, Wyoming\s*$/i, ", WY"],
    [/, District of Columbia\s*$/i, ", DC"],
  ];
  for (const [re, abbr] of stateFullToAbbr) {
    const alt = t.replace(re, abbr);
    if (alt !== t) patterns.add(`%${alt}%`);
  }

  const comma = t.indexOf(",");
  if (comma > 0) {
    const cityOnly = t.slice(0, comma).trim();
    if (cityOnly.length >= 4) {
      patterns.add(`%${cityOnly}%`);
    }
  }

  return [...patterns];
}

function appendCompanySlugConditions(
  conditions: string[],
  bindings: unknown[],
  company: string | undefined
): void {
  const slugs = companySlugsFromFilterParam(company);
  if (slugs.length === 0) return;
  if (slugs.length === 1) {
    conditions.push("c.slug = ?");
    bindings.push(slugs[0]);
  } else {
    conditions.push(`c.slug IN (${slugs.map(() => "?").join(", ")})`);
    bindings.push(...slugs);
  }
}

export async function listJobs(
  db: D1Database,
  filter: ListJobsFilter
): Promise<{ rows: ListJobsRow[]; total: number | null }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filter.title) {
    const raw = filter.title.trim();
    if (raw) {
      for (const t of titleSearchTokensForSql(raw)) {
        conditions.push("j.title LIKE ?");
        bindings.push(`%${t}%`);
      }
    }
  } else if (filter.q) {
    const raw = filter.q.trim();
    const pattern = `%${raw}%`;
    const slug = companySlugFromSearchQuery(raw);
    // Title + exact company slug only — never c.name LIKE (substring matches
    // "Product" in "Consumer Product Safety Commission" for role queries).
    if (slug.length >= 2) {
      conditions.push("(j.title LIKE ? OR c.slug = ?)");
      bindings.push(pattern, slug);
    } else {
      conditions.push("j.title LIKE ?");
      bindings.push(pattern);
    }
  }
  if (filter.location) {
    const locPatterns = expandLocationLikePatterns(filter.location);
    const orParts = locPatterns.map(() => "j.locations LIKE ?");
    conditions.push(`(${orParts.join(" OR ")})`);
    locPatterns.forEach((p) => bindings.push(p));
  }
  if (filter.location_region) {
    conditions.push("j.locations LIKE ?");
    bindings.push(`%${filter.location_region}%`);
  }
  if (filter.location_or && filter.location_or.length > 0) {
    const terms = filter.location_or.slice(0, 12);
    const orParts = terms.map(() => "j.locations LIKE ?");
    conditions.push(`(${orParts.join(" OR ")})`);
    terms.forEach((t) => bindings.push(`%${t}%`));
  }
  if (filter.exclude_ids && filter.exclude_ids.length > 0) {
    const valid = filter.exclude_ids.filter(
      (id) => typeof id === "string" && id.length >= 4 && id.length <= 64
    );
    if (valid.length > 0) {
      conditions.push(`j.id NOT IN (${valid.map(() => "?").join(", ")})`);
      bindings.push(...valid);
    }
  }
  const etList = employmentTypeCondition(filter.employment_type);
  if (etList) {
    conditions.push(etList.sql);
    bindings.push(...etList.bindings);
  }
  if (filter.workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(filter.workplace_type);
  }
  if (filter.seniority_level) {
    const levels = filter.seniority_level.split(",").map((s) => s.trim()).filter(Boolean);
    if (levels.length === 1) {
      conditions.push("j.seniority_level = ?");
      bindings.push(levels[0]);
    } else if (levels.length > 1) {
      conditions.push(`j.seniority_level IN (${levels.map(() => "?").join(", ")})`);
      bindings.push(...levels);
    }
  }
  if (filter.description_language) {
    conditions.push("j.description_language = ?");
    bindings.push(filter.description_language);
  }
  appendCompanySlugConditions(conditions, bindings, filter.company);
  if (filter.country) {
    // Require an explicit per-job country match or remote — never fall back to company
    // HQ country, because a US-HQ'd company (Dell, Coca-Cola) can post jobs in India.
    // Jobs with NULL job_country are excluded when a country filter is active; the
    // frontend falls back to unfiltered results if the country-specific pool is too sparse.
    conditions.push("(j.workplace_type = 'remote' OR j.job_country = ?)");
    bindings.push(filter.country);
  }
  if (filter.posted_since) {
    conditions.push("COALESCE(j.posted_at, j.first_seen_at) >= ?");
    bindings.push(filter.posted_since);
  }
  if (filter.salary_min !== undefined) {
    // Require salary_min to be populated AND meet the threshold.
    // salary_min is always stored as an annual figure (normalised at ingest).
    conditions.push("j.salary_min IS NOT NULL AND j.salary_min >= ?");
    bindings.push(filter.salary_min);
  }
  if (filter.visa_sponsorship === "yes" || filter.visa_sponsorship === "no") {
    conditions.push("j.visa_sponsorship = ?");
    bindings.push(filter.visa_sponsorship);
  }

  // Cursor decoding: cursor encodes the last row's sort key so we can do
  // keyset pagination without page offsets (stable even as new rows arrive).
  if (filter.cursor) {
    try {
      const decoded = atob(filter.cursor);
      const [ts, id] = decoded.split(":");
      // Must match ORDER BY and buildRegularCursor (posted_at ?? first_seen_at).
      conditions.push(
        "(COALESCE(j.posted_at, j.first_seen_at) < ? OR (COALESCE(j.posted_at, j.first_seen_at) = ? AND j.id < ?))"
      );
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
${LIST_JOBS_ROW_SELECT}
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    ${where}
  `;

  // Skip COUNT on cursor pages — the client already has the total from page 1,
  // and re-counting the full table on every paginated request is wasteful.
  if (filter.cursor) {
    const dataResult = await db
      .prepare(`${selectJoined} ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC, j.id DESC LIMIT ?`)
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
      .prepare(`${selectJoined} ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC, j.id DESC LIMIT ?`)
      .bind(...bindings, filter.limit)
      .all<ListJobsRow>(),
  ]);

  return {
    rows: dataResult.results ?? [],
    total: countResult?.n ?? 0,
  };
}

/**
 * One row per (company × ~10km geographic bucket).
 * Uses per-job coordinates when geocoded (retail/franchise stores), falls back to
 * company HQ otherwise.  Grouping by ROUND(lat,1) / ROUND(lng,1) produces ~10km
 * buckets — enough to split e.g. "Dominos NYC" from "Dominos LA" while merging
 * stores on the same block into one chip.
 *
 * chip_lat / chip_lng are the AVG of actual coords in the bucket so the chip sits
 * at the geographic centroid of those jobs, not the rounded grid point.
 */
export interface MapCompanyRow {
  company_id: string;
  company_name: string;
  company_logo_url: string | null;
  company_slug: string;
  chip_lat: number;
  chip_lng: number;
  company_hq_lat: number;
  company_hq_lng: number;
  company_hq_city: string | null;
  company_hq_country: string | null;
  company_hq_address: string | null;
  job_count: number;
}

export interface MapBbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface MapCenter {
  lat: number;
  lng: number;
}

export async function listJobsForMap(
  db: D1Database,
  since: number,
  bbox?: MapBbox,
  center?: MapCenter,
  limit = 100,
  q?: string,
  employment_type?: string,
  seniority_level?: string
): Promise<MapCompanyRow[]> {
  // Filter on the job's effective location (per-job coords when geocoded, HQ otherwise)
  // so chips that are visually outside the viewport are excluded — not just those
  // whose company HQ happens to fall inside it.
  const bboxClause = bbox
    ? `AND j.location_lat BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
         AND j.location_lng BETWEEN ${bbox.minLng} AND ${bbox.maxLng}`
    : "";

  const bindings: unknown[] = [since];
  let qClause = "";
  if (q && q.trim()) {
    // Title-only match for map chips — company-name matching causes false-positive chips
    // (e.g. "Descript" appearing for the query "design" with zero matching job titles).
    qClause = `AND j.title LIKE ?`;
    bindings.push(`%${q.trim()}%`);
  }
  let typeClause = "";
  const etMap = employmentTypeCondition(employment_type);
  if (etMap) {
    typeClause = `AND ${etMap.sql}`;
    bindings.push(...etMap.bindings);
  }
  let seniorityClause = "";
  if (seniority_level) {
    const levels = seniority_level.split(",").map((s) => s.trim()).filter(Boolean);
    if (levels.length === 1) {
      seniorityClause = `AND j.seniority_level = ?`;
      bindings.push(levels[0]);
    } else if (levels.length > 1) {
      seniorityClause = `AND j.seniority_level IN (${levels.map(() => "?").join(", ")})`;
      bindings.push(...levels);
    }
  }

  // Order by squared distance from map center using the chip centroid (AVG expression).
  // No sqrt needed since we only care about relative order.
  const orderClause = center
    ? `ORDER BY (AVG(j.location_lat) - ${center.lat}) * (AVG(j.location_lat) - ${center.lat}) +
                (AVG(j.location_lng) - ${center.lng}) * (AVG(j.location_lng) - ${center.lng}) ASC`
    : `ORDER BY job_count DESC`;

  const { results } = await db
    .prepare(
      `SELECT
         c.id          AS company_id,
         c.name        AS company_name,
         c.logo_url    AS company_logo_url,
         c.slug        AS company_slug,
         AVG(j.location_lat) AS chip_lat,
         AVG(j.location_lng) AS chip_lng,
         c.hq_lat      AS company_hq_lat,
         c.hq_lng      AS company_hq_lng,
         c.hq_city     AS company_hq_city,
         c.hq_country  AS company_hq_country,
         c.hq_address  AS company_hq_address,
         COUNT(j.id)   AS job_count
       FROM companies c
       JOIN jobs j ON j.company_id = c.id
       WHERE COALESCE(j.posted_at, j.first_seen_at) >= ?
         AND (j.workplace_type IS NULL OR j.workplace_type != 'remote')
         AND c.hq_lat IS NOT NULL
         AND j.location_lat IS NOT NULL
         AND j.location_lng IS NOT NULL
         ${bboxClause}
         ${qClause}
         ${typeClause}
         ${seniorityClause}
       GROUP BY c.id,
                ROUND(j.location_lat, 1),
                ROUND(j.location_lng, 1)
       ${orderClause}
       LIMIT ${Math.min(limit * 3, 500)}`
    )
    .bind(...bindings)
    .all<MapCompanyRow>();
  let rows = results ?? [];
  rows = await expandMapRowsWithSecondaryLocations(
    db,
    since,
    bbox,
    rows,
    q,
    employment_type,
    seniority_level
  );
  if (center) {
    const cLat = center.lat;
    const cLng = center.lng;
    rows.sort((a, b) => {
      const distA =
        (a.chip_lat - cLat) * (a.chip_lat - cLat) +
        (a.chip_lng - cLng) * (a.chip_lng - cLng);
      const distB =
        (b.chip_lat - cLat) * (b.chip_lat - cLat) +
        (b.chip_lng - cLng) * (b.chip_lng - cLng);
      return distA - distB;
    });
  } else {
    rows.sort((a, b) => b.job_count - a.job_count);
  }
  return rows.slice(0, limit);
}

/**
 * Primary coords plus any (company, location) pairs found in company_location_geocodes
 * for strings in `locations` JSON — used by GET /jobs/:id and map expansion.
 */
export async function resolveJobLocationPoints(
  db: D1Database,
  companyId: string,
  locationsJson: string | null,
  primaryLat: number | null,
  primaryLng: number | null
): Promise<Array<{ lat: number; lng: number }>> {
  const out: Array<{ lat: number; lng: number }> = [];
  const seen = new Set<string>();
  const add = (lat: number, lng: number) => {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ lat, lng });
  };

  if (primaryLat != null && primaryLng != null) {
    add(primaryLat, primaryLng);
  }

  let locs: string[] = [];
  if (locationsJson) {
    try {
      locs = JSON.parse(locationsJson) as string[];
    } catch {
      /* ignore */
    }
  }
  if (locs.length <= 1) return out;

  const pairs = locs
    .map((loc) => ({
      company_id: companyId,
      location_key: normalizeLocationForGeocode(loc),
    }))
    .filter((p) => p.location_key.trim().length > 0);

  const coords = await batchGetCompanyLocationCoords(db, pairs);
  for (const p of pairs) {
    const hit = coords.get(`${p.company_id}|${p.location_key}`);
    if (hit) add(hit.lat, hit.lng);
  }

  return out;
}

/** Extra map chips for multi-location jobs whose secondary cities are in the geocode cache. */
async function expandMapRowsWithSecondaryLocations(
  db: D1Database,
  since: number,
  bbox: MapBbox | undefined,
  rows: MapCompanyRow[],
  q?: string,
  employment_type?: string,
  seniority_level?: string
): Promise<MapCompanyRow[]> {
  if (!bbox) return rows;

  const bindings: unknown[] = [since];
  let qClause = "";
  if (q && q.trim()) {
    qClause = `AND j.title LIKE ?`;
    bindings.push(`%${q.trim()}%`);
  }
  let typeClause = "";
  const etMap = employmentTypeCondition(employment_type);
  if (etMap) {
    typeClause = `AND ${etMap.sql}`;
    bindings.push(...etMap.bindings);
  }
  let seniorityClause = "";
  if (seniority_level) {
    const levels = seniority_level.split(",").map((s) => s.trim()).filter(Boolean);
    if (levels.length === 1) {
      seniorityClause = `AND j.seniority_level = ?`;
      bindings.push(levels[0]);
    } else if (levels.length > 1) {
      seniorityClause = `AND j.seniority_level IN (${levels.map(() => "?").join(", ")})`;
      bindings.push(...levels);
    }
  }

  const bboxClause = `AND j.location_lat BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
         AND j.location_lng BETWEEN ${bbox.minLng} AND ${bbox.maxLng}`;

  const { results: multiJobs } = await db
    .prepare(
      `SELECT j.company_id,
              j.locations,
              j.location_lat,
              j.location_lng,
              c.name        AS company_name,
              c.logo_url    AS company_logo_url,
              c.slug        AS company_slug,
              c.hq_lat      AS company_hq_lat,
              c.hq_lng      AS company_hq_lng,
              c.hq_city     AS company_hq_city,
              c.hq_country  AS company_hq_country,
              c.hq_address  AS company_hq_address
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       WHERE COALESCE(j.posted_at, j.first_seen_at) >= ?
         AND (j.workplace_type IS NULL OR j.workplace_type != 'remote')
         AND c.hq_lat IS NOT NULL
         AND j.location_lat IS NOT NULL
         AND j.location_lng IS NOT NULL
         AND json_array_length(COALESCE(j.locations, '[]')) > 1
         ${bboxClause}
         ${qClause}
         ${typeClause}
         ${seniorityClause}`
    )
    .bind(...bindings)
    .all<{
      company_id: string;
      locations: string | null;
      location_lat: number | null;
      location_lng: number | null;
      company_name: string;
      company_logo_url: string | null;
      company_slug: string;
      company_hq_lat: number;
      company_hq_lng: number;
      company_hq_city: string | null;
      company_hq_country: string | null;
      company_hq_address: string | null;
    }>();

  if (!multiJobs?.length) return rows;

  const existingKeys = new Set(
    rows.map(
      (r) =>
        `${r.company_id}|${r.chip_lat.toFixed(3)}|${r.chip_lng.toFixed(3)}`
    )
  );

  const extra: MapCompanyRow[] = [];

  for (const job of multiJobs) {
    const points = await resolveJobLocationPoints(
      db,
      job.company_id,
      job.locations,
      job.location_lat,
      job.location_lng
    );
    for (const pt of points) {
      const key = `${job.company_id}|${pt.lat.toFixed(3)}|${pt.lng.toFixed(3)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      extra.push({
        company_id: job.company_id,
        company_name: job.company_name,
        company_logo_url: job.company_logo_url,
        company_slug: job.company_slug,
        chip_lat: pt.lat,
        chip_lng: pt.lng,
        company_hq_lat: job.company_hq_lat,
        company_hq_lng: job.company_hq_lng,
        company_hq_city: job.company_hq_city,
        company_hq_country: job.company_hq_country,
        company_hq_address: job.company_hq_address,
        job_count: 1,
      });
    }
  }

  return extra.length ? [...rows, ...extra] : rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// company_location_geocodes — persistent per-job geocode cache
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyLocationRow {
  company_id: string;
  location_key: string;
  lat: number;
  lng: number;
  address: string | null;
}

/**
 * Batch-fetch cached (company, location) coords from the D1 table.
 * Returns a Map keyed by "companyId|locationKey" for O(1) lookups.
 */
export async function batchGetCompanyLocationCoords(
  db: D1Database,
  pairs: Array<{ company_id: string; location_key: string }>
): Promise<Map<string, { lat: number; lng: number; address: string | null }>> {
  const out = new Map<string, { lat: number; lng: number; address: string | null }>();
  if (pairs.length === 0) return out;

  // D1 per-statement limit ≤ 90 — use 50 for headroom (no extra param beyond the IN list).
  const GEOCODE_IN_CHUNK = 50;
  const keys = pairs.map((p) => `${p.company_id}|${p.location_key}`);

  for (let i = 0; i < keys.length; i += GEOCODE_IN_CHUNK) {
    const chunk = keys.slice(i, i + GEOCODE_IN_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT company_id, location_key, lat, lng, address
         FROM company_location_geocodes
         WHERE company_id || '|' || location_key IN (${placeholders})`
      )
      .bind(...chunk)
      .all<CompanyLocationRow>();

    for (const row of results ?? []) {
      out.set(`${row.company_id}|${row.location_key}`, {
        lat: row.lat,
        lng: row.lng,
        address: row.address,
      });
    }
  }
  return out;
}

/**
 * Upsert geocoded coords for a (company, location) pair.
 * ON CONFLICT DO NOTHING — first geocode wins; stale updates ignored to avoid
 * unnecessary D1 writes if the cache is already warm.
 */
export async function upsertCompanyLocationGeocode(
  db: D1Database,
  row: CompanyLocationRow
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO company_location_geocodes
         (company_id, location_key, lat, lng, address, geocoded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, location_key) DO NOTHING`
    )
    .bind(row.company_id, row.location_key, row.lat, row.lng, row.address ?? null, now)
    .run();
}

/**
 * Fetch distinct primary locations (locations[0]) that need geocoding.
 * Keys off the first entry of the JSON array since that is the canonical display value.
 */
export async function getLocationsNeedingGeocode(
  db: D1Database,
  limit: number
): Promise<Array<{ location: string }>> {
  const { results } = await db
    .prepare(
      `SELECT COALESCE(location_primary, json_extract(locations, '$[0]')) AS location,
              MAX(COALESCE(posted_at, first_seen_at)) AS newest
       FROM jobs
       WHERE locations IS NOT NULL
         AND COALESCE(location_primary, json_extract(locations, '$[0]')) IS NOT NULL
         AND COALESCE(location_primary, json_extract(locations, '$[0]')) != ''
         AND location_lat IS NULL AND location_lng IS NULL
       GROUP BY COALESCE(location_primary, json_extract(locations, '$[0]'))
       ORDER BY newest DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ location: string }>();
  return results ?? [];
}

/**
 * Update location_lat, location_lng for all jobs whose primary location (locations[0])
 * matches the given string.
 */
export async function updateJobsWithCoords(
  db: D1Database,
  location: string,
  lat: number,
  lng: number
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE jobs SET location_lat = ?, location_lng = ?
       WHERE COALESCE(location_primary, json_extract(locations, '$[0]')) = ?`
    )
    .bind(lat, lng, location)
    .run();
  return result.meta.changes ?? 0;
}

/** Earth radius in km for Haversine. */
const EARTH_RADIUS_KM = 6371;

/**
 * Jobs near a point, ordered by distance (km). Excludes remote-only jobs.
 * Requires location_lat, location_lng to be populated (geocoding backfill).
 * Returns empty when no jobs have coordinates.
 */
export async function listJobsNear(
  db: D1Database,
  filter: {
    lat: number;
    lng: number;
    radius_km: number;
    exclude_remote: boolean;
    limit: number;
    exclude_ids?: string[];
    /** Title substring only — preferred over `q` for role + geo. */
    title?: string;
    q?: string;
    posted_since?: number;
    employment_type?: string;
    workplace_type?: string;
    seniority_level?: string;
    description_language?: string;
    salary_min?: number;
    country?: string;
    company?: string;
    visa_sponsorship?: import("../types.ts").VisaSponsorship;
  }
): Promise<{ rows: ListJobsRow[] }> {
  const {
    lat,
    lng,
    radius_km,
    exclude_remote,
    limit,
    exclude_ids,
    title: titleNear,
    q,
    posted_since,
    employment_type,
    workplace_type,
    seniority_level,
    description_language,
    salary_min,
    country,
    company,
    visa_sponsorship,
  } = filter;
  const conditions: string[] = [
    "j.location_lat IS NOT NULL",
    "j.location_lng IS NOT NULL",
    "j.locations IS NOT NULL",  // exclude jobs with stale coords but no locations array
  ];
  const bindings: unknown[] = [];

  if (posted_since) {
    conditions.push("COALESCE(j.posted_at, j.first_seen_at) >= ?");
    bindings.push(posted_since);
  }
  if (exclude_remote) {
    conditions.push("(j.workplace_type IS NULL OR j.workplace_type != 'remote')");
  }
  if (titleNear && titleNear.trim()) {
    for (const t of titleSearchTokensForSql(titleNear.trim())) {
      conditions.push("j.title LIKE ?");
      bindings.push(`%${t}%`);
    }
  } else if (q && q.trim()) {
    const raw = q.trim();
    const pattern = `%${raw}%`;
    const slug = companySlugFromSearchQuery(raw);
    if (slug.length >= 2) {
      conditions.push("(j.title LIKE ? OR c.slug = ?)");
      bindings.push(pattern, slug);
    } else {
      conditions.push("j.title LIKE ?");
      bindings.push(pattern);
    }
  }
  if (exclude_ids && exclude_ids.length > 0) {
    const valid = exclude_ids.filter(
      (id) => typeof id === "string" && id.length >= 4 && id.length <= 64
    );
    if (valid.length > 0) {
      conditions.push(`j.id NOT IN (${valid.map(() => "?").join(", ")})`);
      bindings.push(...valid);
    }
  }
  const etNear = employmentTypeCondition(employment_type);
  if (etNear) {
    conditions.push(etNear.sql);
    bindings.push(...etNear.bindings);
  }
  if (workplace_type) {
    conditions.push("j.workplace_type = ?");
    bindings.push(workplace_type);
  }
  if (description_language) {
    conditions.push("j.description_language = ?");
    bindings.push(description_language);
  }
  if (salary_min !== undefined) {
    conditions.push("j.salary_min IS NOT NULL AND j.salary_min >= ?");
    bindings.push(salary_min);
  }
  if (country) {
    conditions.push("(j.workplace_type = 'remote' OR j.job_country = ?)");
    bindings.push(country);
  }
  if (seniority_level) {
    const levels = seniority_level.split(",").map((s) => s.trim()).filter(Boolean);
    if (levels.length === 1) {
      conditions.push("j.seniority_level = ?");
      bindings.push(levels[0]);
    } else if (levels.length > 1) {
      conditions.push(`j.seniority_level IN (${levels.map(() => "?").join(", ")})`);
      bindings.push(...levels);
    }
  }
  appendCompanySlugConditions(conditions, bindings, company);
  if (visa_sponsorship === "yes" || visa_sponsorship === "no") {
    conditions.push("j.visa_sponsorship = ?");
    bindings.push(visa_sponsorship);
  }

  // Bounding-box prefilter before Haversine — ~111 km per degree latitude; longitude scales with cos(lat).
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const lngScale = Math.max(Math.abs(cosLat), 0.01);
  const dLat = radius_km / 111.0;
  const dLng = radius_km / (111.0 * lngScale);
  conditions.push("j.location_lat BETWEEN ? AND ?");
  conditions.push("j.location_lng BETWEEN ? AND ?");
  bindings.push(lat - dLat, lat + dLat, lng - dLng, lng + dLng);

  const where = conditions.join(" AND ");

  // Inline lat/lng as numeric literals in the Haversine expression — D1/SQLite does not
  // reliably support bound parameters inside expressions used in both WHERE and ORDER BY.
  const latLit = lat.toFixed(8);
  const lngLit = lng.toFixed(8);
  const hav = `(${EARTH_RADIUS_KM} * acos(
    sin(radians(${latLit})) * sin(radians(j.location_lat)) +
    cos(radians(${latLit})) * cos(radians(j.location_lat)) * cos(radians(j.location_lng) - radians(${lngLit}))
  ))`;

  const sql = `
    SELECT
${LIST_JOBS_ROW_SELECT}
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    WHERE ${where}
    AND ${hav} <= ?
    ORDER BY ${hav} ASC
    LIMIT ?
  `;

  const allBindings = [...bindings, radius_km, limit];
  const { results } = await db.prepare(sql).bind(...allBindings).all<ListJobsRow>();
  return { rows: results ?? [] };
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
        c.name                 AS company_name,
        c.logo_url             AS company_logo_url,
        c.description          AS company_description,
        c.website_url          AS company_website_url,
        c.linkedin_url         AS company_linkedin_url,
        c.glassdoor_url        AS company_glassdoor_url,
        c.x_url                AS company_x_url,
        c.instagram_url        AS company_instagram_url,
        c.youtube_url          AS company_youtube_url,
        c.github_url           AS company_github_url,
        c.huggingface_url      AS company_huggingface_url,
        c.tiktok_url           AS company_tiktok_url,
        c.crunchbase_url       AS company_crunchbase_url,
        c.facebook_url         AS company_facebook_url,
        c.employee_count_range AS company_employee_count_range,
        c.employee_count       AS company_employee_count,
        c.founded_year         AS company_founded_year,
        c.hq_address           AS company_hq_address,
        c.hq_city              AS company_hq_city,
        c.hq_country           AS company_hq_country,
        c.hq_lat               AS company_hq_lat,
        c.hq_lng               AS company_hq_lng,
        c.industry             AS company_industry,
        c.company_type         AS company_type,
        c.total_funding_usd    AS company_total_funding_usd,
        c.locations            AS company_locations
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
/**
 * Fetch Consider-sourced jobs that are missing a description.
 * Returns the job id, apply_url (points to the real ATS), and any fields
 * we may want to backfill (salary, location) alongside the description.
 */
/**
 * Fetch Workday jobs that have no description yet.
 * Returns source_url (the human-readable apply URL containing /job/...) and
 * the source's base_url (the CXS endpoint) so the backfill can construct the
 * CXS detail URL without a second DB lookup.
 *
 * Also includes rows where `description_raw` is a numeric-only placeholder (e.g. requisition
 * id from `bulletFields` when JSON-LD fetch failed during ingest). Those must be re-fetched.
 */
export async function getWorkdayJobsNeedingDescription(
  db: D1Database,
  limit: number
): Promise<Array<{ id: string; source_url: string; base_url: string }>> {
  const { results } = await db
    .prepare(`
      SELECT j.id, j.source_url, s.base_url
      FROM jobs j
      JOIN sources s ON j.source_id = s.id
      WHERE s.source_type = 'workday'
        AND j.source_url IS NOT NULL
        AND (
          j.description_raw IS NULL
          OR (
            LENGTH(TRIM(j.description_raw)) <= 32
            AND TRIM(j.description_raw) != ''
            AND NOT (TRIM(j.description_raw) GLOB '*[!0-9]*')
          )
        )
      ORDER BY j.first_seen_at DESC
      LIMIT ?
    `)
    .bind(limit)
    .all<{ id: string; source_url: string; base_url: string }>();
  return results;
}

export async function getConsiderJobsNeedingDescription(
  db: D1Database,
  limit: number
): Promise<Array<{
  id: string;
  apply_url: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  locations: string | null;
  workplace_type: string | null;
}>> {
  // Exclude jobs whose company already has a direct (non-Consider) source in D1 —
  // those jobs will get their description from the direct ATS fetch instead,
  // so fetching again here would be redundant cron work.
  // CTE materializes once (avoids correlated NOT EXISTS that timed out on large D1 tables).
  const { results } = await db
    .prepare(`
      WITH has_direct AS (
        SELECT DISTINCT j2.company_id
        FROM jobs j2
        INNER JOIN sources s2 ON j2.source_id = s2.id
        WHERE s2.source_type != 'consider'
          AND j2.description_raw IS NOT NULL
      )
      SELECT j.id, j.apply_url, j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
             j.locations, j.workplace_type
      FROM jobs j
      INNER JOIN sources s ON j.source_id = s.id AND s.source_type = 'consider'
      WHERE j.description_raw IS NULL
        AND j.company_id NOT IN (SELECT company_id FROM has_direct WHERE company_id IS NOT NULL)
      ORDER BY j.first_seen_at DESC
      LIMIT ?
    `)
    .bind(limit)
    .all<{
      id: string;
      apply_url: string;
      salary_min: number | null;
      salary_max: number | null;
      salary_currency: string | null;
      salary_period: string | null;
      locations: string | null;
      workplace_type: string | null;
    }>();
  return results;
}

/**
 * Backfill description + optional salary/location fields for a single job.
 * Only writes when `description_raw` is null, or when it is a short numeric-only placeholder
 * (Workday requisition id accidentally stored as the description) so real copy can replace it.
 */
export async function backfillJobDescription(
  db: D1Database,
  id: string,
  fields: {
    description_raw: string;
    salary_min?: number | null;
    salary_max?: number | null;
    salary_currency?: string | null;
    salary_period?: string | null;
    locations?: string | null;
    workplace_type?: string | null;
    employment_type?: string | null;
  }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { detectLanguage } = await import("../enrichment/language.ts");
  const detectedLang = detectLanguage(fields.description_raw);
  let locPrimary: string | null = null;
  if (fields.locations) {
    try {
      const arr = JSON.parse(fields.locations) as unknown;
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string") locPrimary = arr[0];
    } catch {
      /* ignore invalid JSON */
    }
  }
  await db
    .prepare(`
      UPDATE jobs SET
        description_raw        = ?,
        description_language   = COALESCE(description_language, ?),
        ai_generated_at        = NULL,
        embedding_generated_at = NULL,
        salary_min      = CASE WHEN salary_min IS NULL AND ? IS NOT NULL THEN ? ELSE salary_min END,
        salary_max      = CASE WHEN salary_max IS NULL AND ? IS NOT NULL THEN ? ELSE salary_max END,
        salary_currency = CASE WHEN salary_currency IS NULL AND ? IS NOT NULL THEN ? ELSE salary_currency END,
        salary_period   = CASE WHEN salary_period IS NULL AND ? IS NOT NULL THEN ? ELSE salary_period END,
        locations       = CASE WHEN locations IS NULL AND ? IS NOT NULL THEN ? ELSE locations END,
        location_primary = CASE WHEN locations IS NULL AND ? IS NOT NULL THEN ? ELSE location_primary END,
        workplace_type  = CASE WHEN workplace_type IS NULL AND ? IS NOT NULL THEN ? ELSE workplace_type END,
        employment_type = CASE WHEN employment_type IS NULL AND ? IS NOT NULL THEN ? ELSE employment_type END,
        updated_at      = ?
      WHERE id = ? AND (
        description_raw IS NULL
        OR (
          LENGTH(TRIM(description_raw)) <= 32
          AND TRIM(description_raw) != ''
          AND NOT (TRIM(description_raw) GLOB '*[!0-9]*')
        )
      )
    `)
    .bind(
      fields.description_raw,
      detectedLang,
      fields.salary_min ?? null, fields.salary_min ?? null,
      fields.salary_max ?? null, fields.salary_max ?? null,
      fields.salary_currency ?? null, fields.salary_currency ?? null,
      fields.salary_period ?? null, fields.salary_period ?? null,
      fields.locations ?? null, fields.locations ?? null,
      fields.locations ?? null, locPrimary,
      fields.workplace_type ?? null, fields.workplace_type ?? null,
      fields.employment_type ?? null, fields.employment_type ?? null,
      now, id
    )
    .run();
}

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
  extras?: {
    salary?: { min: number | null; max: number | null; currency: string; period: string } | null;
    /** AI overrides workplace_type — it has full description context, including remote/hybrid signals the ATS may have missed. */
    workplace_type?: string | null;
    /** AI overrides employment_type — reads the full description, not just the ATS metadata field. */
    employment_type?: string | null;
    seniority_level?: string | null;
    visa_sponsorship?: string | null;
    locations?: string[] | null;
    description_language?: string | null;
    experience_years_min?: number | null;
    job_address?: string | null;
    job_city?: string | null;
    job_state?: string | null;
    job_country?: string | null;
  } | null
): Promise<void> {
  const {
    salary, workplace_type, employment_type, seniority_level,
    visa_sponsorship, locations, description_language,
    experience_years_min, job_address, job_city, job_state, job_country,
  } = extras ?? {};

  const locationsJson = locations && locations.length > 0 ? JSON.stringify(locations) : null;
  const locationPrimaryFromAi =
    locations != null && locations.length > 0 ? locations[0]! : null;

  // AI overrides workplace_type and employment_type — it reads the full description
  // and correctly handles remote/hybrid and contract/full-time signals that ATS metadata fields miss.
  // COALESCE used for fields where source wins if already populated (salary, seniority, visa).
  await db
    .prepare(
      `UPDATE jobs
       SET job_summary          = ?,
           job_description      = ?,
           ai_generated_at      = ?,
           locations            = COALESCE(?, locations),
           location_primary     = COALESCE(?, location_primary),
           description_language = COALESCE(?, description_language),
           workplace_type       = COALESCE(?, workplace_type),
           employment_type      = COALESCE(?, employment_type),
           seniority_level      = COALESCE(seniority_level, ?),
           visa_sponsorship     = COALESCE(visa_sponsorship, ?),
           salary_min           = COALESCE(salary_min, ?),
           salary_max           = COALESCE(salary_max, ?),
           salary_currency      = COALESCE(salary_currency, ?),
           salary_period        = COALESCE(salary_period, ?),
           experience_years_min = COALESCE(experience_years_min, ?),
           job_address          = COALESCE(job_address, ?),
           job_city             = COALESCE(job_city, ?),
           job_state            = COALESCE(job_state, ?),
           job_country          = COALESCE(job_country, ?)
       WHERE id = ?`
    )
    .bind(
      jobSummary,
      jobDescription,
      now,
      locationsJson,
      locationPrimaryFromAi,
      description_language ?? null,
      workplace_type ?? null,
      employment_type ?? null,
      seniority_level ?? null,
      visa_sponsorship ?? null,
      salary?.min ?? null,
      salary?.max ?? null,
      salary?.currency ?? null,
      salary?.period ?? null,
      experience_years_min ?? null,
      job_address ?? null,
      job_city ?? null,
      job_state ?? null,
      job_country ?? null,
      id
    )
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Language backfill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch jobs that have a description but no detected language yet.
 * The heuristic backfill processes these in batches each cron run.
 */
export async function getJobsNeedingLanguageDetection(
  db: D1Database,
  limit: number
): Promise<Array<{ id: string; description_raw: string }>> {
  const { results } = await db
    .prepare(
      `SELECT id, description_raw FROM jobs
       WHERE description_raw IS NOT NULL AND description_language IS NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ id: string; description_raw: string }>();
  return results;
}

/**
 * Write heuristic-detected language for a batch of jobs.
 * Only updates rows where description_language is still null — AI-set values
 * are never overwritten by the heuristic backfill.
 */
export async function batchSetLanguage(
  db: D1Database,
  rows: Array<{ id: string; description_language: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map(({ id, description_language }) =>
    db
      .prepare("UPDATE jobs SET description_language = ? WHERE id = ? AND description_language IS NULL")
      .bind(description_language, id)
  );
  const CHUNK = 500;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await db.batch(stmts.slice(i, i + CHUNK));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic field backfill (employment_type + seniority_level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch jobs that have a description but are missing seniority_level (or
 * missing employment_type) so the heuristic backfill can populate them.
 * Returns both fields so we can skip a job if both are already set.
 */
export async function getJobsNeedingHeuristicEnrichment(
  db: D1Database,
  limit: number
): Promise<Array<{ id: string; title: string; description_raw: string; employment_type: string | null; seniority_level: string | null }>> {
  const { results } = await db
    .prepare(
      `SELECT id, title, description_raw, employment_type, seniority_level FROM jobs
       WHERE description_raw IS NOT NULL
         AND (seniority_level IS NULL OR employment_type IS NULL)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ id: string; title: string; description_raw: string; employment_type: string | null; seniority_level: string | null }>();
  return results;
}

/**
 * Write heuristic-detected seniority_level and/or employment_type for a batch.
 * Uses COALESCE so AI-set (or scraper-set) values are never overwritten.
 */
export async function batchSetHeuristicFields(
  db: D1Database,
  rows: Array<{ id: string; employment_type: string | null; seniority_level: string | null }>
): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map(({ id, employment_type, seniority_level }) =>
    db
      .prepare(
        `UPDATE jobs SET
           employment_type = COALESCE(employment_type, ?),
           seniority_level = COALESCE(seniority_level, ?)
         WHERE id = ?`
      )
      .bind(employment_type, seniority_level, id)
  );
  const CHUNK = 500;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await db.batch(stmts.slice(i, i + CHUNK));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic salary backfill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch jobs that have a description but no salary_min set yet.
 * Ordered newest-first so recently posted jobs are classified before old ones.
 */
export async function getJobsNeedingSalaryEnrichment(
  db: D1Database,
  limit: number
): Promise<Array<{ id: string; description_raw: string }>> {
  const { results } = await db
    .prepare(
      `SELECT id, description_raw FROM jobs
       WHERE description_raw IS NOT NULL
         AND salary_min IS NULL
         AND salary_max IS NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ id: string; description_raw: string }>();
  return results;
}

/**
 * Write regex-detected salary fields for a batch.
 * Uses COALESCE so source-set or AI-set values are never overwritten.
 */
export async function batchSetHeuristicSalary(
  db: D1Database,
  rows: Array<{ id: string; salary_min: number; salary_max: number | null; salary_currency: string; salary_period: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map(({ id, salary_min, salary_max, salary_currency, salary_period }) =>
    db
      .prepare(
        `UPDATE jobs SET
           salary_min      = COALESCE(salary_min, ?),
           salary_max      = COALESCE(salary_max, ?),
           salary_currency = COALESCE(salary_currency, ?),
           salary_period   = COALESCE(salary_period, ?)
         WHERE id = ?`
      )
      .bind(salary_min, salary_max, salary_currency, salary_period, id)
  );
  const CHUNK = 500;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await db.batch(stmts.slice(i, i + CHUNK));
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

const MARKET_STATS_KV_KEY = "market_stats_cache_v1";
const MARKET_STATS_TTL_SEC = 300;

/**
 * Aggregate statistics for the market overview endpoint.
 * All counts are run in a single D1 batch to minimize round-trips.
 * When `kv` is set, results are cached for {@link MARKET_STATS_TTL_SEC} seconds.
 */
export async function getMarketStats(
  db: D1Database,
  kv?: KVNamespace
): Promise<MarketStats> {
  if (kv) {
    const raw = await kv.get(MARKET_STATS_KV_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as MarketStats;
      } catch {
        // fall through to D1
      }
    }
  }

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

  const stats: MarketStats = {
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

  if (kv) {
    await kv.put(MARKET_STATS_KV_KEY, JSON.stringify(stats), {
      expirationTtl: MARKET_STATS_TTL_SEC,
    });
  }

  return stats;
}

/**
 * Companies that need Places API geocoding:
 *   - no coordinates yet (hq_lat IS NULL)
 *   - never failed before (hq_geocode_failed_at IS NULL)
 *   - have enough data to geocode (city or address)
 *
 * The hq_geocode_failed_at guard prevents retrying companies whose location
 * data genuinely doesn't match anything in Places. It is cleared by
 * updateCompanyEnrichment whenever hq_city or hq_country is updated.
 */
export async function listCompaniesNeedingPlacesGeocode(
  db: D1Database,
  limit: number
): Promise<Array<{ id: string; name: string; hq_city: string | null; hq_country: string | null; hq_address: string | null }>> {
  const { results } = await db
    .prepare(
      `SELECT id, name, hq_city, hq_country, hq_address
       FROM companies
       WHERE hq_lat IS NULL
         AND hq_geocode_failed_at IS NULL
         AND (hq_city IS NOT NULL OR hq_address IS NOT NULL)
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ id: string; name: string; hq_city: string | null; hq_country: string | null; hq_address: string | null }>();
  return results ?? [];
}

/**
 * Jobs from whitelisted per-job-geocode companies that still need location coords.
 * Returns job id, location primary string, and company name for the Places query.
 */
export async function listJobsNeedingPlacesGeocode(
  db: D1Database,
  companySlugs: string[],
  limit: number
): Promise<Array<{ id: string; location_primary: string; company_name: string }>> {
  if (companySlugs.length === 0) return [];
  const placeholders = companySlugs.map(() => "?").join(", ");
  // location_primary = locations[0], the primary normalized location string
  const { results } = await db
    .prepare(
      `SELECT j.id, COALESCE(j.location_primary, json_extract(j.locations, '$[0]')) AS location_primary, c.name AS company_name
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       WHERE c.slug IN (${placeholders})
         AND j.location_lat IS NULL
         AND j.locations IS NOT NULL
         AND COALESCE(j.location_primary, json_extract(j.locations, '$[0]')) IS NOT NULL
         AND COALESCE(j.location_primary, json_extract(j.locations, '$[0]')) NOT LIKE '%emote%'
       ORDER BY j.first_seen_at DESC
       LIMIT ?`
    )
    .bind(...companySlugs, limit)
    .all<{ id: string; location_primary: string; company_name: string }>();
  return results ?? [];
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

