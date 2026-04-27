/**
 * ServiceNow Employee / Recruiting portals that publish an SEO sitemap (often linked from
 * `robots.txt`) listing individual job URLs as query-param routes.
 *
 * Best Buy lists jobs on `jobs.bestbuy.com` (ServiceNow-backed SEO routes like
 * `?id=job_details&req_id=…`) while apply flows often land on IBM BrassRing TG
 * (`sjobs.brassring.com`, `partnerid=25632` / `siteid=5649`). Prefer `brassring.ts`
 * (`brg-bestbuy`) for full ingest; this fetcher remains for other ServiceNow sitemap tenants.
 *
 * `base_url` must be the full sitemap XML URL (same URL as the `Sitemap:` line in robots.txt).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;
// Best Buy publishes 5k+ job URLs in its sitemap — cap per run to stay within
// Cloudflare's memory budget and keep each cron cycle under the timeout budget.
const MAX_SITEMAP_JOBS = 1000;

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function collectJobUrlsFromSitemap(xml: string): { url: string; reqId: string }[] {
  const out: { url: string; reqId: string }[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const raw = m[1].trim().split("&amp;").join("&");
    if (!raw.includes("job_details") || !raw.includes("req_id=")) continue;
    const u = new URL(raw);
    const req = u.searchParams.get("req_id");
    if (!req) continue;
    out.push({ url: raw, reqId: req });
  }
  return out;
}

function parseJobPageHtml(html: string): { title: string; description: string | null } {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  let title = titleMatch ? titleMatch[1].trim() : "";
  const jobDetailsIdx = title.search(/\s*-\s*Job Details\s*-/i);
  if (jobDetailsIdx > 0) title = title.slice(0, jobDetailsIdx).trim();

  let description: string | null = null;
  const og = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  if (og?.[1]) description = og[1].trim();
  if (!description) {
    const md = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    if (md?.[1]) description = md[1].trim();
  }

  return { title: title || "Job posting", description };
}

export const servicenowSeoFetcher: JobSource = {
  sourceType: "servicenow_seo",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const sitemapUrl = source.base_url.trim();
    const res = await fetch(sitemapUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/xml,text/xml,*/*",
      },
    });
    if (!res.ok) {
      throw new Error(`servicenow_seo: sitemap ${res.status} for ${source.company_handle}`);
    }

    const xml = await res.text();
    const allRows = collectJobUrlsFromSitemap(xml);
    if (allRows.length === 0) {
      throw new Error(`servicenow_seo: 0 job_details URLs in sitemap (${sitemapUrl})`);
    }
    const rows = allRows.slice(0, MAX_SITEMAP_JOBS);

    const companyName =
      source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || source.company_handle;

    const parsed = await parallelMap(rows, DETAIL_CONCURRENCY, async ({ url, reqId }): Promise<NormalizedJob | null> => {
      const pageRes = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        redirect: "follow",
      });
      if (!pageRes.ok) return null;
      const html = await pageRes.text();
      const { title, description } = parseJobPageHtml(html);
      const loc =
        normalizeLocation(description ?? "") ??
        normalizeLocation(title);

      return {
        external_id: reqId,
        title,
        location: loc,
        employment_type: normalizeEmploymentType(null),
        workplace_type: normalizeWorkplaceType(null, description ?? title),
        apply_url: url,
        source_url: url,
        description_raw: description,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: null,
        company_name: companyName,
      };
    });

    const ok = parsed.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0) {
      throw new Error(`servicenow_seo: ${rows.length} job URL(s) but 0 parsed (${source.company_handle})`);
    }
    return ok;
  },
};
