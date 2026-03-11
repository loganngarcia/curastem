# curastem-jobs-mcp

The Curastem Jobs MCP server is a Cloudflare Worker that exposes job search and retrieval capabilities as [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tools. It is a clean, provider-agnostic wrapper around the [curastem-jobs-api](../curastem-jobs-api/README.md) — all data and business logic lives in the API; this server only translates MCP tool calls into API requests.

It works with any MCP-compatible client: **OpenAI**, **Anthropic Claude**, **Google Gemini**, **OpenRouter**, **LlamaIndex**, **LangChain**, or any other agent framework that supports the MCP standard. There are no vendor-specific extensions.

---

## How it fits with curastem-jobs-api

```
User / Agent
    │
    │  MCP JSON-RPC (tools/list, tools/call)
    ▼
curastem-jobs-mcp  (this project)
    │
    │  REST HTTP (Authorization: Bearer <service key>)
    ▼
curastem-jobs-api  (job data, ingestion, AI enrichment)
    │
    ▼
Cloudflare D1 (job database)
```

The MCP server has no database, no ingestion logic, and no AI calls of its own. It exists solely to make the jobs API accessible to language models through a standard protocol.

---

## Available tools (7 total)

### `search_jobs`

Search job listings by keyword, location, or job type.

**When to use:** User asks to find jobs, browse openings, or search by role/company/location.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Keywords: title, role, skill, company name |
| `location` | string | no | City, state, or region |
| `employment_type` | string | no | `full_time` \| `part_time` \| `contract` \| `internship` \| `temporary` |
| `workplace_type` | string | no | `remote` \| `hybrid` \| `on_site` |
| `limit` | number | no | Results per call (default 10, max 20) |

**Returns:** Array of job snippets with id, title, company, location, salary, summary, and apply URL.

---

### `get_recent_jobs`

Returns the most recently posted jobs.

**When to use:** User asks what's new, wants to browse current listings, or no specific query is provided.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | no | Number of results (default 10, max 20) |
| `cursor` | string | no | Pagination cursor from a previous response's `next_cursor` |

**Returns:** Array of recent job snippets with pagination info.

---

### `get_job_details`

Fetch full details for a specific job.

**When to use:** User wants to know more about a job from a previous search result. Also triggers lazy AI extraction for jobs not yet enriched (responsibilities, qualifications).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `job_id` | string | yes | The job ID from a previous `search_jobs` or `get_recent_jobs` result |

**Returns:** Full job object including:
- Structured `description` (responsibilities, minimum_qualifications, preferred_qualifications)
- AI-generated summary
- Full company metadata (website, LinkedIn, Glassdoor, X/Twitter)
- Salary when available

---

### `get_jobs_by_company`

Returns all open jobs at a specific company.

**When to use:** User asks "what is Stripe hiring for?" or "does Walmart have any openings?"

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `company` | string | yes | Company slug (lowercase-hyphenated): `stripe`, `walmart`, `target` |
| `employment_type` | string | no | Filter to a specific job type |
| `workplace_type` | string | no | Filter to a work arrangement |
| `limit` | number | no | Max results (default 20, max 50) |
| `cursor` | string | no | Pagination cursor |

**Returns:** Company metadata + list of open jobs at that company.

---

### `suggest_similar_jobs`

Finds open jobs similar to one the user is already viewing.

**When to use:** User says "show me more like this" or "similar roles elsewhere."

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `job_id` | string | yes | The ID of the job to find similar roles for |
| `limit` | number | no | Results to return (default 5, max 10) |

**Returns:** Source job context + list of similar jobs by title keyword.

---

### `get_market_overview`

Returns aggregate statistics about the current job market as indexed by Curastem.

**When to use:** User asks broad questions like "how many remote jobs are there?", "which companies are hiring the most?", or "what does the market look like?"

**Parameters:** None required.

**Returns:** Job counts by recency, employment type, workplace type, and top 10 hiring companies.

---

## How agents use pagination

The `search_jobs` and `get_recent_jobs` tools return a `next_cursor` field when more results are available. To get the next page, pass `next_cursor` as the `cursor` parameter on the next call.

Example flow:

```
1. search_jobs({ query: "cashier", limit: 10 })
   → returns 10 jobs, next_cursor: "eyJ0c..."

2. search_jobs({ query: "cashier", limit: 10, cursor: "eyJ0c..." })
   → returns next 10 jobs, next_cursor: null (end of results)
```

---

## Protocol

The MCP server implements [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over HTTP POST.

**Endpoint:** `POST /`

**Content-Type:** `application/json`

### Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

Returns server capabilities and version info.

### List tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

### Call a tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_jobs",
    "arguments": {
      "query": "barista",
      "location": "Seattle",
      "workplace_type": "on_site"
    }
  }
}
```

---

## Connecting an agent

This server uses standard MCP (JSON-RPC 2.0 over HTTP POST). It works with any agent framework that supports the MCP protocol. The agent sends `tools/list` to discover available tools, then calls `tools/call` as needed during a conversation.

### Cursor / Claude Desktop / OpenAI Agents SDK

Configure the MCP server URL as an HTTP MCP endpoint:

```json
{
  "mcpServers": {
    "curastem-jobs": {
      "url": "https://curastem-jobs-mcp.your-subdomain.workers.dev"
    }
  }
}
```

### Anthropic Claude

Pass the deployed Worker URL as an MCP server when constructing your client. Claude will call `tools/list` automatically and use available tools during the conversation.

### Google Gemini

Configure the MCP server URL in your Gemini client's MCP server list. Gemini will call `tools/list` on connection and invoke tools during the conversation.

### Any other agent (LangChain, LlamaIndex, OpenRouter, etc.)

The MCP transport is HTTP POST with JSON-RPC 2.0 — any framework with HTTP MCP support will work. Manually call `tools/list` once to get schemas, then invoke `tools/call` with the tool name and arguments during agent execution.

---

## Local development

### Prerequisites

- Node.js 18+
- A running instance of `curastem-jobs-api` (local or deployed)
- An API key from the jobs API (request at [developers@curastem.org](mailto:developers@curastem.org))

### Setup

```bash
cd curastem-jobs-mcp
npm install
```

### Configure local secrets

Create a `.dev.vars` file (gitignored):

```
JOBS_API_BASE_URL=http://localhost:8787
JOBS_API_KEY=your_test_api_key_here
```

### Start local dev server

```bash
# In curastem-jobs-api directory:
npm run dev  # starts on http://localhost:8787

# In curastem-jobs-mcp directory (separate terminal):
npm run dev  # starts on http://localhost:8788
```

### Test the MCP server

```bash
# List available tools
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Search for jobs
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "search_jobs",
      "arguments": {
        "query": "cashier",
        "location": "Chicago",
        "limit": 5
      }
    }
  }'

# Get recent jobs
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_recent_jobs",
      "arguments": { "limit": 5 }
    }
  }'
```

### Deploy to production

```bash
wrangler secret put JOBS_API_BASE_URL
wrangler secret put JOBS_API_KEY
npm run deploy
```

---

## Error handling

Tool errors are returned as JSON-RPC error responses:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Jobs API error: Job not found"
  }
}
```

| JSON-RPC Code | Meaning |
|---|---|
| -32700 | Parse error — invalid JSON |
| -32600 | Invalid request — malformed JSON-RPC |
| -32601 | Method not found — unknown tool name |
| -32602 | Invalid params — missing required argument |
| -32603 | Internal error — API error or unexpected failure |

---

## Design principles

**No duplicated business logic.** The MCP server never queries the database, never calls AI models directly, and never contains ingestion logic. It only calls the jobs API and formats responses for agents.

**Agent-first response format.** Tool results are formatted to be useful as context in a conversation — concise snippets for list tools, full structured data for detail tools.

**Graceful degradation.** If the jobs API returns a 404 or rate limit error, the MCP server surfaces a clear error message rather than crashing. Agents can retry or ask the user to rephrase.

**Stateless.** Each MCP request is fully independent. There is no session state. Pagination is handled by passing cursors as arguments to subsequent tool calls.
