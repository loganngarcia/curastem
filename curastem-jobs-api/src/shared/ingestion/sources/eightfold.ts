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
 * Kering hosts PCS on a custom origin:
 *   https://careers.kering.com/careers?domain=kering.com
 *
 * Some vanity hosts (e.g. join.sephora.com) disable unauthenticated `/api/pcsx/search`
 * ("PCSX is not enabled for this user"), sometimes as HTTP 403 with the same JSON body.
 * In that case we discover job ids from `{origin}/careers/sitemap.xml` and load
 * descriptions via `/api/pcsx/position_details` (which remains public).
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
/** Concurrency for fetching list pages once total count is known from page 0. */
const LIST_CONCURRENCY = 8;
/**
 * Hard cap per ingestion run. With parallel list fetching we can safely process many more
 * positions within the cron window. Remaining positions picked up in subsequent runs.
 */
const MAX_POSITIONS_PER_RUN = 5000;

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
    u.hostname === "apply.careers.microsoft.com" ||
    u.hostname === "join.sephora.com" ||
    u.hostname === "careers.kering.com";
  if (!hostOk) {
    throw new Error(
      `eightfold: expected *.eightfold.ai, apply.careers.microsoft.com, join.sephora.com, or careers.kering.com, got ${u.hostname}`
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
 * Detail responses normally include `publicUrl`. When missing, use the same host as the
 * careers site (`origin`), e.g. join.sephora.com (not apply.sephora.com, which may not exist).
 */
function applyUrlForPosition(origin: string, positionId: number, publicUrl: string | null | undefined): string {
  const direct = (publicUrl ?? "").trim();
  if (direct) return direct;
  return `${origin}/careers/job/${positionId}`;
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

function isPcsxSearchDisabledMessage(msg: string | undefined): boolean {
  return Boolean(msg && msg.includes("PCSX is not enabled"));
}

async function fetchSearchPageMaybeDisabled(
  origin: string,
  groupDomain: string,
  start: number
): Promise<EightfoldSearchInner | "pcsx_disabled"> {
  const q = new URLSearchParams({
    domain: groupDomain,
    query: "",
    location: "",
    start: String(start),
  });
  const url = `${origin}/api/pcsx/search?${q.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  // Sephora and some tenants return 403 with the same JSON body as 200 ("PCSX is not enabled…").
  const text = await res.text();
  let json: { data?: EightfoldSearchInner; message?: string };
  try {
    json = JSON.parse(text) as { data?: EightfoldSearchInner; message?: string };
  } catch {
    throw new Error(`eightfold search ${res.status} non-JSON for ${url}`);
  }
  if (isPcsxSearchDisabledMessage(json.message)) {
    return "pcsx_disabled";
  }
  if (!res.ok) {
    throw new Error(`eightfold search ${res.status} for ${url}`);
  }
  if (json.message && json.message.includes("Too many")) {
    throw new Error(`eightfold: unexpected page_size error at start=${start}`);
  }
  const data = json.data;
  if (!data || !Array.isArray(data.positions)) {
    throw new Error(`eightfold: invalid search response for ${url}`);
  }
  return data;
}

async function fetchSearchPage(
  origin: string,
  groupDomain: string,
  start: number
): Promise<EightfoldSearchInner> {
  const page = await fetchSearchPageMaybeDisabled(origin, groupDomain, start);
  if (page === "pcsx_disabled") {
    throw new Error(`eightfold: PCSX search disabled at start=${start} (${origin})`);
  }
  return page;
}

/** When `/api/pcsx/search` is disabled, Eightfold still publishes job URLs on this sitemap. */
async function fetchPositionIdsFromCareersSitemap(origin: string): Promise<number[]> {
  const url = `${origin}/careers/sitemap.xml`;
  const res = await fetch(url, { headers: { ...HEADERS, Accept: "application/xml, text/xml;q=0.9, */*;q=0.8" } });
  if (!res.ok) {
    throw new Error(`eightfold: sitemap ${res.status} for ${url}`);
  }
  const xml = await res.text();
  const ids = new Set<number>();
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1];
    const idMatch = loc.match(/\/careers\/job\/(\d+)/);
    if (idMatch) ids.add(Number(idMatch[1]));
  }
  return Array.from(ids);
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

    // Fetch first page to learn total count, then fan out remaining pages in parallel.
    // Vanity PCS hosts may disable `/api/pcsx/search`; fall back to careers sitemap + details.
    const firstMaybe = await fetchSearchPageMaybeDisabled(origin, groupDomain, 0);
    let listPositions: EightfoldListPosition[];

    if (firstMaybe === "pcsx_disabled") {
      const ids = await fetchPositionIdsFromCareersSitemap(origin);
      const cap = Math.min(ids.length, MAX_POSITIONS_PER_RUN);
      listPositions = ids.slice(0, cap).map((id) => ({ id, name: "" }));
      if (listPositions.length === 0) {
        throw new Error(
          `eightfold: PCSX search disabled and no /careers/sitemap.xml job URLs (${source.company_handle}, ${origin})`
        );
      }
    } else {
      const firstPage = firstMaybe;
      const total = firstPage.count;
      listPositions = [...firstPage.positions];

      if (total > PAGE_SIZE && firstPage.positions.length === PAGE_SIZE) {
        const cap = Math.min(total, MAX_POSITIONS_PER_RUN);
        const offsets: number[] = [];
        for (let s = PAGE_SIZE; s < cap; s += PAGE_SIZE) offsets.push(s);

        const extraPages = await parallelMap(offsets, LIST_CONCURRENCY, async (start) => {
          // One retry on transient failures (rate-limit blips).
          try {
            return await fetchSearchPage(origin, groupDomain, start);
          } catch {
            await new Promise((r) => setTimeout(r, 1000));
            return fetchSearchPage(origin, groupDomain, start).catch(() => null);
          }
        });
        for (const page of extraPages) {
          if (!page) continue;
          listPositions.push(...page.positions);
        }
      }
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

      const applyUrl = applyUrlForPosition(origin, listPos.id, detail?.publicUrl);

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
