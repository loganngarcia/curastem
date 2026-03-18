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
 * Each source that uses Greenhouse, Lever, or Ashby exposes a fully public
 * JSON endpoint — no API key or scraping required.
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
  { id: "gh-vercel",   name: "Vercel (Greenhouse)",    source_type: "greenhouse", company_handle: "vercel",    base_url: "https://boards-api.greenhouse.io/v1/boards/vercel/jobs" },
  { id: "gh-instacart",  name: "Instacart (Greenhouse)",  source_type: "greenhouse", company_handle: "instacart",  base_url: "https://boards-api.greenhouse.io/v1/boards/instacart/jobs" },
  { id: "gh-gusto",      name: "Gusto (Greenhouse)",      source_type: "greenhouse", company_handle: "gusto",      base_url: "https://boards-api.greenhouse.io/v1/boards/gusto/jobs" },
  { id: "gh-grammarly",  name: "Grammarly (Greenhouse)",  source_type: "greenhouse", company_handle: "grammarly",  base_url: "https://boards-api.greenhouse.io/v1/boards/grammarly/jobs" },
  { id: "gh-pinterest",  name: "Pinterest (Greenhouse)",  source_type: "greenhouse", company_handle: "pinterest",  base_url: "https://boards-api.greenhouse.io/v1/boards/pinterest/jobs" },
  { id: "gh-dropbox",    name: "Dropbox (Greenhouse)",    source_type: "greenhouse", company_handle: "dropbox",    base_url: "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs" },
  { id: "gh-brex",       name: "Brex (Greenhouse)",       source_type: "greenhouse", company_handle: "brex",       base_url: "https://boards-api.greenhouse.io/v1/boards/brex/jobs" },
  { id: "gh-gitlab",     name: "GitLab (Greenhouse)",     source_type: "greenhouse", company_handle: "gitlab",     base_url: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs" },
  { id: "gh-twitch",     name: "Twitch (Greenhouse)",     source_type: "greenhouse", company_handle: "twitch",     base_url: "https://boards-api.greenhouse.io/v1/boards/twitch/jobs" },
  { id: "gh-flexport",   name: "Flexport (Greenhouse)",   source_type: "greenhouse", company_handle: "flexport",   base_url: "https://boards-api.greenhouse.io/v1/boards/flexport/jobs" },
  { id: "gh-klaviyo",    name: "Klaviyo (Greenhouse)",    source_type: "greenhouse", company_handle: "klaviyo",    base_url: "https://boards-api.greenhouse.io/v1/boards/klaviyo/jobs" },
  { id: "gh-carta",      name: "Carta (Greenhouse)",      source_type: "greenhouse", company_handle: "carta",      base_url: "https://boards-api.greenhouse.io/v1/boards/carta/jobs" },
  { id: "gh-databricks", name: "Databricks (Greenhouse)", source_type: "greenhouse", company_handle: "databricks", base_url: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs" },
  { id: "gh-duolingo",   name: "Duolingo (Greenhouse)",   source_type: "greenhouse", company_handle: "duolingo",   base_url: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs" },
  { id: "gh-robinhood",  name: "Robinhood (Greenhouse)",  source_type: "greenhouse", company_handle: "robinhood",  base_url: "https://boards-api.greenhouse.io/v1/boards/robinhood/jobs" },
  { id: "gh-coinbase",   name: "Coinbase (Greenhouse)",   source_type: "greenhouse", company_handle: "coinbase",   base_url: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs" },
  { id: "gh-chime",      name: "Chime (Greenhouse)",      source_type: "greenhouse", company_handle: "chime",      base_url: "https://boards-api.greenhouse.io/v1/boards/chime/jobs" },
  { id: "gh-coursera",   name: "Coursera (Greenhouse)",   source_type: "greenhouse", company_handle: "coursera",   base_url: "https://boards-api.greenhouse.io/v1/boards/coursera/jobs" },
  { id: "gh-disney",   name: "Disney (Greenhouse)",   source_type: "greenhouse", company_handle: "disney",   base_url: "https://boards-api.greenhouse.io/v1/boards/disney/jobs" },
  { id: "gh-coupang",  name: "Coupang (Greenhouse)",  source_type: "greenhouse", company_handle: "coupang",  base_url: "https://boards-api.greenhouse.io/v1/boards/coupang/jobs" },
  { id: "gh-sweetgreen",    name: "Sweetgreen (Greenhouse)",    source_type: "greenhouse", company_handle: "sweetgreen",    base_url: "https://boards-api.greenhouse.io/v1/boards/sweetgreen/jobs" },
  { id: "gh-glossier",      name: "Glossier (Greenhouse)",      source_type: "greenhouse", company_handle: "glossier",      base_url: "https://boards-api.greenhouse.io/v1/boards/glossier/jobs" },
  { id: "gh-peloton",       name: "Peloton (Greenhouse)",       source_type: "greenhouse", company_handle: "peloton",       base_url: "https://boards-api.greenhouse.io/v1/boards/peloton/jobs" },
  { id: "gh-reformation",   name: "Reformation (Greenhouse)",   source_type: "greenhouse", company_handle: "reformation",   base_url: "https://boards-api.greenhouse.io/v1/boards/reformation/jobs" },
  { id: "gh-classpass",     name: "ClassPass (Greenhouse)",     source_type: "greenhouse", company_handle: "classpass",     base_url: "https://boards-api.greenhouse.io/v1/boards/classpass/jobs" },
  { id: "gh-babylist",      name: "Babylist (Greenhouse)",      source_type: "greenhouse", company_handle: "babylist",      base_url: "https://boards-api.greenhouse.io/v1/boards/babylist/jobs" },
  { id: "gh-stitchfix",     name: "Stitch Fix (Greenhouse)",    source_type: "greenhouse", company_handle: "stitchfix",     base_url: "https://boards-api.greenhouse.io/v1/boards/stitchfix/jobs" },
  { id: "gh-everlane",      name: "Everlane (Greenhouse)",      source_type: "greenhouse", company_handle: "everlane",      base_url: "https://boards-api.greenhouse.io/v1/boards/everlane/jobs" },
  { id: "gh-renttherunway", name: "Rent the Runway (Greenhouse)", source_type: "greenhouse", company_handle: "renttherunway", base_url: "https://boards-api.greenhouse.io/v1/boards/renttherunway/jobs" },
  { id: "gh-aloyoga",       name: "Alo Yoga (Greenhouse)",      source_type: "greenhouse", company_handle: "aloyoga",       base_url: "https://boards-api.greenhouse.io/v1/boards/aloyoga/jobs" },
  { id: "gh-gorjana",       name: "Gorjana (Greenhouse)",       source_type: "greenhouse", company_handle: "gorjana",       base_url: "https://boards-api.greenhouse.io/v1/boards/gorjana/jobs" },
  { id: "gh-jdsports",      name: "JD Sports (Greenhouse)",     source_type: "greenhouse", company_handle: "jdsports",      base_url: "https://boards-api.greenhouse.io/v1/boards/jdsports/jobs" },
  { id: "gh-oscar",      name: "Oscar Health (Greenhouse)", source_type: "greenhouse", company_handle: "oscar",    base_url: "https://boards-api.greenhouse.io/v1/boards/oscar/jobs" },
  { id: "gh-cloudflare", name: "Cloudflare (Greenhouse)",  source_type: "greenhouse", company_handle: "cloudflare", base_url: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs" },
  { id: "gh-datadog",    name: "Datadog (Greenhouse)",     source_type: "greenhouse", company_handle: "datadog",    base_url: "https://boards-api.greenhouse.io/v1/boards/datadog/jobs" },
  { id: "gh-mongodb",    name: "MongoDB (Greenhouse)",     source_type: "greenhouse", company_handle: "mongodb",    base_url: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs" },
  { id: "gh-elastic",    name: "Elastic (Greenhouse)",     source_type: "greenhouse", company_handle: "elastic",    base_url: "https://boards-api.greenhouse.io/v1/boards/elastic/jobs" },
  { id: "gh-roblox",     name: "Roblox (Greenhouse)",      source_type: "greenhouse", company_handle: "roblox",     base_url: "https://boards-api.greenhouse.io/v1/boards/roblox/jobs" },
  { id: "gh-intercom",   name: "Intercom (Greenhouse)",    source_type: "greenhouse", company_handle: "intercom",   base_url: "https://boards-api.greenhouse.io/v1/boards/intercom/jobs" },
  { id: "gh-twilio",     name: "Twilio (Greenhouse)",      source_type: "greenhouse", company_handle: "twilio",     base_url: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs" },
  { id: "gh-lyft",    name: "Lyft (Greenhouse)",    source_type: "greenhouse", company_handle: "lyft",         base_url: "https://boards-api.greenhouse.io/v1/boards/lyft/jobs" },
  { id: "gh-reddit",  name: "Reddit (Greenhouse)",  source_type: "greenhouse", company_handle: "reddit",       base_url: "https://boards-api.greenhouse.io/v1/boards/reddit/jobs" },
  { id: "gh-arize",   name: "Arize (Greenhouse)",   source_type: "greenhouse", company_handle: "arizeai",      base_url: "https://boards-api.greenhouse.io/v1/boards/arizeai/jobs" },       // handle: arizeai
  { id: "gh-dagster", name: "Dagster (Greenhouse)", source_type: "greenhouse", company_handle: "dagsterlabs",  base_url: "https://boards-api.greenhouse.io/v1/boards/dagsterlabs/jobs" },   // handle: dagsterlabs
  { id: "gh-viam",    name: "Viam (Greenhouse)",    source_type: "greenhouse", company_handle: "viamrobotics", base_url: "https://boards-api.greenhouse.io/v1/boards/viamrobotics/jobs" },  // handle: viamrobotics
  { id: "gh-remote",       name: "Remote.com (Greenhouse)",   source_type: "greenhouse", company_handle: "remote",        base_url: "https://boards-api.greenhouse.io/v1/boards/remote/jobs" },
  { id: "gh-miro",         name: "Miro (Greenhouse)",         source_type: "greenhouse", company_handle: "realtimeboardglobal", base_url: "https://boards-api.greenhouse.io/v1/boards/realtimeboardglobal/jobs" },
  { id: "gh-allbirds",     name: "Allbirds (Greenhouse)",     source_type: "greenhouse", company_handle: "allbirds",      base_url: "https://boards-api.greenhouse.io/v1/boards/allbirds/jobs" },
  { id: "gh-karbon",       name: "Karbon (Greenhouse)",       source_type: "greenhouse", company_handle: "karbon",        base_url: "https://boards-api.greenhouse.io/v1/boards/karbon/jobs" },
  { id: "gh-descript",         name: "Descript (Greenhouse)",          source_type: "greenhouse", company_handle: "descript",         base_url: "https://boards-api.greenhouse.io/v1/boards/descript/jobs" },
  { id: "gh-vectara",          name: "Vectara (Greenhouse)",           source_type: "greenhouse", company_handle: "vectara",          base_url: "https://boards-api.greenhouse.io/v1/boards/vectara/jobs" },
  { id: "gh-tines",            name: "Tines (Greenhouse)",             source_type: "greenhouse", company_handle: "tines",            base_url: "https://boards-api.greenhouse.io/v1/boards/tines/jobs" },
  { id: "gh-hightouch",        name: "Hightouch (Greenhouse)",         source_type: "greenhouse", company_handle: "hightouch",        base_url: "https://boards-api.greenhouse.io/v1/boards/hightouch/jobs" },
  { id: "gh-runpod",           name: "RunPod (Greenhouse)",            source_type: "greenhouse", company_handle: "runpod",           base_url: "https://boards-api.greenhouse.io/v1/boards/runpod/jobs" },
  { id: "gh-worldlabs",        name: "World Labs (Greenhouse)",        source_type: "greenhouse", company_handle: "worldlabs",        base_url: "https://boards-api.greenhouse.io/v1/boards/worldlabs/jobs" },
  { id: "gh-parloa",           name: "Parloa (Greenhouse)",            source_type: "greenhouse", company_handle: "parloa",           base_url: "https://boards-api.greenhouse.io/v1/boards/parloa/jobs" },
  { id: "gh-pallet",           name: "Pallet (Greenhouse)",            source_type: "greenhouse", company_handle: "pallet",           base_url: "https://boards-api.greenhouse.io/v1/boards/pallet/jobs" },
  { id: "gh-grafanalabs",      name: "Grafana Labs (Greenhouse)",      source_type: "greenhouse", company_handle: "grafanalabs",      base_url: "https://boards-api.greenhouse.io/v1/boards/grafanalabs/jobs" },
  { id: "gh-enterpret",        name: "Enterpret (Greenhouse)",         source_type: "greenhouse", company_handle: "enterpret",        base_url: "https://boards-api.greenhouse.io/v1/boards/enterpret/jobs" },
  { id: "gh-marqvision",       name: "MarqVision (Greenhouse)",        source_type: "greenhouse", company_handle: "marqvision",       base_url: "https://boards-api.greenhouse.io/v1/boards/marqvision/jobs" },
  { id: "gh-lithic",           name: "Lithic (Greenhouse)",            source_type: "greenhouse", company_handle: "lithic",           base_url: "https://boards-api.greenhouse.io/v1/boards/lithic/jobs" },
  { id: "gh-mercury",          name: "Mercury (Greenhouse)",           source_type: "greenhouse", company_handle: "mercury",          base_url: "https://boards-api.greenhouse.io/v1/boards/mercury/jobs" },
  { id: "gh-engine",           name: "Engine (Greenhouse)",            source_type: "greenhouse", company_handle: "engine",           base_url: "https://boards-api.greenhouse.io/v1/boards/engine/jobs" },
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
  { id: "gh-senrasystems",     name: "Senra Systems (Greenhouse)",     source_type: "greenhouse", company_handle: "senrasystems",     base_url: "https://boards-api.greenhouse.io/v1/boards/senrasystems/jobs" },
  { id: "gh-array",            name: "Array (Greenhouse)",             source_type: "greenhouse", company_handle: "array",            base_url: "https://boards-api.greenhouse.io/v1/boards/array/jobs" },
  { id: "gh-lovable",          name: "Lovable (Greenhouse)",           source_type: "greenhouse", company_handle: "lovable",          base_url: "https://boards-api.greenhouse.io/v1/boards/lovable/jobs" },
  { id: "gh-cortex",           name: "Cortex (Greenhouse)",            source_type: "greenhouse", company_handle: "cortex",           base_url: "https://boards-api.greenhouse.io/v1/boards/cortex/jobs" },
  { id: "gh-merge",            name: "Merge (Greenhouse)",             source_type: "greenhouse", company_handle: "merge",            base_url: "https://boards-api.greenhouse.io/v1/boards/merge/jobs" },
  { id: "gh-method",           name: "Method (Greenhouse)",            source_type: "greenhouse", company_handle: "method",           base_url: "https://boards-api.greenhouse.io/v1/boards/method/jobs" },
  { id: "gh-nexhealth",        name: "NexHealth (Greenhouse)",         source_type: "greenhouse", company_handle: "nexhealth",        base_url: "https://boards-api.greenhouse.io/v1/boards/nexhealth/jobs" },
  { id: "gh-mixpanel",         name: "Mixpanel (Greenhouse)",          source_type: "greenhouse", company_handle: "mixpanel",         base_url: "https://boards-api.greenhouse.io/v1/boards/mixpanel/jobs" },
  { id: "gh-vast",             name: "Vast (Greenhouse)",              source_type: "greenhouse", company_handle: "vast",             base_url: "https://boards-api.greenhouse.io/v1/boards/vast/jobs" },
  { id: "gh-chainguard",       name: "Chainguard (Greenhouse)",        source_type: "greenhouse", company_handle: "chainguard",       base_url: "https://boards-api.greenhouse.io/v1/boards/chainguard/jobs" },
  { id: "gh-inflectionai",     name: "Inflection AI (Greenhouse)",     source_type: "greenhouse", company_handle: "inflectionai",     base_url: "https://boards-api.greenhouse.io/v1/boards/inflectionai/jobs" },
  { id: "gh-gigs",             name: "Gigs (Greenhouse)",              source_type: "greenhouse", company_handle: "gigs",             base_url: "https://boards-api.greenhouse.io/v1/boards/gigs/jobs" },
  { id: "gh-togetherai",       name: "Together AI (Greenhouse)",       source_type: "greenhouse", company_handle: "togetherai",       base_url: "https://boards-api.greenhouse.io/v1/boards/togetherai/jobs" },
  { id: "gh-whop",             name: "Whop (Greenhouse)",              source_type: "greenhouse", company_handle: "whop",             base_url: "https://boards-api.greenhouse.io/v1/boards/whop/jobs" },
  { id: "gh-physicsx",         name: "PhysicsX (Greenhouse)",          source_type: "greenhouse", company_handle: "physicsx",         base_url: "https://boards-api.greenhouse.io/v1/boards/physicsx/jobs" },
  { id: "gh-goodfire",         name: "Goodfire (Greenhouse)",          source_type: "greenhouse", company_handle: "goodfire",         base_url: "https://boards-api.greenhouse.io/v1/boards/goodfire/jobs" },
  { id: "gh-thinkingmachines", name: "Thinking Machines (Greenhouse)", source_type: "greenhouse", company_handle: "thinkingmachines", base_url: "https://boards-api.greenhouse.io/v1/boards/thinkingmachines/jobs" },
  { id: "gh-shopmy",           name: "ShopMy (Greenhouse)",            source_type: "greenhouse", company_handle: "shopmy",           base_url: "https://boards-api.greenhouse.io/v1/boards/shopmy/jobs" },
  { id: "gh-hebbia",           name: "Hebbia (Greenhouse)",            source_type: "greenhouse", company_handle: "hebbia",           base_url: "https://boards-api.greenhouse.io/v1/boards/hebbia/jobs" },
  { id: "gh-armada",           name: "Armada (Greenhouse)",            source_type: "greenhouse", company_handle: "armada",           base_url: "https://boards-api.greenhouse.io/v1/boards/armada/jobs" },
  { id: "gh-contextualai",     name: "Contextual AI (Greenhouse)",     source_type: "greenhouse", company_handle: "contextualai",     base_url: "https://boards-api.greenhouse.io/v1/boards/contextualai/jobs" },
  { id: "gh-loop",             name: "Loop (Greenhouse)",              source_type: "greenhouse", company_handle: "loop",             base_url: "https://boards-api.greenhouse.io/v1/boards/loop/jobs" },
  { id: "gh-tollbit",          name: "Tollbit (Greenhouse)",           source_type: "greenhouse", company_handle: "tollbit",          base_url: "https://boards-api.greenhouse.io/v1/boards/tollbit/jobs" },
  { id: "gh-coast",            name: "Coast (Greenhouse)",             source_type: "greenhouse", company_handle: "coast",            base_url: "https://boards-api.greenhouse.io/v1/boards/coast/jobs" },
  { id: "gh-bonfirestudios",   name: "Bonfire Studios (Greenhouse)",   source_type: "greenhouse", company_handle: "bonfirestudios",   base_url: "https://boards-api.greenhouse.io/v1/boards/bonfirestudios/jobs" },
  { id: "gh-fingerprint",      name: "Fingerprint (Greenhouse)",       source_type: "greenhouse", company_handle: "fingerprint",      base_url: "https://boards-api.greenhouse.io/v1/boards/fingerprint/jobs" },
  { id: "gh-chronograph",      name: "Chronograph (Greenhouse)",       source_type: "greenhouse", company_handle: "chronograph",      base_url: "https://boards-api.greenhouse.io/v1/boards/chronograph/jobs" },
  { id: "gh-firsthand",        name: "Firsthand (Greenhouse)",         source_type: "greenhouse", company_handle: "firsthand",        base_url: "https://boards-api.greenhouse.io/v1/boards/firsthand/jobs" },
  { id: "gh-polyai",           name: "PolyAI (Greenhouse)",            source_type: "greenhouse", company_handle: "polyai",           base_url: "https://boards-api.greenhouse.io/v1/boards/polyai/jobs" },
  { id: "gh-doppel",           name: "Doppel (Greenhouse)",            source_type: "greenhouse", company_handle: "doppel",           base_url: "https://boards-api.greenhouse.io/v1/boards/doppel/jobs" },
  { id: "gh-verse",            name: "Verse (Greenhouse)",             source_type: "greenhouse", company_handle: "verse",            base_url: "https://boards-api.greenhouse.io/v1/boards/verse/jobs" },
  { id: "gh-newlimit",         name: "NewLimit (Greenhouse)",          source_type: "greenhouse", company_handle: "newlimit",         base_url: "https://boards-api.greenhouse.io/v1/boards/newlimit/jobs" },
  { id: "gh-wonderstudios",    name: "Wonder Studios (Greenhouse)",    source_type: "greenhouse", company_handle: "wonderstudios",    base_url: "https://boards-api.greenhouse.io/v1/boards/wonderstudios/jobs" },
  { id: "gh-wingspan",         name: "Wingspan (Greenhouse)",          source_type: "greenhouse", company_handle: "wingspan",         base_url: "https://boards-api.greenhouse.io/v1/boards/wingspan/jobs" },
  { id: "gh-flex",             name: "Flex (Greenhouse)",              source_type: "greenhouse", company_handle: "flex",             base_url: "https://boards-api.greenhouse.io/v1/boards/flex/jobs" },
  { id: "gh-mutiny",           name: "Mutiny (Greenhouse)",            source_type: "greenhouse", company_handle: "mutiny",           base_url: "https://boards-api.greenhouse.io/v1/boards/mutiny/jobs" },
  { id: "gh-eudia",            name: "Eudia (Greenhouse)",             source_type: "greenhouse", company_handle: "eudia",            base_url: "https://boards-api.greenhouse.io/v1/boards/eudia/jobs" },
  { id: "gh-fal",              name: "fal (Greenhouse)",               source_type: "greenhouse", company_handle: "fal",              base_url: "https://boards-api.greenhouse.io/v1/boards/fal/jobs" },
  { id: "gh-halcyon",          name: "Halcyon (Greenhouse)",           source_type: "greenhouse", company_handle: "halcyon",          base_url: "https://boards-api.greenhouse.io/v1/boards/halcyon/jobs" },
  { id: "gh-hubspot",     name: "HubSpot",                  source_type: "greenhouse", company_handle: "hubspot",   base_url: "https://boards-api.greenhouse.io/v1/boards/hubspot/jobs" },
  { id: "gh-lush",        name: "LUSH Cosmetics",   source_type: "greenhouse", company_handle: "lush",        base_url: "https://boards-api.greenhouse.io/v1/boards/lush/jobs" },
  { id: "gh-ogilvy",      name: "Ogilvy",           source_type: "greenhouse", company_handle: "ogilvy",      base_url: "https://boards-api.greenhouse.io/v1/boards/ogilvy/jobs" },
  { id: "gh-wpp",         name: "WPP",              source_type: "greenhouse", company_handle: "wpp",         base_url: "https://boards-api.greenhouse.io/v1/boards/wpp/jobs" },

  // ─── Ashby ────────────────────────────────────────────────────────────
  // Public posting API: https://api.ashbyhq.com/posting-api/job-board/{handle}
  { id: "ab-openai",       name: "OpenAI (Ashby)",           source_type: "ashby", company_handle: "openai",       base_url: "https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true" },
  { id: "ab-ramp",         name: "Ramp (Ashby)",             source_type: "ashby", company_handle: "ramp",         base_url: "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true" },
  { id: "ab-notion",       name: "Notion (Ashby)",           source_type: "ashby", company_handle: "notion",       base_url: "https://api.ashbyhq.com/posting-api/job-board/notion?includeCompensation=true" },
  { id: "ab-deel",         name: "Deel (Ashby)",             source_type: "ashby", company_handle: "deel",         base_url: "https://api.ashbyhq.com/posting-api/job-board/deel?includeCompensation=true" },
  { id: "ab-plaid",        name: "Plaid (Ashby)",            source_type: "ashby", company_handle: "plaid",        base_url: "https://api.ashbyhq.com/posting-api/job-board/plaid?includeCompensation=true" },
  { id: "ab-lemonade",     name: "Lemonade (Ashby)",         source_type: "ashby", company_handle: "lemonade",     base_url: "https://api.ashbyhq.com/posting-api/job-board/lemonade?includeCompensation=true" },
  { id: "ab-multiverse",   name: "Multiverse (Ashby)",       source_type: "ashby", company_handle: "multiverse",   base_url: "https://api.ashbyhq.com/posting-api/job-board/multiverse?includeCompensation=true" },
  { id: "ab-1password",    name: "1Password (Ashby)",        source_type: "ashby", company_handle: "1password",    base_url: "https://api.ashbyhq.com/posting-api/job-board/1password?includeCompensation=true" },
  { id: "ab-benchling",    name: "Benchling (Ashby)",        source_type: "ashby", company_handle: "benchling",    base_url: "https://api.ashbyhq.com/posting-api/job-board/benchling?includeCompensation=true" },
  { id: "ab-watershed",    name: "Watershed (Ashby)",        source_type: "ashby", company_handle: "watershed",    base_url: "https://api.ashbyhq.com/posting-api/job-board/watershed?includeCompensation=true" },
  { id: "ab-wealthsimple", name: "Wealthsimple (Ashby)",     source_type: "ashby", company_handle: "wealthsimple", base_url: "https://api.ashbyhq.com/posting-api/job-board/wealthsimple?includeCompensation=true" },
  { id: "ab-patreon",      name: "Patreon (Ashby)",          source_type: "ashby", company_handle: "patreon",      base_url: "https://api.ashbyhq.com/posting-api/job-board/patreon?includeCompensation=true" },
  { id: "ab-pennylane",    name: "Pennylane (Ashby)",        source_type: "ashby", company_handle: "pennylane",    base_url: "https://api.ashbyhq.com/posting-api/job-board/pennylane?includeCompensation=true" },
  { id: "ab-homebase",     name: "Homebase (Ashby)",         source_type: "ashby", company_handle: "homebase",     base_url: "https://api.ashbyhq.com/posting-api/job-board/homebase?includeCompensation=true" },
  { id: "ab-hinge-health", name: "Hinge Health (Ashby)",     source_type: "ashby", company_handle: "hinge-health", base_url: "https://api.ashbyhq.com/posting-api/job-board/hinge-health?includeCompensation=true" },
  { id: "ab-poshmark",     name: "Poshmark (Ashby)",         source_type: "ashby", company_handle: "poshmark",     base_url: "https://api.ashbyhq.com/posting-api/job-board/poshmark?includeCompensation=true" },
  { id: "ab-brigit",       name: "Brigit (Ashby)",           source_type: "ashby", company_handle: "brigit",       base_url: "https://api.ashbyhq.com/posting-api/job-board/brigit?includeCompensation=true" },
  { id: "ab-acorns",       name: "Acorns (Ashby)",           source_type: "ashby", company_handle: "acorns",       base_url: "https://api.ashbyhq.com/posting-api/job-board/acorns?includeCompensation=true" },
  { id: "ab-linear",       name: "Linear (Ashby)",           source_type: "ashby", company_handle: "linear",       base_url: "https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true" },
  { id: "ab-perplexity",   name: "Perplexity AI (Ashby)",    source_type: "ashby", company_handle: "perplexity",   base_url: "https://api.ashbyhq.com/posting-api/job-board/perplexity?includeCompensation=true" },
  { id: "ab-elevenlabs",   name: "ElevenLabs (Ashby)",       source_type: "ashby", company_handle: "elevenlabs",   base_url: "https://api.ashbyhq.com/posting-api/job-board/elevenlabs?includeCompensation=true" },
  { id: "ab-sentry",       name: "Sentry (Ashby)",            source_type: "ashby",     company_handle: "sentry",        base_url: "https://api.ashbyhq.com/posting-api/job-board/sentry?includeCompensation=true" },
  { id: "ab-kindred",          name: "Kindred (Ashby)",                source_type: "ashby", company_handle: "kindred",          base_url: "https://api.ashbyhq.com/posting-api/job-board/kindred?includeCompensation=true" },
  { id: "ab-tldraw",           name: "tldraw (Ashby)",                 source_type: "ashby", company_handle: "tldraw",           base_url: "https://api.ashbyhq.com/posting-api/job-board/tldraw?includeCompensation=true" },
  { id: "ab-magicschool",      name: "MagicSchool (Ashby)",            source_type: "ashby", company_handle: "magicschool",      base_url: "https://api.ashbyhq.com/posting-api/job-board/magicschool?includeCompensation=true" },
  { id: "ab-stacks",           name: "Stacks (Ashby)",                 source_type: "ashby", company_handle: "stacks",           base_url: "https://api.ashbyhq.com/posting-api/job-board/stacks?includeCompensation=true" },
  { id: "ab-flora",            name: "Flora (Ashby)",                  source_type: "ashby", company_handle: "flora",            base_url: "https://api.ashbyhq.com/posting-api/job-board/flora?includeCompensation=true" },
  { id: "ab-persona",          name: "Persona (Ashby)",                source_type: "ashby", company_handle: "persona",          base_url: "https://api.ashbyhq.com/posting-api/job-board/persona?includeCompensation=true" },
  { id: "ab-amigo",            name: "Amigo (Ashby)",                  source_type: "ashby", company_handle: "amigo",            base_url: "https://api.ashbyhq.com/posting-api/job-board/amigo?includeCompensation=true" },
  { id: "ab-anrok",            name: "Anrok (Ashby)",                  source_type: "ashby", company_handle: "anrok",            base_url: "https://api.ashbyhq.com/posting-api/job-board/anrok?includeCompensation=true" },
  { id: "ab-listenlabs",       name: "Listen Labs (Ashby)",            source_type: "ashby", company_handle: "listenlabs",       base_url: "https://api.ashbyhq.com/posting-api/job-board/listenlabs?includeCompensation=true" },
  { id: "ab-numeric",          name: "Numeric (Ashby)",                source_type: "ashby", company_handle: "numeric",          base_url: "https://api.ashbyhq.com/posting-api/job-board/numeric?includeCompensation=true" },
  { id: "ab-lyric",            name: "Lyric (Ashby)",                  source_type: "ashby", company_handle: "lyric",            base_url: "https://api.ashbyhq.com/posting-api/job-board/lyric?includeCompensation=true" },
  { id: "ab-mural",            name: "Mural (Ashby)",                  source_type: "ashby", company_handle: "mural",            base_url: "https://api.ashbyhq.com/posting-api/job-board/mural?includeCompensation=true" },
  { id: "ab-adaptive-ml",      name: "Adaptive ML (Ashby)",            source_type: "ashby", company_handle: "adaptive-ml",      base_url: "https://api.ashbyhq.com/posting-api/job-board/adaptive-ml?includeCompensation=true" },
  { id: "ab-cinder",           name: "Cinder (Ashby)",                 source_type: "ashby", company_handle: "cinder",           base_url: "https://api.ashbyhq.com/posting-api/job-board/cinder?includeCompensation=true" },
  { id: "ab-taktile",          name: "Taktile (Ashby)",                source_type: "ashby", company_handle: "taktile",          base_url: "https://api.ashbyhq.com/posting-api/job-board/taktile?includeCompensation=true" },
  { id: "ab-delphi",           name: "Delphi (Ashby)",                 source_type: "ashby", company_handle: "delphi",           base_url: "https://api.ashbyhq.com/posting-api/job-board/delphi?includeCompensation=true" },
  { id: "ab-flutterflow",      name: "FlutterFlow (Ashby)",            source_type: "ashby", company_handle: "flutterflow",      base_url: "https://api.ashbyhq.com/posting-api/job-board/flutterflow?includeCompensation=true" },
  { id: "ab-imprint",          name: "Imprint (Ashby)",                source_type: "ashby", company_handle: "imprint",          base_url: "https://api.ashbyhq.com/posting-api/job-board/imprint?includeCompensation=true" },
  { id: "ab-permitflow",       name: "PermitFlow (Ashby)",             source_type: "ashby", company_handle: "permitflow",       base_url: "https://api.ashbyhq.com/posting-api/job-board/permitflow?includeCompensation=true" },
  { id: "ab-campus",           name: "Campus (Ashby)",                 source_type: "ashby", company_handle: "campus",           base_url: "https://api.ashbyhq.com/posting-api/job-board/campus?includeCompensation=true" },
  { id: "ab-attio",            name: "Attio (Ashby)",                  source_type: "ashby", company_handle: "attio",            base_url: "https://api.ashbyhq.com/posting-api/job-board/attio?includeCompensation=true" },
  { id: "ab-trm-labs",         name: "TRM Labs (Ashby)",               source_type: "ashby", company_handle: "trm-labs",         base_url: "https://api.ashbyhq.com/posting-api/job-board/trm-labs?includeCompensation=true" },
  { id: "ab-scribe",           name: "Scribe (Ashby)",                 source_type: "ashby", company_handle: "scribe",           base_url: "https://api.ashbyhq.com/posting-api/job-board/scribe?includeCompensation=true" },
  { id: "ab-lio",              name: "Lio (Ashby)",                    source_type: "ashby", company_handle: "lio",              base_url: "https://api.ashbyhq.com/posting-api/job-board/lio?includeCompensation=true" },
  { id: "ab-n8n",              name: "n8n (Ashby)",                    source_type: "ashby", company_handle: "n8n",              base_url: "https://api.ashbyhq.com/posting-api/job-board/n8n?includeCompensation=true" },
  { id: "ab-arq",              name: "ARQ (Ashby)",                    source_type: "ashby", company_handle: "arq",              base_url: "https://api.ashbyhq.com/posting-api/job-board/arq?includeCompensation=true" },
  { id: "ab-vanta",            name: "Vanta (Ashby)",                  source_type: "ashby", company_handle: "vanta",            base_url: "https://api.ashbyhq.com/posting-api/job-board/vanta?includeCompensation=true" },
  { id: "ab-rain",             name: "Rain (Ashby)",                   source_type: "ashby", company_handle: "rain",             base_url: "https://api.ashbyhq.com/posting-api/job-board/rain?includeCompensation=true" },
  { id: "ab-cartesia",         name: "Cartesia (Ashby)",               source_type: "ashby", company_handle: "cartesia",         base_url: "https://api.ashbyhq.com/posting-api/job-board/cartesia?includeCompensation=true" },
  { id: "ab-coderabbit",       name: "CodeRabbit (Ashby)",             source_type: "ashby", company_handle: "coderabbit",       base_url: "https://api.ashbyhq.com/posting-api/job-board/coderabbit?includeCompensation=true" },
  { id: "ab-mirage",           name: "Mirage (Ashby)",                 source_type: "ashby", company_handle: "mirage",           base_url: "https://api.ashbyhq.com/posting-api/job-board/mirage?includeCompensation=true" },
  { id: "ab-tavus",            name: "Tavus (Ashby)",                  source_type: "ashby", company_handle: "tavus",            base_url: "https://api.ashbyhq.com/posting-api/job-board/tavus?includeCompensation=true" },
  { id: "ab-mercor",           name: "Mercor (Ashby)",                 source_type: "ashby", company_handle: "mercor",           base_url: "https://api.ashbyhq.com/posting-api/job-board/mercor?includeCompensation=true" },
  { id: "ab-finch",            name: "Finch (Ashby)",                  source_type: "ashby", company_handle: "finch",            base_url: "https://api.ashbyhq.com/posting-api/job-board/finch?includeCompensation=true" },
  { id: "ab-column",           name: "Column (Ashby)",                 source_type: "ashby", company_handle: "column",           base_url: "https://api.ashbyhq.com/posting-api/job-board/column?includeCompensation=true" },
  { id: "ab-venn",             name: "Venn (Ashby)",                   source_type: "ashby", company_handle: "venn",             base_url: "https://api.ashbyhq.com/posting-api/job-board/venn?includeCompensation=true" },
  { id: "ab-wrapbook",         name: "Wrapbook (Ashby)",               source_type: "ashby", company_handle: "wrapbook",         base_url: "https://api.ashbyhq.com/posting-api/job-board/wrapbook?includeCompensation=true" },
  { id: "ab-anima",            name: "Anima (Ashby)",                  source_type: "ashby", company_handle: "anima",            base_url: "https://api.ashbyhq.com/posting-api/job-board/anima?includeCompensation=true" },
  { id: "ab-dust",             name: "Dust (Ashby)",                   source_type: "ashby", company_handle: "dust",             base_url: "https://api.ashbyhq.com/posting-api/job-board/dust?includeCompensation=true" },
  { id: "ab-sequence",         name: "Sequence (Ashby)",               source_type: "ashby", company_handle: "sequence",         base_url: "https://api.ashbyhq.com/posting-api/job-board/sequence?includeCompensation=true" },
  { id: "ab-eliseai",          name: "EliseAI (Ashby)",                source_type: "ashby", company_handle: "eliseai",          base_url: "https://api.ashbyhq.com/posting-api/job-board/eliseai?includeCompensation=true" },
  { id: "ab-sydecar",          name: "Sydecar (Ashby)",                source_type: "ashby", company_handle: "sydecar",          base_url: "https://api.ashbyhq.com/posting-api/job-board/sydecar?includeCompensation=true" },
  { id: "ab-sandbar",          name: "Sandbar (Ashby)",                source_type: "ashby", company_handle: "sandbar",          base_url: "https://api.ashbyhq.com/posting-api/job-board/sandbar?includeCompensation=true" },
  { id: "ab-sierra",           name: "Sierra (Ashby)",                 source_type: "ashby", company_handle: "sierra",           base_url: "https://api.ashbyhq.com/posting-api/job-board/sierra?includeCompensation=true" },
  { id: "ab-sunday",           name: "Sunday (Ashby)",                 source_type: "ashby", company_handle: "sunday",           base_url: "https://api.ashbyhq.com/posting-api/job-board/sunday?includeCompensation=true" },
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
  { id: "ab-lindy",            name: "Lindy (Ashby)",                  source_type: "ashby", company_handle: "lindy",            base_url: "https://api.ashbyhq.com/posting-api/job-board/lindy?includeCompensation=true" },
  { id: "ab-numeral",          name: "Numeral (Ashby)",                source_type: "ashby", company_handle: "numeral",          base_url: "https://api.ashbyhq.com/posting-api/job-board/numeral?includeCompensation=true" },
  { id: "ab-moment",           name: "Moment (Ashby)",                 source_type: "ashby", company_handle: "moment",           base_url: "https://api.ashbyhq.com/posting-api/job-board/moment?includeCompensation=true" },
  { id: "ab-dash0",            name: "Dash0 (Ashby)",                  source_type: "ashby", company_handle: "dash0",            base_url: "https://api.ashbyhq.com/posting-api/job-board/dash0?includeCompensation=true" },
  { id: "ab-factory",          name: "Factory (Ashby)",                source_type: "ashby", company_handle: "factory",          base_url: "https://api.ashbyhq.com/posting-api/job-board/factory?includeCompensation=true" },
  { id: "ab-juicebox",         name: "Juicebox (Ashby)",               source_type: "ashby", company_handle: "juicebox",         base_url: "https://api.ashbyhq.com/posting-api/job-board/juicebox?includeCompensation=true" },
  { id: "ab-browserbase",      name: "Browserbase (Ashby)",            source_type: "ashby", company_handle: "browserbase",      base_url: "https://api.ashbyhq.com/posting-api/job-board/browserbase?includeCompensation=true" },
  { id: "ab-promise",          name: "Promise (Ashby)",                source_type: "ashby", company_handle: "promise",          base_url: "https://api.ashbyhq.com/posting-api/job-board/promise?includeCompensation=true" },
  { id: "ab-monaco",           name: "Monaco (Ashby)",                 source_type: "ashby", company_handle: "monaco",           base_url: "https://api.ashbyhq.com/posting-api/job-board/monaco?includeCompensation=true" },
  { id: "ab-netic",            name: "Netic (Ashby)",                  source_type: "ashby", company_handle: "netic",            base_url: "https://api.ashbyhq.com/posting-api/job-board/netic?includeCompensation=true" },
  { id: "ab-laurel",           name: "Laurel (Ashby)",                 source_type: "ashby", company_handle: "laurel",           base_url: "https://api.ashbyhq.com/posting-api/job-board/laurel?includeCompensation=true" },
  { id: "ab-langfuse",         name: "Langfuse (Ashby)",               source_type: "ashby", company_handle: "langfuse",         base_url: "https://api.ashbyhq.com/posting-api/job-board/langfuse?includeCompensation=true" },
  { id: "ab-ashby",            name: "Ashby (Ashby)",                  source_type: "ashby", company_handle: "ashby",            base_url: "https://api.ashbyhq.com/posting-api/job-board/ashby?includeCompensation=true" },
  { id: "ab-pinecone",         name: "Pinecone (Ashby)",               source_type: "ashby", company_handle: "pinecone",         base_url: "https://api.ashbyhq.com/posting-api/job-board/pinecone?includeCompensation=true" },
  { id: "ab-neko-health",      name: "Neko Health (Ashby)",            source_type: "ashby", company_handle: "neko-health",      base_url: "https://api.ashbyhq.com/posting-api/job-board/neko-health?includeCompensation=true" },
  { id: "ab-mintlify",         name: "Mintlify (Ashby)",               source_type: "ashby", company_handle: "mintlify",         base_url: "https://api.ashbyhq.com/posting-api/job-board/mintlify?includeCompensation=true" },
  { id: "ab-unify",            name: "Unify (Ashby)",                  source_type: "ashby", company_handle: "unify",            base_url: "https://api.ashbyhq.com/posting-api/job-board/unify?includeCompensation=true" },
  { id: "ab-scrunch",          name: "Scrunch (Ashby)",                source_type: "ashby", company_handle: "scrunch",          base_url: "https://api.ashbyhq.com/posting-api/job-board/scrunch?includeCompensation=true" },
  { id: "ab-granola",          name: "Granola (Ashby)",                source_type: "ashby", company_handle: "granola",          base_url: "https://api.ashbyhq.com/posting-api/job-board/granola?includeCompensation=true" },
  { id: "ab-casca",            name: "Casca (Ashby)",                  source_type: "ashby", company_handle: "casca",            base_url: "https://api.ashbyhq.com/posting-api/job-board/casca?includeCompensation=true" },
  { id: "ab-crosby",           name: "Crosby (Ashby)",                 source_type: "ashby", company_handle: "crosby",           base_url: "https://api.ashbyhq.com/posting-api/job-board/crosby?includeCompensation=true" },
  { id: "ab-april",            name: "April (Ashby)",                  source_type: "ashby", company_handle: "april",            base_url: "https://api.ashbyhq.com/posting-api/job-board/april?includeCompensation=true" },
  { id: "ab-synthesia",        name: "Synthesia (Ashby)",              source_type: "ashby", company_handle: "synthesia",        base_url: "https://api.ashbyhq.com/posting-api/job-board/synthesia?includeCompensation=true" },
  { id: "ab-rillet",           name: "Rillet (Ashby)",                 source_type: "ashby", company_handle: "rillet",           base_url: "https://api.ashbyhq.com/posting-api/job-board/rillet?includeCompensation=true" },
  { id: "ab-vantage",          name: "Vantage (Ashby)",                source_type: "ashby", company_handle: "vantage",          base_url: "https://api.ashbyhq.com/posting-api/job-board/vantage?includeCompensation=true" },
  { id: "ab-tabs",             name: "Tabs (Ashby)",                   source_type: "ashby", company_handle: "tabs",             base_url: "https://api.ashbyhq.com/posting-api/job-board/tabs?includeCompensation=true" },
  { id: "ab-gigaml",           name: "GigaML (Ashby)",                 source_type: "ashby", company_handle: "gigaml",           base_url: "https://api.ashbyhq.com/posting-api/job-board/gigaml?includeCompensation=true" },
  { id: "ab-duna",             name: "Duna (Ashby)",                   source_type: "ashby", company_handle: "duna",             base_url: "https://api.ashbyhq.com/posting-api/job-board/duna?includeCompensation=true" },
  { id: "ab-firecrawl",        name: "Firecrawl (Ashby)",              source_type: "ashby", company_handle: "firecrawl",        base_url: "https://api.ashbyhq.com/posting-api/job-board/firecrawl?includeCompensation=true" },
  { id: "ab-thread-ai",        name: "Thread AI (Ashby)",              source_type: "ashby", company_handle: "thread-ai",        base_url: "https://api.ashbyhq.com/posting-api/job-board/thread-ai?includeCompensation=true" },
  { id: "ab-tigerdata",        name: "TigerData (Ashby)",              source_type: "ashby", company_handle: "tigerdata",        base_url: "https://api.ashbyhq.com/posting-api/job-board/tigerdata?includeCompensation=true" },
  { id: "ab-reducto",          name: "Reducto (Ashby)",                source_type: "ashby", company_handle: "reducto",          base_url: "https://api.ashbyhq.com/posting-api/job-board/reducto?includeCompensation=true" },
  { id: "ab-osmo",             name: "Osmo (Ashby)",                   source_type: "ashby", company_handle: "osmo",             base_url: "https://api.ashbyhq.com/posting-api/job-board/osmo?includeCompensation=true" },
  { id: "ab-symbiotic",        name: "Symbiotic (Ashby)",              source_type: "ashby", company_handle: "symbiotic",        base_url: "https://api.ashbyhq.com/posting-api/job-board/symbiotic?includeCompensation=true" },
  { id: "ab-primer",           name: "Primer (Ashby)",                 source_type: "ashby", company_handle: "primer",           base_url: "https://api.ashbyhq.com/posting-api/job-board/primer?includeCompensation=true" },
  { id: "ab-brettonai",        name: "Bretton AI (Ashby)",             source_type: "ashby", company_handle: "brettonai",        base_url: "https://api.ashbyhq.com/posting-api/job-board/brettonai?includeCompensation=true" },
  { id: "ab-outtake",          name: "Outtake (Ashby)",                source_type: "ashby", company_handle: "outtake",          base_url: "https://api.ashbyhq.com/posting-api/job-board/outtake?includeCompensation=true" },
  { id: "ab-bureau",           name: "Bureau (Ashby)",                 source_type: "ashby", company_handle: "bureau",           base_url: "https://api.ashbyhq.com/posting-api/job-board/bureau?includeCompensation=true" },
  { id: "ab-arcade",           name: "Arcade (Ashby)",                 source_type: "ashby", company_handle: "arcade",           base_url: "https://api.ashbyhq.com/posting-api/job-board/arcade?includeCompensation=true" },
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
  { id: "ab-triggerdev",       name: "Trigger.dev (Ashby)",            source_type: "ashby", company_handle: "triggerdev",       base_url: "https://api.ashbyhq.com/posting-api/job-board/triggerdev?includeCompensation=true" },
  { id: "ab-writer",           name: "Writer (Ashby)",                 source_type: "ashby", company_handle: "writer",           base_url: "https://api.ashbyhq.com/posting-api/job-board/writer?includeCompensation=true" },
  { id: "ab-backflip",         name: "Backflip AI (Ashby)",            source_type: "ashby", company_handle: "backflip",         base_url: "https://api.ashbyhq.com/posting-api/job-board/backflip?includeCompensation=true" },
  { id: "ab-twelve-labs",      name: "TwelveLabs (Ashby)",             source_type: "ashby", company_handle: "twelve-labs",      base_url: "https://api.ashbyhq.com/posting-api/job-board/twelve-labs?includeCompensation=true" },
  { id: "ab-opal",             name: "Opal Security (Ashby)",          source_type: "ashby", company_handle: "opal",             base_url: "https://api.ashbyhq.com/posting-api/job-board/opal?includeCompensation=true" },
  { id: "ab-savvy",            name: "Savvy Wealth (Ashby)",           source_type: "ashby", company_handle: "savvy",            base_url: "https://api.ashbyhq.com/posting-api/job-board/savvy?includeCompensation=true" },
  { id: "ab-reka",             name: "Reka AI (Ashby)",                source_type: "ashby", company_handle: "reka",             base_url: "https://api.ashbyhq.com/posting-api/job-board/reka?includeCompensation=true" },
  { id: "ab-assembled", name: "Assembled (Ashby)", source_type: "ashby", company_handle: "assembledhq", base_url: "https://api.ashbyhq.com/posting-api/job-board/assembledhq?includeCompensation=true" }, // handle: assembledhq
  { id: "ab-convex",    name: "Convex (Ashby)",    source_type: "ashby", company_handle: "convex-dev",  base_url: "https://api.ashbyhq.com/posting-api/job-board/convex-dev?includeCompensation=true" },  // handle: convex-dev
  { id: "ab-rothys",      name: "Rothy's",          source_type: "ashby", company_handle: "rothys",           base_url: "https://api.ashbyhq.com/posting-api/job-board/rothys" },

  // ─── Lever ────────────────────────────────────────────────────────────
  // Public posting API: https://api.lever.co/v0/postings/{handle}
  { id: "lv-rover",        name: "Rover (Lever)",        source_type: "lever", company_handle: "rover",        base_url: "https://api.lever.co/v0/postings/rover" },
  { id: "lv-plaid",        name: "Plaid (Lever)",        source_type: "lever", company_handle: "plaid",        base_url: "https://api.lever.co/v0/postings/plaid" },
  { id: "lv-mistral",          name: "Mistral (Lever)",                source_type: "lever", company_handle: "mistral",                base_url: "https://api.lever.co/v0/postings/mistral" },
  { id: "lv-enveda",           name: "Enveda (Lever)",                 source_type: "lever", company_handle: "enveda",                 base_url: "https://api.lever.co/v0/postings/enveda" },
  { id: "lv-suger",            name: "Suger (Lever)",                  source_type: "lever", company_handle: "suger",                  base_url: "https://api.lever.co/v0/postings/suger" },
  { id: "lv-moonpay",          name: "MoonPay (Lever)",                source_type: "lever", company_handle: "moonpay",                base_url: "https://api.lever.co/v0/postings/moonpay" },
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
  { id: "sr-cottonon",         name: "Cotton On",         source_type: "smartrecruiters", company_handle: "CottonOn",       base_url: "https://api.smartrecruiters.com/v1/companies/CottonOn/postings" },
  { id: "sr-abbvie",           name: "AbbVie",                 source_type: "smartrecruiters", company_handle: "AbbVie",                 base_url: "https://api.smartrecruiters.com/v1/companies/AbbVie/postings" },
  { id: "sr-cencora",          name: "Cencora",                source_type: "smartrecruiters", company_handle: "Cencora",                base_url: "https://api.smartrecruiters.com/v1/companies/Cencora/postings" },
  { id: "sr-ttec",             name: "TTEC",                   source_type: "smartrecruiters", company_handle: "TTEC",                   base_url: "https://api.smartrecruiters.com/v1/companies/TTEC/postings" },
  { id: "sr-omnicom",          name: "Omnicom Group",          source_type: "smartrecruiters", company_handle: "OmnicomGroup",           base_url: "https://api.smartrecruiters.com/v1/companies/OmnicomGroup/postings" },
  { id: "sr-norwegiancruise",  name: "Norwegian Cruise Line",  source_type: "smartrecruiters", company_handle: "NorwegianCruiseLine",    base_url: "https://api.smartrecruiters.com/v1/companies/NorwegianCruiseLine/postings" },

  // ─── Workday ──────────────────────────────────────────────────────────
  // CXS POST API: https://{sub}.wd{n}.myworkdayjobs.com/wday/cxs/{sub}/{site}/jobs
  { id: "wd-kohls",   name: "Kohl's",   source_type: "workday", company_handle: "kohls",   base_url: "https://kohls.wd1.myworkdayjobs.com/wday/cxs/kohls/kohlscareers/jobs" },
  { id: "wd-comcast", name: "Comcast",  source_type: "workday", company_handle: "comcast", base_url: "https://comcast.wd5.myworkdayjobs.com/wday/cxs/comcast/Comcast_Careers/jobs" },
  { id: "wd-target",    name: "Target",     source_type: "workday", company_handle: "target",    base_url: "https://target.wd5.myworkdayjobs.com/wday/cxs/target/targetcareers/jobs" },
  { id: "wd-homedepot", name: "Home Depot", source_type: "workday", company_handle: "homedepot", base_url: "https://homedepot.wd5.myworkdayjobs.com/wday/cxs/homedepot/CareerDepot/jobs" },
  { id: "wd-cvs",       name: "CVS Health", source_type: "workday", company_handle: "cvshealth", base_url: "https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/jobs" },
  { id: "wd-walmart",   name: "Walmart",    source_type: "workday", company_handle: "walmart",   base_url: "https://walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternal/jobs" },
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
  { id: "wd-tyson",       name: "Tyson Foods",      source_type: "workday", company_handle: "tysonfoods",     base_url: "https://tysonfoods.wd5.myworkdayjobs.com/wday/cxs/tysonfoods/TSN/jobs" },
  { id: "wd-nike",        name: "Nike",             source_type: "workday", company_handle: "nike",           base_url: "https://nike.wd1.myworkdayjobs.com/wday/cxs/nike/nke/jobs" },
  { id: "wd-gap",         name: "Gap Inc",          source_type: "workday", company_handle: "gapinc",         base_url: "https://gapinc.wd1.myworkdayjobs.com/wday/cxs/gapinc/GAPINC/jobs" },
  { id: "wd-tjx",         name: "TJX Companies",    source_type: "workday", company_handle: "tjx",            base_url: "https://tjx.wd1.myworkdayjobs.com/wday/cxs/tjx/TJX_EXTERNAL/jobs" },
  { id: "wd-vfc",         name: "VF Corp (TNF/Vans/Timberland)", source_type: "workday", company_handle: "vfc", base_url: "https://vfc.wd5.myworkdayjobs.com/wday/cxs/vfc/vfc_careers/jobs" },
  { id: "wd-southwest",   name: "Southwest Airlines",source_type: "workday", company_handle: "swa",           base_url: "https://swa.wd1.myworkdayjobs.com/wday/cxs/swa/external/jobs" },
  { id: "wd-chevron",     name: "Chevron",          source_type: "workday", company_handle: "chevron",        base_url: "https://chevron.wd5.myworkdayjobs.com/wday/cxs/chevron/jobs/jobs" },
  { id: "wd-bakerhughes", name: "Baker Hughes",     source_type: "workday", company_handle: "bakerhughes",    base_url: "https://bakerhughes.wd5.myworkdayjobs.com/wday/cxs/bakerhughes/BakerHughes/jobs" },
  { id: "wd-3m",          name: "3M",               source_type: "workday", company_handle: "3m",             base_url: "https://3m.wd1.myworkdayjobs.com/wday/cxs/3m/Search/jobs" },
  { id: "wd-allstate",    name: "Allstate",         source_type: "workday", company_handle: "allstate",       base_url: "https://allstate.wd5.myworkdayjobs.com/wday/cxs/allstate/allstate_careers/jobs" },
  { id: "wd-aig",         name: "AIG",              source_type: "workday", company_handle: "aig",            base_url: "https://aig.wd1.myworkdayjobs.com/wday/cxs/aig/aig/jobs" },
  { id: "wd-pnc",         name: "PNC Bank",         source_type: "workday", company_handle: "pnc",            base_url: "https://pnc.wd5.myworkdayjobs.com/wday/cxs/pnc/External/jobs" },
  { id: "wd-usbank",      name: "US Bancorp",       source_type: "workday", company_handle: "usbank",         base_url: "https://usbank.wd1.myworkdayjobs.com/wday/cxs/usbank/US_Bank_Careers/jobs" },
  { id: "wd-fis",         name: "FIS Global",       source_type: "workday", company_handle: "fis",            base_url: "https://fis.wd5.myworkdayjobs.com/wday/cxs/fis/SearchJobs/jobs" },
  { id: "wd-davita",      name: "DaVita",           source_type: "workday", company_handle: "davita",         base_url: "https://davita.wd1.myworkdayjobs.com/wday/cxs/davita/DKC_External/jobs" },
  { id: "wd-iqvia",       name: "IQVIA",            source_type: "workday", company_handle: "iqvia",          base_url: "https://iqvia.wd1.myworkdayjobs.com/wday/cxs/iqvia/IQVIA/jobs" },
  { id: "wd-jll",         name: "JLL",              source_type: "workday", company_handle: "jll",            base_url: "https://jll.wd1.myworkdayjobs.com/wday/cxs/jll/jllcareers/jobs" },
  { id: "wd-republicsvcs",name: "Republic Services",source_type: "workday", company_handle: "republic",       base_url: "https://republic.wd5.myworkdayjobs.com/wday/cxs/republic/republic/jobs" },
  { id: "wd-ecolab",      name: "Ecolab",           source_type: "workday", company_handle: "ecolab",         base_url: "https://ecolab.wd1.myworkdayjobs.com/wday/cxs/ecolab/Ecolab_External/jobs" },
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

  // ─── Sector job boards (RSS) ─────────────────────────────────────────────
  // Higher education — HigherEdJobs has public RSS feeds per category
  // Format: https://www.higheredjobs.com/rss/categoryFeed.cfm?catID={id}
  // Note: HigherEdJobs may use Incapsula; if fetches fail, try from Workers.
  { id: "rss-he-main",     name: "HigherEdJobs (Higher Education)", source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=68" },
  { id: "rss-he-faculty",  name: "HigherEdJobs (Faculty)",          source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=26" },
  { id: "rss-he-admin",    name: "HigherEdJobs (Administrative)",   source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=24" },
  { id: "rss-he-it",       name: "HigherEdJobs (IT)",               source_type: "rss", company_handle: "higheredjobs", base_url: "https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=160" },

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
  { id: "br-clay",        name: "Clay (Browser)",           source_type: "browser", company_handle: "clay",        base_url: "https://clay.earth/careers" },
  { id: "br-hex",         name: "Hex (Browser)",            source_type: "browser", company_handle: "hex",         base_url: "https://hex.tech/careers" },
  { id: "br-augment",     name: "Augment Code (Browser)",   source_type: "browser", company_handle: "augmentcode", base_url: "https://www.augmentcode.com/careers" },
  { id: "br-hilton",      name: "Hilton (Browser)",          source_type: "browser", company_handle: "hilton",          base_url: "https://jobs.hilton.com/us/en/search-jobs" },
  { id: "br-fedex",       name: "FedEx (Browser)",           source_type: "browser", company_handle: "fedex",           base_url: "https://careers.fedex.com/jobs" },
  { id: "br-starbucks",   name: "Starbucks (Browser)",       source_type: "browser", company_handle: "starbucks",       base_url: "https://careers.starbucks.com/jobs" },
  { id: "br-marriott",    name: "Marriott (Browser)",        source_type: "browser", company_handle: "marriott",        base_url: "https://careers.marriott.com/jobs" },
  { id: "br-lululemon",   name: "Lululemon (Browser)",       source_type: "browser", company_handle: "lululemon",       base_url: "https://careers.lululemon.com/en_US/careers" },
  { id: "br-pepsico",     name: "PepsiCo (Browser)",         source_type: "browser", company_handle: "pepsico",         base_url: "https://www.pepsicojobs.com/main/jobs" },
  { id: "br-jpmorgan",    name: "JPMorgan Chase (Browser)",  source_type: "browser", company_handle: "jpmorgan",        base_url: "https://careers.jpmorgan.com/us/en/jobs" },
  { id: "br-bofa",        name: "Bank of America (Browser)", source_type: "browser", company_handle: "bankofamerica",   base_url: "https://careers.bankofamerica.com/en-us/job-search" },
  { id: "br-morganstanley",name:"Morgan Stanley (Browser)",  source_type: "browser", company_handle: "morganstanley",   base_url: "https://jobs.morganstanley.com/search" },
  { id: "br-microsoft",   name: "Microsoft (Browser)",       source_type: "browser", company_handle: "microsoft",       base_url: "https://careers.microsoft.com/v2/global/en/search" },
  { id: "br-google",      name: "Google (Browser)",          source_type: "browser", company_handle: "google",          base_url: "https://careers.google.com/jobs/results" },
  { id: "br-meta",        name: "Meta (Browser)",            source_type: "browser", company_handle: "meta",            base_url: "https://www.metacareers.com/jobs" },
  { id: "br-ibm",         name: "IBM (Browser)",             source_type: "browser", company_handle: "ibm",             base_url: "https://www.ibm.com/careers/search" },
  { id: "br-oracle",      name: "Oracle (Browser)",          source_type: "browser", company_handle: "oracle",          base_url: "https://careers.oracle.com/jobs" },
  { id: "br-bestbuy",     name: "Best Buy (Browser)",        source_type: "browser", company_handle: "bestbuy",         base_url: "https://jobs.bestbuy.com/bby/jobs" },
  { id: "br-kroger",      name: "Kroger (Browser)",          source_type: "browser", company_handle: "kroger",          base_url: "https://jobs.kroger.com/jobs" },
  { id: "br-costco",      name: "Costco (Browser)",          source_type: "browser", company_handle: "costco",          base_url: "https://www.costco.com/jobs.html" },
  { id: "br-albertsons",  name: "Albertsons (Browser)",      source_type: "browser", company_handle: "albertsons",      base_url: "https://jobs.albertsons.com/search-jobs" },
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
  { slug: "clay",             name: "Clay",             website_url: "https://clay.earth"            },
  { slug: "hex",              name: "Hex",              website_url: "https://hex.tech"              },
];

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
           updated_at  = excluded.updated_at`
      )
      .bind(crypto.randomUUID(), hint.name, hint.slug, hint.website_url, now, now)
      .run();
  }
}

/** Source IDs that consistently 404 or fail — disabled to avoid cron noise. */
const DISABLED_SOURCE_IDS = [
  "apl-global",       // Apple API 301→pagenotfound (endpoint deprecated)
  "wb-taxfix",        // Workable 404; no public ATS API found
  "gh-notion",        // Greenhouse 404; Notion uses Ashby (ab-notion)
  "gh-linear",        // Greenhouse 404; Linear uses Ashby (ab-linear)
  "gh-shopify",       // Greenhouse 404; Shopify uses Ashby but handle unknown
  "wb-papayaglobal",  // Workable 404; no public ATS API found
  "wb-shopify",       // Workable returns empty; no working API
  "br-augment",       // Browser 429 rate limit; no public ATS
  "br-figma",         // Browser 429; use gh-figma (Greenhouse) instead
  "br-linear",        // Browser 429; use ab-linear (Ashby) instead
  "br-ada",           // Browser 429; use gh-ada (Greenhouse) instead
  "br-hippocratic",   // Browser 429; Ashby handle unknown
  "ps-n26",           // Personio 429 rate limit (temporary)
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

  const batch = SEED_SOURCES.map((s) =>
    stmt.bind(s.id, s.name, s.source_type, s.company_handle, s.base_url, now)
  );

  await db.batch(batch);

  for (const id of DISABLED_SOURCE_IDS) {
    await db.prepare("UPDATE sources SET enabled = 0 WHERE id = ?").bind(id).run();
  }
}
