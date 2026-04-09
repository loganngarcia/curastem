/**
 * Aramark careers — custom WordPress REST endpoint used by the public search SPA.
 *
 * `GET /wp-json/aramark/jobs` returns a JSON array (~5k rows) with req_id, title,
 * city/state, and pub_date. Listing is client-rendered; this API is the stable discovery surface.
 *
 * Full job text lives on each posting page as `application/ld+json` JobPosting (`description`
 * is HTML). We fetch posting URLs in parallel, then **`htmlToText`** (same as AI enrichment)
 * so `description_raw` is plain text.
 *
 * `base_url` should be `https://careers.aramark.com/wp-json/aramark/jobs`.
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 20;

function descriptionRawFromHtml(html: string | null | undefined): string | null {
  if (html == null || !html.trim()) return null;
  const t = htmlToText(html);
  return t.length > 0 ? t : null;
}

interface AramarkJobRow {
  req_id?: string;
  title?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  url?: string;
  type?: string;
  pub_date?: string;
}

interface JobPostingLd {
  "@type"?: string;
  description?: string;
}

function employmentFromAramarkType(raw: string | undefined): EmploymentType | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("salaried")) return "full_time";
  return null;
}

function locationFromRow(row: AramarkJobRow): string | null {
  const city = (row.city ?? "").trim();
  const st = (row.state ?? "").trim();
  const zip = (row.zipcode ?? "").trim();
  if (city && st) {
    return zip ? `${city}, ${st} ${zip}` : `${city}, ${st}`;
  }
  if (city) return city;
  return null;
}

function extractJobPostingDescription(html: string): string | null {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = JSON.parse(m[1].trim()) as JobPostingLd | JobPostingLd[];
      const one = Array.isArray(raw) ? raw.find((x) => x?.["@type"] === "JobPosting") : raw;
      if (one?.["@type"] !== "JobPosting") continue;
      const d = one.description;
      if (typeof d === "string" && d.trim().length > 0) return d.trim();
    } catch {
      continue;
    }
  }
  return null;
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

export const aramarkCareersFetcher: JobSource = {
  sourceType: "aramark_careers",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const apiUrl = source.base_url.trim();
    if (!apiUrl.includes("aramark") || !apiUrl.includes("aramark/jobs")) {
      throw new Error(`aramark_careers: base_url must be the Aramark jobs JSON endpoint (${apiUrl})`);
    }

    const res = await fetch(apiUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`aramark_careers: ${res.status} (${apiUrl})`);
    }

    const rows = (await res.json()) as AramarkJobRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`aramark_careers: empty or invalid JSON (${source.company_handle})`);
    }

    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || "Aramark";

    const skeletons: NormalizedJob[] = [];
    for (const row of rows) {
      const reqId = (row.req_id ?? "").trim();
      const title = (row.title ?? "").trim();
      if (!reqId || !title) continue;

      const locRaw = locationFromRow(row);
      const postingUrl = `https://careers.aramark.com/job/?req_id=${encodeURIComponent(reqId)}`;
      const employment = employmentFromAramarkType(row.type);

      skeletons.push({
        external_id: reqId,
        title,
        location: normalizeLocation(locRaw),
        employment_type: employment,
        workplace_type: normalizeWorkplaceType(null, locRaw),
        apply_url: postingUrl,
        source_url: postingUrl,
        description_raw: null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: parseEpochSeconds(row.pub_date ?? null),
        company_name: companyName,
        company_logo_url: null,
        company_website_url: null,
      });
    }

    if (skeletons.length === 0) {
      throw new Error(`aramark_careers: 0 jobs parsed from ${rows.length} row(s) (${source.company_handle})`);
    }

    return parallelMap(skeletons, DETAIL_CONCURRENCY, async (job) => {
      const pageRes = await fetch(job.apply_url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!pageRes.ok) return job;
      const html = await pageRes.text();
      const descHtml = extractJobPostingDescription(html);
      const text = descriptionRawFromHtml(descHtml);
      if (!text) return job;
      return { ...job, description_raw: text };
    });
  },
};
