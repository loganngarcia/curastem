/**
 * GET /jobs — paginated job listing endpoint.
 *
 * Supports filtering by:
 *   q               — semantic search (Vectorize + SQL); title-only matching also considers company slug
 *   title           — substring match on job title only (no company slug, no Vectorize). Prefer for role searches.
 *   location        — partial match on location string
 *   location_region — AND with location (e.g. "CA" disambiguates San Francisco, CA from Philippines)
 *   location_or     — comma-separated; match if location contains ANY term (e.g. Bay Area cities)
 *   exclude_ids     — comma-separated job IDs to exclude (e.g. already shown on homepage)
 *   near_lat        — latitude for distance-based "jobs near you" (with near_lng, radius_km)
 *   near_lng        — longitude
 *   radius_km       — max distance in km (default 50)
 *   exclude_remote  — when using near_*, exclude remote-only jobs (default true)
 *   employment_type — exact match: full_time | part_time | contract | internship | temporary
 *   workplace_type  — exact match: remote | hybrid | on_site
 *   seniority_level      — exact match: new_grad | entry | mid | senior | staff | manager | director | executive
 *   description_language — exact match: ISO 639-1 code, e.g. en | es | de | fr | pt | it | nl | pl | ja | zh
 *   company              — exact match on company slug(s); comma-separated = OR (e.g. meta,google,apple)
 *   since           — optional unix timestamp; only jobs posted/seen at or after this time. Omit for all matching rows ordered by recency (newest first).
 *   salary_min      — only jobs where salary_min >= this value (annual, in job's currency)
 *   visa_sponsorship — yes | no; only jobs where AI extraction recorded that value
 *   exclude_ids     — comma-separated job IDs to omit (e.g. already shown in UI)
 *   near_lat, near_lng, radius_km — distance search (km); requires geocoded jobs; optional exclude_remote=false to include remote
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
 *   Keyset pagination; q matches j.title (LIKE) or exact c.slug — not c.name substring.
 *
 * Vector path: after hydration, rows must match every significant token in **one** comma-
 * separated phrase of q in j.title (OR across phrases) so employer names cannot satisfy
 * the search and multi-role profiles still return relevant jobs.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CURSOR DESIGN
 * ──────────────────────────────────────────────────────────────────────────
 * Regular cursor: base64url(timestamp:id)    — stable even as new jobs arrive
 * Vector cursor:  base64url("vs:" + offset)  — offset into the vector result set
 *
 * Clients do not need to distinguish between these formats.
 */

import {
  listJobs,
  listJobsByIds,
  listJobsNear,
  findCompanyByQuery,
  shouldResolveSearchQueryToCompany,
  type ListJobsRow,
} from "../db/queries.ts";
import { enrichLocationsWithCountry } from "../utils/locationsDisplay.ts";
import {
  jobTitleMatchesCommaSeparatedQuery,
  MAX_JOB_SEARCH_PHRASES,
  normalizeJobSearchQuery,
} from "../utils/jobSearchQuery.ts";
import { buildPublicSalary, embedQuery } from "../enrichment/ai.ts";
import type { Env, PublicJob } from "../types.ts";
import { jsonOk } from "../utils/errors.ts";
import { authenticate, recordKeyUsage } from "../middleware/auth.ts";
import { checkRateLimit } from "../middleware/rateLimit.ts";
import { logger } from "../utils/logger.ts";
import {
  JOBS_LIST_CACHE_VERSION,
  JOBS_LIST_CACHE_HDR,
  JOBS_LIST_CACHE_MAX_AGE_SECONDS,
  buildJobsListCacheKeySearchString,
  isJobsListRequestCacheable,
  jobsListCacheKeyRequest,
} from "../utils/jobsListCache.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// D1 limits bound parameters per statement to ~100. The IN() clause uses one
// bind slot per ID, so we keep topK at 100 to stay safely within that limit.
// listJobsByIds also chunks queries if needed for future safety.
const VECTOR_CANDIDATES = 100;

function hashCacheKeyFingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

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

/** Distance-sorted GET /jobs?near_* pagination — OFFSET into Haversine ORDER BY. */
function decodeNearListingCursor(cursor: string): number | null {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded);
    if (!decoded.startsWith("nr:")) return null;
    const offset = parseInt(decoded.slice(3), 10);
    return isNaN(offset) || offset < 0 ? null : offset;
  } catch {
    return null;
  }
}

function buildNearListingCursor(currentOffset: number, pageSize: number, rowsReturned: number): string | null {
  if (rowsReturned < pageSize) return null;
  const nextOffset = currentOffset + pageSize;
  return btoa(`nr:${nextOffset}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Row → public shape
// ─────────────────────────────────────────────────────────────────────────────

export function rowToPublicJob(row: ListJobsRow): PublicJob {
  const bestPostedAt = row.posted_at ?? row.first_seen_at;
  const postedAtIso = new Date(bestPostedAt * 1000).toISOString();

  const salary = buildPublicSalary(row);

  let locations: string[] | null = null;
  if (row.locations) {
    try {
      locations = JSON.parse(row.locations) as string[];
    } catch {
      // Malformed JSON — treat as no location
    }
  }
  locations = enrichLocationsWithCountry(locations, row.job_country ?? null);

  let companyLocations: string[] | null = null;
  if (row.company_locations) {
    try {
      companyLocations = JSON.parse(row.company_locations) as string[];
    } catch {
      // Malformed JSON — treat as none
    }
  }

  return {
    id: row.id,
    title: row.title,
    posted_at: postedAtIso,
    apply_url: row.apply_url,
    locations,
    employment_type: row.employment_type,
    workplace_type: row.workplace_type,
    seniority_level: row.seniority_level ?? null,
    description_language: row.description_language ?? null,
    source_name: row.source_name,
    source_url: row.source_url,
    salary,
    // List endpoint omits heavy AI fields for performance;
    // they are populated on the detail endpoint (GET /jobs/:id)
    job_summary: row.job_summary,
    job_description: null,
    visa_sponsorship: row.visa_sponsorship ?? null,
    experience_years_min: row.experience_years_min ?? null,
    job_address: row.job_address ?? null,
    job_city: row.job_city ?? null,
    job_state: row.job_state ?? null,
    job_country: row.job_country ?? null,
    location_lat: row.location_lat ?? null,
    location_lng: row.location_lng ?? null,
    company: {
      name: row.company_name,
      logo_url: row.company_logo_url,
      description: row.company_description,
      website_url: row.company_website_url,
      linkedin_url: row.company_linkedin_url,
      glassdoor_url: row.company_glassdoor_url,
      x_url: row.company_x_url,
      instagram_url: row.company_instagram_url,
      youtube_url: row.company_youtube_url,
      github_url: row.company_github_url,
      huggingface_url: row.company_huggingface_url,
      tiktok_url: row.company_tiktok_url,
      crunchbase_url: row.company_crunchbase_url,
      facebook_url: row.company_facebook_url,
      employee_count_range: row.company_employee_count_range,
      employee_count: row.company_employee_count ?? null,
      founded_year: row.company_founded_year,
      headquarters: (row.company_hq_address || row.company_hq_city || row.company_hq_country)
        ? {
            address: row.company_hq_address,
            city: row.company_hq_city,
            country: row.company_hq_country,
            lat: row.company_hq_lat ?? null,
            lng: row.company_hq_lng ?? null,
          }
        : null,
      industry: row.company_industry,
      company_type: row.company_type,
      total_funding_usd: row.company_total_funding_usd,
      locations: companyLocations,
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
  const requestStartMs = Date.now();
  const cacheable = isJobsListRequestCacheable(params);
  const cacheKeySearchString = cacheable ? buildJobsListCacheKeySearchString(params) : "";
  const cacheKeyReq = cacheable
    ? jobsListCacheKeyRequest(request.url, new URLSearchParams(cacheKeySearchString))
    : null;
  const cacheKeyFingerprint = cacheable ? hashCacheKeyFingerprint(cacheKeySearchString) : null;

  // ── Cloudflare edge cache (free, per-colo) ─────────────────────────────────
  if (cacheKeyReq) {
    const cached = await caches.default.match(cacheKeyReq);
    if (cached) {
      const h = new Headers(cached.headers);
      h.set("Access-Control-Allow-Origin", "*");
      h.set(JOBS_LIST_CACHE_HDR, "HIT");
      h.set("X-Curastem-Jobs-Cache-Hash", String(cacheKeyFingerprint));
      h.set("X-Curastem-Jobs-Cache-Path", "cache");
      h.set("Access-Control-Expose-Headers", `${JOBS_LIST_CACHE_HDR}, X-Curastem-Jobs-Cache-Hash, X-Curastem-Jobs-Cache-Path`);
      const elapsedMs = Date.now() - requestStartMs;
      logger.info("jobs_list_request", {
        route: "/jobs",
        cache_status: "HIT",
        cache_key_version: JOBS_LIST_CACHE_VERSION,
        cache_key_hash: cacheKeyFingerprint,
        cursor: params.get("cursor") ?? null,
        has_near: params.has("near_lat") && params.has("near_lng"),
        has_exclude_ids: params.has("exclude_ids"),
        has_q: params.has("q"),
        has_title: params.has("title"),
        cache_path: "cache",
        duration_ms: elapsedMs,
      });
      return new Response(cached.body, { status: cached.status, headers: h });
    }
  }

  const finalize = (
    resp: Response,
    path: "near" | "vector" | "sql",
    rowCount: number,
    nextCursor: string | null
  ): Response => {
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.set(JOBS_LIST_CACHE_HDR, "MISS");
    resp.headers.set("X-Curastem-Jobs-Cache-Hash", String(cacheKeyFingerprint));
    resp.headers.set("X-Curastem-Jobs-Cache-Path", path);
    resp.headers.set(
      "Access-Control-Expose-Headers",
      `${JOBS_LIST_CACHE_HDR}, X-Curastem-Jobs-Cache-Hash, X-Curastem-Jobs-Cache-Path`
    );
    if (cacheKeyReq && resp.status === 200) {
      resp.headers.set(
        "Cache-Control",
        `public, max-age=${JOBS_LIST_CACHE_MAX_AGE_SECONDS}`
      );
      resp.headers.set("X-Curastem-Jobs-Cache-Generated", `${Date.now() - requestStartMs}ms`);
      // Clone before the body is consumed by the client — caches.default.put
      // needs its own readable stream.
      ctx.waitUntil(caches.default.put(cacheKeyReq, resp.clone()));
    }
    logger.info("jobs_list_request", {
      route: "/jobs",
      cache_status: "MISS",
      cache_key_version: JOBS_LIST_CACHE_VERSION,
      cache_key_hash: cacheKeyFingerprint,
      cache_path: path,
      cursor: params.get("cursor") ?? null,
      has_near: params.has("near_lat") && params.has("near_lng"),
      has_exclude_ids: params.has("exclude_ids"),
      has_q: params.has("q"),
      has_title: params.has("title"),
      row_count: rowCount,
      next_cursor: nextCursor,
      duration_ms: Date.now() - requestStartMs,
    });
    return resp;
  };

  const limitRaw = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? DEFAULT_LIMIT : Math.min(limitRaw, MAX_LIMIT);

  const q = params.get("q") ?? undefined;
  const titleRaw = params.get("title") ?? undefined;
  const location = params.get("location") ?? undefined;
  const location_region = params.get("location_region") ?? undefined;
  const location_orRaw = params.get("location_or") ?? undefined;
  const location_or =
    location_orRaw?.split(",").map((t) => t.trim()).filter(Boolean) ?? undefined;
  const exclude_idsRaw = params.get("exclude_ids") ?? undefined;
  const exclude_ids =
    exclude_idsRaw?.split(",").map((t) => t.trim()).filter(Boolean) ?? undefined;
  const employment_type = params.get("employment_type") ?? undefined;
  const workplace_type = params.get("workplace_type") ?? undefined;
  const seniority_level = params.get("seniority_level") ?? undefined;
  const description_language = params.get("description_language") ?? undefined;
  let company = params.get("company") ?? undefined;
  const cursor = params.get("cursor") ?? undefined;
  const sinceRaw = params.get("since");
  const posted_since = sinceRaw ? parseInt(sinceRaw, 10) || undefined : undefined;
  const salaryMinRaw = params.get("salary_min");
  const salary_min = salaryMinRaw ? parseFloat(salaryMinRaw) || undefined : undefined;
  // ISO 3166-1 alpha-2 country code — restricts results to jobs in that country (or remote).
  const countryRaw = params.get("country");
  const country = countryRaw ? countryRaw.toUpperCase().slice(0, 2) : undefined;

  const visaRaw = params.get("visa_sponsorship");
  const visa_sponsorship =
    visaRaw === "yes" || visaRaw === "no" ? visaRaw : undefined;

  const nearLatRaw = params.get("near_lat");
  const nearLngRaw = params.get("near_lng");
  const nearLat = nearLatRaw ? parseFloat(nearLatRaw) : NaN;
  const nearLng = nearLngRaw ? parseFloat(nearLngRaw) : NaN;
  const radiusKmRaw = params.get("radius_km");
  const radius_km = radiusKmRaw ? parseFloat(radiusKmRaw) || 50 : 50;
  const exclude_remote = params.get("exclude_remote") !== "false";

  // ── Distance-based "jobs near you" path ────────────────────────────────────
  // When near_lat + near_lng are provided, return jobs ordered by distance (km).
  // Excludes remote-only jobs. Requires location_lat/lng to be populated (geocode backfill).
  const titleForSearch = titleRaw ? normalizeJobSearchQuery(titleRaw) : undefined;

  if (!isNaN(nearLat) && !isNaN(nearLng) && nearLat >= -90 && nearLat <= 90 && nearLng >= -180 && nearLng <= 180) {
    try {
      const nearOffset = cursor ? decodeNearListingCursor(cursor) ?? 0 : 0;
      const { rows } = await listJobsNear(env.JOBS_DB, {
        lat: nearLat,
        lng: nearLng,
        radius_km: Math.min(Math.max(radius_km, 1), 500),
        exclude_remote,
        limit,
        offset: nearOffset,
        exclude_ids,
        title: titleForSearch,
        q: titleForSearch ? undefined : q,
        posted_since,
        employment_type,
        workplace_type,
        seniority_level,
        description_language,
        salary_min,
        country,
        company: company || undefined,
        visa_sponsorship,
      });
      const nextNear = buildNearListingCursor(nearOffset, limit, rows.length);
      return finalize(jsonOk({
        data: rows.map(rowToPublicJob),
        meta: { total: rows.length, limit, next_cursor: nextNear },
      }), "near", rows.length, nextNear);
    } catch (err) {
      console.error("[listJobsNear] failed:", err instanceof Error ? err.message : String(err));
      // fall through to standard path
    }
  }

  // When q matches a company name/slug, use SQL path. Vector search only covers
  // embedded jobs; Alo Yoga has 0 embeddings, so "alo yoga" would return AbbVie
  // (semantically adjacent) instead. SQL path uses company filter and finds all jobs.
  //
  // Skip this check for short/generic queries (< 4 words, no spaces after 2nd word)
  // like "software engineer" or "data analyst" — they're almost never company names
  // and the extra D1 round-trip adds ~20ms of latency to every homepage load.
  let qForSearch: string | undefined = titleForSearch ? undefined : q;
  const qw = q?.trim() ?? "";
  const words = qw.split(/\s+/).filter(Boolean);
  const looksLikeCompanyQuery =
    !!q &&
    !titleForSearch &&
    !company &&
    ((words.length >= 2 && qw.length > 6) ||
      (words.length === 1 && qw.length >= 3 && qw.length <= 48));
  if (q && !company && !titleForSearch && looksLikeCompanyQuery && shouldResolveSearchQueryToCompany(q)) {
    const resolved = await findCompanyByQuery(env.JOBS_DB, q);
    if (resolved) {
      company = resolved.slug;
      qForSearch = undefined; // Return all jobs at company, not title-filtered
    }
  }
  if (qForSearch) {
    qForSearch = normalizeJobSearchQuery(qForSearch);
  }

  const qForVector = q && !company ? normalizeJobSearchQuery(q) : q;

  // ── Vector search path ─────────────────────────────────────────────────────
  // Use Vectorize when a query is provided and the binding is configured.
  // Skip when we resolved to a company — SQL path handles company queries.
  // Skip when title= is set — role searches use deterministic title LIKE only.
  // Wrapped in try-catch so any Gemini/Vectorize failure falls through to SQL.
  if (q && !titleForSearch && !company && env.JOBS_VECTORS && env.GEMINI_API_KEY) {
    try {
      // Determine offset for paginated vector results
      const vectorOffset = cursor ? (decodeVectorCursor(cursor) ?? 0) : 0;

      // Multi-title support: "software engineer, product manager" → embed each
      // title independently (parallel + individually KV-cached), then average
      // into a centroid vector. One Vectorize query covers all titles at once
      // without adding extra round-trips compared to a single-title search.
      const titles = (qForVector ?? q)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_JOB_SEARCH_PHRASES);

      const getEmbedding = async (title: string): Promise<number[]> => {
        const key = `qembed:${title.toLowerCase()}`;
        const cached = await env.RATE_LIMIT_KV.get(key);
        if (cached) return JSON.parse(cached) as number[];
        const vec = await embedQuery(env.GEMINI_API_KEY, title);
        ctx.waitUntil(
          env.RATE_LIMIT_KV.put(key, JSON.stringify(vec), {
            expirationTtl: EMBED_CACHE_TTL_SECONDS,
          })
        );
        return vec;
      };

      let queryVector: number[];
      if (titles.length <= 1) {
        queryVector = await getEmbedding(titles[0] ?? (qForVector ?? q).trim());
      } else {
        // Embed all titles in parallel — each is cached independently so repeat
        // visits with the same profile pay no Gemini cost.
        const vectors = await Promise.all(titles.map(getEmbedding));
        const dims = vectors[0].length;
        queryVector = new Array(dims).fill(0) as number[];
        for (const v of vectors) {
          for (let i = 0; i < dims; i++) queryVector[i] += v[i];
        }
        for (let i = 0; i < dims; i++) queryVector[i] /= vectors.length;
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
        let filteredRows = await listJobsByIds(env.JOBS_DB, rankedIds, {
          location,
          location_region,
          location_or,
          exclude_ids,
          employment_type,
          workplace_type,
          seniority_level,
          description_language,
          company,
          posted_since,
          salary_min,
          country,
          visa_sponsorship,
        });

        const qForTitleGate = (titleForSearch ?? qForVector ?? q)?.trim();
        if (qForTitleGate) {
          filteredRows = filteredRows.filter((r) =>
            jobTitleMatchesCommaSeparatedQuery(r.title, qForTitleGate)
          );
        }

        // Re-rank: blend similarity position with recency so newer jobs surface first
        // when semantically equivalent. Formula: combined = sim_rank + recency_penalty
        // where recency_penalty = days_old * RECENCY_WEIGHT (capped at MAX_RECENCY_PENALTY).
        // A job posted today has 0 penalty; one posted 30 days ago has ~30 * 0.5 = 15 penalty.
        // This means a job needs to be ~15 positions more relevant to beat a 30-day-old job.
        const RECENCY_WEIGHT = 0.5;          // penalty points per day old
        const MAX_RECENCY_PENALTY = 40;      // cap so very old jobs aren't infinitely deprioritised
        const nowSec = Math.floor(Date.now() / 1000);
        const simOrder = new Map(filteredRows.map((r, i) => [r.id, i]));
        const reranked = [...filteredRows].sort((a, b) => {
          const aPosted = a.posted_at ?? a.first_seen_at;
          const bPosted = b.posted_at ?? b.first_seen_at;
          const aDaysOld = Math.max(0, (nowSec - aPosted) / 86400);
          const bDaysOld = Math.max(0, (nowSec - bPosted) / 86400);
          const aPenalty = Math.min(MAX_RECENCY_PENALTY, aDaysOld * RECENCY_WEIGHT);
          const bPenalty = Math.min(MAX_RECENCY_PENALTY, bDaysOld * RECENCY_WEIGHT);
          const aScore = (simOrder.get(a.id) ?? 999) + aPenalty;
          const bScore = (simOrder.get(b.id) ?? 999) + bPenalty;
          return aScore - bScore;
        });

        // When posted_since is set, vector results are biased toward old similar jobs.
        // Fall through to SQL if we have too few results so SQL can find recent
        // jobs by title text match (SQL applies posted_since efficiently).
        const tooFewForRecency =
          posted_since && vectorOffset === 0 && reranked.length < limit;

        // Vector IDs matched but hydration + filters removed every row — fall through
        // to SQL (e.g. rare filter edge cases).
        const vectorHydrationEmpty =
          reranked.length === 0 && rankedIds.length > 0 && vectorOffset === 0;

        if (
          !vectorHydrationEmpty &&
          !(reranked.length === 0 && vectorOffset === 0 && posted_since) &&
          !tooFewForRecency
        ) {
          // Paginate within the re-ranked result set
          const page = reranked.slice(vectorOffset, vectorOffset + limit);
          const nextCursor = buildVectorCursor(vectorOffset, page.length, reranked.length);

          return finalize(jsonOk({
            data: page.map(rowToPublicJob),
            meta: {
              total: reranked.length,
              limit,
              next_cursor: nextCursor,
            },
          }), "vector", page.length, nextCursor);
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
    title: titleForSearch,
    q: qForSearch,
    location,
    location_region,
    location_or,
    exclude_ids,
    employment_type,
    workplace_type,
    seniority_level,
    description_language,
    company,
    posted_since,
    salary_min,
    country,
    visa_sponsorship,
    limit,
    cursor,
  });

  const data = rows.map(rowToPublicJob);
  const nextCursor = buildRegularCursor(rows, limit);

  return finalize(jsonOk({
    data,
    meta: {
      // total is null on cursor pages — it was already returned on page 1
      // and re-counting on every paginated request is unnecessarily expensive.
      total,
      limit,
      next_cursor: nextCursor,
    },
  }), "sql", data.length, nextCursor);
}
