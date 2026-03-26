/**
 * Schema migration helper.
 *
 * This is intentionally simple for the early stage. The schema.sql file is the
 * source of truth and is applied via `wrangler d1 execute`. This module
 * provides a programmatic way to run a migration check on startup (e.g. in
 * local dev) and to seed the sources registry with initial values.
 *
 * Usage in local dev:
 *   wrangler d1 execute curastem-jobs --local --file=schema.sql
 *
 * Usage in production:
 *   wrangler d1 execute curastem-jobs --remote --file=schema.sql
 *
 * Future: As schema evolves, numbered migration files can be added here.
 */

import type { SourceType } from "../types.ts";

interface SeedSource {
  id: string;
  name: string;
  source_type: SourceType;
  company_handle: string;
  base_url: string;
}

/**
 * Initial seed sources. These represent well-known companies with public ATS
 * boards across multiple platforms. Add new sources here to extend ingestion
 * coverage without touching any other code.
 *
 * Each source must return at least one live posting on the **actual** public
 * endpoint for its `source_type` (Greenhouse, Ashby, Lever, Workday CXS POST,
 * SmartRecruiters, Workable widget, Recruitee, Pinpoint, Personio XML, etc.).
 * Do not assume a vendor from the careers URL alone.
 */
const SEED_SOURCES: SeedSource[] = [
  // ─── Greenhouse ───────────────────────────────────────────────────────
  // Public board API: https://boards-api.greenhouse.io/v1/boards/{handle}/jobs
  { id: "gh-stripe",    name: "Stripe (Greenhouse)",    source_type: "greenhouse", company_handle: "stripe",    base_url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs" },
  { id: "gh-airbnb",   name: "Airbnb (Greenhouse)",    source_type: "greenhouse", company_handle: "airbnb",    base_url: "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs" },
  { id: "gh-discord",  name: "Discord (Greenhouse)",   source_type: "greenhouse", company_handle: "discord",   base_url: "https://boards-api.greenhouse.io/v1/boards/discord/jobs" },
  { id: "gh-figma",    name: "Figma (Greenhouse)",     source_type: "greenhouse", company_handle: "figma",     base_url: "https://boards-api.greenhouse.io/v1/boards/figma/jobs" },
  { id: "gh-ada",      name: "Ada (Greenhouse)",       source_type: "greenhouse", company_handle: "ada18",     base_url: "https://boards-api.greenhouse.io/v1/boards/ada18/jobs" },
  { id: "gh-airtable", name: "Airtable (Greenhouse)",  source_type: "greenhouse", company_handle: "airtable",  base_url: "https://boards-api.greenhouse.io/v1/boards/airtable/jobs" },
  { id: "gh-anthropic", name: "Anthropic (Greenhouse)", source_type: "greenhouse", company_handle: "anthropic", base_url: "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs" },
  { id: "gh-vercel",   name: "Vercel (Greenhouse)",    source_type: "greenhouse", company_handle: "vercel",    base_url: "https://boards-api.greenhouse.io/v1/boards/vercel/jobs" },
  { id: "gh-instacart",  name: "Instacart (Greenhouse)",  source_type: "greenhouse", company_handle: "instacart",  base_url: "https://boards-api.greenhouse.io/v1/boards/instacart/jobs" },
  { id: "gh-gusto",      name: "Gusto (Greenhouse)",      source_type: "greenhouse", company_handle: "gusto",      base_url: "https://boards-api.greenhouse.io/v1/boards/gusto/jobs" },
  { id: "gh-grammarly",  name: "Grammarly (Greenhouse)",  source_type: "greenhouse", company_handle: "grammarly",  base_url: "https://boards-api.greenhouse.io/v1/boards/grammarly/jobs" },
  { id: "gh-pinterest",  name: "Pinterest (Greenhouse)",  source_type: "greenhouse", company_handle: "pinterest",  base_url: "https://boards-api.greenhouse.io/v1/boards/pinterest/jobs" },
  { id: "gh-dropbox",    name: "Dropbox (Greenhouse)",    source_type: "greenhouse", company_handle: "dropbox",    base_url: "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs" },
  { id: "gh-brex",       name: "Brex (Greenhouse)",       source_type: "greenhouse", company_handle: "brex",       base_url: "https://boards-api.greenhouse.io/v1/boards/brex/jobs" },
  { id: "gh-block",      name: "Block (Greenhouse)",      source_type: "greenhouse", company_handle: "block",      base_url: "https://boards-api.greenhouse.io/v1/boards/block/jobs" },
  { id: "gh-boxinc",     name: "Box (Greenhouse)",        source_type: "greenhouse", company_handle: "boxinc",     base_url: "https://boards-api.greenhouse.io/v1/boards/boxinc/jobs" },
  { id: "gh-gitlab",     name: "GitLab (Greenhouse)",     source_type: "greenhouse", company_handle: "gitlab",     base_url: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs" },
  { id: "gh-twitch",     name: "Twitch (Greenhouse)",     source_type: "greenhouse", company_handle: "twitch",     base_url: "https://boards-api.greenhouse.io/v1/boards/twitch/jobs" },
  { id: "gh-toast",      name: "Toast (Greenhouse)",      source_type: "greenhouse", company_handle: "toast",      base_url: "https://boards-api.greenhouse.io/v1/boards/toast/jobs" },
  { id: "gh-flexport",   name: "Flexport (Greenhouse)",   source_type: "greenhouse", company_handle: "flexport",   base_url: "https://boards-api.greenhouse.io/v1/boards/flexport/jobs" },
  { id: "gh-fermat",     name: "FERMÀT (Greenhouse)",     source_type: "greenhouse", company_handle: "fermat",     base_url: "https://boards-api.greenhouse.io/v1/boards/fermat/jobs" },
  { id: "gh-klaviyo",    name: "Klaviyo (Greenhouse)",    source_type: "greenhouse", company_handle: "klaviyo",    base_url: "https://boards-api.greenhouse.io/v1/boards/klaviyo/jobs" },
  { id: "gh-carta",      name: "Carta (Greenhouse)",      source_type: "greenhouse", company_handle: "carta",      base_url: "https://boards-api.greenhouse.io/v1/boards/carta/jobs" },
  { id: "gh-carvana",    name: "Carvana (Greenhouse)",    source_type: "greenhouse", company_handle: "carvana",    base_url: "https://boards-api.greenhouse.io/v1/boards/carvana/jobs" },
  { id: "gh-databricks", name: "Databricks (Greenhouse)", source_type: "greenhouse", company_handle: "databricks", base_url: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs" },
  { id: "gh-duolingo",   name: "Duolingo (Greenhouse)",   source_type: "greenhouse", company_handle: "duolingo",   base_url: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs" },
  { id: "gh-khanacademy", name: "Khan Academy (Greenhouse)", source_type: "greenhouse", company_handle: "khanacademy", base_url: "https://boards-api.greenhouse.io/v1/boards/khanacademy/jobs" },
  { id: "gh-robinhood",  name: "Robinhood (Greenhouse)",  source_type: "greenhouse", company_handle: "robinhood",  base_url: "https://boards-api.greenhouse.io/v1/boards/robinhood/jobs" },
  { id: "gh-coinbase",   name: "Coinbase (Greenhouse)",   source_type: "greenhouse", company_handle: "coinbase",   base_url: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs" },
  { id: "gh-chime",      name: "Chime (Greenhouse)",      source_type: "greenhouse", company_handle: "chime",      base_url: "https://boards-api.greenhouse.io/v1/boards/chime/jobs" },
  { id: "gh-coursera",   name: "Coursera (Greenhouse)",   source_type: "greenhouse", company_handle: "coursera",   base_url: "https://boards-api.greenhouse.io/v1/boards/coursera/jobs" },
  { id: "gh-cresta",     name: "Cresta (Greenhouse)",     source_type: "greenhouse", company_handle: "cresta",     base_url: "https://boards-api.greenhouse.io/v1/boards/cresta/jobs" },
  { id: "gh-disney",   name: "Disney (Greenhouse)",   source_type: "greenhouse", company_handle: "disney",   base_url: "https://boards-api.greenhouse.io/v1/boards/disney/jobs" },
  { id: "gh-coupang",  name: "Coupang (Greenhouse)",  source_type: "greenhouse", company_handle: "coupang",  base_url: "https://boards-api.greenhouse.io/v1/boards/coupang/jobs" },
  { id: "gh-sweetgreen",    name: "Sweetgreen (Greenhouse)",    source_type: "greenhouse", company_handle: "sweetgreen",    base_url: "https://boards-api.greenhouse.io/v1/boards/sweetgreen/jobs" },
  { id: "gh-glossier",      name: "Glossier (Greenhouse)",      source_type: "greenhouse", company_handle: "glossier",      base_url: "https://boards-api.greenhouse.io/v1/boards/glossier/jobs" },
  { id: "gh-peloton",       name: "Peloton (Greenhouse)",       source_type: "greenhouse", company_handle: "peloton",       base_url: "https://boards-api.greenhouse.io/v1/boards/peloton/jobs" },
  { id: "gh-reformation",   name: "Reformation (Greenhouse)",   source_type: "greenhouse", company_handle: "reformation",   base_url: "https://boards-api.greenhouse.io/v1/boards/reformation/jobs" },
  { id: "gh-classpass",     name: "ClassPass (Greenhouse)",     source_type: "greenhouse", company_handle: "classpass",     base_url: "https://boards-api.greenhouse.io/v1/boards/classpass/jobs" },
  { id: "gh-babylist",      name: "Babylist (Greenhouse)",      source_type: "greenhouse", company_handle: "babylist",      base_url: "https://boards-api.greenhouse.io/v1/boards/babylist/jobs" },
  { id: "gh-stitchfix",     name: "Stitch Fix (Greenhouse)",    source_type: "greenhouse", company_handle: "stitchfix",     base_url: "https://boards-api.greenhouse.io/v1/boards/stitchfix/jobs" },
  { id: "gh-stubhubinc",    name: "StubHub (Greenhouse)",       source_type: "greenhouse", company_handle: "stubhubinc",    base_url: "https://boards-api.greenhouse.io/v1/boards/stubhubinc/jobs" },
  { id: "gh-squarespace",   name: "Squarespace (Greenhouse)",   source_type: "greenhouse", company_handle: "squarespace",   base_url: "https://boards-api.greenhouse.io/v1/boards/squarespace/jobs" },
  { id: "gh-everlane",      name: "Everlane (Greenhouse)",      source_type: "greenhouse", company_handle: "everlane",      base_url: "https://boards-api.greenhouse.io/v1/boards/everlane/jobs" },
  { id: "gh-renttherunway", name: "Rent the Runway (Greenhouse)", source_type: "greenhouse", company_handle: "renttherunway", base_url: "https://boards-api.greenhouse.io/v1/boards/renttherunway/jobs" },
  { id: "gh-aloyoga",       name: "Alo Yoga (Greenhouse)",      source_type: "greenhouse", company_handle: "aloyoga",       base_url: "https://boards-api.greenhouse.io/v1/boards/aloyoga/jobs" },
  { id: "gh-gorjana",       name: "Gorjana (Greenhouse)",       source_type: "greenhouse", company_handle: "gorjana",       base_url: "https://boards-api.greenhouse.io/v1/boards/gorjana/jobs" },
  { id: "gh-jdsports",      name: "JD Sports (Greenhouse)",     source_type: "greenhouse", company_handle: "jdsports",      base_url: "https://boards-api.greenhouse.io/v1/boards/jdsports/jobs" },
  { id: "gh-mejuri",        name: "Mejuri (Greenhouse)",        source_type: "greenhouse", company_handle: "mejuri",        base_url: "https://boards-api.greenhouse.io/v1/boards/mejuri/jobs" },
  { id: "gh-thirdlove",     name: "ThirdLove (Greenhouse)",     source_type: "greenhouse", company_handle: "thirdlove",     base_url: "https://boards-api.greenhouse.io/v1/boards/thirdlove/jobs" },
  { id: "gh-ilia",          name: "Ilia Beauty (Greenhouse)",   source_type: "greenhouse", company_handle: "ilia",          base_url: "https://boards-api.greenhouse.io/v1/boards/ilia/jobs" },
  { id: "gh-glossgenius",   name: "GlossGenius (Greenhouse)",   source_type: "greenhouse", company_handle: "glossgenius",   base_url: "https://boards-api.greenhouse.io/v1/boards/glossgenius/jobs" },
  { id: "gh-supergoop",     name: "Supergoop (Greenhouse)",     source_type: "greenhouse", company_handle: "supergoop",     base_url: "https://boards-api.greenhouse.io/v1/boards/supergoop/jobs" },
  { id: "gh-goop",          name: "Goop (Greenhouse)",         source_type: "greenhouse", company_handle: "goop",          base_url: "https://boards-api.greenhouse.io/v1/boards/goop/jobs" },
  { id: "gh-godaddy",       name: "GoDaddy (Greenhouse)",      source_type: "greenhouse", company_handle: "godaddy",       base_url: "https://boards-api.greenhouse.io/v1/boards/godaddy/jobs" },
  { id: "gh-oura",          name: "Oura (Greenhouse)",          source_type: "greenhouse", company_handle: "oura",          base_url: "https://boards-api.greenhouse.io/v1/boards/oura/jobs" },
  { id: "gh-fashionnova",   name: "Fashion Nova (Greenhouse)", source_type: "greenhouse", company_handle: "fashionnova",   base_url: "https://boards-api.greenhouse.io/v1/boards/fashionnova/jobs" },
  { id: "gh-shein",         name: "SHEIN (Greenhouse)",         source_type: "greenhouse", company_handle: "shein",         base_url: "https://boards-api.greenhouse.io/v1/boards/shein/jobs" },
  { id: "gh-oscar",      name: "Oscar Health (Greenhouse)", source_type: "greenhouse", company_handle: "oscar",    base_url: "https://boards-api.greenhouse.io/v1/boards/oscar/jobs" },
  { id: "gh-otter",      name: "Otter.ai (Greenhouse)",     source_type: "greenhouse", company_handle: "otter",    base_url: "https://boards-api.greenhouse.io/v1/boards/otter/jobs" },
  { id: "gh-cloudflare", name: "Cloudflare (Greenhouse)",  source_type: "greenhouse", company_handle: "cloudflare", base_url: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs" },
  { id: "gh-datadog",    name: "Datadog (Greenhouse)",     source_type: "greenhouse", company_handle: "datadog",    base_url: "https://boards-api.greenhouse.io/v1/boards/datadog/jobs" },
  { id: "gh-deepmind",   name: "Google DeepMind (Greenhouse)", source_type: "greenhouse", company_handle: "deepmind", base_url: "https://boards-api.greenhouse.io/v1/boards/deepmind/jobs" },
  { id: "gh-mongodb",    name: "MongoDB (Greenhouse)",     source_type: "greenhouse", company_handle: "mongodb",    base_url: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs" },
  { id: "gh-edisonscientific", name: "Edison Scientific (Greenhouse)", source_type: "greenhouse", company_handle: "edisonscientific", base_url: "https://boards-api.greenhouse.io/v1/boards/edisonscientific/jobs" },
  { id: "gh-elastic",    name: "Elastic (Greenhouse)",     source_type: "greenhouse", company_handle: "elastic",    base_url: "https://boards-api.greenhouse.io/v1/boards/elastic/jobs" },
  { id: "gh-roblox",     name: "Roblox (Greenhouse)",      source_type: "greenhouse", company_handle: "roblox",     base_url: "https://boards-api.greenhouse.io/v1/boards/roblox/jobs" },
  { id: "gh-intercom",   name: "Intercom (Greenhouse)",    source_type: "greenhouse", company_handle: "intercom",   base_url: "https://boards-api.greenhouse.io/v1/boards/intercom/jobs" },
  { id: "gh-twilio",     name: "Twilio (Greenhouse)",      source_type: "greenhouse", company_handle: "twilio",     base_url: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs" },
  { id: "gh-uberfreight", name: "Uber Freight (Greenhouse)", source_type: "greenhouse", company_handle: "uberfreight", base_url: "https://boards-api.greenhouse.io/v1/boards/uberfreight/jobs" },
  { id: "gh-lyft",    name: "Lyft (Greenhouse)",    source_type: "greenhouse", company_handle: "lyft",         base_url: "https://boards-api.greenhouse.io/v1/boards/lyft/jobs" },
  { id: "gh-doordashusa", name: "DoorDash (Greenhouse)", source_type: "greenhouse", company_handle: "doordashusa", base_url: "https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs" },
  { id: "gh-reddit",  name: "Reddit (Greenhouse)",  source_type: "greenhouse", company_handle: "reddit",       base_url: "https://boards-api.greenhouse.io/v1/boards/reddit/jobs" },
  { id: "gh-riotgames", name: "Riot Games (Greenhouse)", source_type: "greenhouse", company_handle: "riotgames", base_url: "https://boards-api.greenhouse.io/v1/boards/riotgames/jobs" },
  { id: "gh-epicgames", name: "Epic Games (Greenhouse)", source_type: "greenhouse", company_handle: "epicgames", base_url: "https://boards-api.greenhouse.io/v1/boards/epicgames/jobs" },
  { id: "gh-taketwo",   name: "Take-Two Interactive (Greenhouse)", source_type: "greenhouse", company_handle: "taketwo", base_url: "https://boards-api.greenhouse.io/v1/boards/taketwo/jobs" },
  { id: "gh-2k",        name: "2K (Greenhouse)",         source_type: "greenhouse", company_handle: "2k",         base_url: "https://boards-api.greenhouse.io/v1/boards/2k/jobs" },
  { id: "gh-rockstargames", name: "Rockstar Games (Greenhouse)", source_type: "greenhouse", company_handle: "rockstargames", base_url: "https://boards-api.greenhouse.io/v1/boards/rockstargames/jobs" },
  { id: "gh-unity3d",   name: "Unity (Greenhouse)",      source_type: "greenhouse", company_handle: "unity3d",    base_url: "https://boards-api.greenhouse.io/v1/boards/unity3d/jobs" },
  { id: "gh-fanduel",   name: "FanDuel (Greenhouse)",    source_type: "greenhouse", company_handle: "fanduel",    base_url: "https://boards-api.greenhouse.io/v1/boards/fanduel/jobs" },
  { id: "gh-arize",   name: "Arize (Greenhouse)",   source_type: "greenhouse", company_handle: "arizeai",      base_url: "https://boards-api.greenhouse.io/v1/boards/arizeai/jobs" },       // handle: arizeai
  { id: "gh-dagster", name: "Dagster (Greenhouse)", source_type: "greenhouse", company_handle: "dagsterlabs",  base_url: "https://boards-api.greenhouse.io/v1/boards/dagsterlabs/jobs" },   // handle: dagsterlabs
  { id: "gh-viam",    name: "Viam (Greenhouse)",    source_type: "greenhouse", company_handle: "viamrobotics", base_url: "https://boards-api.greenhouse.io/v1/boards/viamrobotics/jobs" },  // handle: viamrobotics
  { id: "gh-remote",       name: "Remote.com (Greenhouse)",   source_type: "greenhouse", company_handle: "remote",        base_url: "https://boards-api.greenhouse.io/v1/boards/remote/jobs" },
  { id: "gh-miro",         name: "Miro (Greenhouse)",         source_type: "greenhouse", company_handle: "realtimeboardglobal", base_url: "https://boards-api.greenhouse.io/v1/boards/realtimeboardglobal/jobs" },
  { id: "gh-allbirds",     name: "Allbirds (Greenhouse)",     source_type: "greenhouse", company_handle: "allbirds",      base_url: "https://boards-api.greenhouse.io/v1/boards/allbirds/jobs" },
  { id: "gh-affirm",       name: "Affirm (Greenhouse)",       source_type: "greenhouse", company_handle: "affirm",        base_url: "https://boards-api.greenhouse.io/v1/boards/affirm/jobs" },
  { id: "gh-karbon",       name: "Karbon (Greenhouse)",       source_type: "greenhouse", company_handle: "karbon",        base_url: "https://boards-api.greenhouse.io/v1/boards/karbon/jobs" },
  { id: "gh-descript",         name: "Descript (Greenhouse)",          source_type: "greenhouse", company_handle: "descript",         base_url: "https://boards-api.greenhouse.io/v1/boards/descript/jobs" },
  { id: "gh-vectara",          name: "Vectara (Greenhouse)",           source_type: "greenhouse", company_handle: "vectara",          base_url: "https://boards-api.greenhouse.io/v1/boards/vectara/jobs" },
  { id: "gh-tines",            name: "Tines (Greenhouse)",             source_type: "greenhouse", company_handle: "tines",            base_url: "https://boards-api.greenhouse.io/v1/boards/tines/jobs" },
  { id: "gh-hightouch",        name: "Hightouch (Greenhouse)",         source_type: "greenhouse", company_handle: "hightouch",        base_url: "https://boards-api.greenhouse.io/v1/boards/hightouch/jobs" },
  { id: "gh-runpod",           name: "RunPod (Greenhouse)",            source_type: "greenhouse", company_handle: "runpod",           base_url: "https://boards-api.greenhouse.io/v1/boards/runpod/jobs" },
  { id: "gh-runwayml",         name: "Runway (Greenhouse)",            source_type: "greenhouse", company_handle: "runwayml",         base_url: "https://boards-api.greenhouse.io/v1/boards/runwayml/jobs" },
  { id: "gh-worldlabs",        name: "World Labs (Greenhouse)",        source_type: "greenhouse", company_handle: "worldlabs",        base_url: "https://boards-api.greenhouse.io/v1/boards/worldlabs/jobs" },
  { id: "gh-parloa",           name: "Parloa (Greenhouse)",            source_type: "greenhouse", company_handle: "parloa",           base_url: "https://boards-api.greenhouse.io/v1/boards/parloa/jobs" },
  { id: "gh-pallet",           name: "Pallet (Greenhouse)",            source_type: "greenhouse", company_handle: "pallet",           base_url: "https://boards-api.greenhouse.io/v1/boards/pallet/jobs" },
  { id: "gh-grafanalabs",      name: "Grafana Labs (Greenhouse)",      source_type: "greenhouse", company_handle: "grafanalabs",      base_url: "https://boards-api.greenhouse.io/v1/boards/grafanalabs/jobs" },
  { id: "gh-enterpret",        name: "Enterpret (Greenhouse)",         source_type: "greenhouse", company_handle: "enterpret",        base_url: "https://boards-api.greenhouse.io/v1/boards/enterpret/jobs" },
  { id: "gh-marqvision",       name: "MarqVision (Greenhouse)",        source_type: "greenhouse", company_handle: "marqvision",       base_url: "https://boards-api.greenhouse.io/v1/boards/marqvision/jobs" },
  { id: "gh-lithic",           name: "Lithic (Greenhouse)",            source_type: "greenhouse", company_handle: "lithic",           base_url: "https://boards-api.greenhouse.io/v1/boards/lithic/jobs" },
  { id: "gh-mercury",          name: "Mercury (Greenhouse)",           source_type: "greenhouse", company_handle: "mercury",          base_url: "https://boards-api.greenhouse.io/v1/boards/mercury/jobs" },
  { id: "gh-engine",           name: "Engine (Greenhouse)",            source_type: "greenhouse", company_handle: "engine",           base_url: "https://boards-api.greenhouse.io/v1/boards/engine/jobs" },
  { id: "gh-skildai-careers",  name: "Skild AI (Greenhouse)",          source_type: "greenhouse", company_handle: "skildai-careers",  base_url: "https://boards-api.greenhouse.io/v1/boards/skildai-careers/jobs" },
  { id: "gh-snorkelai",        name: "Snorkel AI (Greenhouse)",        source_type: "greenhouse", company_handle: "snorkelai",        base_url: "https://boards-api.greenhouse.io/v1/boards/snorkelai/jobs" },
  { id: "gh-thatch",           name: "Thatch (Greenhouse)",            source_type: "greenhouse", company_handle: "thatch",           base_url: "https://boards-api.greenhouse.io/v1/boards/thatch/jobs" },
  { id: "gh-typeface",         name: "Typeface (Greenhouse)",          source_type: "greenhouse", company_handle: "typeface",         base_url: "https://boards-api.greenhouse.io/v1/boards/typeface/jobs" },
  { id: "gh-tailscale",        name: "Tailscale (Greenhouse)",         source_type: "greenhouse", company_handle: "tailscale",        base_url: "https://boards-api.greenhouse.io/v1/boards/tailscale/jobs" },
  { id: "gh-lilasciences",     name: "Lila Sciences (Greenhouse)",     source_type: "greenhouse", company_handle: "lilasciences",     base_url: "https://boards-api.greenhouse.io/v1/boards/lilasciences/jobs" },
  { id: "gh-pulley",           name: "Pulley (Greenhouse)",            source_type: "greenhouse", company_handle: "pulley",           base_url: "https://boards-api.greenhouse.io/v1/boards/pulley/jobs" },
  { id: "gh-rootly",           name: "Rootly (Greenhouse)",            source_type: "greenhouse", company_handle: "rootly",           base_url: "https://boards-api.greenhouse.io/v1/boards/rootly/jobs" },
  { id: "gh-range",            name: "Range (Greenhouse)",             source_type: "greenhouse", company_handle: "range",            base_url: "https://boards-api.greenhouse.io/v1/boards/range/jobs" },
  { id: "gh-apex",             name: "Apex (Greenhouse)",              source_type: "greenhouse", company_handle: "apex",             base_url: "https://boards-api.greenhouse.io/v1/boards/apex/jobs" },
  { id: "gh-profound",         name: "Profound (Greenhouse)",          source_type: "greenhouse", company_handle: "profound",         base_url: "https://boards-api.greenhouse.io/v1/boards/profound/jobs" },
  { id: "gh-temporal",         name: "Temporal (Greenhouse)",          source_type: "greenhouse", company_handle: "temporal",         base_url: "https://boards-api.greenhouse.io/v1/boards/temporal/jobs" },
  { id: "gh-heygen",           name: "HeyGen (Greenhouse)",            source_type: "greenhouse", company_handle: "heygen",           base_url: "https://boards-api.greenhouse.io/v1/boards/heygen/jobs" },
  { id: "gh-torq",             name: "Torq (Greenhouse)",              source_type: "greenhouse", company_handle: "torq",             base_url: "https://boards-api.greenhouse.io/v1/boards/torq/jobs" },
  { id: "gh-biograph",         name: "Biograph (Greenhouse)",          source_type: "greenhouse", company_handle: "biograph",         base_url: "https://boards-api.greenhouse.io/v1/boards/biograph/jobs" },
  { id: "gh-blackforestlabs",  name: "Black Forest Labs (Greenhouse)", source_type: "greenhouse", company_handle: "blackforestlabs",  base_url: "https://boards-api.greenhouse.io/v1/boards/blackforestlabs/jobs" },
  { id: "gh-bluefishai",       name: "Bluefish AI (Greenhouse)",       source_type: "greenhouse", company_handle: "bluefishai",       base_url: "https://boards-api.greenhouse.io/v1/boards/bluefishai/jobs" },
  { id: "gh-senrasystems",     name: "Senra Systems (Greenhouse)",     source_type: "greenhouse", company_handle: "senrasystems",     base_url: "https://boards-api.greenhouse.io/v1/boards/senrasystems/jobs" },
  { id: "gh-stokespacetechnologies", name: "Stoke Space (Greenhouse)", source_type: "greenhouse", company_handle: "stokespacetechnologies", base_url: "https://boards-api.greenhouse.io/v1/boards/stokespacetechnologies/jobs" },
  { id: "gh-superblocks",      name: "Superblocks (Greenhouse)",       source_type: "greenhouse", company_handle: "superblocks",      base_url: "https://boards-api.greenhouse.io/v1/boards/superblocks/jobs" },
  { id: "gh-array",            name: "Array (Greenhouse)",             source_type: "greenhouse", company_handle: "array",            base_url: "https://boards-api.greenhouse.io/v1/boards/array/jobs" },
  { id: "gh-augmentcomputing", name: "Augment Code (Greenhouse)",      source_type: "greenhouse", company_handle: "augmentcomputing", base_url: "https://boards-api.greenhouse.io/v1/boards/augmentcomputing/jobs" },
  { id: "gh-lovable",          name: "Lovable (Greenhouse)",           source_type: "greenhouse", company_handle: "lovable",          base_url: "https://boards-api.greenhouse.io/v1/boards/lovable/jobs" },
  { id: "gh-copperhome",       name: "Copper (Greenhouse)",            source_type: "greenhouse", company_handle: "copperhome",       base_url: "https://boards-api.greenhouse.io/v1/boards/copperhome/jobs" },
  { id: "gh-cortex",           name: "Cortex (Greenhouse)",            source_type: "greenhouse", company_handle: "cortex",           base_url: "https://boards-api.greenhouse.io/v1/boards/cortex/jobs" },
  { id: "gh-m0dbathenextthingltd", name: "M0 (Greenhouse)",            source_type: "greenhouse", company_handle: "m0dbathenextthingltd", base_url: "https://boards-api.greenhouse.io/v1/boards/m0dbathenextthingltd/jobs" },
  { id: "gh-merge",            name: "Merge (Greenhouse)",             source_type: "greenhouse", company_handle: "merge",            base_url: "https://boards-api.greenhouse.io/v1/boards/merge/jobs" },
  { id: "gh-method",           name: "Method (Greenhouse)",            source_type: "greenhouse", company_handle: "method",           base_url: "https://boards-api.greenhouse.io/v1/boards/method/jobs" },
  { id: "gh-nerdy",            name: "Nerdy (Greenhouse)",             source_type: "greenhouse", company_handle: "nerdy",            base_url: "https://boards-api.greenhouse.io/v1/boards/nerdy/jobs" },
  { id: "gh-sie",              name: "Sony Interactive Entertainment", source_type: "greenhouse", company_handle: "sonyinteractiveentertainmentglobal", base_url: "https://boards-api.greenhouse.io/v1/boards/sonyinteractiveentertainmentglobal/jobs" },
  { id: "gh-nexhealth",        name: "NexHealth (Greenhouse)",         source_type: "greenhouse", company_handle: "nexhealth",        base_url: "https://boards-api.greenhouse.io/v1/boards/nexhealth/jobs" },
  { id: "gh-usenourish",       name: "Nourish (Greenhouse)",           source_type: "greenhouse", company_handle: "usenourish",       base_url: "https://boards-api.greenhouse.io/v1/boards/usenourish/jobs" },
  { id: "gh-youcom",           name: "You.com (Greenhouse)",           source_type: "greenhouse", company_handle: "youcom",           base_url: "https://boards-api.greenhouse.io/v1/boards/youcom/jobs" },
  { id: "gh-mixpanel",         name: "Mixpanel (Greenhouse)",          source_type: "greenhouse", company_handle: "mixpanel",         base_url: "https://boards-api.greenhouse.io/v1/boards/mixpanel/jobs" },
  { id: "gh-vast",             name: "Vast (Greenhouse)",              source_type: "greenhouse", company_handle: "vast",             base_url: "https://boards-api.greenhouse.io/v1/boards/vast/jobs" },
  { id: "gh-chainguard",           name: "Chainguard (Greenhouse)",            source_type: "greenhouse", company_handle: "chainguard",           base_url: "https://boards-api.greenhouse.io/v1/boards/chainguard/jobs" },
  { id: "gh-culturebiosciences",   name: "Culture Biosciences (Greenhouse)",   source_type: "greenhouse", company_handle: "culturebiosciences",   base_url: "https://boards-api.greenhouse.io/v1/boards/culturebiosciences/jobs" },
  { id: "gh-chalkinc",         name: "Chalk (Greenhouse)",             source_type: "greenhouse", company_handle: "chalkinc",         base_url: "https://boards-api.greenhouse.io/v1/boards/chalkinc/jobs" },
  { id: "gh-inflectionai",     name: "Inflection AI (Greenhouse)",     source_type: "greenhouse", company_handle: "inflectionai",     base_url: "https://boards-api.greenhouse.io/v1/boards/inflectionai/jobs" },
  { id: "gh-gensyn",           name: "Gensyn (Greenhouse)",            source_type: "greenhouse", company_handle: "gensyn",           base_url: "https://boards-api.greenhouse.io/v1/boards/gensyn/jobs" },
  { id: "gh-gigs",             name: "Gigs (Greenhouse)",              source_type: "greenhouse", company_handle: "gigs",             base_url: "https://boards-api.greenhouse.io/v1/boards/gigs/jobs" },
  { id: "gh-togetherai",       name: "Together AI (Greenhouse)",       source_type: "greenhouse", company_handle: "togetherai",       base_url: "https://boards-api.greenhouse.io/v1/boards/togetherai/jobs" },
  { id: "gh-whop",             name: "Whop (Greenhouse)",              source_type: "greenhouse", company_handle: "whop",             base_url: "https://boards-api.greenhouse.io/v1/boards/whop/jobs" },
  { id: "gh-withcoverage",     name: "WithCoverage (Greenhouse)",      source_type: "greenhouse", company_handle: "withcoverage",     base_url: "https://boards-api.greenhouse.io/v1/boards/withcoverage/jobs" },
  { id: "gh-physicsx",         name: "PhysicsX (Greenhouse)",          source_type: "greenhouse", company_handle: "physicsx",         base_url: "https://boards-api.greenhouse.io/v1/boards/physicsx/jobs" },
  { id: "gh-goodfire",         name: "Goodfire (Greenhouse)",          source_type: "greenhouse", company_handle: "goodfire",         base_url: "https://boards-api.greenhouse.io/v1/boards/goodfire/jobs" },
  { id: "gh-thinkingmachines", name: "Thinking Machines (Greenhouse)", source_type: "greenhouse", company_handle: "thinkingmachines", base_url: "https://boards-api.greenhouse.io/v1/boards/thinkingmachines/jobs" },
  { id: "gh-shopmy",           name: "ShopMy (Greenhouse)",            source_type: "greenhouse", company_handle: "shopmy",           base_url: "https://boards-api.greenhouse.io/v1/boards/shopmy/jobs" },
  { id: "gh-hebbia",           name: "Hebbia (Greenhouse)",            source_type: "greenhouse", company_handle: "hebbia",           base_url: "https://boards-api.greenhouse.io/v1/boards/hebbia/jobs" },
  { id: "gh-hextechnologies",  name: "Hex (Greenhouse)",               source_type: "greenhouse", company_handle: "hextechnologies",  base_url: "https://boards-api.greenhouse.io/v1/boards/hextechnologies/jobs" },
  { id: "gh-hiddenlayer",      name: "HiddenLayer (Greenhouse)",       source_type: "greenhouse", company_handle: "hiddenlayer",      base_url: "https://boards-api.greenhouse.io/v1/boards/hiddenlayer/jobs" },
  { id: "gh-imagentechnologies", name: "Imagen Technologies (Greenhouse)", source_type: "greenhouse", company_handle: "imagentechnologies", base_url: "https://boards-api.greenhouse.io/v1/boards/imagentechnologies/jobs" },
  { id: "gh-medrio",           name: "Medrio (Greenhouse)",            source_type: "greenhouse", company_handle: "medrio",           base_url: "https://boards-api.greenhouse.io/v1/boards/medrio/jobs" },
  { id: "gh-armada",           name: "Armada (Greenhouse)",            source_type: "greenhouse", company_handle: "armada",           base_url: "https://boards-api.greenhouse.io/v1/boards/armada/jobs" },
  { id: "gh-arenaai",          name: "Arena AI (Greenhouse)",          source_type: "greenhouse", company_handle: "arenaai",          base_url: "https://boards-api.greenhouse.io/v1/boards/arenaai/jobs" },
  { id: "gh-contextualai",     name: "Contextual AI (Greenhouse)",     source_type: "greenhouse", company_handle: "contextualai",     base_url: "https://boards-api.greenhouse.io/v1/boards/contextualai/jobs" },
  { id: "gh-loop",             name: "Loop (Greenhouse)",              source_type: "greenhouse", company_handle: "loop",             base_url: "https://boards-api.greenhouse.io/v1/boards/loop/jobs" },
  { id: "gh-tollbit",          name: "Tollbit (Greenhouse)",           source_type: "greenhouse", company_handle: "tollbit",          base_url: "https://boards-api.greenhouse.io/v1/boards/tollbit/jobs" },
  { id: "gh-topsort",          name: "Topsort (Greenhouse)",           source_type: "greenhouse", company_handle: "topsort",          base_url: "https://boards-api.greenhouse.io/v1/boards/topsort/jobs" },
  { id: "gh-coast",            name: "Coast (Greenhouse)",             source_type: "greenhouse", company_handle: "coast",            base_url: "https://boards-api.greenhouse.io/v1/boards/coast/jobs" },
  { id: "gh-bonfirestudios",   name: "Bonfire Studios (Greenhouse)",   source_type: "greenhouse", company_handle: "bonfirestudiosinc", base_url: "https://boards-api.greenhouse.io/v1/boards/bonfirestudiosinc/jobs" },
  { id: "gh-fingerprint",      name: "Fingerprint (Greenhouse)",       source_type: "greenhouse", company_handle: "fingerprint",      base_url: "https://boards-api.greenhouse.io/v1/boards/fingerprint/jobs" },
  { id: "gh-chronograph",      name: "Chronograph (Greenhouse)",       source_type: "greenhouse", company_handle: "chronograph",      base_url: "https://boards-api.greenhouse.io/v1/boards/chronograph/jobs" },
  { id: "gh-firsthand",        name: "Firsthand (Greenhouse)",         source_type: "greenhouse", company_handle: "firsthand",        base_url: "https://boards-api.greenhouse.io/v1/boards/firsthand/jobs" },
  { id: "gh-polyai",           name: "PolyAI (Greenhouse)",            source_type: "greenhouse", company_handle: "polyai",           base_url: "https://boards-api.greenhouse.io/v1/boards/polyai/jobs" },
  { id: "gh-doppel",           name: "Doppel (Greenhouse)",            source_type: "greenhouse", company_handle: "doppel",           base_url: "https://boards-api.greenhouse.io/v1/boards/doppel/jobs" },
  { id: "gh-verse",            name: "Verse (Greenhouse)",             source_type: "greenhouse", company_handle: "verse",            base_url: "https://boards-api.greenhouse.io/v1/boards/verse/jobs" },
  { id: "gh-newlimit",         name: "NewLimit (Greenhouse)",          source_type: "greenhouse", company_handle: "newlimit",         base_url: "https://boards-api.greenhouse.io/v1/boards/newlimit/jobs" },
  { id: "gh-wonderstudios",    name: "Wonder Studios (Greenhouse)",    source_type: "greenhouse", company_handle: "wonderstudios",    base_url: "https://boards-api.greenhouse.io/v1/boards/wonderstudios/jobs" },
  { id: "gh-warp",             name: "Warp (Greenhouse)",              source_type: "greenhouse", company_handle: "warp",             base_url: "https://boards-api.greenhouse.io/v1/boards/warp/jobs" },
  { id: "gh-wingspan",         name: "Wingspan (Greenhouse)",          source_type: "greenhouse", company_handle: "wingspan",         base_url: "https://boards-api.greenhouse.io/v1/boards/wingspan/jobs" },
  { id: "gh-flex",             name: "Flex (Greenhouse)",              source_type: "greenhouse", company_handle: "flex",             base_url: "https://boards-api.greenhouse.io/v1/boards/flex/jobs" },
  { id: "gh-mutiny",           name: "Mutiny (Greenhouse)",            source_type: "greenhouse", company_handle: "mutiny",           base_url: "https://boards-api.greenhouse.io/v1/boards/mutiny/jobs" },
  { id: "gh-eudia",            name: "Eudia (Greenhouse)",             source_type: "greenhouse", company_handle: "eudia",            base_url: "https://boards-api.greenhouse.io/v1/boards/eudia/jobs" },
  { id: "gh-fal",              name: "fal (Greenhouse)",               source_type: "greenhouse", company_handle: "fal",              base_url: "https://boards-api.greenhouse.io/v1/boards/fal/jobs" },
  { id: "gh-faire",            name: "Faire (Greenhouse)",            source_type: "greenhouse", company_handle: "faire",            base_url: "https://boards-api.greenhouse.io/v1/boards/faire/jobs" },
  { id: "gh-halcyon",          name: "Halcyon (Greenhouse)",           source_type: "greenhouse", company_handle: "halcyon",          base_url: "https://boards-api.greenhouse.io/v1/boards/halcyon/jobs" },
  { id: "gh-humeai",           name: "Hume AI (Greenhouse)",           source_type: "greenhouse", company_handle: "humeai",           base_url: "https://boards-api.greenhouse.io/v1/boards/humeai/jobs" },
  { id: "gh-hubspot",     name: "HubSpot",                  source_type: "greenhouse", company_handle: "hubspotjobs", base_url: "https://boards-api.greenhouse.io/v1/boards/hubspotjobs/jobs" },
  { id: "gh-layerzerolabs", name: "LayerZero Labs (Greenhouse)",    source_type: "greenhouse", company_handle: "layerzerolabs", base_url: "https://boards-api.greenhouse.io/v1/boards/layerzerolabs/jobs" },
  { id: "gh-lush",        name: "LUSH Cosmetics",   source_type: "greenhouse", company_handle: "lush",        base_url: "https://boards-api.greenhouse.io/v1/boards/lush/jobs" },
  { id: "gh-ogilvy",      name: "Ogilvy",           source_type: "greenhouse", company_handle: "ogilvy",      base_url: "https://boards-api.greenhouse.io/v1/boards/ogilvy/jobs" },
  { id: "gh-wpp",         name: "WPP",              source_type: "greenhouse", company_handle: "wpp",         base_url: "https://boards-api.greenhouse.io/v1/boards/wpp/jobs" },
  { id: "gh-vaynermedia", name: "VaynerMedia (Greenhouse)", source_type: "greenhouse", company_handle: "vaynermedia", base_url: "https://boards-api.greenhouse.io/v1/boards/vaynermedia/jobs" },
  { id: "gh-rga",         name: "R/GA (Greenhouse)",        source_type: "greenhouse", company_handle: "rga",         base_url: "https://boards-api.greenhouse.io/v1/boards/rga/jobs" },
  { id: "gh-akqa",        name: "AKQA (Greenhouse)",        source_type: "greenhouse", company_handle: "akqa",        base_url: "https://boards-api.greenhouse.io/v1/boards/akqa/jobs" },
  { id: "gh-hugeinc",     name: "Huge (Greenhouse)",        source_type: "greenhouse", company_handle: "hugeinc",     base_url: "https://boards-api.greenhouse.io/v1/boards/hugeinc/jobs" },
  { id: "gh-datacamp",    name: "DataCamp (Greenhouse)",   source_type: "greenhouse", company_handle: "datacamp",    base_url: "https://boards-api.greenhouse.io/v1/boards/datacamp/jobs" },
  { id: "gh-filescom",    name: "Files.com (Greenhouse)",  source_type: "greenhouse", company_handle: "filescom",    base_url: "https://boards-api.greenhouse.io/v1/boards/filescom/jobs" },
  { id: "gh-foratravel",  name: "Fora Travel (Greenhouse)", source_type: "greenhouse", company_handle: "foratravel", base_url: "https://boards-api.greenhouse.io/v1/boards/foratravel/jobs" },
  { id: "gh-forbes",      name: "Forbes (Greenhouse)",      source_type: "greenhouse", company_handle: "forbes",     base_url: "https://boards-api.greenhouse.io/v1/boards/forbes/jobs" },
  { id: "gh-xai",         name: "xAI (Greenhouse)",        source_type: "greenhouse", company_handle: "xai",         base_url: "https://boards-api.greenhouse.io/v1/boards/xai/jobs" },
  { id: "gh-samsara",     name: "Samsara (Greenhouse)",    source_type: "greenhouse", company_handle: "samsara",     base_url: "https://boards-api.greenhouse.io/v1/boards/samsara/jobs" },
  // Board id `abodo` (legacy domain) — ApartmentIQ / getapartmentiq.com
  { id: "gh-apartmentiq", name: "ApartmentIQ (Greenhouse)", source_type: "greenhouse", company_handle: "apartmentiq", base_url: "https://boards-api.greenhouse.io/v1/boards/abodo/jobs" },

  // ─── Ashby ────────────────────────────────────────────────────────────
  // Public posting API: https://api.ashbyhq.com/posting-api/job-board/{handle}
  { id: "ab-openai",       name: "OpenAI (Ashby)",           source_type: "ashby", company_handle: "openai",       base_url: "https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true" },
  { id: "ab-ramp",         name: "Ramp (Ashby)",             source_type: "ashby", company_handle: "ramp",         base_url: "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true" },
  { id: "ab-notion",       name: "Notion (Ashby)",           source_type: "ashby", company_handle: "notion",       base_url: "https://api.ashbyhq.com/posting-api/job-board/notion?includeCompensation=true" },
  { id: "ab-deel",         name: "Deel (Ashby)",             source_type: "ashby", company_handle: "deel",         base_url: "https://api.ashbyhq.com/posting-api/job-board/deel?includeCompensation=true" },
  { id: "ab-doji",         name: "Doji (Ashby)",             source_type: "ashby", company_handle: "doji",         base_url: "https://api.ashbyhq.com/posting-api/job-board/doji?includeCompensation=true" },
  { id: "ab-plaid",        name: "Plaid (Ashby)",            source_type: "ashby", company_handle: "plaid",        base_url: "https://api.ashbyhq.com/posting-api/job-board/plaid?includeCompensation=true" },
  { id: "ab-lemonade",     name: "Lemonade (Ashby)",         source_type: "ashby", company_handle: "lemonade",     base_url: "https://api.ashbyhq.com/posting-api/job-board/lemonade?includeCompensation=true" },
  { id: "ab-multiverse",   name: "Multiverse (Ashby)",       source_type: "ashby", company_handle: "multiverse",   base_url: "https://api.ashbyhq.com/posting-api/job-board/multiverse?includeCompensation=true" },
  { id: "ab-1password",    name: "1Password (Ashby)",        source_type: "ashby", company_handle: "1password",    base_url: "https://api.ashbyhq.com/posting-api/job-board/1password?includeCompensation=true" },
  { id: "ab-benchling",    name: "Benchling (Ashby)",        source_type: "ashby", company_handle: "benchling",    base_url: "https://api.ashbyhq.com/posting-api/job-board/benchling?includeCompensation=true" },
  { id: "ab-blackbird-labs-inc", name: "Blackbird Labs (Ashby)", source_type: "ashby", company_handle: "blackbird-labs-inc", base_url: "https://api.ashbyhq.com/posting-api/job-board/blackbird-labs-inc?includeCompensation=true" },
  { id: "ab-watershed",    name: "Watershed (Ashby)",        source_type: "ashby", company_handle: "watershed",    base_url: "https://api.ashbyhq.com/posting-api/job-board/watershed?includeCompensation=true" },
  { id: "ab-whatnot",      name: "Whatnot (Ashby)",         source_type: "ashby", company_handle: "whatnot",      base_url: "https://api.ashbyhq.com/posting-api/job-board/whatnot?includeCompensation=true" },
  { id: "ab-wealthsimple", name: "Wealthsimple (Ashby)",     source_type: "ashby", company_handle: "wealthsimple", base_url: "https://api.ashbyhq.com/posting-api/job-board/wealthsimple?includeCompensation=true" },
  { id: "ab-patreon",      name: "Patreon (Ashby)",          source_type: "ashby", company_handle: "patreon",      base_url: "https://api.ashbyhq.com/posting-api/job-board/patreon?includeCompensation=true" },
  { id: "ab-pennylane",    name: "Pennylane (Ashby)",        source_type: "ashby", company_handle: "pennylane",    base_url: "https://api.ashbyhq.com/posting-api/job-board/pennylane?includeCompensation=true" },
  { id: "ab-homebase",     name: "Homebase (Ashby)",         source_type: "ashby", company_handle: "homebase",     base_url: "https://api.ashbyhq.com/posting-api/job-board/homebase?includeCompensation=true" },
  { id: "ab-hinge-health", name: "Hinge Health (Ashby)",     source_type: "ashby", company_handle: "hinge-health", base_url: "https://api.ashbyhq.com/posting-api/job-board/hinge-health?includeCompensation=true" },
  { id: "ab-instructure",  name: "Instructure (Ashby)",      source_type: "ashby", company_handle: "instructure",  base_url: "https://api.ashbyhq.com/posting-api/job-board/instructure?includeCompensation=true" },
  { id: "ab-manusai",      name: "Manus AI (Ashby)",         source_type: "ashby", company_handle: "manusai",      base_url: "https://api.ashbyhq.com/posting-api/job-board/manusai?includeCompensation=true" },
  { id: "ab-snowflake",    name: "Snowflake (Ashby)",        source_type: "ashby", company_handle: "snowflake",    base_url: "https://api.ashbyhq.com/posting-api/job-board/snowflake?includeCompensation=true" },
  { id: "ab-hippocratic-ai", name: "Hippocratic AI (Ashby)", source_type: "ashby", company_handle: "Hippocratic AI", base_url: "https://api.ashbyhq.com/posting-api/job-board/Hippocratic%20AI?includeCompensation=true" },
  { id: "ab-poshmark",     name: "Poshmark (Ashby)",         source_type: "ashby", company_handle: "poshmark",     base_url: "https://api.ashbyhq.com/posting-api/job-board/poshmark?includeCompensation=true" },
  { id: "ab-away",         name: "Away (Ashby)",             source_type: "ashby", company_handle: "away",         base_url: "https://api.ashbyhq.com/posting-api/job-board/away?includeCompensation=true" },
  { id: "ab-brigit",       name: "Brigit (Ashby)",           source_type: "ashby", company_handle: "brigit",       base_url: "https://api.ashbyhq.com/posting-api/job-board/brigit?includeCompensation=true" },
  { id: "ab-acorns",       name: "Acorns (Ashby)",           source_type: "ashby", company_handle: "acorns",       base_url: "https://api.ashbyhq.com/posting-api/job-board/acorns?includeCompensation=true" },
  { id: "ab-linear",       name: "Linear (Ashby)",           source_type: "ashby", company_handle: "linear",       base_url: "https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true" },
  { id: "ab-perplexity",   name: "Perplexity AI (Ashby)",    source_type: "ashby", company_handle: "perplexity",   base_url: "https://api.ashbyhq.com/posting-api/job-board/perplexity?includeCompensation=true" },
  { id: "ab-elevenlabs",   name: "ElevenLabs (Ashby)",       source_type: "ashby", company_handle: "elevenlabs",   base_url: "https://api.ashbyhq.com/posting-api/job-board/elevenlabs?includeCompensation=true" },
  { id: "ab-sentry",       name: "Sentry (Ashby)",            source_type: "ashby",     company_handle: "sentry",        base_url: "https://api.ashbyhq.com/posting-api/job-board/sentry?includeCompensation=true" },
  { id: "ab-shepherd",     name: "Shepherd (Ashby)",          source_type: "ashby",     company_handle: "shepherd",      base_url: "https://api.ashbyhq.com/posting-api/job-board/shepherd?includeCompensation=true" },
  { id: "ab-kindred",          name: "Kindred (Ashby)",                source_type: "ashby", company_handle: "kindred",          base_url: "https://api.ashbyhq.com/posting-api/job-board/kindred?includeCompensation=true" },
  { id: "ab-tldraw",           name: "tldraw (Ashby)",                 source_type: "ashby", company_handle: "tldraw",           base_url: "https://api.ashbyhq.com/posting-api/job-board/tldraw?includeCompensation=true" },
  { id: "ab-magicschool",      name: "MagicSchool (Ashby)",            source_type: "ashby", company_handle: "magicschool",      base_url: "https://api.ashbyhq.com/posting-api/job-board/magicschool?includeCompensation=true" },
  { id: "ab-mandolin",         name: "Mandolin (Ashby)",               source_type: "ashby", company_handle: "mandolin",         base_url: "https://api.ashbyhq.com/posting-api/job-board/mandolin?includeCompensation=true" },
  { id: "ab-stacks",           name: "Stacks (Ashby)",                 source_type: "ashby", company_handle: "stacks",           base_url: "https://api.ashbyhq.com/posting-api/job-board/stacks?includeCompensation=true" },
  { id: "ab-standinsurance",   name: "Stand Insurance (Ashby)",        source_type: "ashby", company_handle: "standinsurance",   base_url: "https://api.ashbyhq.com/posting-api/job-board/standinsurance?includeCompensation=true" },
  { id: "ab-stedi",            name: "Stedi (Ashby)",                  source_type: "ashby", company_handle: "stedi",            base_url: "https://api.ashbyhq.com/posting-api/job-board/stedi?includeCompensation=true" },
  { id: "ab-stainlessapi",     name: "Stainless (Ashby)",              source_type: "ashby", company_handle: "stainlessapi",     base_url: "https://api.ashbyhq.com/posting-api/job-board/stainlessapi?includeCompensation=true" },
  { id: "ab-flora",            name: "Flora (Ashby)",                  source_type: "ashby", company_handle: "flora",            base_url: "https://api.ashbyhq.com/posting-api/job-board/flora?includeCompensation=true" },
  { id: "ab-persona",          name: "Persona (Ashby)",                source_type: "ashby", company_handle: "persona",          base_url: "https://api.ashbyhq.com/posting-api/job-board/persona?includeCompensation=true" },
  { id: "ab-alexai",           name: "Alex AI (Ashby)",               source_type: "ashby", company_handle: "alexai",           base_url: "https://api.ashbyhq.com/posting-api/job-board/alexai?includeCompensation=true" },
  { id: "ab-amigo",            name: "Amigo (Ashby)",                  source_type: "ashby", company_handle: "amigo",            base_url: "https://api.ashbyhq.com/posting-api/job-board/amigo?includeCompensation=true" },
  { id: "ab-anara",            name: "Anara (Ashby)",                  source_type: "ashby", company_handle: "anara",            base_url: "https://api.ashbyhq.com/posting-api/job-board/anara?includeCompensation=true" },
  { id: "ab-anrok",            name: "Anrok (Ashby)",                  source_type: "ashby", company_handle: "anrok",            base_url: "https://api.ashbyhq.com/posting-api/job-board/anrok?includeCompensation=true" },
  { id: "ab-onepay",           name: "OnePay (Ashby)",                 source_type: "ashby", company_handle: "oneapp",           base_url: "https://api.ashbyhq.com/posting-api/job-board/oneapp?includeCompensation=true" },
  { id: "ab-browser-company",  name: "The Browser Company (Ashby)",    source_type: "ashby", company_handle: "The Browser Company", base_url: "https://api.ashbyhq.com/posting-api/job-board/The%20Browser%20Company?includeCompensation=true" },
  { id: "ab-listenlabs",       name: "Listen Labs (Ashby)",            source_type: "ashby", company_handle: "listenlabs",       base_url: "https://api.ashbyhq.com/posting-api/job-board/listenlabs?includeCompensation=true" },
  { id: "ab-numeric",          name: "Numeric (Ashby)",                source_type: "ashby", company_handle: "numeric",          base_url: "https://api.ashbyhq.com/posting-api/job-board/numeric?includeCompensation=true" },
  { id: "ab-nooks",            name: "Nooks (Ashby)",                  source_type: "ashby", company_handle: "nooks",            base_url: "https://api.ashbyhq.com/posting-api/job-board/nooks?includeCompensation=true" },
  { id: "ab-lyric",            name: "Lyric (Ashby)",                  source_type: "ashby", company_handle: "lyric",            base_url: "https://api.ashbyhq.com/posting-api/job-board/lyric?includeCompensation=true" },
  { id: "ab-mural",            name: "Mural (Ashby)",                  source_type: "ashby", company_handle: "mural",            base_url: "https://api.ashbyhq.com/posting-api/job-board/mural?includeCompensation=true" },
  { id: "ab-adaptive-ml",      name: "Adaptive ML (Ashby)",            source_type: "ashby", company_handle: "adaptive-ml",      base_url: "https://api.ashbyhq.com/posting-api/job-board/adaptive-ml?includeCompensation=true" },
  { id: "ab-adaptivesecurity", name: "Adaptive Security (Ashby)",    source_type: "ashby", company_handle: "adaptivesecurity", base_url: "https://api.ashbyhq.com/posting-api/job-board/adaptivesecurity?includeCompensation=true" },
  { id: "ab-aegis-ai",         name: "Aegis AI (Ashby)",               source_type: "ashby", company_handle: "aegis-ai",         base_url: "https://api.ashbyhq.com/posting-api/job-board/aegis-ai?includeCompensation=true" },
  { id: "ab-cinder",           name: "Cinder (Ashby)",                 source_type: "ashby", company_handle: "cinder",           base_url: "https://api.ashbyhq.com/posting-api/job-board/cinder?includeCompensation=true" },
  { id: "ab-taktile",          name: "Taktile (Ashby)",                source_type: "ashby", company_handle: "taktile",          base_url: "https://api.ashbyhq.com/posting-api/job-board/taktile?includeCompensation=true" },
  { id: "ab-david-ai",         name: "David AI (Ashby)",               source_type: "ashby", company_handle: "david-ai",         base_url: "https://api.ashbyhq.com/posting-api/job-board/david-ai?includeCompensation=true" },
  { id: "ab-delphi",           name: "Delphi (Ashby)",                 source_type: "ashby", company_handle: "delphi",           base_url: "https://api.ashbyhq.com/posting-api/job-board/delphi?includeCompensation=true" },
  { id: "ab-doppel",           name: "Doppel (Ashby)",                 source_type: "ashby", company_handle: "doppel",           base_url: "https://api.ashbyhq.com/posting-api/job-board/doppel?includeCompensation=true" },
  { id: "ab-flutterflow",      name: "FlutterFlow (Ashby)",            source_type: "ashby", company_handle: "flutterflow",      base_url: "https://api.ashbyhq.com/posting-api/job-board/flutterflow?includeCompensation=true" },
  { id: "ab-imprint",          name: "Imprint (Ashby)",                source_type: "ashby", company_handle: "imprint",          base_url: "https://api.ashbyhq.com/posting-api/job-board/imprint?includeCompensation=true" },
  { id: "ab-permitflow",       name: "PermitFlow (Ashby)",             source_type: "ashby", company_handle: "permitflow",       base_url: "https://api.ashbyhq.com/posting-api/job-board/permitflow?includeCompensation=true" },
  { id: "ab-campus",           name: "Campus (Ashby)",                 source_type: "ashby", company_handle: "campus",           base_url: "https://api.ashbyhq.com/posting-api/job-board/campus?includeCompensation=true" },
  { id: "ab-attio",            name: "Attio (Ashby)",                  source_type: "ashby", company_handle: "attio",            base_url: "https://api.ashbyhq.com/posting-api/job-board/attio?includeCompensation=true" },
  { id: "ab-trm-labs",         name: "TRM Labs (Ashby)",               source_type: "ashby", company_handle: "trm-labs",         base_url: "https://api.ashbyhq.com/posting-api/job-board/trm-labs?includeCompensation=true" },
  { id: "ab-scribe",           name: "Scribe (Ashby)",                 source_type: "ashby", company_handle: "scribe",           base_url: "https://api.ashbyhq.com/posting-api/job-board/scribe?includeCompensation=true" },
  { id: "ab-sesame",           name: "Sesame (Ashby)",                 source_type: "ashby", company_handle: "sesame",           base_url: "https://api.ashbyhq.com/posting-api/job-board/sesame?includeCompensation=true" },
  { id: "ab-lio",              name: "Lio (Ashby)",                    source_type: "ashby", company_handle: "lio",              base_url: "https://api.ashbyhq.com/posting-api/job-board/lio?includeCompensation=true" },
  { id: "ab-n8n",              name: "n8n (Ashby)",                    source_type: "ashby", company_handle: "n8n",              base_url: "https://api.ashbyhq.com/posting-api/job-board/n8n?includeCompensation=true" },
  { id: "ab-arq",              name: "ARQ (Ashby)",                    source_type: "ashby", company_handle: "arq",              base_url: "https://api.ashbyhq.com/posting-api/job-board/arq?includeCompensation=true" },
  { id: "ab-vanta",            name: "Vanta (Ashby)",                  source_type: "ashby", company_handle: "vanta",            base_url: "https://api.ashbyhq.com/posting-api/job-board/vanta?includeCompensation=true" },
  { id: "ab-vizcom",           name: "Vizcom (Ashby)",                 source_type: "ashby", company_handle: "vizcom",           base_url: "https://api.ashbyhq.com/posting-api/job-board/vizcom?includeCompensation=true" },
  { id: "ab-rain",             name: "Rain (Ashby)",                   source_type: "ashby", company_handle: "rain",             base_url: "https://api.ashbyhq.com/posting-api/job-board/rain?includeCompensation=true" },
  { id: "ab-rho",              name: "Rho (Ashby)",                    source_type: "ashby", company_handle: "rho",              base_url: "https://api.ashbyhq.com/posting-api/job-board/rho?includeCompensation=true" },
  { id: "ab-cartesia",         name: "Cartesia (Ashby)",               source_type: "ashby", company_handle: "cartesia",         base_url: "https://api.ashbyhq.com/posting-api/job-board/cartesia?includeCompensation=true" },
  { id: "ab-coderabbit",       name: "CodeRabbit (Ashby)",             source_type: "ashby", company_handle: "coderabbit",       base_url: "https://api.ashbyhq.com/posting-api/job-board/coderabbit?includeCompensation=true" },
  { id: "ab-mirage",           name: "Mirage (Ashby)",                 source_type: "ashby", company_handle: "mirage",           base_url: "https://api.ashbyhq.com/posting-api/job-board/mirage?includeCompensation=true" },
  { id: "ab-tavus",            name: "Tavus (Ashby)",                  source_type: "ashby", company_handle: "tavus",            base_url: "https://api.ashbyhq.com/posting-api/job-board/tavus?includeCompensation=true" },
  { id: "ab-tracebit",         name: "Tracebit (Ashby)",               source_type: "ashby", company_handle: "tracebit",         base_url: "https://api.ashbyhq.com/posting-api/job-board/tracebit?includeCompensation=true" },
  { id: "ab-mercor",           name: "Mercor (Ashby)",                 source_type: "ashby", company_handle: "mercor",           base_url: "https://api.ashbyhq.com/posting-api/job-board/mercor?includeCompensation=true" },
  { id: "ab-method",           name: "Method Financial (Ashby)",       source_type: "ashby", company_handle: "method",           base_url: "https://api.ashbyhq.com/posting-api/job-board/method?includeCompensation=true" },
  { id: "ab-finch",            name: "Finch (Ashby)",                  source_type: "ashby", company_handle: "finch",            base_url: "https://api.ashbyhq.com/posting-api/job-board/finch?includeCompensation=true" },
  { id: "ab-finch-legal",      name: "Finch Legal (Ashby)",            source_type: "ashby", company_handle: "finch-legal",      base_url: "https://api.ashbyhq.com/posting-api/job-board/finch-legal?includeCompensation=true" },
  { id: "ab-fin",              name: "Fin (Ashby)",                    source_type: "ashby", company_handle: "fin",              base_url: "https://api.ashbyhq.com/posting-api/job-board/fin?includeCompensation=true" },
  { id: "ab-column",           name: "Column (Ashby)",                 source_type: "ashby", company_handle: "column",           base_url: "https://api.ashbyhq.com/posting-api/job-board/column?includeCompensation=true" },
  { id: "ab-cursor",           name: "Cursor (Ashby)",                 source_type: "ashby", company_handle: "cursor",           base_url: "https://api.ashbyhq.com/posting-api/job-board/cursor?includeCompensation=true" },
  { id: "ab-venn",             name: "Venn (Ashby)",                   source_type: "ashby", company_handle: "venn",             base_url: "https://api.ashbyhq.com/posting-api/job-board/venn?includeCompensation=true" },
  { id: "ab-wrapbook",         name: "Wrapbook (Ashby)",               source_type: "ashby", company_handle: "wrapbook",         base_url: "https://api.ashbyhq.com/posting-api/job-board/wrapbook?includeCompensation=true" },
  { id: "ab-anima",            name: "Anima (Ashby)",                  source_type: "ashby", company_handle: "anima",            base_url: "https://api.ashbyhq.com/posting-api/job-board/anima?includeCompensation=true" },
  { id: "ab-dust",             name: "Dust (Ashby)",                   source_type: "ashby", company_handle: "dust",             base_url: "https://api.ashbyhq.com/posting-api/job-board/dust?includeCompensation=true" },
  { id: "ab-sequence",         name: "Sequence (Ashby)",               source_type: "ashby", company_handle: "sequence",         base_url: "https://api.ashbyhq.com/posting-api/job-board/sequence?includeCompensation=true" },
  { id: "ab-ekho",             name: "Ekho (Ashby)",                   source_type: "ashby", company_handle: "ekho",             base_url: "https://api.ashbyhq.com/posting-api/job-board/ekho?includeCompensation=true" },
  { id: "ab-eliseai",          name: "EliseAI (Ashby)",                source_type: "ashby", company_handle: "eliseai",          base_url: "https://api.ashbyhq.com/posting-api/job-board/eliseai?includeCompensation=true" },
  { id: "ab-ema",              name: "Ema (Ashby)",                    source_type: "ashby", company_handle: "ema",              base_url: "https://api.ashbyhq.com/posting-api/job-board/ema?includeCompensation=true" },
  { id: "ab-enode",            name: "Enode (Ashby)",                  source_type: "ashby", company_handle: "enode",            base_url: "https://api.ashbyhq.com/posting-api/job-board/enode?includeCompensation=true" },
  { id: "ab-sydecar",          name: "Sydecar (Ashby)",                source_type: "ashby", company_handle: "sydecar",          base_url: "https://api.ashbyhq.com/posting-api/job-board/sydecar?includeCompensation=true" },
  { id: "ab-sandbar",          name: "Sandbar (Ashby)",                source_type: "ashby", company_handle: "sandbar",          base_url: "https://api.ashbyhq.com/posting-api/job-board/sandbar?includeCompensation=true" },
  { id: "ab-sanity",           name: "Sanity (Ashby)",                 source_type: "ashby", company_handle: "sanity",           base_url: "https://api.ashbyhq.com/posting-api/job-board/sanity?includeCompensation=true" },
  { id: "ab-sierra",           name: "Sierra (Ashby)",                 source_type: "ashby", company_handle: "sierra",           base_url: "https://api.ashbyhq.com/posting-api/job-board/sierra?includeCompensation=true" },
  { id: "ab-siena",            name: "Siena AI (Ashby)",               source_type: "ashby", company_handle: "siena",            base_url: "https://api.ashbyhq.com/posting-api/job-board/siena?includeCompensation=true" },
  { id: "ab-sunday",           name: "Sunday (Ashby)",                 source_type: "ashby", company_handle: "sunday",           base_url: "https://api.ashbyhq.com/posting-api/job-board/sunday?includeCompensation=true" },
  { id: "ab-sunrise",          name: "Sunrise Robotics (Ashby)",       source_type: "ashby", company_handle: "sunrise",          base_url: "https://api.ashbyhq.com/posting-api/job-board/sunrise?includeCompensation=true" },
  { id: "ab-serval",           name: "Serval (Ashby)",                 source_type: "ashby", company_handle: "serval",           base_url: "https://api.ashbyhq.com/posting-api/job-board/serval?includeCompensation=true" },
  { id: "ab-swap",             name: "Swap (Ashby)",                   source_type: "ashby", company_handle: "swap",             base_url: "https://api.ashbyhq.com/posting-api/job-board/swap?includeCompensation=true" },
  { id: "ab-allium",           name: "Allium (Ashby)",                 source_type: "ashby", company_handle: "allium",           base_url: "https://api.ashbyhq.com/posting-api/job-board/allium?includeCompensation=true" },
  { id: "ab-zip",              name: "Zip (Ashby)",                    source_type: "ashby", company_handle: "zip",              base_url: "https://api.ashbyhq.com/posting-api/job-board/zip?includeCompensation=true" },
  { id: "ab-plain",            name: "Plain (Ashby)",                  source_type: "ashby", company_handle: "plain",            base_url: "https://api.ashbyhq.com/posting-api/job-board/plain?includeCompensation=true" },
  { id: "ab-decagon",          name: "Decagon (Ashby)",                source_type: "ashby", company_handle: "decagon",          base_url: "https://api.ashbyhq.com/posting-api/job-board/decagon?includeCompensation=true" },
  { id: "ab-bunch",            name: "Bunch (Ashby)",                  source_type: "ashby", company_handle: "bunch",            base_url: "https://api.ashbyhq.com/posting-api/job-board/bunch?includeCompensation=true" },
  { id: "ab-palmstreet",       name: "Palmstreet (Ashby)",             source_type: "ashby", company_handle: "palmstreet",       base_url: "https://api.ashbyhq.com/posting-api/job-board/palmstreet?includeCompensation=true" },
  { id: "ab-assorthealth",     name: "Assort Health (Ashby)",          source_type: "ashby", company_handle: "assorthealth",     base_url: "https://api.ashbyhq.com/posting-api/job-board/assorthealth?includeCompensation=true" },
  { id: "ab-centari",          name: "Centari (Ashby)",                source_type: "ashby", company_handle: "centari",          base_url: "https://api.ashbyhq.com/posting-api/job-board/centari?includeCompensation=true" },
  { id: "ab-baseten",          name: "Baseten (Ashby)",                source_type: "ashby", company_handle: "baseten",          base_url: "https://api.ashbyhq.com/posting-api/job-board/baseten?includeCompensation=true" },
  { id: "ab-tennr",            name: "Tennr (Ashby)",                  source_type: "ashby", company_handle: "tennr",            base_url: "https://api.ashbyhq.com/posting-api/job-board/tennr?includeCompensation=true" },
  { id: "ab-dyna-robotics",    name: "Dyna Robotics (Ashby)",          source_type: "ashby", company_handle: "dyna-robotics",    base_url: "https://api.ashbyhq.com/posting-api/job-board/dyna-robotics?includeCompensation=true" },
  { id: "ab-parafin",          name: "Parafin (Ashby)",                source_type: "ashby", company_handle: "parafin",          base_url: "https://api.ashbyhq.com/posting-api/job-board/parafin?includeCompensation=true" },
  { id: "ab-pylon-labs",       name: "Pylon (Ashby)",                  source_type: "ashby", company_handle: "pylon-labs",       base_url: "https://api.ashbyhq.com/posting-api/job-board/pylon-labs?includeCompensation=true" },
  { id: "ab-partly-com",       name: "Partly (Ashby)",                 source_type: "ashby", company_handle: "partly.com",       base_url: "https://api.ashbyhq.com/posting-api/job-board/partly.com?includeCompensation=true" },
  { id: "ab-lindy",            name: "Lindy (Ashby)",                  source_type: "ashby", company_handle: "lindy",            base_url: "https://api.ashbyhq.com/posting-api/job-board/lindy?includeCompensation=true" },
  { id: "ab-lightspark",       name: "Lightspark (Ashby)",             source_type: "ashby", company_handle: "lightspark",       base_url: "https://api.ashbyhq.com/posting-api/job-board/lightspark?includeCompensation=true" },
  { id: "ab-llamaindex",       name: "LlamaIndex (Ashby)",             source_type: "ashby", company_handle: "llamaindex",       base_url: "https://api.ashbyhq.com/posting-api/job-board/llamaindex?includeCompensation=true" },
  { id: "ab-lovable",          name: "Lovable (Ashby)",                source_type: "ashby", company_handle: "lovable",          base_url: "https://api.ashbyhq.com/posting-api/job-board/lovable?includeCompensation=true" },
  { id: "ab-numeral",          name: "Numeral (Ashby)",                source_type: "ashby", company_handle: "numeral",          base_url: "https://api.ashbyhq.com/posting-api/job-board/numeral?includeCompensation=true" },
  { id: "ab-moment",           name: "Moment (Ashby)",                 source_type: "ashby", company_handle: "moment",           base_url: "https://api.ashbyhq.com/posting-api/job-board/moment?includeCompensation=true" },
  { id: "ab-dash0",            name: "Dash0 (Ashby)",                  source_type: "ashby", company_handle: "dash0",            base_url: "https://api.ashbyhq.com/posting-api/job-board/dash0?includeCompensation=true" },
  { id: "ab-daydream-ai",      name: "Daydream (Ashby)",               source_type: "ashby", company_handle: "daydream-ai",      base_url: "https://api.ashbyhq.com/posting-api/job-board/daydream-ai?includeCompensation=true" },
  { id: "ab-factory",          name: "Factory (Ashby)",                source_type: "ashby", company_handle: "factory",          base_url: "https://api.ashbyhq.com/posting-api/job-board/factory?includeCompensation=true" },
  { id: "ab-juicebox",         name: "Juicebox (Ashby)",               source_type: "ashby", company_handle: "juicebox",         base_url: "https://api.ashbyhq.com/posting-api/job-board/juicebox?includeCompensation=true" },
  { id: "ab-browserbase",      name: "Browserbase (Ashby)",            source_type: "ashby", company_handle: "browserbase",      base_url: "https://api.ashbyhq.com/posting-api/job-board/browserbase?includeCompensation=true" },
  { id: "ab-profound",         name: "Profound (Ashby)",               source_type: "ashby", company_handle: "profound",         base_url: "https://api.ashbyhq.com/posting-api/job-board/profound?includeCompensation=true" },
  { id: "ab-promise",          name: "Promise (Ashby)",                source_type: "ashby", company_handle: "promise",          base_url: "https://api.ashbyhq.com/posting-api/job-board/promise?includeCompensation=true" },
  { id: "ab-monaco",           name: "Monaco (Ashby)",                 source_type: "ashby", company_handle: "monaco",           base_url: "https://api.ashbyhq.com/posting-api/job-board/monaco?includeCompensation=true" },
  { id: "ab-netic",            name: "Netic (Ashby)",                  source_type: "ashby", company_handle: "netic",            base_url: "https://api.ashbyhq.com/posting-api/job-board/netic?includeCompensation=true" },
  { id: "ab-laurel",           name: "Laurel (Ashby)",                 source_type: "ashby", company_handle: "laurel",           base_url: "https://api.ashbyhq.com/posting-api/job-board/laurel?includeCompensation=true" },
  { id: "ab-langfuse",         name: "Langfuse (Ashby)",               source_type: "ashby", company_handle: "langfuse",         base_url: "https://api.ashbyhq.com/posting-api/job-board/langfuse?includeCompensation=true" },
  { id: "ab-langchain",        name: "LangChain (Ashby)",              source_type: "ashby", company_handle: "langchain",        base_url: "https://api.ashbyhq.com/posting-api/job-board/langchain?includeCompensation=true" },
  { id: "ab-ashby",            name: "Ashby (Ashby)",                  source_type: "ashby", company_handle: "ashby",            base_url: "https://api.ashbyhq.com/posting-api/job-board/ashby?includeCompensation=true" },
  { id: "ab-pinecone",         name: "Pinecone (Ashby)",               source_type: "ashby", company_handle: "pinecone",         base_url: "https://api.ashbyhq.com/posting-api/job-board/pinecone?includeCompensation=true" },
  { id: "ab-neko-health",      name: "Neko Health (Ashby)",            source_type: "ashby", company_handle: "neko-health",      base_url: "https://api.ashbyhq.com/posting-api/job-board/neko-health?includeCompensation=true" },
  { id: "ab-mintlify",         name: "Mintlify (Ashby)",               source_type: "ashby", company_handle: "mintlify",         base_url: "https://api.ashbyhq.com/posting-api/job-board/mintlify?includeCompensation=true" },
  { id: "ab-unify",            name: "Unify (Ashby)",                  source_type: "ashby", company_handle: "unify",            base_url: "https://api.ashbyhq.com/posting-api/job-board/unify?includeCompensation=true" },
  { id: "ab-scrunch",          name: "Scrunch (Ashby)",                source_type: "ashby", company_handle: "scrunch",          base_url: "https://api.ashbyhq.com/posting-api/job-board/scrunch?includeCompensation=true" },
  { id: "ab-granola",          name: "Granola (Ashby)",                source_type: "ashby", company_handle: "granola",          base_url: "https://api.ashbyhq.com/posting-api/job-board/granola?includeCompensation=true" },
  { id: "ab-graphite",         name: "Graphite (Ashby)",               source_type: "ashby", company_handle: "graphite",         base_url: "https://api.ashbyhq.com/posting-api/job-board/graphite?includeCompensation=true" },
  { id: "ab-casca",            name: "Casca (Ashby)",                  source_type: "ashby", company_handle: "casca",            base_url: "https://api.ashbyhq.com/posting-api/job-board/casca?includeCompensation=true" },
  { id: "ab-crosby",           name: "Crosby (Ashby)",                 source_type: "ashby", company_handle: "crosby",           base_url: "https://api.ashbyhq.com/posting-api/job-board/crosby?includeCompensation=true" },
  { id: "ab-cruxclimate",      name: "Crux (Ashby)",                   source_type: "ashby", company_handle: "cruxclimate",      base_url: "https://api.ashbyhq.com/posting-api/job-board/cruxclimate?includeCompensation=true" },
  { id: "ab-appliedlabs",      name: "Applied Labs (Ashby)",           source_type: "ashby", company_handle: "appliedlabs",      base_url: "https://api.ashbyhq.com/posting-api/job-board/appliedlabs?includeCompensation=true" },
  { id: "ab-april",            name: "April (Ashby)",                  source_type: "ashby", company_handle: "april",            base_url: "https://api.ashbyhq.com/posting-api/job-board/april?includeCompensation=true" },
  { id: "ab-apex-technology-inc", name: "Apex Technology (Ashby)",   source_type: "ashby", company_handle: "apex-technology-inc", base_url: "https://api.ashbyhq.com/posting-api/job-board/apex-technology-inc?includeCompensation=true" },
  { id: "ab-synthesia",        name: "Synthesia (Ashby)",              source_type: "ashby", company_handle: "synthesia",        base_url: "https://api.ashbyhq.com/posting-api/job-board/synthesia?includeCompensation=true" },
  { id: "ab-rillet",           name: "Rillet (Ashby)",                 source_type: "ashby", company_handle: "rillet",           base_url: "https://api.ashbyhq.com/posting-api/job-board/rillet?includeCompensation=true" },
  { id: "ab-vantage",          name: "Vantage (Ashby)",                source_type: "ashby", company_handle: "vantage",          base_url: "https://api.ashbyhq.com/posting-api/job-board/vantage?includeCompensation=true" },
  { id: "ab-tabs",             name: "Tabs (Ashby)",                   source_type: "ashby", company_handle: "tabs",             base_url: "https://api.ashbyhq.com/posting-api/job-board/tabs?includeCompensation=true" },
  { id: "ab-turnkey",          name: "Turnkey (Ashby)",                source_type: "ashby", company_handle: "turnkey",          base_url: "https://api.ashbyhq.com/posting-api/job-board/turnkey?includeCompensation=true" },
  { id: "ab-gigaml",           name: "GigaML (Ashby)",                 source_type: "ashby", company_handle: "gigaml",           base_url: "https://api.ashbyhq.com/posting-api/job-board/gigaml?includeCompensation=true" },
  { id: "ab-duna",             name: "Duna (Ashby)",                   source_type: "ashby", company_handle: "duna",             base_url: "https://api.ashbyhq.com/posting-api/job-board/duna?includeCompensation=true" },
  { id: "ab-firecrawl",        name: "Firecrawl (Ashby)",              source_type: "ashby", company_handle: "firecrawl",        base_url: "https://api.ashbyhq.com/posting-api/job-board/firecrawl?includeCompensation=true" },
  { id: "ab-thread-ai",        name: "Thread AI (Ashby)",              source_type: "ashby", company_handle: "thread-ai",        base_url: "https://api.ashbyhq.com/posting-api/job-board/thread-ai?includeCompensation=true" },
  { id: "ab-tin-can",          name: "Tin Can (Ashby)",                source_type: "ashby", company_handle: "tin-can",          base_url: "https://api.ashbyhq.com/posting-api/job-board/tin-can?includeCompensation=true" },
  { id: "ab-tigerdata",        name: "TigerData (Ashby)",              source_type: "ashby", company_handle: "tigerdata",        base_url: "https://api.ashbyhq.com/posting-api/job-board/tigerdata?includeCompensation=true" },
  { id: "ab-reducto",          name: "Reducto (Ashby)",                source_type: "ashby", company_handle: "reducto",          base_url: "https://api.ashbyhq.com/posting-api/job-board/reducto?includeCompensation=true" },
  { id: "ab-reevo",            name: "Reevo (Ashby)",                  source_type: "ashby", company_handle: "reevo",            base_url: "https://api.ashbyhq.com/posting-api/job-board/reevo?includeCompensation=true" },
  { id: "ab-range",            name: "Range (Ashby)",                  source_type: "ashby", company_handle: "range",            base_url: "https://api.ashbyhq.com/posting-api/job-board/range?includeCompensation=true" },
  { id: "ab-replit",           name: "Replit (Ashby)",                 source_type: "ashby", company_handle: "replit",           base_url: "https://api.ashbyhq.com/posting-api/job-board/replit?includeCompensation=true" },
  { id: "ab-ridealso",         name: "ALSO (Ashby)",                   source_type: "ashby", company_handle: "ridealso",         base_url: "https://api.ashbyhq.com/posting-api/job-board/ridealso?includeCompensation=true" },
  { id: "ab-runlayer",         name: "Runlayer (Ashby)",               source_type: "ashby", company_handle: "runlayer",         base_url: "https://api.ashbyhq.com/posting-api/job-board/runlayer?includeCompensation=true" },
  { id: "ab-omnea",            name: "Omnea (Ashby)",                  source_type: "ashby", company_handle: "omnea",            base_url: "https://api.ashbyhq.com/posting-api/job-board/omnea?includeCompensation=true" },
  { id: "ab-osmo",             name: "Osmo (Ashby)",                   source_type: "ashby", company_handle: "osmo",             base_url: "https://api.ashbyhq.com/posting-api/job-board/osmo?includeCompensation=true" },
  { id: "ab-symbiotic",        name: "Symbiotic (Ashby)",              source_type: "ashby", company_handle: "symbiotic",        base_url: "https://api.ashbyhq.com/posting-api/job-board/symbiotic?includeCompensation=true" },
  { id: "ab-primer",           name: "Primer (Ashby)",                 source_type: "ashby", company_handle: "primer",           base_url: "https://api.ashbyhq.com/posting-api/job-board/primer?includeCompensation=true" },
  { id: "ab-brettonai",        name: "Bretton AI (Ashby)",             source_type: "ashby", company_handle: "brettonai",        base_url: "https://api.ashbyhq.com/posting-api/job-board/brettonai?includeCompensation=true" },
  { id: "ab-outtake",          name: "Outtake (Ashby)",                source_type: "ashby", company_handle: "outtake",          base_url: "https://api.ashbyhq.com/posting-api/job-board/outtake?includeCompensation=true" },
  { id: "ab-bureau",           name: "Bureau (Ashby)",                 source_type: "ashby", company_handle: "bureau",           base_url: "https://api.ashbyhq.com/posting-api/job-board/bureau?includeCompensation=true" },
  { id: "ab-arcade",           name: "Arcade AI (Ashby)",              source_type: "ashby", company_handle: "arcade-ai",        base_url: "https://api.ashbyhq.com/posting-api/job-board/arcade-ai?includeCompensation=true" },
  { id: "ab-base-power",       name: "Base Power (Ashby)",             source_type: "ashby", company_handle: "base-power",       base_url: "https://api.ashbyhq.com/posting-api/job-board/base-power?includeCompensation=true" },
  { id: "ab-checkly",          name: "Checkly (Ashby)",                source_type: "ashby", company_handle: "checkly",          base_url: "https://api.ashbyhq.com/posting-api/job-board/checkly?includeCompensation=true" },
  { id: "ab-cambio",           name: "Cambio AI (Ashby)",              source_type: "ashby", company_handle: "cambio",           base_url: "https://api.ashbyhq.com/posting-api/job-board/cambio?includeCompensation=true" },
  { id: "ab-choco",            name: "Choco (Ashby)",                  source_type: "ashby", company_handle: "choco",            base_url: "https://api.ashbyhq.com/posting-api/job-board/choco?includeCompensation=true" },
  { id: "ab-clerk",            name: "Clerk (Ashby)",                  source_type: "ashby", company_handle: "clerk",            base_url: "https://api.ashbyhq.com/posting-api/job-board/clerk?includeCompensation=true" },
  { id: "ab-koahlabs",         name: "Koah Labs (Ashby)",              source_type: "ashby", company_handle: "koahlabs",         base_url: "https://api.ashbyhq.com/posting-api/job-board/koahlabs?includeCompensation=true" },
  { id: "ab-tandem-health",    name: "Tandem Health (Ashby)",          source_type: "ashby", company_handle: "tandem-health",    base_url: "https://api.ashbyhq.com/posting-api/job-board/tandem-health?includeCompensation=true" },
  { id: "ab-taaraconnect",     name: "Taara (Ashby)",                  source_type: "ashby", company_handle: "taaraconnect",     base_url: "https://api.ashbyhq.com/posting-api/job-board/taaraconnect?includeCompensation=true" },
  { id: "ab-versemedical",     name: "Verse Medical (Ashby)",          source_type: "ashby", company_handle: "versemedical",     base_url: "https://api.ashbyhq.com/posting-api/job-board/versemedical?includeCompensation=true" },
  { id: "ab-webai",            name: "webAI (Ashby)",                  source_type: "ashby", company_handle: "webai",            base_url: "https://api.ashbyhq.com/posting-api/job-board/webai?includeCompensation=true" },
  { id: "ab-candidhealth",     name: "Candid Health (Ashby)",          source_type: "ashby", company_handle: "candidhealth",     base_url: "https://api.ashbyhq.com/posting-api/job-board/candidhealth?includeCompensation=true" },
  { id: "ab-phia",             name: "Phia (Ashby)",                   source_type: "ashby", company_handle: "phia",             base_url: "https://api.ashbyhq.com/posting-api/job-board/phia?includeCompensation=true" },
  { id: "ab-bedrock-robotics", name: "Bedrock Robotics (Ashby)",       source_type: "ashby", company_handle: "bedrock-robotics", base_url: "https://api.ashbyhq.com/posting-api/job-board/bedrock-robotics?includeCompensation=true" },
  { id: "ab-rogo",             name: "Rogo (Ashby)",                   source_type: "ashby", company_handle: "rogo",             base_url: "https://api.ashbyhq.com/posting-api/job-board/rogo?includeCompensation=true" },
  { id: "ab-basiccapital",     name: "Basic Capital (Ashby)",          source_type: "ashby", company_handle: "basiccapital",     base_url: "https://api.ashbyhq.com/posting-api/job-board/basiccapital?includeCompensation=true" },
  { id: "ab-norm-ai",          name: "Norm AI (Ashby)",                source_type: "ashby", company_handle: "norm-ai",          base_url: "https://api.ashbyhq.com/posting-api/job-board/norm-ai?includeCompensation=true" },
  { id: "ab-krea",             name: "Krea (Ashby)",                   source_type: "ashby", company_handle: "krea",             base_url: "https://api.ashbyhq.com/posting-api/job-board/krea?includeCompensation=true" },
  { id: "ab-strella",          name: "Strella (Ashby)",                source_type: "ashby", company_handle: "strella",          base_url: "https://api.ashbyhq.com/posting-api/job-board/strella?includeCompensation=true" },
  { id: "ab-miter",            name: "Miter (Ashby)",                  source_type: "ashby", company_handle: "miter",            base_url: "https://api.ashbyhq.com/posting-api/job-board/miter?includeCompensation=true" },
  { id: "ab-toma",             name: "Toma (Ashby)",                   source_type: "ashby", company_handle: "toma",             base_url: "https://api.ashbyhq.com/posting-api/job-board/toma?includeCompensation=true" },
  { id: "ab-delve",            name: "Delve (Ashby)",                  source_type: "ashby", company_handle: "delve",            base_url: "https://api.ashbyhq.com/posting-api/job-board/delve?includeCompensation=true" },
  { id: "ab-vibe",             name: "Vibe (Ashby)",                   source_type: "ashby", company_handle: "vibe",             base_url: "https://api.ashbyhq.com/posting-api/job-board/vibe?includeCompensation=true" },
  { id: "ab-mirelo",           name: "Mirelo (Ashby)",                 source_type: "ashby", company_handle: "mirelo",           base_url: "https://api.ashbyhq.com/posting-api/job-board/mirelo?includeCompensation=true" },
  { id: "ab-anything",         name: "Anything (Ashby)",               source_type: "ashby", company_handle: "anything",         base_url: "https://api.ashbyhq.com/posting-api/job-board/anything?includeCompensation=true" },
  { id: "ab-commonroom",       name: "Common Room (Ashby)",            source_type: "ashby", company_handle: "commonroom",       base_url: "https://api.ashbyhq.com/posting-api/job-board/commonroom?includeCompensation=true" },
  { id: "ab-counsel",          name: "Counsel Health (Ashby)",         source_type: "ashby", company_handle: "counsel",          base_url: "https://api.ashbyhq.com/posting-api/job-board/counsel?includeCompensation=true" },
  { id: "ab-triggerdev",       name: "Trigger.dev (Ashby)",            source_type: "ashby", company_handle: "triggerdev",       base_url: "https://api.ashbyhq.com/posting-api/job-board/triggerdev?includeCompensation=true" },
  { id: "ab-writer",           name: "Writer (Ashby)",                 source_type: "ashby", company_handle: "writer",           base_url: "https://api.ashbyhq.com/posting-api/job-board/writer?includeCompensation=true" },
  // wordly.ai careers embed — board slug is "Wordly.ai Careers" (not "wordly")
  { id: "ab-wordly",           name: "Wordly (Ashby)",                 source_type: "ashby", company_handle: "Wordly.ai Careers", base_url: "https://api.ashbyhq.com/posting-api/job-board/Wordly.ai%20Careers?includeCompensation=true" },
  { id: "ab-wordware",         name: "Wordware (Ashby)",               source_type: "ashby", company_handle: "wordware.ai",      base_url: "https://api.ashbyhq.com/posting-api/job-board/wordware.ai?includeCompensation=true" },
  { id: "ab-backflip",         name: "Backflip AI (Ashby)",            source_type: "ashby", company_handle: "backflip",         base_url: "https://api.ashbyhq.com/posting-api/job-board/backflip?includeCompensation=true" },
  { id: "ab-twelve-labs",      name: "TwelveLabs (Ashby)",             source_type: "ashby", company_handle: "twelve-labs",      base_url: "https://api.ashbyhq.com/posting-api/job-board/twelve-labs?includeCompensation=true" },
  { id: "ab-opal",             name: "Opal Security (Ashby)",          source_type: "ashby", company_handle: "opal",             base_url: "https://api.ashbyhq.com/posting-api/job-board/opal?includeCompensation=true" },
  { id: "ab-savvy",            name: "Savvy Wealth (Ashby)",           source_type: "ashby", company_handle: "savvy",            base_url: "https://api.ashbyhq.com/posting-api/job-board/savvy?includeCompensation=true" },
  { id: "ab-reka",             name: "Reka AI (Ashby)",                source_type: "ashby", company_handle: "reka",             base_url: "https://api.ashbyhq.com/posting-api/job-board/reka?includeCompensation=true" },
  { id: "ab-assembled", name: "Assembled (Ashby)", source_type: "ashby", company_handle: "assembledhq", base_url: "https://api.ashbyhq.com/posting-api/job-board/assembledhq?includeCompensation=true" }, // handle: assembledhq
  { id: "ab-convex",    name: "Convex (Ashby)",    source_type: "ashby", company_handle: "convex-dev",  base_url: "https://api.ashbyhq.com/posting-api/job-board/convex-dev?includeCompensation=true" },  // handle: convex-dev
  { id: "ab-rothys",      name: "Rothy's",          source_type: "ashby", company_handle: "rothys",           base_url: "https://api.ashbyhq.com/posting-api/job-board/rothys" },
  { id: "ab-anyscale",    name: "Anyscale (Ashby)", source_type: "ashby", company_handle: "anyscale",         base_url: "https://api.ashbyhq.com/posting-api/job-board/anyscale?includeCompensation=true" },
  { id: "ab-airops",      name: "AirOps (Ashby)",   source_type: "ashby", company_handle: "airops",           base_url: "https://api.ashbyhq.com/posting-api/job-board/airops?includeCompensation=true" },
  { id: "ab-airapps",     name: "AirApps (Ashby)",  source_type: "ashby", company_handle: "airapps",          base_url: "https://api.ashbyhq.com/posting-api/job-board/airapps?includeCompensation=true" },
  { id: "ab-cohere",      name: "Cohere (Ashby)",   source_type: "ashby", company_handle: "cohere",           base_url: "https://api.ashbyhq.com/posting-api/job-board/cohere?includeCompensation=true" },
  { id: "ab-hadrian-automation", name: "Hadrian Automation (Ashby)", source_type: "ashby", company_handle: "hadrian-automation", base_url: "https://api.ashbyhq.com/posting-api/job-board/hadrian-automation?includeCompensation=true" },
  { id: "ab-haus",             name: "Haus Analytics (Ashby)",         source_type: "ashby", company_handle: "haus",             base_url: "https://api.ashbyhq.com/posting-api/job-board/haus?includeCompensation=true" },
  { id: "ab-lorikeet",    name: "Lorikeet (Ashby)", source_type: "ashby", company_handle: "lorikeet",         base_url: "https://api.ashbyhq.com/posting-api/job-board/lorikeet?includeCompensation=true" },
  { id: "ab-conduit-health", name: "Conduit Health (Ashby)", source_type: "ashby", company_handle: "conduit-health", base_url: "https://api.ashbyhq.com/posting-api/job-board/conduit-health?includeCompensation=true" },
  { id: "ab-furtherai",   name: "FurtherAI (Ashby)", source_type: "ashby", company_handle: "furtherai",    base_url: "https://api.ashbyhq.com/posting-api/job-board/furtherai?includeCompensation=true" },
  { id: "ab-joinarc",     name: "Arc (Ashby)",      source_type: "ashby", company_handle: "joinarc",        base_url: "https://api.ashbyhq.com/posting-api/job-board/joinarc?includeCompensation=true" },
  { id: "ab-primer-io",   name: "Primer.io (Ashby)", source_type: "ashby", company_handle: "primer.io",     base_url: "https://api.ashbyhq.com/posting-api/job-board/primer.io?includeCompensation=true" },
  { id: "ab-ravio",       name: "Ravio (Ashby)",    source_type: "ashby", company_handle: "ravio",          base_url: "https://api.ashbyhq.com/posting-api/job-board/ravio?includeCompensation=true" },
  { id: "ab-synthflow",   name: "Synthflow AI (Ashby)", source_type: "ashby", company_handle: "synthflow",  base_url: "https://api.ashbyhq.com/posting-api/job-board/synthflow?includeCompensation=true" },
  { id: "ab-truemed",     name: "Truemed (Ashby)",  source_type: "ashby", company_handle: "truemed",        base_url: "https://api.ashbyhq.com/posting-api/job-board/truemed?includeCompensation=true" },
  { id: "ab-ben",         name: "Ben (Ashby)",      source_type: "ashby", company_handle: "ben",          base_url: "https://api.ashbyhq.com/posting-api/job-board/ben?includeCompensation=true" },
  { id: "ab-claylabs",    name: "Clay (Ashby)",     source_type: "ashby", company_handle: "claylabs",     base_url: "https://api.ashbyhq.com/posting-api/job-board/claylabs?includeCompensation=true" },
  { id: "ab-firsthand",   name: "Firsthand (Ashby)", source_type: "ashby", company_handle: "firsthand",   base_url: "https://api.ashbyhq.com/posting-api/job-board/firsthand?includeCompensation=true" },
  { id: "ab-puzzle-io",   name: "Puzzle.io (Ashby)", source_type: "ashby", company_handle: "puzzle.io",   base_url: "https://api.ashbyhq.com/posting-api/job-board/puzzle.io?includeCompensation=true" },
  { id: "ab-squint-ai",   name: "Squint (Ashby)",   source_type: "ashby", company_handle: "squint.ai",    base_url: "https://api.ashbyhq.com/posting-api/job-board/squint.ai?includeCompensation=true" },
  { id: "ab-spellbook-legal", name: "Spellbook (Ashby)", source_type: "ashby", company_handle: "spellbook.legal", base_url: "https://api.ashbyhq.com/posting-api/job-board/spellbook.legal?includeCompensation=true" },
  { id: "ab-atticus",    name: "Atticus (Ashby)",    source_type: "ashby", company_handle: "atticus",    base_url: "https://api.ashbyhq.com/posting-api/job-board/atticus?includeCompensation=true" },
  { id: "ab-avida",       name: "AVIDA (Ashby)",      source_type: "ashby", company_handle: "avida",      base_url: "https://api.ashbyhq.com/posting-api/job-board/avida?includeCompensation=true" },
  // Public Ashby board — may be empty between hiring waves (still the canonical listing endpoint).
  { id: "ab-crunchbase",  name: "Crunchbase (Ashby)", source_type: "ashby", company_handle: "crunchbase", base_url: "https://api.ashbyhq.com/posting-api/job-board/crunchbase?includeCompensation=true" },

  // ─── Lever ────────────────────────────────────────────────────────────
  // Public posting API: https://api.lever.co/v0/postings/{handle}
  { id: "lv-rover",        name: "Rover (Lever)",        source_type: "lever", company_handle: "rover",        base_url: "https://api.lever.co/v0/postings/rover" },
  { id: "lv-plaid",        name: "Plaid (Lever)",        source_type: "lever", company_handle: "plaid",        base_url: "https://api.lever.co/v0/postings/plaid" },
  { id: "lv-mistral",          name: "Mistral (Lever)",                source_type: "lever", company_handle: "mistral",                base_url: "https://api.lever.co/v0/postings/mistral" },
  { id: "lv-enveda",           name: "Enveda (Lever)",                 source_type: "lever", company_handle: "enveda",                 base_url: "https://api.lever.co/v0/postings/enveda" },
  { id: "lv-eve",              name: "Eve (Lever)",                    source_type: "lever", company_handle: "Eve",                    base_url: "https://api.lever.co/v0/postings/Eve" },
  { id: "lv-cloaked-app",      name: "Cloaked (Lever)",                source_type: "lever", company_handle: "cloaked-app",            base_url: "https://api.lever.co/v0/postings/cloaked-app" },
  { id: "lv-suger",            name: "Suger (Lever)",                  source_type: "lever", company_handle: "suger",                  base_url: "https://api.lever.co/v0/postings/suger" },
  { id: "lv-tryjeeves",        name: "Jeeves (Lever)",                source_type: "lever", company_handle: "tryjeeves",              base_url: "https://api.lever.co/v0/postings/tryjeeves" },
  { id: "lv-truv",             name: "Truv (Lever)",                   source_type: "lever", company_handle: "truv",                   base_url: "https://api.lever.co/v0/postings/truv" },
  { id: "lv-moonpay",          name: "MoonPay (Lever)",                source_type: "lever", company_handle: "moonpay",                base_url: "https://api.lever.co/v0/postings/moonpay" },
  { id: "lv-onit",             name: "Onit (Lever)",                   source_type: "lever", company_handle: "onit",                   base_url: "https://api.lever.co/v0/postings/onit" },
  { id: "lv-spotify",          name: "Spotify (Lever)",                source_type: "lever", company_handle: "spotify",                base_url: "https://api.lever.co/v0/postings/spotify" },
  { id: "lv-encord",       name: "Encord (Lever)",       source_type: "lever", company_handle: "CordTechnologies",        base_url: "https://api.lever.co/v0/postings/CordTechnologies" },        // legal entity name
  { id: "lv-unstructured", name: "Unstructured (Lever)", source_type: "lever", company_handle: "unstructuredtechnologies", base_url: "https://api.lever.co/v0/postings/unstructuredtechnologies" }, // handle: unstructuredtechnologies
  { id: "lv-hottopic",    name: "Hot Topic",        source_type: "lever", company_handle: "hottopic",         base_url: "https://api.lever.co/v0/postings/hottopic" },
  { id: "lv-metlife",     name: "MetLife",          source_type: "lever", company_handle: "metlife",          base_url: "https://api.lever.co/v0/postings/metlife" },
  { id: "lv-princesspolly", name: "Princess Polly", source_type: "lever", company_handle: "princesspolly",   base_url: "https://api.lever.co/v0/postings/princesspolly" },

  // ─── Workable ─────────────────────────────────────────────────────────
  // Public widget API: https://apply.workable.com/api/v1/widget/accounts/{handle}
  { id: "wb-pitch",        name: "Pitch (Workable)",          source_type: "workable",  company_handle: "pitch-software", base_url: "https://apply.workable.com/api/v1/widget/accounts/pitch-software" },
  { id: "wb-shopify",     name: "Shopify",                  source_type: "workable", company_handle: "shopify",     base_url: "https://apply.workable.com/api/v1/widget/accounts/shopify" },
  { id: "wb-vimeo",       name: "Vimeo",                    source_type: "workable", company_handle: "vimeo",       base_url: "https://apply.workable.com/api/v1/widget/accounts/vimeo" },
  { id: "wb-untuckit",    name: "UNTUCKit",         source_type: "workable", company_handle: "untuckit",      base_url: "https://apply.workable.com/api/v1/widget/accounts/untuckit" },
  { id: "wb-chipotle",    name: "Chipotle",                  source_type: "workable", company_handle: "chipotle",       base_url: "https://apply.workable.com/api/v1/widget/accounts/chipotle" },
  { id: "wb-kindercare",  name: "KinderCare",                source_type: "workable", company_handle: "kindercare",      base_url: "https://apply.workable.com/api/v1/widget/accounts/kindercare" },
  { id: "wb-insperity",   name: "Insperity",                 source_type: "workable", company_handle: "insperity",       base_url: "https://apply.workable.com/api/v1/widget/accounts/insperity" },
  { id: "wb-huggingface", name: "Hugging Face (Workable)",   source_type: "workable", company_handle: "huggingface",     base_url: "https://apply.workable.com/api/v1/widget/accounts/huggingface" },
  { id: "wb-curology",    name: "Curology (Workable)",       source_type: "workable", company_handle: "curology",        base_url: "https://apply.workable.com/api/v1/widget/accounts/curology" },

  // ─── Jobright (native) ────────────────────────────────────────────────
  // Next.js data route per job id; buildId scraped from homepage. Append ids to
  // jr_ingest_ids when new roles go live. apply_url = public /jobs/info/{id} page.
  { id: "jr-jobright-ai", name: "Jobright.ai (Jobright)", source_type: "jobright", company_handle: "jobright", base_url: "https://jobright.ai/?jr_ingest_ids=b2b_1770933708185_265,b2b_1770934904391_331,b2b_1770935515039_172,b2b_1770936109040_2,b2b_1770936743518_149,external_1749849277195_529,698ff2610cc8ea15f1da8a40" },

  // ─── Framer (search index JSON) ───────────────────────────────────────
  // Public searchIndex URL from page <meta name="framer-search-index"> + site_origin for job links.
  { id: "framer-nace", name: "Nace.AI (Framer)", source_type: "framer", company_handle: "nace", base_url: "https://framerusercontent.com/sites/5su6r99XrpKioK6gULASMV/searchIndex-FTk17CTt6776.json?site_origin=https%3A%2F%2Fnace.ai" },

  // ─── EasyApply (HTML + JSON-LD) ─────────────────────────────────────────
  { id: "ea-snaplii", name: "Snaplii (EasyApply)", source_type: "easyapply", company_handle: "snaplii", base_url: "https://snaplii.easyapply.co/" },

  // ─── Rippling (Next.js __NEXT_DATA__) ─────────────────────────────────
  // Board root: listing + pagination; per-job page has full description HTML.
  { id: "rp-patientnow", name: "PatientNow (Rippling)", source_type: "rippling", company_handle: "patientnow", base_url: "https://ats.rippling.com/patientnow/jobs" },
  { id: "rp-vouch-inc", name: "Vouch (Rippling)", source_type: "rippling", company_handle: "vouch-inc", base_url: "https://ats.rippling.com/vouch-inc/jobs" },
  { id: "rp-partnerco", name: "PartnerCo (Rippling)", source_type: "rippling", company_handle: "partnerco", base_url: "https://ats.rippling.com/partnerco/jobs" },

  // ─── Brillio (WordPress listing HTML — see brillio.ts) ───────────────────
  { id: "br-brillio", name: "Brillio (Careers)", source_type: "brillio", company_handle: "brillio", base_url: "https://careers.brillio.com/job-listing/" },

  // ─── Phenom (sitemap + phApp.ddo job payload) ───────────────────────────
  // Locale root; single-job URLs are normalized. Same employer may also use Workday (`wd-usbank`).
  {
    id: "ph-usbank",
    name: "U.S. Bank (Phenom)",
    source_type: "phenom",
    company_handle: "usbank_phenom",
    base_url: "https://careers.usbank.com/global/en/job/UBNAGLOBAL20260004582EXTERNALENGLOBAL/Digital-Product-Manager",
  },
  {
    id: "ph-intuitive",
    name: "Intuitive (Phenom)",
    source_type: "phenom",
    company_handle: "intuitive",
    base_url: "https://careers.intuitive.com/en/jobs/744000112787247/JOB212842/product-manager-portfolio-operations-da-vinci-sp/",
  },

  // ─── Jobvite (static listing HTML + per-job description) ─────────────────
  // Board root: `jobs.jobvite.com/{slug}/jobs`. Single-job URLs are normalized.
  { id: "jv-legalzoom", name: "LegalZoom (Jobvite)", source_type: "jobvite", company_handle: "legalzoom", base_url: "https://jobs.jobvite.com/legalzoom/jobs" },
  { id: "jv-ninjaone", name: "NinjaOne (Jobvite)", source_type: "jobvite", company_handle: "ninjaone", base_url: "https://jobs.jobvite.com/ninjaone/jobs" },

  // ─── CATS One (HTML + JobPosting JSON-LD) ─────────────────────────────
  // Department listing; per-job pages embed schema.org JobPosting.
  { id: "cats-sphereinc", name: "Sphere Partners (CATS)", source_type: "catsone", company_handle: "sphereinc", base_url: "https://sphereinc.catsone.com/careers/90438-General" },

  // ─── Personio ─────────────────────────────────────────────────────────
  // Public XML feed: https://{handle}.jobs.personio.com/api/xml/?language=en
  { id: "ps-personio",     name: "Personio (Personio)",       source_type: "personio",  company_handle: "personio",      base_url: "https://personio.jobs.personio.de/xml" },
  { id: "ps-n26",          name: "N26 (Personio)",            source_type: "personio",  company_handle: "n26",           base_url: "https://n26.jobs.personio.de/xml" },
  { id: "ps-egym",         name: "EGYM (Personio)",           source_type: "personio",  company_handle: "egym",          base_url: "https://egym.jobs.personio.de/xml" },
  { id: "ps-flatpay",      name: "Flatpay (Personio)",        source_type: "personio",  company_handle: "flatpay",       base_url: "https://flatpay.jobs.personio.de/xml" },
  { id: "ps-1komma5",      name: "1Komma5° (Personio)",       source_type: "personio",  company_handle: "1komma5grad",   base_url: "https://1komma5grad.jobs.personio.de/xml" },

  // ─── Pinpoint ─────────────────────────────────────────────────────────
  // Public jobs API: https://{handle}.pinpointhq.com/api/v1/jobs
  { id: "pp-sunking",      name: "Sun King (Pinpoint)",       source_type: "pinpoint",  company_handle: "sunking",       base_url: "https://sunking.pinpointhq.com/postings.json" },
  { id: "pp-dazn",         name: "DAZN (Pinpoint)",           source_type: "pinpoint",  company_handle: "dazn",          base_url: "https://dazn.pinpointhq.com/postings.json" },
  { id: "pp-tabby",        name: "Tabby (Pinpoint)",          source_type: "pinpoint",  company_handle: "tabby",         base_url: "https://tabby.pinpointhq.com/postings.json" },
  { id: "pp-kempinski",    name: "Kempinski Hotels (Pinpoint)", source_type: "pinpoint", company_handle: "kempinski",    base_url: "https://kempinski.pinpointhq.com/postings.json" },

  // ─── SmartRecruiters ──────────────────────────────────────────────────
  // Public postings API: https://api.smartrecruiters.com/v1/companies/{handle}/postings
  { id: "sr-dominos",   name: "Domino's Pizza",     source_type: "smartrecruiters", company_handle: "dominos",            base_url: "https://api.smartrecruiters.com/v1/companies/dominos/postings" },
  { id: "sr-securitas", name: "Securitas",           source_type: "smartrecruiters", company_handle: "securitas",          base_url: "https://api.smartrecruiters.com/v1/companies/securitas/postings" },
  { id: "sr-sodexo",    name: "Sodexo",              source_type: "smartrecruiters", company_handle: "sodexo",             base_url: "https://api.smartrecruiters.com/v1/companies/sodexo/postings" },
  { id: "sr-mcdonalds", name: "McDonald's",          source_type: "smartrecruiters", company_handle: "McDonaldsCorporation", base_url: "https://api.smartrecruiters.com/v1/companies/McDonaldsCorporation/postings" },
  { id: "sr-visa",      name: "Visa",                source_type: "smartrecruiters", company_handle: "Visa",               base_url: "https://api.smartrecruiters.com/v1/companies/Visa/postings" },
  { id: "sr-hm",        name: "H&M Group",           source_type: "smartrecruiters", company_handle: "HMGroup",            base_url: "https://api.smartrecruiters.com/v1/companies/HMGroup/postings" },
  { id: "sr-bosch",     name: "Bosch",               source_type: "smartrecruiters", company_handle: "BoschGroup",         base_url: "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings" },
  { id: "sr-asos",         name: "ASOS",                 source_type: "smartrecruiters", company_handle: "ASOS",           base_url: "https://api.smartrecruiters.com/v1/companies/ASOS/postings" },
  { id: "sr-primark",      name: "Primark",              source_type: "smartrecruiters", company_handle: "Primark",        base_url: "https://api.smartrecruiters.com/v1/companies/Primark/postings" },
  { id: "sr-lvmh",         name: "LVMH",                 source_type: "smartrecruiters", company_handle: "LVMH",           base_url: "https://api.smartrecruiters.com/v1/companies/LVMH/postings" },
  { id: "sr-cottonon",         name: "Cotton On",         source_type: "smartrecruiters", company_handle: "CottonOn",       base_url: "https://api.smartrecruiters.com/v1/companies/CottonOn/postings" },
  { id: "sr-abbvie",           name: "AbbVie",                 source_type: "smartrecruiters", company_handle: "AbbVie",                 base_url: "https://api.smartrecruiters.com/v1/companies/AbbVie/postings" },
  { id: "sr-cencora",          name: "Cencora",                source_type: "smartrecruiters", company_handle: "Cencora",                base_url: "https://api.smartrecruiters.com/v1/companies/Cencora/postings" },
  { id: "sr-ttec",             name: "TTEC",                   source_type: "smartrecruiters", company_handle: "TTEC",                   base_url: "https://api.smartrecruiters.com/v1/companies/TTEC/postings" },
  { id: "sr-omnicom",          name: "Omnicom Group",          source_type: "smartrecruiters", company_handle: "OmnicomGroup",           base_url: "https://api.smartrecruiters.com/v1/companies/OmnicomGroup/postings" },
  { id: "sr-norwegiancruise",  name: "Norwegian Cruise Line",  source_type: "smartrecruiters", company_handle: "NorwegianCruiseLine",    base_url: "https://api.smartrecruiters.com/v1/companies/NorwegianCruiseLine/postings" },
  { id: "sr-nbcuniversal",     name: "NBCUniversal",           source_type: "smartrecruiters", company_handle: "NBCUniversal3",          base_url: "https://api.smartrecruiters.com/v1/companies/NBCUniversal3/postings" },

  // ─── Workday ──────────────────────────────────────────────────────────
  // CXS POST API: https://{sub}.wd{n}.myworkdayjobs.com/wday/cxs/{sub}/{site}/jobs
  { id: "wd-kohls",   name: "Kohl's",   source_type: "workday", company_handle: "kohls",   base_url: "https://kohls.wd1.myworkdayjobs.com/wday/cxs/kohls/kohlscareers/jobs" },
  { id: "wd-comcast", name: "Comcast",  source_type: "workday", company_handle: "comcast", base_url: "https://comcast.wd5.myworkdayjobs.com/wday/cxs/comcast/Comcast_Careers/jobs" },
  { id: "wd-condenast", name: "Condé Nast", source_type: "workday", company_handle: "condenast", base_url: "https://condenast.wd5.myworkdayjobs.com/wday/cxs/condenast/CondeCareers/jobs" },
  { id: "wd-target",    name: "Target",     source_type: "workday", company_handle: "target",    base_url: "https://target.wd5.myworkdayjobs.com/wday/cxs/target/targetcareers/jobs" },
  { id: "wd-homedepot", name: "Home Depot", source_type: "workday", company_handle: "homedepot", base_url: "https://homedepot.wd5.myworkdayjobs.com/wday/cxs/homedepot/CareerDepot/jobs" },
  { id: "wd-cvs",       name: "CVS Health", source_type: "workday", company_handle: "cvshealth", base_url: "https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/jobs" },
  { id: "wd-crowdstrike", name: "CrowdStrike", source_type: "workday", company_handle: "crowdstrike", base_url: "https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers/jobs" },
  { id: "wd-walmart",   name: "Walmart",    source_type: "workday", company_handle: "walmart",   base_url: "https://walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternal/jobs" },
  { id: "wd-workday",   name: "Workday",    source_type: "workday", company_handle: "workday",   base_url: "https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday/jobs" },
  { id: "wd-nvidia",    name: "NVIDIA",     source_type: "workday", company_handle: "nvidia",    base_url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs" },
  { id: "wd-boeing",      name: "Boeing",           source_type: "workday", company_handle: "boeing",         base_url: "https://boeing.wd1.myworkdayjobs.com/wday/cxs/boeing/external_subsidiary/jobs" },
  { id: "wd-northrop",    name: "Northrop Grumman", source_type: "workday", company_handle: "ngc",            base_url: "https://ngc.wd1.myworkdayjobs.com/wday/cxs/ngc/Northrop_Grumman_External_Site/jobs" },
  { id: "wd-rtx",         name: "RTX (Raytheon)",   source_type: "workday", company_handle: "globalhr",       base_url: "https://globalhr.wd5.myworkdayjobs.com/wday/cxs/globalhr/REC_RTX_Ext_Gateway/jobs" },
  { id: "wd-leidos",      name: "Leidos",           source_type: "workday", company_handle: "leidos",         base_url: "https://leidos.wd5.myworkdayjobs.com/wday/cxs/leidos/External/jobs" },
  { id: "wd-gm",          name: "General Motors",   source_type: "workday", company_handle: "generalmotors",  base_url: "https://generalmotors.wd5.myworkdayjobs.com/wday/cxs/generalmotors/Careers_GM/jobs" },
  { id: "wd-caterpillar", name: "Caterpillar",      source_type: "workday", company_handle: "cat",            base_url: "https://cat.wd5.myworkdayjobs.com/wday/cxs/cat/CaterpillarCareers/jobs" },
  { id: "wd-pfizer",      name: "Pfizer",           source_type: "workday", company_handle: "pfizer",         base_url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs" },
  { id: "wd-jnj",         name: "Johnson & Johnson",source_type: "workday", company_handle: "jj",             base_url: "https://jj.wd5.myworkdayjobs.com/wday/cxs/jj/JJ/jobs" },
  { id: "wd-abbott",      name: "Abbott",           source_type: "workday", company_handle: "abbott",         base_url: "https://abbott.wd5.myworkdayjobs.com/wday/cxs/abbott/abbottcareers/jobs" },
  { id: "wd-lilly",       name: "Eli Lilly",        source_type: "workday", company_handle: "lilly",          base_url: "https://lilly.wd5.myworkdayjobs.com/wday/cxs/lilly/LLY/jobs" },
  { id: "wd-lplfinancial", name: "LPL Financial",   source_type: "workday", company_handle: "lplfinancial",   base_url: "https://lplfinancial.wd1.myworkdayjobs.com/wday/cxs/lplfinancial/university/jobs" },
  { id: "wd-stryker",     name: "Stryker",          source_type: "workday", company_handle: "stryker",        base_url: "https://stryker.wd1.myworkdayjobs.com/wday/cxs/stryker/StrykerCareers/jobs" },
  { id: "wd-labcorp",     name: "LabCorp",          source_type: "workday", company_handle: "labcorp",        base_url: "https://labcorp.wd1.myworkdayjobs.com/wday/cxs/labcorp/External/jobs" },
  { id: "wd-elevance",    name: "Elevance Health",  source_type: "workday", company_handle: "elevancehealth", base_url: "https://elevancehealth.wd1.myworkdayjobs.com/wday/cxs/elevancehealth/ANT/jobs" },
  { id: "wd-humana",      name: "Humana",           source_type: "workday", company_handle: "humana",         base_url: "https://humana.wd5.myworkdayjobs.com/wday/cxs/humana/Humana_External_Career_Site/jobs" },
  { id: "wd-centene",     name: "Centene",          source_type: "workday", company_handle: "centene",        base_url: "https://centene.wd5.myworkdayjobs.com/wday/cxs/centene/Centene_External/jobs" },
  { id: "wd-cisco",       name: "Cisco",            source_type: "workday", company_handle: "cisco",          base_url: "https://cisco.wd5.myworkdayjobs.com/wday/cxs/cisco/Cisco_Careers/jobs" },
  { id: "wd-intel",       name: "Intel",            source_type: "workday", company_handle: "intel",          base_url: "https://intel.wd1.myworkdayjobs.com/wday/cxs/intel/External/jobs" },
  { id: "wd-micron",      name: "Micron Technology",source_type: "workday", company_handle: "micron",         base_url: "https://micron.wd1.myworkdayjobs.com/wday/cxs/micron/External/jobs" },
  { id: "wd-dell",        name: "Dell Technologies",source_type: "workday", company_handle: "dell",           base_url: "https://dell.wd1.myworkdayjobs.com/wday/cxs/dell/External/jobs" },
  { id: "wd-salesforce",  name: "Salesforce",       source_type: "workday", company_handle: "salesforce",     base_url: "https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs" },
  { id: "wd-dxc",         name: "DXC Technology",   source_type: "workday", company_handle: "dxctechnology",  base_url: "https://dxctechnology.wd1.myworkdayjobs.com/wday/cxs/dxctechnology/DXCJobs/jobs" },
  { id: "wd-att",         name: "AT&T",             source_type: "workday", company_handle: "att",            base_url: "https://att.wd1.myworkdayjobs.com/wday/cxs/att/attgeneral/jobs" },
  { id: "wd-wellsfargo",  name: "Wells Fargo",      source_type: "workday", company_handle: "wf",             base_url: "https://wf.wd1.myworkdayjobs.com/wday/cxs/wf/WellsFargoJobs/jobs" },
  { id: "wd-citi",        name: "Citigroup",        source_type: "workday", company_handle: "citi",           base_url: "https://citi.wd5.myworkdayjobs.com/wday/cxs/citi/2/jobs" },
  { id: "wd-cocacola",    name: "Coca-Cola",        source_type: "workday", company_handle: "coke",           base_url: "https://coke.wd1.myworkdayjobs.com/wday/cxs/coke/coca-cola-careers/jobs" },
  { id: "wd-pg",          name: "Procter & Gamble", source_type: "workday", company_handle: "pg",             base_url: "https://pg.wd5.myworkdayjobs.com/wday/cxs/pg/1000/jobs" },
  { id: "wd-mondelez",    name: "Mondelez",         source_type: "workday", company_handle: "mdlz",           base_url: "https://mdlz.wd3.myworkdayjobs.com/wday/cxs/mdlz/external/jobs" },
  { id: "wd-motorolasolutions", name: "Motorola Solutions", source_type: "workday", company_handle: "motorolasolutions", base_url: "https://motorolasolutions.wd5.myworkdayjobs.com/wday/cxs/motorolasolutions/Careers/jobs" },
  { id: "wd-tyson",       name: "Tyson Foods",      source_type: "workday", company_handle: "tysonfoods",     base_url: "https://tysonfoods.wd5.myworkdayjobs.com/wday/cxs/tysonfoods/TSN/jobs" },
  { id: "wd-nike",        name: "Nike",             source_type: "workday", company_handle: "nike",           base_url: "https://nike.wd1.myworkdayjobs.com/wday/cxs/nike/nke/jobs" },
  { id: "wd-gap",         name: "Gap Inc",          source_type: "workday", company_handle: "gapinc",         base_url: "https://gapinc.wd1.myworkdayjobs.com/wday/cxs/gapinc/GAPINC/jobs" },
  { id: "wd-tjx",         name: "TJX Companies",    source_type: "workday", company_handle: "tjx",            base_url: "https://tjx.wd1.myworkdayjobs.com/wday/cxs/tjx/TJX_EXTERNAL/jobs" },
  { id: "wd-vfc",         name: "VF Corp (TNF/Vans/Timberland)", source_type: "workday", company_handle: "vfc", base_url: "https://vfc.wd5.myworkdayjobs.com/wday/cxs/vfc/vfc_careers/jobs" },
  { id: "wd-southwest",   name: "Southwest Airlines",source_type: "workday", company_handle: "swa",           base_url: "https://swa.wd1.myworkdayjobs.com/wday/cxs/swa/external/jobs" },
  { id: "wd-chevron",     name: "Chevron",          source_type: "workday", company_handle: "chevron",        base_url: "https://chevron.wd5.myworkdayjobs.com/wday/cxs/chevron/jobs/jobs" },
  { id: "wd-bakerhughes", name: "Baker Hughes",     source_type: "workday", company_handle: "bakerhughes",    base_url: "https://bakerhughes.wd5.myworkdayjobs.com/wday/cxs/bakerhughes/BakerHughes/jobs" },
  { id: "wd-3m",          name: "3M",               source_type: "workday", company_handle: "3m",             base_url: "https://3m.wd1.myworkdayjobs.com/wday/cxs/3m/Search/jobs" },
  { id: "wd-allstate",    name: "Allstate",         source_type: "workday", company_handle: "allstate",       base_url: "https://allstate.wd5.myworkdayjobs.com/wday/cxs/allstate/allstate_careers/jobs" }, // careers UI https://www.allstate.jobs/job-search-results/
  { id: "wd-aig",         name: "AIG",              source_type: "workday", company_handle: "aig",            base_url: "https://aig.wd1.myworkdayjobs.com/wday/cxs/aig/aig/jobs" },
  { id: "wd-pnc",         name: "PNC Bank",         source_type: "workday", company_handle: "pnc",            base_url: "https://pnc.wd5.myworkdayjobs.com/wday/cxs/pnc/External/jobs" },
  { id: "wd-usbank",      name: "US Bancorp",       source_type: "workday", company_handle: "usbank",         base_url: "https://usbank.wd1.myworkdayjobs.com/wday/cxs/usbank/US_Bank_Careers/jobs" },
  { id: "wd-fis",         name: "FIS Global",       source_type: "workday", company_handle: "fis",            base_url: "https://fis.wd5.myworkdayjobs.com/wday/cxs/fis/SearchJobs/jobs" },
  { id: "wd-fmr",         name: "Fidelity Investments", source_type: "workday", company_handle: "fmr",          base_url: "https://fmr.wd1.myworkdayjobs.com/wday/cxs/fmr/targeted/jobs" },
  { id: "wd-davita",      name: "DaVita",           source_type: "workday", company_handle: "davita",         base_url: "https://davita.wd1.myworkdayjobs.com/wday/cxs/davita/DKC_External/jobs" },
  { id: "wd-iqvia",       name: "IQVIA",            source_type: "workday", company_handle: "iqvia",          base_url: "https://iqvia.wd1.myworkdayjobs.com/wday/cxs/iqvia/IQVIA/jobs" },
  { id: "wd-jll",         name: "JLL",              source_type: "workday", company_handle: "jll",            base_url: "https://jll.wd1.myworkdayjobs.com/wday/cxs/jll/jllcareers/jobs" },
  { id: "wd-republicsvcs",name: "Republic Services",source_type: "workday", company_handle: "republic",       base_url: "https://republic.wd5.myworkdayjobs.com/wday/cxs/republic/republic/jobs" },
  { id: "wd-ecolab",      name: "Ecolab",           source_type: "workday", company_handle: "ecolab",         base_url: "https://ecolab.wd1.myworkdayjobs.com/wday/cxs/ecolab/Ecolab_External/jobs" },
  { id: "wd-expedia",     name: "Expedia Group",    source_type: "workday", company_handle: "expedia",        base_url: "https://expedia.wd108.myworkdayjobs.com/wday/cxs/expedia/search/jobs" },
  { id: "wd-goodyear",    name: "Goodyear",         source_type: "workday", company_handle: "goodyear",       base_url: "https://goodyear.wd1.myworkdayjobs.com/wday/cxs/goodyear/GoodyearCareers/jobs" },
  { id: "wd-itw",         name: "Illinois Tool Works",source_type: "workday", company_handle: "itw",          base_url: "https://itw.wd5.myworkdayjobs.com/wday/cxs/itw/External/jobs" },
  { id: "wd-carrier",     name: "Carrier Global",   source_type: "workday", company_handle: "carrier",        base_url: "https://carrier.wd5.myworkdayjobs.com/wday/cxs/carrier/jobs/jobs" },
  { id: "wd-cigna",       name: "Cigna",            source_type: "workday", company_handle: "cigna",          base_url: "https://cigna.wd5.myworkdayjobs.com/wday/cxs/cigna/cignacareers/jobs" },
  { id: "wd-statestreet", name: "State Street",     source_type: "workday", company_handle: "statestreet",    base_url: "https://statestreet.wd1.myworkdayjobs.com/wday/cxs/statestreet/Global/jobs" },
  { id: "wd-thermofisher",name: "Thermo Fisher",    source_type: "workday", company_handle: "thermofisher",   base_url: "https://thermofisher.wd5.myworkdayjobs.com/wday/cxs/thermofisher/ThermoFisherCareers/jobs" },
  { id: "wd-danaher",     name: "Danaher",          source_type: "workday", company_handle: "danaher",        base_url: "https://danaher.wd1.myworkdayjobs.com/wday/cxs/danaher/DanaherJobs/jobs" },
  { id: "wd-sysco",       name: "Sysco",            source_type: "workday", company_handle: "sysco",          base_url: "https://sysco.wd5.myworkdayjobs.com/wday/cxs/sysco/syscocareers/jobs" },
  { id: "wd-broadcom",    name: "Broadcom",         source_type: "workday", company_handle: "broadcom",       base_url: "https://broadcom.wd1.myworkdayjobs.com/wday/cxs/broadcom/External_Career/jobs" },
  { id: "wd-amat",        name: "Applied Materials",          source_type: "workday", company_handle: "amat",            base_url: "https://amat.wd1.myworkdayjobs.com/wday/cxs/amat/External/jobs" },
  { id: "wd-regeneron",   name: "Regeneron",                  source_type: "workday", company_handle: "regeneron",       base_url: "https://regeneron.wd1.myworkdayjobs.com/wday/cxs/regeneron/Careers/jobs" },
  { id: "wd-airproducts", name: "Air Products",               source_type: "workday", company_handle: "airproducts",     base_url: "https://airproducts.wd5.myworkdayjobs.com/wday/cxs/airproducts/AP0001/jobs" },
  { id: "wd-cencora",     name: "Cencora",                    source_type: "workday", company_handle: "myhrabc",         base_url: "https://myhrabc.wd5.myworkdayjobs.com/wday/cxs/myhrabc/Global/jobs" },
  { id: "wd-geappliances",name: "GE Appliances",              source_type: "workday", company_handle: "haier",           base_url: "https://haier.wd3.myworkdayjobs.com/wday/cxs/haier/GE_Appliances/jobs" },
  { id: "wd-mgmresorts",  name: "MGM Resorts",                source_type: "workday", company_handle: "mgmresorts",      base_url: "https://mgmresorts.wd5.myworkdayjobs.com/wday/cxs/mgmresorts/MGMCareers/jobs" },
  { id: "wd-relx",        name: "RELX Group",                 source_type: "workday", company_handle: "relx",            base_url: "https://relx.wd3.myworkdayjobs.com/wday/cxs/relx/relx/jobs" },
  { id: "wd-tsys",        name: "TSYS / Global Payments",     source_type: "workday", company_handle: "tsys",            base_url: "https://tsys.wd1.myworkdayjobs.com/wday/cxs/tsys/TSYS/jobs" },
  { id: "wd-ppg",         name: "PPG Industries",             source_type: "workday", company_handle: "ppg",             base_url: "https://ppg.wd5.myworkdayjobs.com/wday/cxs/ppg/ppg_careers/jobs" },
  { id: "wd-jabil",       name: "Jabil",                      source_type: "workday", company_handle: "jabil",           base_url: "https://jabil.wd5.myworkdayjobs.com/wday/cxs/jabil/Jabil_Careers/jobs" },
  { id: "wd-ryder",       name: "Ryder System",               source_type: "workday", company_handle: "ryder",           base_url: "https://ryder.wd5.myworkdayjobs.com/wday/cxs/ryder/rydercareers/jobs" },
  { id: "wd-lkq",         name: "LKQ Corp",                   source_type: "workday", company_handle: "lkqcorp",         base_url: "https://lkqcorp.wd5.myworkdayjobs.com/wday/cxs/lkqcorp/ExternalCareerSite-LKQ/jobs" },
  { id: "wd-levis",       name: "Levi Strauss & Co",          source_type: "workday", company_handle: "levistraussandco", base_url: "https://levistraussandco.wd5.myworkdayjobs.com/wday/cxs/levistraussandco/External/jobs" },
  { id: "wd-dollartree",  name: "Dollar Tree / Family Dollar",source_type: "workday", company_handle: "dollartree",      base_url: "https://dollartree.wd5.myworkdayjobs.com/wday/cxs/dollartree/dollartreeus/jobs" },
  { id: "wd-hpe",         name: "HPE",                        source_type: "workday", company_handle: "hpe",             base_url: "https://hpe.wd5.myworkdayjobs.com/wday/cxs/hpe/ACJobSite/jobs" },
  { id: "wd-kyndryl",     name: "Kyndryl",                    source_type: "workday", company_handle: "kyndryl",         base_url: "https://kyndryl.wd5.myworkdayjobs.com/wday/cxs/kyndryl/KyndrylProfessionalCareers/jobs" },
  { id: "wd-wbd",         name: "Warner Bros. Discovery",     source_type: "workday", company_handle: "warnerbros",      base_url: "https://warnerbros.wd5.myworkdayjobs.com/wday/cxs/warnerbros/Global/jobs" },
  { id: "wd-disney",      name: "Disney",                     source_type: "workday", company_handle: "disney",          base_url: "https://disney.wd5.myworkdayjobs.com/wday/cxs/disney/disneycareer/jobs" },
  { id: "wd-umg",         name: "Universal Music Group",      source_type: "workday", company_handle: "umusic",          base_url: "https://umusic.wd5.myworkdayjobs.com/wday/cxs/umusic/UMGUS/jobs" },
  // wd-hp confirmed working (200 from CXS API, no WAF protection)
  { id: "wd-hp",          name: "HP Inc",                     source_type: "workday", company_handle: "hp",              base_url: "https://hp.wd5.myworkdayjobs.com/wday/cxs/hp/ExternalCareerSite/jobs" },
  // TODO: find correct public Workday site names for these — their myworkdayjobs.com
  // tenants exist but return 500 at /en-US/{site} (internal-only or wrong site name).
  // Disabled in DISABLED_SOURCE_IDS below until correct site names are confirmed.
  // { id: "wd-microsoft",   name: "Microsoft",    source_type: "workday", company_handle: "microsoft",     base_url: "https://microsoft.wd1.myworkdayjobs.com/wday/cxs/microsoft/Microsoft_Careers/jobs" },
  // { id: "wd-goldmansachs",name: "Goldman Sachs",source_type: "workday", company_handle: "gs",            base_url: "https://gs.wd1.myworkdayjobs.com/wday/cxs/gs/GoldmanSachs/jobs" },
  // { id: "wd-morganstanley",name:"Morgan Stanley",source_type: "workday", company_handle: "morganstanley",base_url: "https://morganstanley.wd1.myworkdayjobs.com/wday/cxs/morganstanley/Careers/jobs" },
  // { id: "wd-delta",       name: "Delta Air Lines",source_type: "workday", company_handle: "delta",       base_url: "https://delta.wd1.myworkdayjobs.com/wday/cxs/delta/DeltaCareerSite/jobs" },
  // { id: "wd-united",      name: "United Airlines",source_type: "workday", company_handle: "united",      base_url: "https://united.wd5.myworkdayjobs.com/wday/cxs/united/United_Airlines/jobs" },
  // { id: "wd-bestbuy",     name: "Best Buy",       source_type: "workday", company_handle: "bestbuy",     base_url: "https://bestbuy.wd5.myworkdayjobs.com/wday/cxs/bestbuy/BestBuyCareers/jobs" },
  // { id: "wd-pepsico",     name: "PepsiCo",        source_type: "workday", company_handle: "pepsico",     base_url: "https://pepsico.wd5.myworkdayjobs.com/wday/cxs/pepsico/PepsiCoJobs/jobs" },
  // { id: "wd-amex",        name: "American Express",source_type: "workday", company_handle: "aexp",       base_url: "https://aexp.wd1.myworkdayjobs.com/wday/cxs/aexp/AEXP/jobs" },
  // { id: "wd-volvogroup",  name: "Volvo Group",    source_type: "workday", company_handle: "volvogroup",  base_url: "https://volvogroup.wd3.myworkdayjobs.com/wday/cxs/volvogroup/Volvo_Group_Global/jobs" },
  // { id: "wd-progressive", name: "Progressive",    source_type: "workday", company_handle: "progressive", base_url: "https://progressive.wd5.myworkdayjobs.com/wday/cxs/progressive/ProgCareers/jobs" },
  // { id: "wd-adp",         name: "ADP",            source_type: "workday", company_handle: "adp",         base_url: "https://adp.wd5.myworkdayjobs.com/wday/cxs/adp/ADPCareers/jobs" },
  // { id: "wd-qualcomm",    name: "Qualcomm",       source_type: "workday", company_handle: "qualcomm",    base_url: "https://qualcomm.wd5.myworkdayjobs.com/wday/cxs/qualcomm/External/jobs" },
  // { id: "wd-ibm",         name: "IBM",            source_type: "workday", company_handle: "ibm",         base_url: "https://ibm.wd3.myworkdayjobs.com/wday/cxs/ibm/External/jobs" },
  // { id: "wd-meta",        name: "Meta",           source_type: "workday", company_handle: "meta",        base_url: "https://meta.wd5.myworkdayjobs.com/wday/cxs/meta/Meta_Careers/jobs" },
  // { id: "wd-bofa",        name: "Bank of America",source_type: "workday", company_handle: "bankofamerica",base_url: "https://bankofamerica.wd1.myworkdayjobs.com/wday/cxs/bankofamerica/BankOfAmerica/jobs" },
  // { id: "wd-fedex",       name: "FedEx",          source_type: "workday", company_handle: "fedexcareers", base_url: "https://fedexcareers.wd1.myworkdayjobs.com/wday/cxs/fedexcareers/FedExCareers/jobs" },

  // ─── Proprietary scrapers (Amazon & Apple) ────────────────────────────
  // Custom first-party fetchers — see ingestion/sources/amazon.ts
  { id: "amz-global",      name: "Amazon",                    source_type: "amazon",    company_handle: "amazon",        base_url: "https://www.amazon.jobs/en/search.json" },
  // Apple: POST api/role/search returns 301→apple.com/pagenotfound (API deprecated/broken)
  { id: "apl-global",      name: "Apple",                     source_type: "apple",     company_handle: "apple",         base_url: "https://jobs.apple.com/api/role/search" },

  // ─── Y Combinator Job Board ───────────────────────────────────────────
  // Inertia.js protocol — see ingestion/sources/ycombinator.ts
  { id: "yc-board", name: "Y Combinator Job Board", source_type: "ycombinator", company_handle: "ycombinator", base_url: "https://www.workatastartup.com/jobs" },

  // ─── USAJOBS (federal government) ────────────────────────────────────────
  // Requires USAJOBS_API_KEY secret. Free key at developer.usajobs.gov
  { id: "usajobs", name: "USAJOBS (Federal)", source_type: "usajobs", company_handle: "usajobs", base_url: "https://data.usajobs.gov/api/Search" },

  // ─── AI lab cohort (batch ATS probe, verified public APIs, 2026-03) ───
  // Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Personio only.
  // Workday omitted (needs exact CXS URL). No browser sources for this list.
  { id: "ab-adaption", name: "Adaption (Ashby)", source_type: "ashby", company_handle: "adaption", base_url: "https://api.ashbyhq.com/posting-api/job-board/adaption?includeCompensation=true" },
  { id: "ab-applied-compute", name: "Applied Compute (Ashby)", source_type: "ashby", company_handle: "applied", base_url: "https://api.ashbyhq.com/posting-api/job-board/applied?includeCompensation=true" },
  { id: "ab-arcade-board", name: "Arcade (Ashby)", source_type: "ashby", company_handle: "arcade", base_url: "https://api.ashbyhq.com/posting-api/job-board/arcade?includeCompensation=true" },
  { id: "ab-artisan", name: "Artisan (Ashby)", source_type: "ashby", company_handle: "artisan", base_url: "https://api.ashbyhq.com/posting-api/job-board/artisan?includeCompensation=true" },
  { id: "ab-basis-research", name: "Basis Research (Ashby)", source_type: "ashby", company_handle: "basis-research", base_url: "https://api.ashbyhq.com/posting-api/job-board/basis-research?includeCompensation=true" },
  { id: "ab-bland", name: "Bland (Ashby)", source_type: "ashby", company_handle: "bland", base_url: "https://api.ashbyhq.com/posting-api/job-board/bland?includeCompensation=true" },
  { id: "ab-braintrust", name: "Braintrust (Ashby)", source_type: "ashby", company_handle: "braintrust", base_url: "https://api.ashbyhq.com/posting-api/job-board/braintrust?includeCompensation=true" },
  { id: "ab-coframe", name: "Coframe (Ashby)", source_type: "ashby", company_handle: "coframe", base_url: "https://api.ashbyhq.com/posting-api/job-board/coframe?includeCompensation=true" },
  { id: "ab-cognition", name: "Cognition (Ashby)", source_type: "ashby", company_handle: "cognition", base_url: "https://api.ashbyhq.com/posting-api/job-board/cognition?includeCompensation=true" },
  { id: "ab-composio", name: "Composio (Ashby)", source_type: "ashby", company_handle: "composio", base_url: "https://api.ashbyhq.com/posting-api/job-board/composio?includeCompensation=true" },
  { id: "ab-conduct", name: "Conduct (Ashby)", source_type: "ashby", company_handle: "conduct", base_url: "https://api.ashbyhq.com/posting-api/job-board/conduct?includeCompensation=true" },
  { id: "ab-continua", name: "continua (Ashby)", source_type: "ashby", company_handle: "continua", base_url: "https://api.ashbyhq.com/posting-api/job-board/continua?includeCompensation=true" },
  { id: "ab-credal", name: "Credal (Ashby)", source_type: "ashby", company_handle: "credal", base_url: "https://api.ashbyhq.com/posting-api/job-board/credal?includeCompensation=true" },
  { id: "ab-datacurve", name: "Datacurve (Ashby)", source_type: "ashby", company_handle: "datacurve", base_url: "https://api.ashbyhq.com/posting-api/job-board/datacurve?includeCompensation=true" },
  { id: "ab-deepgram", name: "Deepgram (Ashby)", source_type: "ashby", company_handle: "deepgram", base_url: "https://api.ashbyhq.com/posting-api/job-board/deepgram?includeCompensation=true" },
  { id: "ab-deepjudge", name: "DeepJudge (Ashby)", source_type: "ashby", company_handle: "deepjudge", base_url: "https://api.ashbyhq.com/posting-api/job-board/deepjudge?includeCompensation=true" },
  { id: "ab-edra", name: "Edra (Ashby)", source_type: "ashby", company_handle: "edra", base_url: "https://api.ashbyhq.com/posting-api/job-board/edra?includeCompensation=true" },
  { id: "ab-espresso-ai", name: "Espresso AI (Ashby)", source_type: "ashby", company_handle: "espresso", base_url: "https://api.ashbyhq.com/posting-api/job-board/espresso?includeCompensation=true" },
  { id: "ab-exa", name: "Exa (Ashby)", source_type: "ashby", company_handle: "exa", base_url: "https://api.ashbyhq.com/posting-api/job-board/exa?includeCompensation=true" },
  { id: "ab-fundamental-labs", name: "Fundamental Labs (Ashby)", source_type: "ashby", company_handle: "fundamental", base_url: "https://api.ashbyhq.com/posting-api/job-board/fundamental?includeCompensation=true" },
  { id: "ab-gradient-labs", name: "Gradient Labs (Ashby)", source_type: "ashby", company_handle: "gradient-labs", base_url: "https://api.ashbyhq.com/posting-api/job-board/gradient-labs?includeCompensation=true" },
  { id: "ab-h-company", name: "H Company (Ashby)", source_type: "ashby", company_handle: "hcompany", base_url: "https://api.ashbyhq.com/posting-api/job-board/hcompany?includeCompensation=true" },
  { id: "ab-hedra", name: "Hedra (Ashby)", source_type: "ashby", company_handle: "hedra", base_url: "https://api.ashbyhq.com/posting-api/job-board/hedra?includeCompensation=true" },
  { id: "ab-human-native", name: "Human Native (Ashby)", source_type: "ashby", company_handle: "human", base_url: "https://api.ashbyhq.com/posting-api/job-board/human?includeCompensation=true" },
  { id: "ab-hyperbolic", name: "Hyperbolic (Ashby)", source_type: "ashby", company_handle: "hyperbolic", base_url: "https://api.ashbyhq.com/posting-api/job-board/hyperbolic?includeCompensation=true" },
  { id: "ab-hyperbound", name: "Hyperbound (Ashby)", source_type: "ashby", company_handle: "hyperbound", base_url: "https://api.ashbyhq.com/posting-api/job-board/hyperbound?includeCompensation=true" },
  { id: "ab-inferact", name: "Inferact (Ashby)", source_type: "ashby", company_handle: "inferact", base_url: "https://api.ashbyhq.com/posting-api/job-board/inferact?includeCompensation=true" },
  { id: "ab-inkeep", name: "Inkeep (Ashby)", source_type: "ashby", company_handle: "inkeep", base_url: "https://api.ashbyhq.com/posting-api/job-board/inkeep?includeCompensation=true" },
  { id: "ab-irregular", name: "Irregular (Ashby)", source_type: "ashby", company_handle: "irregular", base_url: "https://api.ashbyhq.com/posting-api/job-board/irregular?includeCompensation=true" },
  { id: "ab-langdock", name: "Langdock (Ashby)", source_type: "ashby", company_handle: "langdock", base_url: "https://api.ashbyhq.com/posting-api/job-board/langdock?includeCompensation=true" },
  { id: "ab-legora", name: "Legora (Ashby)", source_type: "ashby", company_handle: "legora", base_url: "https://api.ashbyhq.com/posting-api/job-board/legora?includeCompensation=true" },
  { id: "ab-letta", name: "Letta (Ashby)", source_type: "ashby", company_handle: "letta", base_url: "https://api.ashbyhq.com/posting-api/job-board/letta?includeCompensation=true" },
  { id: "ab-liquid-ai", name: "Liquid AI (Ashby)", source_type: "ashby", company_handle: "liquid-ai", base_url: "https://api.ashbyhq.com/posting-api/job-board/liquid-ai?includeCompensation=true" },
  { id: "ab-mem0", name: "Mem0 (Ashby)", source_type: "ashby", company_handle: "mem0", base_url: "https://api.ashbyhq.com/posting-api/job-board/mem0?includeCompensation=true" },
  { id: "ab-moonlake", name: "Moonlake (Ashby)", source_type: "ashby", company_handle: "moonlake", base_url: "https://api.ashbyhq.com/posting-api/job-board/moonlake?includeCompensation=true" },
  { id: "ab-nomic-ai", name: "Nomic AI (Ashby)", source_type: "ashby", company_handle: "nomic", base_url: "https://api.ashbyhq.com/posting-api/job-board/nomic?includeCompensation=true" },
  { id: "ab-nous-research", name: "Nous Research (Ashby)", source_type: "ashby", company_handle: "nous", base_url: "https://api.ashbyhq.com/posting-api/job-board/nous?includeCompensation=true" },
  { id: "ab-openrouter", name: "OpenRouter (Ashby)", source_type: "ashby", company_handle: "openrouter", base_url: "https://api.ashbyhq.com/posting-api/job-board/openrouter?includeCompensation=true" },
  { id: "ab-physical-intelligence", name: "Physical Intelligence (Ashby)", source_type: "ashby", company_handle: "physicalintelligence", base_url: "https://api.ashbyhq.com/posting-api/job-board/physicalintelligence?includeCompensation=true" },
  { id: "ab-pika", name: "Pika (Ashby)", source_type: "ashby", company_handle: "pika", base_url: "https://api.ashbyhq.com/posting-api/job-board/pika?includeCompensation=true" },
  { id: "ab-poolside", name: "Poolside (Ashby)", source_type: "ashby", company_handle: "poolside", base_url: "https://api.ashbyhq.com/posting-api/job-board/poolside?includeCompensation=true" },
  { id: "ab-prime-intellect", name: "Prime Intellect (Ashby)", source_type: "ashby", company_handle: "primeintellect", base_url: "https://api.ashbyhq.com/posting-api/job-board/primeintellect?includeCompensation=true" },
  { id: "ab-relace", name: "Relace (Ashby)", source_type: "ashby", company_handle: "relace", base_url: "https://api.ashbyhq.com/posting-api/job-board/relace?includeCompensation=true" },
  { id: "ab-runway-ai", name: "Runway AI (Ashby)", source_type: "ashby", company_handle: "runway", base_url: "https://api.ashbyhq.com/posting-api/job-board/runway?includeCompensation=true" },
  { id: "ab-sapien", name: "Sapien (Ashby)", source_type: "ashby", company_handle: "sapien", base_url: "https://api.ashbyhq.com/posting-api/job-board/sapien?includeCompensation=true" },
  { id: "ab-simile", name: "Simile (Ashby)", source_type: "ashby", company_handle: "simile", base_url: "https://api.ashbyhq.com/posting-api/job-board/simile?includeCompensation=true" },
  { id: "ab-simular", name: "Simular (Ashby)", source_type: "ashby", company_handle: "simular", base_url: "https://api.ashbyhq.com/posting-api/job-board/simular?includeCompensation=true" },
  { id: "ab-sola", name: "Sola (Ashby)", source_type: "ashby", company_handle: "sola", base_url: "https://api.ashbyhq.com/posting-api/job-board/sola?includeCompensation=true" },
  { id: "ab-solve-intelligence", name: "Solve Intelligence (Ashby)", source_type: "ashby", company_handle: "solveintelligence", base_url: "https://api.ashbyhq.com/posting-api/job-board/solveintelligence?includeCompensation=true" },
  { id: "ab-summation", name: "Summation (Ashby)", source_type: "ashby", company_handle: "summation", base_url: "https://api.ashbyhq.com/posting-api/job-board/summation?includeCompensation=true" },
  { id: "ab-suno", name: "Suno (Ashby)", source_type: "ashby", company_handle: "suno", base_url: "https://api.ashbyhq.com/posting-api/job-board/suno?includeCompensation=true" },
  { id: "ab-tako", name: "Tako (Ashby)", source_type: "ashby", company_handle: "tako", base_url: "https://api.ashbyhq.com/posting-api/job-board/tako?includeCompensation=true" },
  { id: "ab-twelvelabs", name: "TwelveLabs (Ashby)", source_type: "ashby", company_handle: "twelve", base_url: "https://api.ashbyhq.com/posting-api/job-board/twelve?includeCompensation=true" },
  { id: "ab-yutori", name: "Yutori (Ashby)", source_type: "ashby", company_handle: "yutori", base_url: "https://api.ashbyhq.com/posting-api/job-board/yutori?includeCompensation=true" },
  { id: "gh-assemblyai", name: "AssemblyAI (Greenhouse)", source_type: "greenhouse", company_handle: "assemblyai", base_url: "https://boards-api.greenhouse.io/v1/boards/assemblyai/jobs" },
  { id: "gh-axiom", name: "Axiom (Math) (Greenhouse)", source_type: "greenhouse", company_handle: "axiom", base_url: "https://boards-api.greenhouse.io/v1/boards/axiom/jobs" },
  { id: "gh-harmonic", name: "Harmonic (Greenhouse)", source_type: "greenhouse", company_handle: "harmonic", base_url: "https://boards-api.greenhouse.io/v1/boards/harmonic/jobs" },
  { id: "gh-mithril", name: "Mithril (Greenhouse)", source_type: "greenhouse", company_handle: "mithril", base_url: "https://boards-api.greenhouse.io/v1/boards/mithril/jobs" },
  { id: "gh-parallel", name: "Parallel (Greenhouse)", source_type: "greenhouse", company_handle: "parallel", base_url: "https://boards-api.greenhouse.io/v1/boards/parallel/jobs" },
  { id: "gh-recall-ai", name: "Recall.ai (Greenhouse)", source_type: "greenhouse", company_handle: "recall", base_url: "https://boards-api.greenhouse.io/v1/boards/recall/jobs" },
  { id: "gh-symbolica", name: "Symbolica (Greenhouse)", source_type: "greenhouse", company_handle: "symbolica", base_url: "https://boards-api.greenhouse.io/v1/boards/symbolica/jobs" },
  { id: "lv-adaptive-computer", name: "Adaptive Computer (Lever)", source_type: "lever", company_handle: "adaptive", base_url: "https://api.lever.co/v0/postings/adaptive" },
  { id: "lv-extropic", name: "Extropic (Lever)", source_type: "lever", company_handle: "extropic", base_url: "https://api.lever.co/v0/postings/extropic" },
  { id: "lv-ivo", name: "Ivo (Lever)", source_type: "lever", company_handle: "ivo", base_url: "https://api.lever.co/v0/postings/ivo" },
  { id: "lv-pendulum", name: "Pendulum (Lever)", source_type: "lever", company_handle: "pendulum", base_url: "https://api.lever.co/v0/postings/pendulum" },
  { id: "ps-juna-ai", name: "juna.ai (Personio)", source_type: "personio", company_handle: "juna", base_url: "https://juna.jobs.personio.de/xml" },
  { id: "ps-resolve-ai", name: "Resolve AI (Personio)", source_type: "personio", company_handle: "resolve", base_url: "https://resolve.jobs.personio.de/xml" },
  { id: "rc-flower-computer-co", name: "Flower Computer Co. (Recruitee)", source_type: "recruitee", company_handle: "flower", base_url: "https://flower.recruitee.com/api/offers" },
  { id: "sr-shaped", name: "Shaped (SmartRecruiters)", source_type: "smartrecruiters", company_handle: "Shaped", base_url: "https://api.smartrecruiters.com/v1/companies/Shaped/postings" },

  // ─── Design / robotics / retail / health cohort (batch 2 probe, 2026-03) ───
  { id: "ab-alleviate-health", name: "Alleviate Health (Ashby)", source_type: "ashby", company_handle: "alleviatehealth", base_url: "https://api.ashbyhq.com/posting-api/job-board/alleviatehealth?includeCompensation=true" },
  { id: "ab-amo", name: "amo (Ashby)", source_type: "ashby", company_handle: "amo", base_url: "https://api.ashbyhq.com/posting-api/job-board/amo?includeCompensation=true" },
  { id: "ab-atlas", name: "Atlas (Ashby)", source_type: "ashby", company_handle: "atlas", base_url: "https://api.ashbyhq.com/posting-api/job-board/atlas?includeCompensation=true" },
  { id: "ab-bevel", name: "Bevel (Ashby)", source_type: "ashby", company_handle: "bevel", base_url: "https://api.ashbyhq.com/posting-api/job-board/bevel?includeCompensation=true" },
  { id: "ab-camber", name: "Camber (Ashby)", source_type: "ashby", company_handle: "camber", base_url: "https://api.ashbyhq.com/posting-api/job-board/camber?includeCompensation=true" },
  { id: "ab-capsule", name: "Capsule (Ashby)", source_type: "ashby", company_handle: "capsule", base_url: "https://api.ashbyhq.com/posting-api/job-board/capsule?includeCompensation=true" },
  { id: "ab-charge-robotics", name: "Charge Robotics (Ashby)", source_type: "ashby", company_handle: "charge-robotics", base_url: "https://api.ashbyhq.com/posting-api/job-board/charge-robotics?includeCompensation=true" },
  { id: "ab-copilot-money", name: "Copilot Money (Ashby)", source_type: "ashby", company_handle: "copilot-money", base_url: "https://api.ashbyhq.com/posting-api/job-board/copilot-money?includeCompensation=true" },
  { id: "ab-cosmos", name: "Cosmos (Ashby)", source_type: "ashby", company_handle: "cosmos", base_url: "https://api.ashbyhq.com/posting-api/job-board/cosmos?includeCompensation=true" },
  { id: "ab-edia", name: "Edia (Ashby)", source_type: "ashby", company_handle: "edia", base_url: "https://api.ashbyhq.com/posting-api/job-board/edia?includeCompensation=true" },
  { id: "ab-fauna-robotics", name: "Fauna Robotics (Ashby)", source_type: "ashby", company_handle: "fauna-robotics", base_url: "https://api.ashbyhq.com/posting-api/job-board/fauna-robotics?includeCompensation=true" },
  { id: "ab-flint", name: "Flint (K12) (Ashby)", source_type: "ashby", company_handle: "flint", base_url: "https://api.ashbyhq.com/posting-api/job-board/flint?includeCompensation=true" },
  { id: "ab-fortuna-health", name: "Fortuna Health (Ashby)", source_type: "ashby", company_handle: "fortuna-health", base_url: "https://api.ashbyhq.com/posting-api/job-board/fortuna-health?includeCompensation=true" },
  { id: "ab-freed", name: "Freed (Ashby)", source_type: "ashby", company_handle: "freed", base_url: "https://api.ashbyhq.com/posting-api/job-board/freed?includeCompensation=true" },
  { id: "ab-gamma", name: "Gamma (Ashby)", source_type: "ashby", company_handle: "gamma", base_url: "https://api.ashbyhq.com/posting-api/job-board/gamma?includeCompensation=true" },
  { id: "ab-generalist-ai", name: "Generalist AI (Ashby)", source_type: "ashby", company_handle: "generalist", base_url: "https://api.ashbyhq.com/posting-api/job-board/generalist?includeCompensation=true" },
  { id: "ab-genesis-ai", name: "Genesis AI (Ashby)", source_type: "ashby", company_handle: "genesis-ai", base_url: "https://api.ashbyhq.com/posting-api/job-board/genesis-ai?includeCompensation=true" },
  { id: "ab-hello-patient", name: "Hello Patient (Ashby)", source_type: "ashby", company_handle: "hellopatient", base_url: "https://api.ashbyhq.com/posting-api/job-board/hellopatient?includeCompensation=true" },
  { id: "ab-jump", name: "Jump (Ashby)", source_type: "ashby", company_handle: "jump", base_url: "https://api.ashbyhq.com/posting-api/job-board/jump?includeCompensation=true" },
  { id: "ab-junction", name: "Junction (Ashby)", source_type: "ashby", company_handle: "junction", base_url: "https://api.ashbyhq.com/posting-api/job-board/junction?includeCompensation=true" },
  { id: "ab-latent-health", name: "Latent Health (Ashby)", source_type: "ashby", company_handle: "latent", base_url: "https://api.ashbyhq.com/posting-api/job-board/latent?includeCompensation=true" },
  { id: "ab-leland", name: "Leland (Ashby)", source_type: "ashby", company_handle: "leland", base_url: "https://api.ashbyhq.com/posting-api/job-board/leland?includeCompensation=true" },
  { id: "ab-leona", name: "Leona (Ashby)", source_type: "ashby", company_handle: "leona", base_url: "https://api.ashbyhq.com/posting-api/job-board/leona?includeCompensation=true" },
  { id: "ab-lotus-health", name: "Lotus Health (Ashby)", source_type: "ashby", company_handle: "lotushealth", base_url: "https://api.ashbyhq.com/posting-api/job-board/lotushealth?includeCompensation=true" },
  { id: "ab-magic-patterns", name: "Magic Patterns (Ashby)", source_type: "ashby", company_handle: "magicpatterns", base_url: "https://api.ashbyhq.com/posting-api/job-board/magicpatterns?includeCompensation=true" },
  { id: "ab-marble-health", name: "Marble Health (Ashby)", source_type: "ashby", company_handle: "marble", base_url: "https://api.ashbyhq.com/posting-api/job-board/marble?includeCompensation=true" },
  { id: "ab-monumental-labs", name: "Monumental Labs (Ashby)", source_type: "ashby", company_handle: "monumental", base_url: "https://api.ashbyhq.com/posting-api/job-board/monumental?includeCompensation=true" },
  { id: "ab-new-lantern", name: "New Lantern (Ashby)", source_type: "ashby", company_handle: "newlantern", base_url: "https://api.ashbyhq.com/posting-api/job-board/newlantern?includeCompensation=true" },
  { id: "ab-oboe", name: "Oboe (Ashby)", source_type: "ashby", company_handle: "oboe", base_url: "https://api.ashbyhq.com/posting-api/job-board/oboe?includeCompensation=true" },
  { id: "ab-odyssey", name: "Odyssey (Ashby)", source_type: "ashby", company_handle: "odyssey", base_url: "https://api.ashbyhq.com/posting-api/job-board/odyssey?includeCompensation=true" },
  { id: "ab-onton", name: "Onton (Ashby)", source_type: "ashby", company_handle: "onton", base_url: "https://api.ashbyhq.com/posting-api/job-board/onton?includeCompensation=true" },
  { id: "ab-openevidence", name: "OpenEvidence (Ashby)", source_type: "ashby", company_handle: "openevidence", base_url: "https://api.ashbyhq.com/posting-api/job-board/openevidence?includeCompensation=true" },
  { id: "ab-partiful", name: "Partiful (Ashby)", source_type: "ashby", company_handle: "partiful", base_url: "https://api.ashbyhq.com/posting-api/job-board/partiful?includeCompensation=true" },
  { id: "ab-playground", name: "Playground (Ashby)", source_type: "ashby", company_handle: "playground", base_url: "https://api.ashbyhq.com/posting-api/job-board/playground?includeCompensation=true" },
  { id: "ab-recraft", name: "Recraft (Ashby)", source_type: "ashby", company_handle: "recraft", base_url: "https://api.ashbyhq.com/posting-api/job-board/recraft?includeCompensation=true" },
  { id: "ab-robco", name: "RobCo (Ashby)", source_type: "ashby", company_handle: "robco", base_url: "https://api.ashbyhq.com/posting-api/job-board/robco?includeCompensation=true" },
  { id: "ab-sweatpals", name: "Sweatpals (Ashby)", source_type: "ashby", company_handle: "sweatpals", base_url: "https://api.ashbyhq.com/posting-api/job-board/sweatpals?includeCompensation=true" },
  { id: "ab-tandem", name: "Tandem (Ashby)", source_type: "ashby", company_handle: "tandem", base_url: "https://api.ashbyhq.com/posting-api/job-board/tandem?includeCompensation=true" },
  { id: "ab-terranova", name: "Terranova (Ashby)", source_type: "ashby", company_handle: "terranova", base_url: "https://api.ashbyhq.com/posting-api/job-board/terranova?includeCompensation=true" },
  { id: "gh-alloy", name: "Alloy (Greenhouse)", source_type: "greenhouse", company_handle: "alloy", base_url: "https://boards-api.greenhouse.io/v1/boards/alloy/jobs" },
  { id: "gh-alma", name: "Alma (Greenhouse)", source_type: "greenhouse", company_handle: "alma", base_url: "https://boards-api.greenhouse.io/v1/boards/alma/jobs" },
  { id: "gh-fay", name: "Fay (Greenhouse)", source_type: "greenhouse", company_handle: "fay", base_url: "https://boards-api.greenhouse.io/v1/boards/fay/jobs" },
  { id: "gh-matic", name: "Matic (Greenhouse)", source_type: "greenhouse", company_handle: "matic", base_url: "https://boards-api.greenhouse.io/v1/boards/matic/jobs" },
  { id: "gh-modern-animal", name: "Modern Animal (Greenhouse)", source_type: "greenhouse", company_handle: "modernanimal", base_url: "https://boards-api.greenhouse.io/v1/boards/modernanimal/jobs" },
  { id: "lv-collate", name: "Collate (Lever)", source_type: "lever", company_handle: "collate", base_url: "https://api.lever.co/v0/postings/collate" },
  { id: "lv-corbalt", name: "Corbalt (Lever)", source_type: "lever", company_handle: "corbalt", base_url: "https://api.lever.co/v0/postings/corbalt" },
  { id: "lv-eternal", name: "Eternal (Lever)", source_type: "lever", company_handle: "eternal", base_url: "https://api.lever.co/v0/postings/eternal" },
  { id: "lv-loop", name: "Loop (Returns) (Lever)", source_type: "lever", company_handle: "loopreturns", base_url: "https://api.lever.co/v0/postings/loopreturns" },
  { id: "lv-paradigm-health", name: "Paradigm Health (Lever)", source_type: "lever", company_handle: "paradigm-health", base_url: "https://api.lever.co/v0/postings/paradigm-health" },
  { id: "lv-playbook", name: "Playbook (Lever)", source_type: "lever", company_handle: "playbook", base_url: "https://api.lever.co/v0/postings/playbook" },
  { id: "ps-framer", name: "Framer (Personio)", source_type: "personio", company_handle: "framer", base_url: "https://framer.jobs.personio.de/xml" },
  { id: "rc-1x", name: "1X (Recruitee)", source_type: "recruitee", company_handle: "1x", base_url: "https://1x.recruitee.com/api/offers" },
  { id: "rc-openmind", name: "OpenMind (Recruitee)", source_type: "recruitee", company_handle: "openmind", base_url: "https://openmind.recruitee.com/api/offers" },

  // ─── Startup list cohort (batch 3 probe, 2026-03) ───
  // From scripts/companies-batch3.txt. Skipped gh-ghost, Pitch Personio, Recruitee clay (Clay.earth uses Ashby), count<2 non-SR, already in migrate.
  // 210 sources.
  { id: "ps-open", name: "&Open (Personio)", source_type: "personio", company_handle: "open", base_url: "https://open.jobs.personio.de/xml" },
  { id: "ab-aaru", name: "Aaru (Ashby)", source_type: "ashby", company_handle: "aaru", base_url: "https://api.ashbyhq.com/posting-api/job-board/aaru?includeCompensation=true" },
  { id: "lv-adora", name: "Adora (Lever)", source_type: "lever", company_handle: "adora", base_url: "https://api.lever.co/v0/postings/adora" },
  { id: "ab-aetherflux", name: "Aetherflux (Ashby)", source_type: "ashby", company_handle: "aetherflux", base_url: "https://api.ashbyhq.com/posting-api/job-board/aetherflux?includeCompensation=true" },
  { id: "ab-agentio", name: "Agentio (Ashby)", source_type: "ashby", company_handle: "agentio", base_url: "https://api.ashbyhq.com/posting-api/job-board/agentio?includeCompensation=true" },
  { id: "ab-agentmail", name: "AgentMail (Ashby)", source_type: "ashby", company_handle: "agentmail", base_url: "https://api.ashbyhq.com/posting-api/job-board/agentmail?includeCompensation=true" },
  { id: "lv-airalo", name: "Airalo (Lever)", source_type: "lever", company_handle: "airalo", base_url: "https://api.lever.co/v0/postings/airalo" },
  { id: "ab-aleph", name: "Aleph (Ashby)", source_type: "ashby", company_handle: "aleph", base_url: "https://api.ashbyhq.com/posting-api/job-board/aleph?includeCompensation=true" },
  { id: "rc-alex", name: "Alex (Recruitee)", source_type: "recruitee", company_handle: "alex", base_url: "https://alex.recruitee.com/api/offers" },
  { id: "lv-alice-bob", name: "Alice & Bob (Lever)", source_type: "lever", company_handle: "alice-bob", base_url: "https://api.lever.co/v0/postings/alice-bob" },
  { id: "ab-ambrook", name: "Ambrook (Ashby)", source_type: "ashby", company_handle: "ambrook", base_url: "https://api.ashbyhq.com/posting-api/job-board/ambrook?includeCompensation=true" },
  { id: "ab-ando", name: "Ando (Ashby)", source_type: "ashby", company_handle: "ando", base_url: "https://api.ashbyhq.com/posting-api/job-board/ando?includeCompensation=true" },
  { id: "ab-anomalo", name: "Anomalo (Ashby)", source_type: "ashby", company_handle: "anomalo", base_url: "https://api.ashbyhq.com/posting-api/job-board/anomalo?includeCompensation=true" },
  { id: "ab-anon", name: "Anon (Ashby)", source_type: "ashby", company_handle: "anon", base_url: "https://api.ashbyhq.com/posting-api/job-board/anon?includeCompensation=true" },
  { id: "ab-antimetal", name: "Antimetal (Ashby)", source_type: "ashby", company_handle: "antimetal", base_url: "https://api.ashbyhq.com/posting-api/job-board/antimetal?includeCompensation=true" },
  { id: "ps-apheris", name: "Apheris (Personio)", source_type: "personio", company_handle: "apheris", base_url: "https://apheris.jobs.personio.de/xml" },
  { id: "ab-apron", name: "Apron (Ashby)", source_type: "ashby", company_handle: "apron", base_url: "https://api.ashbyhq.com/posting-api/job-board/apron?includeCompensation=true" },
  { id: "ab-aqua-voice", name: "Aqua Voice (Ashby)", source_type: "ashby", company_handle: "aqua-voice", base_url: "https://api.ashbyhq.com/posting-api/job-board/aqua-voice?includeCompensation=true" },
  { id: "ab-arcadeai", name: "Arcade AI (Ashby)", source_type: "ashby", company_handle: "arcadeai", base_url: "https://api.ashbyhq.com/posting-api/job-board/arcadeai?includeCompensation=true" },
  { id: "ab-arena", name: "Arena (Ashby)", source_type: "ashby", company_handle: "arena", base_url: "https://api.ashbyhq.com/posting-api/job-board/arena?includeCompensation=true" },
  { id: "ab-artie", name: "Artie (Ashby)", source_type: "ashby", company_handle: "artie", base_url: "https://api.ashbyhq.com/posting-api/job-board/artie?includeCompensation=true" },
  { id: "ab-assembly", name: "Assembly (Ashby)", source_type: "ashby", company_handle: "assembly", base_url: "https://api.ashbyhq.com/posting-api/job-board/assembly?includeCompensation=true" },
  { id: "ab-atob", name: "AtoB (Ashby)", source_type: "ashby", company_handle: "atob", base_url: "https://api.ashbyhq.com/posting-api/job-board/atob?includeCompensation=true" },
  { id: "ab-atomicindustries", name: "Atomic Industries (Ashby)", source_type: "ashby", company_handle: "atomicindustries", base_url: "https://api.ashbyhq.com/posting-api/job-board/atomicindustries?includeCompensation=true" },
  { id: "ab-auctor", name: "Auctor (Ashby)", source_type: "ashby", company_handle: "auctor", base_url: "https://api.ashbyhq.com/posting-api/job-board/auctor?includeCompensation=true" },
  { id: "ab-august", name: "August (Ashby)", source_type: "ashby", company_handle: "august", base_url: "https://api.ashbyhq.com/posting-api/job-board/august?includeCompensation=true" },
  { id: "lv-autonomous", name: "Autonomous (Lever)", source_type: "lever", company_handle: "autonomous", base_url: "https://api.lever.co/v0/postings/autonomous" },
  { id: "ab-base", name: "Base (Ashby)", source_type: "ashby", company_handle: "base", base_url: "https://api.ashbyhq.com/posting-api/job-board/base?includeCompensation=true" },
  { id: "lv-basis", name: "Basis (Lever)", source_type: "lever", company_handle: "basis", base_url: "https://api.lever.co/v0/postings/basis" },
  { id: "gh-baton", name: "Baton (Greenhouse)", source_type: "greenhouse", company_handle: "baton", base_url: "https://boards-api.greenhouse.io/v1/boards/baton/jobs" },
  { id: "ab-bem", name: "bem (Ashby)", source_type: "ashby", company_handle: "bem", base_url: "https://api.ashbyhq.com/posting-api/job-board/bem?includeCompensation=true" },
  { id: "gh-bird", name: "Bird (Greenhouse)", source_type: "greenhouse", company_handle: "bird", base_url: "https://boards-api.greenhouse.io/v1/boards/bird/jobs" },
  { id: "ab-blacksmith", name: "Blacksmith (Ashby)", source_type: "ashby", company_handle: "blacksmith", base_url: "https://api.ashbyhq.com/posting-api/job-board/blacksmith?includeCompensation=true" },
  { id: "ab-buena", name: "Buena (Ashby)", source_type: "ashby", company_handle: "buena", base_url: "https://api.ashbyhq.com/posting-api/job-board/buena?includeCompensation=true" },
  { id: "ab-cambium", name: "Cambium (Ashby)", source_type: "ashby", company_handle: "cambium", base_url: "https://api.ashbyhq.com/posting-api/job-board/cambium?includeCompensation=true" },
  { id: "ab-campfire", name: "Campfire (Ashby)", source_type: "ashby", company_handle: "campfire", base_url: "https://api.ashbyhq.com/posting-api/job-board/campfire?includeCompensation=true" },
  { id: "ab-cape", name: "Cape (Ashby)", source_type: "ashby", company_handle: "cape", base_url: "https://api.ashbyhq.com/posting-api/job-board/cape?includeCompensation=true" },
  { id: "ab-cardless", name: "Cardless (Ashby)", source_type: "ashby", company_handle: "cardless", base_url: "https://api.ashbyhq.com/posting-api/job-board/cardless?includeCompensation=true" },
  { id: "ab-catena-labs", name: "Catena Labs (Ashby)", source_type: "ashby", company_handle: "catena-labs", base_url: "https://api.ashbyhq.com/posting-api/job-board/catena-labs?includeCompensation=true" },
  { id: "ab-causallabs", name: "Causal Labs (Ashby)", source_type: "ashby", company_handle: "causallabs", base_url: "https://api.ashbyhq.com/posting-api/job-board/causallabs?includeCompensation=true" },
  { id: "ab-chaidiscovery", name: "Chai Discovery (Ashby)", source_type: "ashby", company_handle: "chaidiscovery", base_url: "https://api.ashbyhq.com/posting-api/job-board/chaidiscovery?includeCompensation=true" },
  { id: "ab-chilipiper", name: "Chili Piper (Ashby)", source_type: "ashby", company_handle: "chilipiper", base_url: "https://api.ashbyhq.com/posting-api/job-board/chilipiper?includeCompensation=true" },
  { id: "ab-clair", name: "Clair (Ashby)", source_type: "ashby", company_handle: "clair", base_url: "https://api.ashbyhq.com/posting-api/job-board/clair?includeCompensation=true" },
  { id: "ab-clarify", name: "Clarify (Ashby)", source_type: "ashby", company_handle: "clarify", base_url: "https://api.ashbyhq.com/posting-api/job-board/clarify?includeCompensation=true" },
  { id: "gh-clearstreet", name: "Clear Street (Greenhouse)", source_type: "greenhouse", company_handle: "clearstreet", base_url: "https://boards-api.greenhouse.io/v1/boards/clearstreet/jobs" },
  { id: "gh-cline", name: "Cline (Greenhouse)", source_type: "greenhouse", company_handle: "cline", base_url: "https://boards-api.greenhouse.io/v1/boards/cline/jobs" },
  { id: "ab-clove", name: "Clove (Ashby)", source_type: "ashby", company_handle: "clove", base_url: "https://api.ashbyhq.com/posting-api/job-board/clove?includeCompensation=true" },
  { id: "gh-cocoon", name: "Cocoon (Greenhouse)", source_type: "greenhouse", company_handle: "cocoon", base_url: "https://boards-api.greenhouse.io/v1/boards/cocoon/jobs" },
  { id: "ab-collective", name: "Collective (Ashby)", source_type: "ashby", company_handle: "collective", base_url: "https://api.ashbyhq.com/posting-api/job-board/collective?includeCompensation=true" },
  { id: "ab-comulate", name: "Comulate (Ashby)", source_type: "ashby", company_handle: "comulate", base_url: "https://api.ashbyhq.com/posting-api/job-board/comulate?includeCompensation=true" },
  { id: "ab-conductor", name: "Conductor (Ashby)", source_type: "ashby", company_handle: "conductor", base_url: "https://api.ashbyhq.com/posting-api/job-board/conductor?includeCompensation=true" },
  { id: "ab-console", name: "Console (Ashby)", source_type: "ashby", company_handle: "console", base_url: "https://api.ashbyhq.com/posting-api/job-board/console?includeCompensation=true" },
  { id: "ab-conversion", name: "Conversion (Ashby)", source_type: "ashby", company_handle: "conversion", base_url: "https://api.ashbyhq.com/posting-api/job-board/conversion?includeCompensation=true" },
  { id: "ab-corgi", name: "Corgi (Ashby)", source_type: "ashby", company_handle: "corgi", base_url: "https://api.ashbyhq.com/posting-api/job-board/corgi?includeCompensation=true" },
  { id: "ab-cube", name: "Cube (Ashby)", source_type: "ashby", company_handle: "cube", base_url: "https://api.ashbyhq.com/posting-api/job-board/cube?includeCompensation=true" },
  { id: "ab-dakota", name: "Dakota (Ashby)", source_type: "ashby", company_handle: "dakota", base_url: "https://api.ashbyhq.com/posting-api/job-board/dakota?includeCompensation=true" },
  { id: "gh-daylight", name: "Daylight Security (Greenhouse)", source_type: "greenhouse", company_handle: "daylight", base_url: "https://boards-api.greenhouse.io/v1/boards/daylight/jobs" },
  { id: "ab-depthfirst", name: "depthfirst (Ashby)", source_type: "ashby", company_handle: "depthfirst", base_url: "https://api.ashbyhq.com/posting-api/job-board/depthfirst?includeCompensation=true" },
  { id: "ab-ditto", name: "Ditto (Ashby)", source_type: "ashby", company_handle: "ditto", base_url: "https://api.ashbyhq.com/posting-api/job-board/ditto?includeCompensation=true" },
  { id: "ab-doinstruct", name: "doinstruct (Ashby)", source_type: "ashby", company_handle: "doinstruct", base_url: "https://api.ashbyhq.com/posting-api/job-board/doinstruct?includeCompensation=true" },
  { id: "ab-doss", name: "Doss (Ashby)", source_type: "ashby", company_handle: "doss", base_url: "https://api.ashbyhq.com/posting-api/job-board/doss?includeCompensation=true" },
  { id: "ab-dualentry", name: "DualEntry (Ashby)", source_type: "ashby", company_handle: "dualentry", base_url: "https://api.ashbyhq.com/posting-api/job-board/dualentry?includeCompensation=true" },
  { id: "lv-duffel", name: "Duffel (Lever)", source_type: "lever", company_handle: "duffel", base_url: "https://api.lever.co/v0/postings/duffel" },
  { id: "lv-durin", name: "Durin (Lever)", source_type: "lever", company_handle: "durin", base_url: "https://api.lever.co/v0/postings/durin" },
  { id: "ab-e2b", name: "E2B (Ashby)", source_type: "ashby", company_handle: "e2b", base_url: "https://api.ashbyhq.com/posting-api/job-board/e2b?includeCompensation=true" },
  { id: "ab-echo", name: "Echo (Ashby)", source_type: "ashby", company_handle: "echo", base_url: "https://api.ashbyhq.com/posting-api/job-board/echo?includeCompensation=true" },
  { id: "gh-efficientcomputer", name: "Efficient Computer (Greenhouse)", source_type: "greenhouse", company_handle: "efficientcomputer", base_url: "https://boards-api.greenhouse.io/v1/boards/efficientcomputer/jobs" },
  { id: "ab-ellipsislabs", name: "Ellipsis Labs (Ashby)", source_type: "ashby", company_handle: "ellipsislabs", base_url: "https://api.ashbyhq.com/posting-api/job-board/ellipsislabs?includeCompensation=true" },
  { id: "ab-endex", name: "Endex (Ashby)", source_type: "ashby", company_handle: "endex", base_url: "https://api.ashbyhq.com/posting-api/job-board/endex?includeCompensation=true" },
  { id: "ab-etched", name: "Etched (Ashby)", source_type: "ashby", company_handle: "etched", base_url: "https://api.ashbyhq.com/posting-api/job-board/etched?includeCompensation=true" },
  { id: "ab-eventual", name: "Eventual (Ashby)", source_type: "ashby", company_handle: "eventual", base_url: "https://api.ashbyhq.com/posting-api/job-board/eventual?includeCompensation=true" },
  { id: "ab-evervault", name: "Evervault (Ashby)", source_type: "ashby", company_handle: "evervault", base_url: "https://api.ashbyhq.com/posting-api/job-board/evervault?includeCompensation=true" },
  { id: "ab-farel", name: "Farel (Ashby)", source_type: "ashby", company_handle: "farel", base_url: "https://api.ashbyhq.com/posting-api/job-board/farel?includeCompensation=true" },
  { id: "ab-filigran", name: "Filigran (Ashby)", source_type: "ashby", company_handle: "filigran", base_url: "https://api.ashbyhq.com/posting-api/job-board/filigran?includeCompensation=true" },
  { id: "lv-finch", name: "Finch (Lever)", source_type: "lever", company_handle: "finch", base_url: "https://api.lever.co/v0/postings/finch" },
  { id: "lv-finix", name: "Finix (Lever)", source_type: "lever", company_handle: "finix", base_url: "https://api.lever.co/v0/postings/finix" },
  { id: "ps-flow", name: "Flow (Personio)", source_type: "personio", company_handle: "flow", base_url: "https://flow.jobs.personio.de/xml" },
  { id: "ab-formance", name: "Formance (Ashby)", source_type: "ashby", company_handle: "formance", base_url: "https://api.ashbyhq.com/posting-api/job-board/formance?includeCompensation=true" },
  { id: "gh-found", name: "Found (Greenhouse)", source_type: "greenhouse", company_handle: "found", base_url: "https://boards-api.greenhouse.io/v1/boards/found/jobs" },
  { id: "ab-fyxer", name: "Fyxer (Ashby)", source_type: "ashby", company_handle: "fyxer", base_url: "https://api.ashbyhq.com/posting-api/job-board/fyxer?includeCompensation=true" },
  { id: "ab-gitbook", name: "GitBook (Ashby)", source_type: "ashby", company_handle: "gitbook", base_url: "https://api.ashbyhq.com/posting-api/job-board/gitbook?includeCompensation=true" },
  { id: "gh-glide", name: "Glide (Greenhouse)", source_type: "greenhouse", company_handle: "glide", base_url: "https://boards-api.greenhouse.io/v1/boards/glide/jobs" },
  { id: "ps-glyphic", name: "Glyphic (Personio)", source_type: "personio", company_handle: "glyphic", base_url: "https://glyphic.jobs.personio.de/xml" },
  { id: "ab-greptile", name: "Greptile (Ashby)", source_type: "ashby", company_handle: "greptile", base_url: "https://api.ashbyhq.com/posting-api/job-board/greptile?includeCompensation=true" },
  { id: "ab-griffin", name: "Griffin (Ashby)", source_type: "ashby", company_handle: "griffin", base_url: "https://api.ashbyhq.com/posting-api/job-board/griffin?includeCompensation=true" },
  { id: "gh-grin", name: "Grin (Greenhouse)", source_type: "greenhouse", company_handle: "grin", base_url: "https://boards-api.greenhouse.io/v1/boards/grin/jobs" },
  { id: "ab-gumloop", name: "Gumloop (Ashby)", source_type: "ashby", company_handle: "gumloop", base_url: "https://api.ashbyhq.com/posting-api/job-board/gumloop?includeCompensation=true" },
  { id: "ab-hanover-park", name: "Hanover Park (Ashby)", source_type: "ashby", company_handle: "hanover-park", base_url: "https://api.ashbyhq.com/posting-api/job-board/hanover-park?includeCompensation=true" },
  { id: "gh-hook", name: "Hook (Greenhouse)", source_type: "greenhouse", company_handle: "hook", base_url: "https://boards-api.greenhouse.io/v1/boards/hook/jobs" },
  { id: "gh-imbue", name: "Imbue (Greenhouse)", source_type: "greenhouse", company_handle: "imbue", base_url: "https://boards-api.greenhouse.io/v1/boards/imbue/jobs" },
  { id: "ab-incident", name: "incident.io (Ashby)", source_type: "ashby", company_handle: "incident", base_url: "https://api.ashbyhq.com/posting-api/job-board/incident?includeCompensation=true" },
  { id: "ab-inference", name: "Inference (Ashby)", source_type: "ashby", company_handle: "inference", base_url: "https://api.ashbyhq.com/posting-api/job-board/inference?includeCompensation=true" },
  { id: "ab-infinite-machine", name: "Infinite Machine (Ashby)", source_type: "ashby", company_handle: "infinite-machine", base_url: "https://api.ashbyhq.com/posting-api/job-board/infinite-machine?includeCompensation=true" },
  { id: "ab-infisical", name: "Infisical (Ashby)", source_type: "ashby", company_handle: "infisical", base_url: "https://api.ashbyhq.com/posting-api/job-board/infisical?includeCompensation=true" },
  { id: "ab-inngest", name: "Inngest (Ashby)", source_type: "ashby", company_handle: "inngest", base_url: "https://api.ashbyhq.com/posting-api/job-board/inngest?includeCompensation=true" },
  { id: "ab-julius", name: "Julius (Ashby)", source_type: "ashby", company_handle: "julius", base_url: "https://api.ashbyhq.com/posting-api/job-board/julius?includeCompensation=true" },
  { id: "ab-juro", name: "Juro (Ashby)", source_type: "ashby", company_handle: "juro", base_url: "https://api.ashbyhq.com/posting-api/job-board/juro?includeCompensation=true" },
  { id: "ab-keep", name: "Keep (Ashby)", source_type: "ashby", company_handle: "keep", base_url: "https://api.ashbyhq.com/posting-api/job-board/keep?includeCompensation=true" },
  { id: "ab-kernel", name: "Kernel (Ashby)", source_type: "ashby", company_handle: "kernel", base_url: "https://api.ashbyhq.com/posting-api/job-board/kernel?includeCompensation=true" },
  { id: "ab-kingdom", name: "Kingdom Supercultures (Ashby)", source_type: "ashby", company_handle: "kingdom", base_url: "https://api.ashbyhq.com/posting-api/job-board/kingdom?includeCompensation=true" },
  { id: "sr-kula", name: "Kula (SmartRecruiters)", source_type: "smartrecruiters", company_handle: "Kula", base_url: "https://api.smartrecruiters.com/v1/companies/Kula/postings" },
  { id: "ab-layer", name: "Layer (Ashby)", source_type: "ashby", company_handle: "layer", base_url: "https://api.ashbyhq.com/posting-api/job-board/layer?includeCompensation=true" },
  { id: "ab-lemfi", name: "LemFi (Ashby)", source_type: "ashby", company_handle: "lemfi", base_url: "https://api.ashbyhq.com/posting-api/job-board/lemfi?includeCompensation=true" },
  { id: "ab-light", name: "Light (Ashby)", source_type: "ashby", company_handle: "light", base_url: "https://api.ashbyhq.com/posting-api/job-board/light?includeCompensation=true" },
  { id: "ab-lightfield", name: "Lightfield (Ashby)", source_type: "ashby", company_handle: "lightfield", base_url: "https://api.ashbyhq.com/posting-api/job-board/lightfield?includeCompensation=true" },
  { id: "ab-lightsource", name: "Lightsource (Ashby)", source_type: "ashby", company_handle: "lightsource", base_url: "https://api.ashbyhq.com/posting-api/job-board/lightsource?includeCompensation=true" },
  { id: "gh-lightship", name: "Lightship (Greenhouse)", source_type: "greenhouse", company_handle: "lightship", base_url: "https://boards-api.greenhouse.io/v1/boards/lightship/jobs" },
  { id: "ab-lumana", name: "Lumana (Ashby)", source_type: "ashby", company_handle: "lumana", base_url: "https://api.ashbyhq.com/posting-api/job-board/lumana?includeCompensation=true" },
  { id: "gh-lumos", name: "Lumos (Greenhouse)", source_type: "greenhouse", company_handle: "lumos", base_url: "https://boards-api.greenhouse.io/v1/boards/lumos/jobs" },
  { id: "ab-macroscope", name: "Macroscope (Ashby)", source_type: "ashby", company_handle: "macroscope", base_url: "https://api.ashbyhq.com/posting-api/job-board/macroscope?includeCompensation=true" },
  { id: "ab-mainstay", name: "Mainstay (Ashby)", source_type: "ashby", company_handle: "mainstay", base_url: "https://api.ashbyhq.com/posting-api/job-board/mainstay?includeCompensation=true" },
  { id: "gh-manifest", name: "Manifest (Greenhouse)", source_type: "greenhouse", company_handle: "manifest", base_url: "https://boards-api.greenhouse.io/v1/boards/manifest/jobs" },
  { id: "ab-metaview", name: "Metaview (Ashby)", source_type: "ashby", company_handle: "metaview", base_url: "https://api.ashbyhq.com/posting-api/job-board/metaview?includeCompensation=true" },
  { id: "ab-meter", name: "Meter (Ashby)", source_type: "ashby", company_handle: "meter", base_url: "https://api.ashbyhq.com/posting-api/job-board/meter?includeCompensation=true" },
  { id: "gh-metronome", name: "Metronome (Acquired by Stripe) (Greenhouse)", source_type: "greenhouse", company_handle: "metronome", base_url: "https://boards-api.greenhouse.io/v1/boards/metronome/jobs" },
  { id: "ab-middesk", name: "Middesk (Ashby)", source_type: "ashby", company_handle: "middesk", base_url: "https://api.ashbyhq.com/posting-api/job-board/middesk?includeCompensation=true" },
  { id: "ab-mine", name: "Mine (Ashby)", source_type: "ashby", company_handle: "mine", base_url: "https://api.ashbyhq.com/posting-api/job-board/mine?includeCompensation=true" },
  { id: "ab-miso", name: "Miso (Ashby)", source_type: "ashby", company_handle: "miso", base_url: "https://api.ashbyhq.com/posting-api/job-board/miso?includeCompensation=true" },
  { id: "ab-modal", name: "Modal (Ashby)", source_type: "ashby", company_handle: "modal", base_url: "https://api.ashbyhq.com/posting-api/job-board/modal?includeCompensation=true" },
  { id: "ab-mollie", name: "Mollie (Ashby)", source_type: "ashby", company_handle: "mollie", base_url: "https://api.ashbyhq.com/posting-api/job-board/mollie?includeCompensation=true" },
  { id: "gh-momentic", name: "Momentic (Greenhouse)", source_type: "greenhouse", company_handle: "momentic", base_url: "https://boards-api.greenhouse.io/v1/boards/momentic/jobs" },
  { id: "ab-mosey", name: "Mosey (Ashby)", source_type: "ashby", company_handle: "mosey", base_url: "https://api.ashbyhq.com/posting-api/job-board/mosey?includeCompensation=true" },
  { id: "ab-motherduck", name: "MotherDuck (Ashby)", source_type: "ashby", company_handle: "motherduck", base_url: "https://api.ashbyhq.com/posting-api/job-board/motherduck?includeCompensation=true" },
  { id: "ab-nationgraph", name: "NationGraph (Ashby)", source_type: "ashby", company_handle: "nationgraph", base_url: "https://api.ashbyhq.com/posting-api/job-board/nationgraph?includeCompensation=true" },
  { id: "sr-navattic", name: "Navattic (SmartRecruiters)", source_type: "smartrecruiters", company_handle: "Navattic", base_url: "https://api.smartrecruiters.com/v1/companies/Navattic/postings" },
  { id: "lv-neon", name: "Neon (Lever)", source_type: "lever", company_handle: "neon", base_url: "https://api.lever.co/v0/postings/neon" },
  { id: "ab-nevis", name: "Nevis (Ashby)", source_type: "ashby", company_handle: "nevis", base_url: "https://api.ashbyhq.com/posting-api/job-board/nevis?includeCompensation=true" },
  { id: "gh-nooks", name: "Nooks (Greenhouse)", source_type: "greenhouse", company_handle: "nooks", base_url: "https://boards-api.greenhouse.io/v1/boards/nooks/jobs" },
  { id: "ab-nox-metals", name: "Nox Metals (Ashby)", source_type: "ashby", company_handle: "nox-metals", base_url: "https://api.ashbyhq.com/posting-api/job-board/nox-metals?includeCompensation=true" },
  { id: "rc-nuvo", name: "Nuvo (Recruitee)", source_type: "recruitee", company_handle: "nuvo", base_url: "https://nuvo.recruitee.com/api/offers" },
  { id: "ab-obvious", name: "Obvious (fka Flatfile) (Ashby)", source_type: "ashby", company_handle: "obvious", base_url: "https://api.ashbyhq.com/posting-api/job-board/obvious?includeCompensation=true" },
  { id: "ab-offdeal", name: "OffDeal (Ashby)", source_type: "ashby", company_handle: "offdeal", base_url: "https://api.ashbyhq.com/posting-api/job-board/offdeal?includeCompensation=true" },
  { id: "gh-olipop", name: "Olipop (Greenhouse)", source_type: "greenhouse", company_handle: "olipop", base_url: "https://boards-api.greenhouse.io/v1/boards/olipop/jobs" },
  { id: "ab-onyx", name: "Onyx (Ashby)", source_type: "ashby", company_handle: "onyx", base_url: "https://api.ashbyhq.com/posting-api/job-board/onyx?includeCompensation=true" },
  { id: "ab-orb", name: "Orb (Ashby)", source_type: "ashby", company_handle: "orb", base_url: "https://api.ashbyhq.com/posting-api/job-board/orb?includeCompensation=true" },
  { id: "gh-orchard", name: "Orchard (Greenhouse)", source_type: "greenhouse", company_handle: "orchard", base_url: "https://boards-api.greenhouse.io/v1/boards/orchard/jobs" },
  { id: "ab-orum", name: "Orum (Ashby)", source_type: "ashby", company_handle: "orum", base_url: "https://api.ashbyhq.com/posting-api/job-board/orum?includeCompensation=true" },
  { id: "sr-partly", name: "Partly (SmartRecruiters)", source_type: "smartrecruiters", company_handle: "Partly", base_url: "https://api.smartrecruiters.com/v1/companies/Partly/postings" },
  { id: "gh-partnerstack", name: "PartnerStack (Greenhouse)", source_type: "greenhouse", company_handle: "partnerstack", base_url: "https://boards-api.greenhouse.io/v1/boards/partnerstack/jobs" },
  { id: "gh-patch", name: "Patch (Greenhouse)", source_type: "greenhouse", company_handle: "patch", base_url: "https://boards-api.greenhouse.io/v1/boards/patch/jobs" },
  { id: "ab-phantom", name: "Phantom (Ashby)", source_type: "ashby", company_handle: "phantom", base_url: "https://api.ashbyhq.com/posting-api/job-board/phantom?includeCompensation=true" },
  { id: "sr-pinwheel", name: "Pin (SmartRecruiters)", source_type: "smartrecruiters", company_handle: "Pinwheel", base_url: "https://api.smartrecruiters.com/v1/companies/Pinwheel/postings" },
  { id: "ab-pivot", name: "Pivot (Ashby)", source_type: "ashby", company_handle: "pivot", base_url: "https://api.ashbyhq.com/posting-api/job-board/pivot?includeCompensation=true" },
  { id: "lv-planned", name: "Planned (Lever)", source_type: "lever", company_handle: "planned", base_url: "https://api.lever.co/v0/postings/planned" },
  { id: "rc-polars", name: "Polars (Recruitee)", source_type: "recruitee", company_handle: "polars", base_url: "https://polars.recruitee.com/api/offers" },
  { id: "ab-polar", name: "Polar (Ashby)", source_type: "ashby", company_handle: "polar", base_url: "https://api.ashbyhq.com/posting-api/job-board/polar?includeCompensation=true" },
  { id: "ab-posthog", name: "PostHog (Ashby)", source_type: "ashby", company_handle: "posthog", base_url: "https://api.ashbyhq.com/posting-api/job-board/posthog?includeCompensation=true" },
  { id: "ab-prefect", name: "Prefect (Ashby)", source_type: "ashby", company_handle: "prefect", base_url: "https://api.ashbyhq.com/posting-api/job-board/prefect?includeCompensation=true" },
  { id: "lv-prismic", name: "Prismic (Lever)", source_type: "lever", company_handle: "prismic", base_url: "https://api.lever.co/v0/postings/prismic" },
  { id: "ab-proofofplay", name: "Proof of Play (Ashby)", source_type: "ashby", company_handle: "proofofplay", base_url: "https://api.ashbyhq.com/posting-api/job-board/proofofplay?includeCompensation=true" },
  { id: "gh-pulse", name: "Pulse (Greenhouse)", source_type: "greenhouse", company_handle: "pulse", base_url: "https://boards-api.greenhouse.io/v1/boards/pulse/jobs" },
  { id: "ab-pylon", name: "Pylon (Ashby)", source_type: "ashby", company_handle: "pylon", base_url: "https://api.ashbyhq.com/posting-api/job-board/pylon?includeCompensation=true" },
  { id: "ab-quanta", name: "Quanta (Ashby)", source_type: "ashby", company_handle: "quanta", base_url: "https://api.ashbyhq.com/posting-api/job-board/quanta?includeCompensation=true" },
  { id: "gh-quilt", name: "Quilt (Greenhouse)", source_type: "greenhouse", company_handle: "quilt", base_url: "https://boards-api.greenhouse.io/v1/boards/quilt/jobs" },
  { id: "gh-qualifiedhealth", name: "Qualified Health (Greenhouse)", source_type: "greenhouse", company_handle: "qualifiedhealth", base_url: "https://boards-api.greenhouse.io/v1/boards/qualifiedhealth/jobs" },
  { id: "ab-quilter", name: "Quilter (Ashby)", source_type: "ashby", company_handle: "quilter", base_url: "https://api.ashbyhq.com/posting-api/job-board/quilter?includeCompensation=true" },
  { id: "ab-raindrop", name: "Raindrop (Ashby)", source_type: "ashby", company_handle: "raindrop", base_url: "https://api.ashbyhq.com/posting-api/job-board/raindrop?includeCompensation=true" },
  { id: "lv-ranger", name: "Ranger (Lever)", source_type: "lever", company_handle: "ranger", base_url: "https://api.lever.co/v0/postings/ranger" },
  { id: "ab-ravenna", name: "Ravenna (Ashby)", source_type: "ashby", company_handle: "ravenna", base_url: "https://api.ashbyhq.com/posting-api/job-board/ravenna?includeCompensation=true" },
  { id: "ab-raycast", name: "Raycast (Ashby)", source_type: "ashby", company_handle: "raycast", base_url: "https://api.ashbyhq.com/posting-api/job-board/raycast?includeCompensation=true" },
  { id: "ab-render", name: "Render (Ashby)", source_type: "ashby", company_handle: "render", base_url: "https://api.ashbyhq.com/posting-api/job-board/render?includeCompensation=true" },
  { id: "lv-remofirst", name: "RemoFirst (Lever)", source_type: "lever", company_handle: "remofirst", base_url: "https://api.lever.co/v0/postings/remofirst" },
  { id: "ab-resend", name: "Resend (Ashby)", source_type: "ashby", company_handle: "resend", base_url: "https://api.ashbyhq.com/posting-api/job-board/resend?includeCompensation=true" },
  { id: "ab-rerun", name: "Rerun (Ashby)", source_type: "ashby", company_handle: "rerun", base_url: "https://api.ashbyhq.com/posting-api/job-board/rerun?includeCompensation=true" },
  { id: "ab-roboflow", name: "Roboflow (Ashby)", source_type: "ashby", company_handle: "roboflow", base_url: "https://api.ashbyhq.com/posting-api/job-board/roboflow?includeCompensation=true" },
  { id: "ab-roam", name: "Roam (Ashby)", source_type: "ashby", company_handle: "roam", base_url: "https://api.ashbyhq.com/posting-api/job-board/roam?includeCompensation=true" },
  { id: "ab-safetykit", name: "SafetyKit (Ashby)", source_type: "ashby", company_handle: "safetykit", base_url: "https://api.ashbyhq.com/posting-api/job-board/safetykit?includeCompensation=true" },
  { id: "ab-salient", name: "Salient (Ashby)", source_type: "ashby", company_handle: "salient", base_url: "https://api.ashbyhq.com/posting-api/job-board/salient?includeCompensation=true" },
  { id: "ab-semgrep", name: "Semgrep (Ashby)", source_type: "ashby", company_handle: "semgrep", base_url: "https://api.ashbyhq.com/posting-api/job-board/semgrep?includeCompensation=true" },
  { id: "ab-seneca", name: "Seneca (Ashby)", source_type: "ashby", company_handle: "seneca", base_url: "https://api.ashbyhq.com/posting-api/job-board/seneca?includeCompensation=true" },
  { id: "ab-sent", name: "Sent (Ashby)", source_type: "ashby", company_handle: "sent", base_url: "https://api.ashbyhq.com/posting-api/job-board/sent?includeCompensation=true" },
  { id: "ab-sentient", name: "Sentient (Ashby)", source_type: "ashby", company_handle: "sentient", base_url: "https://api.ashbyhq.com/posting-api/job-board/sentient?includeCompensation=true" },
  { id: "lv-slate", name: "Slate (Lever)", source_type: "lever", company_handle: "slate", base_url: "https://api.lever.co/v0/postings/slate" },
  { id: "ab-solidroad", name: "Solidroad (Ashby)", source_type: "ashby", company_handle: "solidroad", base_url: "https://api.ashbyhq.com/posting-api/job-board/solidroad?includeCompensation=true" },
  { id: "ab-speakeasy", name: "Speakeasy (Ashby)", source_type: "ashby", company_handle: "speakeasy", base_url: "https://api.ashbyhq.com/posting-api/job-board/speakeasy?includeCompensation=true" },
  { id: "ab-sphere", name: "Sphere (Ashby)", source_type: "ashby", company_handle: "sphere", base_url: "https://api.ashbyhq.com/posting-api/job-board/sphere?includeCompensation=true" },
  { id: "ab-spiral", name: "Spiral (Ashby)", source_type: "ashby", company_handle: "spiral", base_url: "https://api.ashbyhq.com/posting-api/job-board/spiral?includeCompensation=true" },
  { id: "ab-stable", name: "Stable (Ashby)", source_type: "ashby", company_handle: "stable", base_url: "https://api.ashbyhq.com/posting-api/job-board/stable?includeCompensation=true" },
  { id: "gh-stackblitz", name: "StackBlitz (Greenhouse)", source_type: "greenhouse", company_handle: "stackblitz", base_url: "https://boards-api.greenhouse.io/v1/boards/stackblitz/jobs" },
  { id: "ab-stackone", name: "StackOne (Ashby)", source_type: "ashby", company_handle: "stackone", base_url: "https://api.ashbyhq.com/posting-api/job-board/stackone?includeCompensation=true" },
  { id: "ab-starbridge", name: "Starbridge (Ashby)", source_type: "ashby", company_handle: "starbridge", base_url: "https://api.ashbyhq.com/posting-api/job-board/starbridge?includeCompensation=true" },
  { id: "gh-starcloud", name: "Starcloud (Greenhouse)", source_type: "greenhouse", company_handle: "starcloud", base_url: "https://boards-api.greenhouse.io/v1/boards/starcloud/jobs" },
  { id: "ab-succinct", name: "Succinct (Ashby)", source_type: "ashby", company_handle: "succinct", base_url: "https://api.ashbyhq.com/posting-api/job-board/succinct?includeCompensation=true" },
  { id: "ps-superlist", name: "Superlist (Personio)", source_type: "personio", company_handle: "superlist", base_url: "https://superlist.jobs.personio.de/xml" },
  { id: "ab-supabase", name: "Supabase (Ashby)", source_type: "ashby", company_handle: "supabase", base_url: "https://api.ashbyhq.com/posting-api/job-board/supabase?includeCompensation=true" },
  { id: "ab-swan", name: "Swan (Ashby)", source_type: "ashby", company_handle: "swan", base_url: "https://api.ashbyhq.com/posting-api/job-board/swan?includeCompensation=true" },
  { id: "gh-sweetsecurity", name: "Sweet Security (Greenhouse)", source_type: "greenhouse", company_handle: "sweetsecurity", base_url: "https://boards-api.greenhouse.io/v1/boards/sweetsecurity/jobs" },
  { id: "ab-tailor", name: "Tailor (Ashby)", source_type: "ashby", company_handle: "tailor", base_url: "https://api.ashbyhq.com/posting-api/job-board/tailor?includeCompensation=true" },
  { id: "ab-tavily", name: "Tavily (Ashby)", source_type: "ashby", company_handle: "tavily", base_url: "https://api.ashbyhq.com/posting-api/job-board/tavily?includeCompensation=true" },
  { id: "sr-tembo", name: "Tembo (SmartRecruiters)", source_type: "smartrecruiters", company_handle: "Tembo", base_url: "https://api.smartrecruiters.com/v1/companies/Tembo/postings" },
  { id: "ab-tempo", name: "Tempo (Ashby)", source_type: "ashby", company_handle: "tempo", base_url: "https://api.ashbyhq.com/posting-api/job-board/tempo?includeCompensation=true" },
  { id: "ab-tensorwave", name: "TensorWave (Ashby)", source_type: "ashby", company_handle: "tensorwave", base_url: "https://api.ashbyhq.com/posting-api/job-board/tensorwave?includeCompensation=true" },
  { id: "ps-tenz", name: "Tenzai (Personio)", source_type: "personio", company_handle: "tenz", base_url: "https://tenz.jobs.personio.de/xml" },
  { id: "gh-tokensecurity", name: "Token Security (Greenhouse)", source_type: "greenhouse", company_handle: "tokensecurity", base_url: "https://boards-api.greenhouse.io/v1/boards/tokensecurity/jobs" },
  { id: "ab-tracer", name: "Tracer (Ashby)", source_type: "ashby", company_handle: "tracer", base_url: "https://api.ashbyhq.com/posting-api/job-board/tracer?includeCompensation=true" },
  { id: "gh-trufflesecurity", name: "Truffle Security (Greenhouse)", source_type: "greenhouse", company_handle: "trufflesecurity", base_url: "https://boards-api.greenhouse.io/v1/boards/trufflesecurity/jobs" },
  { id: "lv-twodots", name: "Two Dots (Lever)", source_type: "lever", company_handle: "twodots", base_url: "https://api.lever.co/v0/postings/twodots" },
  { id: "lv-unify", name: "Unify (Lever)", source_type: "lever", company_handle: "unify", base_url: "https://api.lever.co/v0/postings/unify" },
  { id: "ab-unlimitedindustries", name: "Unlimited Industries (Ashby)", source_type: "ashby", company_handle: "unlimitedindustries", base_url: "https://api.ashbyhq.com/posting-api/job-board/unlimitedindustries?includeCompensation=true" },
  { id: "ab-unit", name: "Unit (Ashby)", source_type: "ashby", company_handle: "unit", base_url: "https://api.ashbyhq.com/posting-api/job-board/unit?includeCompensation=true" },
  { id: "ab-upflow", name: "Upflow (Ashby)", source_type: "ashby", company_handle: "upflow", base_url: "https://api.ashbyhq.com/posting-api/job-board/upflow?includeCompensation=true" },
  { id: "ab-valon", name: "Valon (Ashby)", source_type: "ashby", company_handle: "valon", base_url: "https://api.ashbyhq.com/posting-api/job-board/valon?includeCompensation=true" },
  { id: "ab-vapi", name: "Vapi (Ashby)", source_type: "ashby", company_handle: "vapi", base_url: "https://api.ashbyhq.com/posting-api/job-board/vapi?includeCompensation=true" },
  { id: "ab-vellum", name: "Vellum (Ashby)", source_type: "ashby", company_handle: "vellum", base_url: "https://api.ashbyhq.com/posting-api/job-board/vellum?includeCompensation=true" },
  { id: "ab-vesta", name: "Vesta (Ashby)", source_type: "ashby", company_handle: "vesta", base_url: "https://api.ashbyhq.com/posting-api/job-board/vesta?includeCompensation=true" },
  { id: "gh-watershed", name: "Watershed (Greenhouse)", source_type: "greenhouse", company_handle: "watershed", base_url: "https://boards-api.greenhouse.io/v1/boards/watershed/jobs" },
  { id: "ab-wispr-flow", name: "Wispr Flow (Ashby)", source_type: "ashby", company_handle: "wispr-flow", base_url: "https://api.ashbyhq.com/posting-api/job-board/wispr-flow?includeCompensation=true" },
  { id: "ab-wonderful", name: "Wonderful (Ashby)", source_type: "ashby", company_handle: "wonderful", base_url: "https://api.ashbyhq.com/posting-api/job-board/wonderful?includeCompensation=true" },
  { id: "ab-workos", name: "WorkOS (Ashby)", source_type: "ashby", company_handle: "workos", base_url: "https://api.ashbyhq.com/posting-api/job-board/workos?includeCompensation=true" },
  { id: "ab-zed", name: "Zed (Ashby)", source_type: "ashby", company_handle: "zed", base_url: "https://api.ashbyhq.com/posting-api/job-board/zed?includeCompensation=true" },
  { id: "gh-zero", name: "Zero (Greenhouse)", source_type: "greenhouse", company_handle: "zero", base_url: "https://boards-api.greenhouse.io/v1/boards/zero/jobs" },

  // ─── Nonprofit / civic / health / climate cohort (batch 4 probe, 2026-03) ───
  // Skipped probe hits: generic GH boards (action, new, community), ambiguous Ashby
  // "change", NYPL/CEL single-job mismatches. HRC uses SaaSHR REST API (sh-hrc).
  { id: "gh-butterfly-network", name: "Butterfly Network (Greenhouse)", source_type: "greenhouse", company_handle: "butterflynetwork", base_url: "https://boards-api.greenhouse.io/v1/boards/butterflynetwork/jobs" },
  { id: "gh-art-of-problem-solving", name: "Art of Problem Solving (Greenhouse)", source_type: "greenhouse", company_handle: "artofproblemsolving", base_url: "https://boards-api.greenhouse.io/v1/boards/artofproblemsolving/jobs" },
  { id: "gh-flyzipline", name: "Zipline (Greenhouse)", source_type: "greenhouse", company_handle: "flyzipline", base_url: "https://boards-api.greenhouse.io/v1/boards/flyzipline/jobs" },
  { id: "gh-kalderos", name: "Kalderos (Greenhouse)", source_type: "greenhouse", company_handle: "kalderos", base_url: "https://boards-api.greenhouse.io/v1/boards/kalderos/jobs" },
  { id: "ab-kaizen-labs", name: "Kaizen Labs (Ashby)", source_type: "ashby", company_handle: "kaizenlabs", base_url: "https://api.ashbyhq.com/posting-api/job-board/kaizenlabs?includeCompensation=true" },
  { id: "gh-flatiron-health", name: "Flatiron Health (Greenhouse)", source_type: "greenhouse", company_handle: "flatironhealth", base_url: "https://boards-api.greenhouse.io/v1/boards/flatironhealth/jobs" },
  { id: "gh-tomorrow-io", name: "Tomorrow.io (Greenhouse)", source_type: "greenhouse", company_handle: "tomorrow", base_url: "https://boards-api.greenhouse.io/v1/boards/tomorrow/jobs" },
  { id: "gh-nexamp", name: "Nexamp (Greenhouse)", source_type: "greenhouse", company_handle: "nexamp", base_url: "https://boards-api.greenhouse.io/v1/boards/nexamp/jobs" },
  { id: "lv-center-for-ai-safety", name: "Center for AI Safety (Lever)", source_type: "lever", company_handle: "aisafety", base_url: "https://api.lever.co/v0/postings/aisafety" },
  { id: "rc-bme-strategies", name: "BME Strategies (Recruitee)", source_type: "recruitee", company_handle: "bme", base_url: "https://bme.recruitee.com/api/offers" },
  { id: "gh-underdogfantasy", name: "Underdog (Greenhouse)", source_type: "greenhouse", company_handle: "underdogfantasy", base_url: "https://boards-api.greenhouse.io/v1/boards/underdogfantasy/jobs" },
  { id: "gh-understood", name: "Understood (Greenhouse)", source_type: "greenhouse", company_handle: "understood", base_url: "https://boards-api.greenhouse.io/v1/boards/understood/jobs" },
  { id: "rc-protect-democracy", name: "Protect Democracy (Recruitee)", source_type: "recruitee", company_handle: "protectdemocracy", base_url: "https://protectdemocracy.recruitee.com/api/offers" },
  { id: "rc-grow-progress", name: "Grow Progress (Recruitee)", source_type: "recruitee", company_handle: "growprogress", base_url: "https://growprogress.recruitee.com/api/offers" },
  { id: "gh-energyhub", name: "EnergyHub (Greenhouse)", source_type: "greenhouse", company_handle: "energyhub", base_url: "https://boards-api.greenhouse.io/v1/boards/energyhub/jobs" },
  { id: "gh-guild", name: "Guild (Greenhouse)", source_type: "greenhouse", company_handle: "guild", base_url: "https://boards-api.greenhouse.io/v1/boards/guild/jobs" },
  { id: "sh-hrc", name: "Human Rights Campaign (SaaSHR)", source_type: "saashr", company_handle: "hrc", base_url: "https://secure6.saashr.com/ta/6170001.careers?CareersSearch=&lang=en-US" },
  // Full a16z portfolio via Consider (~15k jobs). Do not add per-company consider sources
  // for the same board — equal source priority would insert duplicate job rows.
  { id: "cn-a16z-portfolio", name: "a16z portfolio (Consider)", source_type: "consider", company_handle: "a16z-portfolio", base_url: "https://jobs.a16z.com/companies" }, // fetch_interval_hours=12 — see FETCH_INTERVALS below

  // ─── Sector job boards (RSS) ─────────────────────────────────────────────
  // Higher education — HigherEdJobs has public RSS feeds per category
  // Format: https://www.higheredjobs.com/rss/categoryFeed.cfm?catID={id}
  // Note: HigherEdJobs may use Incapsula; if fetches fail, try from Workers.
  { id: "rss-he-main",     name: "HigherEdJobs (Higher Education)", source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=68" },
  { id: "rss-he-faculty",  name: "HigherEdJobs (Faculty)",          source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=26" },
  { id: "rss-he-admin",    name: "HigherEdJobs (Administrative)",   source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=24" },
  { id: "rss-he-it",       name: "HigherEdJobs (IT)",               source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=160" },
  // SAP SuccessFactors career site — `sitemap.xml` is a Google Jobs RSS with `g:location`, `g:id`, `g:employer`.
  { id: "rss-foundever",   name: "Foundever (RSS)",                 source_type: "rss", company_handle: "foundever",    base_url: "https://jobs.foundever.com/sitemap.xml" },

  // ─── Sector job boards — roadmap ────────────────────────────────────────
  // These boards have no public API or RSS. Custom fetchers would require
  // browser scraping or reverse-engineering their internal APIs.
  // Healthcare: Vivian Health, Health eCareers, PracticeLink (physicians)
  // K–12: EDJOIN, SchoolSpring
  // Higher ed: Chronicle Jobs (no public RSS; email alerts only)
  // { id: "vivian",        name: "Vivian Health",           source_type: "browser", company_handle: "vivian",        base_url: "https://www.vivian.com/jobs" },
  // { id: "healthecareers",name: "Health eCareers",         source_type: "browser", company_handle: "healthecareers",base_url: "https://www.healthecareers.com/jobs" },
  // { id: "practicelink",  name: "PracticeLink (Physicians)",source_type: "browser",company_handle: "practicelink", base_url: "https://jobs.practicelink.com/jobs/physician/" },
  // { id: "edjoin",        name: "EDJOIN (K–12)",          source_type: "browser", company_handle: "edjoin",        base_url: "https://www.edjoin.org/Home/Jobs" },
  // { id: "schoolspring",  name: "SchoolSpring (K–12)",    source_type: "browser", company_handle: "schoolspring",  base_url: "https://www.schoolspring.com/jobs/" },
  // { id: "chronicle",     name: "Chronicle Jobs",         source_type: "browser", company_handle: "chronicle",     base_url: "https://jobs.chronicle.com/jobs/" },

  // ─── Browser fallback ─────────────────────────────────────────────────────
  // Cloudflare Browser Rendering — for career pages with no public ATS API.
  // Budget: ~10 min CPU/day → keep to ≤30 sources at one 24 h crawl cycle.
  // br-clay disabled — clay.earth DOM scrape listed nav as jobs. That product is now Mesh (https://me.sh/); GTM Clay stays on ab-claylabs (clay.com).
  // { id: "br-hex",         name: "Hex (Browser)",            source_type: "browser", company_handle: "hex",         base_url: "https://hex.tech/careers" }, // gh-hextechnologies
  // { id: "br-augment",     name: "Augment Code (Browser)",   source_type: "browser", company_handle: "augmentcode", base_url: "https://www.augmentcode.com/careers" }, // gh-augmentcomputing
  { id: "br-hilton",      name: "Hilton (Browser)",          source_type: "browser", company_handle: "hilton",          base_url: "https://jobs.hilton.com/us/en/search-jobs" },
  { id: "br-fedex",       name: "FedEx (Browser)",           source_type: "browser", company_handle: "fedex",           base_url: "https://careers.fedex.com/jobs" },
  { id: "br-starbucks",   name: "Starbucks (Browser)",       source_type: "browser", company_handle: "starbucks",       base_url: "https://careers.starbucks.com/jobs" },
  { id: "br-marriott",    name: "Marriott (Browser)",        source_type: "browser", company_handle: "marriott",        base_url: "https://careers.marriott.com/jobs" },
  { id: "br-lululemon",   name: "Lululemon (Browser)",       source_type: "browser", company_handle: "lululemon",       base_url: "https://careers.lululemon.com/en_US/careers" },
  { id: "br-pepsico",     name: "PepsiCo (Browser)",         source_type: "browser", company_handle: "pepsico",         base_url: "https://www.pepsicojobs.com/main/jobs" },
  { id: "br-jpmorgan",    name: "JPMorgan Chase (Browser)",  source_type: "browser", company_handle: "jpmorgan",        base_url: "https://careers.jpmorgan.com/us/en/jobs" },
  // Supersedes br-jpmorgan — Oracle CE public REST (see oracle_ce.ts); site from Candidate Experience URL
  { id: "oc-jpmorgan",    name: "JPMorgan Chase (Oracle CE)", source_type: "oracle_ce", company_handle: "jpmorgan",   base_url: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001" },
  { id: "br-bofa",        name: "Bank of America (Browser)", source_type: "browser", company_handle: "bankofamerica",   base_url: "https://careers.bankofamerica.com/en-us/job-search" },
  { id: "br-morganstanley",name:"Morgan Stanley (Browser)",  source_type: "browser", company_handle: "morganstanley",   base_url: "https://jobs.morganstanley.com/search" },
  { id: "br-volvogroup",  name: "Volvo Group (Browser)",     source_type: "browser", company_handle: "volvogroup",      base_url: "https://jobs.volvogroup.com/" },
  { id: "br-microsoft",   name: "Microsoft (Browser)",       source_type: "browser", company_handle: "microsoft",       base_url: "https://apply.careers.microsoft.com/careers" },
  { id: "br-google",      name: "Google (Browser)",          source_type: "browser", company_handle: "google",          base_url: "https://careers.google.com/jobs/results" },
  { id: "mc-meta", name: "Meta (Metacareers)", source_type: "metacareers", company_handle: "meta", base_url: "https://www.metacareers.com/jobsearch/sitemap.xml" },
  { id: "br-ibm",         name: "IBM (Browser)",             source_type: "browser", company_handle: "ibm",             base_url: "https://www.ibm.com/careers/search" },
  { id: "br-oracle",      name: "Oracle (Browser)",          source_type: "browser", company_handle: "oracle",          base_url: "https://careers.oracle.com/jobs" },
  { id: "br-bestbuy",     name: "Best Buy (Browser)",        source_type: "browser", company_handle: "bestbuy",         base_url: "https://jobs.bestbuy.com/bby/jobs" },
  { id: "br-kroger",      name: "Kroger (Browser)",          source_type: "browser", company_handle: "kroger",          base_url: "https://jobs.kroger.com/jobs" },
  { id: "br-costco",      name: "Costco (Browser)",          source_type: "browser", company_handle: "costco",          base_url: "https://www.costco.com/jobs.html" },
  { id: "br-albertsons",  name: "Albertsons (Browser)",      source_type: "browser", company_handle: "albertsons",      base_url: "https://jobs.albertsons.com/search-jobs" },
  { id: "br-walgreens",   name: "Walgreens (Browser)",       source_type: "browser", company_handle: "walgreens",       base_url: "https://jobs.walgreens.com/en/search-jobs" },
  { id: "br-shopify",     name: "Shopify (Browser)",         source_type: "browser", company_handle: "shopify",         base_url: "https://www.shopify.com/careers" },
  { id: "br-chewy",       name: "Chewy (Browser)",           source_type: "browser", company_handle: "chewy",           base_url: "https://careers.chewy.com/us/en/search-results" },
  { id: "br-delta",       name: "Delta Air Lines (Browser)",  source_type: "browser", company_handle: "delta",           base_url: "https://jobs.delta.com/search-jobs" },
  { id: "br-united",      name: "United Airlines (Browser)",  source_type: "browser", company_handle: "unitedairlines",  base_url: "https://careers.united.com/us/en/search-results" },
  { id: "br-amex",        name: "American Express (Browser)", source_type: "browser", company_handle: "amex",            base_url: "https://aexp.com/us/en/careers/job-search.html" },
  { id: "br-goldmansachs",name: "Goldman Sachs (Browser)",    source_type: "browser", company_handle: "goldmansachs",    base_url: "https://higher.gs.com/roles" },
  { id: "br-progressive", name: "Progressive (Browser)",      source_type: "browser", company_handle: "progressive",     base_url: "https://progressive.com/careers/search" },
  { id: "br-adp",         name: "ADP (Browser)",              source_type: "browser", company_handle: "adp",             base_url: "https://careers.adp.com/job-search-results" },
  { id: "br-qualcomm",    name: "Qualcomm (Browser)",         source_type: "browser", company_handle: "qualcomm",        base_url: "https://careers.qualcomm.com/careers/search" },
  { id: "br-hp",          name: "HP Inc (Browser)",           source_type: "browser", company_handle: "hp",              base_url: "https://jobs.hp.com/search-jobs" },

  // ─── Browser roadmap ───────────────────────────────────────────────────────
  // These companies use proprietary job boards with no public API. Browser
  // scraping is possible using Cloudflare crawl but currently too expensive to run at scale.
  // Adding them is on the product roadmap once rendering capacity increases.
  // { id: "br-gitguardian", name: "GitGuardian (Browser)",    source_type: "browser", company_handle: "gitguardian", base_url: "https://careers.gitguardian.com/jobs" },
  // { id: "br-ada",         name: "Ada (Browser)",            source_type: "browser", company_handle: "ada",         base_url: "https://www.ada.cx/careers" },
  // { id: "br-hippocratic", name: "Hippocratic AI (Browser)", source_type: "browser", company_handle: "hippocratic", base_url: "https://www.hippocraticai.com/careers" },
  // { id: "br-ford",        name: "Ford (Browser)",            source_type: "browser", company_handle: "ford",            base_url: "https://www.careers.ford.com/en/search-results" },
  // { id: "br-aa",          name: "American Airlines (Browser)",source_type: "browser", company_handle: "americanairlines",base_url: "https://jobs.aa.com" },
  // { id: "br-hyatt",       name: "Hyatt (Browser)",           source_type: "browser", company_handle: "hyatt",           base_url: "https://careers.hyatt.com/jobs" },
  // { id: "br-nordstrom",   name: "Nordstrom (Browser)",       source_type: "browser", company_handle: "nordstrom",       base_url: "https://careers.nordstrom.com/jobs" },
  // { id: "br-lowes",       name: "Lowe's (Browser)",          source_type: "browser", company_handle: "lowes",           base_url: "https://talent.lowes.com/us/en" },
  // { id: "br-macys",       name: "Macy's (Browser)",          source_type: "browser", company_handle: "macys",           base_url: "https://jobs.macys.com/search-jobs" },
  // { id: "br-rossstores",  name: "Ross Stores (Browser)",     source_type: "browser", company_handle: "rossstores",      base_url: "https://jobs.rossstores.com/search-jobs" },
  // { id: "br-dollargeneral",name:"Dollar General (Browser)",  source_type: "browser", company_handle: "dollargeneral",   base_url: "https://careers.dollargeneral.com/jobs" },
  // { id: "br-gxo",         name: "GXO Logistics (Browser)",    source_type: "browser", company_handle: "gxo",             base_url: "https://www.gxo.com/careers/job-search" },
  // { id: "br-merck",       name: "Merck (Browser)",            source_type: "browser", company_handle: "merck",           base_url: "https://jobs.merck.com/us/en/search-results" },
  // { id: "br-bd",          name: "Becton Dickinson (Browser)", source_type: "browser", company_handle: "bd",              base_url: "https://jobs.bd.com/search-jobs" },
  // { id: "br-gehealthcare",name: "GE HealthCare (Browser)",    source_type: "browser", company_handle: "gehealthcare",    base_url: "https://careers.gehealthcare.com/global/en/search-results" },
  // { id: "br-mckesson",    name: "McKesson (Browser)",         source_type: "browser", company_handle: "mckesson",        base_url: "https://careers.mckesson.com/en/search-jobs" },
  // { id: "br-cardinalhealth",name:"Cardinal Health (Browser)", source_type: "browser", company_handle: "cardinalhealth",  base_url: "https://jobs.cardinalhealth.com/search-jobs" },
  // { id: "br-questdiag",   name: "Quest Diagnostics (Browser)",source_type: "browser", company_handle: "questdiagnostics",base_url: "https://careers.questdiagnostics.com/search-jobs" },
  // { id: "br-hca",         name: "HCA Healthcare (Browser)",   source_type: "browser", company_handle: "hca",             base_url: "https://careers.hcahealthcare.com/jobs/search-jobs" },
  // { id: "br-tenet",       name: "Tenet Healthcare (Browser)", source_type: "browser", company_handle: "tenet",           base_url: "https://jobs.tenethealth.com/search-jobs" },
  // { id: "br-bnymellon",   name: "BNY Mellon (Browser)",       source_type: "browser", company_handle: "bnymellon",       base_url: "https://bnymellon.eightfold.ai/careers" },
  // { id: "br-spglobal",    name: "S&P Global (Browser)",       source_type: "browser", company_handle: "spglobal",        base_url: "https://careers.spglobal.com/jobs" },
  // { id: "br-marshmclennan",name:"Marsh McLennan (Browser)",   source_type: "browser", company_handle: "marshmclennan",   base_url: "https://careers.marshmclennan.com/global/en/search-results" },
  // { id: "br-exxonmobil",  name: "ExxonMobil (Browser)",       source_type: "browser", company_handle: "exxonmobil",      base_url: "https://jobs.exxonmobil.com/ExxonMobil/go/All-ExxonMobil-Jobs" },
  // { id: "br-halliburton", name: "Halliburton (Browser)",      source_type: "browser", company_handle: "halliburton",     base_url: "https://careers.halliburton.com/search-jobs" },
  // { id: "br-slb",         name: "SLB (Browser)",              source_type: "browser", company_handle: "slb",             base_url: "https://careers.slb.com/careers/JobSearch" },
  // { id: "br-honeywell",   name: "Honeywell (Browser)",        source_type: "browser", company_handle: "honeywell",       base_url: "https://careers.honeywell.com/us/en/search-results" },
  // { id: "br-sherwin",     name: "Sherwin-Williams (Browser)", source_type: "browser", company_handle: "sherwinwilliams", base_url: "https://jobs.sherwin-williams.com/search-jobs" },
  // { id: "br-cummins",     name: "Cummins (Browser)",          source_type: "browser", company_handle: "cummins",         base_url: "https://cummins.jobs/search-jobs" },
  // { id: "br-parker",      name: "Parker Hannifin (Browser)",  source_type: "browser", company_handle: "parkerhannifin",  base_url: "https://careers.parker.com/search-jobs" },
  // { id: "br-whirlpool",   name: "Whirlpool (Browser)",        source_type: "browser", company_handle: "whirlpool",       base_url: "https://careers.whirlpool.com/search-jobs" },
  // { id: "br-corning",     name: "Corning (Browser)",          source_type: "browser", company_handle: "corning",         base_url: "https://careers.corning.com/search-jobs" },
  // { id: "br-gevernova",   name: "GE Vernova (Browser)",       source_type: "browser", company_handle: "gevernova",       base_url: "https://jobs.gevernova.com/search-jobs" },
  // { id: "br-lear",        name: "Lear Corp (Browser)",        source_type: "browser", company_handle: "lear",            base_url: "https://careers.lear.com/search-jobs" },
  // { id: "br-amphenol",    name: "Amphenol (Browser)",         source_type: "browser", company_handle: "amphenol",        base_url: "https://careers.amphenol.com/search-jobs" },
  // { id: "br-adm",         name: "ADM (Browser)",              source_type: "browser", company_handle: "adm",             base_url: "https://careers.adm.com/search-jobs" },
  // { id: "br-intlpaper",   name: "International Paper (Browser)",source_type: "browser", company_handle: "internationalpaper", base_url: "https://jobs.internationalpaper.com/search-jobs" },
  // { id: "br-mohawk",      name: "Mohawk Industries (Browser)",source_type: "browser", company_handle: "mohawkindustries",base_url: "https://careers.mohawkind.com/search-jobs" },
  // { id: "br-sbd",         name: "Stanley Black & Decker (Browser)",source_type: "browser", company_handle: "stanleyblackanddecker",base_url: "https://sbdinc.com/careers" },
  // { id: "br-cbre",        name: "CBRE (Browser)",             source_type: "browser", company_handle: "cbre",            base_url: "https://careers.cbre.com/en_US/careers/SearchJobs" },
  // { id: "br-cushman",     name: "Cushman Wakefield (Browser)",source_type: "browser", company_handle: "cushmanwakefield",base_url: "https://careers.cushmanwakefield.com/search-jobs" },
  // { id: "br-jacobs",      name: "Jacobs (Browser)",           source_type: "browser", company_handle: "jacobs",          base_url: "https://careers.jacobs.com/search-jobs" },
  // { id: "br-aecom",       name: "AECOM (Browser)",            source_type: "browser", company_handle: "aecom",           base_url: "https://aecom.jobs/search-jobs" },
  // { id: "br-wm",          name: "Waste Management (Browser)", source_type: "browser", company_handle: "wm",              base_url: "https://jobs.wm.com/search-jobs" },
  // { id: "br-cintas",      name: "Cintas (Browser)",           source_type: "browser", company_handle: "cintas",          base_url: "https://careers.cintas.com/search-jobs" },
  // { id: "br-maximus",     name: "Maximus (Browser)",          source_type: "browser", company_handle: "maximus",         base_url: "https://maximus.com/careers/search-jobs" },
  // { id: "br-abm",         name: "ABM Industries (Browser)",   source_type: "browser", company_handle: "abm",             base_url: "https://careers.abm.com/search-jobs" },
  // { id: "br-quanta",      name: "Quanta Services (Browser)",  source_type: "browser", company_handle: "quantaservices",  base_url: "https://quantaservices.com/careers/job-search" },
  // { id: "br-emcor",       name: "EMCOR (Browser)",            source_type: "browser", company_handle: "emcor",           base_url: "https://emcorgroup.com/careers/job-search" },
  // { id: "br-hii",         name: "Huntington Ingalls (Browser)",source_type: "browser", company_handle: "hii",            base_url: "https://careers.huntingtoningalls.com/search-jobs" },
  // { id: "br-amentum",     name: "Amentum (Browser)",          source_type: "browser", company_handle: "amentum",         base_url: "https://jobs.amentum.com/search-jobs" },
  // { id: "br-ralphlauren", name: "Ralph Lauren (Browser)",     source_type: "browser", company_handle: "ralphlauren",     base_url: "https://careers.ralphlauren.com/search-jobs" },
  // { id: "br-tapestry",    name: "Tapestry (Browser)",         source_type: "browser", company_handle: "tapestry",        base_url: "https://careers.tapestry.com/search-jobs" },
  // { id: "br-pvh",         name: "PVH Corp (Browser)",         source_type: "browser", company_handle: "pvh",             base_url: "https://pvh.com/careers/search-jobs" },
  // { id: "br-esteelauder", name: "Estee Lauder (Browser)",     source_type: "browser", company_handle: "esteelauder",     base_url: "https://careers.elcompanies.com/search-jobs" },
  // { id: "br-carters",     name: "Carter's (Browser)",         source_type: "browser", company_handle: "carters",         base_url: "https://careers.carters.com/search-jobs" },
  // { id: "br-footlocker",  name: "Foot Locker (Browser)",      source_type: "browser", company_handle: "footlocker",      base_url: "https://careers.footlocker.com/search-jobs" },
  // { id: "br-abercrombie", name: "Abercrombie & Fitch (Browser)",source_type: "browser", company_handle: "abercrombie",   base_url: "https://corporate.abercrombie.com/careers/job-search" },
  // { id: "br-aeo",         name: "American Eagle (Browser)",   source_type: "browser", company_handle: "aeo",             base_url: "https://ae.com/us/en/careers/job-search" },
  // { id: "br-victoriassecret",name:"Victoria's Secret (Browser)",source_type: "browser", company_handle: "victoriassecret",base_url: "https://careers.victoriassecret.com/search-jobs" },
  // { id: "br-dicks",       name: "Dick's Sporting Goods (Browser)",source_type: "browser", company_handle: "dickssporting",base_url: "https://www.dickssportinggoods.jobs/search-jobs" },
  // { id: "br-williamsonoma",name:"Williams-Sonoma (Browser)",  source_type: "browser", company_handle: "williamsonoma",   base_url: "https://careers.williams-sonomainc.com/search-jobs" },
  // { id: "br-darden",      name: "Darden (Browser)",           source_type: "browser", company_handle: "darden",          base_url: "https://jobs.darden.com/search-jobs" },
  // { id: "br-aramark",     name: "Aramark (Browser)",          source_type: "browser", company_handle: "aramark",         base_url: "https://careers.aramark.com/search-jobs" },
  // { id: "br-carnival",    name: "Carnival Corp (Browser)",    source_type: "browser", company_handle: "carnival",        base_url: "https://carnivalcorpcareers.com/search-jobs" },
  // { id: "br-royalcaribbean",name:"Royal Caribbean (Browser)", source_type: "browser", company_handle: "royalcaribbean",  base_url: "https://careers.royalcaribbeangroup.com/search-jobs" },
  // { id: "br-yumbrands",   name: "Yum Brands (Browser)",       source_type: "browser", company_handle: "yumbrands",       base_url: "https://careers.yum.com/jobs/search" },
  // { id: "br-caesars",     name: "Caesars Entertainment (Browser)",source_type: "browser", company_handle: "caesars",     base_url: "https://careers.caesars.com/search-jobs" },
  // { id: "br-tractorsupply",name:"Tractor Supply (Browser)",   source_type: "browser", company_handle: "tractorsupply",   base_url: "https://tractorsupply.com/careers/search-jobs" },
  // { id: "br-autozone",    name: "AutoZone (Browser)",         source_type: "browser", company_handle: "autozone",        base_url: "https://careers.autozone.com/search-jobs" },
  // { id: "br-pfg",         name: "Performance Food Group (Browser)",source_type: "browser", company_handle: "pfg",        base_url: "https://pfgc.com/Careers/Job-Search" },
  // { id: "br-conduent",    name: "Conduent (Browser)",         source_type: "browser", company_handle: "conduent",        base_url: "https://careers.conduent.com/search-jobs" },
  // { id: "br-epam",        name: "EPAM Systems (Browser)",     source_type: "browser", company_handle: "epam",            base_url: "https://epam.com/careers/job-listings" },
  // { id: "br-taskus",      name: "TaskUs (Browser)",           source_type: "browser", company_handle: "taskus",          base_url: "https://taskus.com/careers/jobs" },
  // { id: "br-exl",         name: "EXL Service (Browser)",      source_type: "browser", company_handle: "exlservice",      base_url: "https://exlservice.com/careers/job-search" },
  // { id: "br-concentrix",  name: "Concentrix (Browser)",       source_type: "browser", company_handle: "concentrix",      base_url: "https://jobs.concentrix.com/global/en" },
  // { id: "br-lifetime",    name: "Life Time Fitness (Browser)",source_type: "browser", company_handle: "lifetime",        base_url: "https://careers.lifetime.life/search-jobs" },
  // { id: "br-brinks",      name: "Brink's (Browser)",          source_type: "browser", company_handle: "brinks",          base_url: "https://brinks.com/en/who-we-are/careers" },
  // { id: "br-trinet",      name: "TriNet (Browser)",           source_type: "browser", company_handle: "trinet",          base_url: "https://trinet.com/careers/search-jobs" },
  // { id: "br-ajgallagher", name: "AJ Gallagher (Browser)",     source_type: "browser", company_handle: "arthurjgallagher",base_url: "https://careers.ajg.com/search-jobs" },
  // { id: "br-pilgrims",    name: "Pilgrim's Pride (Browser)",  source_type: "browser", company_handle: "pilgrimspride",   base_url: "https://pilgrims.com/careers/job-search" },
];


/**
 * Pre-seeds company website URLs for companies whose slugified name does not
 * resolve to a valid domain (e.g. "jpmorgan-chase.com" doesn't exist).
 *
 * The enrichment layer (company.ts) uses website_url as the primary domain for
 * Brandfetch lookups, which returns logo + LinkedIn + X + Glassdoor. Without a
 * hint here, it would fall back to `{slug}.com` and produce empty results.
 *
 * Safe to re-run — only writes website_url when the column is currently NULL.
 */
interface CompanyHint {
  slug: string;
  name: string;
  website_url: string;
}

const COMPANY_HINTS: CompanyHint[] = [
  // Slug contains hyphens that don't map to the real domain
  { slug: "jpmorgan-chase",   name: "JPMorgan Chase",   website_url: "https://www.jpmorganchase.com" },
  { slug: "bank-of-america",  name: "Bank of America",  website_url: "https://www.bankofamerica.com" },
  { slug: "morgan-stanley",   name: "Morgan Stanley",   website_url: "https://www.morganstanley.com" },
  { slug: "goldman-sachs",    name: "Goldman Sachs",    website_url: "https://www.goldmansachs.com"  },
  { slug: "american-express", name: "American Express", website_url: "https://www.americanexpress.com" },
  { slug: "best-buy",         name: "Best Buy",         website_url: "https://www.bestbuy.com"       },
  { slug: "delta-air-lines",  name: "Delta Air Lines",  website_url: "https://www.delta.com"         },
  { slug: "united-airlines",  name: "United Airlines",  website_url: "https://www.united.com"        },
  { slug: "hp-inc",           name: "HP Inc",           website_url: "https://www.hp.com"            },
  // Startups whose slug.com differs from actual domain
  { slug: "augment-code",     name: "Augment Code",     website_url: "https://www.augmentcode.com"   },
  // GTM Clay (Ashby claylabs) — separate from Mesh (personal CRM, https://me.sh/, formerly Clay Earth)
  { slug: "clay",             name: "Clay",             website_url: "https://www.clay.com"          },
  // Mesh — rebranded from Clay Earth; favicon/logo via me.sh (not clay.com)
  { slug: "mesh",             name: "Mesh",             website_url: "https://me.sh"               },
  { slug: "hex",              name: "Hex",              website_url: "https://hex.tech"              },
  // Greenhouse name slugifies to google-deepmind; enrichment otherwise guesses google-deepmind.com
  { slug: "google-deepmind",  name: "Google DeepMind",  website_url: "https://deepmind.google"       },
  // AoPS — real domain is artofproblemsolving.com, not art-of-problem-solving.com
  { slug: "art-of-problem-solving", name: "Art of Problem Solving", website_url: "https://artofproblemsolving.com" },
  // Greenhouse slug mongodb → mongodb.com is fine for favicons; canonical marketing site uses www
  { slug: "mongodb", name: "MongoDB", website_url: "https://www.mongodb.com" },
  // Lovable (Greenhouse/Ashby) — not lovable.com (different company in Brandfetch)
  { slug: "lovable", name: "Lovable", website_url: "https://lovable.dev" },
  // Remote.com — canonical domain is remote.com not remotecom.com
  { slug: "remotecom", name: "Remote.com", website_url: "https://remote.com" },
  // Inflection AI — canonical domain is inflection.ai not inflection-ai.com
  { slug: "inflection-ai", name: "Inflection AI", website_url: "https://inflection.ai" },
  // Swan (French fintech) — swan.com is an unrelated company; swan.io is correct
  { slug: "swan", name: "Swan", website_url: "https://swan.io" },
  // Slingshot AI — slingshot.xyz is wrong; slingshotai.com is correct
  { slug: "slingshot-ai", name: "Slingshot AI", website_url: "https://slingshotai.com" },
  // Warner Bros Discovery — fragmented brand; wbd.com is the canonical parent
  { slug: "warner-bros", name: "Warner Bros", website_url: "https://wbd.com" },
  { slug: "warner-bros-discovery", name: "Warner Bros. Discovery", website_url: "https://wbd.com" },
  // Promise (civic payments) — promise.com is unrelated; joinpromise.com is correct
  { slug: "promise", name: "Promise", website_url: "https://joinpromise.com" },
];

/** Known-good metadata when slug→domain or Brandfetch misses a niche employer. */
interface CompanyMetadataCorrection {
  slug: string;
  website_url: string;
  /** Hostname passed to the same s2/favicons URL builder as company enrichment */
  favicon_domain: string;
  /** When set, overwrites x_url (Brandfetch often lacks small orgs) */
  x_url?: string;
  /** When true, replace logo_url even if Brandfetch cached the wrong domain (e.g. lovable.com vs lovable.dev) */
  force_logo?: boolean;
}

const COMPANY_METADATA_CORRECTIONS: CompanyMetadataCorrection[] = [
  { slug: "google-deepmind", website_url: "https://deepmind.google", favicon_domain: "deepmind.google" },
  {
    slug: "art-of-problem-solving",
    website_url: "https://artofproblemsolving.com",
    favicon_domain: "artofproblemsolving.com",
    x_url: "https://x.com/AoPSNews",
  },
  // Ensures website_url is set even when enrichment has not reached this row (50/cron cap) or Brandfetch is off
  { slug: "mongodb", website_url: "https://www.mongodb.com", favicon_domain: "mongodb.com" },
  // AI app builder — Brandfetch "lovable.com" is a different brand; correct site is lovable.dev
  { slug: "lovable", website_url: "https://lovable.dev", favicon_domain: "lovable.dev" },
  // GTM Clay (ab-claylabs) — not clay.earth / Mesh product site
  { slug: "clay", website_url: "https://www.clay.com", favicon_domain: "clay.com" },
  // Mesh (me.sh) — use Google favicon CDN for me.sh until Brandfetch fills on enrich
  { slug: "mesh", website_url: "https://me.sh", favicon_domain: "me.sh" },
];

/**
 * Force-correct company rows where enrichment or a bad domain guess stored the wrong
 * website or logo. Safe to run every request — idempotent UPDATEs by slug.
 */
export async function applyCompanyMetadataCorrections(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (const c of COMPANY_METADATA_CORRECTIONS) {
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${c.favicon_domain}&sz=64`;
    // force_logo: swap in favicon only while website_url still mismatches canonical (wrong Brandfetch domain).
    // Once website matches, leave logo alone so a later enrich pass can upgrade to SVG for the right domain.
    const logoSql = c.force_logo
      ? `logo_url = CASE
               WHEN website_url IS DISTINCT FROM ? THEN ?
               ELSE logo_url
             END`
      : `logo_url = CASE
               WHEN logo_url IS NOT NULL AND logo_url NOT LIKE 'https://www.google.com/s2/favicons%' THEN logo_url
               ELSE ?
             END`;
    if (c.x_url) {
      await db
        .prepare(
          `UPDATE companies SET
             website_url = ?,
             ${logoSql},
             x_url = ?,
             website_infer_suppressed = 0,
             website_checked_at = NULL,
             updated_at = ?
           WHERE slug = ?`
        )
        .bind(
          c.website_url,
          ...(c.force_logo ? [c.website_url, faviconUrl] : [faviconUrl]),
          c.x_url,
          now,
          c.slug
        )
        .run();
    } else {
      await db
        .prepare(
          `UPDATE companies SET
             website_url = ?,
             ${logoSql},
             website_infer_suppressed = 0,
             website_checked_at = NULL,
             updated_at = ?
           WHERE slug = ?`
        )
        .bind(c.website_url, ...(c.force_logo ? [c.website_url, faviconUrl] : [faviconUrl]), now, c.slug)
        .run();
    }
  }
}

export async function seedCompanyWebsites(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (const hint of COMPANY_HINTS) {
    await db
      .prepare(
        `INSERT INTO companies (id, name, slug, website_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (slug) DO UPDATE SET
           website_url = CASE
                           WHEN companies.website_url IS NULL THEN excluded.website_url
                           ELSE companies.website_url
                         END,
           website_infer_suppressed = CASE
                           WHEN companies.website_url IS NULL AND excluded.website_url IS NOT NULL THEN 0
                           ELSE companies.website_infer_suppressed
                         END,
           website_checked_at = CASE
                           WHEN companies.website_url IS NULL AND excluded.website_url IS NOT NULL THEN NULL
                           ELSE companies.website_checked_at
                         END,
           updated_at  = excluded.updated_at`
      )
      .bind(crypto.randomUUID(), hint.name, hint.slug, hint.website_url, now, now)
      .run();
  }
}

/**
 * Per-source fetch interval overrides (hours between fetches).
 * Applied after INSERT OR IGNORE so they update existing rows too.
 * NULL = run every cron cycle (hourly, the default).
 * Use for large/slow sources whose listings don't change by the hour.
 */
/**
 * Company name aliases: maps variant slugs (as they appear in Consider/a16z)
 * to the canonical slug used by the direct ATS source in migrate.ts.
 *
 * Canonical slug = slugify(name from the direct ATS source row).
 * Alias slug     = slugify(name as returned by the Consider API).
 *
 * Confirmed by cross-referencing apply URLs — each pair points to the same
 * ATS company handle, so they are definitively the same company.
 */
const COMPANY_ALIASES: Array<{ alias: string; canonical: string }> = [
  { alias: "thinking-machines-lab",  canonical: "thinking-machines" },
  { alias: "base-power-company",     canonical: "base-power" },
  { alias: "temporal-technologies",  canonical: "temporal" },
  { alias: "hadrian",                canonical: "hadrian-automation" },
  { alias: "mistral-ai",             canonical: "mistral" },
  { alias: "hebbia-ai",              canonical: "hebbia" },
  { alias: "nomic",                  canonical: "nomic-ai" },
  { alias: "valon-labs",             canonical: "valon" },
  { alias: "hex-technologies",       canonical: "hex" },
  { alias: "braintrust-data",        canonical: "braintrust" },
  { alias: "blackbird",              canonical: "blackbird-labs" },
  { alias: "backflip",               canonical: "backflip-ai" },
  { alias: "mirelo-ai",              canonical: "mirelo" },
  { alias: "leona-health",           canonical: "leona" },
  // Mesh (me.sh) was Clay Earth; some feeds still use the old name
  { alias: "clay-earth",             canonical: "mesh" },
  // U.S. Bank: Workday seed uses "US Bancorp" (us-bancorp); Phenom uses "U.S. Bank" (us-bank)
  { alias: "us-bank",                canonical: "us-bancorp" },
];

const FETCH_INTERVALS: Array<{ id: string; hours: number }> = [
  // 48h for initial backfill (first run ingests ~15k jobs); change to 1 after ~4 days (on March 24, 2026)
  { id: "cn-a16z-portfolio", hours: 48 },
];

/** Source IDs that consistently 404 or fail — disabled to avoid cron noise. */
const DISABLED_SOURCE_IDS = [
  "apl-global",       // Apple API 301→pagenotfound (endpoint deprecated)
  "wb-taxfix",        // Workable 404; no public ATS API found
  "gh-notion",        // Greenhouse 404; Notion uses Ashby (ab-notion)
  "gh-linear",        // Greenhouse 404; Linear uses Ashby (ab-linear)
  "gh-shopify",       // Greenhouse 404; careers embed Ashby (no public board slug); use br-shopify
  "wb-papayaglobal",  // Workable 404; no public ATS API found
  "wb-shopify",       // Workable returns empty; no working API
  "br-augment",       // Retired; use gh-augmentcomputing (Greenhouse)
  "br-figma",         // Browser 429; use gh-figma (Greenhouse) instead
  "br-linear",        // Browser 429; use ab-linear (Ashby) instead
  "br-ada",           // Browser 429; use gh-ada (Greenhouse) instead
  "br-hippocratic",   // Browser 429; use ab-hippocratic-ai (Ashby) instead
  "ps-n26",           // Personio 429 rate limit (temporary)
  "br-hrc",           // Renamed to sh-hrc (SaaSHR REST); old id may still exist in D1
  "cn-11x-ai",        // Superseded by cn-a16z-portfolio (full board; avoid duplicate consider rows)
  // Browser sources replaced by wd-hp (confirmed working) or disabled pending site name fix
  "br-hp",            // Replaced by wd-hp (hp.wd5 ExternalCareerSite confirmed 200)
  "br-microsoft",     // Disabled — wd-microsoft pending correct site name
  "br-goldmansachs",  // Disabled — wd-goldmansachs pending correct site name
  "br-morganstanley", // Disabled — wd-morganstanley pending correct site name
  "br-delta",         // Disabled — wd-delta pending correct site name
  "br-united",        // Disabled — wd-united pending correct site name
  "br-bestbuy",       // Disabled — wd-bestbuy pending correct site name
  "br-pepsico",       // Disabled — wd-pepsico pending correct site name
  "br-amex",          // Disabled — wd-amex pending correct site name
  "br-volvogroup",    // Disabled — wd-volvogroup pending correct site name
  "br-progressive",   // Disabled — wd-progressive pending correct site name
  "br-adp",           // Disabled — wd-adp pending correct site name
  "br-qualcomm",      // Disabled — wd-qualcomm pending correct site name
  "br-ibm",           // Disabled — wd-ibm pending correct site name
  "br-bofa",          // Disabled — wd-bofa pending correct site name
  "br-fedex",         // Disabled — wd-fedex pending correct site name
  "br-clay",          // clay.earth careers DOM listed nav as jobs; use ab-claylabs (Ashby) only
  // wd-* entries that need correct site names before they can work
  "wd-microsoft", "wd-goldmansachs", "wd-morganstanley", "wd-delta", "wd-united",
  "wd-bestbuy", "wd-pepsico", "wd-amex", "wd-volvogroup", "wd-progressive",
  "wd-adp", "wd-qualcomm", "wd-ibm", "wd-meta", "wd-bofa", "wd-fedex",
  // Browser sources with no viable public API
  "br-jpmorgan",      // Superseded by oc-jpmorgan (oracle_ce)
  "br-kroger",        // Oracle Cloud HCM — no fetcher; krogerfamilycareers.com
  "br-hilton",        // Taleo — no fetcher
  "br-marriott",      // Oracle Cloud HCM — no fetcher
  "br-costco",        // iCIMS — no fetcher
  "br-starbucks",     // Eightfold — no fetcher
  "br-google",        // Proprietary careers.google.com — no fetcher
  "br-oracle",        // Proprietary careers.oracle.com — no fetcher
  "br-lululemon",     // Workday 401 — private/internal board
  "br-vimeo",         // Workday tenant exists but returns 0 public jobs
  "br-shopify",       // Navigation timeout; no public ATS API found
  "br-albertsons",    // Oracle Cloud HCM — no fetcher (eofd.fa.us6.oraclecloud.com)
];

/**
 * Seed the sources table with the initial set of ingestion sources.
 * Safe to re-run — uses INSERT OR IGNORE so existing rows are not touched.
 * Also disables known-broken sources.
 */
export async function seedSources(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO sources
       (id, name, source_type, company_handle, base_url, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  );

  // Chunk into 100-statement batches — D1 batch() has a ~1MB body limit and
  // at ~120 bytes/statement, 998 sources in one call exceeds it.
  const stmts = SEED_SOURCES.map((s) =>
    stmt.bind(s.id, s.name, s.source_type, s.company_handle, s.base_url, now)
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  for (const { id, hours } of FETCH_INTERVALS) {
    await db.prepare("UPDATE sources SET fetch_interval_hours = ? WHERE id = ?").bind(hours, id).run();
  }

  for (const id of DISABLED_SOURCE_IDS) {
    await db.prepare("UPDATE sources SET enabled = 0 WHERE id = ?").bind(id).run();
  }

  // Meta: browser source superseded by metacareers (sitemap + JSON-LD)
  await db.prepare("UPDATE sources SET enabled = 0 WHERE id = 'br-meta'").run();

  // Seed company aliases (INSERT OR IGNORE — safe to re-run)
  const aliasStmt = db.prepare(
    "INSERT OR IGNORE INTO company_aliases (alias_slug, canonical_slug) VALUES (?, ?)"
  );
  await db.batch(
    COMPANY_ALIASES.map(({ alias, canonical }) => aliasStmt.bind(alias, canonical))
  );
}
