/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Eightfold PCS (Talent Experience / careers) public API fetcher.
 *
 * The React careers app calls unauthenticated GET endpoints on the same host:
 *   GET /api/pcsx/search?domain={tenant}&query=&location=&start={offset}
 *   GET /api/pcsx/position_details?position_id={id}&domain={tenant}&hl=en
 *
 * Search returns 10 positions per page (`page_size` above 10 is rejected). Detail
 * responses include HTML `jobDescription` and `publicUrl` (apply link).
 *
 * `base_url` must be a careers URL with a `domain` query param (Eightfold PCS tenant id), e.g.
 *   https://starbucks.eightfold.ai/careers?domain=starbucks.com
 * Microsoft hosts PCS on a custom origin (same API paths):
 *   https://apply.careers.microsoft.com/careers?domain=microsoft.com
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
  parseSalary,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 16;
/** PCS caps results at 10 rows per search request ("Too many rows requested" above that). */
const PAGE_SIZE = 10;
/**
 * Hard cap per ingestion run. Sources with >2000 positions (e.g. Starbucks ~21k)
 * would otherwise need 2000+ serial list API calls — far exceeding the 90s fetch timeout.
 * The remaining positions are picked up in subsequent hourly cron runs.
 */
const MAX_POSITIONS_PER_RUN = 2000;

const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/json",
};

interface EightfoldSearchInner {
  count: number;
  positions: EightfoldListPosition[];
}

interface EightfoldListPosition {
  id: number;
  name: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  workLocationOption?: string | null;
  locationFlexibility?: string | null;
  department?: string | null;
  positionUrl?: string | null;
}

interface EightfoldPositionDetail {
  id: number;
  name: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  jobDescription?: string | null;
  workLocationOption?: string | null;
  locationFlexibility?: string | null;
  department?: string | null;
  positionUrl?: string | null;
  publicUrl?: string | null;
  efcustomTextPayRange?: string | null;
  efcustomTextPayRateRangeUs?: string | null;
  efcustomTextPayRateRangeCanada?: string | null;
  efcustomTextPayraterangecanada?: string | null;
  efcustomTextPayRangenonretail?: string | null;
  efcustomTextPcsPayrateCanadaRetailHourly?: string | null;
  efcustomTextPositionBonus?: string | null;
}

function parseEightfoldCareersUrl(baseUrl: string): { origin: string; groupDomain: string } {
  const u = new URL(baseUrl.trim());
  const groupDomain = u.searchParams.get("domain");
  if (!groupDomain) {
    throw new Error(
      `eightfold: base_url must include ?domain= (Eightfold tenant), e.g. ...?domain=starbucks.com — got ${baseUrl}`
    );
  }
  const hostOk =
    u.hostname.endsWith(".eightfold.ai") ||
    u.hostname === "eightfold.ai" ||
    u.hostname === "apply.careers.microsoft.com";
  if (!hostOk) {
    throw new Error(
      `eightfold: expected *.eightfold.ai or apply.careers.microsoft.com, got ${u.hostname}`
    );
  }
  return { origin: u.origin, groupDomain };
}

function companyLabelFromSource(source: SourceRow): string {
  return source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || source.company_handle;
}

function primaryLocation(list: EightfoldListPosition | EightfoldPositionDetail): string | null {
  const std = list.standardizedLocations?.[0];
  const raw = list.locations?.[0];
  const loc = (std && std.trim()) || (raw && raw.trim()) || null;
  return normalizeLocation(loc);
}

function workplaceFromEightfold(
  workLocationOption: string | null | undefined,
  locationHint: string | null
): ReturnType<typeof normalizeWorkplaceType> {
  const o = normalizeWorkplaceType(workLocationOption ?? null, locationHint);
  if (o) return o;
  return normalizeWorkplaceType(locationHint, null);
}

/**
 * Detail responses normally include `publicUrl`. When missing or detail fetch fails,
 * many PCS tenants use `https://apply.{domain}/careers/job/{id}` (same `domain` query param).
 */
function applyUrlForPosition(groupDomain: string, positionId: number, publicUrl: string | null | undefined): string {
  const direct = (publicUrl ?? "").trim();
  if (direct) return direct;
  return `https://apply.${groupDomain}/careers/job/${positionId}`;
}

function firstPayHint(p: EightfoldPositionDetail): string | null {
  const fields = [
    p.efcustomTextPayRange,
    p.efcustomTextPayRateRangeUs,
    p.efcustomTextPayRateRangeCanada,
    p.efcustomTextPayraterangecanada,
    p.efcustomTextPayRangenonretail,
    p.efcustomTextPcsPayrateCanadaRetailHourly,
    p.efcustomTextPositionBonus,
  ];
  for (const f of fields) {
    if (f && String(f).trim()) return String(f).trim();
  }
  return null;
}

async function fetchSearchPage(
  origin: string,
  groupDomain: string,
  start: number
): Promise<EightfoldSearchInner> {
  const q = new URLSearchParams({
    domain: groupDomain,
    query: "",
    location: "",
    start: String(start),
  });
  const url = `${origin}/api/pcsx/search?${q.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`eightfold search ${res.status} for ${url}`);
  }
  const json = (await res.json()) as { data?: EightfoldSearchInner; message?: string };
  if (json.message && json.message.includes("Too many")) {
    throw new Error(`eightfold: unexpected page_size error at start=${start}`);
  }
  const data = json.data;
  if (!data || !Array.isArray(data.positions)) {
    throw new Error(`eightfold: invalid search response for ${url}`);
  }
  return data;
}

async function fetchPositionDetail(
  origin: string,
  groupDomain: string,
  positionId: number
): Promise<EightfoldPositionDetail | null> {
  const q = new URLSearchParams({
    position_id: String(positionId),
    domain: groupDomain,
    hl: "en",
  });
  const url = `${origin}/api/pcsx/position_details?${q.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    return null;
  }
  const json = (await res.json()) as { data?: EightfoldPositionDetail };
  return json.data ?? null;
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

export const eightfoldFetcher: JobSource = {
  sourceType: "eightfold",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, groupDomain } = parseEightfoldCareersUrl(source.base_url);
    const companyName = companyLabelFromSource(source);

    const listPositions: EightfoldListPosition[] = [];
    let start = 0;
    let total = Infinity;
    while (start < total && listPositions.length < MAX_POSITIONS_PER_RUN) {
      const page = await fetchSearchPage(origin, groupDomain, start);
      total = page.count;
      listPositions.push(...page.positions);
      if (page.positions.length === 0) break;
      if (page.positions.length < PAGE_SIZE) break;
      start += page.positions.length;
    }

    if (listPositions.length === 0) {
      throw new Error(`eightfold: 0 positions for domain=${groupDomain} (${source.company_handle})`);
    }

    const detailRows = await parallelMap(listPositions, DETAIL_CONCURRENCY, async (listPos) => {
      const detail = await fetchPositionDetail(origin, groupDomain, listPos.id);
      return { listPos, detail };
    });

    const jobs: NormalizedJob[] = [];
    for (const { listPos, detail } of detailRows) {
      const title = (detail?.name ?? listPos.name)?.trim();
      if (!title) continue;

      const locHint = primaryLocation(detail ?? listPos);
      const workplace = workplaceFromEightfold(detail?.workLocationOption ?? listPos.workLocationOption, locHint);

      const applyUrl = applyUrlForPosition(groupDomain, listPos.id, detail?.publicUrl);

      const sourcePath = listPos.positionUrl ?? detail?.positionUrl;
      const source_url = sourcePath
        ? sourcePath.startsWith("http")
          ? sourcePath
          : `${origin}${sourcePath.startsWith("/") ? "" : "/"}${sourcePath}`
        : `${origin}/careers/job/${listPos.id}`;

      const description_raw = detail?.jobDescription?.trim() || null;
      const postedRaw = detail?.postedTs ?? listPos.postedTs;
      const posted_at = postedRaw != null ? parseEpochSeconds(postedRaw) : null;

      const payHint = detail ? firstPayHint(detail) : null;
      const salary = parseSalary(payHint);

      jobs.push({
        external_id: String(listPos.id),
        title,
        location: locHint,
        employment_type: null,
        workplace_type: workplace,
        apply_url: applyUrl,
        source_url,
        description_raw,
        salary_min: salary.min,
        salary_max: salary.max,
        salary_currency: salary.currency,
        salary_period: salary.period,
        posted_at,
        company_name: companyName,
        company_logo_url: null,
        company_website_url: null,
      });
    }

    if (jobs.length === 0) {
      throw new Error(`eightfold: ${listPositions.length} listed but 0 normalized jobs (${source.company_handle})`);
    }
    return jobs;
  },
};
