# Jobs API — billing snapshot (one page)

**v1.2 · April 2026 ·** `curastem-jobs-api` / `api.curastem.org` · Not statutory financials. **Invoices and Cloudflare or Google billing exports are the source of truth.** Refresh D1 counts via Cloudflare MCP (`d1_database_query`, database id `d2461924-d1f9-47e6-a62b-6d795161433d`).

---

### What we pay for

| Area | Vendors | How billed |
|------|---------|------------|
| Company enrichment | Exa (deep search ×2 per company), Brandfetch, Logo.dev | Per call / plan |
| AI | Gemini Flash-Lite (extract), Gemini Embedding 2 (vectors) | Per token |
| Maps | Places Text Search, Geocoding (Photon/Nominatim first) | Per billable request (KV-cached) |
| Platform | Cloudflare Workers, D1, KV, Vectorize, optional Browser | Plan + usage |

**Pricing URLs:** [Gemini](https://ai.google.dev/gemini-api/docs/pricing) · [Maps](https://developers.google.com/maps/billing-and-pricing/pricing) · [Exa](https://exa.ai/pricing) · [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/)

---

### Unit rates (paid tier, confirm on vendor sites)

| Item | Rate |
|------|------|
| Exa deep | ~$0.012/request (~$12/1k) |
| Gemini 3.1 Flash-Lite | $0.25/1M in · $1.50/1M out |
| Gemini Embedding 2 (text) | $0.20/1M tokens |
| Places Text Search (new) | ~$0.032/request (code) |
| Geocoding API | ~$0.005/request (code) |

---

### Production D1 (sample query, 2026-04-02 UTC)

| Metric | Value |
|--------|------:|
| Jobs | 234,425 |
| Companies | 1,763 |
| Jobs with embedding | 16,875 |
| Exa profile / social done | 1,748 / 1,540 |
| New companies (7d) | 111 |
| New jobs first seen (7d) | 79,545 |
| HQ Places backlog (city but no lat) | 0 |

---

### Estimated average daily spend (USD)

Single blended planning number. Gemini Flash-Lite and Maps rows are placeholders until billing export; Exa uses trailing 7d company creation; embeddings use code max backfill (200/hr × 24 × ~800 tokens × $0.20/1M).

| Line | $/day |
|------|------:|
| Exa | 0.38 |
| Gemini embeddings | 0.77 |
| Gemini Flash-Lite | 0.35 |
| Google Maps (billable) | 0.25 |
| Cloudflare (≈$5/mo floor) | 0.17 |
| **Total** | **1.92** |

**~$58/mo** at 30 days before tax and overages. Browser Rendering not included.

---

**Maintenance:** Re-run D1 SQL monthly; replace placeholder rows with invoice data; re-check pricing links quarterly. Code pointers: `src/enrichment/exa.ts`, `ai.ts`, `company.ts`, `ingestion/runner.ts`, `utils/geocode.ts`, `utils/placesGeocode.ts`, `wrangler.jsonc`.
