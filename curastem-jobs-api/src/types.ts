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
  /**
   * Exa API key for company enrichment (website, social links, profile fields).
   * Primary enrichment source — Brandfetch is fallback only.
   * Set via: wrangler secret put EXA_API_KEY
   */
  EXA_API_KEY?: string;
  /**
   * Google Maps Platform API key — used for Places API (New) geocoding.
   * Required for company HQ auto-geocoding and per-job geocoding for
   * retail/franchise companies (CVS, Dollar Tree, etc.).
   * Needs: Places API (New), Maps JavaScript API.
   * Set via: wrangler secret put GOOGLE_MAPS_API_KEY
   */
  GOOGLE_MAPS_API_KEY?: string;
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
  /** Last time `website_url` was checked with an HTTP probe (epoch seconds). */
  website_checked_at: number | null;
  /** When non-zero, enrichment must not invent `https://{slug}.com` after a dead URL was cleared. */
  website_infer_suppressed: number;
  // Social / professional links
  linkedin_url: string | null;
  glassdoor_url: string | null;
  x_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  github_url: string | null;
  huggingface_url: string | null;
  tiktok_url: string | null;
  crunchbase_url: string | null;
  facebook_url: string | null;
  /** Epoch when Exa enrichment last ran for this company. NULL = never enriched. */
  exa_company_enriched_at: number | null;
  exa_social_enriched_at: number | null;
  // Company profile
  employee_count_range: string | null;
  /** Exact headcount from Exa when available; more precise than the range bucket. */
  employee_count: number | null;
  founded_year: number | null;
  hq_address: string | null;
  hq_city: string | null;
  hq_country: string | null;
  hq_lat: number | null;
  hq_lng: number | null;
  industry: string | null;
  company_type: string | null;
  total_funding_usd: number | null;
  /** JSON array of unique normalized job locations aggregated from the jobs table. */
  locations: string | null;
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
  /** Minimum years of experience required, extracted by AI. e.g. "2-3 years" → 2. */
  experience_years_min: number | null;
  /** Street address mentioned in the job posting. */
  job_address: string | null;
  /** Normalized city mentioned in the job posting. */
  job_city: string | null;
  /** US state abbreviation (e.g. "CA", "IN") — populated for US jobs. */
  job_state: string | null;
  /** Country from the job posting (ISO-2 or full name). */
  job_country: string | null;
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
  /** Job boards with public RSS/Atom feeds reachable via plain HTTP (no bot wall). */
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
  | "consider"
  /**
   * Jobright.ai native postings (Next.js `/_next/data/.../jobs/info/{id}.json`).
   * `base_url` must include `jr_ingest_ids` (comma-separated job ids). See jobright.ts.
   */
  | "jobright"
  /**
   * Framer Search index JSON (CDN) for sites built on Framer. `base_url` is the
   * `searchIndex-*.json` URL with `?site_origin=https://` for public job URLs. See framer.ts.
   */
  | "framer"
  /**
   * EasyApply tenant boards (HTML index + schema.org JobPosting JSON-LD per role).
   * `base_url` is the tenant root, e.g. `https://{company}.easyapply.co/`. See easyapply.ts.
   */
  | "easyapply"
  /**
   * Meta careers — official `jobsearch/sitemap.xml` plus per-role `JobPosting` JSON-LD on static HTML.
   * `base_url` is the sitemap URL (see metacareers.ts).
   */
  | "metacareers"
  /**
   * Rippling Recruiting public boards — Next.js `__NEXT_DATA__` on `ats.rippling.com/{slug}/jobs`.
   * `base_url` is the board root (a single-job URL is normalized). See rippling.ts.
   */
  | "rippling"
  /**
   * CATS One career sites — department listing HTML + per-job `JobPosting` JSON-LD.
   * `base_url` is `https://{tenant}.catsone.com/careers/{department}` (a job URL is normalized). See catsone.ts.
   */
  | "catsone"
  /**
   * Brillio WordPress careers site — HTML listing at `careers.brillio.com/job-listing/` (see brillio.ts).
   */
  | "brillio"
  /**
   * Phenom People career sites — locale `sitemap_index.xml` for job URLs; each job page embeds
   * `phApp.ddo.jobDetail.data.job` (HTML description, apply URL). `base_url` is the locale root or a job URL under it (see phenom.ts).
   */
  | "phenom"
  /**
   * Paradox AI career sites — paginated HTML job lists + `application/ld+json` JobPosting on each job page.
   * `base_url` is the listing root (page 1), e.g. `https://careers.amctheatres.com/` (see paradox.ts).
   */
  | "paradox"
  /**
   * Jobvite career sites (`jobs.jobvite.com/{slug}/jobs`).
   * Listing: static HTML `<tr>` rows — title + location per job, no pagination.
   * Detail: full description from `div.jv-job-detail-description`. See jobvite.ts.
   */
  | "jobvite"
  /**
   * Radancy TalentBrew HTML career sites — `search-jobs` listing + per-job `/job/...` pages
   * (`div.job-description__description` or `div.ats-description`). `base_url` is the search root
   * (e.g. `https://www.schwabjobs.com/search-jobs`). See talentbrew.ts.
   */
  | "talentbrew"
  /**
   * Eightfold PCS career sites (`{company}.eightfold.ai`). Unauthenticated
   * `GET /api/pcsx/search` + `GET /api/pcsx/position_details`. `base_url` must be a
   * careers URL with `?domain=` (tenant id, e.g. `starbucks.com`). See eightfold.ts.
   */
  | "eightfold"
  /**
   * Uber corporate careers (uber-sites Fusion RPC). `base_url` is
   * `https://www.uber.com/api/loadSearchJobsResults?localeCode=en` or a `/…/careers/list/` URL
   * (locale is inferred). See uber_sites.ts.
   */
  | "uber_sites"
  /**
   * Oracle Fusion HCM Candidate Experience — public ADF REST `recruitingCEJobRequisitions`
   * (`/hcmRestApi/resources/latest/...`). `base_url` is the CE sites URL with locale, e.g.
   * `https://tenant.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001`. See oracle_ce.ts.
   */
  | "oracle_ce"
  /**
   * iCIMS Jibe white-label boards (`*.jibeapply.com` and branded hosts).
   * Public `GET {origin}/api/jobs?page=&limit=` returns full HTML descriptions.
   * `base_url` is the branded site origin (e.g. `https://jobs.sprouts.com`). See jibe.ts.
   */
  | "jibe"
  /**
   * Shopify marketing careers — Ashby-backed listings on shopify.com (public Ashby posting API off).
   * `base_url` is `https://www.shopify.com/careers`. See shopify_careers.ts.
   */
  | "shopify_careers"
  /**
   * Oracle Activate career sites (listing often still applies via classic Taleo).
   * `GET {origin}/Search/SearchResults?jtStartIndex=&jtPageSize=` for JSON rows;
   * job descriptions from `/search/jobdetails/{slug}/{uuid}` HTML (`div.Description`).
   * `base_url` is the careers site origin (e.g. `https://jobs.rossstores.com`). See activate_careers.ts.
   */
  | "activate_careers"
  /**
   * Avature career sites — public `SearchJobs/feed/` RSS (`<item>` title/link/pubDate).
   * `base_url` is the feed URL (see avature.ts).
   */
  | "avature"
  /**
   * ServiceNow portals that expose job posting URLs via the SEO sitemap API (see `robots.txt`
   * `Sitemap:`). Job pages include SSR `<title>` and `og:description`. `base_url` is the
   * sitemap XML URL (see servicenow_seo.ts).
   */
  | "servicenow_seo";

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "temporary"
  | "volunteer";

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
  | "internship"
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
  // Social links
  linkedin_url: string | null;
  glassdoor_url: string | null;
  /** X (formerly Twitter) profile URL */
  x_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  github_url: string | null;
  huggingface_url: string | null;
  tiktok_url: string | null;
  crunchbase_url: string | null;
  facebook_url: string | null;
  // Company profile
  employee_count_range: string | null;
  /** Exact headcount when known (more precise than the range bucket). */
  employee_count: number | null;
  founded_year: number | null;
  /** Full street address, no PO Box */
  headquarters: {
    address: string | null;
    city: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  industry: string | null;
  company_type: string | null;
  total_funding_usd: number | null;
  /** Unique job locations aggregated from all open postings. Useful for office footprint. */
  locations: string[] | null;
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
  /** Minimum years of experience required (AI-extracted). e.g. "2-3 years" or "2+" → 2. */
  experience_years_min: number | null;
  /** Per-job physical address extracted from the posting text. */
  job_address: string | null;
  /** Normalized city from the posting (may differ from the company HQ). */
  job_city: string | null;
  /** US state abbreviation (e.g. "CA", "IN") — populated for US jobs. */
  job_state: string | null;
  /** Country from the posting (ISO-2 or full name for international). */
  job_country: string | null;
  /**
   * Geocoded latitude of the primary job location (locations[0]).
   * Populated at ingestion via Photon/Nominatim for most companies,
   * or via Places API for whitelisted retail chains (CVS, Domino's, etc.)
   * for store-level precision. null = not yet geocoded or location unknown.
   */
  location_lat: number | null;
  /** Geocoded longitude of the primary job location. */
  location_lng: number | null;

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
  /**
   * Seniority level detected by the source fetcher (title/description heuristics).
   * Optional — most fetchers leave this null; the ingestion layer fills it via
   * detectSeniorityFromText before upsert. AI lazy-load adds it when still null.
   */
  seniority_level?: SeniorityLevel | null;
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
