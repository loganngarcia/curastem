/**
 * Curastem Jobs API — Cloudflare Worker entry point.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ROUTES
 * ──────────────────────────────────────────────────────────────────────────
 *   GET  /health          Unauthenticated health check. Returns { status: "ok" }.
 *   GET  /auth/maps-key   Framer: Maps JS key (GOOGLE_MAPS_API_KEY; restrict by HTTP referrer).
 *   GET  /auth/gemini-token  Framer: ephemeral Gemini Live token (GEMINI_API_KEY server-side).
 *   POST /proxy/gemini    Framer: Gemini REST/SSE proxy (?model=&action=&alt=sse).
 *   GET  /stats           Aggregate market stats (counts, top companies, etc.).
 *   GET  /jobs            Paginated, filterable job listing.
 *   GET  /jobs/map        One chip entry per company (for map, no 50-job limit).
 *   GET  /jobs/:id        Single job with lazy AI enrichment.
 *   POST /admin/trigger   Manually trigger ingestion (requires valid API key).
 *   POST /admin/cron      Run the same pipeline as the scheduled Worker (poll GET /health).
 *   POST /admin/seed-sources  Insert/update `sources` rows from migrate.ts (no ingestion queue).
 *   ?source=mc-meta&meta_job_url=<url>  Ingest one Meta role (job_details or create_application URL).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SCHEDULED TRIGGER
 * ──────────────────────────────────────────────────────────────────────────
 *   Cron: "0 * * * *" — enqueue one INGESTION_QUEUE message per enabled source (parallel consumers).
 *   Cron: "30 * * * *" — Exa/company backlog, probes, embedding + geocode + description backfills.
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
 *   1. Create a handler under src/public/routes or src/app.
 *   2. Register it in src/public/router.ts or src/app/router.ts.
 *   3. Add method-not-allowed handling for known public paths when needed.
 *   4. Document it in README.md.
 */

import { processSourceById, backfillEmbeddings, ingestSourceFromQueue } from "./ingestion/runner.ts";
import { enrichCompanyById, runExaEnrichment, runCompanyEnrichment, runLogoOnlyEnrichment, runWordmarkUpgrade } from "./enrichment/company.ts";
import { ensureCompanyExaColumns } from "./db/queries.ts";
import type { Env } from "./types.ts";
import { Errors, jsonOk } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";
import { runBackfillPipeline, runSchedulerPipeline, runScheduledPipeline } from "./scheduledPipeline.ts";
import { migrateRenameCrunchbaseSource, seedSources } from "./db/migrate.ts";
import {
  appCorsPreflight,
  handleAppRoute,
  isAppRoute,
  withAppCors,
} from "../app/router.ts";
import { handlePublicRoute, isKnownPublicRoute } from "../public/router.ts";
import { sweepScheduledDeletions } from "./db/queries.ts";
import { sweepExpiredAttachments } from "../app/uploads/attachments.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Route dispatch
// ─────────────────────────────────────────────────────────────────────────────

// Route boundary map:
// - Private app API: browser-session product routes handled by src/app/router.ts
//   (/auth, /sync, /uploads, /chats, /docs, /apps, /proxy/gemini, /geo).
// - Public Jobs API: API-key/Bearer product routes handled by src/public/router.ts
//   (/jobs, /jobs/map, /jobs/:id, /stats). Admin/cron maintenance stays here.

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method;

  // CORS preflight. App routes need credentialed CORS; public Jobs API routes
  // keep the permissive wildcard behaviour used by external API consumers.
  if (method === "OPTIONS") {
    if (isAppRoute(path)) {
      return appCorsPreflight(request);
    }
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Health check — unauthenticated, for uptime monitoring.
  // Includes cron diagnostics: last_invoked (did CF fire the handler?)
  // and last_error (what crashed it, if anything).
  if (path === "/health" && method === "GET") {
    const [invokedRaw, backfillInvokedRaw, lastError, stage] = await Promise.all([
      env.RATE_LIMIT_KV.get("cron_last_invoked_at"),
      env.RATE_LIMIT_KV.get("backfill_last_invoked_at"),
      env.RATE_LIMIT_KV.get("cron_last_error"),
      env.RATE_LIMIT_KV.get("cron_stage"),
    ]);
    const lastInvoked = invokedRaw
      ? new Date(parseInt(invokedRaw, 10) * 1000).toISOString()
      : null;
    const backfillLastInvoked = backfillInvokedRaw
      ? new Date(parseInt(backfillInvokedRaw, 10) * 1000).toISOString()
      : null;
    return jsonOk({ status: "ok", version: "1.0.0", cron: { last_invoked: lastInvoked, backfill_last_invoked: backfillLastInvoked, stage, last_error: lastError } });
  }

  const appResp = await handleAppRoute(request, env, ctx, path, method);
  if (appResp) return appResp;

  const publicResp = await handlePublicRoute(request, env, ctx, url, path, method);
  if (publicResp) return publicResp;

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
    // Full-run mode: same code path as the hourly cron (minus heartbeat KV writes).
    ctx.waitUntil(
      runScheduledPipeline(env, { skipCircuitBreaker: true, recordHeartbeat: false }).catch((err) => {
        logger.error("admin_trigger_full_failed", { error: String(err) });
      })
    );
    return jsonOk({
      status: "triggered",
      message: "Full cron pipeline started in background — same as POST /admin/cron without heartbeat.",
    });
  }

  // POST /admin/cron — scheduler (enqueue sources) then backfill pass. Skips the circuit breaker.
  // Poll GET /health until cron.stage is "backfill_done" (or cron.last_error is set).
  if (path === "/admin/cron" && method === "POST") {
    ctx.waitUntil(
      runScheduledPipeline(env, { skipCircuitBreaker: true, recordHeartbeat: true }).catch((err) => {
        logger.error("admin_cron_failed", { error: String(err) });
      })
    );
    return jsonOk({
      status: "triggered",
      message: "Cron pipeline started — poll GET /health for cron.stage \"done\".",
    });
  }

  // POST /admin/seed-sources — run migrate.ts `seedSources()` only (INSERT OR IGNORE + URL migrations).
  // Use from local `wrangler dev` with D1 `remote: true` to push new source rows without enqueueing ingestion.
  if (path === "/admin/seed-sources" && method === "POST") {
    try {
      await seedSources(env.JOBS_DB);
      await migrateRenameCrunchbaseSource(env.JOBS_DB);
      return jsonOk({ status: "completed", message: "seedSources + migrateRenameCrunchbaseSource finished." });
    } catch (err) {
      logger.error("admin_seed_sources_failed", { error: String(err) });
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
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
      await runExaEnrichment(env.JOBS_DB, env.EXA_API_KEY, env.LOGO_DEV_TOKEN, {
        rateLimitKv: env.RATE_LIMIT_KV,
        mapboxAccessToken: env.MAPBOX_ACCESS_TOKEN,
        googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
      });
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
  // Mapbox HQ-quality → Places → geocodeWithMapboxFirst on city string. ?limit= default 50.
  if (path === "/admin/geocode" && method === "POST") {
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
    try {
      const { geocodeWithMapboxFirst } = await import("./utils/geocode.ts");
      const { mapboxGeocodeForCompanyHq } = await import("./utils/mapboxGeocode.ts");
      const { placesGeocode } = await import("./utils/placesGeocode.ts");
      const rows = await env.JOBS_DB.prepare(
        `SELECT id, name, hq_address, hq_city, hq_country FROM companies
         WHERE hq_lat IS NULL AND hq_city IS NOT NULL AND hq_city != ''
         LIMIT ?`
      ).bind(limit).all<{
        id: string;
        name: string;
        hq_address: string | null;
        hq_city: string;
        hq_country: string | null;
      }>();

      let updated = 0;
      let failed = 0;
      for (const row of rows.results ?? []) {
        const query = row.hq_address
          ? row.hq_address
          : `${row.name} ${row.hq_city}${row.hq_country ? ` ${row.hq_country}` : ""}`;
        let lat: number | undefined;
        let lng: number | undefined;
        let usedNominatim = false;
        const kv = env.RATE_LIMIT_KV;
        if (env.MAPBOX_ACCESS_TOKEN?.trim()) {
          const r = await mapboxGeocodeForCompanyHq(query, env.MAPBOX_ACCESS_TOKEN.trim(), kv);
          if (r) {
            lat = r.lat;
            lng = r.lng;
          }
        }
        if (lat == null && env.GOOGLE_MAPS_API_KEY?.trim()) {
          const r = await placesGeocode(query, env.GOOGLE_MAPS_API_KEY.trim(), kv);
          if (r) {
            lat = r.lat;
            lng = r.lng;
          }
        }
        if (lat == null) {
          const cityQuery = row.hq_country ? `${row.hq_city}, ${row.hq_country}` : row.hq_city;
          const coords = await geocodeWithMapboxFirst(cityQuery, kv, env.MAPBOX_ACCESS_TOKEN);
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            usedNominatim = coords.usedNominatim;
          }
        }
        if (lat != null && lng != null) {
          await env.JOBS_DB.prepare(
            `UPDATE companies SET hq_lat = ?, hq_lng = ? WHERE id = ?`
          ).bind(lat, lng, row.id).run();
          updated++;
          if (usedNominatim) await new Promise((r) => setTimeout(r, 1100));
        } else {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 50));
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

  // POST /admin/job-geocode — backfill location_lat/lng for a company slug.
  // Mapbox (metro or CONUS loose) → Places, then geocodeWithMapboxFirst, unless retail-blacklisted.
  // Requires ?company_slug=<slug>. ?limit= controls max jobs (default 50).
  if (path === "/admin/job-geocode" && method === "POST") {
    const slugParam = url.searchParams.get("company_slug");
    if (!slugParam) {
      return new Response(JSON.stringify({ error: "company_slug query param required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const { mapboxGeocodeIngestForJobPair } = await import("./utils/mapboxGeocode.ts");
      const { RETAIL_GEOCODE_SLUGS } = await import("./utils/retailGeocode.ts");
      const { listJobsNeedingPlacesGeocode, updateJobsWithCoords } = await import("./db/queries.ts");
      const { placesGeocode } = await import("./utils/placesGeocode.ts");
      const { geocodeWithMapboxFirst } = await import("./utils/geocode.ts");

      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
      const skipPremiumGeocode = RETAIL_GEOCODE_SLUGS.has(slugParam);

      const jobs = await listJobsNeedingPlacesGeocode(env.JOBS_DB, [slugParam], limit);
      const seen = new Map<string, { lat: number; lng: number } | null>();
      let jobsUpdated = 0;

      for (const job of jobs) {
        const cacheKey = `${job.company_name}|${job.location_primary}`;
        if (!seen.has(cacheKey)) {
          let coords: { lat: number; lng: number } | null = null;
          if (!skipPremiumGeocode) {
            if (env.MAPBOX_ACCESS_TOKEN) {
              const mb = await mapboxGeocodeIngestForJobPair(
                job.company_name,
                job.location_primary,
                env.MAPBOX_ACCESS_TOKEN,
                env.RATE_LIMIT_KV,
              );
              if (mb) coords = { lat: mb.lat, lng: mb.lng };
            }
            if (!coords && env.GOOGLE_MAPS_API_KEY) {
              const pl = await placesGeocode(
                `${job.company_name} ${job.location_primary}`,
                env.GOOGLE_MAPS_API_KEY,
                env.RATE_LIMIT_KV,
              );
              if (pl) coords = { lat: pl.lat, lng: pl.lng };
            }
          }
          if (!coords) {
            const result = await geocodeWithMapboxFirst(
              job.location_primary,
              env.RATE_LIMIT_KV,
              env.MAPBOX_ACCESS_TOKEN,
            );
            coords = result ? { lat: result.lat, lng: result.lng } : null;
          }
          seen.set(cacheKey, coords);
          await new Promise((r) => setTimeout(r, 50));
        }
        const c = seen.get(cacheKey);
        if (c) {
          jobsUpdated += await updateJobsWithCoords(env.JOBS_DB, job.location_primary, c.lat, c.lng);
        }
      }

      return jsonOk({
        status: "completed",
        company_slug: slugParam,
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
  if (isKnownPublicRoute(path)) {
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
      // Preserve credentialed CORS on unexpected failures. Without this, browser
      // fetch reports "Failed to fetch" and hides the actual 500 response, which
      // makes auth/sync failures impossible to diagnose from the web app.
      return withAppCors(
        request,
        Errors.internal(`Unhandled worker error: ${String(err).slice(0, 300)}`)
      );
    }
  },

  /**
   * Scheduled cron — :00 scheduler (enqueue sources) or :30 backfill (embeddings, geocode, etc.).
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const isBackfill = event.cron === "30 * * * *";
    ctx.waitUntil(
      (isBackfill ? runBackfillPipeline(env) : runSchedulerPipeline(env, { skipCircuitBreaker: false })).catch(
        (err) => {
          logger.error("scheduled_pipeline_wait_failed", { error: String(err) });
        }
      )
    );
    // Attachment TTL sweep and account deletion sweep — both on the :30 tick.
    if (isBackfill) {
      ctx.waitUntil(
        sweepExpiredAttachments(env).catch((err) => {
          logger.error("attachment_sweep_failed", { error: String(err) });
        })
      );
      ctx.waitUntil(
        sweepScheduledDeletions(env.JOBS_DB, env.USER_FILES)
          .then((n) => { if (n > 0) logger.info("account_deletions_swept", { count: n }); })
          .catch((err) => logger.error("account_deletion_sweep_failed", { error: String(err) }))
      );
    }
  },

  /**
   * Queue consumers — parallel per-source ingestion and per-company enrichment.
   */
  async queue(batch: MessageBatch<{ sourceId?: string; companyId?: string }>, env: Env): Promise<void> {
    if (batch.queue === "curastem-ingestion") {
      for (const msg of batch.messages) {
        try {
          const sourceId = msg.body.sourceId;
          if (typeof sourceId !== "string" || !sourceId) {
            msg.ack();
            continue;
          }
          await ingestSourceFromQueue(env, sourceId);
          msg.ack();
        } catch (err) {
          logger.error("ingestion_queue_message_failed", { error: String(err) });
          msg.retry();
        }
      }
      return;
    }
    if (batch.queue === "curastem-enrichment") {
      for (const msg of batch.messages) {
        try {
          const companyId = msg.body.companyId;
          if (typeof companyId !== "string" || !companyId) {
            msg.ack();
            continue;
          }
          await enrichCompanyById(env, companyId);
          msg.ack();
        } catch (err) {
          logger.error("enrichment_queue_message_failed", { error: String(err) });
          msg.retry();
        }
      }
    }
  },
};
