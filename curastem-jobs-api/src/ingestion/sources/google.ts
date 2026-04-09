/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Google Careers — AF_initDataCallback HTML page fetcher.
 *
 * careers.google.com serves full-page HTML with job data embedded in an
 * `AF_initDataCallback({key: 'ds:1', ..., data:[[entry,...],...],...})` script block.
 * Each entry has the form:
 *   [ id, title, signin_url, [null, desc1], [null, desc2], ..., [loc_str,...], ...,
 *     [posted_epoch_sec, ns], ... ]
 *
 * Pagination: `?hl=en_US&page_size=20&page={n}` (1-based page index).
 * Google returns ~20 results per page regardless of page_size.
 *
 * `base_url` must be a careers.google.com search URL, e.g.
 *   https://careers.google.com/jobs/results/?q=&hl=en_US
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PAGE_SIZE = 20;
/**
 * Google's sitemap has ~4000 active jobs. Per-cron cap prevents runaway fetches
 * while leaving room for subsequent runs to pick up the rest.
 */
const MAX_JOBS_PER_RUN = 4000;
/** Concurrent page fetches; keep low to avoid triggering Google's bot detection. */
const PAGE_CONCURRENCY = 4;

// Google embeds job data in a `<script class="ds:1">` tag:
//   AF_initDataCallback({key: 'ds:1', ..., data:[[entry,...]], ..., sideChannel: {}});
// Each entry: ["id","title","signin_url",[null,"desc1"],[null,"desc2"],..., sideChannel stuff]
const DS1_SCRIPT_RE = /<script[^>]+class="ds:1"[^>]*>([\s\S]*?)<\/script>/;

// Each job entry starts with ["<17-20 digit id>","<title>","https://...careers...",...
const JOB_ENTRY_RE = /\["(\d{15,20})","([^"]+)","(https:\/\/www\.google\.com\/about\/careers\/[^"]+)"([\s\S]*?)\](?=,\["|,\]\]|\]\])/g;

// Location string: "City, ST, Country" or "City, Country"
const LOCATION_RE = /"([A-Z][a-zA-Z\u00C0-\u024F\s.]+,\s*[A-Z][a-zA-Z\s]{1,30})"/g;

// Epoch timestamp array embedded in entry: [<10-digit seconds>, <nanoseconds>]
const EPOCH_RE = /\[(\d{10}),\d+\]/;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
}

function extractDescriptions(entryRest: string): string | null {
  // Description segments are [null,"<html>"] or just "<html>" strings.
  // We pull all HTML strings and combine them.
  const segments: string[] = [];
  const htmlRe = /\[null,"((?:\\.|[^"\\])+)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = htmlRe.exec(entryRest)) !== null) {
    const html = decodeHtmlEntities(m[1]).trim();
    if (html.length > 20) segments.push(html);
  }
  if (segments.length === 0) return null;
  return segments.join("\n");
}

function extractFirstLocation(entryRest: string): string | null {
  LOCATION_RE.lastIndex = 0;
  const m = LOCATION_RE.exec(entryRest);
  return m ? m[1].trim() : null;
}

function extractPostedAt(entryRest: string): number | null {
  EPOCH_RE.lastIndex = 0;
  const m = EPOCH_RE.exec(entryRest);
  if (!m) return null;
  const sec = Number(m[1]);
  if (!Number.isFinite(sec)) return null;
  return parseEpochSeconds(sec);
}

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function fetchPage(baseUrl: string, page: number): Promise<string> {
  const url = new URL(baseUrl);
  url.searchParams.set("hl", "en_US");
  url.searchParams.set("page_size", String(PAGE_SIZE));
  if (page > 1) url.searchParams.set("page", String(page));

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://careers.google.com/",
      Cookie: "NID=1",
    },
  });
  if (!res.ok) {
    throw new Error(`google: search page ${res.status} at page=${page}`);
  }
  return res.text();
}

function parseJobsFromPage(html: string): NormalizedJob[] {
  const scriptMatch = DS1_SCRIPT_RE.exec(html);
  if (!scriptMatch) return [];
  const scriptContent = scriptMatch[1];
  // Extract the data array that starts right after `data:`
  const dataIdx = scriptContent.indexOf("data:");
  if (dataIdx < 0) return [];
  const dataStr = scriptContent.slice(dataIdx + 5);

  const jobs: NormalizedJob[] = [];
  JOB_ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = JOB_ENTRY_RE.exec(dataStr)) !== null) {
    const [, id, title, , entryRest] = m;
    if (!id || !title || title === "undefined") continue;

    const location = extractFirstLocation(entryRest);
    const description_raw = extractDescriptions(entryRest);
    const posted_at = extractPostedAt(entryRest);

    const slug = titleToSlug(title);
    const source_url = `https://careers.google.com/jobs/results/${id}-${slug}/`;

    jobs.push({
      external_id: id,
      title: title.trim(),
      location: normalizeLocation(location),
      employment_type: null,
      workplace_type: normalizeWorkplaceType(null, location),
      apply_url: source_url,
      source_url,
      description_raw,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      posted_at,
      company_name: "Google",
      company_logo_url: null,
      company_website_url: null,
    });
  }

  return jobs;
}

async function parallelMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const googleFetcher: JobSource = {
  sourceType: "google",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    if (!source.base_url.includes("careers.google.com")) {
      throw new Error(`google: base_url must be careers.google.com, got ${source.base_url}`);
    }

    // Fetch first page to gauge total. Google paginates via ?page=N (1-based).
    const firstHtml = await fetchPage(source.base_url, 1);
    const firstJobs = parseJobsFromPage(firstHtml);

    if (firstJobs.length === 0) {
      throw new Error(`google: 0 jobs parsed from first page — possible bot detection or layout change`);
    }

    const allJobs = [...firstJobs];
    const seen = new Set<string>(firstJobs.map((j) => j.external_id));

    // Fan out remaining pages in small batches to stay under Google's bot threshold.
    const MAX_PAGES = Math.ceil(MAX_JOBS_PER_RUN / PAGE_SIZE); // ~200
    const pages: number[] = [];
    for (let p = 2; p <= MAX_PAGES; p++) pages.push(p);

    // Process in chunks of PAGE_CONCURRENCY, stopping early on empty pages.
    for (let i = 0; i < pages.length && allJobs.length < MAX_JOBS_PER_RUN; i += PAGE_CONCURRENCY) {
      const batch = pages.slice(i, i + PAGE_CONCURRENCY);
      const htmlPages = await parallelMap(batch, PAGE_CONCURRENCY, (p) =>
        fetchPage(source.base_url, p).catch(() => "")
      );

      let newOnBatch = 0;
      for (const html of htmlPages) {
        if (!html) continue;
        const pageJobs = parseJobsFromPage(html);
        if (pageJobs.length === 0) continue;
        for (const job of pageJobs) {
          if (!seen.has(job.external_id)) {
            seen.add(job.external_id);
            allJobs.push(job);
            newOnBatch++;
          }
        }
      }

      // Stop if all pages in this batch were empty (past end of results).
      if (newOnBatch === 0 && htmlPages.every((h) => parseJobsFromPage(h).length === 0)) break;
    }

    if (allJobs.length === 0) {
      throw new Error(`google: 0 jobs normalized from ${source.base_url}`);
    }

    return allJobs;
  },
};
