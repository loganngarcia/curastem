# Agent Skills API

> **Summary for LLMs**: Agent Skills API is a Cloudflare Worker that serves a JSON list of "skills" (mentorship topic guides) from a GitHub repo's `skills/` directory. The Curastem Framer component calls this API to populate a slash-command menu; when users select skills, their names and descriptions are injected into the AI prompt so the model knows which mentorship workflows to apply. Default repo: `loganngarcia/curastem`. Origin-restricted (CORS). No API key in client.

---

## What It Is

**Agent Skills API** is a read-only HTTP API that:

1. Fetches skill metadata from a GitHub repository's `skills/` directory
2. Returns a JSON array of skill objects (`id`, `name`, `description`, `path`)
3. Is origin-restricted: only requests from domains in `ALLOWED_ORIGINS` receive data
4. Runs as a Cloudflare Worker (serverless, edge-deployed)

**A "skill"** is a mentorship topic guide. Each skill lives in a subdirectory under `skills/` and has a `SKILL.md` file with YAML frontmatter (`name`, `description`) and markdown content. The API reads the frontmatter and returns it as structured data. The full `SKILL.md` content is **not** returned by this API; it is intended for server-side or tool use (e.g., `retrieve_resources`). The API only returns the catalog (id, name, description) for UI display and prompt injection.

---

## Use Case

**Primary consumer**: The [Curastem](https://curastem.org) mentorship component (`web.tsx`), a Framer code component that embeds an AI-powered mentorship chat.

**Flow**:

1. User types `/` in the chat input → component fetches `GET {skillsApiUrl}` (this API)
2. API returns `[{ id: "create-a-resume", name: "Create a resume", description: "..." }, ...]`
3. Component shows a searchable menu of skills
4. User selects one or more skills (e.g., "Create a resume", "Find scholarships")
5. On send, the component prepends `[Skill: Create a resume - ...]\n\n` to the user message
6. The AI model (Gemini) receives this context and applies the corresponding mentorship workflow (documented in each skill's `SKILL.md`)

**Why a separate API?** The Curastem component runs entirely in the browser. GitHub's API has rate limits and CORS restrictions. This Worker proxies the catalog, caches on the edge, and enforces origin allowlisting so only trusted domains (e.g., curastem.org, Framer preview URLs) can access it. No API key is exposed in the client.

---

## API Contract

### Endpoint

```
GET {BASE_URL}
```

Example: `GET https://agent-skills-api.logangarcia102.workers.dev`

- **Method**: `GET` only. `POST`, `PUT`, `DELETE` return `405 Method Not Allowed`.
- **Headers**: Standard CORS. `Origin` or `Referer` must match `ALLOWED_ORIGINS` or request returns `401 Unauthorized`.
- **Query params**: None. The API returns the full catalog.

### Response (200 OK)

```json
[
  {
    "id": "create-a-resume",
    "name": "Create a resume",
    "description": "Write and format resumes in the doc editor. Use when asked about \"resume\", \"CV\", \"curriculum vitae\", \"job application\", or \"resume help\".",
    "path": "skills/create-a-resume"
  },
  {
    "id": "find-scholarships",
    "name": "Find scholarships",
    "description": "Search scholarships, draft essays, and track deadlines. Use when asked about \"scholarships\", \"financial aid\", \"free money\", \"grants\", or \"pay for college\".",
    "path": "skills/find-scholarships"
  }
]
```

**Fields**:

| Field        | Type   | Description                                                                 |
|--------------|--------|-----------------------------------------------------------------------------|
| `id`         | string | Slug from directory name (e.g., `create-a-resume`). Used as stable identifier. |
| `name`       | string | Human-readable name from `SKILL.md` frontmatter `name`, or derived from `id`. |
| `description`| string | From `SKILL.md` frontmatter `description`. Empty string if missing.         |
| `path`       | string | Repo path to the skill directory (e.g., `skills/create-a-resume`).         |

### Error Responses

| Status | Condition |
|--------|-----------|
| `401 Unauthorized` | `Origin` / `Referer` not in `ALLOWED_ORIGINS` |
| `405 Method Not Allowed` | Non-`GET` request |
| `500 Internal Server Error` | GitHub API failure, invalid `SKILLS_REPO`, or parsing error |

Error body: `{ "error": "string message" }`

---

## Skill Directory Structure

The API expects a GitHub repo with this structure:

```
{repo}/
  skills/
    create-a-resume/
      SKILL.md
    find-scholarships/
      SKILL.md
    apply-for-fafsa/
      SKILL.md
    ...
```

**SKILL.md format** (YAML frontmatter + markdown body):

```markdown
---
name: Create a resume
description: Write and format resumes in the doc editor. Use when asked about "resume", "CV", "curriculum vitae", "job application", or "resume help".
metadata:
  author: curastem
  version: "1.0.0"
---

# Create a Resume

... full mentorship workflow content ...
```

The API reads **only** the frontmatter `name` and `description`. The markdown body is for the AI model or other tools that fetch the full file separately (e.g., via `raw.githubusercontent.com`).

---

## Configuration (Secrets)

| Secret           | Required | Description |
|------------------|----------|-------------|
| `ALLOWED_ORIGINS`| Yes      | Comma-separated list of allowed origins. Use `*` to allow all (testing only). Supports wildcards: `*.framer.website`, `*.framer.app`. |
| `GITHUB_TOKEN`   | No       | GitHub token for higher rate limits. No scopes needed for public repos. Recommended for production. |
| `SKILLS_REPO`    | No       | Override default repo. Format: `owner/repo`. Default: `loganngarcia/curastem`. |

---

## Deployment

1. **Log in**: `npx wrangler login`
2. **Deploy**: `npm run deploy`
3. **Set `ALLOWED_ORIGINS`** (required):
   ```bash
   # Allow all (testing only)
   echo "*" | npx wrangler secret put ALLOWED_ORIGINS

   # Production: list your domains
   echo "https://curastem.org,https://www.curastem.org,*.framer.website,*.framer.app,*.framercanvas.com,http://localhost:3000,https://localhost:3000" | npx wrangler secret put ALLOWED_ORIGINS
   ```
4. **Set `GITHUB_TOKEN`** (optional, recommended): [Create token](https://github.com/settings/tokens) (no scopes), then:
   ```bash
   echo "ghp_xxx" | npx wrangler secret put GITHUB_TOKEN
   ```
5. **Set `SKILLS_REPO`** (optional): To use a different repo:
   ```bash
   echo "owner/repo" | npx wrangler secret put SKILLS_REPO
   ```
6. **Configure Curastem**: Set the component's `skillsApiUrl` prop to your Worker URL (e.g., `https://your-worker.your-subdomain.workers.dev`).

---

## Integration with Curastem (web.tsx)

The Curastem component uses this API as follows:

1. **Property**: `skillsApiUrl` — Framer property control. Default: `https://agent-skills-api.logangarcia102.workers.dev`
2. **Trigger**: When the user types `/` in the chat input, the component fetches `GET {skillsApiUrl}` (if not already cached in `localStorage` under `curastem_skills_cache`).
3. **Mapping**: Response `{ id, name, description }` is mapped to `AgentSkill` with `object: "skill"` and placeholder version fields.
4. **Selection**: User selects skills from the menu. Selected skills are stored in `selectedSkills` state.
5. **Injection**: On send, if `selectedSkills.length > 0`, the component prepends to the message:
   ```
   [Skill: {name}{description ? ` - ${description}` : ""}]
   ...
   {user message}
   ```
6. **Caching**: Successful responses are cached in `localStorage` keyed by `apiUrl` to avoid repeated fetches.

---

## Security

- **Origin check**: Only requests with `Origin` or `Referer` matching `ALLOWED_ORIGINS` receive data. Others get `401`.
- **No client secret**: No API key is sent from the browser. The Worker uses server-side secrets only.
- **CORS**: Responses include `Access-Control-Allow-Origin` for allowed origins.

---

## Cost

Cloudflare Workers free tier: 100,000 requests/day. Sufficient for typical Curastem deployments.
