/**
 * IBM BrassRing Talent Gateway (sjobs.brassring.com / hosted TGnewUI).
 *
 * The SPA calls `POST /TgNewUI/Search/Ajax/PowerSearchJobs` with:
 *   - JSON body (PowerSearch request — same shape as the Angular `buildSmartSearchRequest()` payload)
 *   - Header `RFT: <__RequestVerificationToken from the search home HTML>`
 *   - Session cookies from the initial `GET` of the search home page
 *
 * Response JSON includes `JobsCount` (total open roles matching the search) and `Jobs.Job[]`
 * where each job carries `Questions[]` with `QuestionName` keys such as `reqid`, `jobtitle`,
 * `jobdescription` (HTML), `formtext7` (location line), and `Link` (job detail URL).
 *
 * `base_url` must be a search home URL containing `partnerid` and `siteid`, e.g.
 *   `https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=25813&siteid=5079`
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeEmploymentType, normalizeLocation } from "../../utils/normalize.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const POWER_SEARCH_JOBS_PATH = "/TgNewUI/Search/Ajax/PowerSearchJobs";
/** BrassRing returns ~50 jobs per page in practice; paginate by `PageNumber`. */
const MAX_PAGES = 500;

interface BrassQuestion {
  QuestionName?: string | null;
  Value?: string | null;
}

interface BrassRingJob {
  Questions?: BrassQuestion[];
  Link?: string | null;
}

interface PowerSearchJobsResponse {
  JobsCount?: number;
  Jobs?: {
    Job?: BrassRingJob | BrassRingJob[];
  };
}

function stripBrassRingLabel(name: string): string {
  return name.replace(/\s*\([^)]*BrassRing[^)]*\)\s*/i, "").trim() || name;
}

function parsePartnerSite(baseUrl: string): { origin: string; partnerId: string; siteId: string; homeUrl: string } {
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    throw new Error(`brassring: invalid base_url ${baseUrl}`);
  }
  const partnerId = u.searchParams.get("partnerid") ?? u.searchParams.get("PartnerId");
  const siteId = u.searchParams.get("siteid") ?? u.searchParams.get("SiteId");
  if (!partnerId || !siteId) {
    throw new Error(
      "brassring: base_url must include partnerid and siteid query params (e.g. ...?partnerid=25813&siteid=5079)"
    );
  }
  const origin = u.origin;
  const homeUrl = `${origin}/TGnewUI/Search/Home/Home?partnerid=${encodeURIComponent(partnerId)}&siteid=${encodeURIComponent(siteId)}`;
  return { origin, partnerId, siteId, homeUrl };
}

function mergeCookies(existing: string, res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts = headers.getSetCookie?.() ?? [];
  if (parts.length === 0) return existing;

  const map = new Map<string, string>();
  for (const part of existing.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      map.set(k, part.slice(idx + 1).trim());
    }
  }
  for (const c of parts) {
    const crumb = c.split(";")[0]?.trim();
    if (!crumb) continue;
    const idx = crumb.indexOf("=");
    if (idx > 0) map.set(crumb.slice(0, idx).trim(), crumb.slice(idx + 1).trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractRequestVerificationToken(html: string): string | null {
  const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
  return m?.[1] ?? null;
}

function questionMap(questions: BrassQuestion[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const q of questions ?? []) {
    const name = q.QuestionName?.trim();
    if (name && q.Value != null && String(q.Value).length > 0) {
      m.set(name.toLowerCase(), String(q.Value));
    }
  }
  return m;
}

function normalizeJobList(raw: BrassRingJob | BrassRingJob[] | undefined): BrassRingJob[] {
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseUsSlashDate(s: string | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const t = Date.UTC(year, month - 1, day);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}

function buildPowerSearchBody(partnerId: string, siteId: string, pageNumber: number): Record<string, unknown> {
  return {
    PartnerId: partnerId,
    SiteId: siteId,
    Keyword: [""],
    ListKeyword: [""],
    Location: [""],
    KeywordCustomSolrFields: "",
    LocationCustomSolrFields: "",
    Latitude: 0,
    Longitude: 0,
    Radius: 0,
    FacetFilterFields: { Facet: [] },
    SortType: "",
    PageNumber: pageNumber,
    CallType: "",
    SocialReferalType: "",
    PowerSearchOptions: { PowerSearchOption: [] },
    EncryptedSessionValue: "",
    localizedStrings: {},
    JobSiteIds: "",
    RunSavedSearch: false,
    TurnOffHttps: false,
    LinkID: 0,
    JobCountOnly: false,
    SearchResumeName: "",
    MatchedReqIds: [],
    ClearSession: false,
    UserGivenKeyWords: "",
  };
}

export const brassringFetcher: JobSource = {
  sourceType: "brassring",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, partnerId, siteId, homeUrl } = parsePartnerSite(source.base_url);
    const companyName = stripBrassRingLabel(source.name);

    const baseHeaders: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
    };

    let cookies = "";
    const homeRes = await fetch(homeUrl, { headers: baseHeaders, redirect: "follow" });
    cookies = mergeCookies(cookies, homeRes);
    const html = await homeRes.text();
    if (!homeRes.ok) {
      throw new Error(`brassring: home GET ${homeRes.status} for ${source.company_handle}`);
    }

    const rft = extractRequestVerificationToken(html);
    if (!rft) {
      throw new Error(`brassring: missing __RequestVerificationToken on search home (${source.company_handle})`);
    }

    const apiUrl = `${origin}${POWER_SEARCH_JOBS_PATH}`;
    const out: NormalizedJob[] = [];
    const seenReq = new Set<string>();
    let page = 1;
    let reportedTotal: number | null = null;

    while (page <= MAX_PAGES) {
      const body = buildPowerSearchBody(partnerId, siteId, page);
      const postRes = await fetch(apiUrl, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Content-Type": "application/json;charset=UTF-8",
          RFT: rft,
          Referer: homeUrl,
          "X-Requested-With": "XMLHttpRequest",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify(body),
      });
      cookies = mergeCookies(cookies, postRes);

      const text = await postRes.text();
      if (!postRes.ok) {
        throw new Error(`brassring: PowerSearchJobs ${postRes.status} page ${page} (${source.company_handle})`);
      }
      if (!text.trimStart().startsWith("{")) {
        throw new Error(
          `brassring: non-JSON response page ${page} (${source.company_handle}): ${text.slice(0, 120)}`
        );
      }

      const data = JSON.parse(text) as PowerSearchJobsResponse;
      if (typeof data.JobsCount === "number") {
        reportedTotal = data.JobsCount;
      }

      const batch = normalizeJobList(data.Jobs?.Job);
      if (batch.length === 0) break;

      for (const job of batch) {
        const qm = questionMap(job.Questions);
        const reqid = qm.get("reqid")?.trim();
        const title = qm.get("jobtitle")?.trim();
        if (!reqid || !title) continue;
        if (seenReq.has(reqid)) continue;
        seenReq.add(reqid);

        const descHtml = qm.get("jobdescription")?.trim() ?? null;
        const locLine = qm.get("formtext7")?.trim() ?? null;
        const locNorm = locLine ? normalizeLocation(locLine) : null;
        const linkRaw = typeof job.Link === "string" && job.Link.trim() ? job.Link.trim() : "";
        const jobUrl =
          linkRaw ||
          `${origin}/TGnewUI/Search/home/HomeWithPreLoad?partnerid=${encodeURIComponent(partnerId)}&siteid=${encodeURIComponent(siteId)}&PageType=JobDetails&jobid=${encodeURIComponent(reqid)}`;

        const postedAt = parseUsSlashDate(qm.get("lastupdated") ?? null);

        out.push({
          external_id: reqid,
          title,
          location: locNorm,
          employment_type: normalizeEmploymentType(undefined),
          workplace_type: null,
          apply_url: jobUrl,
          source_url: jobUrl,
          description_raw: descHtml,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: postedAt,
          company_name: companyName,
        });
      }

      if (reportedTotal != null && out.length >= reportedTotal) break;
      if (batch.length < 50) break;
      page += 1;
    }

    return out;
  },
};
