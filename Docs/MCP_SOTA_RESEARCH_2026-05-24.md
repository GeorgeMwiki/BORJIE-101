# MCP (Model Context Protocol) — SOTA Research Notes (2026-05-24)

Compiled to anchor the design of `packages/mcp` — a deep, framework-quality MCP
package that complements (does not duplicate) the consumer-side `agent-runtime/src/mcp/`
work in P56 and the in-product `packages/mcp-server` deployment surface.

The goal is a vendor-grade implementation of the protocol primitives: full wire
types, three transports, server-hosting framework, client, tool/resource
discovery, OAuth-PKCE auth, and five pre-shipped tenant-scoped domain servers
that snap into our existing infrastructure.

---

## 1. Spec status (as of mid-2026)

- The Model Context Protocol was open-sourced by Anthropic in late 2024 as a
  JSON-RPC 2.0 messaging contract for LLM clients to talk to "context servers"
  exposing tools, resources, prompts, and (optionally) server-initiated LLM
  sampling.
- The latest spec revision baseline used here is **2026-04** (the
  `protocolVersion` string follows the date-keyed format introduced with
  `2024-11-05` and incremented at `2025-03-26`, `2025-09-01`, then 2026-04).
- The spec is hosted at <https://spec.modelcontextprotocol.io/> with the
  reference implementations and SDKs under
  <https://github.com/modelcontextprotocol/>.

### Capability negotiation (the `initialize` handshake)

```
client → server: initialize { protocolVersion, clientInfo, capabilities }
server → client: { protocolVersion, serverInfo, capabilities }
client → server: notifications/initialized
```

`capabilities` is a structured map. The fields the reference SDK exposes at
2026-04 include:

- `tools` — server can list/invoke tools (`{ listChanged?: boolean }`)
- `resources` — server can list/read resources (`{ subscribe?: boolean,
  listChanged?: boolean }`)
- `prompts` — server can list/render prompts (`{ listChanged?: boolean }`)
- `logging` — server emits log notifications (`{ }`)
- `sampling` — server may **request** the client run an LLM call (rare)
- `experimental` — escape hatch for non-stable features

Mismatch must downgrade gracefully: the client picks the highest mutually
supported `protocolVersion` and ignores capabilities the other side didn't
declare.

---

## 2. Transports

The spec defines transports as a serialization-agnostic envelope over JSON-RPC
2.0 frames. Three are blessed at 2026-04:

### 2a. `stdio`

- Spawn a child process; JSON-RPC messages over stdin/stdout, newline-delimited.
- Auth: environment variables passed via the child's `env`. No on-wire auth.
- Failure model: process exit terminates the connection.
- Used for: locally-installed servers (`@modelcontextprotocol/server-filesystem`,
  `server-github` running under user creds, etc.).

### 2b. SSE (legacy — being retired)

- HTTP `GET /sse` opens an event stream from server → client; client posts
  requests to `/messages` (or whatever path the server advertises).
- Two TCP connections required — awkward through CDNs/edge proxies.
- Auth: standard HTTP `Authorization` header.
- Marked **legacy** in the 2025-09-01 revision; replaced by streamable-http.

### 2c. Streamable HTTP (the 2025 replacement for SSE)

- Single bidirectional HTTP endpoint. Client POSTs a request; the response is
  either a single JSON body (request/response) or an SSE stream (when the
  server wants to push notifications mid-call).
- Sessions identified by a `Mcp-Session-Id` header issued during `initialize`.
- Stateless mode is also defined (no session id; server treats every request
  independently).
- Works cleanly through HTTP/2 multiplexing, edge proxies, and serverless
  runtimes (a Vercel/Cloudflare worker can host an MCP endpoint).
- Auth: OAuth 2.1 + PKCE (see §6) or any standard bearer scheme.

### Wire framing notes

- Every transport carries `application/json` JSON-RPC 2.0 frames. Stdio uses
  one-message-per-line; HTTP-based transports use the body / SSE `data:` field.
- IDs are integers or strings; notifications omit the `id` field.
- Batch requests (JSON-RPC arrays) are *not* mandated — the spec recommends
  treating them as optional.

---

## 3. Tool model

A tool descriptor (server → client during `tools/list`):

```json
{
  "name": "search_properties",
  "description": "Search the property registry by free text + filters.",
  "inputSchema": { "$schema": "...", "type": "object", ... },
  "annotations": {
    "title": "Search properties",
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

The four annotations let a client (or a policy engine) make decisions before
the LLM ever sees the tool result:

- **`readOnlyHint`** — does not modify any state. Always safe to auto-run.
- **`destructiveHint`** — performs destructive updates (e.g. delete, refund).
- **`idempotentHint`** — running it twice with the same args yields the same
  result. Enables auto-retry on transient failures without dupe risk.
- **`openWorldHint`** — interacts with services outside the client's control
  (web fetch, third-party API). Useful for time/budget guards.

Tool **invocation** (`tools/call`):

```
request:  { name, arguments }
response: { content: [ { type: "text", text: "..." }, ... ], isError? }
```

`content` is an array of content blocks (`text`, `image`, `resource`,
`audio`) so a single tool call can return mixed media.

---

## 4. Resources & prompts

### Resources

- `resources/list` returns `{ uri, name, mimeType, description?, annotations? }`
  entries.
- `resources/read` returns `contents: [{ uri, mimeType, text | blob }]`.
- `resources/subscribe` opens a server-side notification stream that fires
  `notifications/resources/updated` when the content changes.

### Prompts

- `prompts/list` returns `{ name, description?, arguments?: [{ name, required }] }`.
- `prompts/get` returns `{ description?, messages: [{ role, content }] }` — a
  fully-rendered chat snippet ready to splice into the conversation.

The pattern lets a server publish curated, parameterised prompt templates
(e.g. `summarise_lease_for_owner({ lease_id })`) without the client needing
to know the wording.

---

## 5. Sampling (server-initiated LLM calls)

- Server → client: `sampling/createMessage` with `messages`, `modelPreferences`,
  `systemPrompt?`, `includeContext?`, `maxTokens`.
- Client decides whether to honor it (and can prompt the user). This is the
  inverse of normal MCP — it lets a context server escalate to LLM-grade
  reasoning when its own logic isn't enough.
- Real-world use is rare because of cost + UX; we ship the type but make
  sampling opt-in at the server level.

---

## 6. Authentication

The 2026-04 revision adopts **OAuth 2.1 + PKCE** for HTTP-based transports
(Authorization Code Flow with PKCE, per RFC 7636 / OAuth-2.1 draft).

- Server publishes `.well-known/oauth-authorization-server` metadata.
- Client computes `code_verifier` (cryptographically random, 43–128 chars),
  derives `code_challenge = base64url(SHA-256(code_verifier))`.
- Standard authorization-code flow: redirect → consent → code → token exchange
  with PKCE verification.
- Tokens carried as `Authorization: Bearer <token>` on every JSON-RPC request.

Stdio transport sidesteps auth — env vars carry credentials into the child
process (e.g. `GITHUB_TOKEN`).

Service-to-service flows (back-end calling a tenant-scoped MCP endpoint) use
mTLS or signed service tokens with rotation. Our implementation provides a
generic `ServiceTokenStore` port to allow tenant-specific token rotation
without hard-coding the rotation policy.

---

## 7. Reference servers (canonical examples)

Maintained under <https://github.com/modelcontextprotocol/servers>:

| Server         | Transport | Notable tools                                       |
|----------------|-----------|-----------------------------------------------------|
| `filesystem`   | stdio     | `read_file`, `write_file`, `list_directory`, `move_file` |
| `github`       | stdio     | `search_repositories`, `create_issue`, `get_pull_request` |
| `slack`        | stdio     | `slack_post_message`, `slack_list_channels`         |
| `postgres`     | stdio     | `query`, `list_tables`, `describe_table`            |
| `puppeteer`    | stdio     | `screenshot`, `navigate`, `evaluate_js`             |
| `brave-search` | stdio     | `web_search`, `local_search`                        |
| `gdrive`       | stdio     | `gdrive_search`, `gdrive_read_file`                 |
| `linear`       | stdio     | `linear_create_issue`, `linear_search_issues`       |

The patterns we steal:

1. **Tool naming**: `<server>_<verb>_<object>` keeps namespacing readable when
   multiple servers are mounted side-by-side.
2. **Capability splits**: read-only and write-capable tools are separated so a
   policy engine can ban writes without losing introspection.
3. **Auth gates per tool**: GitHub's server rejects write tools without
   `repo` scope on the token.

---

## 8. SDKs

| SDK                                | Status         |
|------------------------------------|----------------|
| `@modelcontextprotocol/sdk` (TS)   | v1.x — official, used by Claude Desktop, Cursor, Continue, Zed |
| `mcp` (Python)                     | v1.x — official |
| `mcp-rs` (Rust)                    | community, gaining traction inside agent runtimes |
| `mcp-go` (Go)                      | community |

We do **not** depend on the official TS SDK in `packages/mcp` — it would bind
us to its session model and re-export shape, which we want to control for
tenant scoping and audit. Instead we implement the wire protocol directly so
our `MCPClient` can talk to any official server *and* our own.

---

## 9. Hosting MCP servers in a SaaS

The unique constraint we have (vs. a desktop tool like Claude Desktop) is
**multi-tenancy + audit**.

- Every tool invocation carries a `tenantId` derived from the session, never
  from tool arguments. Tools that omit it are rejected at the framework
  layer.
- Every call is appended to our existing WORM audit log
  (`packages/observability/audit/...`) so SOX / SOC-2 evidence pipelines
  pick it up automatically.
- Per-tenant rate limits and cost ceilings live in front of the framework
  (we expose a `policyHook` so the consumer can plug in their own gate).
- Token rotation is handled outside the framework — we accept a
  `ServiceTokenStore` port and call `getToken(tenantId)` on each request,
  letting the store rotate transparently.

---

## 10. Notifications, progress, and logging

JSON-RPC notifications (no `id`, no response):

- `notifications/initialized` — handshake completion.
- `notifications/progress { progressToken, progress, total? }` — long-running
  tool emits progress (client may surface a UI hint).
- `notifications/message { level, logger?, data }` — structured log events.
- `notifications/resources/list_changed` — list of resources changed; client
  should re-list.
- `notifications/resources/updated { uri }` — a specific resource changed;
  re-read if subscribed.
- `notifications/tools/list_changed` — tools added/removed.
- `notifications/prompts/list_changed` — prompts added/removed.

Our server framework exposes a `notify(...)` helper so tool handlers can
emit progress without dealing with envelope details.

---

## 11. Discovery + namespacing (the `.mcp.json` convention)

Claude Desktop established the de-facto config convention:

```jsonc
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${env:GH_TOKEN}" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/code"]
    }
  }
}
```

When two servers expose tools with the same name (e.g. `search`), the
common pattern is to namespace at the client: `github.search` vs
`filesystem.search`. Our `discovery` module formalises this with
`namespace(toolName, serverId)` + a `routeCall` dispatcher.

---

## 12. Production patterns we adopt

- **Per-call timeout** — default 30s, override per tool. Hard kill the
  underlying transport request, not just the promise.
- **Retry-on-transient** — only on `idempotentHint: true` tools; expo backoff
  with jitter.
- **Connection pooling** — for HTTP transports, one client per server, with
  request pipelining. For stdio, one process per server (lifecycle owned by
  the client).
- **Backpressure** — bounded send queue; reject new sends with a typed
  `MCPBackpressureError` once full.
- **Reconnect** — HTTP transports auto-reconnect with jitter; stdio respawn
  is opt-in (a crashed `filesystem` server is rarely the right thing to
  silently restart).
- **Capability cache** — `listTools` results cached by `protocolVersion`;
  invalidated on `notifications/tools/list_changed`.

---

## 13. Sources cited

1. Model Context Protocol homepage — <https://modelcontextprotocol.io/>
2. MCP spec repo — <https://github.com/modelcontextprotocol/specification>
3. Official TS SDK — <https://github.com/modelcontextprotocol/typescript-sdk>
4. Official Python SDK — <https://github.com/modelcontextprotocol/python-sdk>
5. Reference servers — <https://github.com/modelcontextprotocol/servers>
6. Spec changelog (`2025-03-26` revision) — <https://spec.modelcontextprotocol.io/specification/2025-03-26/changelog/>
7. Streamable-HTTP transport announcement (Sep 2025) — <https://blog.modelcontextprotocol.io/streamable-http-transport>
8. OAuth 2.1 IETF draft — <https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/>
9. RFC 7636 — PKCE — <https://datatracker.ietf.org/doc/html/rfc7636>
10. JSON-RPC 2.0 spec — <https://www.jsonrpc.org/specification>
11. Claude Desktop MCP user guide — <https://docs.anthropic.com/en/docs/claude-desktop/mcp>
12. Cursor MCP integration docs — <https://docs.cursor.com/context/model-context-protocol>
13. Zed MCP extension API — <https://zed.dev/docs/extensions/mcp-extensions>
14. Anthropic blog: "Introducing the Model Context Protocol" (Nov 2024) — <https://www.anthropic.com/news/model-context-protocol>
15. "MCP tool annotations" blog (2025) — <https://blog.modelcontextprotocol.io/tool-annotations>

---

## 14. Spec deviations / opinionated choices we make

- **No JSON-RPC batch** — too rare in practice; clients we care about don't
  emit batches.
- **Sampling default-off** — opt-in per server because the cost/latency
  surprise is huge; most tools don't need it.
- **Audit-always** — non-overridable hook. A tenant-scoped MCP server in a
  SaaS context must be auditable.
- **Tenant injection at session** — never accept `tenantId` from tool args.
- **Capability cache is opinionated** — we invalidate aggressively on any
  protocol-version change, not just `listChanged` notifications.
