/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Uber corporate careers (Fusion / uber-sites) — public JSON RPC.
 *
 * The job search UI loads results via:
 *   POST https://www.uber.com/api/loadSearchJobsResults?localeCode={lang}
 *   Body: { "limit": number, "page": number, "params": {} }
 *
 * The RPC name is wired in the Fusion chunk (`loadSearchJobsResults` + `ue.A1` hook).
 * Pagination is 0-based `page`; `totalResults.low` is the total count.
 *
 * `base_url` may be either:
 *   - The API URL (recommended), e.g. `https://www.uber.com/api/loadSearchJobsResults?localeCode=en`
 *   - A careers list URL, e.g. `https://www.uber.com/us/en/careers/list/` — localeCode is taken from
 *     the path segment before `careers` (e.g. `us/en` → `en`).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** Match browser traffic so Cloudflare accepts the RPC from datacenter IPs. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface UberLocation {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryName?: string | null;
}

interface UberJobRow {
  id: number;
  title: string;
  description?: string | null;
  timeType?: string | null;
  location?: UberLocation | null;
  allLocations?: UberLocation[] | null;
  creationDate?: string | null;
}

interface UberTotalResults {
  low?: number;
}

interface UberSearchResponse {
  status?: string;
  data?: {
    results?: UberJobRow[];
    totalResults?: UberTotalResults;
  };
}

function formatUberLocation(loc: UberLocation | null | undefined): string {
  if (!loc) return "";
  const city = (loc.city ?? "").trim();
  const region = (loc.region ?? "").trim();
  const country = (loc.countryName ?? loc.country ?? "").trim();
  const parts: string[] = [];
  if (city) {
    if (region) parts.push(`${city}, ${region}`);
    else parts.push(city);
  } else if (region) {
    parts.push(region);
  }
  if (country && !parts.some((p) => p.includes(country))) {
    parts.push(country);
  }
  return parts.join(", ").trim();
}

/**
 * Resolve POST URL for loadSearchJobsResults from migrate `base_url`.
 */
function resolveUberSitesApiUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  if (u.pathname.includes("/api/loadSearchJobsResults")) {
    const qs = u.searchParams;
    if (!qs.has("localeCode")) {
      qs.set("localeCode", "en");
    }
    return `${u.origin}${u.pathname}?${qs.toString()}`;
  }

  const parts = u.pathname.split("/").filter(Boolean);
  const ci = parts.indexOf("careers");
  const localeCode =
    ci >= 1 ? parts[ci - 1] ?? "en" : "en";
  return `https://www.uber.com/api/loadSearchJobsResults?localeCode=${encodeURIComponent(localeCode)}`;
}

function jobApplyUrl(jobId: number, localeCode: string): string {
  const lang = localeCode || "en";
  return `https://www.uber.com/us/${lang}/careers/list/${jobId}`;
}

export const uberSitesFetcher: JobSource = {
  sourceType: "uber_sites",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const apiUrl = resolveUberSitesApiUrl(source.base_url);
    const localeCode = new URL(apiUrl).searchParams.get("localeCode") ?? "en";

    const jobs: NormalizedJob[] = [];
    let page = 0;
    let total = Infinity;

    while (page < MAX_PAGES) {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-csrf-token": "x",
          Origin: "https://www.uber.com",
          Referer: `https://www.uber.com/us/${localeCode}/careers/list/`,
        },
        body: JSON.stringify({ limit: PAGE_SIZE, page, params: {} }),
      });

      if (!res.ok) {
        throw new Error(`Uber sites API error ${res.status} for ${source.company_handle}`);
      }

      const payload = (await res.json()) as UberSearchResponse;
      if (payload.status !== "success" || !payload.data) {
        throw new Error(`Uber sites API unexpected payload for ${source.company_handle}`);
      }

      const data = payload.data;
      if (typeof data.totalResults?.low === "number") {
        total = data.totalResults.low;
      }

      const batch = data.results ?? [];
      if (batch.length === 0) break;

      for (const row of batch) {
        const title = typeof row.title === "string" ? row.title.trim() : "";
        if (!title) continue;

        const locPrimary = row.location ?? row.allLocations?.[0] ?? null;
        const locStr = formatUberLocation(locPrimary);
        const locationRaw = locStr || null;

        const postedAt = parseEpochSeconds(row.creationDate ?? null);

        const applyUrl = jobApplyUrl(row.id, localeCode);

        jobs.push({
          external_id: String(row.id),
          title,
          location: normalizeLocation(locationRaw),
          employment_type: normalizeEmploymentType(row.timeType ?? null),
          workplace_type: normalizeWorkplaceType(null, locationRaw ?? undefined),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: row.description?.trim() ?? null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: postedAt,
          company_name: source.name.replace(/\s*\(Uber Sites\)\s*/i, "").trim(),
        });
      }

      if (jobs.length >= total || batch.length < PAGE_SIZE) break;
      page += 1;
    }

    return jobs;
  },
};
