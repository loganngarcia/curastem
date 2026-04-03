/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * GlobalLogic careers — WordPress `gl_career` listing HTML at `globallogic.com/career-search-page/`.
 * Public `wp-json` is disabled for anonymous callers; listings are server-rendered with
 * `a.job_box` links to `/careers/{slug}/`. Detail pages expose `div.career_detail_area` (HTML).
 *
 * `base_url` should be the search root, e.g. `https://www.globallogic.com/career-search-page/`
 * (pagination uses `/career-search-page/page/N/`).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeLocation } from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const MAX_PAGES = 120;
const DETAIL_CONCURRENCY = 8;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

interface ListingRow {
  url: string;
  title: string;
  location: string;
  irc: string;
}

function parseListingHtml(html: string): ListingRow[] {
  const out: ListingRow[] = [];
  const re =
    /<a href="(https:\/\/www\.globallogic\.com\/careers\/[^"]+)"[^>]*class="job_box"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const block = m[2];
    const locParts: string[] = [];
    const locRe = /<span class="job_location">([^<]*)<\/span>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = locRe.exec(block)) !== null) {
      const t = decodeHtmlEntities(lm[1]).trim();
      if (t) locParts.push(t);
    }
    const h4Match = block.match(/<h4>([^<]*)<\/h4>/i);
    const title = h4Match ? decodeHtmlEntities(h4Match[1]).trim() : url;
    const ircMatch = url.match(/irc(\d+)/i);
    if (!ircMatch) continue;
    const irc = `IRC${ircMatch[1]}`;
    out.push({
      url: url.replace(/\/?$/, "/"),
      title,
      location: locParts.join(", "),
      irc,
    });
  }
  return out;
}

/** Inner HTML of `div.career_detail_area` (description, requirements, etc.). */
function extractCareerDetailAreaHtml(html: string): string | null {
  const open = '<div class="career_detail_area">';
  const start = html.indexOf(open);
  if (start === -1) return null;
  const contentStart = start + open.length;
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = contentStart;
  let dm: RegExpExecArray | null;
  while ((dm = re.exec(html)) !== null) {
    const tag = dm[0];
    if (tag.startsWith("</")) depth--;
    else depth++;
    if (depth === 0) {
      return html.slice(contentStart, dm.index).trim();
    }
  }
  return null;
}

async function fetchDetailDescriptionHtml(jobUrl: string): Promise<string | null> {
  const res = await fetch(jobUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return extractCareerDetailAreaHtml(await res.text());
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

export const globallogicFetcher: JobSource = {
  sourceType: "globallogic",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const root = source.base_url.trim().replace(/\/?$/, "");
    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || "GlobalLogic";

    const byIrc = new Map<string, ListingRow>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? `${root}/` : `${root}/page/${page}/`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
      if (!res.ok) break;

      const html = await res.text();
      const rows = parseListingHtml(html);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (!byIrc.has(row.irc)) byIrc.set(row.irc, row);
      }
    }

    const listingRows = Array.from(byIrc.values());
    const descriptions = await parallelMap(listingRows, DETAIL_CONCURRENCY, async (row) =>
      fetchDetailDescriptionHtml(row.url)
    );

    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < listingRows.length; i++) {
      const row = listingRows[i];
      const applyUrl = row.url;
      try {
        jobs.push({
          external_id: row.irc,
          title: row.title,
          location: normalizeLocation(row.location || "Multiple locations"),
          employment_type: null,
          workplace_type: null,
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: descriptions[i] ?? null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: null,
          company_name: companyName,
          company_logo_url: null,
          company_website_url: null,
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
