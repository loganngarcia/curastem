#!/usr/bin/env python3
"""
backfill.py — Force-ingest sources and geocode jobs in production D1 from your local machine.

No 90-second Worker timeout here: fetches everything locally, then writes
directly into D1 via wrangler. After each source, last_fetched_at is set so
the cron skips it for the configured interval — freeing up cron cycles for
other sources.

Ingestion usage:
    python3 backfill.py                          # all sources
    python3 backfill.py wd-petco wd-nordstrom    # specific source IDs
    python3 backfill.py --limit 200              # cap jobs per source (faster test)
    python3 backfill.py --type workday           # only sources of a given type

Geocoding usage (separate mode, runs after ingestion):
    python3 backfill.py --geocode                            # all ungeocoded jobs, Photon only (free)
    python3 backfill.py --geocode --maps-key=AIza...         # Photon for retail + Places API for corporate

Geocoding two-tier routing:
    Retail companies / retail job titles → Photon (free OSM, city-level)
    Professional companies               → Google Maps Places API (precise building coords)
    Places API cap: 8 125 calls ≈ $260; anything beyond falls back to Photon automatically.
"""

import sys, os, json, re, uuid, hashlib, subprocess, time, tempfile
import urllib.request, urllib.error, urllib.parse, http.cookiejar
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from datetime import datetime, timezone

# Force line-buffered output so progress is visible when stdout is redirected.
sys.stdout.reconfigure(line_buffering=True)

# ── Source Definitions ────────────────────────────────────────────────────────
# Each entry: (source_id, company_handle, display_name, url)

WORKDAY_SOURCES = [
    # Walmart store + field + many corporate roles — careers.walmart.com is Next.js; Workday CXS is the stable JSON feed.
    ("wd-walmart",      "walmart",            "Walmart",              "https://walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternal/jobs"),
    ("wd-petco",        "petco",              "Petco",                "https://petco.wd1.myworkdayjobs.com/wday/cxs/petco/External/jobs"),
    ("wd-nordstrom",    "nordstrom",          "Nordstrom",            "https://nordstrom.wd501.myworkdayjobs.com/wday/cxs/nordstrom/nordstrom_careers/jobs"),
    ("wd-bofa",         "bank-of-america",    "Bank of America",      "https://ghr.wd1.myworkdayjobs.com/wday/cxs/ghr/lateral-us/jobs"),
    ("wd-dsg",          "dicks-sporting-goods","Dick's Sporting Goods","https://dickssportinggoods.wd1.myworkdayjobs.com/wday/cxs/dickssportinggoods/DSG/jobs"),
    ("wd-meijer",       "meijer",             "Meijer",               "https://meijer.wd5.myworkdayjobs.com/wday/cxs/meijer/Meijer_Stores_Hourly/jobs"),
    ("wd-morganstanley","morgan-stanley",     "Morgan Stanley",       "https://ms.wd5.myworkdayjobs.com/wday/cxs/ms/External/jobs"),
    ("wd-fedex",        "fedex",              "FedEx",                "https://fedex.wd1.myworkdayjobs.com/wday/cxs/fedex/FXE-LAC_External_Career_Site/jobs"),
]

ORACLE_CE_SOURCES = [
    ("oc-kroger",    "kroger",              "Kroger",                "https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001"),
    ("oc-macys",     "macys",              "Macy's",               "https://ebwh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001"),
    ("oc-albertsons","albertsons",          "Albertsons Companies",  "https://eofd.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001"),
    ("oc-autozone",  "autozone",            "AutoZone",              "https://careers.autozone.com/hcmUI/CandidateExperience/en/sites/CX_1"),
    ("oc-staples",   "staples",             "Staples",               "https://fa-exhh-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/StaplesInc"),
    ("ce-marriott",  "marriott",            "Marriott",              "https://ejwl.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/MI_CS_1"),
]

ARAMARK_SOURCES = [
    ("ar-aramark", "aramark", "Aramark", "https://careers.aramark.com/wp-json/aramark/jobs"),
]

# Oracle Activate — Darden restaurant portfolio + Ross (see activate_careers.ts).
# Corporate RSC (dardenrscjobs.recruiting.com) is Paradox SPA-only; no public Search/SearchResults API.
ACTIVATE_SOURCES = [
    ("act-ross", "ross-stores", "Ross Dress for Less", "https://jobs.rossstores.com"),
    ("act-darden-olivegarden", "olive-garden", "Olive Garden", "https://jobs.olivegarden.com"),
    ("act-darden-yardhouse", "yard-house", "Yard House", "https://careers.yardhouse.com"),
    ("act-darden-longhorn", "longhorn-steakhouse", "LongHorn Steakhouse", "https://jobs.longhornsteakhouse.com"),
    ("act-darden-cheddars", "cheddars-scratch-kitchen", "Cheddar's Scratch Kitchen", "https://careers.cheddars.com"),
    ("act-darden-ruthschris", "ruths-chris-steak-house", "Ruth's Chris Steak House", "https://careers.ruthschris.com"),
    ("act-darden-capitalgrille", "the-capital-grille", "The Capital Grille", "https://careers.thecapitalgrille.com"),
    ("act-darden-chuys", "chuys", "Chuy's", "https://careers.chuys.com"),
    ("act-darden-seasons52", "seasons-52", "Seasons 52", "https://careers.seasons52.com"),
    ("act-darden-eddiev", "eddie-vs-prime-seafood", "Eddie V's Prime Seafood", "https://careers.eddiev.com"),
    ("act-darden-bahamabreeze", "bahama-breeze", "Bahama Breeze", "https://jobs.bahamabreeze.com"),
]

JIBE_SOURCES = [
    ("jibe-heb",           "heb",                   "H-E-B",                   "https://careers.heb.com"),
    ("jibe-dollargeneral", "dollar-general",         "Dollar General",          "https://careers.dollargeneral.com"),
    ("jibe-jcpenney",      "jcpenney",               "JCPenney",                "https://jobs.jcp.com"),
    ("jibe-pepsico",       "pepsico",                "PepsiCo",                 "https://www.pepsicojobs.com"),
    ("jibe-rei",           "rei",                    "REI Co-op",               "https://www.rei.jobs"),
    ("jibe-sheetz",        "sheetz",                 "Sheetz",                  "https://jobs.sheetz.com"),
    ("jibe-sprouts",       "sprouts-farmers-market", "Sprouts Farmers Market",  "https://jobs.sprouts.com"),
    ("jibe-ulta",          "ulta-beauty",            "Ulta Beauty",             "https://careers.ulta.com"),
]

EIGHTFOLD_SOURCES = [
    ("br-starbucks", "starbucks", "Starbucks", "https://starbucks.eightfold.ai/careers?domain=starbucks.com"),
    ("ef-microsoft", "microsoft", "Microsoft", "https://apply.careers.microsoft.com/careers?domain=microsoft.com"),
    ("ef-sephora", "sephora", "Sephora", "https://join.sephora.com/careers?domain=sephora.com"),
]

# Radancy TalentBrew sites — server-rendered HTML with ?p=N pagination.
# Detail pages carry full LD+JSON structured data (title, description, location, datePosted).
TALENTBREW_SOURCES = [
    ("tb-uhg", "unitedhealthgroup", "UnitedHealth Group", "https://careers.unitedhealthgroup.com/search-jobs"),
    ("tb-kaiser", "kaiser-permanente", "Kaiser Permanente", "https://www.kaiserpermanentejobs.org/search-jobs"),
]

ALL_SOURCES = {
    "workday":    [(s[0], s[1], s[2], s[3], "workday")    for s in WORKDAY_SOURCES],
    "oracle_ce":  [(s[0], s[1], s[2], s[3], "oracle_ce")  for s in ORACLE_CE_SOURCES],
    "jibe":       [(s[0], s[1], s[2], s[3], "jibe")       for s in JIBE_SOURCES],
    "eightfold":  [(s[0], s[1], s[2], s[3], "eightfold")  for s in EIGHTFOLD_SOURCES],
    "talentbrew": [(s[0], s[1], s[2], s[3], "talentbrew") for s in TALENTBREW_SOURCES],
    "aramark_careers": [(s[0], s[1], s[2], s[3], "aramark_careers") for s in ARAMARK_SOURCES],
    "activate_careers": [(s[0], s[1], s[2], s[3], "activate_careers") for s in ACTIVATE_SOURCES],
}

# ── Constants ─────────────────────────────────────────────────────────────────

WORKDAY_PAGE_SIZE = 20
MAX_TOTAL_JOBS   = 25000  # Activate Darden brands can exceed 5k listings per tenant
MAX_DETAIL_JOBS  = 1000   # cap detail fetches per source (Eightfold/Workday)
DETAIL_CONCURRENCY = 24

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
CURASTEM_UA = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)"

D1_DB = "curastem-jobs"

# ── Shared helpers ────────────────────────────────────────────────────────────

def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")

def build_dedup_key(title: str, company_slug: str) -> str:
    norm = re.sub(r"[^a-z0-9\s]", "", title.lower().strip())
    norm = re.sub(r"\s+", " ", norm)
    return f"{norm}|{company_slug}"

def fnv1a64(s: str) -> int:
    FNV_PRIME = 0x100000001B3
    h = 0xcbf29ce484222325
    for c in s.encode("utf-8"):
        h ^= c
        h = (h * FNV_PRIME) & 0xFFFFFFFFFFFFFFFF
    return h

def build_job_id(source_id: str, external_id: str) -> str:
    h = fnv1a64(f"{source_id}:{external_id}")
    return str(h % 10_000_000_000).zfill(10)

def sql_str(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def _html_to_text(html: str) -> str:
    """Mirror `htmlToText` in normalize.ts — plain text for description_raw / AI."""
    if not html:
        return ""
    t = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    t = re.sub(r"</?(?:p|div|li|h[1-6]|ul|ol|section|article)[^>]*>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = (
        t.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
    )
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

def _description_raw_from_maybe_html(raw: Optional[str]) -> Optional[str]:
    if not raw or not str(raw).strip():
        return None
    t = _html_to_text(str(raw))
    return t if t else None

def normalize_employment_type(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    r = raw.lower()
    if any(x in r for x in ("full", "regular")):
        return "full_time"
    if "part" in r:
        return "part_time"
    if any(x in r for x in ("contract", "temp", "freelance")):
        return "contractor"
    if "intern" in r:
        return "internship"
    return None

def normalize_workplace_type(wp_hint: Optional[str], loc: Optional[str]) -> Optional[str]:
    for text in [wp_hint or "", loc or ""]:
        t = text.lower()
        if "remote" in t:
            return "remote"
        if "hybrid" in t:
            return "hybrid"
    return None

def parse_iso_date(raw: Optional[str]) -> Optional[int]:
    """Convert ISO date/datetime string to Unix timestamp."""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).rstrip("Z").split("T")[0])
        return int(dt.replace(tzinfo=timezone.utc).timestamp())
    except Exception:
        return None

# ── D1 helpers ────────────────────────────────────────────────────────────────

def _wrangler_cwd() -> str:
    return os.path.dirname(os.path.abspath(__file__))

def _parse_wrangler_json(raw: str):
    idx = raw.find("[")
    if idx == -1:
        return None
    try:
        return json.loads(raw[idx:])
    except Exception:
        return None

def run_d1(sql: str, label: str = "") -> bool:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        fname = f.name
    try:
        result = subprocess.run(
            ["npx", "wrangler", "d1", "execute", D1_DB, "--remote", f"--file={fname}"],
            capture_output=True, text=True, cwd=_wrangler_cwd()
        )
        if result.returncode != 0:
            out = result.stdout + result.stderr
            print(f"  ✗ D1 error ({label}): {out[-300:]}")
            return False
        return True
    finally:
        os.unlink(fname)

def d1_query(sql: str) -> list:
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", D1_DB, "--remote", f"--command={sql}"],
        capture_output=True, text=True, cwd=_wrangler_cwd()
    )
    if result.returncode != 0:
        return []
    data = _parse_wrangler_json(result.stdout)
    if not data:
        return []
    try:
        return data[0].get("results", [])
    except Exception:
        return []

def get_or_create_company_id(name: str, slug: str) -> Optional[str]:
    rows = d1_query(f"SELECT id FROM companies WHERE slug = {sql_str(slug)} LIMIT 1")
    if rows:
        return rows[0]["id"]
    new_id = str(uuid.uuid4())
    now = int(time.time())
    run_d1(
        f"INSERT OR IGNORE INTO companies (id, name, slug, created_at, updated_at) "
        f"VALUES ({sql_str(new_id)}, {sql_str(name)}, {sql_str(slug)}, {now}, {now});",
        label=f"create company {slug}"
    )
    rows = d1_query(f"SELECT id FROM companies WHERE slug = {sql_str(slug)} LIMIT 1")
    return rows[0]["id"] if rows else (new_id if True else None)

def insert_jobs_batch(jobs_sql: list[str]) -> bool:
    if not jobs_sql:
        return True
    return run_d1("\n".join(jobs_sql), label=f"insert {len(jobs_sql)} jobs")

def upsert_jobs(source_id: str, company_id: str, company_slug: str,
                source_type: str, stubs: list[dict], batch_size: int = 120) -> dict:
    """
    Upsert a list of normalized job dicts into D1.

    Each stub must have: external_id, title, apply_url.
    Optional: location, description, posted_at (int), employment_type, workplace_type.
    Workday stubs may alternatively have: posted_on (string), time_type (string).
    """
    now = int(time.time())
    inserted = 0
    skipped = 0
    total = len(stubs)

    for start in range(0, total, batch_size):
        chunk = stubs[start:start + batch_size]
        statements = []
        for stub in chunk:
            ext_id = str(stub.get("external_id") or "").strip()
            title = str(stub.get("title") or "").strip()
            if not ext_id or not title:
                skipped += 1
                continue

            job_id = build_job_id(source_id, ext_id)
            loc_raw = stub.get("location")
            locations_json = json.dumps([loc_raw]) if loc_raw else None
            dedup_key = build_dedup_key(title, company_slug)
            description = stub.get("description")

            # Accept pre-normalized posted_at or parse Workday's relative string
            posted_at = stub.get("posted_at")
            if posted_at is None:
                posted_at = _parse_workday_posted_on(stub.get("posted_on"))

            # Accept pre-normalized types or infer from Workday fields
            employment_type = stub.get("employment_type")
            if employment_type is None:
                employment_type = normalize_employment_type(stub.get("time_type"))

            workplace_type = stub.get("workplace_type")
            if workplace_type is None:
                workplace_type = normalize_workplace_type(None, loc_raw)

            apply_url = stub.get("apply_url") or ""
            source_url = stub.get("source_url") or apply_url

            statements.append(
                f"INSERT INTO jobs "
                f"(id, company_id, source_id, external_id, title, locations, "
                f"employment_type, workplace_type, apply_url, source_url, source_name, "
                f"description_raw, posted_at, first_seen_at, dedup_key, created_at, updated_at) "
                f"SELECT "
                f"{sql_str(job_id)}, {sql_str(company_id)}, {sql_str(source_id)}, "
                f"{sql_str(ext_id)}, {sql_str(title)}, {sql_str(locations_json)}, "
                f"{sql_str(employment_type)}, {sql_str(workplace_type)}, "
                f"{sql_str(apply_url)}, {sql_str(source_url)}, {sql_str(source_type)}, "
                f"{sql_str(description)}, {sql_str(posted_at)}, {now}, "
                f"{sql_str(dedup_key)}, {now}, {now} "
                f"WHERE NOT EXISTS ("
                f"SELECT 1 FROM jobs WHERE source_id = {sql_str(source_id)} AND external_id = {sql_str(ext_id)});"
            )

        if insert_jobs_batch(statements):
            inserted += len(statements)
        else:
            skipped += len(statements)

        print(f"  → {min(start + batch_size, total)}/{total} jobs written...")

    return {"inserted": inserted, "skipped": skipped}

# ── Workday ───────────────────────────────────────────────────────────────────

def _parse_workday_posted_on(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    lower = raw.lower().strip()
    now = int(time.time())
    if lower == "posted today":
        return now
    if lower == "posted yesterday":
        return now - 86400
    m = re.search(r"posted\s+(\d+)\+?\s+days?\s+ago", lower)
    if m:
        return now - int(m.group(1)) * 86400
    return None

def _get_workday_cookie(cxs_url: str) -> str:
    parsed = urllib.parse.urlparse(cxs_url)
    host = f"{parsed.scheme}://{parsed.netloc}"
    parts = parsed.path.strip("/").split("/")
    board = parts[-2] if len(parts) >= 2 else ""
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [
        ("User-Agent", BROWSER_UA),
        ("Accept", "text/html,application/xhtml+xml,*/*;q=0.8"),
        ("Accept-Language", "en-US,en;q=0.9"),
    ]
    try:
        opener.open(f"{host}/{board}", timeout=15)
    except Exception:
        pass
    return "; ".join(f"{c.name}={c.value}" for c in cj)

def _workday_list_page(cxs_url: str, offset: int, cookies: str) -> dict:
    req = urllib.request.Request(
        cxs_url,
        data=json.dumps({"limit": WORKDAY_PAGE_SIZE, "offset": offset,
                         "appliedFacets": {}, "searchText": ""}).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": BROWSER_UA,
            "Cookie": cookies,
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "cors",
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

def _workday_description(url: str, cookies: str) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": BROWSER_UA, "Accept": "text/html", "Cookie": cookies,
        })
        with urllib.request.urlopen(req, timeout=12) as r:
            html = r.read().decode("utf-8", errors="replace")
        for m in re.findall(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', html, re.I
        ):
            try:
                d = json.loads(m)
                for item in (d if isinstance(d, list) else [d]):
                    if isinstance(item, dict) and item.get("@type") == "JobPosting":
                        desc = item.get("description", "")
                        if desc:
                            return desc
            except Exception:
                pass
    except Exception:
        pass
    return None

def fetch_workday_source(source_id: str, company_handle: str, display_name: str,
                          cxs_url: str, max_jobs: int = MAX_TOTAL_JOBS,
                          max_desc: int = MAX_DETAIL_JOBS) -> list[dict]:
    """Two-phase Workday fetch: collect stubs, then enrich descriptions."""
    parsed = urllib.parse.urlparse(cxs_url)
    host = f"{parsed.scheme}://{parsed.netloc}"
    parts = parsed.path.strip("/").split("/")
    board = parts[-2] if len(parts) >= 2 else ""

    print(f"  → Cookie preflight...")
    cookies = _get_workday_cookie(cxs_url)

    stubs = []
    offset = 0
    total = float("inf")
    while offset < total and len(stubs) < max_jobs:
        try:
            data = _workday_list_page(cxs_url, offset, cookies)
        except Exception as e:
            print(f"  ✗ List page {offset}: {e}")
            break
        batch = data.get("jobPostings", [])
        if not batch:
            break
        t = data.get("total", 0)
        if t and t > 0:
            total = t
        for p in batch:
            title = (p.get("title") or "").strip()
            if not title:
                continue
            ext_path = p.get("externalPath") or ""
            job_url = p.get("jobPostingURL") or ""
            apply_url = (
                job_url if job_url.startswith("http")
                else f"{host}/en-US/{board}{ext_path}"
            )
            external_id = p.get("id") or ext_path or title
            stubs.append({
                "external_id": str(external_id),
                "title": title,
                "location": p.get("locationsText"),
                "time_type": p.get("timeType"),
                "posted_on": p.get("postedOn"),
                "apply_url": apply_url,
            })
        if len(batch) < WORKDAY_PAGE_SIZE:
            break
        offset += len(batch)
        if len(stubs) % 200 == 0:
            print(f"  → Collected {len(stubs)}/{int(total)} stubs...")

    print(f"  → {len(stubs)} stubs collected. Fetching descriptions (up to {max_desc})...")

    to_enrich = stubs[:max_desc]
    descriptions = [None] * len(to_enrich)

    def _fetch(i_url):
        i, url = i_url
        return i, _workday_description(url, cookies)

    with ThreadPoolExecutor(max_workers=DETAIL_CONCURRENCY) as pool:
        futures = {pool.submit(_fetch, (i, s["apply_url"])): i for i, s in enumerate(to_enrich)}
        done = 0
        for f in as_completed(futures):
            try:
                i, desc = f.result()
                descriptions[i] = desc
            except Exception:
                pass
            done += 1
            if done % 100 == 0:
                print(f"  → {done}/{len(to_enrich)} descriptions fetched...")

    for i, stub in enumerate(stubs):
        stub["description"] = descriptions[i] if i < len(to_enrich) else None

    return stubs

# ── Oracle CE ─────────────────────────────────────────────────────────────────

def _oracle_ce_detail_html(origin: str, job_id: str) -> Optional[str]:
    """Full posting HTML from recruitingCEJobRequisitionDetails finder ById;Id=…"""
    finder = urllib.parse.quote(f"ById;Id={job_id}", safe="")
    url = (
        f"{origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails"
        f"?onlyData=true&finder={finder}"
    )
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": CURASTEM_UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            data = json.loads(r.read())
    except Exception:
        return None
    row = (data.get("items") or [{}])[0]
    html = (row.get("ExternalDescriptionStr") or row.get("ShortDescriptionStr") or "").strip()
    return html or None


def _aramark_ld_job_description(html: str) -> Optional[str]:
    m = re.search(
        r'<script[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>',
        html,
        re.I,
    )
    if not m:
        return None
    try:
        raw = json.loads(m.group(1).strip())
        if isinstance(raw, list):
            raw = next((x for x in raw if x.get("@type") == "JobPosting"), None)
        if not raw or raw.get("@type") != "JobPosting":
            return None
        d = raw.get("description")
        if isinstance(d, str) and d.strip():
            return d.strip()
    except Exception:
        return None
    return None


def fetch_oracle_ce_source(source_id: str, company_handle: str, display_name: str,
                            base_url: str, max_jobs: int = MAX_TOTAL_JOBS) -> list[dict]:
    """
    Paginate Oracle Fusion HCM recruitingCEJobRequisitions REST endpoint.
    For most tenants, list ShortDescriptionStr only. Marriott (company_handle marriott)
    additionally calls recruitingCEJobRequisitionDetails per job for ExternalDescriptionStr HTML.
    """
    parsed = urllib.parse.urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    m = re.search(r"/CandidateExperience/([a-z]{2})/sites/([^/?]+)", parsed.path, re.I)
    if not m:
        raise ValueError(f"Oracle CE: invalid base_url {base_url}")
    locale, site_number = m.group(1).lower(), m.group(2)
    rest_base = f"{origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions"

    jobs: list[dict] = []
    offset = 0
    total = float("inf")
    page = 0
    PAGE = 100

    while offset < total and len(jobs) < max_jobs and page < 1000:
        page += 1
        params = f"siteNumber={site_number},facetsList=jobs,limit={PAGE}"
        if offset > 0:
            params += f",offset={offset}"
        finder = urllib.parse.quote(f"findReqs;{params}", safe="")
        url = f"{rest_base}?onlyData=true&expand=requisitionList.secondaryLocations&finder={finder}"

        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": CURASTEM_UA,
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
        except Exception as e:
            print(f"  ✗ Oracle CE page {page} offset {offset}: {e}")
            break

        item = (data.get("items") or [{}])[0]
        if isinstance(item.get("TotalJobsCount"), int):
            total = item["TotalJobsCount"]

        batch = item.get("requisitionList") or []
        if not batch:
            break

        for row in batch:
            req_id = str(row.get("Id", "")).strip()
            title = (row.get("Title") or "").strip()
            if not req_id or not title:
                continue
            loc = row.get("PrimaryLocation")
            wp_code = row.get("WorkplaceTypeCode") or row.get("WorkplaceType")
            apply_url = f"{origin}/hcmUI/CandidateExperience/{locale}/sites/{site_number}/job/{req_id}"
            jobs.append({
                "external_id": req_id,
                "title": title,
                "location": loc,
                "description": _description_raw_from_maybe_html(row.get("ShortDescriptionStr")),
                "apply_url": apply_url,
                "posted_at": parse_iso_date(row.get("PostedDate")),
                "employment_type": normalize_employment_type(row.get("JobSchedule")),
                "workplace_type": normalize_workplace_type(wp_code, loc),
            })

        if len(jobs) % 1000 == 0 and len(jobs) > 0:
            print(f"  → Collected {len(jobs)}/{int(total)} jobs...")

        offset += len(batch)
        if len(batch) < PAGE:
            break

    jobs = jobs[:max_jobs]

    if company_handle == "marriott" and jobs:
        print(f"  → Oracle CE: fetching posting HTML for {len(jobs)} Marriott jobs (parallel)...")

        def _enrich_marriott(job: dict) -> dict:
            h = _oracle_ce_detail_html(origin, job["external_id"])
            if h:
                job["description"] = _description_raw_from_maybe_html(h)
            return job

        with ThreadPoolExecutor(max_workers=24) as pool:
            jobs = list(pool.map(_enrich_marriott, jobs))

    return jobs

def fetch_aramark_careers_source(source_id: str, company_handle: str, display_name: str,
                                api_url: str, max_jobs: int = MAX_TOTAL_JOBS) -> list[dict]:
    """GET careers.aramark.com/wp-json/aramark/jobs — JSON array with req_id, title, location, etc."""
    req = urllib.request.Request(api_url, headers={
        "Accept": "application/json",
        "User-Agent": CURASTEM_UA,
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read())
    if not isinstance(rows, list):
        raise ValueError("Aramark: expected JSON array")

    jobs: list[dict] = []
    for row in rows:
        if len(jobs) >= max_jobs:
            break
        req_id = str((row.get("req_id") or "")).strip()
        title = (row.get("title") or "").strip()
        if not req_id or not title:
            continue
        city = (row.get("city") or "").strip()
        state = (row.get("state") or "").strip()
        z = (row.get("zipcode") or "").strip()
        if city and state:
            loc = f"{city}, {state}" + (f" {z}" if z else "")
        elif city:
            loc = city
        else:
            loc = None

        raw_type = (row.get("type") or "").lower()
        emp = "full_time" if "salaried" in raw_type else None

        posting = f"https://careers.aramark.com/job/?req_id={req_id}"

        jobs.append({
            "external_id": req_id,
            "title": title,
            "location": loc,
            "description": None,
            "apply_url": posting,
            "posted_at": parse_iso_date(row.get("pub_date")),
            "employment_type": emp,
            "workplace_type": normalize_workplace_type(None, loc),
        })

    if jobs:
        print(f"  → Aramark: fetching JobPosting JSON-LD for {len(jobs)} posting pages (parallel)...")

        def _enrich_aramark(job: dict) -> dict:
            url = f"https://careers.aramark.com/job/?req_id={job['external_id']}"
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": CURASTEM_UA,
                    "Accept": "text/html",
                })
                with urllib.request.urlopen(req, timeout=25) as r:
                    html = r.read().decode("utf-8", errors="replace")
                desc_html = _aramark_ld_job_description(html)
                if desc_html:
                    job["description"] = _description_raw_from_maybe_html(desc_html)
            except Exception:
                pass
            return job

        with ThreadPoolExecutor(max_workers=20) as pool:
            jobs = list(pool.map(_enrich_aramark, jobs))

    return jobs

# ── Oracle Activate (Ross, Darden brands) ───────────────────────────────────

def _slugify_activate(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "job"


def _activate_strip_spans(raw: Optional[str]) -> str:
    if not raw:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str(raw))).strip()


def _parse_activate_payload(raw_bytes: bytes) -> dict:
    text = raw_bytes.decode("utf-8", errors="replace")
    outer = json.loads(text)
    if isinstance(outer, str):
        outer = json.loads(outer)
    return outer


def _activate_extract_description(html: str) -> Optional[str]:
    for marker in ('class="Description"', "class='Description'"):
        si = html.find(marker)
        if si == -1:
            continue
        open_idx = html.rfind("<div", 0, si)
        if open_idx == -1:
            continue
        content_start = html.find(">", open_idx) + 1
        depth = 1
        pos = content_start
        while pos < len(html):
            m = re.search(r"<\/?div\b[^>]*>", html[pos:], re.I)
            if not m:
                break
            tag = m.group(0)
            if tag.startswith("</"):
                depth -= 1
            else:
                depth += 1
            if depth == 0:
                return html[content_start : pos + m.start()].strip()
            pos += m.start() + len(m.group(0))
    return None


def _activate_apply_url(html: str) -> Optional[str]:
    m = re.search(r'href="(https://[^"]*taleo\.net/careersection/application\.jss[^"]*)"', html, re.I)
    if m:
        return m.group(1).replace("&amp;", "&")
    m = re.search(r'href="(https://[^"]*paradox\.ai[^"]*Job\?[^"]*)"', html, re.I)
    if m:
        return m.group(1).replace("&amp;", "&")
    return None


def fetch_activate_careers_source(source_id: str, company_handle: str, display_name: str,
                                 base_url: str, max_jobs: int = MAX_TOTAL_JOBS) -> list[dict]:
    """Paginate /Search/SearchResults + parallel /search/jobdetails/{slug}/{id} (see activate_careers.ts)."""
    parsed = urllib.parse.urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    page_size = 100
    max_pages = 250
    jobs: list[dict] = []
    start_idx = 0
    total = float("inf")
    page_n = 0

    while start_idx < total and page_n < max_pages and len(jobs) < max_jobs:
        page_n += 1
        list_url = f"{origin}/Search/SearchResults?jtStartIndex={start_idx}&jtPageSize={page_size}"
        try:
            req = urllib.request.Request(list_url, headers={
                "User-Agent": CURASTEM_UA,
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=45) as r:
                payload = _parse_activate_payload(r.read())
        except Exception as e:
            print(f"  ✗ Activate SearchResults: {e}")
            break

        if isinstance(payload.get("TotalRecordCount"), int):
            total = payload["TotalRecordCount"]

        records = payload.get("Records") or []
        if not records:
            break

        def _detail_stub(rec: dict) -> Optional[dict]:
            jid = str((rec.get("ID") or "")).strip()
            th = rec.get("Title") or ""
            title = (
                _activate_strip_spans(th)
                or (rec.get("TrackingObject") or {}).get("TitleJson", "").strip()
                or "Job"
            )
            if not jid:
                return None
            slug = _slugify_activate(title)
            source_url = f"{origin}/search/jobdetails/{slug}/{jid}"
            desc: Optional[str] = None
            apply_u: Optional[str] = None
            try:
                req = urllib.request.Request(source_url, headers={
                    "User-Agent": CURASTEM_UA,
                    "Accept": "text/html",
                })
                with urllib.request.urlopen(req, timeout=25) as r:
                    html = r.read().decode("utf-8", errors="replace")
                dh = _activate_extract_description(html)
                if dh:
                    desc = _description_raw_from_maybe_html(dh)
                apply_u = _activate_apply_url(html)
            except Exception:
                pass

            loc_raw = _activate_strip_spans(rec.get("CityStateDataAbbrev")) or None
            type_raw = (
                _activate_strip_spans(rec.get("TypeName"))
                or (rec.get("TrackingObject") or {}).get("TypeNameJson", "").strip()
            )
            return {
                "external_id": jid,
                "title": title,
                "location": loc_raw,
                "description": desc,
                "apply_url": apply_u or source_url,
                "source_url": source_url,
                "posted_at": parse_iso_date(rec.get("PostedDateRaw")),
                "employment_type": normalize_employment_type(type_raw) if type_raw else None,
                "workplace_type": normalize_workplace_type(None, loc_raw),
            }

        with ThreadPoolExecutor(max_workers=14) as pool:
            chunk = [x for x in pool.map(_detail_stub, records) if x]

        for stub in chunk:
            if len(jobs) >= max_jobs:
                break
            jobs.append(stub)

        start_idx += len(records)
        if len(records) < page_size:
            break
        if len(jobs) > 0 and len(jobs) % 500 == 0:
            print(f"  → Activate collected {len(jobs)}/{int(total)} jobs...")

    return jobs

# ── Jibe (iCIMS) ──────────────────────────────────────────────────────────────

def _jibe_apply_url(d: dict, base_url: str, req_id: str) -> str:
    raw = (d.get("apply_url") or "").strip()
    if raw.startswith("http"):
        return raw
    parsed = urllib.parse.urlparse(base_url)
    host = parsed.hostname or ""
    if host in ("careers.ulta.com", "ulta.jibeapply.com"):
        return f"https://careers.ulta.com/careers/jobs/{req_id}"
    if host in ("jobs.sprouts.com", "sprouts.jibeapply.com"):
        return f"https://jobs.sprouts.com/jobs/{req_id}"
    if host in ("www.pepsicojobs.com", "pepsicojobs.com"):
        return f"https://www.pepsicojobs.com/main/jobs/{req_id}"
    return f"{base_url.rstrip('/')}/jobs/{req_id}"

def fetch_jibe_source(source_id: str, company_handle: str, display_name: str,
                       base_url: str, max_jobs: int = MAX_TOTAL_JOBS) -> list[dict]:
    """
    Paginate iCIMS Jibe /api/jobs endpoint. Descriptions are inline in the list
    response (data.description / data.job_description) — no separate detail calls needed.
    """
    jobs: list[dict] = []
    page = 1
    total = float("inf")
    PAGE = 100

    while len(jobs) < max_jobs:
        url = f"{base_url.rstrip('/')}/api/jobs?page={page}&limit={PAGE}"
        req = urllib.request.Request(url, headers={
            "User-Agent": BROWSER_UA,
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
        except Exception as e:
            print(f"  ✗ Jibe page {page}: {e}")
            break

        if isinstance(data.get("totalCount"), int):
            total = data["totalCount"]

        rows = data.get("jobs") or []
        if not rows:
            break

        for row in rows:
            d = row.get("data") or {}
            req_id = str(d.get("req_id") or d.get("slug") or "").strip()
            title = (d.get("title") or "").strip()
            if not req_id or not title:
                continue

            city = (d.get("city") or "").strip()
            state = (d.get("state") or "").strip()
            if city and state:
                location = f"{city}, {state}"
            else:
                location = (
                    d.get("location_name") or d.get("full_location") or
                    d.get("short_location") or city or None
                )

            desc_raw = next(
                (c for c in [d.get("description"), d.get("job_description"), d.get("html_description")]
                 if isinstance(c, str) and c.strip()), None
            )

            jobs.append({
                "external_id": req_id,
                "title": title,
                "location": location,
                "description": desc_raw,
                "apply_url": _jibe_apply_url(d, base_url, req_id),
                "posted_at": parse_iso_date(d.get("posted_date")),
                "employment_type": normalize_employment_type(d.get("employment_type")),
                "workplace_type": normalize_workplace_type(None, location),
            })

        if len(jobs) % 500 == 0 and len(jobs) > 0:
            print(f"  → Collected {len(jobs)}/{int(total)} jobs...")

        if len(rows) < PAGE:
            break
        page += 1

    return jobs[:max_jobs]

# ── Eightfold ────────────────────────────────────────────────────────────────

def fetch_eightfold_source(source_id: str, company_handle: str, display_name: str,
                            base_url: str, max_jobs: int = MAX_TOTAL_JOBS,
                            max_desc: int = MAX_DETAIL_JOBS) -> list[dict]:
    """
    Two-phase Eightfold PCS fetch: collect stubs from search (10/page), then
    enrich with jobDescription + publicUrl from position_details in parallel.
    """
    parsed = urllib.parse.urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    domain = urllib.parse.parse_qs(parsed.query).get("domain", [""])[0]

    stubs: list[dict] = []
    offset = 0
    total = float("inf")

    while offset < total and len(stubs) < max_jobs:
        url = f"{origin}/api/pcsx/search?domain={domain}&query=&location=&start={offset}"
        req = urllib.request.Request(url, headers={
            "User-Agent": CURASTEM_UA,
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                resp = json.loads(r.read())
        except Exception as e:
            print(f"  ✗ Eightfold offset {offset}: {e}")
            break

        data = resp.get("data") or {}
        if isinstance(data.get("count"), int):
            total = data["count"]

        positions = data.get("positions") or []
        if not positions:
            break

        for pos in positions:
            pos_id = pos.get("id")
            title = (pos.get("name") or "").strip()
            if not pos_id or not title:
                continue
            locs = pos.get("standardizedLocations") or pos.get("locations") or []
            location = locs[0] if locs else None
            wp = pos.get("workLocationOption") or pos.get("locationFlexibility")
            stubs.append({
                "id": pos_id,
                "external_id": str(pos_id),
                "title": title,
                "location": location,
                "posted_at": pos.get("postedTs"),
                "workplace_type": normalize_workplace_type(wp, location),
                "apply_url": f"{origin}{pos.get('positionUrl', '')}" if pos.get("positionUrl", "").startswith("/") else (pos.get("positionUrl") or f"{origin}/careers?domain={domain}"),
            })

        if len(stubs) % 200 == 0 and len(stubs) > 0:
            print(f"  → Collected {len(stubs)}/{int(total)} stubs...")

        offset += len(positions)
        if len(positions) < 10:  # Eightfold page size is fixed at 10
            break

    print(f"  → {len(stubs)} stubs. Fetching descriptions (up to {max_desc})...")

    to_enrich = stubs[:max_desc]
    detail_cache: dict[int, dict] = {}  # pos_id → {description, apply_url}

    def _fetch_detail(stub: dict):
        pos_id = stub["id"]
        url = f"{origin}/api/pcsx/position_details?position_id={pos_id}&domain={domain}&hl=en"
        req = urllib.request.Request(url, headers={
            "User-Agent": CURASTEM_UA, "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                resp = json.loads(r.read())
            d = resp.get("data") or {}
            return pos_id, d.get("jobDescription"), d.get("publicUrl") or d.get("positionUrl")
        except Exception:
            return pos_id, None, None

    with ThreadPoolExecutor(max_workers=DETAIL_CONCURRENCY) as pool:
        futures = {pool.submit(_fetch_detail, s): s["id"] for s in to_enrich}
        done = 0
        for f in as_completed(futures):
            try:
                pos_id, desc, pub_url = f.result()
                detail_cache[pos_id] = {"description": desc, "apply_url": pub_url}
            except Exception:
                pass
            done += 1
            if done % 100 == 0:
                print(f"  → {done}/{len(to_enrich)} descriptions fetched...")

    jobs = []
    for stub in stubs:
        pos_id = stub["id"]
        detail = detail_cache.get(pos_id, {})
        apply_url = detail.get("apply_url") or stub["apply_url"]
        jobs.append({
            "external_id": stub["external_id"],
            "title": stub["title"],
            "location": stub["location"],
            "description": detail.get("description"),
            "apply_url": apply_url,
            "posted_at": stub["posted_at"],
            "employment_type": None,
            "workplace_type": stub["workplace_type"],
        })

    return jobs

# ── Dispatch ──────────────────────────────────────────────────────────────────

# ── Radancy TalentBrew ────────────────────────────────────────────────────────

def _tb_session():
    """Return a curl_cffi session that passes UHG's bot checks."""
    try:
        from curl_cffi import requests as cf_requests
        return cf_requests.Session(impersonate="chrome131")
    except ImportError:
        import requests as _req
        s = _req.Session()
        s.headers["User-Agent"] = BROWSER_UA
        return s

def _tb_extract_job_paths(html: str) -> list[str]:
    """Return unique /job/... paths from a TalentBrew search-results page."""
    seen: set[str] = set()
    out: list[str] = []
    for m in re.finditer(r'href="((?:/[a-z]{2})?/job/[^"]+)"', html):
        path = m.group(1).split("?")[0]
        if path not in seen:
            seen.add(path)
            out.append(path)
    return out

def _tb_extract_ld_json(html: str) -> Optional[dict]:
    """Parse the first application/ld+json block."""
    m = re.search(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None

def _tb_detail_page(session, origin: str, path: str) -> Optional[dict]:
    """Fetch one TalentBrew job detail page and return a stub dict."""
    try:
        r = session.get(f"{origin}{path}", headers={"User-Agent": BROWSER_UA, "Accept": "text/html"}, timeout=12)
        if not r.ok:
            return None
        html = r.text

        # Skip expired postings that lack a description
        ld = _tb_extract_ld_json(html)
        desc = (ld or {}).get("description") or ""
        if not desc.strip():
            return None

        # External IDs from data attributes
        m_ids = re.search(r'data-org-id="(\d+)"[^>]*data-job-id="(\d+)"', html)
        if not m_ids:
            m_ids = re.search(r'data-job-id="(\d+)"[^>]*data-org-id="(\d+)"', html)
            if m_ids:
                org_id, job_id = m_ids.group(2), m_ids.group(1)
            else:
                return None
        else:
            org_id, job_id = m_ids.group(1), m_ids.group(2)

        # Title — prefer LD+JSON for accuracy
        title = (ld or {}).get("title") or ""
        if not title:
            m_t = re.search(r'<h1[^>]*class="[^"]*ajd_header__job-title[^"]*"[^>]*>([^<]+)</h1>', html, re.IGNORECASE)
            title = m_t.group(1).strip() if m_t else ""
        if not title:
            return None

        # Location — AJD header style (UHG) or LD+JSON
        loc = ""
        m_loc = re.search(r'<p[^>]*class="[^"]*ajd_header__location[^"]*"[^>]*>\s*([^<]+?)\s*</p>', html, re.IGNORECASE)
        if m_loc:
            loc = m_loc.group(1).strip()
        if not loc and ld:
            loc_obj = ld.get("jobLocation") or {}
            if isinstance(loc_obj, list):
                loc_obj = loc_obj[0] if loc_obj else {}
            addr = loc_obj.get("address") or {}
            loc = ", ".join(filter(None, [addr.get("addressLocality"), addr.get("addressRegion")]))

        # Apply URL — prefer LD+JSON canonical page URL so the job card links correctly
        apply_url = (ld or {}).get("url") or f"{origin}{path}"

        # Posted date
        posted_at = parse_iso_date((ld or {}).get("datePosted"))

        return {
            "external_id": f"{org_id}-{job_id}",
            "title": title,
            "location": loc or None,
            "description": desc,
            "apply_url": apply_url,
            "posted_at": posted_at,
        }
    except Exception:
        return None

def fetch_talentbrew_source(source_id: str, company_handle: str, display_name: str,
                            search_url: str, max_jobs: int, max_desc: int) -> list[dict]:
    """
    Fetch jobs from a Radancy TalentBrew career site.

    Paginates `search_url?p=N` to collect all job paths, then fetches detail
    pages in parallel for full descriptions via LD+JSON.
    """
    from urllib.parse import urlparse
    parsed = urlparse(search_url.strip())
    origin = f"{parsed.scheme}://{parsed.netloc}"
    search_path = parsed.path.rstrip("/")
    if not search_path.endswith("/search-jobs"):
        search_path = search_path or "/search-jobs"

    session = _tb_session()
    DETAIL_CONCURRENCY_TB = min(DETAIL_CONCURRENCY, 12)
    # Sequential search pagination with polite delay — parallel fan-out triggers 403 on large tenants (UHG).
    SEARCH_PAGE_DELAY_S = 0.15

    # ── Collect job paths from all search pages ────────────────────────────────
    def make_url(page: int) -> str:
        return f"{origin}{search_path}" + (f"?p={page}" if page > 1 else "")

    _HDR = {"User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9"}

    def get_search_page(page: int):
        r = session.get(make_url(page), headers=_HDR, timeout=22)
        if r.status_code == 403:
            print(f"  ⚠ search p.{page} HTTP 403 — sleeping 50s, retry once...")
            time.sleep(50)
            r = session.get(make_url(page), headers=_HDR, timeout=22)
        return r

    r0 = get_search_page(1)
    if not r0.ok:
        raise ValueError(f"TalentBrew search page returned {r0.status_code}")
    html0 = r0.text

    m_pages = re.search(r'data-total-pages="(\d+)"', html0)
    total_pages = int(m_pages.group(1)) if m_pages else 1
    print(f"  → {total_pages} search pages (sequential, {SEARCH_PAGE_DELAY_S}s between pages)")

    all_paths: list[str] = _tb_extract_job_paths(html0)
    print(f"  → page 1: {len(all_paths)} paths")

    for page in range(2, total_pages + 1):
        time.sleep(SEARCH_PAGE_DELAY_S)
        try:
            r = get_search_page(page)
            if r.ok:
                all_paths.extend(_tb_extract_job_paths(r.text))
        except Exception:
            pass
        if page % 50 == 0:
            print(f"  → scanned search pages 1–{page}… ({len(all_paths)} paths so far)")

    # Deduplicate, shuffle for variety across runs, cap at max_jobs
    import random as _random
    seen_paths: set[str] = set()
    unique_paths: list[str] = []
    for p in all_paths:
        if p not in seen_paths:
            seen_paths.add(p)
            unique_paths.append(p)
    _random.shuffle(unique_paths)
    unique_paths = unique_paths[:max_jobs]
    print(f"  → {len(unique_paths)} unique job paths (cap={max_jobs})")

    # ── Fetch detail pages for descriptions ───────────────────────────────────
    detail_paths = unique_paths[:max_desc]
    stubs: list[dict] = []
    done = 0

    def fetch_detail(path: str) -> Optional[dict]:
        return _tb_detail_page(session, origin, path)

    with ThreadPoolExecutor(max_workers=DETAIL_CONCURRENCY_TB) as pool:
        futures = {pool.submit(fetch_detail, p): p for p in detail_paths}
        for fut in as_completed(futures):
            done += 1
            result = fut.result()
            if result:
                stubs.append(result)
            if done % 100 == 0:
                print(f"  → detail pages: {done}/{len(detail_paths)} fetched, {len(stubs)} good")

    print(f"  → detail pages done: {len(stubs)}/{len(detail_paths)} with descriptions")
    return stubs


def fetch_source(source_id: str, company_handle: str, display_name: str,
                 url: str, source_type: str,
                 max_jobs: int, max_desc: int) -> list[dict]:
    if source_type == "workday":
        return fetch_workday_source(source_id, company_handle, display_name, url, max_jobs, max_desc)
    if source_type == "oracle_ce":
        return fetch_oracle_ce_source(source_id, company_handle, display_name, url, max_jobs)
    if source_type == "jibe":
        return fetch_jibe_source(source_id, company_handle, display_name, url, max_jobs)
    if source_type == "eightfold":
        return fetch_eightfold_source(source_id, company_handle, display_name, url, max_jobs, max_desc)
    if source_type == "talentbrew":
        return fetch_talentbrew_source(source_id, company_handle, display_name, url, max_jobs, max_desc)
    if source_type == "aramark_careers":
        return fetch_aramark_careers_source(source_id, company_handle, display_name, url, max_jobs)
    if source_type == "activate_careers":
        return fetch_activate_careers_source(source_id, company_handle, display_name, url, max_jobs)
    raise ValueError(f"Unknown source_type: {source_type}")

# ── Geocoding ─────────────────────────────────────────────────────────────────
#
# Usage:  python3 backfill.py --geocode [--maps-key=AIza...]
#
# Pass 0: full street addresses → Google Geocoding API (or Nominatim if no key).
# Pass 1: city-only strings → Photon (free). New ingestion uses Mapbox/Places in major metros (Worker).

_TITLE_ADDR_RE = re.compile(
    r'\(\d{2,6}\)\s*[-\u2013]?\s*(?:[A-Za-z][\w\s]*?[-\u2013]\s*)?'
    r'(\d+\s+(?:[NSEW]{1,2}\s+)?[A-Za-z][\w\s.,#\-/]*'
    r'(?:St\.?|Ave\.?|Dr\.?|Blvd\.?|Rd\.?|Ln\.?|Way|Ct\.?|Pl\.?|Hwy\.?|Pkwy\.?'
    r'|Loop|Cir\.?|Ter\.?|Trl\.?|Run|Pike|Row|Sq\.?|Plaza|Place|Street|Avenue'
    r'|Drive|Boulevard|Road|Lane|Court|Highway|Parkway|Circle|Terrace|Trail)'
    r'(?:\s+(?:#|Ste\.?|Suite|Unit|Apt\.?)\s*[\w-]+)?)',
    re.I,
)

def _extract_title_street_address(title: str) -> Optional[str]:
    """Extract store street address from franchise-style job titles.

    Matches patterns like:
      "Dishwasher (01272) - 3275 Henry St"
      "General Manager(07682) -491 N Lake Havasu Ave #100"
    Returns the street portion only; caller combines with city+state from locations.
    """
    m = _TITLE_ADDR_RE.search(title)
    return m.group(1).strip() if m else None

def _normalize_location_for_geocode(loc: str) -> str:
    """Port of normalizeLocationForGeocode from placesGeocode.ts."""
    t = loc.strip()
    # "TX-Houston" → "Houston, TX"
    m = re.match(r'^([A-Z]{2})-(.+)$', t)
    if m:
        return f"{m.group(2)}, {m.group(1)}"
    # "US-TX-Houston" → "Houston, TX, US"
    m = re.match(r'^([A-Z]{2,3})-([A-Z]{2})-(.+)$', t)
    if m:
        return f"{m.group(3)}, {m.group(2)}, {m.group(1)}"
    return t

def _photon_geocode(location_key: str) -> Optional[tuple[float, float]]:
    """Free OSM city-level geocoding via Photon (komoot)."""
    url = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": location_key, "limit": "1"})
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CurastemJobs/1.0 geocoder"})
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())
        features = data.get("features", [])
        if not features:
            return None
        coords = features[0].get("geometry", {}).get("coordinates")
        if coords and len(coords) == 2:
            lng, lat = coords  # GeoJSON is [lng, lat]
            return (float(lat), float(lng))
    except Exception as e:
        print(f"    [photon] error for {location_key!r}: {e}", flush=True)
    return None

def _nominatim_geocode(address: str) -> Optional[tuple[float, float]]:
    """Free Nominatim geocoding — good accuracy for full US street addresses."""
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": address, "format": "json", "limit": "1"}
    )
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "CurastemJobs/1.0 (https://curastem.org; address geocoding)"}
        )
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())
        if data and isinstance(data, list):
            lat = float(data[0].get("lat", "nan"))
            lng = float(data[0].get("lon", "nan"))
            if not (lat != lat or lng != lng):  # nan check
                return (lat, lng)
    except Exception as e:
        print(f"    [nominatim] error for {address!r}: {e}", flush=True)
    return None

def _geocoding_api(address: str, api_key: str) -> Optional[tuple[float, float]]:
    """Google Geocoding API — $0.005/req. Use for full street addresses."""
    url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(
        {"address": address, "key": api_key}
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CurastemJobs/1.0"})
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return (float(loc["lat"]), float(loc["lng"]))
    except Exception as e:
        print(f"    [geocoding_api] error for {address!r}: {e}", flush=True)
    return None

def _geocode_address(address: str, maps_key: Optional[str]) -> Optional[tuple[float, float]]:
    """Geocode a full street address. Geocoding API primary, Nominatim fallback (only when no key)."""
    if maps_key:
        # Google Geocoding API is reliable enough — skip Nominatim to avoid rate-limit spam
        return _geocoding_api(address, maps_key)
    # No key: Nominatim only (free, requires polite rate limiting)
    result = _nominatim_geocode(address)
    time.sleep(1.2)  # Nominatim ToS: max 1 req/sec
    return result

def run_geocode_backfill(maps_key: Optional[str] = None, dry_run: bool = False):
    """
    Geocode all jobs that have a location string but no lat/lng.

    Pass 0: street addresses via Geocoding API. Pass 1: city strings via Photon only
    (ingestion Worker uses Mapbox + Places for major metros on new data).

    D1 is updated by (company_slug, locations_json) so one query covers all
    jobs at a given company in a given city in a single UPDATE.
    """

    photon_cache: dict[str, Optional[tuple[float, float]]] = {}

    total_updated = 0
    total_photon  = 0
    total_failed  = 0
    page          = 0
    PAGE_SIZE     = 300

    print(f"\n── Geocode backfill (Pass 1: Photon city-level) ──")
    if not maps_key:
        print("  No --maps-key: Pass 0 address geocoding uses Nominatim; Pass 1 unchanged.\n")

    # ── Pass 0: Address-level geocoding (precise) ─────────────────────────────
    # Two cases handled here:
    #   a) Jobs with location_lat IS NULL: never geocoded at all.
    #   b) Jobs with job_address set (AI-enriched) but only city-level coords:
    #      upgrade from city-center to exact building coordinates.
    # Paginated to handle any volume.
    print("  Pass 0: extracting title-embedded and AI-enriched addresses...")
    addr_pass_rows = []
    p0_offset = 0
    P0_PAGE = 2000
    while True:
        page_rows = d1_query(
            f"""
            SELECT j.id, j.title, j.locations, j.job_address, j.job_city, j.job_state,
                   j.location_lat
            FROM jobs j
            WHERE j.title IS NOT NULL
              AND j.locations IS NOT NULL
              AND j.locations NOT IN ('null', '[]', '')
              AND (
                j.location_lat IS NULL
                OR j.job_address IS NOT NULL  -- upgrade city-level to address-level
              )
            LIMIT {P0_PAGE} OFFSET {p0_offset}
            """
        )
        if not page_rows:
            break
        addr_pass_rows.extend(page_rows)
        if len(page_rows) < P0_PAGE:
            break
        p0_offset += P0_PAGE
    print(f"    {len(addr_pass_rows)} candidate rows found.")
    # Step 1: collect (job_id, full_address) pairs — dedup address before any API call
    addr_job_pairs: list[tuple[str, str]] = []  # (job_id, full_address)
    for row in (addr_pass_rows or []):
        title     = row.get("title") or ""
        locs_json = row.get("locations") or "[]"
        job_id    = row.get("id")
        job_addr  = row.get("job_address") or ""
        if not job_id:
            continue

        street = job_addr.strip() or _extract_title_street_address(title) or ""
        if not street:
            continue

        try:
            locs = json.loads(locs_json)
            raw_loc = locs[0] if locs else None
        except Exception:
            continue
        if not raw_loc or not isinstance(raw_loc, str):
            continue

        loc_key = _normalize_location_for_geocode(raw_loc.strip())
        if not loc_key or re.match(r'^\d', loc_key) or re.search(r'\bremote\b', loc_key, re.I):
            continue

        addr_job_pairs.append((job_id, f"{street}, {loc_key}"))

    # Step 2: geocode each UNIQUE address once — all jobs at the same address share the result.
    # e.g. "Delivery Driver" + "Dishwasher" both at "3275 Henry St, Watertown, WI" → 1 API call.
    unique_addresses = list(dict.fromkeys(addr for _, addr in addr_job_pairs))
    addr_cache: dict[str, Optional[tuple[float, float]]] = {}
    geocoding_api_calls = 0

    for full_address in unique_addresses:
        result = _geocode_address(full_address, maps_key)
        addr_cache[full_address] = result
        if result and maps_key:
            geocoding_api_calls += 1

    # Step 3: build UPDATE statements — one per job, but coords come from deduped cache
    addr_geocoded = 0
    addr_updates: list[str] = []
    for job_id, full_address in addr_job_pairs:
        result = addr_cache.get(full_address)
        if result:
            lat, lng = result
            addr_updates.append(
                f"UPDATE jobs SET location_lat = {lat}, location_lng = {lng} "
                f"WHERE id = {sql_str(job_id)} AND location_lat IS NULL;"
            )
            addr_geocoded += 1

    if addr_updates and not dry_run:
        BATCH = 80
        for i in range(0, len(addr_updates), BATCH):
            run_d1("\n".join(addr_updates[i:i + BATCH]), label=f"geocode addr batch {i // BATCH}")
    geocoding_cost = geocoding_api_calls * 0.005
    print(
        f"  Pass 0 done: {addr_geocoded} jobs geocoded from {len(unique_addresses)} unique addresses "
        f"({len(addr_job_pairs) - len(unique_addresses)} deduped) "
        + (f"| Geocoding API: {geocoding_api_calls} calls (${geocoding_cost:.2f})" if maps_key else "| Nominatim only (free)")
        + "\n"
    )

    # ── Pass 1: City-level geocoding (Photon) ──────────────────────────────────
    while True:
        rows = d1_query(
            f"""
            SELECT c.slug, c.name, j.locations, COUNT(*) AS cnt
            FROM jobs j
            JOIN companies c ON j.company_id = c.id
            WHERE j.location_lat IS NULL
              AND j.locations IS NOT NULL
              AND j.locations NOT IN ('null', '[]', '')
            GROUP BY c.slug, c.name, j.locations
            ORDER BY cnt DESC
            LIMIT {PAGE_SIZE} OFFSET {page * PAGE_SIZE}
            """
        )
        if not rows:
            break

        updates: list[str] = []

        for row in rows:
            slug         = row.get("slug") or ""
            locs_json    = row.get("locations") or "[]"

            # Parse the stored JSON location array
            try:
                locs = json.loads(locs_json)
                raw_loc = locs[0] if locs else None
            except Exception:
                continue
            if not raw_loc or not isinstance(raw_loc, str):
                continue

            # Skip pure-remote postings (no meaningful lat/lng)
            if re.search(r'\bremote\b', raw_loc, re.I) and not re.search(r'\bhybrid\b', raw_loc, re.I):
                continue

            location_key = _normalize_location_for_geocode(raw_loc.strip())
            if not location_key or len(location_key) < 3:
                continue

            lat_lng: Optional[tuple[float, float]] = None

            if location_key not in photon_cache:
                photon_cache[location_key] = _photon_geocode(location_key)
                time.sleep(0.06)  # polite delay between Photon calls
            lat_lng = photon_cache[location_key]
            if lat_lng:
                total_photon += 1

            if lat_lng:
                lat, lng = lat_lng
                # Update ALL jobs at this (company, location) in one statement
                updates.append(
                    f"UPDATE jobs SET location_lat = {lat}, location_lng = {lng} "
                    f"WHERE company_id = (SELECT id FROM companies WHERE slug = {sql_str(slug)} LIMIT 1) "
                    f"AND locations = {sql_str(locs_json)} "
                    f"AND location_lat IS NULL;"
                )
                total_updated += row.get("cnt") or 1
            else:
                total_failed += 1

        if updates and not dry_run:
            # Execute in sub-batches to stay within D1 statement limits
            BATCH = 80
            for i in range(0, len(updates), BATCH):
                run_d1("\n".join(updates[i:i + BATCH]), label=f"geocode page {page} batch {i // BATCH}")

        tier_label = f"photon={total_photon} | failed={total_failed}"
        print(
            f"  Page {page}: {len(rows)} locations → {len(updates)} updates | {tier_label}",
            flush=True,
        )

        if len(rows) < PAGE_SIZE:
            break
        page += 1

    print(f"\n── Geocode complete ──────────────────────────────────────")
    print(f"  Jobs updated  : {total_updated:,}")
    print(f"  Photon (free) : {total_photon:,}")
    print(f"  Failed/skipped: {total_failed:,}")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    limit_arg   = next((int(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--limit=")), None)
    type_filter = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--type=")), None)
    geocode_mode = "--geocode" in sys.argv[1:]
    maps_key     = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--maps-key=")), None)
    max_jobs = limit_arg or MAX_TOTAL_JOBS
    max_desc = min(limit_arg or MAX_DETAIL_JOBS, MAX_DETAIL_JOBS)

    if geocode_mode:
        run_geocode_backfill(maps_key=maps_key)
        return

    # Build flat list of all sources to consider
    all_flat = [s for sources in ALL_SOURCES.values() for s in sources]

    if type_filter:
        candidates = ALL_SOURCES.get(type_filter, [])
        if not candidates:
            print(f"Unknown type '{type_filter}'. Available: {list(ALL_SOURCES)}")
            sys.exit(1)
    elif positional:
        candidates = [s for s in all_flat if s[0] in positional]
        if not candidates:
            print(f"No matching sources. Available: {[s[0] for s in all_flat]}")
            sys.exit(1)
    else:
        candidates = all_flat

    print(f"Backfilling {len(candidates)} source(s): {[s[0] for s in candidates]}")
    print(f"  Max jobs/source: {max_jobs}, Max descriptions: {max_desc}\n")

    total_stats = {"inserted": 0, "skipped": 0, "errors": 0}

    for source_id, company_handle, display_name, url, source_type in candidates:
        print(f"━━━ {display_name} ({source_id} / {source_type}) ━━━")
        t0 = time.time()
        try:
            stubs = fetch_source(source_id, company_handle, display_name, url,
                                 source_type, max_jobs, max_desc)
            if not stubs:
                print(f"  ✗ No jobs returned — skipping.\n")
                total_stats["errors"] += 1
                continue

            print(f"  → Looking up/creating company {company_handle!r}...")
            company_id = get_or_create_company_id(display_name, company_handle)
            if not company_id:
                print(f"  ✗ Could not resolve company ID for {company_handle!r} — skipping.\n")
                total_stats["errors"] += 1
                continue
            print(f"  → company_id={company_id}")

            print(f"  → Upserting {len(stubs)} jobs into D1...")
            stats = upsert_jobs(source_id, company_id, company_handle, source_type, stubs)

            now = int(time.time())
            run_d1(
                f"UPDATE sources SET last_fetched_at = {now}, "
                f"last_job_count = {len(stubs)}, last_error = NULL "
                f"WHERE id = {sql_str(source_id)};",
                label="update last_fetched_at"
            )

            elapsed = time.time() - t0
            total_stats["inserted"] += stats["inserted"]
            total_stats["skipped"]  += stats["skipped"]
            print(f"  ✓ {stats['inserted']} inserted, {stats['skipped']} skipped — {elapsed:.0f}s\n")

        except Exception as e:
            print(f"  ✗ Error: {e}\n")
            total_stats["errors"] += 1

    print(f"━━━ Done ━━━")
    print(f"Total inserted: {total_stats['inserted']}, skipped: {total_stats['skipped']}, errors: {total_stats['errors']}")
    print("\nSources marked as fetched — cron will skip them for their configured interval.")
    print("AI enrichment (summaries, embeddings) runs on the next cron cycle.")

if __name__ == "__main__":
    main()
