# MCP Server Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/mcp-server/`
**Public entry:** `packages/mcp-server/src/index.ts`
**Tier scope:** platform spine (Model Context Protocol surface)

## Purpose

Reference MCP server that exposes Borjie capabilities as MCP
tools/resources/prompts to external AI clients. Auth-gated by
tier and tenant. Acts as the umbrella that registers the tool
catalog from every workspace package; the four MCP server services
(`mcp-server-firs`, `mcp-server-nggis`, `mcp-server-nin`,
`mcp-server-opay`, `mcp-server-process-intel`) consume primitives
from here.

## Entry points

- `src/index.ts` — barrel.
- `src/borjie-mcp-server.ts` — main server.
- `src/mcp-auth.ts` — bearer + tier auth.
- `src/tool-registry.ts` — registered tool catalogue.
- `src/mcp-resources.ts`, `src/prompts.ts` — resources + prompts.
- `src/tier-router.ts` — tier-aware routing.
- `src/universal-tool-adapter.ts` — wraps any service-call as a
  typed MCP tool.
- `src/cost-persistence.ts` — token-cost ledger.

## Internal structure

- `tool-registry.ts` — central registration.
- `tier-router.ts` — feature-flag + tier-gate dispatcher.
- `universal-tool-adapter.ts` — generic JSON-schema → MCP tool.
- `mcp-auth.ts` — verifies bearer tokens, derives tenant scope.
- `__tests__/` — auth + tool dispatch tests.

## Dependencies

- Upstream: `@borjie/authz-policy`, `@borjie/observability`,
  `@borjie/domain-models`, MCP SDK.
- Downstream: services/mcp-server-* (build atop this), external clients.

## Common workflows

- **Register a tool** →
  `toolRegistry.register({ name, schema, run })`.
- **Authenticate** → `mcpAuth.verify(bearer)` → `{ tenantId, tier }`.
- **Dispatch** → tier-router selects handler.

## Anti-patterns to avoid

- Never expose a tool without a tier guard.
- Never log tool inputs containing PII.
- Never bypass cost-persistence — every call is metered.
- Never share auth state across requests.

## Related codemaps

- [agent-platform.md](./agent-platform.md) — auth + idempotency
- [authz-policy.md](./authz-policy.md) — bearer + tier
- [observability.md](./observability.md) — cost ledger
