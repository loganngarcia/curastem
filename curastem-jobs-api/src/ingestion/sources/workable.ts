/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Workable public widget API fetcher.
 *
 * Workable exposes an unauthenticated public widget endpoint for every company
 * that has enabled the careers page. No API key required.
 *
 * API format: https://apply.workable.com/api/v1/widget/accounts/{handle}
 *
 * The v1 widget list omits full job descriptions. After listing, we call the public
 * v2 job endpoint per posting (same host, unauthenticated) for HTML `description`,
 * `requirements`, and `benefits`:
 *   GET https://apply.workable.com/api/v2/accounts/{handle}/jobs/{shortcode}
 *
 * Workable is strong in SaaS companies, agencies, and mid-market businesses
 * globally, with a meaningful presence in Europe, MENA, and Latin America.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;

interface WorkableJob {
  shortcode: string; // Workable's unique job identifier (e.g. "CCBE25DC0C")
  title: string;
  city: string | null;
  state: string | null;
  country: string | null;
  location_str: string | null; // pre-formatted location string (may not exist)
  employment_type: string | null; // "Full-time" | "Part-time" etc.
  telecommuting: boolean | null; // true = remote
  published_on: string | null; // "YYYY-MM-DD"
  url: string; // canonical application URL
  locations: Array<{ country: string; city: string; region: string }> | null;
}

interface WorkableResponse {
  jobs: WorkableJob[];
  company: {
    name: string;
    url: string;
  };
}

interface WorkableV2Job {
  description?: string | null;
  requirements?: string | null;
  benefits?: string | null;
}

/**
 * Build a human-readable location string from Workable's location fields.
 * Prefers the structured `locations` array (multi-location support), falls back
 * to the top-level city/state/country fields for older API responses.
 */
function buildLocation(job: WorkableJob): string | null {
  if (job.locations && job.locations.length > 0) {
    const loc = job.locations[0];
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  const parts = [job.city, job.state, job.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** `.../api/v1/widget/accounts/{slug}` → slug */
function extractWidgetAccountSlug(baseUrl: string): string | null {
  const m = baseUrl.trim().match(/\/widget\/accounts\/([^/?]+)/i);
  return m ? m[1] : null;
}

function mergeV2Description(d: WorkableV2Job): string | null {
  const parts = [d.description, d.requirements, d.benefits].filter((x) => x && String(x).trim());
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

async function fetchV2JobHtml(accountSlug: string, shortcode: string): Promise<string | null> {
  const url = `https://apply.workable.com/api/v2/accounts/${accountSlug}/jobs/${shortcode}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const d = (await res.json()) as WorkableV2Job;
  return mergeV2Description(d);
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const workableFetcher: JobSource = {
  sourceType: "workable",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Workable API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as WorkableResponse;
    const jobs: NormalizedJob[] = [];

    for (const job of data.jobs ?? []) {
      try {
        const locationStr = buildLocation(job);

        const workplaceType = job.telecommuting
          ? "remote"
          : normalizeWorkplaceType(null, locationStr);

        jobs.push({
          external_id: job.shortcode,
          title: job.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(job.employment_type),
          workplace_type: workplaceType,
          apply_url: job.url,
          source_url: job.url,
          description_raw: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(job.published_on),
          company_name: source.name.replace(/\s*\(Workable\)\s*/i, "").trim(),
        });
      } catch {
        continue;
      }
    }

    const slug = extractWidgetAccountSlug(source.base_url);
    if (slug && jobs.length > 0) {
      const descriptions = await parallelMap(jobs, DETAIL_CONCURRENCY, async (row) =>
        fetchV2JobHtml(slug, row.external_id)
      );
      for (let i = 0; i < jobs.length; i++) {
        const desc = descriptions[i];
        if (desc) jobs[i] = { ...jobs[i], description_raw: desc };
      }
    }

    return jobs;
  },
};
