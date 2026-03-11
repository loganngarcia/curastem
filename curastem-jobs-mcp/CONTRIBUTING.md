# Contributing — curastem-jobs-mcp

This guide covers how to set up the MCP server locally, how to add new tools, and what standards to follow.

---

## Before you start

Read [ARCHITECTURE.md](./ARCHITECTURE.md). The most important things to know before changing this codebase are:

1. This server contains no business logic. It only translates tool calls into jobs API calls.
2. Tool descriptions are written for language models, not for developers.
3. Errors should be graceful — a tool that can't find data returns a helpful message, not a crash.

---

## Development setup

### Prerequisites

- Node.js 18+
- A running instance of `curastem-jobs-api` (see that project's CONTRIBUTING.md)
- An API key from the jobs API

### Install dependencies

```bash
cd curastem-jobs-mcp
npm install
```

### Configure local secrets

Create `.dev.vars` (gitignored):

```
JOBS_API_BASE_URL=http://localhost:8787
JOBS_API_KEY=your-test-api-key-here
```

### Start the dev server

```bash
# Start jobs API in one terminal:
cd ../curastem-jobs-api && npm run dev

# Start MCP server in another:
cd curastem-jobs-mcp && npm run dev   # runs on http://localhost:8788
```

### Test the server manually

```bash
# List all tools
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call search_jobs
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"cashier","limit":3}}}'

# Get market overview
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_market_overview","arguments":{}}}'
```

---

## Adding a new tool

See the step-by-step guide in [ARCHITECTURE.md — Adding a new tool](./ARCHITECTURE.md#adding-a-new-tool-step-by-step).

Summary:
1. Create `src/tools/yourNewTool.ts` with a `McpTool` schema and a `run()` function.
2. Import both in `src/index.ts`.
3. Add the schema to `ALL_TOOLS`.
4. Add a `case` in `handleToolCall`.
5. Update `README.md` with the new tool's description and parameters.

### Tool file template

```typescript
// src/tools/myNewTool.ts

import type { JobsApiClient } from "../client.ts";
import type { McpTool } from "../types.ts";

/**
 * [One-paragraph explanation of what this tool does and why it exists.
 *  Explain the user interaction pattern it supports.]
 */
export const myNewToolTool: McpTool = {
  name: "my_new_tool",
  description:
    "Description written for the language model. Include example user phrases. " +
    "Explain when to call this vs other tools.",
  inputSchema: {
    type: "object",
    properties: {
      required_param: {
        type: "string",
        description: "What this is. Include example values.",
      },
    },
    required: ["required_param"],
  },
};

export interface MyNewToolArgs {
  required_param: string;
}

export async function runMyNewTool(
  client: JobsApiClient,
  args: MyNewToolArgs
): Promise<unknown> {
  const response = await client.listJobs({ q: args.required_param });
  // Format and return. Include agent-friendly hints in the response.
  return {
    results: response.data,
    hint: "Pass next_cursor to get more results.",
  };
}
```

---

## Code standards

### Tool descriptions

Tool `description` fields are the most important strings in this codebase. Write them from the perspective of a language model deciding whether to call the tool.

- Include example user phrasings
- Explain when to prefer this tool over a similar one
- Keep them under 150 words

### Response formatting

- Surface agent hints as string fields (`pagination_note`, `empty_note`, `note`)
- Use `null` instead of omitting optional fields
- Rename API field names to be user-friendly in the returned object
- Never expose raw D1 column names in tool responses

### Error handling

Follow the error strategy from [ARCHITECTURE.md — Error handling strategy](./ARCHITECTURE.md#error-handling-strategy):

- Missing required args → `rpcError(req.id, McpErrorCode.InvalidParams, "...")`
- jobs API 404 → `rpcError(req.id, McpErrorCode.InvalidParams, "...")`
- Tool-level "no data found" → return `{ results: [], note: "..." }` (success response with empty data)
- Unexpected errors → `rpcError(req.id, McpErrorCode.InternalError, "...")`

### TypeScript

- Do not use `any`
- Cast `args as unknown as YourArgsType` when receiving untyped tool call arguments
- Validate required args before calling the API

---

## Pull request checklist

- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `npx wrangler deploy --dry-run` succeeds
- [ ] New tool is registered in `ALL_TOOLS` in `src/index.ts`
- [ ] New tool has a `case` in `handleToolCall`
- [ ] Tool description is written for the model (not the developer)
- [ ] Tool is documented in `README.md`
- [ ] Commit message is in Chinese (project convention)
