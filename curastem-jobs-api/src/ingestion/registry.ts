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
};

export function getSourcePriority(sourceType: string): number {
  return SOURCE_PRIORITY[sourceType as SourceType] ?? 50;
}
