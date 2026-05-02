/**
 * TalentReef career sites (Qdoba, etc.).
 *
 * Qdoba-style TalentReef boards expose:
 * - A posting list endpoint:
 *   `POST /apply/proxy-es/{elasticIndex}/posting/_search`
 * - A posting detail endpoint:
 *   `GET /apply/v1/clients/{clientId}/posting/{jobId}/{locale}?brandId=...`
 *
 * The listing payload already contains `description` HTML, so there is usually no need for
 * a second detail request to fetch job text.
 *
 * You can tune a board via `base_url` query params:
 * - `talentreef_client_ids`: comma-separated clientId list (required for most boards; defaults to Qdoba `20144`)
 * - `talentreef_elastic_index`: defaults to `search-en-us`
 * - `talentreef_page_size`: defaults to `100`
 * - `talentreef_max_jobs`: hard cap per run (default `5000`)
 * - `talentreef_apply_url_base`: base used to resolve relative `url` fields.
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const LIST_ENDPOINT = "https://prod-kong.internal.talentreef.com/apply/proxy-es";

const DEFAULT_CLIENT_IDS = [20144];
const DEFAULT_ELASTIC_INDEX = "search-en-us";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_JOBS = 5000;
const DEFAULT_APPLY_URL_BASE = "https://applicant.jobappnetwork.com";

interface TalentreefAddress {
  city?: string | null;
  stateOrProvince?: string | null;
  stateOrProvinceFull?: string | null;
  country?: string | null;
}

interface TalentreefSource {
  jobId?: number | string | null;
  title?: string | null;
  description?: string | null;
  positionType?: string | null;
  clientId?: number | string | null;
  address?: TalentreefAddress | null;
  location?: {
    name?: string | null;
    number?: string | number | null;
    id?: number | string | null;
  } | null;
  url?: string | null;
}

interface TalentreefHit {
  _id?: string;
  _source?: TalentreefSource;
}

interface TalentreefSearchResponse {
  hits: {
    total: number | { value: number };
    hits: TalentreefHit[];
  };
}

interface ParsedConfig {
  clientIds: number[];
  elasticIndex: string;
  pageSize: number;
  maxJobs: number;
  applyUrlBase: string;
}

function parseIdList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(/[,|]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseInteger(raw: string | null, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    const bounded = Math.trunc(parsed);
    if (bounded > 0 && bounded <= max) {
      return bounded;
    }
  }
  return fallback;
}

function resolveApplyOrigin(raw: string | null): string {
  if (!raw) return DEFAULT_APPLY_URL_BASE;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_APPLY_URL_BASE;
  }
}

function parseBaseConfig(baseUrl: string): ParsedConfig {
  const parsed = new URL(baseUrl);
  const clientIds = parseIdList(parsed.searchParams.get("talentreef_client_ids"))
    .concat(parseIdList(parsed.searchParams.get("client_ids")))
    .filter((value, index, list) => list.indexOf(value) === index);
  const pageSize = parseInteger(parsed.searchParams.get("talentreef_page_size"), DEFAULT_PAGE_SIZE, 200);
  const maxJobs = parseInteger(parsed.searchParams.get("talentreef_max_jobs"), DEFAULT_MAX_JOBS, 50000);
  const elasticIndex = parsed.searchParams.get("talentreef_elastic_index")?.trim() || DEFAULT_ELASTIC_INDEX;
  const applyUrlBase = resolveApplyOrigin(
    parsed.searchParams.get("talentreef_apply_url_base") || parsed.searchParams.get("apply_url_base"),
  );

  return {
    clientIds: clientIds.length > 0 ? clientIds : DEFAULT_CLIENT_IDS,
    elasticIndex,
    pageSize,
    maxJobs,
    applyUrlBase,
  };
}

function buildListBody(page: number, cfg: ParsedConfig): Record<string, unknown> {
  const query = cfg.clientIds.length > 0
    ? {
      bool: {
        filter: [
          {
            terms: {
              "clientId.raw": cfg.clientIds,
            },
          },
        ],
      },
    }
    : { match_all: {} };

  return {
    from: page,
    size: cfg.pageSize,
    query,
    _source: [
      "jobId",
      "title",
      "description",
      "positionType",
      "address",
      "url",
      "clientId",
      "clientName",
      "location",
    ],
  };
}

function toAbsoluteUrl(relativeOrAbsolute: string | null | undefined, base: string): string | null {
  const raw = relativeOrAbsolute?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!base) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function buildLocation(source: TalentreefSource): string | null {
  const address = source.address;
  const city = address?.city?.trim();
  const state = address?.stateOrProvince?.trim() || address?.stateOrProvinceFull?.trim();
  const country = address?.country?.trim();
  if (city || state || country) {
    return normalizeLocation([city, state, country].filter(Boolean).join(", "));
  }
  const locationName = source.location?.name?.trim();
  return locationName ? normalizeLocation(locationName) : null;
}

function parseDescription(raw: string | null | undefined): string | null {
  const text = htmlToText(raw ?? "").trim();
  return text.length > 0 ? text : null;
}

function detectEmploymentType(title: string | null, positionType: string | null): EmploymentType | null {
  if (positionType) {
    const normalized = normalizeEmploymentType(positionType);
    if (normalized) return normalized;
  }
  return normalizeEmploymentType(title);
}

function hitToJob(hit: TalentreefHit, cfg: ParsedConfig, companyName: string): NormalizedJob | null {
  const source = hit._source;
  if (!source) return null;
  const externalId = source.jobId ? String(source.jobId) : hit._id;
  if (!externalId) return null;

  const title = (source.title ?? "").trim();
  if (!title) return null;

  const normalizedLocation = buildLocation(source);
  const descriptionRaw = parseDescription(source.description ?? null);
  const applyUrl = toAbsoluteUrl(source.url, cfg.applyUrlBase);
  if (!applyUrl) return null;
  const workplaceType = normalizeWorkplaceType(source.positionType ?? undefined, normalizedLocation);
  const employmentType = detectEmploymentType(title, source.positionType ?? null);

  return {
    external_id: externalId,
    title,
    location: normalizedLocation,
    employment_type: employmentType,
    workplace_type: workplaceType,
    apply_url: applyUrl,
    source_url: applyUrl,
    description_raw: descriptionRaw,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: null,
    company_name: companyName,
  };
}

function hitCount(response: TalentreefSearchResponse): number {
  const total = response.hits.total;
  if (typeof total === "number") return total;
  return total?.value ?? 0;
}

async function fetchPage(page: number, cfg: ParsedConfig): Promise<TalentreefSearchResponse> {
  const url = `${LIST_ENDPOINT}/${cfg.elasticIndex}/posting/_search`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://prod-kong.internal.talentreef.com",
      Referer: "https://prod-kong.internal.talentreef.com/",
    },
    body: JSON.stringify(buildListBody(page, cfg)),
  });
  if (!res.ok) {
    throw new Error(`TalentReef page fetch failed page ${page}: ${res.status}`);
  }
  if (res.status === 204) {
    return { hits: { total: 0, hits: [] } };
  }
  const data = (await res.json()) as TalentreefSearchResponse;
  return data;
}

export const talentreefFetcher: JobSource = {
  sourceType: "talentreef",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const cfg = parseBaseConfig(source.base_url);
    const companyName = source.name.replace(/\s*\([^)]*talentreef[^)]*\)\s*/i, "").trim() || "Qdoba";

    const jobs: NormalizedJob[] = [];
    let page = 0;
    let seen = 0;
    let total = Infinity;

    while (seen < cfg.maxJobs && seen < total) {
      const data = await fetchPage(page, cfg);
      const hits = data?.hits?.hits ?? [];
      total = Math.min(total, hitCount(data));

      if (hits.length === 0) break;

      for (const hit of hits) {
        const job = hitToJob(hit, cfg, companyName);
        if (!job) continue;
        jobs.push(job);
      }

      seen = jobs.length;
      if (hits.length < cfg.pageSize) break;
      page += cfg.pageSize;
    }

    return jobs;
  },
};
