/**
 * Company enrichment — populates logo, website, social links, and profile fields.
 *
 * Enrichment strategy (in priority order):
 *   1. Exa profile deep pass ($0.012) — core company facts: website, LinkedIn,
 *      industry, company type, employees, founded year, funding, HQ details.
 *      Run-once, tracked by exa_company_enriched_at.
 *   2. Exa social deep pass ($0.012) — 9 social links + dynamic 10th slot that
 *      backfills the highest-priority null field from pass 1 (industry, company_type,
 *      hq_city, hq_country, etc.). Run-once, tracked by exa_social_enriched_at.
 *   3. Logo.dev — primary for logos (`resolveLogoUrl`: img CDN with pk_, or Search API with sk_).
 *      Google favicon only when Logo.dev has no asset (see `utils/logoUrl.ts`).
 *   4. Brandfetch — fallback for logo when Logo.dev returns a placeholder; also fills
 *      LinkedIn / X / Glassdoor when still null after Exa.
 *   5. Gemini AI — one-sentence company description from job text.
 *
 * Runs after every ingestion cron pass. Non-blocking — failures are logged and
 * skipped so one bad company never stops the rest.
 */

import {
  fetchExaDeepProfileData,
  fetchExaDeepSocialData,
  normalizeIndustry,
  normalizeCompanyType,
  normalizeEmployeeCount,
  normalizeCountryCode,
  normalizeUrl,
} from "./exa.ts";
import { extractCompanyDescription } from "./ai.ts";
import {
  listUnenrichedCompanies,
  listCompaniesNeedingLogo,
  listCompaniesWithWordmarkLogo,
  listCompaniesForExaEnrichment,
  listCompaniesForSocialEnrichment,
  getCompanyById,
  updateCompanyEnrichment,
} from "../db/queries.ts";
import { geocode } from "../utils/geocode.ts";
import { logger } from "../utils/logger.ts";
import { LOGO_MAX_PX, isLowTrustLogoUrl, resolveLogoUrl, resolveLogoUrlByName } from "../utils/logoUrl.ts";
import type { CompanyRow, Env } from "../types.ts";

const ENRICHMENT_STALE_SECONDS = 7 * 24 * 60 * 60; // full Brandfetch/AI re-enrich every 7 days
const ENRICHMENT_RETRY_SECONDS = 24 * 60 * 60;     // retry missing fields every 24h
/** Batch Exa pass on :30 cron — larger now that ingestion is queue-isolated per source. */
const EXA_BATCH = 25;

// ─── Brandfetch ───────────────────────────────────────────────────────────────

interface BrandfetchFormat {
  src: string;
  format: string;
  background: string | null;
  height: number | null;
  width: number | null;
}

interface BrandfetchLogo {
  type: string;
  theme: string | null;
  formats: BrandfetchFormat[];
}

interface BrandfetchLink {
  name: string;
  url: string;
}

interface BrandfetchBrand {
  logos?: BrandfetchLogo[];
  links?: BrandfetchLink[];
}

interface BrandfetchResult {
  logo_url: string | null;
  linkedin_url: string | null;
  x_url: string | null;
  glassdoor_url: string | null;
}

// Brandfetch logo type priority: icon/symbol (square) > logo (wordmark).
// Square icons render better at small sizes in job listings.
function logoTypePriority(type: string): number {
  if (type === "icon" || type === "symbol") return 0;
  if (type === "logo") return 1;
  return 2;
}

function pickLogoUrl(logos: BrandfetchLogo[] | undefined): string | null {
  if (!logos || logos.length === 0) return null;
  const sorted = [...logos].sort((a, b) => logoTypePriority(a.type) - logoTypePriority(b.type));
  for (const logo of sorted) {
    const svgFormat = logo.formats?.find((f) => f.format === "svg");
    if (svgFormat?.src) return svgFormat.src;
    const rasters = (logo.formats ?? [])
      .filter((f) => f.format === "png" || f.format === "webp")
      .sort((a, b) => (a.width ?? 9999) - (b.width ?? 9999));
    const best = rasters.find((f) => (f.width ?? 0) >= LOGO_MAX_PX) ?? rasters[0];
    if (best?.src) return best.src;
  }
  return null;
}

async function fetchBrandfetchData(domain: string, clientId: string): Promise<BrandfetchResult | null> {
  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
      headers: { Authorization: `Bearer ${clientId}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as BrandfetchBrand;
    const linkMap: Record<string, string> = {};
    for (const link of data.links ?? []) {
      linkMap[link.name.toLowerCase()] = link.url;
    }
    return {
      logo_url:      pickLogoUrl(data.logos),
      linkedin_url:  linkMap["linkedin"] ?? null,
      x_url:         linkMap["twitter"]  ?? null,
      glassdoor_url: linkMap["glassdoor"] ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(websiteUrl: string): string | null {
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function getCompanyJobContext(db: D1Database, companyId: string): Promise<string | null> {
  const result = await db
    .prepare("SELECT description_raw FROM jobs WHERE company_id = ? AND description_raw IS NOT NULL LIMIT 1")
    .bind(companyId)
    .first<{ description_raw: string }>();
  return result?.description_raw ?? null;
}

// ─── Exa enrichment pass ──────────────────────────────────────────────────────

// Priority order for the dynamic 10th slot in Pass 2.
// "stale" returns true when the field needs a second attempt.
// industry/company_type treat "other" as stale — it's a fallback value, not data.
const PASS1_BACKFILL_PRIORITY: Array<{
  key: keyof CompanyRow;
  stale: (v: unknown) => boolean;
}> = [
  { key: "industry",       stale: (v) => !v || v === "other" },
  { key: "company_type",   stale: (v) => !v || v === "other" },
  { key: "hq_city",        stale: (v) => !v },
  { key: "hq_country",     stale: (v) => !v },
  { key: "employee_count", stale: (v) => !v },
  { key: "founded_year",   stale: (v) => !v },
  { key: "total_funding_usd", stale: (v) => !v },
  { key: "hq_address",     stale: (v) => !v },
  { key: "linkedin_url",   stale: (v) => !v },
];

async function enrichOneCompanyExaProfile(
  db: D1Database,
  company: CompanyRow,
  exaApiKey: string,
  logoDevToken: string | undefined,
  now: number
): Promise<void> {
  try {
    const profile = await fetchExaDeepProfileData(company.name, exaApiKey, company.website_url);
    const fields: Parameters<typeof updateCompanyEnrichment>[2] = {
      exa_company_enriched_at: now,
    };

    if (profile) {
      const inferSuppressed = (company.website_infer_suppressed ?? 0) !== 0;

      if (!company.website_url && profile.website_url && !inferSuppressed)
        fields.website_url = profile.website_url;

      const logoIsPlaceholder = isLowTrustLogoUrl(company.logo_url);
      if (logoIsPlaceholder) {
        const domain = profile.website_url
          ? extractDomain(profile.website_url)
          : (company.website_url ? extractDomain(company.website_url) : null);
        if (domain) fields.logo_url = await resolveLogoUrl(domain, logoDevToken);
      }

      if (!company.linkedin_url && profile.linkedin_url)                   fields.linkedin_url         = profile.linkedin_url;
      if (!company.employee_count_range && profile.employee_count_range)   fields.employee_count_range = profile.employee_count_range;
      if (!company.employee_count && profile.employee_count)               fields.employee_count       = profile.employee_count;
      if (!company.founded_year && profile.founded_year)                   fields.founded_year         = profile.founded_year;
      if (!company.hq_address && profile.hq_address)                       fields.hq_address           = profile.hq_address;
      if (!company.hq_city && profile.hq_city)                             fields.hq_city              = profile.hq_city;
      if (!company.hq_country && profile.hq_country)                       fields.hq_country           = profile.hq_country;
      if (!company.industry && profile.industry)                           fields.industry             = profile.industry;
      if (!company.company_type && profile.company_type)                   fields.company_type         = profile.company_type;
      if (!company.total_funding_usd && profile.total_funding_usd)         fields.total_funding_usd    = profile.total_funding_usd;

      const needsGeocode = !company.hq_lat && !company.hq_lng;
      const geocodeTarget = fields.hq_city ?? company.hq_city;
      if (needsGeocode && geocodeTarget) {
        try {
          const coords = await geocode(geocodeTarget);
          if (coords) {
            fields.hq_lat = coords.lat;
            fields.hq_lng = coords.lng;
          }
        } catch {
          /* non-fatal */
        }
      }
    }

    await updateCompanyEnrichment(db, company.id, fields);
    logger.info("exa_profile_enriched", {
      company_id: company.id, slug: company.slug,
      found: !!profile, fields_set: Object.keys(fields).filter((k) => k !== "exa_company_enriched_at"),
    });
  } catch (err) {
    logger.error("exa_profile_failed", { company_id: company.id, slug: company.slug, error: String(err) });
  }
}

async function enrichOneCompanyExaSocial(
  db: D1Database,
  company: CompanyRow,
  exaApiKey: string,
  now: number
): Promise<void> {
  try {
    const fallbackKey =
      PASS1_BACKFILL_PRIORITY.find(({ key, stale }) => stale(company[key]))?.key ?? null;

    const deep = await fetchExaDeepSocialData(
      company.name, exaApiKey, company.website_url, fallbackKey, company.industry,
    );
    const fields: Parameters<typeof updateCompanyEnrichment>[2] = {
      exa_social_enriched_at: now,
    };

    if (deep) {
      if (!company.x_url && deep.x_url)                     fields.x_url           = deep.x_url;
      if (!company.instagram_url && deep.instagram_url)      fields.instagram_url   = deep.instagram_url;
      if (!company.tiktok_url && deep.tiktok_url)            fields.tiktok_url      = deep.tiktok_url;
      if (!company.github_url && deep.github_url)            fields.github_url      = deep.github_url;
      if (!company.youtube_url && deep.youtube_url)          fields.youtube_url     = deep.youtube_url;
      if (!company.glassdoor_url && deep.glassdoor_url)      fields.glassdoor_url   = deep.glassdoor_url;
      if (!company.crunchbase_url && deep.crunchbase_url)    fields.crunchbase_url  = deep.crunchbase_url;
      if (!company.huggingface_url && deep.huggingface_url)  fields.huggingface_url = deep.huggingface_url;
      if (!company.facebook_url && deep.facebook_url)        fields.facebook_url    = deep.facebook_url;

      if (deep.fallback?.key && deep.fallback.raw != null && deep.fallback.raw !== "") {
        const { key, raw } = deep.fallback;
        switch (key) {
          case "industry":
            fields.industry = normalizeIndustry(raw as string); break;
          case "company_type":
            fields.company_type = normalizeCompanyType(raw as string); break;
          case "hq_city":
            fields.hq_city = String(raw).trim() || null; break;
          case "hq_country":
            fields.hq_country = normalizeCountryCode(raw as string) ?? (String(raw).trim() || null); break;
          case "employee_count": {
            const n = Math.round(Number(raw));
            if (n > 0) {
              fields.employee_count       = n;
              fields.employee_count_range = normalizeEmployeeCount(n);
            }
            break;
          }
          case "founded_year":
            fields.founded_year = Number(raw) || null; break;
          case "total_funding_usd":
            fields.total_funding_usd = Math.round(Number(raw)) || null; break;
          case "hq_address":
            fields.hq_address = String(raw).trim() || null; break;
          case "linkedin_url":
            fields.linkedin_url = normalizeUrl(raw as string); break;
        }
      }
    }

    await updateCompanyEnrichment(db, company.id, fields);
    logger.info("exa_social_enriched", {
      company_id: company.id, slug: company.slug,
      found: !!deep,
      fallback_field: fallbackKey,
      fields_set: Object.keys(fields).filter((k) => k !== "exa_social_enriched_at"),
    });
  } catch (err) {
    logger.error("exa_social_failed", { company_id: company.id, slug: company.slug, error: String(err) });
  }
}

/**
 * Run Exa enrichment for companies that have never been enriched.
 * Both passes are run-once — exa_company_enriched_at and exa_social_enriched_at
 * are set on completion and never cleared automatically.
 *
 * Per cron: up to EXA_BATCH companies for category pass, same for social pass.
 * Each company gets both calls on its first cron — category then deep.
 */
export async function runExaEnrichment(
  db: D1Database,
  exaApiKey: string,
  logoDevToken?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // ── Profile deep pass ──────────────────────────────────────────────────────
  // Social deep pass is gated on profile being fully complete across ALL companies.
  // Every company must be profile-enriched before any company gets the social pass.
  const profileCompanies = await listCompaniesForExaEnrichment(db, EXA_BATCH);
  if (profileCompanies.length > 0) {
    logger.info("exa_profile_started", { count: profileCompanies.length });
    for (const company of profileCompanies) {
      await enrichOneCompanyExaProfile(db, company, exaApiKey, logoDevToken, now);
    }
    logger.info("exa_profile_completed", { count: profileCompanies.length });
    // Still companies waiting — skip social pass entirely this cron run.
    return;
  }

  // ── Deep social pass ───────────────────────────────────────────────────────
  // Only reached once every company has exa_company_enriched_at set.
  const socialCompanies = await listCompaniesForSocialEnrichment(db, EXA_BATCH);
  if (socialCompanies.length > 0) {
    logger.info("exa_social_started", { count: socialCompanies.length });
    for (const company of socialCompanies) {
      await enrichOneCompanyExaSocial(db, company, exaApiKey, now);
    }
    logger.info("exa_social_completed", { count: socialCompanies.length });
  }

  if (profileCompanies.length === 0 && socialCompanies.length === 0) {
    logger.info("exa_enrichment_skipped", { reason: "all_companies_enriched" });
  }
}

// ─── Logo.dev + Brandfetch + AI pass ──────────────────────────────────────────

async function enrichCompany(
  db: D1Database,
  company: CompanyRow,
  geminiApiKey: string,
  brandfetchClientId: string | undefined,
  logoDevToken?: string
): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const fields: Parameters<typeof updateCompanyEnrichment>[2] = {
      description_enriched_at: now,
    };

    const inferSuppressed = (company.website_infer_suppressed ?? 0) !== 0;
    const slugFallbackDomain = inferSuppressed ? null : `${company.slug}.com`;
    const domain = company.website_url
      ? extractDomain(company.website_url)
      : slugFallbackDomain;

    const logoIsPlaceholder = isLowTrustLogoUrl(company.logo_url);

    // Logo: Logo.dev first (higher-quality square icons), Brandfetch as fallback for social links.
    // Brandfetch is always called when social links are missing (regardless of logo state).
    const needsBrandfetch =
      !company.linkedin_url || !company.x_url || !company.glassdoor_url ||
      (logoIsPlaceholder && !logoDevToken); // also for logo when Logo.dev isn't configured
    let brandfetch: BrandfetchResult | null = null;
    if (brandfetchClientId && domain && needsBrandfetch) {
      brandfetch = await fetchBrandfetchData(domain, brandfetchClientId);
    }

    // Logo priority: Logo.dev → Brandfetch SVG → Google favicon
    if (logoIsPlaceholder && domain) {
      const resolved = await resolveLogoUrl(domain, logoDevToken);
      if (!isLowTrustLogoUrl(resolved)) {
        // Logo.dev returned a real logo
        fields.logo_url = resolved;
      } else {
        // Logo.dev had nothing — use Brandfetch SVG if available, else the favicon
        fields.logo_url = brandfetch?.logo_url ?? resolved;
      }
    } else if (logoIsPlaceholder) {
      fields.logo_url = brandfetch?.logo_url ?? null;
    }

    if (!company.linkedin_url && brandfetch?.linkedin_url) fields.linkedin_url  = brandfetch.linkedin_url;
    if (!company.x_url && brandfetch?.x_url)               fields.x_url         = brandfetch.x_url;
    if (!company.glassdoor_url && brandfetch?.glassdoor_url) fields.glassdoor_url = brandfetch.glassdoor_url;

    if (!company.website_url && domain && !inferSuppressed) {
      fields.website_url = `https://${domain}`;
    }

    // AI description — generated from a sample job description
    if (!company.description) {
      const context = await getCompanyJobContext(db, company.id);
      if (context) {
        try {
          const description = await extractCompanyDescription(geminiApiKey, company.name, context);
          if (description) fields.description = description;
        } catch (aiErr) {
          logger.warn("company_description_ai_failed", { company_id: company.id, error: String(aiErr) });
        }
      }
    }

    await updateCompanyEnrichment(db, company.id, fields);
    logger.info("company_enriched", {
      company_id:     company.id,
      company_name:   company.name,
      fields_updated: Object.keys(fields).filter((k) => k !== "description_enriched_at"),
    });
  } catch (err) {
    logger.error("company_enrichment_failed", { company_id: company.id, error: String(err) });
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Logo-only pass — resolves Logo.dev → Brandfetch → Google favicon for every company
 * with logo_url IS NULL. No staleness gate: this runs immediately after logos are cleared
 * without waiting for the description_enriched_at retry window.
 * Does NOT touch description_enriched_at so it won't re-trigger AI description generation.
 */
export async function runLogoOnlyEnrichment(
  db: D1Database,
  brandfetchClientId?: string,
  logoDevToken?: string,
  limit = 50
): Promise<number> {
  const companies = await listCompaniesNeedingLogo(db, limit);
  if (companies.length === 0) return 0;

  logger.info("logo_only_enrichment_started", { count: companies.length });
  let updated = 0;

  for (const company of companies) {
    try {
      const inferSuppressed = (company.website_infer_suppressed ?? 0) !== 0;
      const slugFallbackDomain = inferSuppressed ? null : `${company.slug}.com`;
      const domain = company.website_url
        ? extractDomain(company.website_url)
        : slugFallbackDomain;

      let logo_url: string | null = null;

      if (domain) {
        // Logo.dev first (domain-based) — highest quality square icons.
        const resolved = await resolveLogoUrl(domain, logoDevToken);
        if (!isLowTrustLogoUrl(resolved)) {
          logo_url = resolved;
        } else if (brandfetchClientId) {
          // Logo.dev had nothing useful — try Brandfetch SVG/icon
          const bf = await fetchBrandfetchData(domain, brandfetchClientId);
          logo_url = bf?.logo_url ?? resolved; // fall back to Google favicon
        } else {
          logo_url = resolved;
        }
      } else {
        // No domain — search Logo.dev by company name (sk_ token only).
        // Top result is used without domain validation; acceptable for well-known names.
        logo_url = await resolveLogoUrlByName(company.name, logoDevToken);
      }

      // Only write if we actually resolved something (avoids stomping null → null)
      if (logo_url) {
        await updateCompanyEnrichment(db, company.id, { logo_url });
        updated++;
        logger.info("logo_only_enriched", { company_id: company.id, slug: company.slug, logo_url });
      } else {
        logger.warn("logo_only_no_domain", { company_id: company.id, slug: company.slug });
      }
    } catch (err) {
      logger.error("logo_only_failed", { company_id: company.id, error: String(err) });
    }
  }

  logger.info("logo_only_enrichment_completed", { found: companies.length, updated });
  // Return updated (not companies.length) so callers can detect when no progress is made
  // and stop looping over domain-less companies that will never resolve.
  return updated;
}

/**
 * Upgrade Brandfetch wordmark logos to Logo.dev square icons.
 * Targets companies where logo_url matches the Brandfetch wordmark path pattern
 * (/theme/<theme>/logo.*). Only upgrades when Logo.dev has a real icon (not a favicon).
 * Does NOT touch description_enriched_at.
 */
export async function runWordmarkUpgrade(
  db: D1Database,
  logoDevToken?: string,
  limit = 50
): Promise<number> {
  const companies = await listCompaniesWithWordmarkLogo(db, limit);
  if (companies.length === 0) return 0;

  logger.info("wordmark_upgrade_started", { count: companies.length });
  let updated = 0;

  for (const company of companies) {
    try {
      const inferSuppressed = (company.website_infer_suppressed ?? 0) !== 0;
      const slugFallbackDomain = inferSuppressed ? null : `${company.slug}.com`;
      const domain = company.website_url
        ? extractDomain(company.website_url)
        : slugFallbackDomain;

      let logo_url: string | null = null;

      if (domain) {
        const resolved = await resolveLogoUrl(domain, logoDevToken);
        if (!isLowTrustLogoUrl(resolved)) {
          logo_url = resolved;
        }
      }

      if (!logo_url) {
        logo_url = await resolveLogoUrlByName(company.name, logoDevToken);
      }

      if (logo_url) {
        await updateCompanyEnrichment(db, company.id, { logo_url });
        updated++;
        logger.info("wordmark_upgraded", { company_id: company.id, slug: company.slug, logo_url });
      }
      // If no Logo.dev icon found, leave the Brandfetch wordmark in place (it's better than nothing)
    } catch (err) {
      logger.error("wordmark_upgrade_failed", { company_id: company.id, error: String(err) });
    }
  }

  logger.info("wordmark_upgrade_completed", { found: companies.length, updated });
  return updated;
}

export async function runCompanyEnrichment(
  db: D1Database,
  geminiApiKey: string,
  brandfetchClientId?: string,
  logoDevToken?: string,
  limit = 50
): Promise<number> {
  const now         = Math.floor(Date.now() / 1000);
  const staleBefore = now - ENRICHMENT_STALE_SECONDS;
  const retryBefore = now - ENRICHMENT_RETRY_SECONDS;

  const companies = await listUnenrichedCompanies(db, staleBefore, retryBefore, limit);
  if (companies.length === 0) {
    logger.info("company_enrichment_skipped", { reason: "no_stale_companies" });
    return 0;
  }

  logger.info("company_enrichment_started", { count: companies.length });

  const ENRICH_COMPANY_CONCURRENCY = 3;
  for (let i = 0; i < companies.length; i += ENRICH_COMPANY_CONCURRENCY) {
    const slice = companies.slice(i, i + ENRICH_COMPANY_CONCURRENCY);
    await Promise.all(
      slice.map((company) =>
        enrichCompany(db, company, geminiApiKey, brandfetchClientId, logoDevToken)
      )
    );
  }

  logger.info("company_enrichment_completed", { count: companies.length });
  return companies.length;
}

/**
 * Exa profile + social (when needed) + Logo.dev / Brandfetch / Gemini for one company.
 * Used by {@link Env.ENRICHMENT_QUEUE} consumer after ingestion touches that company.
 */
export async function enrichCompanyById(env: Env, companyId: string): Promise<void> {
  const db = env.JOBS_DB;
  let company = await getCompanyById(db, companyId);
  if (!company) return;
  const now = Math.floor(Date.now() / 1000);

  if (env.EXA_API_KEY) {
    if (!company.exa_company_enriched_at) {
      await enrichOneCompanyExaProfile(db, company, env.EXA_API_KEY, env.LOGO_DEV_TOKEN, now);
      company = await getCompanyById(db, companyId);
      if (!company) return;
    }
    if (company.exa_company_enriched_at && !company.exa_social_enriched_at) {
      await enrichOneCompanyExaSocial(db, company, env.EXA_API_KEY, now);
      company = await getCompanyById(db, companyId);
      if (!company) return;
    }
  }

  if (env.GEMINI_API_KEY) {
    await enrichCompany(db, company, env.GEMINI_API_KEY, env.BRANDFETCH_CLIENT_ID, env.LOGO_DEV_TOKEN);
  }
}
