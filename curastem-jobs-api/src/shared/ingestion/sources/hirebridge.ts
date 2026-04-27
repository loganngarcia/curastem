/**
 * Hirebridge career center (ASP.NET recruiter portal).
 *
 * Hirebridge career centers render:
 *   - public list pages:
 *     `https://recruit.hirebridge.com/v3/Jobs/list.aspx?cid={clientId}`
 *   - public detail pages:
 *     `/v3/Jobs/JobDetails.aspx?cid=...&jid=...&locvalue=...`
 *
 * This fetcher parses the listing HTML directly and then fetches each detail
 * page to extract:
 *   - `jobdesc`
 *   - `skilldesc`
 *   - `qualificationsdesc`
 * detail spans as `description_raw`.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_FETCH_CONCURRENCY = 10;
const DESCRIPTION_IDS = ["jobdesc", "skilldesc", "qualificationsdesc"] as const;

interface HirebridgeListing {
  externalId: string;
  jid: string;
  detailUrl: string;
  title: string;
  location: string | null;
}

interface HirebridgeDetail {
  descriptionRaw: string | null;
  employmentType: "full_time" | "part_time" | "contract" | "temporary" | "volunteer" | null;
  location: string | null;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseEmploymentType(raw: string | null | undefined): "full_time" | "part_time" | "contract" | "temporary" | "volunteer" | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (text.includes("contract")) return "contract";
  if (text.includes("part-time") || text.includes("part time") || text.includes("parttime")) return "part_time";
  if (text.includes("temporary") || text.includes("temp")) return "temporary";
  if (text.includes("volunteer")) return "volunteer";
  if (text.includes("full time") || text.includes("full-time") || text.includes("fulltime")) return "full_time";
  return normalizeEmploymentType(raw);
}

function extractSpanText(html: string, suffix: string): string | null {
  const re = new RegExp(
    `<span[^>]*id=["']ctl00_pageContent_ctl00_${suffix}["'][^>]*>([\\s\\S]*?)<\\/span>`,
    "i"
  );
  const match = html.match(re);
  if (!match) return null;
  const htmlContent = match[1] || "";
  return decodeHtml(htmlContent).replace(/<[^>]+>/g, "").trim() || null;
}

function extractDescription(html: string): string | null {
  const parts: string[] = [];
  for (const suffix of DESCRIPTION_IDS) {
    const m = html.match(
      new RegExp(
        `<span[^>]*id=["']ctl00_pageContent_ctl00_${suffix}["'][^>]*>([\\s\\S]*?)<\\/span>`,
        "i"
      )
    );
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    const text = htmlToText(raw).trim();
    if (text) parts.push(text);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function parseDetailBits(html: string): HirebridgeDetail {
  const jobType = extractSpanText(html, "jobtype");
  const detailLocation = extractSpanText(html, "jobloc");
  return {
    descriptionRaw: extractDescription(html),
    employmentType: parseEmploymentType(jobType),
    location: detailLocation ? normalizeLocation(detailLocation) : null,
  };
}

function parseApplyUrl(html: string): string | null {
  // Example: href="javascript:popUp('https://recruit.hirebridge.com/v3/applicationv2/JobApplylogin.aspx?...')"
  const direct = html.match(
    /href=["']javascript:popUp\('([^']+)'\)["']/i
  );
  if (direct?.[1]) {
    return decodeHtml(direct[1]).trim();
  }

  const fallback = html.match(/(https?:\/\/[^"']*applicationv2\/JobApplylogin\.aspx[^"'\\s]*)/i);
  if (fallback?.[1]) {
    return decodeHtml(fallback[1]).trim();
  }

  return null;
}

function parseListings(html: string, origin: string): HirebridgeListing[] {
  const out: HirebridgeListing[] = [];
  const seen = new Set<string>();
  const re = /href=["']([^"']*JobDetails\.aspx[^"']*)["'][^>]*>\s*([^<]+)\s*<\/a>\s*<\/span>\s*<span class="department">\s*([\s\S]*?)<\/span>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const href = decodeHtml(match[1] || "").trim();
    const title = decodeHtml(match[2] || "").replace(/\s+/g, " ").trim();
    const locRaw = decodeHtml(match[3] || "").replace(/\s+/g, " ").trim();
    const location = locRaw ? normalizeLocation(locRaw) : null;

    if (!href || !title) continue;

    const detailUrl = new URL(href, origin).toString();
    const detailParams = new URL(detailUrl).searchParams;
    const jid = detailParams.get("jid");
    const locvalue = detailParams.get("locvalue");
    if (!jid) continue;

    const externalId = locvalue ? `${jid}-${locvalue}` : jid;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    out.push({
      externalId,
      jid,
      detailUrl,
      title,
      location: location,
    });
  }

  return out;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((item) => fn(item)))));
  }
  return out;
}

function normalizeCompanyName(sourceName: string): string {
  return sourceName.replace(/\s*\([^)]*Hirebridge[^)]*\)\s*/i, "").trim();
}

export const hirebridgeFetcher: JobSource = {
  sourceType: "hirebridge",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const baseUrl = source.base_url.trim();
    const url = new URL(baseUrl);

    const listRes = await fetch(baseUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
    });

    if (!listRes.ok) {
      throw new Error(`Hirebridge list fetch failed (${listRes.status}) for ${source.company_handle}`);
    }

    const listHtml = decodeHtml(await listRes.text());
    const sourceListings = parseListings(listHtml, url.origin);

    if (sourceListings.length === 0) return [];

    const companyName = normalizeCompanyName(source.name);

    const detailByJid = new Map<string, HirebridgeDetail>();

    const enriched = await mapWithConcurrency(
      sourceListings,
      DETAIL_FETCH_CONCURRENCY,
      async (job) => {
        const detailRes = await fetch(job.detailUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html",
          },
        });

        if (!detailRes.ok) {
          return {
            ...job,
            descriptionRaw: null,
            applyUrl: job.detailUrl,
            employmentType: null as "full_time" | "part_time" | "contract" | "temporary" | "volunteer" | null,
            workplaceType: normalizeWorkplaceType(job.location, job.location),
          };
        }

        const detailHtml = decodeHtml(await detailRes.text());
        const baseBits = parseDetailBits(detailHtml);
        let descriptionRaw = baseBits.descriptionRaw;
        let employmentType = baseBits.employmentType;
        let titleLocation = baseBits.location ?? job.location;
        const applyUrl = parseApplyUrl(detailHtml) ?? job.detailUrl;

        if (!descriptionRaw || !employmentType || !titleLocation) {
          let fallback = detailByJid.get(job.jid);
          if (!fallback) {
            const fallbackUrl = new URL(job.detailUrl);
            fallbackUrl.searchParams.delete("locvalue");
            const fallbackRes = await fetch(fallbackUrl.toString(), {
              headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html",
              },
            });

            if (fallbackRes.ok) {
              fallback = parseDetailBits(decodeHtml(await fallbackRes.text()));
            } else {
              fallback = {
                descriptionRaw: null,
                employmentType: null,
                location: null,
              };
            }
            detailByJid.set(job.jid, fallback);
          }

          descriptionRaw = descriptionRaw ?? fallback.descriptionRaw;
          employmentType = employmentType ?? fallback.employmentType;
          titleLocation = titleLocation ?? fallback.location;
        }

        return {
          descriptionRaw,
          applyUrl,
          employmentType,
          location: titleLocation,
          workplaceType: normalizeWorkplaceType(null, titleLocation),
        };
      }
    );

    return enriched.flatMap((entry, idx) => {
      const listing = sourceListings[idx];
      if (!entry) return [];

      return [
        {
          external_id: listing.externalId,
          title: listing.title,
          location: entry.location ?? listing.location,
          employment_type: entry.employmentType,
          workplace_type: entry.workplaceType,
          apply_url: entry.applyUrl,
          source_url: listing.detailUrl,
          description_raw: entry.descriptionRaw,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: null,
          company_name: companyName,
        },
      ];
    });
  },
};
