/**
 * Agent Skills API - Cloudflare Worker (private)
 * Fetches skills from GitHub. Default: loganngarcia/curastem. Set SKILLS_REPO secret for "owner/repo" to override.
 * Only allows requests from origins in ALLOWED_ORIGINS secret (comma-separated).
 * No key in client = nothing exposed.
 */

const DEFAULT_REPO = "loganngarcia/curastem";
const FALLBACK_REPO = "vercel-labs/agent-skills";

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

interface Env {
  ALLOWED_ORIGINS: string;
  GITHUB_TOKEN?: string;
  SKILLS_REPO?: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  path: string;
}

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    let origin = request.headers.get("Origin") || "";
    if (!origin) {
      const ref = request.headers.get("Referer");
      if (ref) try { origin = new URL(ref).origin; } catch { /* ignore */ }
    }
    const allowedRaw = (env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
    const allowAll = allowedRaw.some((a) => a === "*");
    const allowed = allowedRaw.filter((a) => a !== "*").map((o) => o.toLowerCase());

    function originAllowed(o: string): boolean {
      if (!o) return false;
      const oLower = o.toLowerCase();
      for (const a of allowed) {
        const base = a.replace(/\/$/, "");
        if (oLower === base || oLower.startsWith(base + "/")) return true;
        // Wildcard: *.framer.website matches https://xxx.framer.website
        if (base.startsWith("*.")) {
          const suffix = base.slice(1); // .framer.website
          try {
            const host = new URL(o).hostname;
            if (host.endsWith(suffix) || host === suffix.slice(1)) return true;
          } catch {
            /* ignore */
          }
        }
      }
      return false;
    }

    const originMatch = allowAll || (origin && originAllowed(origin));

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(originMatch ? origin : null) });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    if (!originMatch) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders(null), "Content-Type": "application/json" },
      });
    }

    try {
      const repo = (env.SKILLS_REPO || DEFAULT_REPO).trim();
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) throw new Error("Invalid SKILLS_REPO format; use owner/repo");
      let GITHUB_API = `https://api.github.com/repos/${owner}/${repoName}/contents/skills`;
      let RAW_BASE = `https://raw.githubusercontent.com/${owner}/${repoName}/main/skills`;

      const ghHeaders: Record<string, string> = {
        "User-Agent": "agent-skills-api/1.0",
        Accept: "application/vnd.github.v3+json",
      };
      if (env.GITHUB_TOKEN) {
        ghHeaders["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
      }
      let res = await fetch(GITHUB_API, { headers: ghHeaders });
      if (!res.ok && res.status === 404 && repo === DEFAULT_REPO) {
        const [fbOwner, fbRepo] = FALLBACK_REPO.split("/");
        GITHUB_API = `https://api.github.com/repos/${fbOwner}/${fbRepo}/contents/skills`;
        RAW_BASE = `https://raw.githubusercontent.com/${fbOwner}/${fbRepo}/main/skills`;
        res = await fetch(GITHUB_API, { headers: ghHeaders });
      }
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const items = (await res.json()) as Array<{ name: string; path: string; type: string }>;

      const dirs = items.filter((i) => i.type === "dir" && !i.name.endsWith(".zip"));
      const skills: Skill[] = await Promise.all(
        dirs.map(async (d) => {
          const url = `${RAW_BASE}/${d.name}/SKILL.md`;
          const skRes = await fetch(url, { headers: ghHeaders });
          let name = d.name.replace(/-/g, " ");
          let description = "";
          if (skRes.ok) {
            const md = await skRes.text();
            const fm = parseFrontmatter(md);
            if (fm.name) name = fm.name;
            if (fm.description) description = fm.description;
          }
          return {
            id: d.name,
            name,
            description,
            path: d.path,
          };
        })
      );

      return new Response(JSON.stringify(skills), {
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
  },
};
