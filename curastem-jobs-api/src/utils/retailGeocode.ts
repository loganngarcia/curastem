/**
 * Two-tier geocoding routing for map accuracy vs. cost optimization.
 *
 * Corporate/office jobs → Google Maps Places API ("{Company} {City, ST}")
 *   Precise building-level coords matter when professionals filter "jobs near me".
 *
 * Retail/franchise jobs → Photon (free OSM city-level)
 *   City-level accuracy is sufficient: a "Barista, Denver CO" posting doesn't
 *   need the exact Starbucks address since the location field only has the city.
 *   High-volume retail listings cost more in Places API credits than they deliver
 *   in applicant value — these roles get fewer map-based applicants anyway.
 *
 * Detection is two-pass:
 *   1. Company slug in RETAIL_GEOCODE_SLUGS → always Photon regardless of title.
 *   2. Job title matches RETAIL_TITLE_RE → Photon even for unlisted companies.
 *      This catches smaller chains not explicitly listed above.
 */

/**
 * Companies whose jobs should use city-level Photon geocoding instead of
 * Google Maps Places API. Criteria: high posting volume, city-only ATS locations,
 * lower expected applicant interest per specific location.
 *
 * Slugs must match the `companies.slug` column exactly.
 */
export const RETAIL_GEOCODE_SLUGS: ReadonlySet<string> = new Set([
  // Coffee / fast food
  "starbucks",
  "mcdonalds",
  "mcdonald",
  "dominos-pizza",
  "dominos",
  "dunkin",
  "dunkin-donuts",
  "subway",
  "chick-fil-a",
  "taco-bell",
  "burger-king",
  "wendys",
  "chipotle",
  "panera-bread",
  "papa-johns",
  "pizza-hut",
  "kfc",
  "sonic",
  "popeyes",
  "jack-in-the-box",
  "arbys",
  "dairy-queen",
  "whataburger",
  "five-guys",
  "shake-shack",
  "wingstop",
  "raising-canes",
  "culvers",
  "firehouse-subs",
  "jersey-mikes",
  "jimmy-johns",
  "wingstop",
  "buffalo-wild-wings",
  "red-robin",
  "denny",
  "dennys",
  "waffle-house",
  "cracker-barrel",
  "ihop",
  "olive-garden",
  "applebees",
  "chilis",
  "tgif",
  "tgi-fridays",
  "outback-steakhouse",

  // Grocery / convenience
  "kroger",
  "albertsons",
  "sprouts-farmers-market",
  "heb",
  "meijer",
  "aldi",
  "aldi-usa",
  "whole-foods",
  "publix",
  "safeway",
  "giant-eagle",
  "wawa",
  "sheetz",
  "7-eleven",
  "casey",
  "caseys",
  "circle-k",
  "rutter",
  "rutters",

  // Big box / department
  "walmart",
  "target",
  "costco",
  "home-depot",
  "lowes",
  "jcpenney",
  "kohls",
  "macys",
  "nordstrom",
  "tjx-companies", // actual DB slug — parent of T.J. Maxx, Marshalls, HomeGoods
  "tj-maxx",
  "tjx",
  "marshalls",
  "ross",
  "ross-dress-for-less",
  "burlington",
  "sears",
  "jcrew",
  "staples",        // 700 unique locations — office supply retail
  "primark",        // 186 unique locations — fast fashion

  // Drug / dollar
  "cvs-health",
  "cvs-pharmacy",
  "walgreens",
  "rite-aid",
  "dollar-general",
  "dollar-tree",
  "family-dollar",
  "dollar-tree-family-dollar",
  "five-below",

  // Specialty retail
  "ulta-beauty",
  "bath-and-body-works",
  "victoria-secret",
  "american-eagle",
  "gap",
  "old-navy",
  "banana-republic",
  "hm-group",       // actual DB slug for H&M Group (514 unique locs)
  "h-and-m",
  "zara",
  "uniqlo",
  "forever-21",
  "express",
  "hollister",
  "abercrombie-fitch",
  "hot-topic",
  "foot-locker",
  "janie-and-jack",
  "michaels",
  "alo-yoga",       // boutique retail (27 locs)

  // Auto / gas
  "autozone",
  "oreilly-auto-parts",
  "advance-auto-parts",
  "napa-auto-parts",
  "jiffy-lube",
  "firestone",
  "goodyear",
  "valvoline",
  "pepboys",
  "pep-boys",
  "midas",
  "safelite",

  // Pet / outdoor / sporting
  "petco",
  "petsmart",
  "rei",
  "bass-pro-shops",
  "cabelas",

  "dicks-sporting-goods",
  "academy-sports",

  // Logistics (volume delivery roles)
  "fedex",
  "ups",
  "usps",
  "amazon",

  // Home improvement / hardware
  "ace-hardware",
  "menards",
  "fastenal",

  // Healthcare — high-volume distributed clinics; city-level sufficient for job search
  "davita",   // 1,413 dialysis clinics nationwide

  // Staffing / security services — placements/sites are city-scoped by nature
  "pulse",
  "securitas",

  // Mixed retail brands — title regex catches most; add slugs for safety
  "nike",                    // mostly retail stores
  "vf-corp-tnfvanstimberland", // North Face / Vans / Timberland stores
  "comcast",                 // service centers + call centers
  "labcorp",                 // lab testing sites, many per city

  // Government / military — city or region is sufficient for recruitment
  "national-park-service",
  "army-national-guard-units",
  "transportation-security-administration",
  "bureau-of-prisonsfederal-prison-system",
  "us-army-reserve-command",

  // Distribution / food — city-level fine for driver/warehouse roles
  "sysco",
  "pepsico",           // high-volume manufacturing + distribution roles
  "rtx-raytheon",     // large enough footprint that city is practical

  // Automotive retail
  "carvana",
]);

/**
 * Job title patterns that route any company's jobs to city-level Photon geocoding,
 * even if the company slug isn't in RETAIL_GEOCODE_SLUGS above.
 *
 * Rationale: a "Store Associate" posting at an unrecognized chain is still a
 * retail role where city-level precision is sufficient and cost is unjustified.
 * Titles like "Software Engineer" or "Financial Analyst" are never matched.
 */
export const RETAIL_TITLE_RE =
  /\b(?:delivery\s+driver|barista|cashier|store\s+(?:manager|associate|clerk|supervisor)|crew\s+(?:member|worker|trainer)|shift\s+(?:supervisor|leader|manager)|team\s+member|sales\s+associate|retail\s+associate|grocery\s+(?:clerk|associate)|restaurant\s+(?:manager|supervisor)|assistant\s+(?:store\s+)?manager|guest\s+advocate|food\s+service|cake\s+decorator|stocker|stock\s+(?:clerk|associate)|warehouse\s+associate|package\s+handler|delivery\s+associate|pharmacy\s+(?:tech|technician)|courtesy\s+clerk|fuel\s+attendant|line\s+cook|dishwasher|drive.thru|meat\s+(?:cutter|clerk)|floral\s+(?:designer|associate)|lube\s+tech(?:nician)?|tire\s+tech(?:nician)?|optical\s+(?:sales\s+)?associate|optician|deli\s+(?:clerk|associate)|produce\s+(?:clerk|associate)|bakery\s+(?:clerk|associate)|front\s+end\s+(?:clerk|associate)|service\s+deli|photo\s+specialist|key\s+holder|beauty\s+advisor|fragrance\s+(?:advisor|specialist)|stylist\s+associate|pet\s+care\s+(?:specialist|associate)|kennel\s+(?:attendant|tech)|automotive\s+(?:technician|advisor|sales)|tire\s+lube\s+express|repair\s+technician|installation\s+technician)\b/i;
