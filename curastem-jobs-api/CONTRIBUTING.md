# Contributing — curastem-jobs-api

Thank you for contributing to Curastem Jobs. This guide explains how to set up the project, where to make changes, and what standards to follow.

---

## Before you start

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first. Understanding why the code is structured the way it is will save you significant time and prevent changes that unintentionally violate key invariants.

---

## Development setup

### Prerequisites

- Node.js 18+
- A Cloudflare account (free tier works)

### Install dependencies

```bash
cd curastem-jobs-api
npm install
```

### Create the D1 database (first time only)

```bash
npx wrangler d1 create curastem-jobs
```

Copy the `database_id` from the output into `wrangler.jsonc`.

### Create the KV namespace (first time only)

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Copy the `id` and `preview_id` into `wrangler.jsonc`.

### Apply the schema locally

```bash
npm run db:migrate
```

### Create a local `.dev.vars` file (gitignored)

```
GEMINI_API_KEY=your_gemini_api_key_here
```

### Create a local test API key

```bash
npx wrangler d1 execute curastem-jobs --local --command \
  "INSERT INTO api_keys (id, key_hash, owner_email, description, active, created_at)
   VALUES ('local-test', 'put_sha256_of_your_test_key_here', 'dev@curastem.org', 'Local dev', 1, unixepoch())"
```

To compute the SHA-256 of a test key:
```bash
echo -n "your-test-key" | shasum -a 256
```

### Start the local dev server

```bash
npm run dev
```

### Test a request

```bash
curl http://localhost:8787/jobs \
  -H "Authorization: Bearer your-test-key"
```

---

## Making changes

### Adding a new ingestion source

See [ARCHITECTURE.md — Source registry pattern](./ARCHITECTURE.md#source-registry-pattern).

1. Add the new `SourceType` to `src/types.ts`.
2. Create `src/ingestion/sources/yourSource.ts` implementing the `JobSource` interface.
3. Register it in `src/ingestion/registry.ts`.
4. Add seed rows in `src/db/migrate.ts` and/or insert directly into the DB.
5. Test locally by triggering the cron: `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`

### Adding a new API endpoint

1. Create `src/routes/yourEndpoint.ts` with a handler function.
2. Add any new queries to `src/db/queries.ts`.
3. Register the route in `src/index.ts`.
4. Document it in `README.md`.

### Modifying the database schema

1. Update `schema.sql` with the new or changed table/column.
2. Apply locally: `npm run db:migrate`.
3. Document the change — add a comment in `schema.sql` explaining why.
4. Apply to production before deploying the Worker: `npm run db:migrate:remote`.

---

## Code standards

### TypeScript

- Avoid `any`. Use `unknown` for untrusted external data and narrow it explicitly.
- All public functions must have TypeScript signatures. Do not rely on inference for exported symbols.
- `exactOptionalPropertyTypes` is not enforced but write optional properties as `?: T | undefined` for clarity.

### Comments

Comments should explain **why**, not **what**. The code explains what.

```typescript
// Bad: increment the counter
count++;

// Good: We skip deduplication for equal-priority sources because
// they may be legitimately different postings at different locations.
if (existingPriority === incomingPriority) return false;
```

Do not leave `TODO` comments in merged code unless they are tracked issues.

### SQL

All SQL belongs in `src/db/queries.ts`. No raw SQL in route handlers, ingestion, or enrichment code.

### Error handling in ingestion

Ingestion functions must not throw for individual record failures. Catch errors per-record, log them, and continue:

```typescript
for (const item of items) {
  try {
    // process item
  } catch {
    result.failed++;
    continue;
  }
}
```

### Logging

Use the structured logger in `src/utils/logger.ts`. Do not use `console.log` directly. Log entries are JSON objects that can be filtered and aggregated in Cloudflare Workers Logs.

---

## Testing

There is no automated test suite yet. Testing is done locally using `wrangler dev` and `curl`. When adding a non-trivial change:

1. Test the happy path.
2. Test the error path (missing auth, invalid params, source returning 500).
3. Test that ingestion re-runs are idempotent (running twice does not duplicate jobs).

---

## Pull request checklist

Before submitting:

- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `npx wrangler deploy --dry-run` succeeds
- [ ] No SQL outside `src/db/queries.ts`
- [ ] No hardcoded company names in source files (they belong in DB rows or `migrate.ts`)
- [ ] New fields in the public API response are documented in `README.md`
- [ ] Schema changes are in `schema.sql` with a descriptive comment
- [ ] Commit message is in Chinese (project convention) and describes the "why"
