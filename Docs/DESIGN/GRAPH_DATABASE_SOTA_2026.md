# Graph Database SOTA 2026 — `@borjie/graph-database`

**Last updated:** 2026-05-27
**Persona:** Mr. Mwikila
**Wave:** SOTA-GRAPH-DB
**Status:** Specification — implementation tracks this document

This document specifies `packages/graph-database/`, a unified
graph-database abstraction for Borjie. The package supplies three
drivers (Neo4j primary, FalkorDB fast-in-memory alternative, Apache
AGE Postgres-co-located), a tenant-scoped Cypher query layer, a
versioned Cypher migration manager, an audit-trail repository for
issued queries, and a set of mining-domain wrappers (licence-permit-
mine hierarchy, supply-chain provenance, worker-certification graph,
buyer-network relationships).

The `@borjie/graph-database` package is **driver-agnostic**: every
backend is reached through a `GraphDriverPort`, every query is
constructed via the typed `CypherBuilder`, and every issued statement
must carry a tenant filter (enforced by `TenantScopedQuery`).

## 1. Why a graph database at all?

Mining estates are first-class graphs. Licence-permit-mine hierarchies
have parent/child custody. Supply-chain provenance is a directed
acyclic graph from extraction → custodian → buyer. Worker
certifications link `Worker -[HOLDS]-> Certification -[ISSUED_BY]->
Regulator`. Buyer-network relationships are bipartite (Buyer <->
Mineral, Buyer <-> Mine). Modelling these in flat SQL (even with
recursive CTEs) loses readability for the operator console and makes
GraphRAG retrieval expensive.

Mr. Mwikila's brain layer (`@borjie/central-intelligence`) already
publishes a GraphRAG router and uses `@borjie/knowledge-graph` for
ontology + embeddings. What is missing is a **persistent property
graph layer** that operators (and the brain) can write to under
tenant RLS, query under tenant isolation, and migrate forward like
the rest of the SQL spine.

## 2. Database choice — three drivers, one port

### 2.1 Neo4j 5.x (primary)

Citation: *Neo4j 5 — official documentation*, https://neo4j.com/docs/,
accessed 2026-05-27. Neo4j 5 ships native vector indexes, parallel
runtime, openCypher conformance, and a stable Node.js driver
(`neo4j-driver` v6.x). The 6.x driver line introduced async iterators
for result streaming and first-class TypeScript types
(https://neo4j.com/docs/javascript-manual/current/, accessed
2026-05-27).

Neo4j is the production backend for `BORJIE_NEO4J_URI`
(already wired in `.env`). The driver is loaded lazily via
`await import('neo4j-driver')` so the package can be installed in
edge runtimes where the driver is not available.

### 2.2 FalkorDB (fast in-memory alternative)

Citation: *FalkorDB — Redis-based graph database*,
https://docs.falkordb.com/, accessed 2026-05-27. FalkorDB is a Redis
module exposing a Cypher-compatible API (`GRAPH.QUERY`). It is
in-memory and ~30–50x faster than Neo4j for sub-graph traversals on
small datasets (FalkorDB benchmarks 2025,
https://www.falkordb.com/blog/benchmarking-falkordb/, accessed
2026-05-27). The Node client `falkordb` is a thin Redis wrapper.

FalkorDB is wired as a **secondary**, used by transient brain
sessions, conversational planning graphs, and any low-latency lookup
where the result set is bounded.

### 2.3 Apache AGE 1.x (Postgres-co-located)

Citation: *Apache AGE — Graph extension for PostgreSQL*,
https://age.apache.org/docs/, accessed 2026-05-27. AGE is a Postgres
extension that adds openCypher on top of regular SQL relations. It
shares the same RLS, the same pgcrypto, the same backup pipeline as
the spine — no second cluster.

AGE is wired as the **resilience fallback**: if `BORJIE_NEO4J_URI` is
down, the driver registry falls back to AGE on the existing Supabase
Postgres instance. The driver re-uses the existing `pg` pool, so no
extra dependency.

### 2.4 ArangoDB 3.12 (multi-model — explicit non-choice)

Citation: *ArangoDB 3.12 — Multi-model Database*,
https://www.arangodb.com/docs/, accessed 2026-05-27. ArangoDB is
multi-model (document + graph + key-value) and uses AQL rather than
Cypher. We **explicitly chose against** ArangoDB because:

1. AQL is not the openCypher dialect Mr. Mwikila already speaks.
2. Multi-model overlap with the existing Postgres spine is wasted.
3. Self-hosted ArangoDB clusters introduce a third datastore.

## 3. Cypher vs GQL ISO/IEC 39075:2024

Citation: *ISO/IEC 39075:2024 — Information technology — Database
languages — GQL*, https://www.iso.org/standard/76120.html, published
2024-04-12, accessed 2026-05-27. GQL is the first ISO-blessed graph
query language; it converges openCypher, PGQL, and G-Core. Neo4j 5
and FalkorDB are openCypher-shaped today and roadmap to GQL.

The `CypherBuilder` in this package emits openCypher (the lingua
franca all three drivers accept) and ships an internal `dialect`
flag so a future GQL emitter can be added without breaking
consumers.

## 4. GraphRAG patterns — Microsoft Build 2025

Citation: *GraphRAG: New tool for complex data discovery now on
GitHub*, https://www.microsoft.com/en-us/research/blog/graphrag-new-
tool-for-complex-data-discovery-now-on-github/, published 2024-07-02,
re-affirmed at *Microsoft Build 2025* (https://news.microsoft.com/
build-2025/, 2025-05-19, accessed 2026-05-27). GraphRAG combines
community detection (Leiden) over a knowledge graph with
hierarchical summarisation; retrieval over the resulting summaries
beats naive vector RAG on multi-hop questions.

Borjie's `@borjie/graph-rag-router` already implements the pipeline
shape. `@borjie/graph-database` supplies the **persistent backing
store** that GraphRAG ingests into via the new
`MiningGraph.licencePermitHierarchy` and `supplyChainProvenance`
wrappers.

## 5. pgvector + KG hybrid retrieval

Citation: *Combining vector + graph for hybrid retrieval — pgvector +
Apache AGE*, https://supabase.com/blog/openai-embeddings-postgres-
vector, published 2024-02-20, refreshed for 2026 hybrid patterns
https://neo4j.com/blog/vector-search-graphrag/, accessed 2026-05-27.

The driver registry exposes a `vectorIndex(field, dimension, metric)`
helper on Neo4j 5 vector indexes and falls back to pgvector when
Apache AGE is the backend. Consumers query through
`MiningGraph.hybridSearch` which combines a vector kNN with a Cypher
expand over the result.

## 6. Package surface

### 6.1 Tenant-isolation invariant

The single hardest rule: **every query carries a tenant filter**.
`TenantScopedQuery` wraps the raw Cypher and rejects unscoped
attempts at compile time. The invariant is checked by:

1. The builder requires `.tenant(tenantId)` before `.build()`.
2. Wraps `MATCH` / `MERGE` / `CREATE` patterns with the tenant
   property predicate `{tenantId: $tenantId}` injected into every
   labelled node.
3. The driver port rejects any `CypherQuery` whose builder did not
   call `.tenant()`.

### 6.2 Modules

| File | Purpose |
|------|---------|
| `src/types.ts` | `GraphNode`, `GraphEdge`, `CypherQuery`, `GraphResult`, `QueryPlan`, `ConnectionConfig` |
| `src/drivers/neo4j-driver.ts` | Neo4j adapter — lazy `neo4j-driver` peer dep |
| `src/drivers/falkordb-driver.ts` | FalkorDB adapter — lazy `falkordb` peer dep |
| `src/drivers/apache-age-driver.ts` | Apache AGE via existing `pg` pool |
| `src/driver-registry.ts` | Driver lookup + health check |
| `src/query/cypher-builder.ts` | Fluent typed Cypher builder |
| `src/query/tenant-scoped-query.ts` | Tenant-scoping wrapper |
| `src/schema/migration-manager.ts` | Versioned Cypher migrations |
| `src/repositories/graph-run-repository.ts` | In-memory + SQL adapters |
| `src/domain/mining-graph.ts` | Mining-domain wrappers |
| `src/logger.ts` | `createLogger`-based package logger |
| `src/index.ts` | Public barrel |

## 7. Mining-domain wrappers — Mr. Mwikila

### 7.1 `licencePermitHierarchy(tenantId)`

Builds the
`(:Licence)-[:GRANTS]->(:Permit)-[:COVERS]->(:Mine)-[:HAS_PIT]->
(:Pit)-[:STAFFS]->(:Worker)` projection for a tenant. Used by
the regulator filing engine to render the custody chain.

### 7.2 `supplyChainProvenance(tenantId, mineralLotId)`

Traverses from a `MineralLot` node forward through the
`-[:CUSTODY_TO]->` chain until it reaches an `Export` or a `Sale`.
Used by the buyer-mobile app to prove origin.

### 7.3 `workerCertificationGraph(tenantId, workerId)`

Surfaces `Worker -[HOLDS]-> Certification -[ISSUED_BY]-> Regulator`
plus expiry. Drives the workforce-mobile compliance widget.

### 7.4 `buyerNetwork(tenantId)`

Bipartite `(:Buyer)-[:BOUGHT_FROM]->(:Mine)` plus
`(:Buyer)-[:INTERESTED_IN]->(:Mineral)`. Feeds the buyer-mobile
marketplace ranker.

## 8. Migration `0068_graph_db_queries.sql`

The audit-trail SQL companion: every Cypher statement issued through
any driver is logged into `graph_db_queries` with `(tenant_id,
driver, query_cypher, params, latency_ms, ran_at, audit_hash,
prev_hash)`. RLS uses `app.tenant_id`. Hash chain mirrors the
existing audit-hash-chain primitive. Idempotent — safe to re-run.

## 9. Live-test only

Per project rules: no faked driver responses. Tests use the
in-memory driver from `@borjie/knowledge-graph`'s in-memory store
plus clearly labelled mock `Fetcher` adapters that exercise the
driver port surface. Live driver smoke tests are gated by
`BORJIE_NEO4J_URI` / `BORJIE_FALKORDB_URL` env vars and skipped in
CI by default.

## 10. Citations summary

1. *Neo4j 5 documentation*, https://neo4j.com/docs/, 2026-05-27.
2. *Neo4j JavaScript Manual 6.x*,
   https://neo4j.com/docs/javascript-manual/current/, 2026-05-27.
3. *FalkorDB documentation*, https://docs.falkordb.com/, 2026-05-27.
4. *Apache AGE documentation*, https://age.apache.org/docs/,
   2026-05-27.
5. *ArangoDB 3.12 documentation*, https://www.arangodb.com/docs/,
   2026-05-27.
6. *ISO/IEC 39075:2024 GQL standard*,
   https://www.iso.org/standard/76120.html, 2024-04-12.
7. *GraphRAG — Microsoft Research*,
   https://www.microsoft.com/en-us/research/blog/graphrag-new-tool-
   for-complex-data-discovery-now-on-github/, 2024-07-02 (refreshed
   at *Microsoft Build 2025*, 2025-05-19).
8. *Neo4j Vector Search + GraphRAG*,
   https://neo4j.com/blog/vector-search-graphrag/, 2026-05-27.
9. *Supabase pgvector + Apache AGE*,
   https://supabase.com/blog/openai-embeddings-postgres-vector,
   2024-02-20.

## 11. Out of scope

- Cypher-to-GQL translation — we ship openCypher today; the
  `dialect` flag is the seam.
- Distributed Neo4j Fabric — single primary, AGE fallback.
- Graph algorithms (Louvain, PageRank) — already covered by
  `@borjie/knowledge-graph` and Neo4j GDS.
- Permission-graph queries — owned by `@borjie/graph-privacy`.

## 12. Acceptance criteria

- ≥18 vitest tests; CypherBuilder emits correct strings;
  TenantScopedQuery rejects unscoped attempts; Neo4j/FalkorDB/AGE
  drivers exercised through mock fetchers; mining-graph wrappers
  produce correctly shaped Cypher; repository CRUD plus migration
  round-trip pass.
- TypeScript strict mode on; no `@ts-nocheck`; no `console.*` calls;
  every logger goes through `createLogger`.
- Package builds clean with `tsc`.
- Migration `0068_graph_db_queries.sql` is idempotent and RLS-locked
  via `app.tenant_id`.
