/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Lever public postings API fetcher.
 *
 * Lever exposes a public, unauthenticated JSON API for all companies using it.
 * No API key required.
 *
 * API format: https://api.lever.co/v0/postings/{company}?mode=json
 *
 * Lever includes a `createdAt` timestamp (milliseconds epoch) on every posting,
 * which is more reliable than Greenhouse's `updated_at`.
 *
 * Lever job descriptions are HTML and include a structured `lists` array
 * with additional role details (responsibilities, requirements, etc.).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface LeverCommitmentAndTeam {
  text: string;
}

interface LeverList {
  text: string;
  content: string; // HTML
}

interface LeverPosting {
  id: string;
  text: string;           // job title
  categories: {
    commitment?: string;  // employment type hint: "Full-time", "Part-time", etc.
    location?: string;
    team?: string;
    department?: string;
    allLocations?: string[];
  };
  tags: string[];
  createdAt: number;      // milliseconds epoch
  hostedUrl: string;
  applyUrl: string;
  descriptionPlain: string | null;
  description: string;    // HTML
  lists: LeverList[];     // structured sections (responsibilities, requirements, etc.)
  commitment: LeverCommitmentAndTeam;
  workplaceType?: string; // "remote" | "on-site" | "hybrid" — present in newer Lever versions
}

/**
 * Combine Lever's description HTML and lists into a single raw description.
 * Lever separates main description from list sections — we join them so the
 * AI extraction pass has the full context in one field.
 */
function buildDescriptionRaw(posting: LeverPosting): string {
  const parts: string[] = [];
  if (posting.description) parts.push(posting.description);
  for (const list of posting.lists ?? []) {
    if (list.text) parts.push(`<h3>${list.text}</h3>`);
    if (list.content) parts.push(list.content);
  }
  return parts.join("\n");
}

export const leverFetcher: JobSource = {
  sourceType: "lever",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const url = `${source.base_url}?mode=json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Lever API error ${res.status} for ${source.company_handle}`);
    }

    const postings = (await res.json()) as LeverPosting[];
    const jobs: NormalizedJob[] = [];

    for (const posting of postings ?? []) {
      try {
        const locationRaw = posting.categories?.location ?? null;
        const allLocations = posting.categories?.allLocations ?? [];
        const locationStr = locationRaw ?? allLocations[0] ?? null;
        const workplaceHint = posting.workplaceType ?? locationStr ?? null;

        jobs.push({
          external_id: posting.id,
          title: posting.text,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(posting.commitment?.text ?? posting.categories?.commitment ?? null),
          workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
          // hostedUrl = job listing page (shows description + Apply button)
          // applyUrl  = direct form URL (/apply suffix, skips description)
          apply_url: posting.hostedUrl,
          source_url: posting.hostedUrl,
          description_raw: buildDescriptionRaw(posting),
          salary_min: null,  // Lever board API does not include salary in public data
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(posting.createdAt), // createdAt is ms epoch
          company_name: source.name.replace(/\s*\(Lever\)\s*/i, "").trim(),
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
