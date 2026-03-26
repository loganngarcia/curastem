/**
 * GET /jobs/:id — single job detail endpoint.
 *
 * Returns the full Job object including AI-enriched fields:
 *   - job_summary (two-sentence summary)
 *   - job_description (structured extraction: responsibilities, qualifications)
 *   - company.description (one-sentence company description)
 *
 * AI fields are generated lazily on first request and cached in D1.
 * Subsequent requests return the cached values — no redundant token spend.
 *
 * Cache invalidation: if description_raw changes during re-ingestion,
 * ai_generated_at is cleared (by upsertJob), causing regeneration on the
 * next request to this endpoint.
 *
 * If GEMINI_API_KEY is not set or if AI extraction fails, the response
 * still returns the job with null AI fields rather than erroring.
 */

import { getJobById, updateJobAiFields, updateCompanyEnrichment, updateJobDescriptionRaw, getSourceById, type FullJobRow } from "../db/queries.ts";
import { buildPublicSalary, extractJobFields } from "../enrichment/ai.ts";
import { extractKeywords } from "../enrichment/keywords.ts";
import { fetchSmartRecruitersDescription } from "../ingestion/sources/smartrecruiters.ts";
import type { Env, JobDescriptionExtracted, PublicJob } from "../types.ts";
import { Errors, jsonOk } from "../utils/errors.ts";
import { authenticate, recordKeyUsage } from "../middleware/auth.ts";
import { checkRateLimit } from "../middleware/rateLimit.ts";
import { logger } from "../utils/logger.ts";

function rowToFullPublicJob(row: FullJobRow): PublicJob {
  const bestPostedAt = row.posted_at ?? row.first_seen_at;
  const postedAtIso = new Date(bestPostedAt * 1000).toISOString();

  const salary = buildPublicSalary(row);

  let jobDescription: JobDescriptionExtracted | null = null;
  if (row.job_description) {
    try {
      jobDescription = JSON.parse(row.job_description) as JobDescriptionExtracted;
    } catch {
      // Malformed cached JSON — treat as not generated
    }
  }

  // Keywords are derived on-the-fly — no DB column, no AI call.
  // Uses the canonical phrase list from enrichment/keywords.ts.
  const keywords = extractKeywords(row.description_raw, row.job_description);

  let locations: string[] | null = null;
  if (row.locations) {
    try {
      locations = JSON.parse(row.locations) as string[];
    } catch {
      // Malformed JSON — treat as no location
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
    job_summary: row.job_summary,
    job_description: jobDescription,
    visa_sponsorship: row.visa_sponsorship ?? null,
    keywords,
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
      founded_year: row.company_founded_year,
      headquarters: (row.company_hq_address || row.company_hq_city || row.company_hq_country)
        ? { address: row.company_hq_address, city: row.company_hq_city, country: row.company_hq_country }
        : null,
      industry: row.company_industry,
      company_type: row.company_type,
      total_funding_usd: row.company_total_funding_usd,
    },
  };
}

export async function handleGetJob(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  jobId: string
): Promise<Response> {
  const auth = await authenticate(request, env.JOBS_DB);
  if (!auth.ok) return auth.response;

  const rateCheck = await checkRateLimit(env.RATE_LIMIT_KV, auth.key);
  if (!rateCheck.allowed) return rateCheck.response;

  recordKeyUsage(env.JOBS_DB, auth.key.id, ctx);

  const row = await getJobById(env.JOBS_DB, jobId);
  if (!row) return Errors.notFound("Job");

  // SmartRecruiters列表API不含描述体——首次请求时懒加载详情并永久缓存
  if (!row.description_raw && row.source_name === "smartrecruiters") {
    try {
      const source = await getSourceById(env.JOBS_DB, row.source_id);
      if (source) {
        const descHtml = await fetchSmartRecruitersDescription(
          source.company_handle,
          row.external_id
        );
        if (descHtml) {
          // 缓存写入是fire-and-forget；当前响应立即使用刚拿到的描述
          ctx.waitUntil(updateJobDescriptionRaw(env.JOBS_DB, row.id, descHtml));
          row.description_raw = descHtml;
        }
      }
    } catch (err) {
      // 描述懒加载失败不影响主响应
      logger.warn("sr_description_fetch_failed", { job_id: row.id, error: String(err) });
    }
  }

  // Check whether AI fields need to be generated (lazy, cached)
  const needsAi =
    env.GEMINI_API_KEY &&
    row.description_raw &&
    (row.ai_generated_at === null || row.job_description === null);

  if (needsAi) {
    try {
      const extracted = await extractJobFields(
        env.GEMINI_API_KEY,
        row.company_name,
        row.title,
        row.description_raw!
      );

      const now = Math.floor(Date.now() / 1000);
      const jobDescJson = JSON.stringify(extracted.job_description);

      const salaryPayload =
        extracted.salary_min !== null && extracted.salary_currency && extracted.salary_period
          ? { min: extracted.salary_min, currency: extracted.salary_currency, period: extracted.salary_period }
          : null;

      // Cache results — fire-and-forget so we don't block the response
      ctx.waitUntil(
        updateJobAiFields(env.JOBS_DB, row.id, extracted.job_summary, jobDescJson, now, {
          salary: salaryPayload,
          workplace_type: extracted.workplace_type,
          employment_type: extracted.employment_type,
          seniority_level: extracted.seniority_level,
          description_language: extracted.description_language,
          visa_sponsorship: extracted.visa_sponsorship,
          locations: extracted.locations,
        })
      );

      // Patch the in-memory row so this response includes freshly generated fields
      row.job_summary = extracted.job_summary;
      row.job_description = jobDescJson;
      row.ai_generated_at = now;
      if (row.workplace_type === null && extracted.workplace_type) {
        row.workplace_type = extracted.workplace_type;
      }
      if (row.employment_type === null && extracted.employment_type) {
        row.employment_type = extracted.employment_type;
      }
      if (row.seniority_level === null && extracted.seniority_level) {
        row.seniority_level = extracted.seniority_level;
      }
      // AI always overrides description_language (not just fills nulls)
      if (extracted.description_language) {
        row.description_language = extracted.description_language;
      }
      if (row.visa_sponsorship === null && extracted.visa_sponsorship) {
        row.visa_sponsorship = extracted.visa_sponsorship;
      }
      if (salaryPayload && row.salary_min === null) {
        row.salary_min = salaryPayload.min;
        row.salary_currency = salaryPayload.currency;
        row.salary_period = salaryPayload.period as import("../types.ts").SalaryPeriod;
      }
      // Patch in-memory locations so this response reflects AI-enhanced values immediately
      if (extracted.locations && extracted.locations.length > 0) {
        row.locations = JSON.stringify(extracted.locations);
      }

      // Also cache company description if missing (uses the same job context)
      if (!row.company_description && extracted.job_summary) {
        ctx.waitUntil(
          updateCompanyEnrichment(env.JOBS_DB, row.company_id, {
            description: extracted.job_summary.split(". ")[0] + ".",
          })
        );
      }
    } catch (err) {
      // AI extraction failure is non-fatal — return job without AI fields
      logger.warn("job_ai_extraction_failed", {
        job_id: row.id,
        error: String(err),
      });
    }
  }

  return jsonOk(rowToFullPublicJob(row));
}
