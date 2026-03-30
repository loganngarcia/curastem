/**
 * Generic RSS job board fetcher — **plain HTTP only** (no Browser Rendering).
 *
 * Standard RSS 2.0; Google Jobs extensions (`g:id`, `g:location`, `g:employer`) when present.
 * Parsing lives in `rssParse.ts`.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { parseRssXmlToJobs } from "./rssParse.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

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
