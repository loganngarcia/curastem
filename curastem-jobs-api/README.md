# curastem-jobs-api

The Curastem Jobs API is a Cloudflare Worker that powers normalized job data for the Curastem platform. It ingests jobs from public ATS sources hourly, normalizes them into a consistent schema, enriches company metadata, and serves them through a clean REST API backed by Cloudflare D1.

This is an internal-access service. Access requires an API key. To request one, contact [developers@curastem.org](mailto:developers@curastem.org).

---

## What this does

- Ingests open job postings from public ATS sources (Greenhouse, Lever, Ashby, JazzHR, Workday, SmartRecruiters, and others) every hour via a Cloudflare Cron Trigger
- Normalizes raw job data into a single canonical schema (title, location, employment type, workplace type, salary, etc.)
- Preserves the original raw description text for AI reprocessing
- Enriches company records with logo, website, LinkedIn URL, and AI-generated description (lazily, cached)
- Extracts structured job fields (responsibilities, qualifications, summary) using Gemini 3.1 Flash Lite on first request, then caches them
- Serves jobs through a paginated REST API with API key auth and rate limiting
- Deduplicates jobs across sources, preferring direct ATS sources over aggregators

---

## Architecture

```
Ingestion (hourly cron)
  Source Registry → per-source Fetcher → normalize → upsert companies → dedup check → upsert jobs

Enrichment (after ingestion)
  listUnenrichedCompanies → logo.dev / Brandfetch → infer website/LinkedIn → Gemini description

API (per request)
  Auth middleware → Rate limiter → Route handler → D1 query → [lazy AI extraction] → JSON response
```

### Queues (Cloudflare Queues)

One **ingestion** message per enabled source each hour (`curastem-ingestion`). Consumers run `processSource` with inline embeddings and isolated CPU or subrequest budgets. One **enrichment** message per company touched by a source run (`curastem-enrichment`) for Exa plus Logo.dev or Brandfetch plus Gemini.

Create queues once (already done in production):

```bash
wrangler queues create curastem-ingestion
wrangler queues create curastem-enrichment
wrangler queues create curastem-ingestion-dlq
```

The `:30` cron runs embedding or geocode and description backfills plus batch Exa or company enrichment for backlog rows.

### Separation of concerns


| Concept   | Table       | Notes                                                                |
| --------- | ----------- | -------------------------------------------------------------------- |
| Companies | `companies` | One row per unique employer. Enriched separately from job ingestion. |
| Jobs      | `jobs`      | One row per source+external_id. Linked to a company.                 |
| Sources   | `sources`   | One row per ATS board. Drives ingestion. Add new sources here.       |
| API Keys  | `api_keys`  | SHA-256 hash only. No plaintext keys stored.                         |


---

## API reference

### Authentication

All endpoints (except `/health`) require:

```
Authorization: Bearer <your_api_key>
```

Keys are issued manually. Request access at [developers@curastem.org](mailto:developers@curastem.org).

---

### `GET /health`

Unauthenticated. Returns `{ status: "ok" }`. Use for uptime monitoring.

---

### `GET /stats`

Returns aggregate market statistics. Useful for homepage counters, market overview, and the MCP `get_market_overview` tool.

**Response fields**


| Field                | Description                           |
| -------------------- | ------------------------------------- |
| `total_jobs`         | Total indexed jobs                    |
| `jobs_last_24h`      | Jobs first seen in last 24 hours      |
| `jobs_last_7d`       | Jobs first seen in last 7 days        |
| `jobs_last_30d`      | Jobs first seen in last 30 days       |
| `by_employment_type` | Array of `{ employment_type, count }` |
| `by_workplace_type`  | Array of `{ workplace_type, count }`  |
| `top_companies`      | Top 10 companies by open role count   |
| `total_companies`    | Total unique companies indexed        |
| `total_sources`      | Active ingestion sources              |


---

### `GET /jobs`

Returns a paginated list of jobs.

**Query parameters**


| Parameter         | Type   | Description                                                 |
| ----------------- | ------ | ----------------------------------------------------------- |
| `q`               | string | Search jobs by title or company name                        |
| `location`        | string | Filter by location (partial match)                          |
| `employment_type` | string | `full_time`                                                 |
| `workplace_type`  | string | `remote`                                                    |
| `company`         | string | Filter by company slug (e.g. `stripe`)                      |
| `limit`           | number | Results per page. Default 20, max 50.                       |
| `cursor`          | string | Opaque cursor from a previous response's `meta.next_cursor` |


**Response**

```json
{
  "data": [ ...Job ],
  "meta": {
    "total": 1247,
    "limit": 20,
    "next_cursor": "eyJ0cyI6MTc..."
  }
}
```

Pass `meta.next_cursor` as the `cursor` parameter on the next request to get the next page. When `next_cursor` is `null`, you have reached the last page.

---

### `GET /jobs/:id`

Returns a single job with full AI-enriched details.

AI fields (`job_summary`, `job_description`, `company.description`) are generated lazily on first request using Gemini 2.0 Flash-Lite and cached in D1. Subsequent requests return the cached values instantly.

---

### Job object schema

**Required fields**


| Field             | Type   | Description                                                                                       |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `id`              | string | Stable Curastem job ID                                                                            |
| `title`           | string | Job title                                                                                         |
| `company`         | object | See company schema below                                                                          |
| `posted_at`       | string | ISO 8601. Best-available posting time (falls back to first_seen_at if source did not provide one) |
| `apply_url`       | string | Direct application URL                                                                            |
| `location`        | string | null                                                                                              |
| `employment_type` | string | null                                                                                              |
| `workplace_type`  | string | null                                                                                              |
| `source_name`     | string | Which ATS source this came from                                                                   |
| `source_url`      | string | null                                                                                              |


**Optional fields**


| Field             | Type   | Description |
| ----------------- | ------ | ----------- |
| `salary`          | object | null        |
| `job_summary`     | string | null        |
| `job_description` | object | null        |


`**job_description` structure**

```json
{
  "responsibilities": ["..."],
  "minimum_qualifications": ["..."],
  "preferred_qualifications": ["..."]
}
```

Extracted from raw description text. Empty arrays when a section is not clearly present in the source text. We never invent content.

---

### Company object schema


| Field           | Required | Description                                                      |
| --------------- | -------- | ---------------------------------------------------------------- |
| `name`          | yes      | Company name                                                     |
| `logo_url`      | no       | Company logo image URL                                           |
| `description`   | no       | One-sentence company description (AI-generated from job context) |
| `website_url`   | no       | Company website                                                  |
| `linkedin_url`  | no       | LinkedIn company page                                            |
| `glassdoor_url` | no       | Glassdoor company page                                           |
| `x_url`         | no       | X (formerly Twitter) profile                                     |


Optional company fields are nullable but the enrichment layer actively tries to populate them. They are not optional by design — they are optional in output because enrichment is async and heuristic.

---

## Error responses

All errors return structured JSON:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key"
  }
}
```


| HTTP Status | Code             | Meaning                                       |
| ----------- | ---------------- | --------------------------------------------- |
| 400         | `BAD_REQUEST`    | Invalid query parameter                       |
| 401         | `UNAUTHORIZED`   | Missing or invalid API key                    |
| 404         | `NOT_FOUND`      | Job not found                                 |
| 429         | `RATE_LIMITED`   | Rate limit exceeded (default: 60 RPM per key) |
| 500         | `INTERNAL_ERROR` | Unexpected server error                       |


---

## Ingestion sources

Jobs are ingested hourly from public ATS boards. Each source is a row in the `sources` table. Adding a new source means inserting a new row — no code changes required when the `source_type` is already implemented.

### Supported ATS types

These rows cover **multi-tenant recruiting products** (ATS and talent platforms), **syndicated listing surfaces** (VC boards, static site indexes), and related enterprise career APIs. Types are listed in rough alphabetical order by `source_type`. Implementation files live in `src/ingestion/sources/<name>.ts` unless noted.


| Source type           | How it works                                                                                                        | Auth required                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `activate_careers`    | Oracle Activate — `Search/SearchResults` JSON + `/search/jobdetails/...` HTML (`activate_careers.ts`)               | None — fully public                        |
| `adp_cx`              | ADP RM Candidate Experience — MyJobs public API (`adp_cx.ts`)                                                       | None — fully public                        |
| `adp_wfn_recruitment` | ADP Workforce Now RAAS JSON from embedded career center URLs (`adp_wfn_recruitment.ts`)                             | None — fully public                        |
| `ashby`               | Ashby public posting / job-board API (`ashby.ts`)                                                                   | None — fully public                        |
| `avature`             | Avature — public `SearchJobs/feed/` RSS (`avature.ts`)                                                              | None — fully public                        |
| `brassring`           | IBM BrassRing Talent Gateway — `PowerSearchJobs` after session + `RFT` token from search home HTML (`brassring.ts`) | No API key — public session handshake only |
| `catsone`             | CATS One — department HTML listing + JSON-LD / `__PRELOADED_STATE__` (`catsone.ts`)                                 | None — fully public                        |
| `consider`            | Consider VC portfolio boards — white-label `/api-boards/search-jobs` (`consider.ts`)                                | None — fully public                        |
| `easyapply`           | EasyApply — `*.easyapply.co` index + per-job `JobPosting` JSON-LD (`easyapply.ts`)                                  | None — fully public                        |
| `eightfold`           | Eightfold PCS — `/api/pcsx/search` + `position_details` when enabled (`eightfold.ts`)                               | None — fully public when search is public  |
| `framer`              | Framer — CDN `searchIndex-*.json` job entries (`framer.ts`)                                                         | None — fully public                        |
| `getro`               | Getro VC boards — Next.js `/_next/data/.../jobs/....json` (`getro.ts`)                                              | None — fully public                        |
| `greenhouse`          | Greenhouse boards API — `boards-api.greenhouse.io/v1/boards/{handle}/jobs` (`greenhouse.ts`)                        | None — fully public                        |
| `ibm_careers`         | IBM unified careers search API (`ibm_careers.ts`)                                                                   | None — fully public                        |
| `icims_portal`        | iCIMS Talent Cloud hub search HTML + per-portal job JSON-LD (`icims_portal.ts`)                                     | None — fully public                        |
| `jazzhr`              | JazzHR — `*.applytojob.com/apply` listing + JSON-LD per posting (`jazzhr.ts`)                                       | None — fully public                        |
| `jibe`                | iCIMS Jibe — `GET /api/jobs` JSON with HTML descriptions (`jibe.ts`)                                                | None — fully public                        |
| `jobvite`             | Jobvite — `jobs.jobvite.com/{slug}/jobs` HTML + per-job detail (`jobvite.ts`)                                       | None — fully public                        |
| `lever`               | Lever — `api.lever.co/v0/postings/{handle}` (`lever.ts`)                                                            | None — fully public                        |
| `oracle_ce`           | Oracle Fusion HCM Candidate Experience REST (`oracle_ce.ts`)                                                        | None — fully public                        |
| `paradox`             | Paradox — paginated job lists + JSON-LD (`paradox.ts`)                                                              | None — fully public                        |
| `personio`            | Personio — public XML feed (`personio.ts`)                                                                          | None — fully public                        |
| `phenom`              | Phenom — locale sitemaps + embedded job payload (`phenom.ts`)                                                       | None — fully public                        |
| `pinpoint`            | Pinpoint — public jobs JSON (`pinpoint.ts`)                                                                         | None — fully public                        |
| `recruitee`           | Recruitee — `/api/offers` (`recruitee.ts`)                                                                          | None — fully public                        |
| `recruiterflow`       | Recruiterflow — listing payload + JSON-LD (`recruiterflow.ts`)                                                      | None — fully public                        |
| `rippling`            | Rippling Recruiting — `ats.rippling.com` `__NEXT_DATA__` (`rippling.ts`)                                            | None — fully public                        |
| `saashr`              | UKG / SaaSHR — REST derived from public `.careers` pages (`saashr.ts`)                                              | None — fully public                        |
| `servicenow_seo`      | ServiceNow — SEO sitemap + job pages (`servicenow_seo.ts`)                                                          | None — fully public                        |
| `smartrecruiters`     | SmartRecruiters API (`smartrecruiters.ts`)                                                                          | None — fully public                        |
| `successfactors_rmk`  | SAP SuccessFactors RMK — sitemap + JobPosting microdata (`successfactors_rmk.ts`)                                   | None — fully public                        |
| `symphony_mcloud`     | Symphony Talent SmartPost — `m-cloud.io` job API (`symphony_mcloud.ts`)                                             | None — fully public                        |
| `talentbrew`          | Radancy TalentBrew — search listing + job HTML (`talentbrew.ts`)                                                    | None — fully public                        |
| `workable`            | Workable widget / API (`workable.ts`)                                                                               | None — fully public                        |
| `workday`             | Workday — CXS `POST` to `myworkdayjobs.com` (`workday.ts`)                                                          | None — public board endpoint               |
| `ycombinator`         | Y Combinator — public jobs API (`ycombinator.ts`)                                                                   | None — fully public                        |


### Other sources (non-ATS)

These `source_type` values are **not** shared multi-tenant ATS products. They include one-off employer parsers (including modules under `single-companies/`), the US federal board, jobs fetched through a headless browser, or RSS and Atom feeds.


| Kind                         | `source_type` values                                                                                                                        | Notes                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Single-employer career sites | `amazon`, `apple`, `google`, `netflix`, `uber`, `shopify`, `hca`, `aramark`, `brillio`, `globallogic`, `lvmh`, `meta`, `tiktok`, `jobright` | Short company-style names for parsers in `sources/single-companies/` (and similar one-off modules next to `sources/*.ts`). |
| US federal jobs              | `usajobs`                                                                                                                                   | Requires `USAJOBS_API_KEY`.                                                                                                |
| Headless browser             | `browser`                                                                                                                                   | Uses the Cloudflare Browser Rendering binding for client-rendered career pages.                                            |
| RSS and Atom feeds           | `rss`                                                                                                                                       | Per-item URLs and descriptions (`rss.ts`).                                                                                 |


### Adding a new source

1. Insert a row into the `sources` table with the correct `source_type` and `company_handle`.
2. The next hourly cron run will pick it up automatically.

```sql
INSERT INTO sources (id, name, source_type, company_handle, base_url, enabled, created_at)
VALUES (
  'gh-newcompany',
  'New Company (Greenhouse)',
  'greenhouse',
  'newcompany',
  'https://boards-api.greenhouse.io/v1/boards/newcompany/jobs',
  1,
  unixepoch()
);
```

### Adding a new ATS type

1. Add the new type to `SourceType` in `src/types.ts`.
2. Create a new fetcher in `src/ingestion/sources/` (or `sources/single-companies/` for one-off employer parsers).
3. Register it in `src/ingestion/registry.ts`.
4. Insert source rows into the `sources` table.

---

## Deduplication

Two levels:

1. **Exact match** — same `source_id` + `external_id` = update in place. No duplicate.
2. **Cross-source match** — `dedup_key` = normalized title + `|` + company slug (`buildDedupKey`). If another source already has that key with **higher** `SOURCE_PRIORITY` (see `registry.ts`), the incoming row is skipped. If the incoming source is **higher** priority than existing rows with the same key, those lower-priority rows are **deleted** before upsert so the feed does not double-list the role. Equal priority keeps both rows. Use `company_aliases` when the same employer appears under different name spellings (e.g. `us-bank` → `us-bancorp`).

---

## Observability

The ingestion cron logs structured JSON to Cloudflare Workers Logs after each source and after each full run. Log events:


| Event                          | When                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `ingestion_started`            | Cron begins                                                      |
| `ingestion_sources_loaded`     | Source list fetched from DB                                      |
| `ingestion_source_started`     | Processing begins for each source                                |
| `ingestion_result`             | Per-source: fetched/inserted/updated/skipped/dedup/failed counts |
| `ingestion_summary`            | Aggregate totals across all sources                              |
| `company_enrichment_started`   | Company enrichment pass begins                                   |
| `company_enriched`             | One company successfully enriched                                |
| `company_enrichment_completed` | Enrichment pass finished                                         |


View logs in the Cloudflare dashboard under Workers & Pages → curastem-jobs-api → Logs.

---

## Local development

### Prerequisites

- Node.js 18+
- `npm install -g wrangler` or `npx wrangler`
- A Cloudflare account (for D1 database creation)

### Setup

```bash
cd curastem-jobs-api
npm install

# Create D1 database
wrangler d1 create curastem-jobs

# Copy the database_id from the output into wrangler.jsonc
# Then run the schema migration locally
npm run db:migrate
```

### Seed initial sources and run ingestion locally

```bash
# Start the dev server
npm run dev

# In a separate terminal, trigger the cron manually
curl -X GET "http://localhost:8787/__scheduled?cron=0+*+*+*+*" \
  -H "x-cf-scheduled: true"
```

### Set secrets locally

```bash
# For local dev, add to .dev.vars (gitignored):
echo "GEMINI_API_KEY=your_key_here" >> .dev.vars
```

### Create a test API key

```sql
-- Run via wrangler d1 execute curastem-jobs --local --command
INSERT INTO api_keys (id, key_hash, owner_email, description, active, created_at)
VALUES (
  'test-key-id',
  -- sha256 of "test-key-plaintext" — replace with your own
  'your_sha256_hash_here',
  'dev@curastem.org',
  'Local dev key',
  1,
  unixepoch()
);
```

### Deploy to production

```bash
# Create remote D1 database and KV namespace first, then:
npm run db:migrate:remote
wrangler secret put GEMINI_API_KEY
npm run deploy
```

---

## Cost profile

**USD.** Rounded vendor list prices (invoices override). Cloudflare numbers below are **overage** rates on **Workers Paid** after each product’s monthly included quota. Published **rate limits** are appended after pricing as **•** using **RPM** (requests per minute) or **RPS** (requests per second), when applicable (for example **•** 1000 RPM).


| Cloudflare   | Rate                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Workers plan | **$5/mo** account minimum, then **+$0.30** per 1M requests beyond 10M/mo and **+$0.02** per 1M CPU-ms beyond 30M/mo        |
| D1           | **+$0.001** per 1M rows read · **+$1.00** per 1M rows written · **+$0.75** per GB-month storage beyond the included 5 GB   |
| KV           | **+$0.50** per 1M reads · **+$5.00** per 1M writes/deletes/lists · **+$0.50** per GB-month beyond the included 1 GB        |
| Queues       | **+$0.40** per 1M operations beyond 1M/mo                                                                                  |
| Vectorize    | **+$0.01** per 1M queried vector dimensions beyond 50M/mo · **+$0.05** per 100M stored dimensions beyond the included pool |



| Third-party                 | Rate                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini 3.1 Flash Lite       | **$0.25** / 1M input tokens · **$1.50** / 1M output tokens **•** **[300 RPM](https://aistudio.google.com/rate-limit)** Tier 1                                   |
| Gemini Embedding 2          | **$0.20** / 1M tokens **•** **[150 RPM](https://aistudio.google.com/rate-limit)** Tier 1                                                                        |
| Exa Company Search          | **~$0.012** / request **•** **[10 RPS](https://docs.exa.ai/reference/rate-limits)**                                                                             |
| logo.dev                    | **500k** requests/mo free                                                                                                                                       |
| Brandfetch Social Search    | **100** requests/mo free **•** **[100 RPS](https://docs.brandfetch.com/brand-api/quotas-and-usage)**                                                            |
| Google favicon              | **$0**                                                                                                                                                          |
| Google Places (Text Search) | **~$0.032** / request                                                                                                                                           |
| Google Dynamic Maps         | **10,000** map loads/mo free · **$7.00** / 1,000 loads after (tiered down at volume)                                                                            |
| Google Static Maps          | **10,000** loads/mo free · **$2.00** / 1,000 loads after (tiered down at volume)                                                                                |
| Google Geocoding            | **~$0.005** / request                                                                                                                                           |
| Mapbox Geocoding            | **100k** requests/mo free · **~$0.75** / 1,000 after **•** **[1000 RPM](https://docs.mapbox.com/api/search/geocoding/#geocoding-restrictions-and-rate-limits)** |
| Photon Geocoding            | **$0**                                                                                                                                                          |
| Nominatim Geocoding         | **$0** **•** **[1 RPS](https://operations.osmfoundation.org/policies/nominatim/)**                                                                              |


