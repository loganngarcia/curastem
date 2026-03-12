/**
 * GET /jobs — paginated job listing endpoint.
 *
 * Supports filtering by:
 *   q               — semantic search (uses Vectorize when available; falls back to SQL LIKE)
 *   location        — partial match on location string
 *   employment_type — exact match: full_time | part_time | contract | internship | temporary
 *   workplace_type  — exact match: remote | hybrid | on_site
 *   company         — exact match on company slug
 *   limit           — max results per page (default 20, max 50)
 *   cursor          — opaque cursor for pagination
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TWO SEARCH PATHS
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Vector path (when q= is present AND Vectorize is configured):
 *   1. Embed the query via Gemini Embedding API (RETRIEVAL_QUERY task type).
 *   2. Query Vectorize for the top VECTOR_CANDIDATES most similar job IDs.
 *   3. Hydrate those jobs from D1 with any remaining filters (location, type, etc.).
 *   4. Results are ordered by semantic similarity score — the best match first.
 *   5. Cursor encodes a vector-mode offset ("vs:N") for pagination.
 *
 * SQL path (when q= is absent OR vector search is unavailable):
 *   Standard keyset cursor pagination against D1. Cursor encodes (posted_at, id).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CURSOR DESIGN
 * ──────────────────────────────────────────────────────────────────────────
 * Regular cursor: base64url(timestamp:id)    — stable even as new jobs arrive
 * Vector cursor:  base64url("vs:" + offset)  — offset into the vector result set
 *
 * Clients do not need to distinguish between these formats.
 */

import { listJobs, listJobsByIds, type ListJobsRow } from "../db/queries.ts";
import { embedQuery, formatSalaryDisplay } from "../enrichment/ai.ts";
import type { Env, PublicJob, PublicSalary } from "../types.ts";
import { jsonOk } from "../utils/errors.ts";
import { authenticate, recordKeyUsage } from "../middleware/auth.ts";
import { checkRateLimit } from "../middleware/rateLimit.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// D1 limits bound parameters per statement to ~100. The IN() clause uses one
// bind slot per ID, so we keep topK at 100 to stay safely within that limit.
// listJobsByIds also chunks queries if needed for future safety.
const VECTOR_CANDIDATES = 100;

// Cache Gemini query embeddings in KV for 5 minutes.
// A 768-float vector is ~3 KB. Popular searches ("product manager", "engineer")
// would otherwise trigger a Gemini API call + ~200ms latency on every request.
const EMBED_CACHE_TTL_SECONDS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildRegularCursor(rows: ListJobsRow[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  const ts = last.posted_at ?? last.first_seen_at;
  return btoa(`${ts}:${last.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildVectorCursor(currentOffset: number, pageSize: number, totalFiltered: number): string | null {
  const nextOffset = currentOffset + pageSize;
  if (nextOffset >= totalFiltered) return null;
  return btoa(`vs:${nextOffset}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function decodeVectorCursor(cursor: string): number | null {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded);
    if (!decoded.startsWith("vs:")) return null;
    const offset = parseInt(decoded.slice(3), 10);
    return isNaN(offset) ? null : offset;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row → public shape
// ─────────────────────────────────────────────────────────────────────────────

export function rowToPublicJob(row: ListJobsRow): PublicJob {
  const bestPostedAt = row.posted_at ?? row.first_seen_at;
  const postedAtIso = new Date(bestPostedAt * 1000).toISOString();

  let salary: PublicSalary | null = null;
  if (row.salary_min !== null && row.salary_period) {
    salary = {
      min: row.salary_min,
      max: row.salary_max,
      currency: row.salary_currency ?? "USD",
      period: row.salary_period,
      display: formatSalaryDisplay(row.salary_min, row.salary_period as "year" | "month" | "hour"),
    };
  }

  return {
    id: row.id,
    title: row.title,
    posted_at: postedAtIso,
    apply_url: row.apply_url,
    location: row.location,
    employment_type: row.employment_type,
    workplace_type: row.workplace_type,
    source_name: row.source_name,
    source_url: row.source_url,
    salary,
    // List endpoint omits heavy AI fields for performance;
    // they are populated on the detail endpoint (GET /jobs/:id)
    job_summary: row.job_summary,
    job_description: null,
    company: {
      name: row.company_name,
      logo_url: row.company_logo_url,
      description: row.company_description,
      website_url: row.company_website_url,
      linkedin_url: row.company_linkedin_url,
      glassdoor_url: row.company_glassdoor_url,
      x_url: row.company_x_url,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleListJobs(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const auth = await authenticate(request, env.JOBS_DB);
  if (!auth.ok) return auth.response;

  const rateCheck = await checkRateLimit(env.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;

  recordKeyUsage(env.JOBS_DB, auth.key.id, ctx);

  const url = new URL(request.url);
  const params = url.searchParams;

  const limitRaw = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? DEFAULT_LIMIT : Math.min(limitRaw, MAX_LIMIT);

  const q = params.get("q") ?? undefined;
  const location = params.get("location") ?? undefined;
  const employment_type = params.get("employment_type") ?? undefined;
  const workplace_type = params.get("workplace_type") ?? undefined;
  const company = params.get("company") ?? undefined;
  const cursor = params.get("cursor") ?? undefined;
  const sinceRaw = params.get("since");
  const posted_since = sinceRaw ? parseInt(sinceRaw, 10) || undefined : undefined;

  // ── Vector search path ─────────────────────────────────────────────────────
  // Use Vectorize when a query is provided and the binding is configured.
  // Wrapped in try-catch so any Gemini/Vectorize failure falls through to SQL.
  if (q && env.JOBS_VECTORS && env.GEMINI_API_KEY) {
    try {
      // Determine offset for paginated vector results
      const vectorOffset = cursor ? (decodeVectorCursor(cursor) ?? 0) : 0;

      // Embed the search query — check KV cache first to avoid a Gemini round-trip
      // (~200ms) for repeated or popular queries. The embedding itself is stable
      // for a given query string, so a 5-minute TTL is safe and meaningful.
      let queryVector: number[];
      const embedCacheKey = `qembed:${q.toLowerCase().trim()}`;
      const cachedEmbed = await env.RATE_LIMIT_KV.get(embedCacheKey);
      if (cachedEmbed) {
        queryVector = JSON.parse(cachedEmbed) as number[];
      } else {
        queryVector = await embedQuery(env.GEMINI_API_KEY, q);
        ctx.waitUntil(
          env.RATE_LIMIT_KV.put(embedCacheKey, JSON.stringify(queryVector), {
            expirationTtl: EMBED_CACHE_TTL_SECONDS,
          })
        );
      }

      const vectorResults = await env.JOBS_VECTORS.query(queryVector, {
        topK: VECTOR_CANDIDATES,
        returnMetadata: "none",
      });

      // Extract job IDs in descending similarity order
      const rankedIds = vectorResults.matches.map((m) => m.id);

      // If Vectorize returned no candidates the index is likely empty (no embeddings
      // generated yet). Fall through to the SQL LIKE search below rather than
      // returning an empty result set, which would be confusing to callers.
      if (rankedIds.length > 0) {
        // Hydrate from D1, applying secondary filters (location, type, company, recency)
        const filteredRows = await listJobsByIds(env.JOBS_DB, rankedIds, {
          location,
          employment_type,
          workplace_type,
          company,
          posted_since,
        });

        // If posted_since filtered out ALL vector results, fall through to the SQL
        // LIKE path which can find recent jobs by title text match.
        if (!(filteredRows.length === 0 && vectorOffset === 0 && posted_since)) {
          // Paginate within the filtered similarity-ranked result set
          const page = filteredRows.slice(vectorOffset, vectorOffset + limit);
          const nextCursor = buildVectorCursor(vectorOffset, page.length, filteredRows.length);

          return jsonOk({
            data: page.map(rowToPublicJob),
            meta: {
              total: filteredRows.length,
              limit,
              next_cursor: nextCursor,
            },
          });
        }
      }
      // else: Vectorize index is empty OR all vector results were filtered by recency
      // — fall through to SQL LIKE below
    } catch {
      // Gemini or Vectorize unavailable — degrade gracefully to SQL LIKE search
    }
  }

  // ── SQL fallback path ──────────────────────────────────────────────────────
  // Standard keyset pagination used when q= is absent or Vectorize is not set up.
  const { rows, total } = await listJobs(env.JOBS_DB, {
    q,
    location,
    employment_type,
    workplace_type,
    company,
    posted_since,
    limit,
    cursor,
  });

  const data = rows.map(rowToPublicJob);
  const nextCursor = buildRegularCursor(rows, limit);

  return jsonOk({
    data,
    meta: {
      // total is null on cursor pages — it was already returned on page 1
      // and re-counting on every paginated request is unnecessarily expensive.
      total,
      limit,
      next_cursor: nextCursor,
    },
  });
}
