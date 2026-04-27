/**
 * Shopify careers (shopify.com) — roles are powered by Ashby but the public posting API is off;
 * jobs are listed on the marketing site with `?ashby_jid=` query params. We scan the SSR
 * careers HTML for UUIDs, then fetch each detail page and decode `descriptionHtml` from the
 * escaped JSON blob (same shape Ashby uses client-side).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../../types.ts";
import { normalizeWorkplaceType } from "../../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const LIST_URL = "https://www.shopify.com/careers";
const DETAIL_CONCURRENCY = 6;

function extractAshbyJids(listHtml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /ashby_jid=([a-f0-9-]{36})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listHtml)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

function parseTitle(html: string): string | null {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s*-\s*Shopify\s*$/i, "").trim() || null;
}

/**
 * `descriptionHtml` is embedded as a JSON string fragment: `descriptionHtml\",\"<p>...`
 * with `\u003c` etc. Decoding via JSON.parse on a quoted wrapper matches Node's behavior.
 */
function parseDescriptionHtml(html: string): string | null {
  const m = html.match(/descriptionHtml\\",\\"((?:[^\\]|\\.)*?)\\"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

function parseWorkplaceHint(html: string): string | null {
  const m = html.match(/workplaceType\\",\\"([^"\\]+)\\"/);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w.includes("remote")) return "remote";
  if (w.includes("hybrid")) return "hybrid";
  if (w.includes("onsite") || w.includes("on_site") || w.includes("on-site")) return "on_site";
  return m[1];
}

function parseOpenedAt(html: string): number | null {
  const m = html.match(/openedAt\\",\\"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)\\"/);
  if (!m) return null;
  const parsed = Date.parse(m[1]);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx]);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export const shopifyFetcher: JobSource = {
  sourceType: "shopify",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const listUrl = (source.base_url?.trim() || LIST_URL).replace(/\/$/, "");
    const listRes = await fetch(listUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!listRes.ok) {
      throw new Error(`Shopify careers list ${listRes.status}`);
    }
    const listHtml = await listRes.text();
    const jids = extractAshbyJids(listHtml);
    if (jids.length === 0) {
      return [];
    }

    const companyName = source.name.replace(/\s*\(Shopify[^)]*\)\s*/i, "").trim() || "Shopify";

    const jobs = await mapPool(jids, DETAIL_CONCURRENCY, async (jid): Promise<NormalizedJob | null> => {
      const detailUrl = `${listUrl}?ashby_jid=${jid}`;
      const res = await fetch(detailUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) return null;
      const html = await res.text();
      const title = parseTitle(html);
      if (!title) return null;
      const description = parseDescriptionHtml(html);
      const workplaceHint = parseWorkplaceHint(html);
      const postedAt = parseOpenedAt(html);

      return {
        external_id: jid,
        title,
        location: null,
        employment_type: null,
        workplace_type: normalizeWorkplaceType(workplaceHint, ""),
        apply_url: detailUrl,
        source_url: detailUrl,
        description_raw: description,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: postedAt,
        company_name: companyName,
      };
    });

    return jobs.filter((j): j is NormalizedJob => j !== null);
  },
};
