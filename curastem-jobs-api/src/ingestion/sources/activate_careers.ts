/**
 * Oracle Activate career sites (Ross, etc.). Search UI uses jTable and calls
 * `GET /Search/SearchResults?jtStartIndex=&jtPageSize=` — response body is JSON
 * serialized twice (string containing JSON). Rows have no description; full text
 * is in `/search/jobdetails/{title-slug}/{uuid}` inside `div.Description`.
 * Apply often links to classic Taleo (`*.taleo.net/careersection/application.jss`).
 *
 * `base_url` is the site origin, e.g. `https://jobs.rossstores.com`
 * (public search lives here; `rossstores.taleo.net` is apply-only).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
  slugify,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 200;
const DETAIL_FETCH_CONCURRENCY = 6;

interface ActivateRecord {
  ID?: string;
  Title?: string;
  CityStateDataAbbrev?: string;
  TypeName?: string;
  PostedDateRaw?: string;
  BrandName?: string;
  TrackingObject?: { TitleJson?: string; TypeNameJson?: string };
}

interface ActivateSearchPayload {
  Result?: string;
  Records?: ActivateRecord[];
  TotalRecordCount?: number;
}

function stripParenSuffix(name: string): string {
  return name.replace(/\s*\([^)]*Activate[^)]*\)\s*/i, "").trim();
}

function stripSpanHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function parseActivateJson(res: Response): Promise<ActivateSearchPayload> {
  const text = await res.text();
  const outer = JSON.parse(text) as unknown;
  if (typeof outer === "string") {
    return JSON.parse(outer) as ActivateSearchPayload;
  }
  return outer as ActivateSearchPayload;
}

/** Balanced inner HTML for the first `div` whose opening tag contains `classMarker`. */
function extractDivInnerByClassMarker(html: string, classMarker: string): string | null {
  const si = html.indexOf(classMarker);
  if (si === -1) return null;
  const openIdx = html.lastIndexOf("<div", si);
  if (openIdx === -1) return null;
  const contentStart = html.indexOf(">", openIdx) + 1;
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = contentStart;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html)) !== null) {
    if (mm[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) return html.slice(contentStart, mm.index).trim();
  }
  return null;
}

function extractTaleoApplyUrl(html: string): string | null {
  const m = html.match(
    /href="(https:\/\/[^"]*taleo\.net\/careersection\/application\.jss[^"]*)"/i
  );
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&");
}

async function fetchJobDetail(origin: string, title: string, id: string): Promise<{ html: string | null; applyUrl: string | null }> {
  const slug = slugify(title) || "job";
  const url = `${origin}/search/jobdetails/${slug}/${id}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) return { html: null, applyUrl: null };
  const html = await res.text();
  const desc =
    extractDivInnerByClassMarker(html, 'class="Description"') ??
    extractDivInnerByClassMarker(html, "class='Description'");
  const applyUrl = extractTaleoApplyUrl(html);
  return { html: desc, applyUrl };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

export const activateCareersFetcher: JobSource = {
  sourceType: "activate_careers",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    let origin: string;
    try {
      origin = new URL(source.base_url.trim()).origin;
    } catch {
      throw new Error(`activate_careers: invalid base_url ${source.base_url}`);
    }

    const companyName = stripParenSuffix(source.name);
    const jobs: NormalizedJob[] = [];

    let start = 0;
    let total = Infinity;
    let pages = 0;

    while (start < total && pages < MAX_LIST_PAGES) {
      pages += 1;
      const listUrl = `${origin}/Search/SearchResults?jtStartIndex=${start}&jtPageSize=${LIST_PAGE_SIZE}`;
      const listRes = await fetch(listUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!listRes.ok) {
        throw new Error(`Activate SearchResults ${listRes.status} for ${source.company_handle}`);
      }

      const payload = await parseActivateJson(listRes);
      if (typeof payload.TotalRecordCount === "number") {
        total = payload.TotalRecordCount;
      }

      const records = payload.Records ?? [];
      if (records.length === 0) break;

      const details = await mapWithConcurrency(records, DETAIL_FETCH_CONCURRENCY, async (rec) => {
        const id = rec.ID;
        const titleHtml = rec.Title ?? "";
        const title =
          stripSpanHtml(titleHtml) ||
          (rec.TrackingObject?.TitleJson ?? "").trim() ||
          "Job";
        if (!id) return null;
        return fetchJobDetail(origin, title, id);
      });

      for (let i = 0; i < records.length; i++) {
        try {
          const rec = records[i];
          const id = rec.ID;
          if (!id) continue;

          const titleHtml = rec.Title ?? "";
          const title =
            stripSpanHtml(titleHtml) ||
            (rec.TrackingObject?.TitleJson ?? "").trim() ||
            "Job";

          const locRaw = stripSpanHtml(rec.CityStateDataAbbrev) || null;
          const locNorm = locRaw ? normalizeLocation(locRaw) : null;

          const typeRaw =
            stripSpanHtml(rec.TypeName) ||
            (rec.TrackingObject?.TypeNameJson ?? "").trim() ||
            "";
          const employmentType = normalizeEmploymentType(typeRaw || undefined);

          const slug = slugify(title) || "job";
          const sourceUrl = `${origin}/search/jobdetails/${slug}/${id}`;

          const detail = details[i];
          const descriptionRaw = detail?.html ?? null;
          const taleoApply = detail?.applyUrl ?? null;

          jobs.push({
            external_id: id,
            title,
            location: locNorm,
            employment_type: employmentType,
            workplace_type: normalizeWorkplaceType(null, locRaw ?? ""),
            apply_url: taleoApply ?? sourceUrl,
            source_url: sourceUrl,
            description_raw: descriptionRaw,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(rec.PostedDateRaw ?? undefined),
            company_name: companyName,
          });
        } catch {
          continue;
        }
      }

      start += records.length;
      if (records.length < LIST_PAGE_SIZE) break;
    }

    return jobs;
  },
};
