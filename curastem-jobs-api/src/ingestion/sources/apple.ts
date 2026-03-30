/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Apple Jobs — HTML search results fetcher.
 *
 * The legacy POST `https://jobs.apple.com/api/role/search` returns 301 → apple.com/pagenotfound.
 * The careers site serves filterable search pages with server-rendered rows, e.g.
 *   https://jobs.apple.com/en-us/search?location=united-states-USA
 * Pagination uses `&page=` (1-based). Each row includes title, location, posted date, and
 * a link to `/en-us/details/{id}/{slug}`. Full job descriptions are not in the list HTML;
 * `description_raw` is left null (enrichment can fill later).
 *
 * `base_url` must be a jobs.apple.com search URL (path + query filters you want), for example:
 *   https://jobs.apple.com/en-us/search?location=united-states-USA
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const MAX_PAGES = 50;

const LINK_RE =
  /<a[^>]*class="[^"]*link-inline[^"]*t-intro[^"]*"[^>]*href="(\/en-us\/details\/[^"?]+)[^"]*"[^>]*>([^<]*)<\/a>/gi;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, " ");
}

function externalIdFromPath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const idx = parts.indexOf("details");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

function extractLocationForward(html: string, linkStart: number): string | null {
  const window = html.slice(linkStart, linkStart + 4500);
  const loc =
    window.match(/search-store-name-container-\d+">([^<]+)</i) ??
    window.match(/class="table--advanced-search__location-sub"[^>]*>([^<]+)</i);
  return loc ? decodeHtmlEntities(loc[1].trim()) : null;
}

function extractPostedForward(html: string, linkStart: number): string | null {
  const window = html.slice(linkStart, linkStart + 1500);
  const m = window.match(/class="job-posted-date"[^>]*>([^<]+)</i);
  return m ? m[1].trim() : null;
}

export const appleFetcher: JobSource = {
  sourceType: "apple",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const base = new URL(source.base_url.trim());
    if (base.hostname !== "jobs.apple.com") {
      throw new Error(`apple: base_url must be on jobs.apple.com, got ${base.hostname}`);
    }

    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(base.toString());
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (!res.ok) {
        throw new Error(`apple: search HTML ${res.status} for ${url}`);
      }

      const html = await res.text();
      let pageNew = 0;

      LINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LINK_RE.exec(html)) !== null) {
        const path = m[1];
        const titleRaw = m[2];
        const title = decodeHtmlEntities(titleRaw.trim());
        if (!title) continue;

        const external_id = externalIdFromPath(path);
        if (!external_id) continue;
        if (seen.has(external_id)) continue;
        seen.add(external_id);
        pageNew++;

        const linkStart = m.index ?? 0;
        const locationStr = extractLocationForward(html, linkStart);
        const postedRaw = extractPostedForward(html, linkStart);
        const posted_at = parseEpochSeconds(postedRaw);

        const applyUrl = `https://jobs.apple.com${path.split("?")[0]}`;

        jobs.push({
          external_id,
          title,
          location: normalizeLocation(locationStr),
          employment_type: null,
          workplace_type: normalizeWorkplaceType(locationStr, locationStr),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at,
          company_name: "Apple",
          company_logo_url: null,
          company_website_url: null,
        });
      }

      if (pageNew === 0) break;
    }

    if (jobs.length === 0) {
      throw new Error(`apple: 0 jobs parsed from ${source.base_url} (${source.company_handle})`);
    }

    return jobs;
  },
};
