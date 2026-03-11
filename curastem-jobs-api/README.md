# curastem-jobs-api

The Curastem Jobs API is a Cloudflare Worker that powers normalized job data for the Curastem platform. It ingests jobs from public ATS sources hourly, normalizes them into a consistent schema, enriches company metadata, and serves them through a clean REST API backed by Cloudflare D1.

This is an internal-access service. Access requires an API key. To request one, contact [developers@curastem.org](mailto:developers@curastem.org).

---

## What this does

- Ingests open job postings from public ATS sources (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) every hour via a Cloudflare Cron Trigger
- Normalizes raw job data into a single canonical schema (title, location, employment type, workplace type, salary, etc.)
- Preserves the original raw description text for AI reprocessing
- Enriches company records with logo, website, LinkedIn URL, and AI-generated description (lazily, cached)
- Extracts structured job fields (responsibilities, qualifications, summary) using Gemini 2.0 Flash-Lite on first request, then caches them
- Serves jobs through a paginated REST API with API key auth and rate limiting
- Deduplicates jobs across sources, preferring direct ATS sources over aggregators

---

## Architecture

```
Ingestion (hourly cron)
  Source Registry → per-source Fetcher → normalize → upsert companies → dedup check → upsert jobs

Enrichment (after ingestion)
  listUnenrichedCompanies → Clearbit logo → infer website/LinkedIn → Gemini description

API (per request)
  Auth middleware → Rate limiter → Route handler → D1 query → [lazy AI extraction] → JSON response
```

### Separation of concerns

| Concept | Table | Notes |
|---|---|---|
| Companies | `companies` | One row per unique employer. Enriched separately from job ingestion. |
| Jobs | `jobs` | One row per source+external_id. Linked to a company. |
| Sources | `sources` | One row per ATS board. Drives ingestion. Add new sources here. |
| API Keys | `api_keys` | SHA-256 hash only. No plaintext keys stored. |

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

| Field | Description |
|---|---|
| `total_jobs` | Total indexed jobs |
| `jobs_last_24h` | Jobs first seen in last 24 hours |
| `jobs_last_7d` | Jobs first seen in last 7 days |
| `jobs_last_30d` | Jobs first seen in last 30 days |
| `by_employment_type` | Array of `{ employment_type, count }` |
| `by_workplace_type` | Array of `{ workplace_type, count }` |
| `top_companies` | Top 10 companies by open role count |
| `total_companies` | Total unique companies indexed |
| `total_sources` | Active ingestion sources |

---

### `GET /jobs`

Returns a paginated list of jobs.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search jobs by title or company name |
| `location` | string | Filter by location (partial match) |
| `employment_type` | string | `full_time` \| `part_time` \| `contract` \| `internship` \| `temporary` |
| `workplace_type` | string | `remote` \| `hybrid` \| `on_site` |
| `company` | string | Filter by company slug (e.g. `stripe`) |
| `limit` | number | Results per page. Default 20, max 50. |
| `cursor` | string | Opaque cursor from a previous response's `meta.next_cursor` |

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

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable Curastem job ID |
| `title` | string | Job title |
| `company` | object | See company schema below |
| `posted_at` | string | ISO 8601. Best-available posting time (falls back to first_seen_at if source did not provide one) |
| `apply_url` | string | Direct application URL |
| `location` | string \| null | Location string from source |
| `employment_type` | string \| null | `full_time` \| `part_time` \| `contract` \| `internship` \| `temporary` |
| `workplace_type` | string \| null | `remote` \| `hybrid` \| `on_site` |
| `source_name` | string | Which ATS source this came from |
| `source_url` | string \| null | Job listing URL on the ATS board |

**Optional fields**

| Field | Type | Description |
|---|---|---|
| `salary` | object \| null | `{ min, max, currency, period }` — only present when source provides it |
| `job_summary` | string \| null | Two-sentence AI summary (company + role). Populated on detail endpoint. |
| `job_description` | object \| null | Structured extraction. Populated on detail endpoint. |

**`job_description` structure**

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

| Field | Required | Description |
|---|---|---|
| `name` | yes | Company name |
| `logo_url` | no | Company logo image URL |
| `description` | no | One-sentence company description (AI-generated from job context) |
| `website_url` | no | Company website |
| `linkedin_url` | no | LinkedIn company page |
| `glassdoor_url` | no | Glassdoor company page |
| `x_url` | no | X (formerly Twitter) profile |

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

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid query parameter |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 404 | `NOT_FOUND` | Job not found |
| 429 | `RATE_LIMITED` | Rate limit exceeded (default: 60 req/min per key) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Ingestion sources

Jobs are ingested hourly from public ATS boards. Each source is a row in the `sources` table. Adding a new source means inserting a new row — no code changes required for supported ATS types.

### Supported ATS types

| Source type | How it works | Auth required |
|---|---|---|
| `greenhouse` | `GET boards-api.greenhouse.io/v1/boards/{handle}/jobs?content=true` | None — fully public |
| `lever` | `GET api.lever.co/v0/postings/{handle}?mode=json` | None — fully public |
| `ashby` | `GET jobs.ashbyhq.com/api/non-authenticated-open-application/...` | None — fully public |
| `workday` | `POST {tenant}.myworkdayjobs.com/wday/cxs/{company}/{board}/jobs` | None — public board endpoint |
| `smartrecruiters` | `GET api.smartrecruiters.com/v1/companies/{handle}/postings` | None — fully public |

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
2. Create a new fetcher in `src/ingestion/sources/`.
3. Register it in `src/ingestion/registry.ts`.
4. Insert source rows into the `sources` table.

---

## Deduplication

Two levels:

1. **Exact match** — same `source_id` + `external_id` = update in place. No duplicate.
2. **Cross-source match** — same normalized title + company slug across different sources. The higher-priority source wins (Greenhouse/Lever/Ashby > Workday > SmartRecruiters).

---

## Observability

The ingestion cron logs structured JSON to Cloudflare Workers Logs after each source and after each full run. Log events:

| Event | When |
|---|---|
| `ingestion_started` | Cron begins |
| `ingestion_sources_loaded` | Source list fetched from DB |
| `ingestion_source_started` | Processing begins for each source |
| `ingestion_result` | Per-source: fetched/inserted/updated/skipped/dedup/failed counts |
| `ingestion_summary` | Aggregate totals across all sources |
| `company_enrichment_started` | Company enrichment pass begins |
| `company_enriched` | One company successfully enriched |
| `company_enrichment_completed` | Enrichment pass finished |

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

This service is designed to operate at near-zero cost on Cloudflare's free and Workers Paid tiers.

| Component | Cost |
|---|---|
| Cloudflare Workers | Free tier: 100k req/day. Paid: $0.30/million |
| Cloudflare D1 | Free tier: 5M rows read/day, 100k writes/day |
| Cloudflare KV | Free tier: 100k reads/day, 1k writes/day |
| Gemini 2.5 Flash-Lite Preview | Cheapest available Gemini model. Only triggered on first detail view per job. |
| Clearbit logo CDN | Free, public CDN |

The hourly cron writes are the primary D1 cost. For ~1,000 job upserts per hour, that is well within the free tier.
