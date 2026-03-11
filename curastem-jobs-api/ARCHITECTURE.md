# Architecture — curastem-jobs-api

This document explains the internal design of the Curastem Jobs API. It is the primary reference for contributors and is intended to answer the question: *"Why is the code structured this way?"*

---

## Mental model

The system has five distinct responsibilities. Understanding the boundary between them is the most important thing to know about the codebase.

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. INGESTION                                                        │
│     Fetch raw job data from public ATS sources (Greenhouse, Lever,  │
│     Ashby, Workday, SmartRecruiters). Normalize it. Write to D1.    │
│     Runs on a 1-hour cron schedule. Isolated from the API path.     │
└────────────────────────────┬────────────────────────────────────────┘
                             │ writes
┌────────────────────────────▼────────────────────────────────────────┐
│  2. DATABASE (D1)                                                    │
│     Four tables: companies, sources, jobs, api_keys.                │
│     companies and jobs are separate. One company → many jobs.       │
│     All timestamps are Unix epoch seconds. description_raw is       │
│     immutable once stored (never overwritten on re-ingestion).      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ reads + writes
┌────────────────────────────▼────────────────────────────────────────┐
│  3. ENRICHMENT                                                       │
│     Company metadata (logo, website, LinkedIn) is populated         │
│     separately from job ingestion. AI descriptions are generated    │
│     using Gemini 2.5 Flash-Lite Preview and cached in D1.           │
│     Enrichment runs after each ingestion pass (async).              │
└────────────────────────────┬────────────────────────────────────────┘
                             │ reads
┌────────────────────────────▼────────────────────────────────────────┐
│  4. REST API                                                         │
│     GET /jobs, GET /jobs/:id, GET /stats.                           │
│     Auth (API key) and rate limiting run on every request.          │
│     AI fields are generated lazily on /jobs/:id and cached.         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ calls
┌────────────────────────────▼────────────────────────────────────────┐
│  5. MCP LAYER (separate project: curastem-jobs-mcp)                 │
│     Wraps the REST API for LLM agent use. No direct DB access.      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why companies and jobs are separate tables

One company may have dozens or hundreds of open jobs. If company metadata (logo, website, LinkedIn, description) were stored per-job row, we would:

- Repeat the same data thousands of times in the database
- Have to run enrichment once per job instead of once per company
- Waste Gemini tokens generating the same company description repeatedly

Storing companies separately means enrichment runs once per company and every job query gets the latest company metadata automatically via a JOIN.

The public API still returns a nested `company` object inside each job response — this is intentional. The separation is internal; the API consumer should not need to know about it.

---

## Why description_raw is never overwritten

When a job is re-ingested (same `source_id` + `external_id`), we update most fields (title, location, apply_url, etc.) but we do **not** replace `description_raw` unless the incoming description is actually different.

If the description did change, we null out `ai_generated_at`. This forces AI re-extraction on the next `GET /jobs/:id` request, which regenerates `job_summary` and `job_description` from the updated source text.

This design means:
- We never lose the original source text
- AI extraction is always based on current source truth
- We never spend Gemini tokens re-generating identical content

---

## Source registry pattern

Every ingestion source is a row in the `sources` table. The `source_type` column maps to a fetcher in `src/ingestion/registry.ts`.

Adding support for a new ATS type requires:
1. Adding the type to `SourceType` in `src/types.ts`
2. Creating a fetcher in `src/ingestion/sources/`
3. Registering it in `src/ingestion/registry.ts`
4. Inserting source rows into the `sources` table

Adding a new company on an existing ATS requires only a DB row — no code changes.

This separation between "what ATS type" (code) and "which company" (data) is intentional and important for scalability.

---

## Two-level deduplication

**Level 1 — exact match:** The `UNIQUE(source_id, external_id)` index prevents duplicate rows for the same job on the same source. Re-ingesting an existing job triggers an UPDATE.

**Level 2 — cross-source match:** The `dedup_key` column (`lower(title) + "|" + company_slug`) catches the same job appearing on multiple ATS platforms. When a duplicate is detected, the lower-priority source is skipped. Priority is defined in `src/ingestion/registry.ts`.

Source priority (higher = more trusted):
- Greenhouse, Lever, Ashby: 100 (direct employer ATS)
- Workday: 80
- SmartRecruiters: 70

---

## Lazy AI extraction

AI fields (`job_summary`, `job_description`, `company.description`) are **not** generated during ingestion. They are generated on-demand when a client calls `GET /jobs/:id` and the field is null.

Rationale:
- Most ingested jobs will never be requested individually. Pre-generating AI fields for all of them wastes Gemini tokens.
- The `GET /jobs` list endpoint is fast because it never calls Gemini.
- Once generated, results are cached in D1. Subsequent requests for the same job return instantly.

The generation and caching happen inside the request handler using `ctx.waitUntil()`, which means the response is returned to the client immediately while the cache write happens in the background.

---

## Cursor-based pagination

The `GET /jobs` endpoint uses keyset (cursor) pagination rather than page-number pagination. The cursor encodes `(posted_at, id)` as a Base64 string.

Why keyset pagination?
- New jobs are inserted constantly. Page-number pagination would skip or repeat rows as new jobs arrive.
- Keyset pagination is stable: each page continues exactly where the last one ended.
- It does not require a COUNT query on every page (though we still provide `meta.total` from a separate query for UX purposes).

---

## File layout reference

```
src/
├── index.ts              Entry point. Route dispatch + scheduled cron handler.
├── types.ts              All TypeScript interfaces. Read this first.
│
├── db/
│   ├── queries.ts        ALL database access. No raw SQL outside this file.
│   └── migrate.ts        Schema seed. Run once to populate initial sources.
│
├── middleware/
│   ├── auth.ts           API key validation (SHA-256 hash lookup).
│   └── rateLimit.ts      KV-backed fixed-window rate limiter.
│
├── routes/
│   ├── jobs.ts           GET /jobs handler.
│   ├── job.ts            GET /jobs/:id handler (with lazy AI enrichment).
│   └── stats.ts          GET /stats handler (market overview).
│
├── ingestion/
│   ├── registry.ts       Maps source_type → fetcher + priority.
│   ├── runner.ts         Hourly cron: iterates sources, calls fetchers, logs results.
│   ├── dedup.ts          Cross-source duplicate detection.
│   └── sources/          One file per ATS type. Each implements JobSource interface.
│       ├── greenhouse.ts
│       ├── lever.ts
│       ├── ashby.ts
│       ├── workday.ts
│       └── smartrecruiters.ts
│
├── enrichment/
│   ├── ai.ts             Gemini API calls. Used by job detail route + company enrichment.
│   └── company.ts        Async company enrichment pass (logo, website, AI description).
│
└── utils/
    ├── normalize.ts      Slug, dedup key, salary parsing, HTML stripping, ID generation.
    ├── errors.ts         Consistent { error: { code, message } } JSON error helpers.
    └── logger.ts         Structured JSON log lines (piped to Cloudflare Workers Logs).
```

---

## Key invariants to preserve

1. **`description_raw` is append-only.** Never overwrite it without also nulling `ai_generated_at`.
2. **No SQL outside `src/db/queries.ts`.** Raw queries in route handlers or ingestion code make the codebase impossible to audit.
3. **No network calls outside source fetchers and enrichment modules.** The route handlers must never make outbound HTTP requests directly.
4. **AI generation is always lazy and cached.** Never call Gemini during ingestion.
5. **Ingestion failures are isolated per-source.** One bad source must never fail the entire cron run.

---

## Adding a new endpoint

1. Create `src/routes/yourEndpoint.ts` implementing the handler function.
2. Import and register the route in `src/index.ts`.
3. Add any new query functions to `src/db/queries.ts`.
4. Document the new endpoint in `README.md`.
