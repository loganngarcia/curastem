/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Framer-hosted sites — job pages are listed in the same search index JSON the
 * published site uses for Framer Search (static CDN URL, no headless browser).
 *
 * `base_url` must be the Framer CDN `searchIndex-*.json` URL plus `site_origin`:
 *   https://framerusercontent.com/sites/{siteId}/searchIndex-{hash}.json?site_origin=https://example.com
 *
 * Ingests paths matching /careers/{slug} only (skips legacy duplicate paths, regional trees like /careers-kz/, and the /careers index).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

// Job detail pages only (not /careers index or /careers-kz/...).
const CAREER_JOB_PATH = /^\/careers\/[^/]+$/;

interface FramerSearchEntry {
  title?: string;
  description?: string;
  h1?: string[];
  p?: string[];
}

function parseBaseUrl(raw: string): { indexUrl: string; siteOrigin: string } {
  const u = new URL(raw);
  const siteOrigin = u.searchParams.get("site_origin");
  if (!siteOrigin?.startsWith("http")) {
    throw new Error(`framer source: add site_origin query (public site URL), got: ${raw}`);
  }
  u.search = "";
  return { indexUrl: u.toString(), siteOrigin: siteOrigin.replace(/\/$/, "") };
}

function pickTitle(entry: FramerSearchEntry): string {
  const h1 = entry.h1?.[0]?.trim();
  if (h1) return h1;
  const t = (entry.title ?? "").trim();
  const cut = t.indexOf(" - ");
  if (cut > 0) return t.slice(0, cut).trim();
  return t;
}

function extractLocation(description: string | null, paragraphs: string[] | undefined): string | null {
  const blob = [description ?? "", ...(paragraphs ?? [])].join("\n");
  const locMatch = blob.match(/Location:\s*([^\n<]+)/i);
  if (locMatch) return normalizeLocation(locMatch[1].trim());
  if (/\bremote\b/i.test(blob)) return normalizeLocation("Remote");
  return null;
}

export const framerFetcher: JobSource = {
  sourceType: "framer",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { indexUrl, siteOrigin } = parseBaseUrl(source.base_url);
    const res = await fetch(indexUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Framer search index HTTP ${res.status} (${source.company_handle})`);
    }

    const data = (await res.json()) as Record<string, FramerSearchEntry>;
    const companyName =
      source.name.replace(/\s*\(Framer\)\s*/i, "").trim() || source.company_handle;

    const jobs: NormalizedJob[] = [];

    for (const [path, entry] of Object.entries(data)) {
      if (!CAREER_JOB_PATH.test(path)) continue;

      const title = pickTitle(entry);
      if (!title) continue;

      const desc = entry.description?.trim() ?? null;
      const location = extractLocation(desc, entry.p);
      const applyUrl = new URL(path, siteOrigin).href;
      const salary = parseSalary(desc ?? "");

      jobs.push({
        external_id: path.replace(/^\//, ""),
        title,
        location,
        employment_type: normalizeEmploymentType(null),
        workplace_type: normalizeWorkplaceType(null, location ?? ""),
        apply_url: applyUrl,
        source_url: applyUrl,
        description_raw: desc,
        salary_min: salary.min,
        salary_max: salary.max,
        salary_currency: salary.currency,
        salary_period: salary.period,
        posted_at: null,
        company_name: companyName,
        company_website_url: siteOrigin,
      });
    }

    return jobs;
  },
};
