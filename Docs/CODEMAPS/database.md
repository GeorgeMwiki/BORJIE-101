# Database Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/database/`
**Public entry:** `packages/database/src/index.ts`
**Tier scope:** all (RLS enforced per-table; GUC `app.current_tenant_id`)

## Purpose

Drizzle ORM schemas, 183 migrations, RLS hardening, pgvector setup,
seed data, and multi-tenancy guardrails. The single canonical
data layer for every service. RLS is FORCE-enabled on every
tenant-scoped table; admin / sovereign overrides only via signed,
audited paths.

## Entry points

- `src/index.ts` — re-exports schemas + client + repositories.
- `src/client.ts` — Drizzle pool (R/W split via Postgres HA).
- `src/migrations/` — 194 numbered SQL files (`0001` .. `0194`).
  Latest: `0194_entity_ext_person.sql` (Piece A universal asset model
  + backward-compat `properties_view` / `units_view`).
- `src/run-migrations.ts` + `src/reset-db.ts` + `pnpm migrate`.

## Internal structure

- `schemas/` — 100+ `*.schema.ts` Drizzle table definitions
  (currency-preferences, currency-rates, ai-semantic-memory,
  conversation, cases, communications, classroom, arrears-cases,
  approval-policy, autonomy, audit-events, ai-audit-chain,
  cross-tenant-denials, owner_statements, section_layouts,
  user_action_tracker, etc.).
- `migrations/` — pure SQL; numbered; never edit a shipped migration.
- `repositories/` — typed repos (tenant predicate baked in).
- `security/` — `data-classification.ts`, `encryption/`.
- `services/`, `seeds/`, `seed.ts`, `query-analyzer.ts`,
  `slow-query-logger.ts`.

## Dependencies

- Upstream: every service + worker (api-gateway, payments-ledger,
  notifications, outbox-processor, reports, identity, webhooks,
  document-intelligence, consolidation-worker, all MCP servers).
- Downstream: Postgres (Supabase prod, local Docker dev), pgvector
  for embeddings, Drizzle Kit for migration generation.

## Common workflows

- **Add a table** → write `schemas/*.schema.ts` + generate SQL via
  `pnpm db:generate` → review numbered migration → ship.
- **Enable RLS** → in migration `ALTER TABLE foo ENABLE ROW LEVEL
  SECURITY; ALTER TABLE foo FORCE ROW LEVEL SECURITY;` + policy
  `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`.
  Pattern in `migrations/0172_unify_rls_guc.sql` +
  `0173_force_rls_sweep.sql` + `0175_fix_rls_type_coercion.sql`.
- **Add an index** → composite indexes for hot paths in
  `0179_missing_tenant_indexes.sql` / `0180_perf_indexes.sql`.
- **Backfill** → use `0182_section_layouts.sql` pattern: create
  table, backfill from extant data, then validator (CI gate at
  `scripts/audit-not-yet-wired.mjs` for similar bypass guards).
- **Embeddings** → pgvector guard in `0178_pgvector_guard.sql`.

## Anti-patterns to avoid

- Never edit a shipped migration — append a new numbered file.
- Never `WHERE tenant_id = $1` from application code on a table that
  already has RLS — let RLS do it; double-filter masks bugs.
- Never use raw SQL strings with user input — Drizzle prepared
  queries only.
- Never disable RLS for performance — fix the index instead.
- Migration numbers are monotonic; if you collide, rebase before
  merging (see `Wave 3 Z1 — Migration number collision fix`).

## Related codemaps

- [api-gateway.md](./api-gateway.md) — GUC binding
- [payments-ledger.md](./payments-ledger.md) — ledger tables
- [central-intelligence.md](./central-intelligence.md) — memory + CoT
