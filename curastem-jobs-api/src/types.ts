/**
 * Curastem Jobs API — shared TypeScript interfaces.
 *
 * START HERE when reading the codebase. This file is the single source of
 * truth for every data shape used in the system.
 *
 * Three distinct layers:
 *
 *   DB rows   — raw D1 row shapes (snake_case, integer timestamps, 0/1 booleans).
 *               Suffixed with "Row". e.g. JobRow, CompanyRow, SourceRow.
 *               NEVER returned directly to API consumers.
 *
 *   Internal  — in-memory objects used between ingestion, enrichment, and routes.
 *               e.g. NormalizedJob, IngestionResult.
 *
 *   Public    — the JSON shapes returned by the REST API and consumed by
 *               the MCP server and Curastem web app. Prefixed with "Public".
 *               e.g. PublicJob, PublicCompany.
 *               Timestamps are ISO 8601 strings, not integers.
 *
 * Key rules enforced by this module:
 *   1. Never add business logic here. Pure data shapes only.
 *   2. Add a JSDoc comment to every exported interface explaining its role.
 *   3. When changing a public type, update README.md to match.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker Env bindings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Worker environment bindings.
 * Cloudflare injects these at runtime based on wrangler.jsonc configuration.
 * In local dev, secrets come from .dev.vars (gitignored).
 */
export interface Env {
  /** D1 database binding — main data store for jobs, companies, sources, api_keys */
  JOBS_DB: D1Database;
  /** KV namespace for rate limiter sliding-window counters */
  RATE_LIMIT_KV: KVNamespace;
  /** Google Gemini API key — used for AI extraction and embedding generation */
  GEMINI_API_KEY: string;
  /**
   * Cloudflare Vectorize index for semantic job search.
   * Embeddings are generated via Gemini Embedding API (768-dimensional, cosine).
   * When present, GET /jobs?q=... uses vector similarity instead of SQL LIKE.
   */
  JOBS_VECTORS: VectorizeIndex;
  /**
   * Cloudflare Browser Rendering binding.
   * Used by the "browser" source type to scrape career pages that load job
   * listings client-side only (no public ATS API endpoint).
   * Free tier: 10 hrs/month on Workers Paid plan.
   */
  BROWSER: Fetcher;
  /**
   * Brandfetch API key for company enrichment (logo, LinkedIn, X, Glassdoor).
   * Free tier: 500 requests/day — get a key at brandfetch.com/developers.
   * Optional: enrichment falls back to Clearbit logo + slug inference if unset.
   */
  BRANDFETCH_CLIENT_ID?: string;
  /**
   * USAJOBS API key for federal government job listings.
   * Free at developer.usajobs.gov. Set via wrangler secret put USAJOBS_API_KEY.
   */
  USAJOBS_API_KEY?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 row types (match schema.sql column names exactly)
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  glassdoor_url: string | null;
  x_url: string | null;
  description: string | null;
  description_enriched_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SourceRow {
  id: string;
  name: string;
  source_type: SourceType;
  company_handle: string;
  base_url: string;
  enabled: number;
  last_fetched_at: number | null;
  last_job_count: number | null;
  last_error: string | null;
  /** Minimum hours between fetches. NULL = run every cron cycle (hourly). */
  fetch_interval_hours: number | null;
  created_at: number;
}

export interface JobRow {
  id: string;
  company_id: string;
  source_id: string;
  external_id: string;
  title: string;
  locations: string | null;  // serialized JSON array, e.g. '["San Francisco, CA"]'; locations[0] is primary
  employment_type: EmploymentType | null;
  workplace_type: WorkplaceType | null;
  apply_url: string;
  source_url: string | null;
  source_name: string;
  description_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  job_summary: string | null;
  job_description: string | null; // serialized JSON: JobDescriptionExtracted
  ai_generated_at: number | null;
  /** Epoch timestamp of last embedding generation; NULL = not yet embedded */
  embedding_generated_at: number | null;
  posted_at: number | null;
  first_seen_at: number;
  dedup_key: string;
  created_at: number;
  updated_at: number;
}

export interface ApiKeyRow {
  id: string;
  key_hash: string;
  owner_email: string;
  description: string | null;
  rate_limit_per_minute: number;
  active: number;
  created_at: number;
  last_used_at: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enums / discriminated unions
// ─────────────────────────────────────────────────────────────────────────────

export type SourceType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "recruitee"
  | "workable"
  | "personio"
  | "pinpoint"
  | "amazon"
  | "apple"
  | "ycombinator"
  /** Career pages that load jobs client-side only — scraped via Cloudflare Browser Rendering */
  | "browser"
  /** Job boards with public RSS/Atom feeds (e.g. HigherEdJobs, Chronicle Jobs) */
  | "rss"
  /** USAJOBS federal government job board — requires USAJOBS_API_KEY secret */
  | "usajobs"
  /**
   * UKG / SaaSHR tenant career portals.
   * base_url is the public careers page (e.g. https://secure6.saashr.com/ta/6170001.careers).
   * The fetcher derives the unauthenticated REST API URL from it.
   */
  | "saashr"
  /**
   * Consider-powered VC job boards (white-label, e.g. jobs.a16z.com/jobs/{companySlug}).
   * base_url is the company listing page; the fetcher calls the board's /api-boards/search-jobs API.
   */
  | "consider";

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary";

export type WorkplaceType = "remote" | "hybrid" | "on_site";

export type SalaryPeriod = "year" | "month" | "hour";

/** "yes" / "no" only when the posting explicitly mentions visa sponsorship. null = not stated. */
export type VisaSponsorship = "yes" | "no";

/**
 * Primary language of the job description text, as an ISO 639-1 code.
 *
 * Populated in two passes:
 *   1. Heuristic detector (at ingest + backfill) — fast, zero API cost, covers
 *      the top 10 languages by job-market volume. Returns null when ambiguous.
 *   2. AI lazy-load (GET /jobs/:id) — overrides the heuristic and fills nulls
 *      using the full description context.
 *
 * null = unknown (description missing, too short, or genuinely ambiguous).
 *
 * Supported values: en es de fr pt it nl pl ja zh
 * Full list is maintained in src/enrichment/language.ts.
 */
export type DescriptionLanguage =
  | "en"  // English
  | "es"  // Spanish
  | "de"  // German
  | "fr"  // French
  | "pt"  // Portuguese
  | "it"  // Italian
  | "nl"  // Dutch
  | "pl"  // Polish
  | "ja"  // Japanese
  | "zh"; // Chinese (Simplified or Traditional)

/**
 * Career level of the role, inferred by AI from the job title and description.
 * null = not determinable (ambiguous title, multi-level posting, etc.)
 *
 * Ordered from lowest to highest:
 *   new_grad  — Explicitly targets new/recent graduates: "New Grad", "Campus Hire",
 *               "University Grad", "Early Career" with a graduation year, or roles
 *               that explicitly require 0 years of experience and target students/grads.
 *               Does NOT include generic "Junior" or "Associate" titles — those are "entry".
 *   entry     — Junior, Associate, Entry-Level, 0–2 yrs experience required (but not
 *               explicitly a grad program)
 *   mid       — Mid-level, no seniority qualifier in title, 2–5 yrs
 *   senior    — Senior / Sr. individual contributor
 *   staff     — Staff / Principal / Distinguished IC (above Senior, no direct reports)
 *   manager   — People manager with direct reports; excludes IC titles like
 *               "Product Manager" or "Program Manager" that use "Manager" as a
 *               discipline name rather than a people-management level
 *   director  — Director / Head of (when clearly a leadership level, not a startup IC)
 *   executive — VP, SVP, EVP, C-level, President, Founder
 */
export type SeniorityLevel =
  | "new_grad"
  | "entry"
  | "mid"
  | "senior"
  | "staff"
  | "manager"
  | "director"
  | "executive";

// ─────────────────────────────────────────────────────────────────────────────
// AI-extracted job description structure
// ─────────────────────────────────────────────────────────────────────────────

export interface JobDescriptionExtracted {
  responsibilities: string[];
  minimum_qualifications: string[];
  preferred_qualifications: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API response shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicCompany {
  name: string;
  logo_url: string | null;
  description: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  glassdoor_url: string | null;
  /** X (formerly Twitter) profile URL */
  x_url: string | null;
}

export interface PublicSalary {
  min: number | null;
  max: number | null;
  currency: string;
  period: SalaryPeriod;
  /** Human-readable salary string, e.g. "$120,000" or "$45/hour". Always USD. */
  display: string;
}

/**
 * The central public Job object.
 * Required fields are always present; optional fields may be null.
 * posted_at falls back to first_seen_at when the source does not provide one.
 */
export interface PublicJob {
  // Required
  id: string;
  title: string;
  company: PublicCompany;
  posted_at: string;         // ISO 8601; best-available posting time
  apply_url: string;
  /**
   * Normalized work locations. null = unknown.
   * locations[0] is the primary display value; multi-city roles have multiple entries.
   * e.g. ["San Francisco, CA"] | ["New York, NY", "Remote"] | null
   */
  locations: string[] | null;
  employment_type: EmploymentType | null;
  workplace_type: WorkplaceType | null;
  seniority_level: SeniorityLevel | null;
  description_language: DescriptionLanguage | null;
  source_name: string;
  source_url: string | null;

  // Optional — may be null on list endpoint; populated on detail endpoint
  salary: PublicSalary | null;
  job_summary: string | null;
  job_description: JobDescriptionExtracted | null;
  visa_sponsorship: VisaSponsorship | null;

  /**
   * Skill and technology keywords extracted from the job description.
   * Matched against the canonical phrase list in enrichment/keywords.ts.
   * Present (possibly empty) on the detail endpoint; absent on the list endpoint.
   * No AI or extra DB calls — computed on-the-fly from stored description fields.
   */
  keywords?: string[];
}

/** Paginated list response envelope */
export interface ListResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    next_cursor: string | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingestion layer types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized job record produced by each source fetcher before DB insertion.
 * All source-specific quirks are resolved here; this is the internal contract
 * between the ingestion/sources layer and the DB layer.
 */
export interface NormalizedJob {
  external_id: string;
  title: string;
  /** Raw, unmodified location string from the ATS source. */
  location: string | null;
  employment_type: EmploymentType | null;
  workplace_type: WorkplaceType | null;
  apply_url: string;
  source_url: string | null;
  description_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  /** Source-provided posting timestamp (Unix epoch seconds). Null if unavailable. */
  posted_at: number | null;
  /** Company name as provided by the source — used to upsert the companies table. */
  company_name: string;
  /**
   * Company logo URL as provided by the source.
   * Optional — most ATS sources do not include logos. When present, it is written
   * to the companies table only if the company doesn't already have a logo stored
   * (i.e. a higher-trust source's logo is never overwritten by a lower-trust one).
   */
  company_logo_url?: string | null;
  /** Company website URL as provided by the source (e.g. Ashby organization.websiteUrl). */
  company_website_url?: string | null;
}

/** Stats emitted by the ingestion runner after processing a single source. */
export interface IngestionResult {
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
}

/**
 * Each source in the registry implements this interface.
 * `fetch` returns raw normalized jobs or throws on hard failure.
 */
export interface JobSource {
  sourceType: SourceType;
  /**
   * Fetch all open jobs for the given source row and return normalized records.
   * Implementations must not throw for individual job parse failures — they
   * should skip bad records and continue.
   *
   * The optional `env` parameter is passed by the runner and is used by the
   * "browser" source type to access the Cloudflare Browser Rendering binding.
   * All other fetchers safely ignore it.
   */
  fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]>;
}
