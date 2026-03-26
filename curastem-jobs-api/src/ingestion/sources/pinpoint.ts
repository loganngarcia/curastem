/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Pinpoint public postings API fetcher.
 *
 * Pinpoint exposes a public, unauthenticated JSON endpoint for every company
 * that has enabled their careers site. No API key required.
 *
 * API format: https://{handle}.pinpointhq.com/postings.json
 *
 * Pinpoint is used broadly across hospitality, nonprofits, professional
 * services, and tech companies — well aligned with Curastem's goal to serve
 * diverse job categories beyond traditional tech hiring.
 *
 * Response includes: title, location, employment type, workplace type,
 * description HTML, application URL, and posting date.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface PinpointPosting {
  id: number;
  title: string;
  location: string | null;
  employment_type: string | null;   // "Full time" | "Part time" | "Contract" etc.
  remote: boolean | null;
  remote_type: string | null;       // "remote" | "hybrid" | null
  description: string | null;       // HTML job description
  team: string | null;              // department / team name
  published_at: string | null;      // ISO 8601
  apply_path: string | null;        // relative path, e.g. "/postings/123"
}

interface PinpointResponse {
  postings: PinpointPosting[];
}

/**
 * Construct the full application URL from the company handle and the relative apply path.
 */
function buildApplyUrl(handle: string, posting: PinpointPosting): string {
  const base = `https://${handle}.pinpointhq.com`;
  if (posting.apply_path) return `${base}${posting.apply_path}`;
  return `${base}/postings/${posting.id}`;
}

export const pinpointFetcher: JobSource = {
  sourceType: "pinpoint",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Pinpoint API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as PinpointResponse;
    const jobs: NormalizedJob[] = [];

    for (const posting of data.postings ?? []) {
      try {
        const workplaceHint = posting.remote_type ?? (posting.remote ? "remote" : null) ?? posting.location;
        const applyUrl = buildApplyUrl(source.company_handle, posting);

        jobs.push({
          external_id: String(posting.id),
          title: posting.title,
          location: normalizeLocation(posting.location),
          employment_type: normalizeEmploymentType(posting.employment_type),
          workplace_type: normalizeWorkplaceType(workplaceHint, posting.location),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: posting.description ?? null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(posting.published_at),
          company_name: source.name.replace(/\s*\(Pinpoint\)\s*/i, "").trim(),
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
