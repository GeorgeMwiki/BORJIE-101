# MCP Servers (FIRS / NGGIS / NIN / OPAY / Process-Intel) Codemap

**Last Updated:** 2026-05-22
**Modules:**
- `services/mcp-server-firs/` — Nigerian FIRS (tax) MCP
- `services/mcp-server-nggis/` — Nigerian National Geospatial MCP
- `services/mcp-server-nin/` — National Identification Number MCP
- `services/mcp-server-opay/` — OPay payments MCP
- `services/mcp-server-process-intel/` — Process-mining MCP

**Tier scope:** platform spine (per-integration MCP surfaces)

## Purpose

Each service is a Model Context Protocol server that exposes ONE
external integration's tools to the Brain (and to external MCP
clients). They share an identical shape — `adapter.ts` (HTTP /
SDK wrapper to the upstream service), `tools/` (typed MCP tool
catalogue), `index.ts` (composition), and `types.ts`. The
process-intel server is the outlier: it adapts a Python pm4py
client over IPC via `pm4py-client.ts` and ingests event logs via
`event-log-loader.ts`.

## Entry points (typical)

- `src/index.ts` — boots the MCP server, registers tools.
- `src/adapter.ts` — upstream adapter.
- `src/tools/` — per-tool definitions.
- `src/types.ts` — shared request/response shapes.
- `mcp-server-opay/src/adapter-real.ts` — real adapter (parallel to
  the test-friendly `adapter.ts`).
- `mcp-server-process-intel/src/{event-log-loader.ts,pm4py-client.ts}`
  — special-case adapters.

## Internal structure

- All four follow the same `adapter + tools + index` pattern so
  Brain integration is uniform.
- Auth + tier gating shared via `@borjie/mcp-server`.

## Dependencies

- Upstream: `@borjie/mcp-server`, `@borjie/observability`,
  `@borjie/connectors` (resilience), `@borjie/authz-policy`.
- Downstream: Brain (via tool catalogue), external MCP clients.

## Common workflows

- **Boot** → load env, register tools, listen.
- **Tool call** → auth → tier check → adapter call → response.
- **Audit** → every call lands in audit chain.

## Anti-patterns to avoid

- Never expose an upstream-specific error verbatim — translate.
- Never bypass the resilience wrapper for upstream calls.
- Never log secrets / PII passing through.
- Never short-circuit cost-persistence.

## Related codemaps

- [mcp-server.md](./mcp-server.md) — base primitives
- [observability.md](./observability.md) — audit + metrics
- [connectors.md](./connectors.md) — resilience
