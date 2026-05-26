# MCP External Client — Consume the Public MCP Ecosystem

> "MCP is one-way only — we publish 3 internal servers, consume few of the
> 10,000+ public ones. Closes P0 #4." — Founder, 18BB gap analysis.

Status: SPEC — Wave 18BB-MCP-EXT.
Owner: `packages/agent-platform/src/mcp-external-client/`.
Closes: P0 #4 from the 18BB founder gap analysis.

---

## 1. Problem — we publish but don't consume

Borjie ships three internal MCP servers today:

- `services/mcp-server-tra` — Tanzania Revenue Authority tools.
- `services/mcp-server-tumemadini` — Tumemadini commerce tools.
- `services/mcp-server-process-intel` — process-mining (pm4py) tools.

Each is a **server**: it wraps a Zod-validated tool registry inside the
`@modelcontextprotocol/sdk`'s `Server` class and exposes those tools over
stdio to MCP-aware clients (Claude Desktop, our own api-gateway). The
direction of value flow is **outward**: Borjie publishes capabilities to
the wider MCP ecosystem.

That is half the story. The Model Context Protocol ecosystem now counts
**10,000+ public servers** — Slack, GitHub, Notion, Google Drive,
Postgres, Stripe, Linear, Cloudflare, the sequential-thinking helper,
puppeteer for browser automation, and on. Every one of those servers is
a tool registry the Borjie kernel could call. Today the kernel can
publish to the ecosystem but cannot *consume from it*. The kernel's tool
registry is closed: only tools we author locally are dispatchable.

This spec describes the **MCP external client** — the inverse arrow.
The client connects to public MCP servers, lists their tools, surfaces
those tools to the kernel tool registry as first-class entries, and
dispatches kernel tool calls into the remote server. The result: every
public MCP server in the ecosystem becomes a Borjie capability the
moment the founder hands us an OAuth token.

This is a P0 closer. Without it, Borjie's "consume anything" promise
(Wave 18Q compose_anything_v1) is a one-sided publication channel, not
a marketplace. With it, Borjie becomes the first AI-native operations
platform that treats the public MCP ecosystem as its execution graph.

---

## 2. MCP client architecture — connect / list / invoke / dispatch

The client lives at `packages/agent-platform/src/mcp-external-client/`.
It is a thin layer over `@modelcontextprotocol/sdk/client` with four
responsibilities:

1. **Connect** — open a transport to a remote MCP server. Transports
   supported: stdio (local subprocess), SSE (legacy remote streaming),
   and streamable HTTP (modern MCP remote). The choice is per-server
   and recorded in the catalog.
2. **List** — call `tools/list` on the server and cache the result as
   an `McpToolDescriptor[]` for the lifetime of the connection.
3. **Invoke** — call `tools/call` with a kernel tool invocation,
   translating the kernel's invocation shape to MCP's `CallToolRequest`
   and translating the MCP response back to the kernel result shape.
4. **Dispatch** — register each discovered tool with the kernel's tool
   registry under a namespaced name (`mcp:slack:send_message`) so the
   junior runtime can call it like any local tool.

The control surface is the `McpExternalClient` class. It owns a map of
`McpServerHandle` instances keyed by `(tenantId, serverId)`. Each
handle wraps one live `Client` from the SDK, its transport, the last
listed tool catalog, and an auth context. The `tool-dispatcher`
translates kernel calls into MCP calls; the `result-mapper` normalises
MCP responses (text content, structured content, errors) into the
kernel's canonical result envelope so downstream code never has to know
the call came from a remote MCP server.

**Lifecycle**: connect → list → invoke (N times) → close. Lists are
refreshed on `notifications/tools/list_changed`. Connections are
tenant-scoped; the client tracks failures (consecutive timeouts,
auth-rotation needed) and surfaces them through the audit chain so the
resilience manager can attempt revival (Wave 18DD).

---

## 3. Catalog of public MCP servers (Wave 1 — 12 entries)

The catalog is a static `public-servers.ts` registry — versioned
metadata about each server we know how to consume. It is not the list
of *active* connections (that lives in the database, see §4); it is the
*known-good* list the founder can pick from when wiring a tenant.

Each entry records: `id`, `displayName`, `transport`, `command` / `url`,
`auth` mode (`none`, `api_key`, `oauth_token`, `oauth_pkce`), required
scopes, the OAuth provider, and a one-line "what this unlocks" copy
suitable for the Borjie admin UI. The catalog is the single source of
truth for "which public MCP servers can a tenant connect today?".

### 3.1 Wave 1 catalog (12 entries)

| ID | Package | What it unlocks |
|----|---------|-----------------|
| `slack` | `@modelcontextprotocol/server-slack` | Read/write Slack channels + DMs; close the loop with mining-ops chat. |
| `github` | `@modelcontextprotocol/server-github` | Repo/PR/issue read+write; lets juniors file follow-ups against the Borjie repo. |
| `google-drive` | `@modelcontextprotocol/server-google-drive` | Read/write GDrive files; mining licences + contracts live there. |
| `postgres` | `@modelcontextprotocol/server-postgres` | Direct SQL to *external* Postgres clusters (customer warehouses). Read-only. |
| `filesystem` | `@modelcontextprotocol/server-filesystem` | Sandboxed local-filesystem read/write — sidecar use only, never on prod. |
| `puppeteer` | `@modelcontextprotocol/server-puppeteer` | Headless browser automation — fills the gap when no API exists. |
| `memory` | `@modelcontextprotocol/server-memory` | KV scratchpad shared between MCP turns; complements our persistent-memory tier. |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | Anthropic's chain-of-thought helper; useful for the cognitive engine. |
| `notion` | `@notionhq/notion-mcp-server` | Read/write Notion pages + databases; doc-composition (Wave 18-DOC) target. |
| `cloudflare` | `@cloudflare/mcp-server` | Cloudflare R2 + Workers + DNS; infra-junior reaches over here. |
| `stripe` | `stripe-mcp-server` | Stripe API read+write; treasury-junior reconciles via this. |
| `linear` | `linear-mcp-server` | Linear issues + cycles; mining ops occasionally tracks blockers there. |

The catalog ships disabled by default. Each tenant opts in per server by
inserting an `mcp_external_connections` row with their OAuth token; the
catalog tells the auth/oauth-token-manager which OAuth flow to run.

Future entries (Wave 2+, not in this spec): AWS, Azure, GCP, Sentry,
PagerDuty, Datadog, Snowflake, BigQuery, Salesforce, Zendesk, Intercom,
HubSpot, Twilio, SendGrid, Brave Search, Tavily, Perplexity.

---

## 4. Auth flow — OAuth tokens stored per-tenant

Three auth modes, picked per catalog entry.

1. **`none`** — local stdio servers (`filesystem`, `puppeteer`,
   `sequential-thinking`, `memory`). The transport is a subprocess; no
   credentials. We still apply the mutation-authority tier check on
   every call.

2. **`api_key`** — single static secret (`postgres` connection string,
   some self-hosted Notion deploys). The secret lives in
   `mcp_external_connections.encrypted_credentials` (AES-GCM,
   tenant-bound DEK from the existing KMS path). Rotation is manual
   today; Wave 18BB+1 wires an automated rotation job.

3. **`oauth_token` / `oauth_pkce`** — the bulk of useful servers
   (Slack, GitHub, GDrive, Notion, Linear, Stripe, Cloudflare). The
   `oauth-token-manager` handles:
   - the initial PKCE flow via the existing api-gateway OAuth router,
   - storage of `(access_token, refresh_token, expires_at, scopes)`
     under a tenant-bound DEK,
   - automatic refresh before expiry (5-minute safety margin),
   - revocation on connection-deletion.

The token manager exposes one method to the client:
`getCredentialsForInvocation(tenantId, serverId) → Credentials`. The
client never sees plaintext tokens outside the request boundary; the
audit chain records the `connection_id`, not the token.

Tenant isolation: every connection row carries `tenant_id`, every
invocation row carries `tenant_id`, every RLS policy enforces
`tenant_id = current_tenant_id()`. There is no cross-tenant token
access path.

---

## 5. Tool registry — external tools as first-class entries

When the client connects to a server and lists its tools, each tool
becomes a `KernelToolEntry` with:

- `name` — namespaced as `mcp:<serverId>:<toolName>` (e.g.
  `mcp:slack:send_message`). This namespace is reserved; local tools
  cannot use the `mcp:` prefix.
- `description` — copied verbatim from the MCP server.
- `inputSchema` — the JSON Schema returned by `tools/list`. The kernel
  re-validates with Ajv before dispatching (defence in depth — never
  trust a remote schema blindly).
- `execute` — a closure that calls
  `mcpClient.invokeTool(serverId, toolName, input)`. The closure also
  emits the audit-chain link and runs the mutation-authority tier check
  *before* the remote call leaves the box.

The result: a junior calling `mcp:slack:send_message` looks identical
to a junior calling a local tool. The kernel's `Plan → DAG → Worker
Runner` (planning subsystem) does not care that the tool happens to
live on the other end of a stdio pipe.

---

## 6. Security — audit-chained, tier-checked, RLS-isolated

Every external MCP tool call must satisfy three invariants:

1. **Audit-chained**. Every invocation appends a row to
   `mcp_tool_invocations` *and* a link to the `ai_audit_chain` (the
   existing tamper-evident hash chain from Wave 11). The link records
   `(tenant_id, connection_id, tool_name, input_hash, output_hash,
   started_at, finished_at, outcome)`. A single mutation breaks the
   chain on verify().

2. **Tier-checked via mutation-authority** (Wave 18S). Before the
   remote call, the dispatcher invokes
   `mutationAuthority.assertAllowed({ tier, tool, scope })`. Tier 0 =
   read-only, tier 1 = side-effect, tier 2 = irreversible. Every
   catalog entry declares its maximum tier; Slack `send_message` is
   tier 1, GitHub `delete_repo` would be tier 2 (and is therefore
   omitted from the Wave 1 allowlist).

3. **RLS-isolated**. Both `mcp_external_connections` and
   `mcp_tool_invocations` carry `tenant_id` and enforce
   `tenant_id = current_tenant_id()` row-level security. Cross-tenant
   leakage requires bypassing Postgres RLS — the same threat model as
   the rest of the platform.

Defence in depth: schema re-validation (§5), tier check (this
section), RLS (this section), audit chain (this section), per-server
rate-limit (carried in the catalog entry), and SSRF protection on the
HTTP transport (re-uses the existing webhook-delivery SSRF guard).

---

## 7. Anti-patterns — things this spec deliberately rejects

- **Do not** auto-discover MCP servers. Every server must be in the
  static catalog. We never connect to a server the founder hasn't
  vetted.
- **Do not** cache OAuth tokens in process memory longer than 60s. The
  token manager fetches on demand from the encrypted store.
- **Do not** mutate the kernel tool registry directly from the client.
  Use the registry's `registerExternalTools(connectionId, descriptors)`
  API so additions are atomic and traceable.
- **Do not** treat remote MCP errors as recoverable without an audit
  trail. Every error appends to the invocation log with the error
  text, then bubbles up.
- **Do not** mix internal MCP server code with external client code.
  Internal servers (`services/mcp-server-*`) publish *outward*; the
  external client consumes *inward*. They share the SDK but not the
  process or the deployment.
- **Do not** allow a junior to bypass the dispatcher and call the SDK
  directly. The dispatcher is the only entry point — that is where the
  tier check, audit link, and result mapper live.

---

## 8. Phase 2 integration with compose_anything_v1 (Wave 18Q)

Wave 18Q (`compose_anything_v1`) is the kernel's "synthesise a tool
chain from natural language" capability. Today it composes over local
tools only. Phase 2 of the MCP external client wires the catalog into
the compose surface:

- The catalog metadata (`displayName`, "what this unlocks") becomes
  retrieval fodder for the composer's tool-selection LLM.
- Each catalog entry advertises its tier so the composer can rule out
  tier-2 servers in deny-by-default contexts.
- The compose audit trail (Wave 18Q-AUDIT) gains an `mcp:` prefix
  whenever an external tool joins a composed chain — the founder will
  see "this plan reached into Slack" in the chain ledger.

Phase 2 also adds the `mcp:_meta:health` synthetic tool — a per-server
liveness probe the cognitive engine can call before composing a chain
that depends on a remote server. If the probe fails, the composer
substitutes a local degraded path.

Phase 3 (post-18BB) adds **outbound writes through the registry**: any
junior that wants to publish a *new* external connection (e.g. "I need
to write to a Notion page; please connect Notion") files a request the
founder approves via the admin surface. Until then, the catalog is
read-only from inside the kernel.

---

## 9. Out of scope (explicit)

- Inbound MCP requests from public servers — out of scope (we already
  publish internal servers for that).
- Connection pooling across MCP processes — out of scope; one process
  per server per tenant for Wave 1.
- Streaming responses from the remote server (MCP supports it) — out
  of scope; Wave 1 collects the full response then maps it.
- Anonymous / unauthenticated tenants — out of scope; every
  invocation must carry a tenant context.

---

## 10. Acceptance criteria (Wave 18BB-MCP-EXT)

- [x] Spec lives at `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md`.
- [x] Catalog enumerates ≥10 public MCP servers (12 in §3).
- [x] Package scaffold lives at
      `packages/agent-platform/src/mcp-external-client/`.
- [x] Strict TypeScript flags ON, no `@ts-nocheck`.
- [x] Migration adds 2 RLS-scoped tables: `mcp_external_connections`
      and `mcp_tool_invocations`.
- [x] Every external tool call is audit-chained, tier-checked, and
      RLS-isolated (§6).
- [x] Coverage ≤70% acceptable for Wave 1 (scaffold + catalog + auth
      flow + dispatcher + result mapper unit tests).
