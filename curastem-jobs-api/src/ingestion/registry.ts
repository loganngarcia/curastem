/**
 * Source registry.
 *
 * This is the single place where source types are mapped to their fetcher
 * implementations. Adding a new source to Curastem means:
 *   1. Adding a new SourceType value to types.ts
 *   2. Implementing a JobSource in ingestion/sources/ (single-employer parsers live under sources/single-companies/)
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
import { jobrightFetcher } from "./sources/single-companies/jobright.ts";
import { framerFetcher } from "./sources/framer.ts";
import { easyapplyFetcher } from "./sources/easyapply.ts";
import { metaFetcher } from "./sources/single-companies/meta.ts";
import { ripplingFetcher } from "./sources/rippling.ts";
import { catsoneFetcher } from "./sources/catsone.ts";
import { oracleCeFetcher } from "./sources/oracle_ce.ts";
import { brillioFetcher } from "./sources/brillio.ts";
import { globallogicFetcher } from "./sources/globallogic.ts";
import { phenomFetcher } from "./sources/phenom.ts";
import { paradoxFetcher } from "./sources/paradox.ts";
import { jobviteFetcher } from "./sources/jobvite.ts";
import { jazzhrFetcher } from "./sources/jazzhr.ts";
import { eightfoldFetcher } from "./sources/eightfold.ts";
import { uberFetcher } from "./sources/single-companies/uber.ts";
import { talentbrewFetcher } from "./sources/talentbrew.ts";
import { jibeFetcher } from "./sources/jibe.ts";
import { icimsPortalFetcher } from "./sources/icims_portal.ts";
import { shopifyFetcher } from "./sources/single-companies/shopify.ts";
import { activateCareersFetcher } from "./sources/activate_careers.ts";
import { avatureFetcher } from "./sources/avature.ts";
import { servicenowSeoFetcher } from "./sources/servicenow_seo.ts";
import { ibmCareersFetcher } from "./sources/ibm_careers.ts";
import { recruiterflowFetcher } from "./sources/recruiterflow.ts";
import { getroFetcher } from "./sources/getro.ts";
import { googleFetcher } from "./sources/google.ts";
import { netflixFetcher } from "./sources/netflix.ts";
import { tiktokFetcher } from "./sources/tiktok.ts";
import { hcaFetcher } from "./sources/single-companies/hca.ts";
import { aramarkFetcher } from "./sources/single-companies/aramark.ts";
import { adpCxFetcher } from "./sources/adp_cx.ts";
import { adpWfnRecruitmentFetcher } from "./sources/adp_wfn_recruitment.ts";
import { lvmhFetcher } from "./sources/single-companies/lvmh.ts";
import { successfactorsRmkFetcher } from "./sources/successfactors_rmk.ts";
import { symphonyMcloudFetcher } from "./sources/symphony_mcloud.ts";
import { brassringFetcher } from "./sources/brassring.ts";
import { gustoRecruitingFetcher } from "./sources/gusto_recruiting.ts";

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
  meta: metaFetcher,
  rippling: ripplingFetcher,
  catsone: catsoneFetcher,
  oracle_ce: oracleCeFetcher,
  brillio: brillioFetcher,
  globallogic: globallogicFetcher,
  phenom: phenomFetcher,
  paradox: paradoxFetcher,
  jobvite: jobviteFetcher,
  jazzhr: jazzhrFetcher,
  eightfold: eightfoldFetcher,
  uber: uberFetcher,
  talentbrew: talentbrewFetcher,
  jibe: jibeFetcher,
  icims_portal: icimsPortalFetcher,
  shopify: shopifyFetcher,
  activate_careers: activateCareersFetcher,
  avature: avatureFetcher,
  servicenow_seo: servicenowSeoFetcher,
  ibm_careers: ibmCareersFetcher,
  recruiterflow: recruiterflowFetcher,
  getro: getroFetcher,
  google: googleFetcher,
  netflix: netflixFetcher,
  tiktok: tiktokFetcher,
  hca: hcaFetcher,
  aramark: aramarkFetcher,
  adp_cx: adpCxFetcher,
  adp_wfn_recruitment: adpWfnRecruitmentFetcher,
  lvmh: lvmhFetcher,
  successfactors_rmk: successfactorsRmkFetcher,
  symphony_mcloud: symphonyMcloudFetcher,
  brassring: brassringFetcher,
  gusto_recruiting: gustoRecruitingFetcher,
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
  // Getro VC boards — full descriptions in Next.js data JSON; syndicated like Consider
  getro: 68,
  // Jobright-native listings (structured Next.js payload; id list is manually curated)
  jobright: 58,
  // Framer search index (static JSON; same content as the live marketing site)
  framer: 84,
  // EasyApply JSON-LD on static HTML (tenant-hosted apply flows)
  easyapply: 78,
  // Meta official sitemap + JSON-LD (same trust model as EasyApply)
  meta: 78,
  // Rippling board SSR payloads (same trust model as EasyApply / Meta JSON-LD)
  rippling: 78,
  // CATS One static HTML + JSON-LD (same trust model as EasyApply)
  catsone: 78,
  // Employer Oracle FA career site — same trust as browser; structured REST from their tenant
  oracle_ce: 86,
  // WordPress HTML listing — structured parse, no third-party ATS
  brillio: 72,
  globallogic: 72,
  // Phenom SSR — sitemap discovery + embedded `phApp.ddo` job payload (apply often redirects to Workday)
  phenom: 77,
  // Paradox SSR — listing pagination + JSON-LD JobPosting (same trust as Phenom)
  paradox: 76,
  // Jobvite static HTML listing + per-job description (employer's own ATS — high trust)
  jobvite: 100,
  // JazzHR / ApplyToJob — static listing + JSON-LD JobPosting on each posting (employer ATS)
  jazzhr: 100,
  // TalentBrew — employer Radancy-hosted HTML (listing + detail; apply often redirects to iCIMS/SF)
  talentbrew: 82,
  // HCA — sitemap + regional search HTML + JSON-LD (same trust model as TalentBrew)
  hca: 82,
  // Eightfold PCS — employer-configured board; structured JSON from their public PCS API
  eightfold: 86,
  uber: 90,
  // iCIMS Jibe — employer-branded board; full descriptions in API
  jibe: 88,
  // iCIMS hub search + JSON-LD on iframe job pages (multi-host retail portals)
  icims_portal: 87,
  // Shopify careers — SSR HTML + per-job Ashby payload (same trust as employer-direct)
  shopify: 82,
  // Oracle Activate + Taleo apply — structured list + HTML detail
  activate_careers: 82,
  // Avature RSS — structured feed; detail pages often blocked by WAF for server-side clients
  avature: 76,
  // ServiceNow SEO sitemap + SSR meta on job pages (employer’s own portal)
  servicenow_seo: 78,
  // IBM unified search API (official JSON; same listings as careers.ibm.com JobDetail)
  ibm_careers: 88,
  recruiterflow: 78,
  // Google Careers AF_initDataCallback HTML parse — direct from careers.google.com
  google: 90,
  // Netflix — Eightfold custom deployment; sitemap + position_details API (direct employer source)
  netflix: 90,
  // TikTok — proprietary lifeattiktok.com API; ~3400 global / 1384 US jobs
  tiktok: 90,
  // Aramark — employer WordPress JSON (official careers domain)
  aramark: 82,
  // ADP RM MyJobs — employer’s own requisitions + HTML descriptions from public CX API
  adp_cx: 95,
  // ADP WFN RAAS — same trust as adp_cx (employer tenant JSON + per-req HTML descriptions)
  adp_wfn_recruitment: 95,
  // LVMH multi-brand Algolia hub — official listings; syndicated apply URLs (many maison ATS)
  lvmh: 87,
  // SAP SF RMK — employer HTML + microdata; same trust model as Phenom/TalentBrew detail pages
  successfactors_rmk: 82,
  // Symphony Talent m-cloud job API — employer WordPress marketing site; apply via Taleo-backed flows
  symphony_mcloud: 82,
  // BrassRing TG — employer-configured IBM gateway; structured JSON with full HTML descriptions
  brassring: 88,
  // Gusto Recruiting — employer-hosted boards on jobs.gusto.com (SSR + JSON-LD; CF may require browser)
  gusto_recruiting: 80,
};

export function getSourcePriority(sourceType: string): number {
  return SOURCE_PRIORITY[sourceType as SourceType] ?? 50;
}
