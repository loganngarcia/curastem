/**
 * Pre-normalization for ATS-specific location junk before {@link normalizeLocation}.
 *
 * Rules are tuned from live D1 samples (Cloudflare MCP / wrangler queries): Amazon, Micron,
 * RTX, Northrop, CVS, etc. We **reformat** strings and drop site/building suffixes when a
 * real city is already present — we do **not** invent a city name that never appeared in
 * the source (e.g. `US, WA` → `Washington, USA`, not a random metro).
 */

/** US state / territory name → USPS abbreviation (lowercase keys). */
const US_STATE_NAME_TO_ABBREV: Record<string, string> = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
  "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
  "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
  "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
  "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
  "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
  "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
  "district of columbia": "DC", "puerto rico": "PR",
};

/** `US, ST` with no city → state-level region for geocoding (never a made-up metro). */
const US_ST_TO_REGION: Record<string, string> = {
  AL: "Alabama, USA", AK: "Alaska, USA", AZ: "Arizona, USA", AR: "Arkansas, USA", CA: "California, USA",
  CO: "Colorado, USA", CT: "Connecticut, USA", DE: "Delaware, USA", FL: "Florida, USA", GA: "Georgia, USA",
  HI: "Hawaii, USA", ID: "Idaho, USA", IL: "Illinois, USA", IN: "Indiana, USA", IA: "Iowa, USA",
  KS: "Kansas, USA", KY: "Kentucky, USA", LA: "Louisiana, USA", ME: "Maine, USA", MD: "Maryland, USA",
  MA: "Massachusetts, USA", MI: "Michigan, USA", MN: "Minnesota, USA", MS: "Mississippi, USA", MO: "Missouri, USA",
  MT: "Montana, USA", NE: "Nebraska, USA", NV: "Nevada, USA", NH: "New Hampshire, USA", NJ: "New Jersey, USA",
  NM: "New Mexico, USA", NY: "New York, USA", NC: "North Carolina, USA", ND: "North Dakota, USA", OH: "Ohio, USA",
  OK: "Oklahoma, USA", OR: "Oregon, USA", PA: "Pennsylvania, USA", RI: "Rhode Island, USA", SC: "South Carolina, USA",
  SD: "South Dakota, USA", TN: "Tennessee, USA", TX: "Texas, USA", UT: "Utah, USA", VT: "Vermont, USA",
  VA: "Virginia, USA", WA: "Washington, USA", WV: "West Virginia, USA", WI: "Wisconsin, USA", WY: "Wyoming, USA",
  DC: "District of Columbia, USA", PR: "Puerto Rico, USA",
};

const US_STATE_ABBREV_SET = new Set(Object.keys(US_ST_TO_REGION));

/** Lowercase full US state names — skip stripping "California, US" so normalize can emit "California, USA". */
const US_STATE_FULL_NAME_SET = new Set(Object.keys(US_STATE_NAME_TO_ABBREV));

/** Canada: `CA, ON` (country, province) — ISO province → name, no invented city. */
const CA_PROVINCE_NAME: Record<string, string> = {
  ON: "Ontario", BC: "British Columbia", AB: "Alberta", QC: "Quebec", MB: "Manitoba", SK: "Saskatchewan",
  NS: "Nova Scotia", NB: "New Brunswick", NL: "Newfoundland and Labrador", PE: "Prince Edward Island",
  NT: "Northwest Territories", YT: "Yukon", NU: "Nunavut",
};

/** Germany: `DE, HE` Bundesland codes → region, no invented city. */
const DE_STATE_CODE_TO_REGION: Record<string, string> = {
  BW: "Baden-Württemberg, Germany", BY: "Bavaria, Germany", BE: "Berlin, Germany", BB: "Brandenburg, Germany",
  HB: "Bremen, Germany", HH: "Hamburg, Germany", HE: "Hesse, Germany", MV: "Mecklenburg-Vorpommern, Germany",
  NI: "Lower Saxony, Germany", NW: "North Rhine-Westphalia, Germany", RP: "Rhineland-Palatinate, Germany",
  SL: "Saarland, Germany", SN: "Saxony, Germany", ST: "Saxony-Anhalt, Germany", SH: "Schleswig-Holstein, Germany",
  TH: "Thuringia, Germany",
};

/**
 * LinkedIn / ATS regional blobs — explicit map only (city/metro appears in the marketing name).
 */
const REGION_LABEL_TO_CANONICAL: Record<string, string> = {
  "greater seattle area": "Seattle, WA",
  "sf bay area": "San Francisco, CA",
  "bay area, ca": "San Francisco, CA",
  "new york city area": "New York, NY",
  "washington d.c. metro area": "Washington, DC",
  "greater london": "London, United Kingdom",
  "greater manchester": "Manchester, United Kingdom",
  "greater los angeles area": "Los Angeles, CA",
  "hyderabad area": "Hyderabad, India",
  "chennai area": "Chennai, India",
  "pune area": "Pune, India",
  "bengaluru area": "Bengaluru, India",
  "mumbai area": "Mumbai, India",
  "guadalajara area": "Guadalajara, Mexico",
  "bogotá d.c. area": "Bogotá, Colombia",
  "bogota d.c. area": "Bogotá, Colombia",
};

/** MGM Las Vegas properties → strip to metro for geocoding. */
const MGM_PROPERTY_CITIES: Record<string, string> = {
  "bellagio": "Las Vegas, NV",
  "the cosmopolitan": "Las Vegas, NV",
  "cosmopolitan": "Las Vegas, NV",
  "aria": "Las Vegas, NV",
  "mgm grand": "Las Vegas, NV",
  "park mgm": "Las Vegas, NV",
  "new york-new york": "Las Vegas, NV",
  "excalibur": "Las Vegas, NV",
  "luxor": "Las Vegas, NV",
  "mandalay bay": "Las Vegas, NV",
  "delano": "Las Vegas, NV",
  "v dara": "Las Vegas, NV",
  "vdara": "Las Vegas, NV",
};

/**
 * "USA - Maryland - Baltimore", "USA - NY - Flushing - 123 Main" → City, ST (drops trailing address tokens).
 * Runs before the generic "USA - place - org" rule so we never emit "Maryland, USA".
 */
function parseUsaStateCityChain(t: string): string | null {
  const u = t.trim();
  if (!/^USA\s*-/i.test(u)) return null;
  const rest = u.replace(/^USA\s*-\s*/i, "").trim();
  const parts = rest.split(/\s*-\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  while (parts.length > 2 && /^\d/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  if (parts.length < 2) return null;
  const p0 = parts[0];
  if (/^washington\s+dc$/i.test(p0)) return "Washington, DC";
  if (/^deer\s+park$/i.test(p0) && /biosystems/i.test(parts.slice(1).join(" "))) {
    return "Deer Park, NY";
  }
  let st: string | null = null;
  if (/^[A-Z]{2}$/i.test(p0)) st = p0.toUpperCase();
  else st = US_STATE_NAME_TO_ABBREV[p0.toLowerCase()] ?? null;
  if (st && US_STATE_ABBREV_SET.has(st)) {
    const cityRaw = parts.slice(1).join(" ");
    const cityOnly = cityRaw.split(",")[0].trim();
    // Research Triangle Park — ATS uses "RTP" as city token
    if (/^rtp$/i.test(cityOnly)) return "Durham, NC";
    return `${titleCaseCity(cityOnly)}, ${st}`;
  }
  return null;
}

function titleCaseCity(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      if (!w.length) return w;
      if (w.includes("-")) {
        return w
          .split("-")
          .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p))
          .join("-");
      }
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/** Strip internal site / building suffix after "City, ST" (Micron, retail, etc.). */
function stripSiteSuffixAfterCityState(t: string): string {
  const idx = t.indexOf(" - ");
  if (idx <= 0) return t;
  if (!t.includes(",")) return t;
  const commaIdx = t.indexOf(",");
  if (commaIdx < 0 || commaIdx > idx) return t;
  return t.slice(0, idx).trim();
}

/**
 * RTX / Pratt site codes: US-CT-EAST HARTFORD-ETC ~ … → city comes from segments (not invented).
 */
function parseUsRtxSiteCode(t: string): string | null {
  const head = t.split("~")[0].trim();
  const m = head.match(/^US-([A-Z]{2})-(.+)$/i);
  if (!m) return null;
  const st = m[1].toUpperCase();
  if (!US_STATE_ABBREV_SET.has(st)) return null;
  const rest = m[2];
  const segments = rest.split("-").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;
  const last = segments[segments.length - 1];
  const looksLikeSiteCode =
    /^\d+[A-Z0-9]*$/i.test(last) ||
    /^(ETC|AN1|ESSEX|MPC|BLDG)$/i.test(last) ||
    (last.length <= 4 && /^[A-Z0-9]+$/i.test(last));
  if (!looksLikeSiteCode) return null;
  const cityRaw = segments.slice(0, -1).join(" ");
  if (!cityRaw) return null;
  return `${titleCaseCity(cityRaw)}, ${st}`;
}

/**
 * New Zealand Workday site codes: NZ-CAN-CHRISTCHURCH-115-1 ~ … (CAN = Canterbury region code).
 */
function parseNzWorkdaySite(t: string): string | null {
  const head = t.split("~")[0].trim();
  const m = head.match(/^NZ-[A-Z]{2,4}-([A-Za-z]+)-\d+/i);
  if (!m) return null;
  return `${titleCaseCity(m[1])}, New Zealand`;
}

/**
 * Philippines site codes: PH-BTG-TANAUAN CITY-BQ4 ~ … — city tokens are in the hyphen chain.
 */
function parsePhRtxSite(t: string): string | null {
  const head = t.split("~")[0].trim();
  if (!/^PH-/i.test(head)) return null;
  const segments = head.split("-").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 4 || segments[0].toUpperCase() !== "PH") return null;
  const cityTokens = segments.slice(2, -1);
  if (cityTokens.length === 0) return null;
  const city = cityTokens.join(" ");
  return `${titleCaseCity(city)}, Philippines`;
}

/** Poland: PL-18-RZESZOW-120 ~ … */
function parsePlRtxSite(t: string): string | null {
  const m = t.match(/^PL-\d+-([A-Z]+)-/i);
  if (!m) return null;
  return `${titleCaseCity(m[1])}, Poland`;
}

/** Mexico: MX-BCN-MEXICALI-496 ~ … */
function parseMxRtxSite(t: string): string | null {
  const head = t.split("~")[0].trim();
  const m = head.match(/^MX-[A-Z]{2,4}-([A-Za-z\s]+)-/i);
  if (!m) return null;
  return `${titleCaseCity(m[1].trim())}, Mexico`;
}

/**
 * US-CA-Menlo Park (city in string, no site-code segment) — common in Meta/RTX exports.
 */
function parseUsStateCityPlain(t: string): string | null {
  const head = t.split("~")[0].trim();
  const m = head.match(/^US-([A-Z]{2})-([^~]+)$/i);
  if (!m) return null;
  const st = m[1].toUpperCase();
  if (!US_STATE_ABBREV_SET.has(st)) return null;
  const rest = m[2].trim();
  if (rest.includes("-")) return null;
  if (!rest) return null;
  return `${titleCaseCity(rest)}, ${st}`;
}

/** ALL-CAPS placenames (LONDON, TARRYTOWN, SLEEPY HOLLOW) — formatting only, no new geography. */
function decapsShoutingPlace(t: string): string | null {
  const u = t.trim();
  if (u.length < 5) return null;
  if (!/^[A-Z][A-Z\s'-]+$/.test(u)) return null;
  if (!/\s/.test(u) && u.length <= 4) return null;
  return titleCaseCity(u);
}

/**
 * Apply ATS / company-specific fixes to a trimmed location string.
 * Returns the possibly rewritten string (always returns input if nothing matched).
 */
export function applyLocationPrePipeline(s: string, companySlug: string | null | undefined): string {
  let t = s;
  const slug = companySlug?.toLowerCase() ?? "";

  // ATS: "All Cities, TX" / "All Cities, British Columbia" — placeholder city; keep region only
  if (/^All Cities,\s*/i.test(t.trim())) {
    const rest = t.replace(/^All Cities,\s*/i, "").trim();
    if (/^[A-Z]{2}$/i.test(rest)) {
      const code = rest.toUpperCase();
      const usRegion = US_ST_TO_REGION[code];
      if (usRegion) return usRegion;
      const caName = CA_PROVINCE_NAME[code];
      if (caName) return `${caName}, Canada`;
    }
    if (/^British Columbia$/i.test(rest)) return "British Columbia, Canada";
    if (/^Ontario$/i.test(rest)) return "Ontario, Canada";
    if (/^Alberta$/i.test(rest)) return "Alberta, Canada";
    if (/^Quebec$/i.test(rest)) return "Quebec, Canada";
    t = rest;
  }

  // USPS-style "Ft." (Fort Worth, Fort Wayne) — comma often missing after Ft.
  t = t.replace(/\bFt\./gi, "Fort ");

  // "San Francisco, US" — strip trailing US token so bare city maps in normalize.
  // Keep "California, US" / "Texas, US" (bare state + country) for normalize → "State, USA".
  // "Illinois, US Offsite" → "Illinois, USA" (ATS hybrid label)
  t = t.replace(/,\s*US\s+Offsite$/i, ", USA").trim();
  {
    const m = t.match(/^(.+),\s*US\s*$/i);
    if (m) {
      const head = m[1].trim().toLowerCase();
      if (!US_STATE_FULL_NAME_SET.has(head)) t = m[1].trim();
    }
  }

  // ── Company-specific (run before destructive global rules) ────────────────
  if (slug === "mgm-resorts" || slug.startsWith("mgm-")) {
    const pm = t.match(/^property\s*-\s*(.+)$/i);
    if (pm) {
      const rest = pm[1].trim().toLowerCase();
      for (const [k, v] of Object.entries(MGM_PROPERTY_CITIES)) {
        if (rest.includes(k)) return v;
      }
      return "Las Vegas, NV";
    }
  }

  // Boeing / legacy: IND - Bangalore
  if (/^ind\s*-\s*bangalore$/i.test(t.trim())) return "Bengaluru, India";

  // ATS: "India, Pune" (country listed before city)
  const indiaCommaFirst = t.match(/^India,\s*(.+)$/i);
  if (indiaCommaFirst) {
    return `${titleCaseCity(indiaCommaFirst[1].trim())}, India`;
  }

  const mexCommaFirst = t.match(/^Mexico,\s*(.+)$/i);
  if (mexCommaFirst) {
    return `${titleCaseCity(mexCommaFirst[1].trim())}, Mexico`;
  }

  const crCommaFirst = t.match(/^Costa Rica,\s*(.+)$/i);
  if (crCommaFirst) {
    return `${titleCaseCity(crCommaFirst[1].trim())}, Costa Rica`;
  }

  // Workday / Oracle: "United States, San Mateo" (country before city — infer state when obvious)
  const usCommaFirst = t.match(/^United States,\s*(.+)$/i);
  if (usCommaFirst) {
    const rest = usCommaFirst[1].trim();
    if (/^san mateo$/i.test(rest)) return "San Mateo, CA";
    return `${titleCaseCity(rest)}, USA`;
  }

  // GE / ATS: "USA, Hartford" (no state in source — HQ is CT)
  if (/^USA,\s*Hartford\s*$/i.test(t.trim())) return "Hartford, CT";

  // Site code style: IND.Pune (country dot city)
  if (/^IND\.Pune$/i.test(t.trim())) return "Pune, India";

  // UK neighbourhood blob — Wimbledon is unambiguous vs "Georgia" country
  if (/^wimbledon,\s*south london$/i.test(t.trim())) return "Wimbledon, United Kingdom";

  // Georgian ATS noise (script + "Georgia" country) — keep capital for geocoding
  if (/^tbilisi\b/i.test(t.trim())) return "Tbilisi, Georgia";

  // Polish mojibake from bad UTF-8 in ATS exports
  if (/^lód\?,\s*lodzkie$/i.test(t.trim())) return "Łódź, Poland";

  // Ecolab / India: IND - State - City - Site
  if (/^IND\s*-\s*[^-]+\s*-\s*Bangalore\b/i.test(t)) return "Bengaluru, India";
  if (/^IND\s*-\s*Maharashtra\s*-\s*Pune\b/i.test(t)) return "Pune, India";

  // Chile: CHL - Region Metropolitana de Santiago - Santiago
  if (/^CHL\s*-\s*.+-\s*Santiago\b/i.test(t)) return "Santiago, Chile";

  // Broadcom-style: USA-CA San Jose Innovation Drive
  const usaSp = t.match(/^USA-([A-Z]{2})\s+([A-Za-z]+)\b/i);
  if (usaSp) return `${titleCaseCity(usaSp[2])}, ${usaSp[1].toUpperCase()}`;

  // "USA - Maryland - Baltimore", "USA - NY - Flushing - …" → City, ST (not "Maryland, USA")
  const usaChain = parseUsaStateCityChain(t);
  if (usaChain) return usaChain;

  // Workday / Danaher / Leica: "USA - Washington DC - Multiple-OpCo", "USA - Deer Park - Leica Biosystems"
  const usaPlaceOrg = t.match(/^USA\s*-\s*(.+?)\s*-\s*(.+)$/i);
  if (usaPlaceOrg) {
    const place = usaPlaceOrg[1].trim();
    const org = usaPlaceOrg[2].trim();
    if (/^washington\s+dc$/i.test(place)) return "Washington, DC";
    // Leica Biosystems HQ / lab — Long Island (not TX Deer Park)
    if (/^deer\s+park$/i.test(place) && /biosystems/i.test(org)) return "Deer Park, NY";
    return `${titleCaseCity(place)}, USA`;
  }

  // Leica / Singapore ISO: "SGP - Singapore - Leica Microsystems"
  const sgpPlaceOrg = t.match(/^SGP\s*-\s*(.+?)\s*-\s*(.+)$/i);
  if (sgpPlaceOrg) {
    const city = titleCaseCity(sgpPlaceOrg[1].trim());
    return `${city}, Singapore`;
  }

  // Sysco / Freshpoint (ATS — regional DC labels; Victoria = Sysco Canada on Vancouver Island)
  if (/^Freshpoint\s+Dallas$/i.test(t)) return "Dallas, TX";
  if (/^Sysco\s+Knoxville\s*-\s*Kingsport$/i.test(t)) return "Knoxville, TN";
  if (/^Sysco\s+Montana$/i.test(t)) return "Montana, USA";
  if (/^Sysco\s+Long\s+Island\s*-\s*Brooklyn\s+Yard$/i.test(t)) return "Brooklyn, NY";
  if (/^Sysco\s+Poland$/i.test(t)) return "Poland";
  if (/^Sysco\s+Hawaii\s*-\s*Oahu$/i.test(t)) return "Honolulu, HI";
  if (/^Sysco\s+Victoria$/i.test(t)) return "Victoria, BC";

  // UK - London (Expedia, etc.)
  const ukDash = t.match(/^UK\s*-\s*(.+)$/i);
  if (ukDash) return `${titleCaseCity(ukDash[1].trim())}, United Kingdom`;

  // VF Corp hierarchy: "USCA > USA > North Carolina > Charlotte 586 - VAN"
  const vfHier = t.match(/USCA\s*>\s*USA\s*>\s*(.+?)\s*>\s*([A-Za-z][A-Za-z\s]+?)\s+\d+\s*-/i);
  if (vfHier) {
    const stateName = vfHier[1].trim().toLowerCase();
    const cityFull = vfHier[2].trim();
    const st = US_STATE_NAME_TO_ABBREV[stateName];
    if (st) return `${titleCaseCity(cityFull)}, ${st}`;
  }

  // Boeing: "KOR - Seoul"
  if (/^KOR\s*-\s*Seoul\b/i.test(t.trim())) return "Seoul, South Korea";

  // Comcast retail: "FL - Palm Beach Gardens, 5300 … - Retail XFR…"
  const stCityComma = t.match(/^([A-Z]{2})\s*-\s*([^,]+),\s*.+/i);
  if (stCityComma && US_STATE_ABBREV_SET.has(stCityComma[1].toUpperCase())) {
    return `${titleCaseCity(stCityComma[2].trim())}, ${stCityComma[1].toUpperCase()}`;
  }

  // LinkedIn regional marketing names (D1: SF Bay Area, Greater Seattle, …)
  const regionKey = t.trim().toLowerCase();
  const regionCanon = REGION_LABEL_TO_CANONICAL[regionKey];
  if (regionCanon) return regionCanon;

  // "San Francisco Bay Area (San Mateo) or Boston …" — first office named in parens
  if (/san francisco bay area.*\(san mateo\)/i.test(t)) return "San Mateo, CA";

  // "Mumbai Area", "Stuttgart Area", "Fort Collins, Colorado Area" — drop suffix; city is in the string
  if (/\s+area$/i.test(t) && !/^greater\s/i.test(t.trim())) {
    const core = t.replace(/\s+Area$/i, "").trim();
    if (core.length >= 3) t = core;
  }

  // Amazon / ATS: country-only or region-only (no invented city)
  if (/^AU$/i.test(t)) return "Australia";
  if (/^US$/i.test(t)) return "United States";
  if (/^DE$/i.test(t)) return "Germany";
  if (/^GB$/i.test(t)) return "United Kingdom";

  // GB, London / GB, Swindon → City, UK (city already in string)
  const gbComma = t.match(/^GB,\s*(.+)$/i);
  if (gbComma) return `${titleCaseCity(gbComma[1].trim())}, United Kingdom`;

  // CA, ON / CA, BC (Amazon Canada — country CA conflicts with California; here "CA, XY" is Canada+province)
  const canCa = t.match(/^CA,\s*([A-Z]{2})\s*$/i);
  if (canCa) {
    const pr = canCa[1].toUpperCase();
    const name = CA_PROVINCE_NAME[pr];
    if (name) return `${name}, Canada`;
  }

  // DE, HE / DE, BY — German region codes
  const deComma = t.match(/^DE,\s*([A-Z]{2})\s*$/i);
  if (deComma) {
    const code = deComma[1].toUpperCase();
    const r = DE_STATE_CODE_TO_REGION[code];
    if (r) return r;
  }

  // DE, Kaiserslautern / DE, Contwig — city already after DE,
  const deCity = t.match(/^DE,\s*(.+)$/i);
  if (deCity && !/^([A-Z]{2})\s*$/i.test(deCity[1].trim())) {
    return `${titleCaseCity(deCity[1].trim())}, Germany`;
  }

  // US, Virtual → Remote
  if (/^US,\s*Virtual$/i.test(t)) return "Remote";

  // Pulse / UK: London, Greater London → London, United Kingdom
  if (/^(.+),\s*Greater London$/i.test(t)) {
    const city = t.replace(/,\s*Greater London$/i, "").trim();
    return `${titleCaseCity(city)}, United Kingdom`;
  }

  // Leading store / internal numeric prefix (e.g. DaVita) — keep text after code, not a new city
  t = t.replace(/^\d{3,6}\s*-\s*/i, "").trim();

  // ── Global: Boeing / Comcast style prefixes ─────────────────────────────────
  if (/^usa\s*-\s*/i.test(t)) {
    t = t.replace(/^usa\s*-\s*/i, "").trim();
  }

  // City, ST - site / fab / building (Micron "Boise, ID - Main Site", "Manassas, VA - Fab 6")
  if (/\s-\s/.test(t) && /,\s*[A-Z]{2}\s*-\s/i.test(t)) {
    t = stripSiteSuffixAfterCityState(t);
  }

  // India - Chennai, Long Corp Name…
  const indiaComma = t.match(/^india\s*-\s*([^,]+)\s*,/i);
  if (indiaComma) {
    const city = titleCaseCity(indiaComma[1].trim());
    return `${city}, India`;
  }
  if (/^india\s*-\s*/i.test(t) && !t.includes(",")) {
    const rest = t.replace(/^india\s*-\s*/i, "").trim();
    if (rest) return `${titleCaseCity(rest)}, India`;
  }

  // United States-California-San Diego
  const usDash = t.match(/^United States-([^-]+)-(.+)$/i);
  if (usDash) {
    const stateName = usDash[1].trim().toLowerCase();
    const cityPart = usDash[2].trim();
    const st = US_STATE_NAME_TO_ABBREV[stateName];
    if (st) return `${titleCaseCity(cityPart)}, ${st}`;
  }

  // PL-18-RZESZOW-120 (before US- patterns)
  const plR = parsePlRtxSite(t);
  if (plR) return plR;

  const mxR = parseMxRtxSite(t);
  if (mxR) return mxR;

  // PH-BTG-TANAUAN CITY-BQ4 ~ …
  const phR = parsePhRtxSite(t);
  if (phR) return phR;

  // NZ-CAN-CHRISTCHURCH-115-1 ~ … (before US- patterns)
  const nzW = parseNzWorkdaySite(t);
  if (nzW) return nzW;

  // US-CT-EAST HARTFORD-ETC ~ … (multi-word cities)
  const rtxMulti = parseUsRtxSiteCode(t);
  if (rtxMulti) return rtxMulti;

  // US-CA-Menlo Park — city only, no trailing site-code segment
  const usPlain = parseUsStateCityPlain(t);
  if (usPlain) return usPlain;

  // US-AZ-TUCSON-801 ~ … (single-token city)
  const rtx = t.match(/^US-([A-Z]{2})-([A-Za-z]+)-/i);
  if (rtx) {
    const st = rtx[1].toUpperCase();
    const cityRaw = rtx[2];
    const city = titleCaseCity(cityRaw);
    return `${city}, ${st}`;
  }

  // IN-KA-BENGALURU-NORTHGATE ~ …
  const inRegion = t.match(/^IN-([A-Z]{2})-([A-Za-z]+)-/i);
  if (inRegion) {
    const cityRaw = inRegion[2];
    const city = titleCaseCity(cityRaw);
    if (city.toLowerCase() === "bengaluru") return "Bengaluru, India";
    return `${city}, India`;
  }

  // CA-QC-LONGUEUIL-J01 ~ … (Canada — country code CA)
  const caProv = t.match(/^CA-([A-Z]{2})-([A-Za-zÀ-ÿ]+)-/i);
  if (caProv) {
    const pr = caProv[1].toUpperCase();
    const city = titleCaseCity(caProv[2]);
    if (pr === "QC") return `${city}, QC, Canada`;
    return `${city}, ${pr}, Canada`;
  }

  // TX-Houston / TX-San Antonio (hyphen — city appears in string)
  if (!/^IN-[A-Z]{2}-/i.test(t) && !/^US-/i.test(t) && !/^CA-[A-Z]{2}-/i.test(t)) {
    const hy = t.match(/^([A-Z]{2})-(.+)$/);
    if (hy && US_STATE_ABBREV_SET.has(hy[1].toUpperCase())) {
      const st = hy[1].toUpperCase();
      const cityPart = hy[2].replace(/\s*~.*$/, "").trim();
      return `${titleCaseCity(cityPart)}, ${st}`;
    }
  }

  // US - GA - Atlanta (Coca-Cola, etc.)
  const usDashStateCity = t.match(/^US\s*-\s*([A-Z]{2})\s*-\s*(.+)$/i);
  if (usDashStateCity) {
    const st = usDashStateCity[1].toUpperCase();
    const city = titleCaseCity(usDashStateCity[2].replace(/\s*~.*$/, "").trim());
    return `${city}, ${st}`;
  }

  // TX - Houston / IN - Indianapolis (CVS). Exclude leading "US" — misparse "US - GA".
  const stDashCity = t.match(/^([A-Z]{2})\s*-\s*(.+)$/);
  if (stDashCity && !/^US$/i.test(stDashCity[1])) {
    const st = stDashCity[1].toUpperCase();
    if (st.length === 2 && US_STATE_ABBREV_SET.has(st)) {
      let cityPart = stDashCity[2].replace(/\s*~.*$/, "").trim();
      cityPart = cityPart.replace(/\s+\d{5}(-\d{4})?$/, "").trim();
      return `${titleCaseCity(cityPart)}, ${st}`;
    }
  }

  // Eli Lilly: US, Indianapolis IN
  const usCitySt = t.match(/^US,\s*(.+?)\s+([A-Z]{2})\s*$/i);
  if (usCitySt) {
    const st = usCitySt[2].toUpperCase();
    const city = titleCaseCity(usCitySt[1].trim());
    return `${city}, ${st}`;
  }

  // Washington - Seattle → Seattle, WA (Expedia and similar)
  const stateDashCity = t.match(/^(Washington|Minnesota|Georgia|Colorado)\s*-\s*(.+)$/i);
  if (stateDashCity) {
    const map: Record<string, string> = {
      washington: "WA",
      minnesota: "MN",
      georgia: "GA",
      colorado: "CO",
    };
    const st = map[stateDashCity[1].toLowerCase()];
    if (st) return `${titleCaseCity(stateDashCity[2].trim())}, ${st}`;
  }

  // US, WA — state-only: use state name + USA (never an invented metro)
  const usCommaSt = t.match(/^US,\s*([A-Z]{2})\s*$/i);
  if (usCommaSt) {
    const st = usCommaSt[1].toUpperCase();
    const region = US_ST_TO_REGION[st];
    if (region) return region;
  }

  // Micron: bare Mexican state (no city in source)
  if (/^Jalisco$/i.test(t.trim())) return "Jalisco, Mexico";

  // Indian state only (no city in source)
  if (/^Karnataka$/i.test(t.trim())) return "Karnataka, India";

  // CVS / Longs internal store code already stripped above — entity string is state-level
  if (/^Longs\s+Drug\s+Stores\s+California\b/i.test(t.trim())) return "California, USA";

  // Region strings where a real placename appears in the label
  if (/^dubai emirate$/i.test(t.trim())) return "Dubai, United Arab Emirates";

  // Micron / fabs: Hiroshima - Fab 15 (city in string)
  const fab = t.match(/^(.+?)\s*-\s*Fab\s*\d+/i);
  if (fab) {
    const place = fab[1].trim();
    if (/hiroshima/i.test(place)) return "Hiroshima, Japan";
    if (/taichung/i.test(place)) return "Taichung, Taiwan";
    if (/taoyuan/i.test(place)) return "Taoyuan, Taiwan";
    return titleCaseCity(place);
  }

  // Hyderabad - Phoenix Aquila
  if (/^hyderabad\s*-\s*/i.test(t)) return "Hyderabad, India";
  // Micron / TSMC site labels
  if (/^hyderabad\s+knowledge\s+city$/i.test(t.trim())) return "Hyderabad, India";

  const decap = decapsShoutingPlace(t);
  if (decap) return decap;

  return t;
}
