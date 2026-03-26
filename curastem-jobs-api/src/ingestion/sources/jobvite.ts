/**
 * Jobvite career sites (`jobs.jobvite.com/{slug}/jobs`).
 *
 * Job discovery: the listing page at `jobs.jobvite.com/{slug}/jobs` renders all
 * open roles in static HTML as `<tr>` rows — no JS required. Each row has the
 * job id in `href="/slug/job/{id}"` and the location in `.jv-job-list-location`.
 * All jobs appear on a single page (Jobvite groups by category, no server-side pagination).
 *
 * Job detail: each detail page at `jobs.jobvite.com/{slug}/job/{id}` contains
 * the full description HTML inside `div.jv-job-detail-description`. The title
 * and apply URL are extracted from the `preloadedData` AngularJS constant.
 *
 * `base_url` is the board root (`https://jobs.jobvite.com/{slug}/jobs`) or any
 * single-job URL under it (normalized to the board root automatically).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeLocation } from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;

/** Derive the board root from a board or single-job URL. */
function parseBoardRoot(input: string): { origin: string; slug: string; listingUrl: string } {
  const u = new URL(input.trim());
  if (u.hostname !== "jobs.jobvite.com") {
    throw new Error(`jobvite base_url must use host jobs.jobvite.com, got ${input}`);
  }
  const m = u.pathname.match(/^\/([^/]+)/);
  if (!m) throw new Error(`jobvite: cannot extract slug from ${input}`);
  const slug = m[1];
  return {
    origin: u.origin,
    slug,
    listingUrl: `${u.origin}/${slug}/jobs`,
  };
}

interface ListingRow {
  id: string;
  title: string;
  location: string;
}

/** Parse all job rows from the static listing HTML. */
function parseListingRows(html: string, slug: string): ListingRow[] {
  const out: ListingRow[] = [];
  // Each job is a <tr> with two <td>s: name (with <a href="/{slug}/job/{id}">) and location.
  const rowRe = new RegExp(
    `<tr>[\\s\\S]*?<td[^>]*class="jv-job-list-name">[\\s\\S]*?<a href="/${slug}/job/([^"]+)"[^>]*>([^<]+)<\\/a>[\\s\\S]*?<td[^>]*class="jv-job-list-location">([\\s\\S]*?)<\\/td>[\\s\\S]*?<\\/tr>`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const id = m[1].trim();
    const title = m[2].trim();
    // Location cell may contain spans, commas, and "N Locations" meta — strip tags.
    const rawLoc = m[3].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    // Drop "N Locations" suffix when multiple locations are listed.
    const location = rawLoc.replace(/\s*\d+\s+Locations?\s*$/i, "").trim();
    if (id && title) out.push({ id, title, location });
  }
  return out;
}

/** Extract description HTML from the div.jv-job-detail-description block. */
function extractDescription(html: string): string | null {
  const marker = 'class="jv-job-detail-description"';
  const si = html.indexOf(marker);
  if (si === -1) return null;
  const contentStart = html.indexOf(">", si) + 1;
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = contentStart;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) return html.slice(contentStart, m.index).trim();
  }
  return null;
}

async function parallelMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
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

export const jobviteFetcher: JobSource = {
  sourceType: "jobvite",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, slug, listingUrl } = parseBoardRoot(source.base_url);
    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || slug;

    const listRes = await fetch(listingUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!listRes.ok) {
      throw new Error(`jobvite: listing ${listRes.status} (${listingUrl})`);
    }
    const listHtml = await listRes.text();
    const rows = parseListingRows(listHtml, slug);
    if (rows.length === 0) {
      throw new Error(`jobvite: 0 job rows parsed from ${listingUrl}`);
    }

    const descriptions = await parallelMap(rows, DETAIL_CONCURRENCY, async (row) => {
      const detailUrl = `${origin}/${slug}/job/${row.id}`;
      const res = await fetch(detailUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) return null;
      return extractDescription(await res.text());
    });

    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const applyUrl = `${origin}/${slug}/job/${row.id}`;
      try {
        jobs.push({
          external_id: row.id,
          title: row.title,
          location: normalizeLocation(row.location),
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
