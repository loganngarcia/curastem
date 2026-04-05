/**
 * Curastem Jobs API — Cloudflare Worker entry point.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ROUTES
 * ──────────────────────────────────────────────────────────────────────────
 *   GET  /health          Unauthenticated health check. Returns { status: "ok" }.
 *   GET  /stats           Aggregate market stats (counts, top companies, etc.).
 *   GET  /jobs            Paginated, filterable job listing.
 *   GET  /jobs/map        One chip entry per company (for map, no 50-job limit).
 *   GET  /jobs/:id        Single job with lazy AI enrichment.
 *   POST /admin/trigger   Manually trigger ingestion (requires valid API key).
 *   ?source=mc-meta&meta_job_url=<url>  Ingest one Meta role (job_details or create_application URL).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SCHEDULED TRIGGER
 * ──────────────────────────────────────────────────────────────────────────
 *   Cron: "0 * * * *" (every hour at :00)
 *   Action: seeds sources → ensures D1 schema for company website probe → seeds → corrections → ingestion → enrichment
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION
 * ──────────────────────────────────────────────────────────────────────────
 *   All routes except /health require:
 *     Authorization: Bearer <api_key>
 *
 *   Keys are issued manually at developers@curastem.org.
 *   The raw key is never stored — only its SHA-256 hex digest.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ERROR FORMAT
 * ──────────────────────────────────────────────────────────────────────────
 *   All errors are structured JSON:
 *     { "error": { "code": "UNAUTHORIZED", "message": "..." } }
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ADDING A ROUTE
 * ──────────────────────────────────────────────────────────────────────────
 *   1. Create src/routes/yourRoute.ts with a handler function.
 *   2. Import it below and add a route condition in handleRequest().
 *   3. Add the path to the methodNotAllowed guard at the bottom.
 *   4. Document it in README.md.
 */

import { handleListJobs } from "./routes/jobs.ts";
import { handleGetJob } from "./routes/job.ts";
import { authenticate, recordKeyUsage } from "./middleware/auth.ts";
import { checkRateLimit } from "./middleware/rateLimit.ts";
import { handleGetStats } from "./routes/stats.ts";
import { runIngestion, processSourceById, backfillEmbeddings } from "./ingestion/runner.ts";
import { runExaEnrichment, runCompanyEnrichment, runLogoOnlyEnrichment, runWordmarkUpgrade } from "./enrichment/company.ts";
import { ensureCompanyWebsiteProbeColumns, ensureCompanyExaColumns, ensureNewJobColumns, listJobsForMap, type MapBbox, type MapCenter } from "./db/queries.ts";
import {
  applyCompanyMetadataCorrections,
  migrateRenameCrunchbaseSource,
  seedCompanyWebsites,
  seedSources,
} from "./db/migrate.ts";
import type { Env } from "./types.ts";
import { Errors, jsonOk } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";
import { recordCronFailure, recordCronSuccess, shouldSkipCron } from "./utils/cronCircuit.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Route dispatch
// ─────────────────────────────────────────────────────────────────────────────

const JOB_ID_PATTERN = /^\/jobs\/([^/]+)$/;

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method;

  // CORS preflight (not needed for API consumers but useful for browser testing)
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Health check — unauthenticated, for uptime monitoring.
  // Includes cron diagnostics: last_invoked (did CF fire the handler?)
  // and last_error (what crashed it, if anything).
  if (path === "/health" && method === "GET") {
    const [invokedRaw, lastError, stage] = await Promise.all([
      env.RATE_LIMIT_KV.get("cron_last_invoked_at"),
      env.RATE_LIMIT_KV.get("cron_last_error"),
      env.RATE_LIMIT_KV.get("cron_stage"),
    ]);
    const lastInvoked = invokedRaw
      ? new Date(parseInt(invokedRaw, 10) * 1000).toISOString()
      : null;
    return jsonOk({ status: "ok", version: "1.0.0", cron: { last_invoked: lastInvoked, stage, last_error: lastError } });
  }

  // GET /geo — unauthenticated, returns the caller's lat/lng from Cloudflare's edge geolocation.
  // Used by web.tsx instead of a third-party IP geolocation service.
  if (path === "/geo" && method === "GET") {
    const cf = (request as Request & { cf?: { latitude?: string; longitude?: string; city?: string; country?: string; region?: string } }).cf;
    const lat = cf?.latitude ? parseFloat(cf.latitude) : null;
    const lng = cf?.longitude ? parseFloat(cf.longitude) : null;
    return new Response(
      JSON.stringify({ lat, lng, city: cf?.city ?? null, region: cf?.region ?? null, country: cf?.country ?? null }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } }
    );
  }

  // GET /stats — aggregate market overview (job counts, top companies, etc.)
  if (path === "/stats" && method === "GET") {
    return handleGetStats(request, env, ctx);
  }

  // GET /jobs/map — one chip entry per (company × ~10km location bucket).
  // chip_lat/chip_lng = centroid of jobs in that bucket (per-job coords when
  // geocoded, company HQ otherwise).  headquarters is the company's canonical HQ
  // (used for address-precision check and fallback display).
  if (path === "/jobs/map" && method === "GET") {
    const auth = await authenticate(request, env.JOBS_DB);
    if (!auth.ok) return auth.response;
    const rateCheck = await checkRateLimit(env.RATE_LIMIT_KV, auth.key);
    if (!rateCheck.allowed) return rateCheck.response;
    recordKeyUsage(env.JOBS_DB, auth.key.id, ctx);

    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? parseInt(sinceRaw, 10) || 0 : 0;

    // Optional viewport bbox — when provided, restricts results to companies
    // whose HQ falls inside the box (frontend sends map viewport + buffer).
    const minLat = parseFloat(url.searchParams.get("min_lat") ?? "");
    const maxLat = parseFloat(url.searchParams.get("max_lat") ?? "");
    const minLng = parseFloat(url.searchParams.get("min_lng") ?? "");
    const maxLng = parseFloat(url.searchParams.get("max_lng") ?? "");
    const bbox: MapBbox | undefined =
      !isNaN(minLat) && !isNaN(maxLat) && !isNaN(minLng) && !isNaN(maxLng)
        ? { minLat, maxLat, minLng, maxLng }
        : undefined;

    const centerLat = parseFloat(url.searchParams.get("center_lat") ?? "");
    const centerLng = parseFloat(url.searchParams.get("center_lng") ?? "");
    const center: MapCenter | undefined =
      !isNaN(centerLat) && !isNaN(centerLng)
        ? { lat: centerLat, lng: centerLng }
        : undefined;

    const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = !isNaN(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

    const q = url.searchParams.get("q") ?? undefined;
    const employment_type = url.searchParams.get("employment_type") ?? undefined;
    const seniority_level = url.searchParams.get("seniority_level") ?? undefined;

    const rows = await listJobsForMap(env.JOBS_DB, since, bbox, center, limit, q, employment_type, seniority_level);
    return jsonOk({
      data: rows.map((r) => ({
        company_id: r.company_id,
        company_name: r.company_name,
        company_logo_url: r.company_logo_url,
        company_slug: r.company_slug,
        chip_lat: r.chip_lat,
        chip_lng: r.chip_lng,
        headquarters: {
          lat: r.company_hq_lat,
          lng: r.company_hq_lng,
          city: r.company_hq_city,
          country: r.company_hq_country,
          address: r.company_hq_address,
        },
        job_count: r.job_count,
      })),
    });
  }

  // GET /jobs — list with filtering and cursor pagination
  if (path === "/jobs" && method === "GET") {
    return handleListJobs(request, env, ctx);
  }

  // GET /jobs/:id — single job detail
  const jobMatch = path.match(JOB_ID_PATTERN);
  if (jobMatch && method === "GET") {
    return handleGetJob(request, env, ctx, jobMatch[1]);
  }

  // POST /admin/trigger-sync — synchronous single-source trigger for on-device backfill.
  // Awaits the result directly (no waitUntil) so the response carries real counts.
  // Not suitable for production HTTP (> 30s sources will timeout); use from local wrangler dev.
  if (path === "/admin/trigger-sync" && method === "POST") {
    const sourceId = url.searchParams.get("source");
    if (!sourceId) return Errors.badRequest("source param required");
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const result = await processSourceById(env, sourceId, limit);
    return jsonOk(result);
  }

  // POST /admin/trigger — manually fire ingestion (requires a valid API key).
  // ?source=<id>  Run a single source and return its result.
  // ?source=<id>&limit=N&offset=M  Process fetch().slice(M, M+N) for huge sources (e.g. IBM).
  // (no param)    Queue a full ingestion run in the background via waitUntil.
  if (path === "/admin/trigger" && method === "POST") {
    const sourceId = url.searchParams.get("source");
    if (sourceId) {
      // Single-source mode: skip the heavy setup sequence (seedSources takes ~60s
      // of D1 round-trips and is already run by the hourly cron).  Run the source
      // fetch in the background via waitUntil so the response returns before the
      // 30s HTTP timeout fires, then poll D1 for last_fetched_at to confirm.
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const offsetParam = url.searchParams.get("offset");
      const parsedOff = offsetParam ? parseInt(offsetParam, 10) : NaN;
      const jobOffset = Number.isFinite(parsedOff) && parsedOff > 0 ? parsedOff : undefined;
      const metaJobUrl = url.searchParams.get("meta_job_url") ?? undefined;
      ctx.waitUntil(
        processSourceById(env, sourceId, limit, metaJobUrl, jobOffset).catch((err) => {
          logger.error("admin_trigger_source_failed", { source_id: sourceId, error: String(err) });
        })
      );
      return jsonOk({ status: "triggered", source_id: sourceId, message: "Source ingestion started in background — poll last_fetched_at in D1 to confirm completion." });
    }
    // Full-run mode: background via waitUntil (best-effort, may be cut off for
    // large deployments — prefer the cron for full runs).
    ctx.waitUntil(
      (async () => {
        await seedSources(env.JOBS_DB);
        await migrateRenameCrunchbaseSource(env.JOBS_DB);
        await ensureCompanyWebsiteProbeColumns(env.JOBS_DB);
        await ensureCompanyExaColumns(env.JOBS_DB);
        await ensureNewJobColumns(env.JOBS_DB);
        await seedCompanyWebsites(env.JOBS_DB);
        await applyCompanyMetadataCorrections(env.JOBS_DB, env.LOGO_DEV_TOKEN);
        await runIngestion(env);
      })()
    );
    return jsonOk({ status: "triggered", message: "Full ingestion started in background" });
  }

  // POST /admin/embed — synchronously embed up to ?limit= jobs (default 25).
  // Each Gemini call takes ~300ms; 100 jobs at concurrency 5 ≈ ~25–40s wall clock.
  // Call repeatedly to process the full backlog (see scripts/backfill_embeddings_remote.sh).
  if (path === "/admin/embed" && method === "POST") {
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 25;
    try {
      const result = await backfillEmbeddings(env, limit);
      return jsonOk({ status: "completed", ...result });
    } catch (embedErr) {
      logger.error("admin_embed_failed", { error: String(embedErr) });
      return new Response(JSON.stringify({ error: String(embedErr) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/enrich — synchronously run Exa enrichment for the next batch.
  // Useful for testing and backfilling without waiting for the hourly cron.
  // ?debug=<company_name> returns the raw Exa response for a single company.
  if (path === "/admin/enrich" && method === "POST") {
    if (!env.EXA_API_KEY) {
      return new Response(JSON.stringify({ error: "EXA_API_KEY not set" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    const debugName = url.searchParams.get("debug");
    if (debugName) {
      // Debug mode: runs both Exa passes sequentially (pass 2 uses pass 1 result to
      // determine the dynamic fallback field). Optional ?website= passes a domain hint.
      try {
        const { fetchExaDeepProfileData, fetchExaDeepSocialData } = await import("./enrichment/exa.ts");
        const websiteHint = url.searchParams.get("website") || null;

        const profile = await fetchExaDeepProfileData(debugName, env.EXA_API_KEY, websiteHint);

        // Mirror the production fallback-field logic from company.ts
        let fallbackKey: string | null = null;
        if (profile) {
          const checks: Array<[string, unknown]> = [
            ["industry",             profile.industry],
            ["company_type",         profile.company_type],
            ["hq_city",              profile.hq_city],
            ["hq_country",           profile.hq_country],
            ["employee_count_range", profile.employee_count_range],
            ["founded_year",         profile.founded_year],
            ["total_funding_usd",    profile.total_funding_usd],
            ["hq_address",           profile.hq_address],
            ["linkedin_url",         profile.linkedin_url],
          ];
          for (const [key, val] of checks) {
            const isOther = key === "industry" || key === "company_type";
            if (!val || (isOther && val === "other")) { fallbackKey = key; break; }
          }
        }

        // Prefer Pass 1's resolved website URL over the raw hint — it may have
        // found the canonical domain (e.g. a corrected .mil or .org URL).
        const pass2Website = profile?.website_url ?? websiteHint;
        const social = await fetchExaDeepSocialData(
          debugName, env.EXA_API_KEY, pass2Website, fallbackKey, profile?.industry,
        );
        return jsonOk({ company: debugName, website_hint: websiteHint, fallback_key: fallbackKey, profile, social });
      } catch (dbgErr) {
        return jsonOk({ company: debugName, error: String(dbgErr) });
      }
    }
    try {
      await ensureCompanyExaColumns(env.JOBS_DB);
      await runExaEnrichment(env.JOBS_DB, env.EXA_API_KEY, env.LOGO_DEV_TOKEN);
      return jsonOk({ status: "completed" });
    } catch (enrichErr) {
      logger.error("admin_enrich_failed", { error: String(enrichErr) });
      return new Response(JSON.stringify({ error: String(enrichErr) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/enrich-logos — run the Brandfetch+Logo.dev+AI pass for stale companies.
  // Upgrades Google favicon placeholders to Logo.dev logos, batch by batch.
  // ?limit=N  override the per-call batch size (default 50, max 50).
  // Safe to call repeatedly — idempotent UPDATEs, stops when no stale companies remain.
  if (path === "/admin/enrich-logos" && method === "POST") {
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not set" }), {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    }
    const batchLimit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 50);
    try {
      const processed = await runCompanyEnrichment(env.JOBS_DB, env.GEMINI_API_KEY, env.BRANDFETCH_CLIENT_ID, env.LOGO_DEV_TOKEN, batchLimit);

      // remaining = how many google-favicon companies still exist (may never reach 0 for niche companies not in Logo.dev)
      // processed = how many were actually enriched this call — loop should stop when this is 0
      const remaining = await env.JOBS_DB
        .prepare(`SELECT COUNT(*) as c FROM companies WHERE logo_url LIKE 'https://www.google.com/s2/favicons%'`)
        .first<{ c: number }>();
      return jsonOk({ status: "completed", processed, remaining_google_favicons: remaining?.c ?? 0 });
    } catch (err) {
      logger.error("admin_enrich_logos_failed", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/enrich-logos-null — logo-only pass for companies with logo_url IS NULL.
  // No staleness gate: runs immediately without waiting for the 24h retry window.
  // Does NOT touch description_enriched_at. Safe to call repeatedly until remaining=0.
  if (path === "/admin/enrich-logos-null" && method === "POST") {
    const batchLimit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 50);
    try {
      const processed = await runLogoOnlyEnrichment(env.JOBS_DB, env.BRANDFETCH_CLIENT_ID, env.LOGO_DEV_TOKEN, batchLimit);
      const remaining = await env.JOBS_DB
        .prepare(`SELECT COUNT(*) as c FROM companies WHERE logo_url IS NULL OR logo_url = ''`)
        .first<{ c: number }>();
      return jsonOk({ status: "completed", processed, remaining_null_logos: remaining?.c ?? 0 });
    } catch (err) {
      logger.error("admin_enrich_logos_null_failed", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/upgrade-wordmarks — upgrade Brandfetch wordmark logos to Logo.dev square icons.
  // Safe to call repeatedly; only updates when Logo.dev has a better icon.
  if (path === "/admin/upgrade-wordmarks" && method === "POST") {
    const batchLimit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 50);
    try {
      const upgraded = await runWordmarkUpgrade(env.JOBS_DB, env.LOGO_DEV_TOKEN, batchLimit);
      const remaining = await env.JOBS_DB
        .prepare(`SELECT COUNT(*) as c FROM companies WHERE logo_url LIKE '%cdn.brandfetch.io%' AND logo_url LIKE '%/theme/%/logo.%'`)
        .first<{ c: number }>();
      return jsonOk({ status: "completed", upgraded, remaining_wordmarks: remaining?.c ?? 0 });
    } catch (err) {
      logger.error("admin_upgrade_wordmarks_failed", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/geocode — backfill hq_lat/hq_lng for companies that have a city but no coords.
  // Process ?limit= companies per call (default 50). Safe to call repeatedly until done.
  if (path === "/admin/geocode" && method === "POST") {
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
    try {
      const { geocode } = await import("./utils/geocode.ts");
      const rows = await env.JOBS_DB.prepare(
        `SELECT id, hq_city, hq_country FROM companies
         WHERE hq_lat IS NULL AND hq_city IS NOT NULL AND hq_city != ''
         LIMIT ?`
      ).bind(limit).all<{ id: number; hq_city: string; hq_country: string | null }>();

      let updated = 0;
      let failed = 0;
      for (const row of rows.results ?? []) {
        const query = row.hq_country ? `${row.hq_city}, ${row.hq_country}` : row.hq_city;
        const coords = await geocode(query, env.RATE_LIMIT_KV);
        if (coords) {
          await env.JOBS_DB.prepare(
            `UPDATE companies SET hq_lat = ?, hq_lng = ? WHERE id = ?`
          ).bind(coords.lat, coords.lng, row.id).run();
          updated++;
          // Nominatim requires 1s between requests to respect ToS
          if (coords.usedNominatim) await new Promise(r => setTimeout(r, 1100));
        } else {
          failed++;
        }
      }
      const remaining = await env.JOBS_DB.prepare(
        `SELECT COUNT(*) as c FROM companies WHERE hq_lat IS NULL AND hq_city IS NOT NULL AND hq_city != ''`
      ).first<{ c: number }>();
      return jsonOk({ status: "completed", updated, failed, remaining: remaining?.c ?? 0 });
    } catch (geoErr) {
      logger.error("admin_geocode_failed", { error: String(geoErr) });
      return new Response(JSON.stringify({ error: String(geoErr) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/places-geocode — fill hq_lat/hq_lng/hq_address for companies with no coords
  // using Places API (New) Text Search. Searches by hq_address if available, else company name.
  // Requires ?key=<GOOGLE_MAPS_API_KEY>. Safe to call repeatedly.
  if (path === "/admin/places-geocode" && method === "POST") {
    const mapsKey = url.searchParams.get("key");
    if (!mapsKey) {
      return new Response(JSON.stringify({ error: "Missing ?key= param" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const rows = await env.JOBS_DB.prepare(
        `SELECT id, name, hq_address, hq_city, hq_country
         FROM companies WHERE hq_lat IS NULL
         ORDER BY name`
      ).all<{ id: string; name: string; hq_address: string | null; hq_city: string | null; hq_country: string | null }>();

      let updated = 0, failed = 0, skipped = 0;
      const results: Array<{ company: string; query: string; address?: string; lat?: number; lng?: number; status: string }> = [];

      for (const row of rows.results ?? []) {
        // Build the best query: prefer existing address, then name+city, then just name
        const query = row.hq_address
          ? row.hq_address
          : row.hq_city
            ? `${row.name} ${row.hq_city}${row.hq_country ? ` ${row.hq_country}` : ""}`
            : row.name;

        try {
          const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": mapsKey,
              "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
            },
            body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
          });
          const data = await res.json() as { places?: Array<{ formattedAddress?: string; location?: { latitude: number; longitude: number } }> };
          const place = data.places?.[0];
          if (place?.location?.latitude != null && place?.location?.longitude != null) {
            await env.JOBS_DB.prepare(
              `UPDATE companies SET hq_lat = ?, hq_lng = ?, hq_address = COALESCE(hq_address, ?) WHERE id = ?`
            ).bind(place.location.latitude, place.location.longitude, place.formattedAddress ?? null, row.id).run();
            results.push({ company: row.name, query, address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, status: "ok" });
            updated++;
          } else {
            results.push({ company: row.name, query, status: "no_result" });
            failed++;
          }
          // Respect Places API rate limits
          await new Promise(r => setTimeout(r, 50));
        } catch (e) {
          results.push({ company: row.name, query, status: `error: ${String(e)}` });
          skipped++;
        }
      }

      return jsonOk({ status: "completed", updated, failed, skipped, results });
    } catch (err) {
      logger.error("admin_places_geocode_failed", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /admin/job-geocode — backfill location_lat/lng for whitelisted retail companies
  // Geocode unresolved job locations for a specific company slug.
  // Routing mirrors the inline ingestion logic in runner.ts Phase 4b:
  //   retail slug or retail title → Photon (free, city-level)
  //   professional company        → Places API ($0.032/req)
  // Requires ?company_slug=<slug>. ?limit= controls max jobs (default 50).
  if (path === "/admin/job-geocode" && method === "POST") {
    const slugParam = url.searchParams.get("company_slug");
    if (!slugParam) {
      return new Response(JSON.stringify({ error: "company_slug query param required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const { RETAIL_GEOCODE_SLUGS } = await import("./utils/retailGeocode.ts");
      const { listJobsNeedingPlacesGeocode, updateJobsWithCoords } = await import("./db/queries.ts");
      const { placesGeocode } = await import("./utils/placesGeocode.ts");
      const { geocode } = await import("./utils/geocode.ts");

      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
      const isRetail = RETAIL_GEOCODE_SLUGS.has(slugParam);

      const jobs = await listJobsNeedingPlacesGeocode(env.JOBS_DB, [slugParam], limit);
      const seen = new Map<string, { lat: number; lng: number } | null>();
      let jobsUpdated = 0;

      for (const job of jobs) {
        const cacheKey = `${job.company_name}|${job.location_primary}`;
        if (!seen.has(cacheKey)) {
          if (isRetail || !env.GOOGLE_MAPS_API_KEY) {
            // Retail → free city-level Photon
            const result = await geocode(job.location_primary, env.RATE_LIMIT_KV);
            seen.set(cacheKey, result ? { lat: result.lat, lng: result.lng } : null);
          } else {
            // Professional → Places API for precise office/facility coords
            const result = await placesGeocode(`${job.company_name} ${job.location_primary}`, env.GOOGLE_MAPS_API_KEY, env.RATE_LIMIT_KV);
            seen.set(cacheKey, result ? { lat: result.lat, lng: result.lng } : null);
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        const coords = seen.get(cacheKey);
        if (coords) {
          jobsUpdated += await updateJobsWithCoords(env.JOBS_DB, job.location_primary, coords.lat, coords.lng);
        }
      }

      return jsonOk({
        status: "completed",
        company_slug: slugParam,
        tier: isRetail ? "photon" : "places_api",
        unique_locations_queried: seen.size,
        jobs_updated: jobsUpdated,
      });
    } catch (err) {
      logger.error("admin_job_geocode_failed", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Fallthrough: method not allowed for known paths, 404 for unknown paths
  if (path === "/jobs" || path === "/jobs/map" || path === "/stats" || jobMatch) {
    return Errors.methodNotAllowed();
  }

  return Errors.notFound("Endpoint");
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker export
// ─────────────────────────────────────────────────────────────────────────────

export default {
  /**
   * HTTP request handler.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      logger.error("unhandled_request_error", { error: String(err) });
      return Errors.internal();
    }
  },

  /**
   * Scheduled cron handler — runs every hour (cron: "0 * * * *").
   *
   * Circuit breaker: after 3 consecutive failures, skip runs for 6 hours to
   * avoid burning Cloudflare/Gemini costs on repeated failing invocations.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        // Heartbeat written before any other logic — tells us if Cloudflare is
        // invoking the scheduled handler at all (vs. pausing it after failures).
        const invokedAt = Math.floor(Date.now() / 1000);
        const kv = env.RATE_LIMIT_KV;
        const stage = (s: string) => kv.put("cron_stage", s, { expirationTtl: 3600 });
        await kv.put("cron_last_invoked_at", String(invokedAt), { expirationTtl: 7 * 24 * 3600 });
        await stage("started");

        if (await shouldSkipCron(kv)) {
          logger.info("scheduled_handler_skipped", { reason: "circuit_open" });
          await stage("skipped_circuit");
          return;
        }
        try {
          await stage("seed_sources");
          await seedSources(env.JOBS_DB);
          await stage("migrations");
          await migrateRenameCrunchbaseSource(env.JOBS_DB);
          await ensureCompanyWebsiteProbeColumns(env.JOBS_DB);
          await ensureCompanyExaColumns(env.JOBS_DB);
          await ensureNewJobColumns(env.JOBS_DB);
          await stage("seed_company_websites");
          await seedCompanyWebsites(env.JOBS_DB);
          await stage("metadata_corrections");
          await applyCompanyMetadataCorrections(env.JOBS_DB, env.LOGO_DEV_TOKEN);
          await stage("run_ingestion");
          await runIngestion(env);
          await stage("done");
          await recordCronSuccess(kv);
        } catch (err) {
          const msg = String(err);
          logger.error("scheduled_handler_failed", { error: msg });
          // Persist the last crash reason so /health can surface it without Workers Logs.
          await kv.put("cron_last_error", msg, { expirationTtl: 7 * 24 * 3600 });
          await recordCronFailure(kv);
        }
      })()
    );
  },
};
