/**
 * ADP Workforce Now — public **RAAS** (Recruitment as a Service) JSON for the embedded
 * career center (`recruitment.html?cid=…`).
 *
 * The SPA calls the **candidate-facing** host:
 *   `GET {origin}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions`
 * with query `cid`, `ccId` (career center), `timeStamp`, OData `$skip` / `$top`, and `userQuery`.
 * `meta.totalNumber` is the full job count. Pagination matches the UI (`$top` is typically 20).
 *
 * Full HTML job descriptions are **not** in the list payload; fetch each role with:
 *   `GET …/job-requisitions/{itemID}?cid=…&ccId=…&timeStamp=…`
 * The response includes `requisitionDescription` (HTML).
 *
 * `base_url` must be the employer’s recruitment page, e.g.
 *   `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=02835ad7-1b2e-4eb2-9773-3454d03b1a3e&ccId=19000101_000001&type=MP&lang=en_US`
 *
 * Query params `cid` (tenant) and `ccId` (career center id) are required for Revolve-style tenants.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LIST_PATH = "/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";
const PAGE_SIZE = 20;
const DETAIL_CONCURRENCY = 10;
const MAX_LIST_PAGES = 200;

interface WfnAddress {
  cityName?: string;
  countrySubdivisionLevel1?: { codeValue?: string };
  country?: { codeValue?: string };
}

interface WfnReqLocation {
  address?: WfnAddress;
}

interface WfnJobStub {
  itemID?: string;
  requisitionTitle?: string;
  postDate?: string | null;
  workLevelCode?: { shortName?: string | null } | null;
  requisitionLocations?: WfnReqLocation[];
}

interface WfnJobDetail extends WfnJobStub {
  requisitionDescription?: string | null;
}

interface WfnListResponse {
  jobRequisitions?: WfnJobStub[];
  meta?: { totalNumber?: number; startSequence?: number };
}

function stripWfnSuffix(name: string): string {
  return name.replace(/\s*\([^)]*ADP[^)]*WFN[^)]*\)\s*/i, "").replace(/\s*\([^)]*Workforce[^)]*Now[^)]*\)\s*/i, "").trim() || name;
}

function parseRecruitmentUrl(raw: string): { origin: string; cid: string; ccId: string | null; lang: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`adp_wfn_recruitment: invalid base_url ${raw}`);
  }
  const host = u.hostname.toLowerCase();
  if (!host.includes("workforcenow") || !host.endsWith(".adp.com")) {
    throw new Error(
      `adp_wfn_recruitment: expected workforcenow*.adp.com host, got ${u.hostname}`
    );
  }
  const cid = u.searchParams.get("cid");
  if (!cid) {
    throw new Error("adp_wfn_recruitment: base_url must include a cid= query parameter");
  }
  const ccId = u.searchParams.get("ccId");
  const langRaw = u.searchParams.get("lang") ?? "en_US";
  const lang = langRaw.replace(/-/g, "_");
  return { origin: u.origin, cid, ccId, lang };
}

function listHeaders(locale: string): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json",
    "Accept-Language": locale.replace(/_/g, "-"),
    locale,
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
    "x-forwarded-host": "workforcenow.adp.com",
  };
}

function buildListUrl(
  origin: string,
  params: { cid: string; ccId: string | null; lang: string; skip: number }
): string {
  const q = new URLSearchParams();
  q.set("cid", params.cid);
  if (params.ccId) q.set("ccId", params.ccId);
  q.set("timeStamp", Date.now().toString());
  q.set("$skip", String(params.skip));
  q.set("$top", String(PAGE_SIZE));
  q.set("userQuery", "");
  return `${origin}${LIST_PATH}?${q.toString()}`;
}

function buildDetailUrl(origin: string, itemId: string, cid: string, ccId: string | null): string {
  const q = new URLSearchParams();
  q.set("cid", cid);
  if (ccId) q.set("ccId", ccId);
  q.set("timeStamp", Date.now().toString());
  return `${origin}${LIST_PATH}/${encodeURIComponent(itemId)}?${q.toString()}`;
}

function buildApplyUrl(origin: string, cid: string, ccId: string | null, itemId: string, lang: string): string {
  const q = new URLSearchParams();
  q.set("cid", cid);
  if (ccId) q.set("ccId", ccId);
  q.set("jobId", itemId);
  q.set("lang", lang.replace(/_/g, "-"));
  return `${origin}/mascsr/default/mdf/recruitment/recruitment.html?${q.toString()}`;
}

function employmentHintFromWorkerCategory(shortName: string | null | undefined): string | undefined {
  if (!shortName) return undefined;
  const s = shortName.toLowerCase();
  if (s.includes("part")) return "part time";
  if (s.includes("temporary") || s.includes("seasonal")) return "temporary";
  if (s.includes("full") || s.includes("regular")) return "full time";
  return undefined;
}

function formatLocation(locs: WfnReqLocation[] | undefined): string | null {
  const loc = locs?.[0]?.address;
  if (!loc) return null;
  const city = loc.cityName?.trim();
  const st = loc.countrySubdivisionLevel1?.codeValue?.trim();
  const country = loc.country?.codeValue?.trim();
  if (city && st) return `${city}, ${st}`;
  if (city && country) return `${city}, ${country}`;
  return city ?? null;
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const adpWfnRecruitmentFetcher: JobSource = {
  sourceType: "adp_wfn_recruitment",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, cid, ccId, lang } = parseRecruitmentUrl(source.base_url);
    const companyName = stripWfnSuffix(source.name);
    const headers = listHeaders(lang);

    const stubs: WfnJobStub[] = [];
    let totalExpected: number | null = null;

    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const skip = page * PAGE_SIZE;
      const url = buildListUrl(origin, { cid, ccId, lang, skip });
      const res = await fetch(url, { headers, redirect: "follow" });
      if (!res.ok) {
        throw new Error(`adp_wfn_recruitment: list HTTP ${res.status} (${source.company_handle})`);
      }
      const data = (await res.json()) as WfnListResponse;
      if (typeof data.meta?.totalNumber === "number") {
        totalExpected = data.meta.totalNumber;
      }
      const batch = data.jobRequisitions ?? [];
      if (batch.length === 0) break;
      stubs.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      if (totalExpected != null && stubs.length >= totalExpected) break;
    }

    if (stubs.length === 0) {
      throw new Error(`adp_wfn_recruitment: no job requisitions (${source.company_handle})`);
    }

    const details = await parallelMap(stubs, DETAIL_CONCURRENCY, async (stub) => {
      const itemId = stub.itemID?.trim();
      if (!itemId) return null;
      const dUrl = buildDetailUrl(origin, itemId, cid, ccId);
      const res = await fetch(dUrl, { headers, redirect: "follow" });
      if (!res.ok) return null;
      try {
        return (await res.json()) as WfnJobDetail;
      } catch {
        return null;
      }
    });

    const out: NormalizedJob[] = [];
    for (let i = 0; i < stubs.length; i++) {
      const stub = stubs[i]!;
      const detail = details[i];
      const itemId = stub.itemID?.trim();
      const title = (detail?.requisitionTitle ?? stub.requisitionTitle)?.trim();
      if (!itemId || !title) continue;

      const descRaw = detail?.requisitionDescription?.trim() ?? null;
      const locStr = formatLocation(detail?.requisitionLocations ?? stub.requisitionLocations);
      const locNorm = locStr ? normalizeLocation(locStr) : null;
      const wlShort = detail?.workLevelCode?.shortName ?? stub.workLevelCode?.shortName ?? "";
      const employmentType = normalizeEmploymentType(employmentHintFromWorkerCategory(wlShort));
      const postedAt = parseEpochSeconds(detail?.postDate ?? stub.postDate ?? null);
      const applyUrl = buildApplyUrl(origin, cid, ccId, itemId, lang);

      out.push({
        external_id: itemId,
        title,
        location: locNorm,
        employment_type: employmentType,
        workplace_type: normalizeWorkplaceType(null, `${title} ${locStr ?? ""} ${descRaw ?? ""}`),
        apply_url: applyUrl,
        source_url: applyUrl,
        description_raw: descRaw,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: postedAt,
        company_name: companyName,
      });
    }

    return out;
  },
};
