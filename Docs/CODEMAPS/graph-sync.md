# Graph Sync Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/graph-sync/`
**Public entry:** `packages/graph-sync/src/index.ts`
**Tier scope:** cognitive core (Neo4j knowledge layer)

## Purpose

The Neo4j knowledge-graph sync layer. Mirrors a tenant-scoped subset
of Postgres rows (properties, units, leases, customers, payments,
documents, owners) into a Neo4j graph for relationship queries the
relational ORM can't express cheaply (e.g. "all leases tied to this
owner that share a co-tenant with property X"). All Cypher is
tenant-scoped via `assertCypherReferencesTenantId()` so a missing
predicate throws `TenantScopeViolation` at runtime.

## Entry points

- `src/index.ts` — barrel.
- `src/client/neo4j-client.ts` — Neo4j driver wrapper, config schema.
- `src/client/tenant-scoped-cypher.ts` — `createTenantScopedCypher()`,
  `TenantScopeViolation`, read/write client types.
- `src/schema/` — node label + relationship type registries.
- `src/queries/` — pre-built Cypher.
- `src/sync/` — outbox-driven projector.
- `src/scripts/` — backfill + reconcile scripts.

## Internal structure

- `client/` — driver + scoping primitives.
- `schema/` — `ALL_NODE_LABELS`, relationship registry.
- `queries/` — named Cypher templates.
- `sync/` — event-bus subscribers + projectors.

## Dependencies

- Upstream: Neo4j driver, `@borjie/observability`, `@borjie/database`.
- Downstream: central-intelligence (graph retrievals), reports, search.

## Common workflows

- **Issue a tenant-scoped query** →
  `client.run(scopeNodePattern('Property', 'p'), { tenantId })`.
- **Subscribe to a domain event** → register in `sync/` projectors.
- **Run a backfill** → `pnpm -F @borjie/graph-sync sync:property`.

## Anti-patterns to avoid

- Never run raw Cypher without `assertCypherReferencesTenantId`.
- Never project PII without going through `@borjie/graph-privacy`.
- Never mutate via a Read client.
- Never hold a Neo4j session beyond a single query — leak risk.

## Related codemaps

- [database.md](./database.md) — source of truth
- [graph-privacy.md](./graph-privacy.md) — DP budget
- [central-intelligence.md](./central-intelligence.md) — retrieves graph context
