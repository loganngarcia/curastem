/**
 * Source registry.
 *
 * This is the single place where source types are mapped to their fetcher
 * implementations. Adding a new source to Curastem means:
 *   1. Adding a new SourceType value to types.ts
 *   2. Implementing a JobSource in ingestion/sources/
 *   3. Registering it here
 *   4. Inserting rows into the sources table (via migrate.ts seed or SQL)
 *
 * Nothing else in the codebase needs to change to support a new source.
 */

import type { JobSource, SourceType } from "../types.ts";
import { greenhouseFetcher } from "./sources/greenhouse.ts";
import { leverFetcher } from "./sources/lever.ts";
import { ashbyFetcher } from "./sources/ashby.ts";
import { workdayFetcher } from "./sources/workday.ts";
import { smartRecruitersFetcher } from "./sources/smartrecruiters.ts";
import { recruiteeFetcher } from "./sources/recruitee.ts";
import { workableFetcher } from "./sources/workable.ts";
import { personioFetcher } from "./sources/personio.ts";
import { pinpointFetcher } from "./sources/pinpoint.ts";
import { amazonFetcher } from "./sources/amazon.ts";
import { appleFetcher } from "./sources/apple.ts";
import { ycombinatorFetcher } from "./sources/ycombinator.ts";
import { browserFetcher } from "./sources/browser.ts";
import { rssFetcher } from "./sources/rss.ts";
import { usajobsFetcher } from "./sources/usajobs.ts";
import { saashrFetcher } from "./sources/saashr.ts";
import { considerFetcher } from "./sources/consider.ts";
import { jobrightFetcher } from "./sources/jobright.ts";
import { framerFetcher } from "./sources/framer.ts";
import { easyapplyFetcher } from "./sources/easyapply.ts";
import { metacareersFetcher } from "./sources/metacareers.ts";
import { ripplingFetcher } from "./sources/rippling.ts";
import { catsoneFetcher } from "./sources/catsone.ts";
import { oracleCeFetcher } from "./sources/oracle_ce.ts";
import { brillioFetcher } from "./sources/brillio.ts";
import { phenomFetcher } from "./sources/phenom.ts";
import { jobviteFetcher } from "./sources/jobvite.ts";

const REGISTRY: Record<SourceType, JobSource> = {
  greenhouse: greenhouseFetcher,
  lever: leverFetcher,
  ashby: ashbyFetcher,
  workday: workdayFetcher,
  smartrecruiters: smartRecruitersFetcher,
  recruitee: recruiteeFetcher,
  workable: workableFetcher,
  personio: personioFetcher,
  pinpoint: pinpointFetcher,
  amazon: amazonFetcher,
  apple: appleFetcher,
  ycombinator: ycombinatorFetcher,
  browser: browserFetcher,
  rss: rssFetcher,
  usajobs: usajobsFetcher,
  saashr: saashrFetcher,
  consider: considerFetcher,
  jobright: jobrightFetcher,
  framer: framerFetcher,
  easyapply: easyapplyFetcher,
  metacareers: metacareersFetcher,
  rippling: ripplingFetcher,
  catsone: catsoneFetcher,
  oracle_ce: oracleCeFetcher,
  brillio: brillioFetcher,
  phenom: phenomFetcher,
  jobvite: jobviteFetcher,
};

/**
 * Look up the fetcher for a given source type.
 * Returns null for unknown source types (graceful degradation rather than crash).
 */
export function getFetcher(sourceType: string): JobSource | null {
  return REGISTRY[sourceType as SourceType] ?? null;
}

/**
 * Source priority for deduplication.
 * Higher number = higher trust. When two sources produce the same job
 * (matched via dedup_key), the record from the higher-priority source is kept.
 *
 * Direct ATS sources (Greenhouse, Lever, Ashby) have the highest priority
 * because they are the employer's own system of record.
 */
export const SOURCE_PRIORITY: Record<SourceType, number> = {
  // Direct ATS (employer's own system of record) — highest trust
  greenhouse: 100,
  lever: 100,
  ashby: 100,
  recruitee: 100,
  workable: 100,
  personio: 100,
  pinpoint: 100,
  // Semi-direct: employer configures listing but through a larger platform
  workday: 80,
  smartrecruiters: 70,
  // Company-owned careers portals — high trust (direct from the company itself)
  amazon: 90,
  apple: 90,
  // Curated job board — moderate trust (YC-vetted companies, but no job descriptions in public API)
  ycombinator: 40,
  // Browser-scraped career pages — high trust (direct from the company's own site)
  // Lower than direct ATS only because DOM extraction is less reliable than structured APIs
  browser: 85,
  // Sector job boards with RSS — moderate trust (curated aggregators)
  rss: 45,
  // Federal government job board — official US source
  usajobs: 75,
  // UKG / SaaSHR tenant portals — unauthenticated public REST API (same trust as direct ATS)
  saashr: 100,
  // VC portfolio boards (Consider) — structured API but syndicated listings
  consider: 68,
  // Jobright-native listings (structured Next.js payload; id list is manually curated)
  jobright: 58,
  // Framer search index (static JSON; same content as the live marketing site)
  framer: 84,
  // EasyApply JSON-LD on static HTML (tenant-hosted apply flows)
  easyapply: 78,
  // Meta official sitemap + JSON-LD (same trust model as EasyApply)
  metacareers: 78,
  // Rippling board SSR payloads (same trust model as EasyApply / Meta JSON-LD)
  rippling: 78,
  // CATS One static HTML + JSON-LD (same trust model as EasyApply)
  catsone: 78,
  // Employer Oracle FA career site — same trust as browser; structured REST from their tenant
  oracle_ce: 86,
  // WordPress HTML listing — structured parse, no third-party ATS
  brillio: 72,
  // Phenom SSR — sitemap discovery + embedded `phApp.ddo` job payload (apply often redirects to Workday)
  phenom: 77,
  // Jobvite static HTML listing + per-job description (employer's own ATS — high trust)
  jobvite: 100,
};

export function getSourcePriority(sourceType: string): number {
  return SOURCE_PRIORITY[sourceType as SourceType] ?? 50;
}
