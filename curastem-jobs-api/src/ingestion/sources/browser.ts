/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Browser source fetcher — for career pages whose jobs only appear after JS runs.
 *
 * Intercepts embedded Ashby/Greenhouse/Lever widget API calls for structured data.
 * Falls back to DOM link extraction when no ATS widget is detected.
 *
 * To add a new source: check DevTools Network for api.ashbyhq.com,
 * boards-api.greenhouse.io, or api.lever.co calls. If none, DOM fallback runs.
 * Add the entry to migrate.ts with source_type "browser".
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

// ─── ATS response shape sub-types ────────────────────────────────────────────

interface AshbyJob {
  id: string;
  title: string;
  location?: { name?: string } | null;
  employmentType?: string | null;
  isRemote?: boolean;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: { summaryComponents?: Array<{ subtitleComponents?: string[] }> } | null;
}

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name?: string } | null;
  content?: string | null;
  absolute_url?: string;
}

interface LeverJob {
  id: string;
  text: string;
  categories?: { location?: string; commitment?: string };
  hostedUrl?: string;
  applyUrl?: string;
}

// ─── Normalizers for each ATS format ─────────────────────────────────────────

function normalizeAshbyJobs(jobs: AshbyJob[], companyName: string): NormalizedJob[] {
  return jobs.map((job) => {
    const locationName = job.location?.name ?? "";
    const salaryHint = job.compensation?.summaryComponents?.[0]?.subtitleComponents?.join(" ") ?? null;
    const salary = parseSalary(salaryHint);
    return {
      external_id: job.id,
      title: job.title,
      location: normalizeLocation(locationName),
      employment_type: normalizeEmploymentType(job.employmentType ?? null),
      workplace_type: normalizeWorkplaceType(job.isRemote ? "remote" : null, locationName),
      apply_url: job.applyUrl ?? job.jobUrl ?? "",
      source_url: job.jobUrl ?? null,
      description_raw: null,
      salary_min: salary.min,
      salary_max: salary.max,
      salary_currency: salary.currency,
      salary_period: salary.period,
      posted_at: null,
      company_name: companyName,
    };
  }).filter((j) => j.apply_url);
}

function normalizeGreenhouseJobs(jobs: GreenhouseJob[], companyName: string): NormalizedJob[] {
  return jobs.map((job) => {
    const locationName = job.location?.name ?? "";
    return {
      external_id: String(job.id),
      title: job.title,
      location: normalizeLocation(locationName),
      employment_type: normalizeEmploymentType(null),
      workplace_type: normalizeWorkplaceType(null, locationName),
      apply_url: job.absolute_url ?? "",
      source_url: job.absolute_url ?? null,
      description_raw: job.content ?? null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      posted_at: null,
      company_name: companyName,
    };
  }).filter((j) => j.apply_url);
}

function normalizeLeverJobs(jobs: LeverJob[], companyName: string): NormalizedJob[] {
  return jobs.map((job) => {
    const locationName = job.categories?.location ?? "";
    return {
      external_id: job.id,
      title: job.text,
      location: normalizeLocation(locationName),
      employment_type: normalizeEmploymentType(job.categories?.commitment ?? null),
      workplace_type: normalizeWorkplaceType(null, locationName),
      apply_url: job.applyUrl ?? job.hostedUrl ?? "",
      source_url: job.hostedUrl ?? null,
      description_raw: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      posted_at: null,
      company_name: companyName,
    };
  }).filter((j) => j.apply_url);
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

export const browserFetcher: JobSource = {
  sourceType: "browser",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    if (!env?.BROWSER) {
      throw new Error("BROWSER binding not available — check wrangler.jsonc browser binding");
    }

    const companyName = source.name.replace(/\s*\(Browser\)\s*/i, "").trim();
    const browser = await puppeteer.launch(env.BROWSER);

    try {
      const page = await browser.newPage();

      // Suppress image/font/media loading to keep scrape fast and cheap
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType();
        if (type === "image" || type === "font" || type === "media" || type === "stylesheet") {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Capture any ATS API responses fired by embedded job widgets
      const capturedJobs: NormalizedJob[] = [];
      page.on("response", async (response) => {
        const url = response.url();
        const status = response.status();
        if (status < 200 || status >= 300) return;

        try {
          if (url.includes("api.ashbyhq.com/posting-api/job-board")) {
            const data = await response.json() as { jobs?: AshbyJob[] };
            const normalized = normalizeAshbyJobs(data.jobs ?? [], companyName);
            capturedJobs.push(...normalized);
          } else if (
            url.includes("boards-api.greenhouse.io/v1/boards") &&
            url.includes("/jobs")
          ) {
            const data = await response.json() as { jobs?: GreenhouseJob[] };
            const normalized = normalizeGreenhouseJobs(data.jobs ?? [], companyName);
            capturedJobs.push(...normalized);
          } else if (
            url.includes("api.lever.co/v0/postings") &&
            url.includes("mode=json")
          ) {
            const data = await response.json() as LeverJob[];
            if (Array.isArray(data)) {
              const normalized = normalizeLeverJobs(data, companyName);
              capturedJobs.push(...normalized);
            }
          }
        } catch {
          // Ignore parse errors for individual responses
        }
      });

      // Navigate and wait for network to settle (JS widgets to fire their API calls)
      await page.goto(source.base_url, {
        waitUntil: "networkidle0",
        timeout: 20000,
      });

      // If an embedded ATS widget was detected, we have clean structured data
      if (capturedJobs.length > 0) {
        return capturedJobs;
      }

      // ── Fallback: DOM extraction ──────────────────────────────────────────
      // Covers companies with fully custom job boards (no ATS embed).
      // Passed as a string so it runs in the remote Chromium context where
      // DOM APIs (document, HTMLElement, etc.) are available.
      // We inject the careers URL via string interpolation (safe — it's a URL).
      const careersUrl = source.base_url.replace(/'/g, "\\'");
      const domJobs = await page.evaluate(`
        (function() {
          var careersUrl = '${careersUrl}';
          var jobs = [];
          var anchors = Array.from(document.querySelectorAll("a[href]"));
          for (var i = 0; i < anchors.length; i++) {
            var anchor = anchors[i];
            var href = anchor.href;
            if (!href || href === careersUrl || href.indexOf("mailto:") === 0) continue;
            var heading = anchor.querySelector("h1,h2,h3,h4,h5");
            var titleEl = heading || anchor;
            var titleText = (titleEl.textContent || "").trim();
            if (titleText.length < 5 || titleText.length > 120) continue;
            var lower = titleText.toLowerCase();
            var skip = ["home","about","blog","careers","jobs","team","contact","login","sign"];
            if (skip.indexOf(lower) !== -1) continue;
            var parent = anchor.parentElement;
            var locationEl = parent ? parent.querySelector("[class*='location'],[class*='Location'],[data-location]") : null;
            var location = locationEl ? (locationEl.textContent || "").trim() : "";
            jobs.push({ title: titleText, apply_url: href, location: location });
          }
          var seen = {};
          return jobs.filter(function(j) {
            if (seen[j.apply_url]) return false;
            seen[j.apply_url] = true;
            return true;
          });
        })()
      `) as Array<{ title: string; apply_url: string; location: string }>;

      return domJobs.map((j, idx) => ({
        external_id: `dom-${idx}-${Buffer.from(j.apply_url).toString("base64").slice(0, 16)}`,
        title: j.title,
        location: normalizeLocation(j.location),
        employment_type: normalizeEmploymentType(null),
        workplace_type: normalizeWorkplaceType(null, j.location),
        apply_url: j.apply_url,
        source_url: j.apply_url,
        description_raw: null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: null,
        company_name: companyName,
      }));
    } finally {
      await browser.close();
    }
  },
};
