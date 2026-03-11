/**
 * Recruitee public board API fetcher.
 *
 * Recruitee exposes a public, unauthenticated JSON endpoint for every company
 * that uses it. No API key required.
 *
 * API format: https://{company}.recruitee.com/api/offers
 *
 * Recruitee is strongest in Europe (especially Netherlands, Germany, UK) and
 * covers a wide range of industries including non-tech roles — well aligned
 * with Curastem's mission to include retail, logistics, and hourly work.
 *
 * Response includes: title, location, remote flag, employment type, workplace
 * type, description HTML, created_at, application URL.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface RecruiteeOffer {
  id: number;
  slug: string;
  title: string;
  location: string | null;         // free-text location string
  city: string | null;
  country: string | null;
  remote: boolean;
  remote_type: string | null;      // "remote" | "hybrid" | null
  employment_type_code: string | null; // "full_time" | "part_time" | "contract" etc.
  description: string | null;      // HTML job description
  requirements: string | null;     // HTML additional requirements section
  careers_url: string;             // canonical job listing URL
  apply_url: string | null;
  created_at: string | null;       // ISO 8601
}

interface RecruiteeResponse {
  offers: RecruiteeOffer[];
}

/**
 * Combine the description and requirements fields into a single raw description.
 * Recruitee sometimes splits these — joining ensures AI extraction has full context.
 */
function buildDescriptionRaw(offer: RecruiteeOffer): string | null {
  const parts: string[] = [];
  if (offer.description) parts.push(offer.description);
  if (offer.requirements) parts.push(offer.requirements);
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Determine location string — prefer city+country over free-text location field.
 */
function resolveLocation(offer: RecruiteeOffer): string | null {
  if (offer.city && offer.country) return `${offer.city}, ${offer.country}`;
  if (offer.city) return offer.city;
  if (offer.country) return offer.country;
  return offer.location ?? null;
}

export const recruiteeFetcher: JobSource = {
  sourceType: "recruitee",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Recruitee API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as RecruiteeResponse;
    const jobs: NormalizedJob[] = [];

    for (const offer of data.offers ?? []) {
      try {
        const locationStr = resolveLocation(offer);
        const workplaceHint = offer.remote_type ?? (offer.remote ? "remote" : null) ?? locationStr;

        jobs.push({
          external_id: String(offer.id),
          title: offer.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(offer.employment_type_code),
          workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
          apply_url: offer.apply_url ?? offer.careers_url,
          source_url: offer.careers_url,
          description_raw: buildDescriptionRaw(offer),
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(offer.created_at),
          company_name: source.name.replace(/\s*\(Recruitee\)\s*/i, "").trim(),
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
