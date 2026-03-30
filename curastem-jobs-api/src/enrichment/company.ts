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
 *   3. Brandfetch — fallback for logo / any social links still null after Exa.
 *   4. Logo.dev (img.logo.dev) — raster logo by domain when configured; Google
 *      Favicon CDN as fallback.
 *   5. Gemini AI — generates a one-sentence company description from job text.
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
  listCompaniesForExaEnrichment,
  listCompaniesForSocialEnrichment,
  updateCompanyEnrichment,
} from "../db/queries.ts";
import { geocode } from "../utils/geocode.ts";
import { logger } from "../utils/logger.ts";
import { LOGO_MAX_PX, isLowTrustLogoUrl, resolveLogoUrl } from "../utils/logoUrl.ts";
import type { CompanyRow } from "../types.ts";

const ENRICHMENT_STALE_SECONDS = 7 * 24 * 60 * 60; // full Brandfetch/AI re-enrich every 7 days
const ENRICHMENT_RETRY_SECONDS = 24 * 60 * 60;     // retry missing fields every 24h
const EXA_BATCH = 10; // companies per cron run — category + deep run sequentially, well under 10 QPS

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

function pickLogoUrl(logos: BrandfetchLogo[] | undefined): string | null {
  if (!logos || logos.length === 0) return null;
  const sorted = [...logos].sort((a) => (a.type === "logo" ? -1 : 1));
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
      try {
        const profile = await fetchExaDeepProfileData(company.name, exaApiKey, company.website_url);
        // Always mark as attempted — prevents immediate retry on null result
        const fields: Parameters<typeof updateCompanyEnrichment>[2] = {
          exa_company_enriched_at: now,
        };

        if (profile) {
          const inferSuppressed = (company.website_infer_suppressed ?? 0) !== 0;

          if (!company.website_url && profile.website_url && !inferSuppressed)
            fields.website_url = profile.website_url;

          // Logo: derive favicon from the resolved domain
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

          // Geocode HQ city if we just got a city and don't already have coords
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
              // Non-fatal — coords are enrichment metadata
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
      try {
        // Use the free 10th schema slot to backfill the highest-priority null Pass 1 field.
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

          // Apply the Pass 1 fallback field if Exa returned a value for it
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
    logger.info("exa_social_completed", { count: socialCompanies.length });
  }

  if (profileCompanies.length === 0 && socialCompanies.length === 0) {
    logger.info("exa_enrichment_skipped", { reason: "all_companies_enriched" });
  }
}

// ─── Brandfetch + AI pass ─────────────────────────────────────────────────────

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

    // Brandfetch: fallback for logo/social links still missing or only low-res after Exa pass
    const needsBrandfetch =
      logoIsPlaceholder || !company.linkedin_url || !company.x_url || !company.glassdoor_url;
    let brandfetch: BrandfetchResult | null = null;
    if (brandfetchClientId && domain && needsBrandfetch) {
      brandfetch = await fetchBrandfetchData(domain, brandfetchClientId);
    }

    // Logo: upgrade any placeholder (Google favicon / img.logo.dev) to Brandfetch SVG → Logo.dev → Google favicon
    if (logoIsPlaceholder) {
      fields.logo_url =
        brandfetch?.logo_url ??
        (domain ? await resolveLogoUrl(domain, logoDevToken) : null);
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

  for (const company of companies) {
    await enrichCompany(db, company, geminiApiKey, brandfetchClientId, logoDevToken);
  }

  logger.info("company_enrichment_completed", { count: companies.length });
  return companies.length;
}
