# AI OS MCP Server

Exposes Felix's AI OS (synced in Notion) as MCP tools, so any MCP-compatible AI client can query it directly instead of scraping a public link.

**Honest limitation:** this was written without the ability to actually `npm install` or compile-test it (no network access in the environment it was built in). The code follows the current MCP TypeScript SDK and Notion client API shapes correctly as far as known, but **run the build step yourself and check for errors before trusting it** — don't assume it's flawless just because it was written carefully.

## Tools It Exposes
- `search_vault(query)` — keyword search across the whole AI OS
- `get_page(page_name)` — full content of one named page
- `list_projects()` — the 10_Projects index page's current contents
- `get_project_status(project_name)` — one project's current status specifically

## Setup

### 1. Create a Notion integration
Go to [notion.so/my-integrations](https://notion.so/my-integrations) → New integration → name it (e.g. "AI OS MCP") → copy the "Internal Integration Secret" (starts with `secret_` or `ntn_`).

### 2. Share the AI OS with it
Open the **AI OS** root page in Notion → `...` menu → Connections → add the integration you just created. This is separate from "Share to web" — it's what actually lets the integration's API calls see the pages.

### 3. Set the API key
```
cp .env.example .env
# paste your key into .env
```

### 4. Build and run with Docker
```
docker compose build
docker compose run --rm ai-os-mcp
```
This runs the server over stdio — it's meant to be launched by an MCP client (Claude Desktop, etc.), not left running standalone in a terminal long-term.

### 5. Point an MCP client at it
For Claude Desktop, add to its MCP config (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ai-os": {
      "command": "docker",
      "args": ["compose", "-f", "/full/path/to/ai-os-mcp/docker-compose.yml", "run", "--rm", "ai-os-mcp"]
    }
  }
}
```

## Things Worth Checking Before Trusting It
- Does `npm install` succeed cleanly, or are there version mismatches with the SDK?
- Does `npm run build` compile without errors?
- Does `search_vault` actually return results — this depends on the integration having been shared with the right pages (step 2).
- Table content in `get_page` may render roughly — Notion's block API is nested and this pulls table rows one level deep, not deeply verified.

## What This Doesn't Do
No writing/editing — read-only by design, so it can't accidentally modify the vault. No automation trigger — still has to be invoked by an MCP client on request, consistent with the AI OS's "manual, chat-triggered" execution decision.
