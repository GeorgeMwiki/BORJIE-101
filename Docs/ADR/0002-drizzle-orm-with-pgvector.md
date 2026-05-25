# ADR 0002 — Drizzle ORM with pgvector

- **Status:** Accepted
- **Date:** 2025-Q4 (backfilled 2026-05-18)

## Context

Borjie's persistence layer must support:

- Relational property + lease + payment data with strict typing
- Vector similarity search (kernel semantic memory, skill library
  retrieval, embedding-backed search across documents)
- Multi-tenant Row-Level Security (RLS)
- Time-travel queries for audit replay
- Migration tooling that survives in production at 3 AM

Options considered:

| Option | Verdict |
|---|---|
| Prisma | Excellent DX but vector support immature; runtime engine adds latency tier |
| TypeORM | Type system fights us; decorators not aligned with our functional style |
| Kysely + raw SQL | Strong types but tooling around it (migrations, seeding) thin |
| Sequelize | Legacy; types are afterthought |
| Drizzle | Selected |

For vector indexing, the options were pgvector (Postgres native),
Weaviate (separate service), or Pinecone (managed SaaS). Postgres-
native pgvector wins for operational simplicity, transactional
consistency, and tenant isolation.

## Decision

Use Drizzle ORM as the type-safe SQL layer. Use pgvector as the
vector index, integrated directly via Drizzle's
[`vector` column type](https://orm.drizzle.team/docs/column-types/pg#vector).

The schemas live in `packages/database/src/schemas/`. Migrations in
`packages/database/src/migrations/` (Drizzle's SQL output).

## Consequences

**Positive:**

- Schemas are TypeScript-first; inferred types flow through every
  service automatically.
- Drizzle queries compile to predictable SQL — no hidden N+1.
- pgvector + HNSW indexes deliver < 50ms p99 similarity search at
  10M-row scale.
- RLS at the Postgres layer means a buggy query cannot leak across
  tenants.
- Single backup story (Postgres) — no separate vector store to back up.

**Negative:**

- Drizzle is younger than Prisma; some edge cases (deferrable
  constraints) require workarounds.
- pgvector index build is slow on very large tables; tune
  `maintenance_work_mem` for re-index windows.
- HNSW recall < 100%; acceptable for retrieval but never for
  exact-match flows.

## Alternatives considered

We revisited Weaviate when we considered hybrid (lexical + vector)
search but pgvector + Postgres tsvector achieves the same with less
operational surface.

## References

- `packages/database/src/schemas/index.ts`
- `Docs/ARCHITECTURE.md` § Data model
- `Docs/DATA_FLOWS.md`
