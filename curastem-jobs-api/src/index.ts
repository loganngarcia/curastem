/**
 * Curastem Jobs API — Cloudflare Worker entry point.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ROUTES
 * ──────────────────────────────────────────────────────────────────────────
 *   GET  /health          Unauthenticated health check. Returns { status: "ok" }.
 *   GET  /stats           Aggregate market stats (counts, top companies, etc.).
 *   GET  /jobs            Paginated, filterable job listing.
 *   GET  /jobs/:id        Single job with lazy AI enrichment.
 *   POST /admin/trigger   Manually trigger ingestion (requires valid API key).
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
import { handleGetStats } from "./routes/stats.ts";
import { runIngestion, processSourceById, backfillEmbeddings } from "./ingestion/runner.ts";
import { runExaEnrichment } from "./enrichment/company.ts";
import { ensureCompanyWebsiteProbeColumns, ensureCompanyExaColumns, ensureNewJobColumns } from "./db/queries.ts";
import { applyCompanyMetadataCorrections, seedSources, seedCompanyWebsites } from "./db/migrate.ts";
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

  // Health check — unauthenticated, for uptime monitoring
  if (path === "/health" && method === "GET") {
    return jsonOk({ status: "ok", version: "1.0.0" });
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

  // GET /jobs — list with filtering and cursor pagination
  if (path === "/jobs" && method === "GET") {
    return handleListJobs(request, env, ctx);
  }

  // GET /jobs/:id — single job detail
  const jobMatch = path.match(JOB_ID_PATTERN);
  if (jobMatch && method === "GET") {
    return handleGetJob(request, env, ctx, jobMatch[1]);
  }

  // POST /admin/trigger — manually fire ingestion (requires a valid API key).
  // ?source=<id>  Run a single source synchronously and return its result.
  // (no param)    Queue a full ingestion run in the background via waitUntil.
  if (path === "/admin/trigger" && method === "POST") {
    const sourceId = url.searchParams.get("source");
    if (sourceId) {
      // Single-source mode: run synchronously so the result is in the response.
      // Embeddings are skipped to fit within the 30s Worker request budget.
      try {
        await seedSources(env.JOBS_DB);
        await ensureCompanyWebsiteProbeColumns(env.JOBS_DB);
        await ensureCompanyExaColumns(env.JOBS_DB);
        await ensureNewJobColumns(env.JOBS_DB);
        await seedCompanyWebsites(env.JOBS_DB);
        await applyCompanyMetadataCorrections(env.JOBS_DB);
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const result = await processSourceById(env, sourceId, limit);
        return jsonOk({ status: "completed", result });
      } catch (triggerErr) {
        logger.error("admin_trigger_source_failed", { source_id: sourceId, error: String(triggerErr) });
        return new Response(JSON.stringify({ error: String(triggerErr) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    // Full-run mode: background via waitUntil (best-effort, may be cut off for
    // large deployments — prefer the cron for full runs).
    ctx.waitUntil(
      (async () => {
        await seedSources(env.JOBS_DB);
        await ensureCompanyWebsiteProbeColumns(env.JOBS_DB);
        await ensureCompanyExaColumns(env.JOBS_DB);
        await ensureNewJobColumns(env.JOBS_DB);
        await seedCompanyWebsites(env.JOBS_DB);
        await applyCompanyMetadataCorrections(env.JOBS_DB);
        await runIngestion(env);
      })()
    );
    return jsonOk({ status: "triggered", message: "Full ingestion started in background" });
  }

  // POST /admin/embed — synchronously embed up to ?limit= jobs (default 25).
  // Each Gemini call takes ~300ms, so 25 jobs ≈ 7–10 seconds — fits the 30s budget.
  // Call repeatedly to process the full backlog.
  if (path === "/admin/embed" && method === "POST") {
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 25;
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
      await runExaEnrichment(env.JOBS_DB, env.EXA_API_KEY);
      return jsonOk({ status: "completed" });
    } catch (enrichErr) {
      logger.error("admin_enrich_failed", { error: String(enrichErr) });
      return new Response(JSON.stringify({ error: String(enrichErr) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Fallthrough: method not allowed for known paths, 404 for unknown paths
  if (path === "/jobs" || path === "/stats" || jobMatch) {
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
        if (await shouldSkipCron(env.RATE_LIMIT_KV)) {
          logger.info("scheduled_handler_skipped", { reason: "circuit_open" });
          return;
        }
        try {
          await seedSources(env.JOBS_DB);
          await ensureCompanyWebsiteProbeColumns(env.JOBS_DB);
          await ensureCompanyExaColumns(env.JOBS_DB);
          await ensureNewJobColumns(env.JOBS_DB);
          await seedCompanyWebsites(env.JOBS_DB);
          await applyCompanyMetadataCorrections(env.JOBS_DB);
          await runIngestion(env);
          await recordCronSuccess(env.RATE_LIMIT_KV);
        } catch (err) {
          logger.error("scheduled_handler_failed", { error: String(err) });
          await recordCronFailure(env.RATE_LIMIT_KV);
        }
      })()
    );
  },
};
