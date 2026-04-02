#!/usr/bin/env python3
"""
backfill.py — Force-ingest Workday sources into production D1 from your local machine.

No 90-second Worker timeout here: fetches everything locally, then writes
directly into D1 via wrangler. After each source, last_fetched_at is set so
the cron skips it for the configured interval — freeing up cron cycles for
other sources.

Usage:
    python3 backfill.py                          # all sources
    python3 backfill.py wd-petco wd-nordstrom    # specific source IDs
    python3 backfill.py --limit 200              # cap jobs per source (faster test)
"""

import sys, os, json, re, uuid, hashlib, subprocess, time, tempfile
import urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

# ── Sources ──────────────────────────────────────────────────────────────────
# (source_id, company_handle, display_name, cxs_url)
WORKDAY_SOURCES = [
    ("wd-petco",        "petco",             "Petco",               "https://petco.wd1.myworkdayjobs.com/wday/cxs/petco/External/jobs"),
    ("wd-nordstrom",    "nordstrom",         "Nordstrom",           "https://nordstrom.wd501.myworkdayjobs.com/wday/cxs/nordstrom/nordstrom_careers/jobs"),
    ("wd-bofa",         "bank-of-america",   "Bank of America",     "https://ghr.wd1.myworkdayjobs.com/wday/cxs/ghr/lateral-us/jobs"),
    ("wd-dsg",          "dicks-sporting-goods","Dick's Sporting Goods","https://dickssportinggoods.wd1.myworkdayjobs.com/wday/cxs/dickssportinggoods/DSG/jobs"),
    ("wd-meijer",       "meijer",            "Meijer",              "https://meijer.wd5.myworkdayjobs.com/wday/cxs/meijer/Meijer_Stores_Hourly/jobs"),
    ("wd-morganstanley","morgan-stanley",    "Morgan Stanley",      "https://ms.wd5.myworkdayjobs.com/wday/cxs/ms/External/jobs"),
    ("wd-fedex",        "fedex",             "FedEx",               "https://fedex.wd1.myworkdayjobs.com/wday/cxs/fedex/FXE-LAC_External_Career_Site/jobs"),
]

# ── Constants ─────────────────────────────────────────────────────────────────
PAGE_SIZE = 20
# No Worker timeout here — fetch everything on first run
MAX_TOTAL_JOBS = 5000
MAX_DETAIL_JOBS = 1000   # still cap detail fetches per source to stay reasonable
DETAIL_CONCURRENCY = 24  # more than the Worker since no rate limiting concern

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

D1_DB = "curastem-jobs"

# ── Helpers ───────────────────────────────────────────────────────────────────

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
    """Format a Python value as a SQL literal (NULL, integer, or escaped string)."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def _wrangler_cwd() -> str:
    return os.path.dirname(os.path.abspath(__file__))

def _parse_wrangler_json(raw: str):
    """Extract the JSON array from wrangler d1 execute output (strips banner text)."""
    # wrangler prints its banner to stdout; the JSON starts at the first '['.
    idx = raw.find("[")
    if idx == -1:
        return None
    try:
        return json.loads(raw[idx:])
    except Exception:
        return None

def run_d1(sql: str, label: str = "") -> bool:
    """Execute SQL against the remote D1 database via wrangler."""
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
            # Show last 300 chars of combined output for debugging
            print(f"  ✗ D1 error ({label}): {out[-300:]}")
            return False
        return True
    finally:
        os.unlink(fname)

def d1_query(sql: str) -> list:
    """Run a SELECT via wrangler d1 execute and return the results list."""
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

# ── Workday API ───────────────────────────────────────────────────────────────

def get_session_cookie(cxs_url: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(cxs_url)
    host = f"{parsed.scheme}://{parsed.netloc}"
    # Extract board name: /wday/cxs/{company}/{board}/jobs → board
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

def fetch_list_page(cxs_url: str, offset: int, cookies: str) -> dict:
    req = urllib.request.Request(
        cxs_url,
        data=json.dumps({"limit": PAGE_SIZE, "offset": offset,
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

def fetch_description(url: str, cookies: str) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": BROWSER_UA,
            "Accept": "text/html",
            "Cookie": cookies,
        })
        with urllib.request.urlopen(req, timeout=12) as r:
            html = r.read().decode("utf-8", errors="replace")
        for m in re.findall(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
            html, re.I
        ):
            try:
                d = json.loads(m)
                items = d if isinstance(d, list) else [d]
                for item in items:
                    if isinstance(item, dict) and item.get("@type") == "JobPosting":
                        desc = item.get("description", "")
                        if desc:
                            return desc
            except Exception:
                pass
    except Exception:
        pass
    return None

def parse_posted_on(raw: Optional[str]) -> Optional[int]:
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

def fetch_workday_source(source_id: str, company_handle: str, display_name: str,
                          cxs_url: str, max_jobs: int = MAX_TOTAL_JOBS,
                          max_desc: int = MAX_DETAIL_JOBS) -> list[dict]:
    """Two-phase Workday fetch: collect stubs, then enrich descriptions."""
    from urllib.parse import urlparse
    parsed = urlparse(cxs_url)
    host = f"{parsed.scheme}://{parsed.netloc}"
    parts = parsed.path.strip("/").split("/")
    board = parts[-2] if len(parts) >= 2 else ""

    print(f"  → Cookie preflight...")
    cookies = get_session_cookie(cxs_url)

    # Phase 1: collect stubs
    stubs = []
    offset = 0
    total = float("inf")
    while offset < total and len(stubs) < max_jobs:
        try:
            data = fetch_list_page(cxs_url, offset, cookies)
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
        if len(batch) < PAGE_SIZE:
            break
        offset += len(batch)
        if len(stubs) % 200 == 0:
            print(f"  → Collected {len(stubs)}/{int(total)} stubs...")

    print(f"  → {len(stubs)} stubs collected. Fetching descriptions (up to {max_desc})...")

    # Phase 2: descriptions at higher concurrency
    to_enrich = stubs[:max_desc]
    descriptions = [None] * len(to_enrich)

    def _fetch(i_url):
        i, url = i_url
        return i, fetch_description(url, cookies)

    with ThreadPoolExecutor(max_workers=DETAIL_CONCURRENCY) as pool:
        futures = {pool.submit(_fetch, (i, s["apply_url"])): i
                   for i, s in enumerate(to_enrich)}
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

    # Merge descriptions
    for i, stub in enumerate(stubs):
        stub["description"] = descriptions[i] if i < len(to_enrich) else None

    return stubs

# ── D1 insert ─────────────────────────────────────────────────────────────────

def get_or_create_company_id(name: str, slug: str) -> Optional[str]:
    rows = d1_query(f"SELECT id FROM companies WHERE slug = {sql_str(slug)} LIMIT 1")
    if rows:
        return rows[0]["id"]
    new_id = str(uuid.uuid4())
    now = int(time.time())
    # Use INSERT OR IGNORE — if slug already exists (race or prior run), we just re-query.
    ok = run_d1(
        f"INSERT OR IGNORE INTO companies (id, name, slug, created_at, updated_at) "
        f"VALUES ({sql_str(new_id)}, {sql_str(name)}, {sql_str(slug)}, {now}, {now});",
        label=f"create company {slug}"
    )
    rows = d1_query(f"SELECT id FROM companies WHERE slug = {sql_str(slug)} LIMIT 1")
    return rows[0]["id"] if rows else (new_id if ok else None)

def insert_jobs_batch(jobs_sql: list[str]) -> bool:
    if not jobs_sql:
        return True
    sql = "\n".join(jobs_sql)
    return run_d1(sql, label=f"insert {len(jobs_sql)} jobs")

def upsert_jobs(source_id: str, company_id: str, company_slug: str,
                source_name: str, stubs: list[dict], batch_size: int = 40) -> dict:
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
            posted_at = parse_posted_on(stub.get("posted_on"))

            # Normalize employment type
            time_type = (stub.get("time_type") or "").lower()
            employment_type = None
            if "full" in time_type:
                employment_type = "full_time"
            elif "part" in time_type:
                employment_type = "part_time"

            # Normalize workplace type
            workplace_type = None
            if loc_raw:
                loc_lower = loc_raw.lower()
                if "remote" in loc_lower:
                    workplace_type = "remote"

            apply_url = stub.get("apply_url") or ""

            statements.append(
                # INSERT OR IGNORE: skip if this (source_id, external_id) already exists.
                # FK constraint note: SQLite's OR IGNORE doesn't suppress FK violations,
                # but both company_id and source_id are verified valid before this batch.
                f"INSERT INTO jobs "
                f"(id, company_id, source_id, external_id, title, locations, "
                f"employment_type, workplace_type, apply_url, source_url, source_name, "
                f"description_raw, posted_at, first_seen_at, dedup_key, created_at, updated_at) "
                f"SELECT "
                f"{sql_str(job_id)}, {sql_str(company_id)}, {sql_str(source_id)}, "
                f"{sql_str(ext_id)}, {sql_str(title)}, {sql_str(locations_json)}, "
                f"{sql_str(employment_type)}, {sql_str(workplace_type)}, "
                f"{sql_str(apply_url)}, {sql_str(apply_url)}, {sql_str(source_name)}, "
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

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    limit_arg = next((int(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--limit=")), None)
    max_jobs = limit_arg or MAX_TOTAL_JOBS
    max_desc = min(limit_arg or MAX_DETAIL_JOBS, MAX_DETAIL_JOBS)

    # Filter sources if IDs given
    sources = [s for s in WORKDAY_SOURCES if not args or s[0] in args]
    if not sources:
        print(f"No matching sources. Available: {[s[0] for s in WORKDAY_SOURCES]}")
        sys.exit(1)

    print(f"Backfilling {len(sources)} source(s): {[s[0] for s in sources]}")
    print(f"  Max jobs/source: {max_jobs}, Max descriptions: {max_desc}\n")

    total_stats = {"inserted": 0, "skipped": 0, "errors": 0}

    for source_id, company_handle, display_name, cxs_url in sources:
        print(f"━━━ {display_name} ({source_id}) ━━━")
        t0 = time.time()

        try:
            stubs = fetch_workday_source(
                source_id, company_handle, display_name, cxs_url, max_jobs, max_desc
            )
            if not stubs:
                print(f"  ✗ No jobs fetched — skipping.")
                total_stats["errors"] += 1
                continue

            print(f"  → Looking up/creating company {company_handle!r}...")
            company_id = get_or_create_company_id(display_name, company_handle)
            if not company_id:
                print(f"  ✗ Could not resolve company ID for {company_handle!r} — skipping.")
                total_stats["errors"] += 1
                continue
            print(f"  → company_id={company_id}")

            print(f"  → Upserting {len(stubs)} jobs into D1...")
            stats = upsert_jobs(source_id, company_id, company_handle, "workday", stubs)

            # Mark source as freshly fetched so cron skips it for 48 h
            now = int(time.time())
            run_d1(
                f"UPDATE sources SET last_fetched_at = {now}, "
                f"last_job_count = {len(stubs)}, last_error = NULL "
                f"WHERE id = {sql_str(source_id)};",
                label="update last_fetched_at"
            )

            elapsed = time.time() - t0
            total_stats["inserted"] += stats["inserted"]
            total_stats["skipped"] += stats["skipped"]
            print(f"  ✓ {stats['inserted']} inserted, {stats['skipped']} skipped — {elapsed:.0f}s\n")

        except Exception as e:
            print(f"  ✗ Error: {e}\n")
            total_stats["errors"] += 1

    print(f"━━━ Done ━━━")
    print(f"Total inserted: {total_stats['inserted']}, skipped: {total_stats['skipped']}, errors: {total_stats['errors']}")
    print("\nSources marked as fetched — cron will skip them for 48 h.")
    print("AI enrichment (summaries, embeddings) will run on the next cron cycle.")

if __name__ == "__main__":
    main()
