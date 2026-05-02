# Public API Backend

Curastem public API access is account-based and dollar-metered.

## Authentication

Customer requests use:

```http
Authorization: Bearer cstk_live_...
```

API keys are shown once at creation time. Only `SHA-256(key)` is stored.

Admin-only key and balance management routes use:

```http
Authorization: Bearer $ADMIN_API_SECRET
X-Curastem-Admin-Actor: ops@example.com
```

`ADMIN_API_SECRET` must be configured as a Worker secret and must not be reused as a customer API key.

## Billing

Balances are stored as USD micro-units: `1 USD = 1,000,000`.

For LLM-backed tools:

```text
raw_provider_cost_usd = input_token_cost + output_token_cost
charged_amount_usd = raw_provider_cost_usd * 5
```

Every metered request writes a `public_usage_ledger` row with the API key, account, request id, route, tool, model, token counts, raw provider cost, multiplier, charged amount, and resulting balance.

## Public Agent Tools

Public REST:

- `GET /v1/agent/tools`
- `POST /v1/agent/tool`

Public product tools:

- `search_jobs`
- `get_job_details`
- `create_resume`
- `create_cover_letter`

MCP should expose the same product tools through this public route, plus `get_market_overview` and `get_job_keywords`.
