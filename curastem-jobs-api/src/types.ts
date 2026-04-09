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
   * Brandfetch API key — fallback for logos when Logo.dev has no asset, and for
   * LinkedIn / X / Glassdoor when Exa left them null. Logos prefer Logo.dev first.
   * Free tier: 500 requests/day — brandfetch.com/developers
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
   * Logo.dev API key for 64px logos. Use a secret key (`sk_`) — resolved via Search API
   * to img URLs — or a publishable key (`pk_`) for direct img.logo.dev use. When unset
   * or when Logo.dev has no match, enrichment uses Google favicon URLs.
   * Set via: wrangler secret put LOGO_DEV_TOKEN
   */
  LOGO_DEV_TOKEN?: string;
  /**
   * Google Maps Platform API key — Places API (New) for HQ geocoding and fallback
   * when Mapbox monthly soft cap is hit or Mapbox returns no result in major metros.
   * Set via: wrangler secret put GOOGLE_MAPS_API_KEY
   */
  GOOGLE_MAPS_API_KEY?: string;
  /**
   * Mapbox access token — Geocoding v6 forward (temporary tier) for major-metro
   * company+city geocoding. Set via: wrangler secret put MAPBOX_ACCESS_TOKEN
   */
  MAPBOX_ACCESS_TOKEN?: string;
  /**
   * Producer: hourly scheduler sends one message per enabled source id.
   * Consumer: runs full `processSource` with inline embeddings (isolated CPU/subrequest budget).
   */
  INGESTION_QUEUE: Queue<IngestionQueueMessage>;
  /**
   * Producer: after each source ingestion, one message per affected company id.
   * Consumer: Exa profile + social + Logo.dev + Brandfetch + Gemini for that company.
   */
  ENRICHMENT_QUEUE: Queue<EnrichmentQueueMessage>;
}

/** Payload for {@link Env.INGESTION_QUEUE}. */
export interface IngestionQueueMessage {
  sourceId: string;
}

/** Payload for {@link Env.ENRICHMENT_QUEUE}. */
export interface EnrichmentQueueMessage {
  companyId: string;
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
  /** Denormalized locations[0] — kept in sync on write for indexed geocode paths. */
  location_primary: string | null;
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

/** Pre-aggregated geohash buckets for GET /jobs/map spread viewport (rebuildJobMapCells). */
export interface JobMapCellRow {
  geohash: string;
  precision: number;
  etkey: string;
  slkey: string;
  week_bucket: number;
  job_count: number;
  chip_lat: number;
  chip_lng: number;
  company_id: string;
  company_name: string | null;
  company_logo_url: string | null;
  company_slug: string | null;
  company_hq_lat: number | null;
  company_hq_lng: number | null;
  company_hq_city: string | null;
  company_hq_country: string | null;
  company_hq_address: string | null;
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
   * Getro-powered VC job boards (Next.js on cdn.getro.com). `base_url` is the site origin
   * (e.g. `https://jobs.generalcatalyst.com`). Discovery: `sitemap.xml` → job URLs;
   * detail: `/_next/data/{buildId}/companies/.../jobs/....json`. See getro.ts.
   */
  | "getro"
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
   * GlobalLogic WordPress careers — HTML listing at `globallogic.com/career-search-page/` (see globallogic.ts).
   */
  | "globallogic"
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
   * Eightfold PCS career sites (`{company}.eightfold.ai`, `apply.careers.microsoft.com`,
   * `join.sephora.com`, etc.). Uses `GET /api/pcsx/search` + `GET /api/pcsx/position_details`
   * when search is public; some hosts disable search and we fall back to `/careers/sitemap.xml`.
   * `base_url` must include `?domain=` (tenant id, e.g. `sephora.com`). See eightfold.ts.
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
   * iCIMS Talent Cloud hub search (`hub-*.icims.com/jobs/search?...`) — paginated HTML listing;
   * job rows link to per-portal hosts. Detail: `?in_iframe=1` exposes `application/ld+json` JobPosting.
   * `base_url` is the hub search URL (include `hashed=` if the tenant requires it). See icims_portal.ts.
   */
  | "icims_portal"
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
   * `base_url` is the feed URL; locale-prefixed hosts are OK (see avature.ts).
   */
  | "avature"
  /**
   * ServiceNow portals that expose job posting URLs via the SEO sitemap API (see `robots.txt`
   * `Sitemap:`). Job pages include SSR `<title>` and `og:description`. `base_url` is the
   * sitemap XML URL (see servicenow_seo.ts).
   */
  | "servicenow_seo"
  /**
   * IBM careers — POST `www-api.ibm.com/search/api/v2` with appId `careers` / scope `careers2`
   * (same as the public careers search UI). `base_url` is the API endpoint. See ibm_careers.ts.
   */
  | "ibm_careers"
  /**
   * Recruiterflow career sites — `window.jobsList` on `…/jobs` plus per-job
   * `application/ld+json` JobPosting. `base_url` is `https://recruiterflow.com/{slug}/jobs`
   * (or a job URL under it). See recruiterflow.ts.
  */
  | "recruiterflow"
  /**
   * Google Careers — parses `AF_initDataCallback ds:1` from HTML search result pages.
   * `base_url` must be a `careers.google.com/jobs/results/` search URL.
   */
  | "google"
  /**
   * Netflix Careers — Eightfold custom deployment at explore.jobs.netflix.net.
   * Fetches sitemap from apply.netflixhouse.com then uses position_details API.
   * `base_url` must be `https://explore.jobs.netflix.net/careers?domain=netflix.com`.
   */
  | "netflix"
  /**
   * HCA Healthcare — `careers.hcahealthcare.com/sitemap.xml` regional `/search/jobs/in/…` pages
   * list `href="/jobs/{requisitionId}-{slug}"`; each job page has `application/ld+json` JobPosting.
   * `base_url` may be any URL on that host. See hcaCareers.ts.
   */
  | "hca_careers"
  /**
   * Aramark — WordPress `GET /wp-json/aramark/jobs` (JSON array; SPA loads from this endpoint).
   * `base_url` is that endpoint URL. See aramark_careers.ts.
   */
  | "aramark_careers"
  /**
   * TikTok / Life at TikTok — proprietary careers API at api.lifeattiktok.com.
   * POST /config/job/filters → POST /search/job/posts (offset-paginated, PAGE_SIZE=100).
   * `base_url` = https://lifeattiktok.com/search  (no location_codes = all global jobs)
   * Add ?location_codes=CT_94,CT_114 to restrict to specific city codes.
   */
  | "tiktok"
  /**
   * LVMH Group careers — Algolia multi-query on index `PRD-en-us-timestamp-desc`
   * (`filters=category:job`). Public search key from the Next.js client; not routed via `lvmh.com`
   * `/api/search` (Akamai). See lvmh_algolia.ts.
   */
  | "lvmh_algolia"
  /**
   * SAP SuccessFactors Recruitment Marketing (RMK) — `sitemap.xml` lists `/job/{slug}/{reqId}/`;
   * detail HTML uses schema.org JobPosting microdata + `span.jobdescription`. See successfactors_rmk.ts.
   */
  | "successfactors_rmk"
  /**
   * Symphony Talent SmartPost — `GET https://jobsapi-internal.m-cloud.io/api/job?Organization=…`
   * (WordPress CWS widget / JSONP in browser; plain JSON without `callback`). `base_url` must
   * include `mcloud_org=` on the public careers site origin. See symphony_mcloud.ts.
   */
  | "symphony_mcloud"
  /**
   * ADP RM Candidate Experience (MyJobs public API). `base_url` must be under
   * `https://myjobs.adp.com/{domain}/…` (optional `?c=` / `?d=`). See adp_cx.ts.
   */
  | "adp_cx"
  /**
   * ADP Workforce Now embedded career center (RAAS JSON). `base_url` is
   * `…/mdf/recruitment/recruitment.html?cid=…&ccId=…` on `workforcenow*.adp.com`. See adp_wfn_recruitment.ts.
   */
  | "adp_wfn_recruitment"
  /**
   * IBM BrassRing Talent Gateway (`sjobs.brassring.com` TGnewUI). Session cookie + CSRF (`RFT`)
   * then `POST /TgNewUI/Search/Ajax/PowerSearchJobs` returns `JobsCount` and full HTML descriptions.
   * `base_url` is the search home with `partnerid` and `siteid`, e.g.
   * `https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=25813&siteid=5079`. See brassring.ts.
   */
  | "brassring";

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
   * Normalized work locations from the ATS (JSON array in D1). null = unknown.
   * locations[0] is the primary display value; multi-city roles have multiple entries.
   * Strings are usually city/region (e.g. "San Francisco, CA", "London"); country may be omitted.
   * The API appends a display country from job_country when missing — see job_country.
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
   * Distinct geocoded points for this job (primary coords + per-location cache hits).
   * Present on GET /jobs/:id when multiple physical locations resolve — used by the map UI.
   */
  location_points?: Array<{ lat: number; lng: number }>;

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
