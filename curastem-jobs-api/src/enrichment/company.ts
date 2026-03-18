/**
 * Company enrichment — populates logo_url, website_url, linkedin_url, x_url,
 * glassdoor_url, and AI-generated description for companies missing these fields.
 *
 * Enrichment strategy (in priority order):
 *   1. Brandfetch API — returns logo + social links (LinkedIn, X, Glassdoor) for
 *      most known companies. Free tier: 500 req/day. Requires BRANDFETCH_CLIENT_ID.
 *   2. Google Favicon CDN — free, no auth, always returns an image for any domain.
 *      Used when Brandfetch is not configured or returns no logo.
 *   3. Slug-based inference — last resort for LinkedIn/X when APIs return nothing.
 *
 * Runs after every ingestion cron pass. Non-blocking — failures are logged and
 * skipped so one bad company never stops the rest.
 */

import { extractCompanyDescription } from "./ai.ts";
import { listUnenrichedCompanies, updateCompanyEnrichment } from "../db/queries.ts";
import { logger } from "../utils/logger.ts";
import type { CompanyRow } from "../types.ts";

const ENRICHMENT_STALE_SECONDS   = 7 * 24 * 60 * 60; // full re-enrich every 7 days
const ENRICHMENT_RETRY_SECONDS   = 24 * 60 * 60;      // retry missing fields every 24h

// ─── Brandfetch ───────────────────────────────────────────────────────────────

interface BrandfetchFormat {
  src: string;
  format: string; // "svg" | "png" | "jpeg" | "webp"
  background: string | null;
  height: number | null;
  width: number | null;
}

interface BrandfetchLogo {
  type: string;   // "logo" | "icon" | "other"
  theme: string | null;
  formats: BrandfetchFormat[];
}

interface BrandfetchLink {
  name: string; // "linkedin" | "twitter" | "glassdoor" | "facebook" | ...
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

const LOGO_MAX_PX = 64;

function pickLogoUrl(logos: BrandfetchLogo[] | undefined): string | null {
  if (!logos || logos.length === 0) return null;
  // Prefer "logo" type over icons; prefer SVG (scalable, tiny file) then smallest PNG
  const sorted = [...logos].sort((a) => (a.type === "logo" ? -1 : 1));
  for (const logo of sorted) {
    const svgFormat = logo.formats?.find((f) => f.format === "svg");
    if (svgFormat?.src) return svgFormat.src;

    // For raster formats, pick the smallest one that's still >= LOGO_MAX_PX (or
    // the smallest overall if none meet the threshold)
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
      x_url:         linkMap["twitter"]  ?? null, // Brandfetch still uses "twitter"
      glassdoor_url: linkMap["glassdoor"] ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Google Favicon fallback ──────────────────────────────────────────────────

// Returns a Google-hosted favicon URL for the domain. No HTTP call needed —
// Google always serves an image (falls back to a generic icon for unknown domains),
// making this a zero-latency, always-available fallback.
function getGoogleFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${LOGO_MAX_PX}`;
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

// ─── Core enrichment ─────────────────────────────────────────────────────────

async function enrichCompany(
  db: D1Database,
  company: CompanyRow,
  geminiApiKey: string,
  brandfetchClientId: string | undefined
): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const fields: Parameters<typeof updateCompanyEnrichment>[2] = {
      description_enriched_at: now,
    };

    // Resolve the best domain for API lookups — use stored website_url if available,
    // fall back to slug.com which works for many but not all startups.
    const domain = company.website_url
      ? extractDomain(company.website_url)
      : `${company.slug}.com`;

    // Brandfetch: one call returns logo + all social links.
    // Only fetch if at least one field is missing — avoids wasting free-tier quota
    // on companies that are already fully enriched.
    const needsBrandfetch =
      !company.logo_url || !company.linkedin_url || !company.x_url || !company.glassdoor_url;
    let brandfetch: BrandfetchResult | null = null;
    if (brandfetchClientId && domain && needsBrandfetch) {
      brandfetch = await fetchBrandfetchData(domain, brandfetchClientId);
    }

    if (!company.logo_url) {
      fields.logo_url =
        brandfetch?.logo_url ??
        (domain ? getGoogleFaviconUrl(domain) : null);
    }

    if (!company.linkedin_url && brandfetch?.linkedin_url) {
      fields.linkedin_url = brandfetch.linkedin_url;
    }

    if (!company.x_url && brandfetch?.x_url) {
      fields.x_url = brandfetch.x_url;
    }

    if (!company.glassdoor_url && brandfetch?.glassdoor_url) {
      fields.glassdoor_url = brandfetch.glassdoor_url;
    }

    if (!company.website_url && domain) {
      fields.website_url = `https://${domain}`;
    }

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
  brandfetchClientId?: string
): Promise<void> {
  const now         = Math.floor(Date.now() / 1000);
  const staleBefore = now - ENRICHMENT_STALE_SECONDS;
  const retryBefore = now - ENRICHMENT_RETRY_SECONDS;

  const companies = await listUnenrichedCompanies(db, staleBefore, retryBefore);
  if (companies.length === 0) {
    logger.info("company_enrichment_skipped", { reason: "no_stale_companies" });
    return;
  }

  logger.info("company_enrichment_started", { count: companies.length });

  for (const company of companies) {
    await enrichCompany(db, company, geminiApiKey, brandfetchClientId);
  }

  logger.info("company_enrichment_completed", { count: companies.length });
}
