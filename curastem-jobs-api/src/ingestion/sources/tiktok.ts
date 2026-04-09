/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * TikTok / Life at TikTok — proprietary careers API.
 *
 * TikTok's careers site (lifeattiktok.com) uses an internal REST API with the base:
 *   https://api.lifeattiktok.com/api/v1/public/supplier
 *
 * Key endpoints (all POST):
 *   /config/job/filters   → city codes, job categories, recruit types
 *   /search/job/posts     → paginated job listing
 *   /job/posts/{id}       → single job detail (not used — listing already has desc+req)
 *
 * Required headers: origin, website-path, accept-language.
 * No authentication or CSRF token needed.
 *
 * `base_url` should be https://lifeattiktok.com/search?domain=global
 * to fetch all jobs, or pass ?location_codes=CT_94,CT_114 for specific cities.
 * When no location codes are in the param, all global jobs are fetched.
 *
 * Apply URL format: https://lifeattiktok.com/search/{job_id}
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const API_BASE = "https://api.lifeattiktok.com/api/v1/public/supplier";
const APPLY_BASE = "https://lifeattiktok.com/search/";
const PAGE_SIZE = 100;
const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

/** Required headers to get non-empty responses from the TikTok careers API. */
const API_HEADERS = {
  "Content-Type": "application/json",
  "accept-language": "en",
  "origin": "https://lifeattiktok.com",
  "website-path": "tiktok",
  "User-Agent": USER_AGENT,
};

interface TikTokCity {
  code: string;
  en_name: string;
  parent?: {
    en_name?: string;
    parent?: { en_name?: string; code?: string };
  };
}

interface TikTokJob {
  id: string;
  title: string;
  description?: string | null;
  requirement?: string | null;
  recruit_type?: { en_name?: string } | null;
  city_info?: TikTokCity | null;
  job_post_info?: {
    min_salary?: number | null;
    max_salary?: number | null;
    currency?: string | null;
  } | null;
}

interface SearchResponse {
  code?: number;
  data?: {
    job_post_list?: TikTokJob[];
    count?: number;
  };
}

function buildLocationString(city: TikTokCity | null | undefined): string | null {
  if (!city) return null;
  const parts = [city.en_name];
  const state = city.parent?.en_name;
  const country = city.parent?.parent?.en_name;
  if (state) parts.push(state);
  if (country && country !== state) parts.push(country);
  return parts.filter(Boolean).join(", ");
}

function parseLocationCodes(baseUrl: string): string[] {
  try {
    const u = new URL(baseUrl);
    const param = u.searchParams.get("location_codes");
    if (param) return param.split(",").map((s) => s.trim()).filter(Boolean);
  } catch { /* ignore */ }
  return []; // empty = all global jobs
}

async function fetchPage(locationCodes: string[], offset: number): Promise<SearchResponse> {
  const payload = JSON.stringify({
    keyword: "",
    location_code_list: locationCodes,
    job_category_id_list: [],
    subject_id_list: [],
    tag_id_list: [],
    limit: PAGE_SIZE,
    offset,
  });
  const res = await fetch(`${API_BASE}/search/job/posts`, {
    method: "POST",
    headers: API_HEADERS,
    body: payload,
  });
  if (!res.ok) throw new Error(`tiktok: search ${res.status} at offset=${offset}`);
  return (await res.json()) as SearchResponse;
}

export const tiktokFetcher: JobSource = {
  sourceType: "tiktok",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const locationCodes = parseLocationCodes(source.base_url);

    // First page to get total count
    const firstPage = await fetchPage(locationCodes, 0);
    const total = firstPage.data?.count ?? 0;
    const allPosts: TikTokJob[] = [...(firstPage.data?.job_post_list ?? [])];

    if (total === 0) {
      throw new Error(`tiktok: 0 jobs returned for base_url=${source.base_url}`);
    }

    // Fetch remaining pages
    const offsets: number[] = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
      offsets.push(offset);
    }

    // Sequential page fetches — TikTok API doesn't seem to enforce rate limits
    // but parallelism isn't necessary for ~35 pages max
    for (const offset of offsets) {
      const page = await fetchPage(locationCodes, offset);
      allPosts.push(...(page.data?.job_post_list ?? []));
    }

    const jobs: NormalizedJob[] = [];
    for (const post of allPosts) {
      if (!post.id || !post.title?.trim()) continue;

      const rawLocation = buildLocationString(post.city_info);
      const location = normalizeLocation(rawLocation);
      const workplace = normalizeWorkplaceType(null, rawLocation);

      const descParts: string[] = [];
      if (post.description?.trim()) descParts.push(post.description.trim());
      if (post.requirement?.trim()) descParts.push(`Requirements:\n${post.requirement.trim()}`);
      const description = descParts.length > 0 ? descParts.join("\n\n") : null;

      const recruitType = post.recruit_type?.en_name?.toLowerCase() ?? "";
      // Intern roles use seniority elsewhere; employment_type stays null (see normalize.ts).
      const employment_type = recruitType.includes("intern")
        ? null
        : recruitType.includes("part")
          ? normalizeEmploymentType("part time")
          : normalizeEmploymentType("full time");

      const applyUrl = `${APPLY_BASE}${post.id}`;

      jobs.push({
        external_id: post.id,
        title: post.title.trim(),
        location,
        employment_type,
        workplace_type: workplace,
        apply_url: applyUrl,
        source_url: applyUrl,
        description_raw: description,
        salary_min: post.job_post_info?.min_salary ?? null,
        salary_max: post.job_post_info?.max_salary ?? null,
        salary_currency: post.job_post_info?.currency ?? null,
        salary_period: null,
        posted_at: null,
        company_name: "TikTok",
        company_logo_url: null,
        company_website_url: null,
      });
    }

    if (jobs.length === 0) {
      throw new Error(`tiktok: ${allPosts.length} posts fetched but 0 jobs normalized`);
    }
    return jobs;
  },
};
