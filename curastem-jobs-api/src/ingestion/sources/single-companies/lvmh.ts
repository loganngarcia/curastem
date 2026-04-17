/**
 * LVMH Group careers — Algolia InstantSearch (Next.js site proxies to Algolia; we call
 * the public search API directly to avoid Akamai blocks on `/api/search` from datacenter IPs).
 *
 * Index: `PRD-en-us-timestamp-desc` (English; filter `category:job`).
 * Credentials are the same search-only client key shipped in `/_next/static/chunks/*.js` (not secret).
 *
 * `base_url` is informational (canonical careers URL); the fetcher uses fixed index + app id.
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow, WorkplaceType } from "../../types.ts";
import {
  htmlToText,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
/** Public search app id from LVMH’s embedded Algolia client. */
const ALGOLIA_APP_ID = "SDMQTD2J9T";
/**
 * Search-only API key from the same client bundle (browser uses it for `/api/search` proxy).
 * Scoped to search — treat as non-secret but do not use for admin/indexing APIs.
 */
const ALGOLIA_SEARCH_KEY = "a5c6f4c87dea9aac0732631cd87583b2";
const ALGOLIA_QUERY_URL = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`;
/** English job index matching `lvmh.com/en/join-us/our-job-offers`. */
const DEFAULT_INDEX_NAME = "PRD-en-us-timestamp-desc";

const HITS_PER_PAGE = 1000;
/** Safety cap — Algolia `nbPages` is authoritative; this only bounds runaway responses. */
const MAX_PAGES_SAFETY = 80;

interface LvmhSalary {
  min?: number | string | null;
  max?: number | string | null;
  period?: string | null;
  currency?: string | null;
}

interface LvmhHit {
  objectID: string;
  atsId?: number;
  name?: string;
  maison?: string;
  link?: string;
  description?: string | null;
  jobResponsabilities?: string | null;
  profile?: string | null;
  additionalInformation?: string | null;
  city?: string | null;
  country?: string | null;
  countryRegion?: string | null;
  geographicArea?: string | null;
  publicationTimestamp?: number;
  workingMode?: string | null;
  fullTimePartTime?: string | null;
  contract?: string | null;
  salary?: LvmhSalary | null;
}

interface AlgoliaMultiResult {
  hits: LvmhHit[];
  nbHits: number;
  nbPages: number;
}

function mapWorkplace(raw: string | null | undefined): WorkplaceType | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("remote")) return "remote";
  if (t.includes("hybrid") || t.includes("hybride")) return "hybrid";
  if (t.includes("on-site") || t.includes("on site") || t.includes("onsite") || t.includes("现场")) return "on_site";
  return normalizeWorkplaceType(raw);
}

function mapEmployment(ftpt: string | null | undefined, contract: string | null | undefined): EmploymentType | null {
  const ft = (ftpt ?? "").toLowerCase();
  if (ft.includes("part")) return "part_time";
  if (ft.includes("full") || ftpt === "全职") return "full_time";
  const co = (contract ?? "").toLowerCase();
  if (co.includes("intern") || co.includes("stage") || co.includes("apprentice") || co.includes("学徒")) {
    return "temporary";
  }
  if (co.includes("temporary") || co.includes("cdd")) return "temporary";
  if (co.includes("permanent") || co.includes("cdi") || co.includes("unbefristet")) return "full_time";
  return null;
}

function primaryLocation(hit: LvmhHit): string | null {
  const city = hit.city?.trim();
  const region = hit.countryRegion?.trim() || hit.country?.trim();
  const geo = hit.geographicArea?.trim();
  const combined =
    city && region ? `${city}, ${region}` : city || region || geo || null;
  return normalizeLocation(combined);
}

function mergeDescription(hit: LvmhHit): string | null {
  const parts: string[] = [];
  const push = (label: string, html: string | null | undefined) => {
    const t = (html ?? "").trim();
    if (!t) return;
    parts.push(`${label}\n${htmlToText(t)}`);
  };
  push("Overview", hit.description);
  push("Responsibilities", hit.jobResponsabilities);
  push("Profile", hit.profile);
  push("Additional information", hit.additionalInformation);
  const merged = parts.join("\n\n").trim();
  return merged || null;
}

function numericSalaryField(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapSalaryPeriod(raw: string | null | undefined): "year" | "month" | "hour" | null {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("hour") || t.includes("heure")) return "hour";
  if (t.includes("month") || t.includes("mois")) return "month";
  if (t.includes("year") || t.includes("an")) return "year";
  return null;
}

function salaryFromHit(hit: LvmhHit): Pick<
  NormalizedJob,
  "salary_min" | "salary_max" | "salary_currency" | "salary_period"
> {
  const s = hit.salary;
  if (!s) {
    return { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };
  }
  const min = numericSalaryField(s.min);
  const max = numericSalaryField(s.max);
  const currency = s.currency?.trim() || null;
  const period = mapSalaryPeriod(s.period ?? undefined);
  if (min === null && max === null) {
    return { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };
  }
  return {
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_period: period,
  };
}

async function fetchAlgoliaPage(indexName: string, page: number): Promise<AlgoliaMultiResult> {
  const params = new URLSearchParams({
    hitsPerPage: String(HITS_PER_PAGE),
    page: String(page),
    filters: "category:job",
  });
  const body = {
    requests: [{ indexName, params: params.toString() }],
  };
  const res = await fetch(ALGOLIA_QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": ALGOLIA_APP_ID,
      "X-Algolia-API-Key": ALGOLIA_SEARCH_KEY,
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`lvmh_algolia: Algolia HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results: AlgoliaMultiResult[] };
  const first = json.results?.[0];
  if (!first) {
    throw new Error("lvmh_algolia: empty Algolia multi-query response");
  }
  return first;
}

function hitToJob(hit: LvmhHit): NormalizedJob | null {
  const title = (hit.name ?? "").trim();
  const applyUrl = (hit.link ?? "").trim();
  const extId = (hit.objectID ?? "").trim();
  if (!title || !applyUrl || !extId) return null;

  const company = (hit.maison ?? "").trim() || "LVMH";
  const desc = mergeDescription(hit);
  const sal = salaryFromHit(hit);

  return {
    external_id: extId,
    title,
    location: primaryLocation(hit),
    employment_type: mapEmployment(hit.fullTimePartTime, hit.contract),
    workplace_type: mapWorkplace(hit.workingMode),
    apply_url: applyUrl,
    source_url: applyUrl,
    description_raw: desc,
    ...sal,
    posted_at: parseEpochSeconds(hit.publicationTimestamp),
    company_name: company,
  };
}

export const lvmhAlgoliaFetcher: JobSource = {
  sourceType: "lvmh_algolia",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    void source;
    const indexName = DEFAULT_INDEX_NAME;

    const page0 = await fetchAlgoliaPage(indexName, 0);
    const nbPages = Math.min(page0.nbPages, MAX_PAGES_SAFETY);
    const allHits: LvmhHit[] = [...page0.hits];

    if (nbPages > 1) {
      const rest = await Promise.all(
        Array.from({ length: nbPages - 1 }, (_, i) => fetchAlgoliaPage(indexName, i + 1))
      );
      for (const r of rest) {
        allHits.push(...r.hits);
      }
    }

    const seen = new Set<string>();
    const out: NormalizedJob[] = [];
    for (const hit of allHits) {
      const id = hit.objectID;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const job = hitToJob(hit);
      if (job) out.push(job);
    }
    return out;
  },
};
