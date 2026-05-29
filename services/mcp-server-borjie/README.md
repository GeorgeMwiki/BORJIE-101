# @borjie/mcp-server-borjie

Public-facing **Model Context Protocol (MCP)** server for Borjie — the
mining estate planning, management, and intelligence OS for Tanzanian
and pan-African artisanal-to-mid-tier mining.

Lets any MCP-aware client (Claude Code, Cursor, Windsurf, custom agents,
your in-house tooling) discover, authenticate, and operate Mr. Mwikila's
brain tools end-to-end. Tenant-isolated by Postgres RLS, scope-narrowed
by OAuth, hash-chain audited on every call.

## Why this exists

External LLM agents need a stable, documented, scope-gated way into the
Borjie brain. This server is that contract: a strict subset of MCP
2024-11-05 over stdio (local subprocess) or HTTP/JSON-RPC (remote
endpoint at `https://api.borjie.app/mcp`).

## Install

```bash
# Run on-the-fly (recommended for Claude Code / Cursor)
npx -y @borjie/mcp-server-borjie

# Or install globally
npm install -g @borjie/mcp-server-borjie
borjie-mcp-server
```

## Wire it into Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "borjie": {
      "command": "npx",
      "args": ["-y", "@borjie/mcp-server-borjie"],
      "env": {
        "BORJIE_API_BASE_URL": "https://api.borjie.app",
        "BORJIE_MCP_TOKEN": "<your access token from `borjie login`>"
      }
    }
  }
}
```

For Cursor or Windsurf — same envelope, different config path.

## Authentication

Two modes:

1. **OAuth2 device flow (recommended).** Run `borjie login` from the
   `@borjie/cli` package to fetch a scoped access token written to
   `~/.config/borjie/credentials.json`. The MCP server reads it from
   the `BORJIE_MCP_TOKEN` env var.
2. **Bypass token for local development.** Set `BORJIE_MCP_TOKEN` to a
   dev token issued from the Borjie owner-web admin panel.

## Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `BORJIE_API_BASE_URL` | `https://api.borjie.co.tz` | Gateway base URL |
| `BORJIE_MCP_TOKEN` | _(empty)_ | Bearer access token |
| `BORJIE_MCP_AGENT_NAME` | `unknown-agent` | Audit attribution string |

## Tool surface

29 tools across the Borjie brain catalog:

- `mining_drafts_*` — compose, list, view, lock free-form drafts
- `mining_media_generate` — generate charts / images / infographics
- `mining_opportunities_scan` / `mining_risks_scan` — strategic scans
- `mining_calibration_status` — over- / under-confidence per persona
- `decisions_list` / `decisions_create` — decision journal
- `entity_index_summary` / `scope_nodes_*` — estate structure
- `md_daily_brief` — Mr. Mwikila's daily brief
- `mining_marketplace_listings` — buyer-facing offers
- `mining_workforce_list` — active workers + certifications
- `mining_geology_samples` / `mining_production_today` — production data
- `mining_cooperatives_list` / `mining_insurance_policies`
- `owner_messaging_threads` / `compliance_status`
- `estate_net_worth` / `estate_share_link_create`
- `reminders_list` / `reminders_create` / `mining_ui_tabs_*`
- `owner_undo_last` — undo last action within window

Call `tools/list` for the full schema (bilingual sw/en descriptions).

## Resources

Read-only side-data exposed via `resources/list`:

- `borjie://capabilities` — capability manifest
- `borjie://estate/entities` — repomap-equivalent
- `borjie://decisions/recent` — last 50 decisions
- `borjie://calibration/current` — calibration posture
- `borjie://corpus/mining/index` — mining corpus index
- `borjie://compliance/posture` — PCCB / PDPA / FAR posture
- `borjie://memory/advisor` — advisor memory snapshot

## Scopes

Six scopes; owner can grant any of the first five via the device-flow
consent screen. `admin:read` is Borjie-internal only.

| Scope | Allows |
| --- | --- |
| `owner:read` | Read estate snapshot |
| `owner:write` | Create / update / delete entities, run scans |
| `owner:draft` | Compose, edit, lock drafts |
| `owner:reminders` | Manage reminders + cockpit tabs |
| `owner:share` | Generate time-boxed share links |
| `admin:read` | Borjie-internal cross-tenant reads |

## Security posture

- Every call hits api-gateway with `Authorization: Bearer <token>` plus
  `X-Borjie-MCP-Tool` and `X-Borjie-Agent-Token-Id` headers.
- Gateway binds `app.current_tenant_id` GUC before any downstream
  database call — RLS enforces tenant isolation.
- Hash-chain audit on every tool invocation via the gateway's
  `audit-trail` service. Provenance returned in the response.
- Kill-switch fail-closed — when open, every JSON-RPC call returns
  error `-32003`.
- No `console.log` — all server output flows through Pino-shaped
  stderr.

## Integration snippets

Drop into the right config file for each client. Replace
`<your access token>` with the bearer Borjie hands you after
`borjie login` (see `@borjie/cli`).

### Claude Code

`~/.config/claude-code/claude_mcp_settings.json`:

```json
{
  "mcpServers": {
    "borjie": {
      "command": "npx",
      "args": ["-y", "@borjie/mcp-server-borjie"],
      "env": {
        "BORJIE_API_BASE_URL": "https://api.borjie.app",
        "BORJIE_MCP_TOKEN": "<your access token>",
        "BORJIE_MCP_AGENT_NAME": "claude-code"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "borjie": {
      "command": "npx",
      "args": ["-y", "@borjie/mcp-server-borjie"],
      "env": {
        "BORJIE_API_BASE_URL": "https://api.borjie.app",
        "BORJIE_MCP_TOKEN": "<your access token>",
        "BORJIE_MCP_AGENT_NAME": "cursor"
      }
    }
  }
}
```

### Windsurf

`~/.windsurf/mcp_servers.json`:

```json
{
  "mcpServers": {
    "borjie": {
      "command": "npx",
      "args": ["-y", "@borjie/mcp-server-borjie"],
      "env": {
        "BORJIE_API_BASE_URL": "https://api.borjie.app",
        "BORJIE_MCP_TOKEN": "<your access token>",
        "BORJIE_MCP_AGENT_NAME": "windsurf"
      }
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "borjie": {
      "command": "npx",
      "args": ["-y", "@borjie/mcp-server-borjie"],
      "env": {
        "BORJIE_API_BASE_URL": "https://api.borjie.app",
        "BORJIE_MCP_TOKEN": "<your access token>",
        "BORJIE_MCP_AGENT_NAME": "claude-desktop"
      }
    }
  }
}
```

### Continue.dev

`~/.continue/config.json` (under `experimental.modelContextProtocolServer`):

```json
{
  "experimental": {
    "modelContextProtocolServer": {
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@borjie/mcp-server-borjie"]
      }
    }
  }
}
```

Set `BORJIE_API_BASE_URL` and `BORJIE_MCP_TOKEN` in your shell.

### Plain `mcp-cli` (smoke test)

```bash
BORJIE_API_BASE_URL=https://api.borjie.app \
BORJIE_MCP_TOKEN=<your access token> \
npx -y @anthropic-ai/mcp-cli --command 'npx -y @borjie/mcp-server-borjie' tools/list
```

### HTTP transport (no stdio subprocess)

```bash
curl -sS -X POST https://api.borjie.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your access token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### SSE transport (long-lived stream)

```bash
curl -sS -N https://api.borjie.app/mcp/sse \
  -H "Authorization: Bearer <your access token>"
```

## SOTA primitives

This server ships **all 12** MCP 2024-11-05 primitives plus four
computer-use-style semantic actions:

| # | Primitive | Implementation |
| - | --- | --- |
| 1 | SSE transport | `transports/sse.ts` + api-gateway `mcp-public.hono.ts` |
| 2 | sampling/createMessage | `sampling.ts` |
| 3 | roots/list + roots/list_changed | `roots.ts` |
| 4 | logging/setLevel + logging/message | `logging.ts` |
| 5 | $/progress notifications | `progress.ts` |
| 6 | resources/subscribe + resources/updated | `subscriptions.ts` |
| 7 | $/result_partial streaming | `progress.ts` |
| 8 | session checkpoint/resume | `sessions.ts` + migration 0120 |
| 9 | computer-use actions (navigate/prefill/share/undo) | `actions.ts` |
| 10 | per-scope rate limit (-32099) | `rate-limit.ts` |
| 11 | four-eye approval (-32011) for sovereign tools | `four-eye.ts` + migration 0121 |
| 12 | discovery filters + workspace mirror | dispatcher + `workspace.ts` |

## Development

```bash
pnpm --filter @borjie/mcp-server-borjie typecheck
pnpm --filter @borjie/mcp-server-borjie test
pnpm --filter @borjie/mcp-server-borjie build
```

## Smoke test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  | node dist/cli.js
```

Should emit one JSON-RPC response with `protocolVersion: 2024-11-05`.

## License

MIT.
