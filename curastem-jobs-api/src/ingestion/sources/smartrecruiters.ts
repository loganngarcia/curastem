/**
 * SmartRecruiters public job board fetcher.
 *
 * SmartRecruiters is used by many mid-market and enterprise companies across
 * retail, hospitality, logistics, and other non-tech sectors — an important
 * source for Curastem's mission of covering jobs beyond tech.
 *
 * SmartRecruiters exposes a public, unauthenticated REST API:
 *   https://api.smartrecruiters.com/v1/companies/{company}/postings
 *
 * This returns paginated job listings with structured fields including
 * employment type and location. Full job descriptions require a second
 * call to the detail endpoint, which we do selectively (only for new jobs).
 *
 * Rate limit: SmartRecruiters does not publish a rate limit for the public
 * board API. We add a small delay between pages to be respectful.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
}

interface SmartRecruitersTypeOfEmployment {
  id: string;   // e.g. "permanent", "part_time", "contract", "internship", "temporary"
  label: string;
}

interface SmartRecruitersPosting {
  id: string;
  name: string;        // job title
  releasedDate: string; // ISO 8601
  location: SmartRecruitersLocation;
  typeOfEmployment?: SmartRecruitersTypeOfEmployment;
  ref: string;         // raw API URL (not the candidate-facing board URL)
}

interface SmartRecruitersDetailSection {
  title: string;
  text: string;
}

interface SmartRecruitersDetail {
  jobAd?: {
    sections?: {
      companyDescription?: SmartRecruitersDetailSection;
      jobDescription?: SmartRecruitersDetailSection;
      qualifications?: SmartRecruitersDetailSection;
      additionalInformation?: SmartRecruitersDetailSection;
    };
  };
}

/**
 * 候选人正式的职位页URL（非SR内部API地址）。
 * e.g. https://jobs.smartrecruiters.com/AbbVie/3743990011943296
 */
function buildJobBoardUrl(companyHandle: string, postingId: string): string {
  return `https://jobs.smartrecruiters.com/${companyHandle}/${postingId}`;
}

/**
 * 从SmartRecruiters详情API拉取职位描述HTML，拼接各section为纯文本返回。
 * 仅在首次请求该职位时调用，结果会缓存到D1。
 */
export async function fetchSmartRecruitersDescription(
  companyHandle: string,
  postingId: string
): Promise<string | null> {
  try {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyHandle)}/postings/${encodeURIComponent(postingId)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as SmartRecruitersDetail;
    const sections = data.jobAd?.sections;
    if (!sections) return null;

    // 按展示顺序拼接所有section，保留HTML供AI抽取使用
    const parts: string[] = [];
    for (const section of [
      sections.companyDescription,
      sections.jobDescription,
      sections.qualifications,
      sections.additionalInformation,
    ]) {
      if (section?.text?.trim()) {
        parts.push(`<h3>${section.title}</h3>\n${section.text.trim()}`);
      }
    }

    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}

interface SmartRecruitersResponse {
  totalFound: number;
  offset: number;
  limit: number;
  content: SmartRecruitersPosting[];
}

const PAGE_LIMIT = 100;

function buildSmartRecruitersLocation(loc: SmartRecruitersLocation): string | null {
  if (loc.remote) return "Remote";
  const parts = [loc.city, loc.region, loc.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

const SR_EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  permanent: "full_time",
  full_time: "full_time",
  part_time: "part_time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
  freelance: "contract",
};

function normalizeSmartRecruitersEmploymentType(id: string | undefined): string | null {
  if (!id) return null;
  const key = id.toLowerCase().replace(/-/g, "_");
  return SR_EMPLOYMENT_TYPE_MAP[key] ?? null;
}

export const smartRecruitersFetcher: JobSource = {
  sourceType: "smartrecruiters",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const jobs: NormalizedJob[] = [];
    let offset = 0;
    let totalFound = Infinity;

    while (offset < totalFound) {
      const url = new URL(source.base_url);
      url.searchParams.set("limit", String(PAGE_LIMIT));
      url.searchParams.set("offset", String(offset));

      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`SmartRecruiters API error ${res.status} for ${source.company_handle}`);
      }

      const data = (await res.json()) as SmartRecruitersResponse;
      totalFound = data.totalFound ?? 0;

      for (const posting of data.content ?? []) {
        try {
          const locationStr = buildSmartRecruitersLocation(posting.location);
          const isRemote = posting.location.remote ?? false;
          const workplaceHint = isRemote ? "remote" : locationStr;
          const employmentTypeId = posting.typeOfEmployment?.id;

          const jobBoardUrl = buildJobBoardUrl(source.company_handle, posting.id);
          jobs.push({
            external_id: posting.id,
            title: posting.name,
            location: normalizeLocation(locationStr),
            employment_type: normalizeEmploymentType(
              normalizeSmartRecruitersEmploymentType(employmentTypeId)
            ),
            workplace_type: normalizeWorkplaceType(workplaceHint, locationStr),
            apply_url: jobBoardUrl,
            source_url: jobBoardUrl,
            // 描述由列表API不提供——首次请求 GET /jobs/:id 时懒加载详情
            description_raw: null,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(posting.releasedDate),
            company_name: source.name.replace(/\s*\(SmartRecruiters\)\s*/i, "").trim(),
          });
        } catch {
          continue;
        }
      }

      offset += PAGE_LIMIT;
      if (offset >= 5000) break;
    }

    return jobs;
  },
};
