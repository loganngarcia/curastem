# Architecture — curastem-jobs-mcp

This document explains the design of the Curastem Jobs MCP server. It is meant to answer: *"Why is this structured as a thin wrapper, and how do I add to it without breaking anything?"*

---

## Core design principle: thin by intent

The MCP server has exactly one job: **translate MCP tool-call requests into jobs API calls and format the responses for agents**.

It contains no:
- Database access
- Business logic
- Ingestion code
- AI model calls (all AI enrichment lives in the jobs API, not this server)

This is not laziness — it is a deliberate choice. Keeping the MCP server thin means:

1. **Single source of truth.** When job data or AI extraction logic changes, only `curastem-jobs-api` needs updating. The MCP server picks up the changes automatically.

2. **Independent deployability.** The MCP server and the jobs API can be deployed, scaled, and versioned independently.

3. **Easy testing.** You can test every tool by mocking the jobs API HTTP responses. No D1, no KV, no secrets needed.

4. **Agent-first design.** Each tool is shaped around an agent interaction pattern, not around what the database supports. Tool names and descriptions are written for the model, not for developers.

---

## Request lifecycle

```
Agent / LLM
   │
   │  POST /
   │  { jsonrpc: "2.0", method: "tools/call", params: { name: "...", arguments: {...} } }
   │
   ▼
src/index.ts  ← validates JSON-RPC, routes to dispatcher
   │
   ▼
dispatch()  ← matches method to handler
   │
   ▼
handleToolCall()  ← matches tool name to runner function
   │
   ▼
src/tools/yourTool.ts  ← builds API params, formats response
   │
   ▼
src/client.ts (JobsApiClient)  ← typed HTTP to curastem-jobs-api
   │
   ▼
curastem-jobs-api  ← returns data
   │
   ▼
(back up the chain)
   │
   ▼
Agent receives: { content: [{ type: "text", text: "{ ... formatted JSON ... }" }] }
```

---

## Tool design philosophy

Each tool should be written as if you are explaining it to a language model, not a developer. The `description` field is the most important part of a tool — it determines when the model chooses to call it.

**Good tool description:** explains intent and gives example phrasings.
**Bad tool description:** describes what the function does technically.

### Tool taxonomy

The 7 tools are grouped by interaction pattern:

| Group | Tool | User intent |
|---|---|---|
| Discovery | `search_jobs` | "Find me jobs matching X" |
| Discovery | `get_recent_jobs` | "What's new? / What are the latest Y jobs?" |
| Discovery | `get_jobs_by_company` | "What is Company Z hiring for?" |
| Detail | `get_job_details` | "Tell me more about this job" |
| Detail | `suggest_similar_jobs` | "Show me more like this" |
| Context | `get_market_overview` | "What does the market look like?" |

This grouping is intentional. When adding a new tool, ask first: does this serve discovery, detail, analysis, or context?

---

## File layout reference

```
src/
├── index.ts      MCP protocol handler + tool dispatcher. Add new tools here.
├── types.ts      MCP protocol types, Env interface, API response shapes.
├── client.ts     JobsApiClient: typed HTTP wrapper for curastem-jobs-api.
│
└── tools/        One file per tool. Each exports a McpTool schema + a run() function.
    ├── searchJobs.ts
    ├── getRecentJobs.ts
    ├── getJobsByCompany.ts
    ├── getJobDetails.ts
    ├── suggestSimilarJobs.ts
    └── getMarketOverview.ts
```

---

## Adding a new tool (step-by-step)

**1. Create the tool file** at `src/tools/yourNewTool.ts`:

```typescript
// src/tools/yourNewTool.ts

import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

// The McpTool schema is what the model sees. Write descriptions for the model.
export const yourNewToolTool: McpTool = {
  name: "your_new_tool",
  description: "Describe when an agent should call this. Include example user phrases.",
  inputSchema: {
    type: "object",
    properties: {
      some_param: {
        type: "string",
        description: "What this parameter is and example values.",
      },
    },
    required: ["some_param"],
  },
};

export interface YourNewToolArgs {
  some_param: string;
}

export async function runYourNewTool(
  client: JobsApiClient,
  args: YourNewToolArgs
): Promise<unknown> {
  // Call the jobs API via client.*
  // Format the response for the agent.
  // Return a plain object — index.ts wraps it in the MCP content envelope.
}
```

**2. Register in `src/index.ts`:**

```typescript
// Import at the top:
import { yourNewToolTool } from "./tools/yourNewTool.ts";
import { runYourNewTool, type YourNewToolArgs } from "./tools/yourNewTool.ts";

// Add to ALL_TOOLS array:
const ALL_TOOLS = [
  // ... existing tools ...
  yourNewToolTool,
];

// Add a case in handleToolCall():
case "your_new_tool":
  result = await runYourNewTool(client, args as YourNewToolArgs);
  break;
```

**3. If the tool needs a new API endpoint**, add it to `curastem-jobs-api` first, then add a method to `src/client.ts`.

**4. Update the README** with the new tool's description and parameters.

---

## Response formatting guidelines

The `content[0].text` field is what the model reads. It is serialized JSON. Follow these guidelines:

- **Surface hints for the model.** Fields like `pagination_note`, `empty_note`, `usage_hint` are strings the model can quote directly in its response to the user.
- **Never return raw DB row shapes.** Rename internal field names to be agent-friendly (`company_name` → `company`, `posted_at` → `posted_at` as ISO string).
- **Null over absent.** Use `null` instead of omitting optional fields so the model knows the field exists and is simply unavailable.
- **Keep responses flat when possible.** Nested objects are fine for well-defined structures (company metadata), but avoid 3+ levels of nesting.

---

## Error handling strategy

| Error type | What we do |
|---|---|
| jobs API 404 | Return `InvalidParams` (-32602) with a clear message |
| jobs API 429 | Return `InternalError` (-32603) with "try again shortly" |
| Missing required arg | Return `InvalidParams` before calling the API |
| Unexpected JS error | Return `InternalError` with the error message |

The distinction between JSON-RPC errors (which break the protocol) and tool-level errors (which are part of a successful result) is important. A tool that couldn't find data should return a helpful result, not crash the JSON-RPC session.

---

## Key invariants to preserve

1. **No SQL, no D1, no KV.** The MCP server is stateless. Every response comes from the jobs API.
2. **Tool descriptions are written for the model.** Do not describe function signatures — describe user intent.
3. **Errors are graceful.** A tool failure should return a useful message, never a 500 crash.
4. **Required args are validated before calling the API.** Surface parameter errors as `InvalidParams`, not as API 400 responses.
