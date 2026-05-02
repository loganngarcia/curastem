# Cloud Agent Runtime Contract

`app/web.tsx` should render UI and apply UI events. The Cloud Agent Runtime owns model tool declarations, server-executable tools, and the tool-calling loop.

## Request

Text chat calls `POST /agent/chat` with:

- `contents`: Gemini-compatible conversation contents.
- `systemInstruction`: optional Gemini system instruction.
- `clientContext`: UI hints that the server cannot infer, such as selected job id, already shown job ids, coarse geo, and whether canvas/doc panels are open.

Direct tool execution calls `POST /agent/tool` with:

- `name`: tool name, currently `search_jobs` or `get_job_details`.
- `args`: model tool arguments.
- `searchParams`: optional canonical query string for compatibility while `web.tsx` is being thinned.

## Response Events

The server returns a JSON object with an `events` array:

- `assistant_text`: assistant text to show in chat.
- `job_cards`: normalized job snippets to attach to a message.
- `job_detail`: job detail payload for follow-up generation or UI context.
- `doc_update`: HTML intended for the document editor.
- `whiteboard_command`: structured whiteboard operation for the client to apply.
- `memory_update`: profile or memory mutation result.
- `tool_error`: recoverable tool failure.

The current migration starts with jobs events because those are already server-owned data. UI-coupled tools can move later by returning `doc_update` and `whiteboard_command` events instead of applying React state directly in the model loop.
