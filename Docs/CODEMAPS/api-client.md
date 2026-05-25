# API Client Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/api-client/`
**Public entry:** `packages/api-client/src/index.ts`
**Tier scope:** user surface (shared HTTP client + React Query hooks)

## Purpose

Browser-side HTTP client used by every web app to talk to the
api-gateway. Wraps `fetch` with auth-token injection, request /
response / error interceptors, retries, and a React Query hooks
layer (`useQuery`, `useMutation`, `useInfiniteQuery`, plus
pre-built `useCreateMutation`, `useUpdateMutation`,
`useDeleteMutation`). Also bundles the ISO-4217-aware currency
formatter so `formatCurrency` is consistent across every screen.

## Entry points

- `src/index.ts` — barrel.
- `src/client.ts` — `createApiClient()`, `getApiClient()`,
  `hasApiClient()`, interceptor types.
- `src/currency.ts` — `formatCurrency(amount, currency, locale)`.
- `src/hooks/` + `src/hooks.ts` — React Query bindings.
- `src/services/` — typed wrappers per domain.
- `src/types.ts` — `ApiResponse<T>`, error shapes.

## Internal structure

- `client.ts` — interceptor pipeline + retry logic.
- `services/` — domain-specific service wrappers
  (auth, properties, leases, payments, etc).
- `hooks/` — React Query hook factories.

## Dependencies

- Upstream: `@tanstack/react-query`, `zod`, native `fetch`.
- Downstream: every web app + chat-ui + design-system pages.

## Common workflows

- **Bootstrap a client** → `createApiClient({ baseUrl, token })`
  in app composition.
- **Fetch** → `const { data } = useQuery(['properties'], () => api.properties.list())`.
- **Mutate** → `useCreateMutation(['properties'], api.properties.create)`.
- **Format money** → `formatCurrency(123.45, tenantCurrency)`.

## Anti-patterns to avoid

- Never call raw `fetch` from a page — go through the client.
- Never put auth tokens in localStorage — use the interceptor.
- Never hardcode currency to KES — pass tenant currency.
- Never bypass interceptors for retry / error scrubbing.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — server counterpart
- [design-system.md](./design-system.md) — UI primitives
- [chat-ui.md](./chat-ui.md) — uses hooks for streaming
