/**
 * Generic RSS job board fetcher — **plain HTTP only** (no Browser Rendering).
 *
 * Standard RSS 2.0; Google Jobs extensions (`g:id`, `g:location`, `g:employer`) when present.
 * Parsing lives in `rssParse.ts`.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { parseRssXmlToJobs } from "./rssParse.ts";

/** Some employers (e.g. American Airlines Google Jobs RSS) return 403 for bot-like desktop UAs; okhttp is widely allowlisted. */
const USER_AGENT = "okhttp/4.12.0";

export const rssFetcher: JobSource = {
  sourceType: "rss",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    if (!res.ok) {
      throw new Error(`RSS fetch error ${res.status} for ${source.company_handle}`);
    }

    const xmlText = await res.text();
    const sourceName = source.name.replace(/\s*\(RSS\)\s*/i, "").trim();
    return parseRssXmlToJobs(xmlText, sourceName);
  },
};
