/**
 * Geocoding cost routing (ingestion `runner.ts` Phase 4b).
 *
 * Major metros otherwise use Mapbox then Google Places for "{Company} {City, ST}".
 * Blacklisted companies skip that tier and use Photon (city-level OSM).
 *
 * RETAIL_GEOCODE_SLUGS — high-volume retail and franchise employers plus luxury fashion/beauty
 * cohort (LVMH maisons, SF RMK, Workday Tapestry/Capri, Symphony BBW, Eightfold Sephora/ELC, etc.).
 * Slugs are `slugify(company_name)` as stored on jobs (see `runner.ts` Phase 4b). Refresh footprint:
 * `npm run analyze:metro-footprint` (D1 remote).
 *
 * Detection:
 *   1. Company slug in RETAIL_GEOCODE_SLUGS → Photon for company+city (even in major metros).
 *   2. Any job title at that (company, location) matches RETAIL_TITLE_RE → same.
 *
 * Slugs must match `companies.slug` exactly.
 */
export const RETAIL_GEOCODE_SLUGS: ReadonlySet<string> = new Set([
  "adidas",
  "albertsons-companies",
  "alo-yoga",
  "aramark",
  "att",
  "autozone",
  "bank-of-america",
  "bath-body-works",
  "benefit-cosmetics",
  "berluti",
  "bulgari",
  "bvlgari",
  "capri-holdings-michael-kors",
  "carvana",
  "celine",
  "chaumet",
  "christian-dior",
  "coty",
  "cvs-health",
  "danaher",
  "dfs",
  "dior",
  "dollar-general",
  "dollar-tree-family-dollar",
  "dominos-pizza",
  "doordash",
  "este-lauder-companies",
  "executive-office-for-us-attorneys-and-the-office-of-the-us-attorneys",
  "fashion-nova",
  "fendi",
  "fenty-beauty",
  "fresh",
  "givenchy",
  "glossier",
  "gorjana",
  "guerlain",
  "hm-group",
  "hublot",
  "iqvia",
  "jcpenney",
  "jll",
  "johnson-johnson",
  "jpmorgan-chase",
  "kenzo",
  "kroger",
  "leidos",
  "loewe",
  "loro-piana",
  "louis-vuitton",
  "lush-cosmetics",
  "lvmh",
  "macys",
  "make-up-for-ever",
  "marc-jacobs",
  "marriott",
  "morgan-stanley",
  "moynat",
  "nordstrom",
  "olive-garden",
  "parfums-christian-dior",
  "pepsico",
  "raising-canes",
  "reformation",
  "republic-services",
  "rimowa",
  "ross-dress-for-less",
  "ruths-chris-steak-house",
  "sephora",
  "shiseido",
  "skims",
  "sprouts-farmers-market",
  "staples",
  "starbucks",
  "stryker",
  "tag-heuer",
  "tapestry-coach-kate-spade-stuart-weitzman",
  "the-capital-grille",
  "the-este-lauder-companies-inc",
  "thermo-fisher",
  "tiffany-co",
  "tjx-companies",
  "toast",
  "tsys-global-payments",
  "ulta-beauty",
  "unitedhealthgroup",
  "us-bancorp",
  "veterans-health-administration",
  "vf-corp-tnfvanstimberland",
  "wells-fargo",
  "zenith",
]);

/**
 * Retail-style job titles → Photon for that (company, location) even if the slug is unlisted.
 */
export const RETAIL_TITLE_RE =
  /\b(?:delivery\s+driver|barista|cashier|store\s+(?:manager|associate|clerk|supervisor)|crew\s+(?:member|worker|trainer)|shift\s+(?:supervisor|leader|manager)|team\s+member|sales\s+associate|retail\s+associate|grocery\s+(?:clerk|associate)|restaurant\s+(?:manager|supervisor)|assistant\s+(?:store\s+)?manager|guest\s+advocate|food\s+service|cake\s+decorator|stocker|stock\s+(?:clerk|associate)|warehouse\s+associate|package\s+handler|delivery\s+associate|pharmacy\s+(?:tech|technician)|courtesy\s+clerk|fuel\s+attendant|line\s+cook|dishwasher|drive.thru|meat\s+(?:cutter|clerk)|floral\s+(?:designer|associate)|lube\s+tech(?:nician)?|tire\s+tech(?:nician)?|optical\s+(?:sales\s+)?associate|optician|deli\s+(?:clerk|associate)|produce\s+(?:clerk|associate)|bakery\s+(?:clerk|associate)|front\s+end\s+(?:clerk|associate)|service\s+deli|photo\s+specialist|key\s+holder|beauty\s+advisor|fragrance\s+(?:advisor|specialist)|stylist\s+associate|pet\s+care\s+(?:specialist|associate)|kennel\s+(?:attendant|tech)|automotive\s+(?:technician|advisor|sales)|tire\s+lube\s+express|repair\s+technician|installation\s+technician)\b/i;
