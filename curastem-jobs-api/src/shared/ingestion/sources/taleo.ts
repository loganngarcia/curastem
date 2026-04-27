/**
 * Oracle Taleo InFlight (NLX) — public `POST {origin}/careersection/rest/jobboard/searchjobs`
 * with JSON body (same contract as the Angular careers SPA). Many edges return 500 unless the
 * request includes a `tz` header (e.g. `GMT-07:00`).
 *
 * `base_url` must be a real job-search shell on the tenant host (used as Referer). Configure
 * InFlight portal id(s) with query `portals=id1,id2` or a single `portal=id`. Optional overrides:
 * `taleo_section_us` / `taleo_section_intl` for `/jobdetails/{section}/{contestNo}` (defaults
 * match Hyatt’s public sections). Curastem-only query keys are stripped from the Referer.
 *
 * List responses omit full descriptions — `description_raw` is null.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Any IANA-style offset string the SPA would send is typically accepted. */
const TZ_HEADER = "GMT-07:00";

const LIST_POST_BODY = {
  advancedSearchFiltersSelectionParam: {
    searchFilterSelections: [
      { id: "LOCATION", selectedValues: [] as string[] },
      { id: "JOB_FIELD", selectedValues: [] as string[] },
      { id: "URGENT_JOB", selectedValues: [] as string[] },
      { id: "EMPLOYEE_STATUS", selectedValues: [] as string[] },
      { id: "WILL_TRAVEL", selectedValues: [] as string[] },
      { id: "JOB_SHIFT", selectedValues: [] as string[] },
    ],
  },
  fieldData: { fields: { JOB_NUMBER: "", JOB_TITLE: "", KEYWORD: "" }, valid: true },
  filterSelectionParam: {
    searchFilterSelections: [
      { id: "POSTING_DATE", selectedValues: [] as string[] },
      { id: "ORGANIZATION", selectedValues: [] as string[] },
      { id: "LOCATION", selectedValues: [] as string[] },
      { id: "JOB_FIELD", selectedValues: [] as string[] },
      { id: "JOB_TYPE", selectedValues: [] as string[] },
      { id: "JOB_SCHEDULE", selectedValues: [] as string[] },
      { id: "JOB_LEVEL", selectedValues: [] as string[] },
    ],
  },
  multilineEnabled: false,
  sortingSelection: { ascendingSortingOrder: "false", sortBySelectionParam: "3" },
};

interface TaleoPaging {
  currentPageNo?: number;
  pageSize?: number;
  totalCount?: number;
}

interface TaleoRequisition {
  contestNo?: string;
  column?: string[];
}

interface TaleoSearchResponse {
  careerSectionUnAvailable?: boolean;
  requisitionList?: TaleoRequisition[] | null;
  pagingData?: TaleoPaging | null;
}

interface TaleoSiteConfig {
  searchEndpoint: string;
  referer: string;
  portalIds: string[];
  jobDetailsBase: string;
  sectionUs: string;
  sectionIntl: string;
}

/** Curastem-only keys — not sent as Referer to the edge. */
const BASE_URL_META_KEYS = [
  "portals",
  "portal",
  "taleo_section_us",
  "taleo_section_intl",
] as const;

function parseTaleoSiteConfig(raw: string): TaleoSiteConfig {
  const u = new URL(raw.trim());
  const origin = u.origin;
  const searchEndpoint = `${origin}/careersection/rest/jobboard/searchjobs`;

  const portalsParam = u.searchParams.get("portals");
  const portalSingle = u.searchParams.get("portal");
  let portalIds: string[];
  if (portalsParam) {
    portalIds = portalsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (portalSingle) {
    portalIds = [portalSingle.trim()];
  } else {
    throw new Error(
      "taleo: base_url must include portals= (comma-separated) or portal= (single) InFlight portal id(s)"
    );
  }
  if (portalIds.length === 0) {
    throw new Error("taleo: no portal ids parsed from base_url");
  }

  const sectionUs = u.searchParams.get("taleo_section_us") ?? "10780";
  const sectionIntl = u.searchParams.get("taleo_section_intl") ?? "10880";

  const refererUrl = new URL(u.toString());
  for (const k of BASE_URL_META_KEYS) {
    refererUrl.searchParams.delete(k);
  }
  const referer = refererUrl.toString();

  const pathname = u.pathname;
  const idx = pathname.indexOf("/careers/");
  const jobDetailsBase =
    idx >= 0
      ? `${origin}${pathname.slice(0, idx)}/careers/jobdetails`
      : `${origin}/en-US/careers/jobdetails`;

  return {
    searchEndpoint,
    referer,
    portalIds,
    jobDetailsBase,
    sectionUs,
    sectionIntl,
  };
}

function stripParenName(name: string): string {
  return name.replace(/\s*\([^)]*Taleo[^)]*\)\s*/i, "").trim();
}

function locationFromTaleoColumn(locJson: string): string | null {
  try {
    const arr = JSON.parse(locJson) as string[];
    const code = arr[0]?.trim();
    if (!code) return null;
    const parts = code.split("-").filter(Boolean);
    if (parts[0] === "US" && parts.length >= 3) {
      const st = parts[1];
      const city = parts.slice(2).join(" ");
      return `${city}, ${st}`;
    }
    if (parts.length >= 3) {
      const country = parts[0];
      const region = parts[1];
      const city = parts.slice(2).join(" ");
      return `${city}, ${region}, ${country}`;
    }
    return code;
  } catch {
    return null;
  }
}

function sectionForJobDetail(
  locJson: string,
  sectionUs: string,
  sectionIntl: string
): string {
  try {
    const arr = JSON.parse(locJson) as string[];
    const code = arr[0] ?? "";
    return code.startsWith("US-") ? sectionUs : sectionIntl;
  } catch {
    return sectionUs;
  }
}

function buildJobDetailUrl(
  jobDetailsBase: string,
  contestNo: string,
  locJson: string | null,
  sectionUs: string,
  sectionIntl: string
): string {
  const section =
    locJson && locJson.includes("[")
      ? sectionForJobDetail(locJson, sectionUs, sectionIntl)
      : sectionUs;
  return `${jobDetailsBase}/${section}/${encodeURIComponent(contestNo)}`;
}

async function fetchSearchPage(
  searchEndpoint: string,
  portalId: string,
  pageNo: number,
  referer: string
): Promise<TaleoSearchResponse> {
  const url = `${searchEndpoint}?portal=${encodeURIComponent(portalId)}&lang=en`;
  const body = JSON.stringify({ ...LIST_POST_BODY, pageNo });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: referer,
      tz: TZ_HEADER,
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`taleo: searchjobs HTTP ${res.status} ${t.slice(0, 160)}`);
  }
  return (await res.json()) as TaleoSearchResponse;
}

export const taleoFetcher: JobSource = {
  sourceType: "taleo",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const cfg = parseTaleoSiteConfig(source.base_url);
    const companyName = stripParenName(source.name);
    const byContest = new Map<string, NormalizedJob>();

    for (const portalId of cfg.portalIds) {
      let pageNo = 1;
      const maxPages = 250;

      while (pageNo <= maxPages) {
        const data = await fetchSearchPage(
          cfg.searchEndpoint,
          portalId,
          pageNo,
          cfg.referer
        );
        if (data.careerSectionUnAvailable) break;

        const rows = data.requisitionList ?? [];
        if (rows.length === 0) break;

        for (const row of rows) {
          const contestNo = (row.contestNo ?? "").trim();
          const cols = row.column ?? [];
          if (!contestNo || cols.length < 3) continue;

          const title = (cols[0] ?? "").trim();
          if (!title) continue;

          const locJson = cols[3] && cols[3].includes("[") ? cols[3] : null;
          const postedRaw = cols.length >= 5 ? cols[cols.length - 1] : "";
          const locStr = locJson ? locationFromTaleoColumn(locJson) : null;

          const detailUrl = buildJobDetailUrl(
            cfg.jobDetailsBase,
            contestNo,
            locJson,
            cfg.sectionUs,
            cfg.sectionIntl
          );

          const job: NormalizedJob = {
            external_id: contestNo,
            title,
            location: locStr ? normalizeLocation(locStr) : null,
            employment_type: null,
            workplace_type: normalizeWorkplaceType(null, `${title} ${locStr ?? ""}`),
            apply_url: detailUrl,
            source_url: detailUrl,
            description_raw: null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(postedRaw || undefined),
            company_name: companyName,
          };

          if (!byContest.has(contestNo)) byContest.set(contestNo, job);
        }

        const pd = data.pagingData;
        const total = pd?.totalCount ?? 0;
        const pageSize = pd?.pageSize ?? rows.length;
        if (total > 0 && pageNo * pageSize >= total) break;
        if (rows.length < pageSize) break;

        pageNo += 1;
        await new Promise((r) => setTimeout(r, 75));
      }
    }

    return [...byContest.values()];
  },
};
