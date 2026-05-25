# API-Gateway Codemap

**Last Updated:** 2026-05-22
**Module:** `services/api-gateway/`
**Public entry:** `services/api-gateway/src/index.ts`
**Tier scope:** tenant + admin + sovereign (tier inferred from token claims)

## Purpose

Hono-based BFF and composition root. Front-line for every UI app
(customer / estate-manager / owner / admin). Authenticates Supabase
JWT, binds `app.current_tenant_id` GUC, applies kill-switch + rate
limit + autonomy-guard, then dispatches to route handlers. The
`composition/` directory is the single seam between port interfaces
and concrete adapters.

## Entry points

- `src/index.ts` — dotenv load + OTel bootstrap (must run first) +
  Express middleware (`helmet`, CORS, pino-http) + Hono mount at
  `/api`.
- Hono sub-routers under `src/routes/` — ~150 routers (auth, tenants,
  users, properties, leases, payments, brain, cases, ai-*, sovereign,
  admin-jarvis, etc.).
- `src/composition/` — adapter wiring (brain-kernel-wiring,
  agency-port-bindings, hq-tool-port-bindings, db-client, mcp-wiring,
  voice-agent-wiring, predictive-interventions, monthly-close,
  cross-portal-bus, persona-drift-cron, sovereign-ledger-verify-cron).

## Internal structure

- `routes/` — Hono routers. New convention is `*.hono.ts`; older
  `*.router.ts` survive during migration.
- `composition/` — port → adapter wiring + cron registries. The only
  place that imports both pure ports and concrete infra.
- `middleware/` — auth (Supabase JWT verify via `jose`), tenant claim
  hardening, RLS GUC bind, error envelope.
- `observability/` — OTel bootstrap + Sentry + pino logger.
- `health/`, `instrumentation/`, `openapi/`, `schemas/`, `workers/`.

## Dependencies

- Upstream: 4 UI apps + Supabase Auth.
- Downstream: `packages/central-intelligence` (brain), `services/payments-
  ledger`, `services/domain-services`, `services/notifications`,
  `services/document-intelligence`, `services/reports`, `packages/database`.

## Common workflows

- **Add a route** → create `src/routes/foo.hono.ts` exporting a Hono
  app; mount in `src/index.ts`; auth via `requireAuth` from
  `middleware/auth-supabase.ts`.
- **Add a kernel sensor** → wire in `composition/brain-kernel-wiring.ts`;
  failover registered via `sensor-failover-cascade.ts`.
- **Add a cron** → register in `composition/` with descriptive name
  (e.g. `audit-verify-cron.ts`, `persona-drift-cron.ts`).
- **Tenant context** → `middleware/service-context.middleware.ts`
  binds `app.current_tenant_id` GUC; downstream repos rely on RLS.
- **OpenAPI export** → `pnpm openapi:export` runs `openapi.ts`.

## Anti-patterns to avoid

- Never import from a route handler into another route handler —
  compose via service-locator pattern in `composition/service-
  registry.ts`.
- Never read `process.env` outside `src/index.ts` / `composition/`
  bootstrap. Dotenv loads ONCE at the top of `index.ts`.
- Never bypass `requireAuth` for write routes — only `auth.ts` and
  `webhooks` are unauthenticated and they verify HMAC.
- Never re-introduce Clerk imports — Supabase JWT is canonical.
- Kill-switch is fail-closed; do not catch + ignore its errors.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — wired here
- [database.md](./database.md) — GUC binding, repos
- [payments-ledger.md](./payments-ledger.md) — webhook routes
- [agent-platform.md](./agent-platform.md) — A2A error codes
