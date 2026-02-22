# Agent Skills API

Cloudflare Worker that returns agent skills from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills). **Origin-restricted** — only requests from your allowed domains are accepted. No key in client code.

## Deploy

1. **Log in**: `npx wrangler login`
2. **Deploy**: `npm run deploy`
3. **Set allowed origins** (comma-separated). Use `*` to allow all, or list specific origins. Supports wildcards: `*.framer.website`, `*.framer.app`.
   ```bash
   # Allow all (for testing)
   echo "*" | npx wrangler secret put ALLOWED_ORIGINS

   # Or restrict to your domains (includes Framer canvas + dev):
   echo "https://curastem.framer.ai,*.framercanvas.com,*.framer.website,*.framer.app,https://curastem.org,https://www.curastem.org,http://localhost:3000,https://localhost:3000" | npx wrangler secret put ALLOWED_ORIGINS
   ```
4. **Fix GitHub 403** (optional but recommended): Create a [GitHub token](https://github.com/settings/tokens) (no scopes needed for public repos), then:
   ```bash
   echo "ghp_xxx" | npx wrangler secret put GITHUB_TOKEN
   ```
5. **Add Worker URL** to Curastem's Skills API URL prop.

## Security

- Only requests with `Origin` or `Referer` matching `ALLOWED_ORIGINS` get data
- No API key in the browser — nothing to extract
- Add your Framer preview + published domains to the secret

## Cost

Free tier: 100,000 requests/day.
