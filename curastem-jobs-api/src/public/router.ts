import { authenticate, recordKeyUsage } from "../shared/middleware/auth.ts";
import { checkRateLimit } from "../shared/middleware/rateLimit.ts";
import {
  listJobsForMap,
  type MapBbox,
  type MapCenter,
} from "../shared/db/queries.ts";
import { handleGetJob } from "./routes/job.ts";
import { handleListJobs } from "./routes/jobs.ts";
import { handleGetStats } from "./routes/stats.ts";
import type { Env } from "../shared/types.ts";
import { jsonOk } from "../shared/utils/errors.ts";
import { jobsMapCacheKeyRequest } from "../shared/utils/jobsMapCache.ts";

const JOB_ID_PATTERN = /^\/jobs\/([^/]+)$/;
const JOBS_MAP_CACHE_HDR = "X-Curastem-Jobs-Map-Cache";

export function isKnownPublicRoute(path: string): boolean {
  return (
    path === "/jobs" ||
    path === "/jobs/map" ||
    path === "/stats" ||
    JOB_ID_PATTERN.test(path)
  );
}

export async function handlePublicRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/stats" && method === "GET") {
    return handleGetStats(request, env, ctx);
  }

  if (path === "/jobs/map" && method === "GET") {
    const cacheReq = jobsMapCacheKeyRequest(url.searchParams);
    const cached = await caches.default.match(cacheReq);
    if (cached) {
      const h = new Headers(cached.headers);
      h.set("Access-Control-Allow-Origin", "*");
      h.set(JOBS_MAP_CACHE_HDR, "HIT");
      h.set("Access-Control-Expose-Headers", JOBS_MAP_CACHE_HDR);
      return new Response(cached.body, { status: cached.status, headers: h });
    }

    const auth = await authenticate(request, env.JOBS_DB);
    if (!auth.ok) return auth.response;
    const rateCheck = await checkRateLimit(env.RATE_LIMIT_KV, auth.key);
    if (!rateCheck.allowed) return rateCheck.response;
    recordKeyUsage(env.JOBS_DB, auth.key.id, ctx);

    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? parseInt(sinceRaw, 10) || 0 : 0;

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
    const limit = !isNaN(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;

    const employment_type = url.searchParams.get("employment_type") ?? undefined;
    const seniority_level = url.searchParams.get("seniority_level") ?? undefined;
    const qRaw = url.searchParams.get("q");
    const q = qRaw?.trim() ? qRaw.trim() : undefined;

    const rows = await listJobsForMap(
      env.JOBS_DB,
      since,
      bbox,
      center,
      limit,
      employment_type,
      seniority_level,
      q
    );
    const resp = jsonOk({
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
    resp.headers.set("Cache-Control", "public, max-age=300");
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.set(JOBS_MAP_CACHE_HDR, "MISS");
    resp.headers.set("Access-Control-Expose-Headers", JOBS_MAP_CACHE_HDR);
    ctx.waitUntil(caches.default.put(cacheReq, resp.clone()));
    return resp;
  }

  if (path === "/jobs" && method === "GET") {
    return handleListJobs(request, env, ctx);
  }

  const jobMatch = path.match(JOB_ID_PATTERN);
  if (jobMatch && method === "GET") {
    return handleGetJob(request, env, ctx, jobMatch[1]);
  }

  return null;
}
