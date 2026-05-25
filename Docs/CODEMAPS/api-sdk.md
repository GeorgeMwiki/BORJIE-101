# API SDK Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/api-sdk/`
**Public entry:** `packages/api-sdk/src/index.ts`
**Tier scope:** user surface (typed SDK to api-gateway)

## Purpose

Typed SDK for talking to the api-gateway from server-side callers
(SSR loaders, MCP tools, internal scripts) and from Jarvis (the
admin-platform-portal AI surface). Pairs with `@borjie/api-client`
which is browser-focused; `api-sdk` covers Jarvis streaming +
strongly-typed REST/SSE calls.

## Entry points

- `src/index.ts` — barrel.
- `src/client.ts` — `createSdkClient(baseUrl, token)`.
- `src/jarvis-client.ts` — Jarvis-specific REST client.
- `src/jarvis-stream.ts` — Jarvis SSE / streaming wrapper.
- `src/types.ts` — request + response types.

## Internal structure

- `client.ts` — base fetch wrapper.
- `jarvis-client.ts` + `jarvis-stream.ts` — split sync vs streaming
  endpoints.
- `types.ts` — shared types.
- `__tests__/` — contract tests against gateway stubs.

## Dependencies

- Upstream: `@borjie/domain-models`, native `fetch`,
  `EventSource` polyfill.
- Downstream: admin-platform-portal (Jarvis), MCP servers, scripts.

## Common workflows

- **Make a typed call** → `await sdk.properties.list({ tenantId })`.
- **Stream Jarvis** →
  `for await (const chunk of jarvisStream.run(prompt)) { ... }`.
- **Rotate token** → recreate client; stateless.

## Anti-patterns to avoid

- Never use this SDK in the browser — use `@borjie/api-client`.
- Never log raw streaming tokens — may leak secrets.
- Never share an SDK instance across tenants without re-scoping.
- Never bypass the typed wrapper — keep contracts honest.

## Related codemaps

- [api-client.md](./api-client.md) — browser sibling
- [api-gateway.md](./api-gateway.md) — server target
- [chat-ui.md](./chat-ui.md) — Jarvis frontend
