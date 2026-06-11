# SOTA Data-Layer Scaling — Multi-Tenant Supabase / Postgres (PG17 + RLS + pgvector)

**Audience:** Borjie platform/data engineers planning the path from one Supabase
instance to millions of tenant-scoped users.
**Stack assumed:** Postgres 17, FORCE-enabled RLS on every tenant-scoped table,
pgvector (HNSW) for `intelligence_corpus_chunks`, Supavisor pooler, PostgREST Data API.
**Date:** 2026-06-08
**Method:** Deep web research — every claim below cites a real URL that was actually
fetched (WebFetch) or surfaced via WebSearch. Items I could not verify against a
fetched primary source are marked **UNVERIFIED**.

> TL;DR for Borjie. Our failure mode is **not** raw rows — Postgres handles billions.
> It is (1) **connection exhaustion** under serverless/Expo fan-out, (2) **RLS evaluated
> per-row** on big tenant tables, and (3) **HNSW index RAM** for the corpus. The path is
> almost never "shard first." It is: optimize queries + index RLS columns → pool in
> transaction mode (Supavisor :6543) → add read replicas for read-heavy + geo →
> partition the few hot tables by `tenant_id`/time → and only at extreme scale move to
> Citus / app-level sharding or dedicated-DB for whale tenants. Notion and Figma both ran
> a single Postgres to *four orders of magnitude* of growth before sharding — sharding is
> the **last** lever, not the first.

---

## 0. The one number that governs everything: active connections, not rows

Postgres uses a **process-per-connection** model. Each backend is an OS process
costing ~1–2 MB resident (≤2 MiB with huge_pages), and — critically — *idle*
connections still tax *active* throughput because every transaction must build a
snapshot across all backends.

Citus/Microsoft's Andres Freund quantified this precisely (PG12, 48 active connections):

| Idle connections | Throughput (TPS) | Loss |
|---|---|---|
| 0 | 1,032,435 | — |
| 5,000 | 702,680 | 32% |
| 10,000 | 521,558 | 49% |

For a **single** active connection the cliff is worse — 33,773 TPS at 0 idle vs
9,807 TPS at 5,000 idle (**71% loss**). CPU profiling showed "50% of the CPU time is
spent in `GetSnapshotData()`" with 1 active + 5,000 idle connections.
([Citus — Analyzing the Limits of Connection Scalability](https://www.citusdata.com/blog/2020/10/08/analyzing-connection-scalability/))

**Postgres 14** rewrote `GetSnapshotData()` (Freund). With 10,000 idle connections, a
single active query went from ~15,000 TPS (PG13) to ~35,000 TPS — **>2x**; for
read-mostly workloads "snapshot computation is nearly entirely eliminated as an
overhead."
([pganalyze — Postgres 14 performance](https://pganalyze.com/blog/postgres-14-performance-monitoring) ·
WebSearch corroboration: [Citus — Improving Connection Scalability: Snapshots](https://www.citusdata.com/blog/2020/10/25/improving-postgres-connection-scalability-snapshots/))

**Borjie implication (PG17):** we inherit the PG14+ snapshot fix, but the structural
limit remains. The single most important scaling decision is **bounding active backends
via a pooler** — not buying a bigger box. 2,000 direct connections cost ~4–8 GB of
backend RAM; PgBouncer fronting the same load with ~100 server connections uses
~200–400 MB.
([WebSearch — Postgres connection limits / why max_connections is limited](https://www.cybertec-postgresql.com/en/tuning-max_connections-in-postgresql/))

---

## 1. Connection pooling at scale — Supavisor, PgBouncer, transaction mode

### 1.1 Supavisor (Supabase's default pooler) — why it is best-in-world here

Supavisor 1.0 is a **cloud-native, multi-tenant** Postgres pooler written in **Elixir**
(BEAM) for "high concurrency and rapid I/O," using Rust (`pg_query.rs` from pganalyze via
Rustler) for SQL parsing because "Elixir doesn't have great performance for parsing." It
is designed to "proxy millions of Postgres end-client connections into a stateful pool of
native Postgres database connections," runs as a **highly-available cluster** of nodes,
and stores tenant config in an HA Postgres loaded on pool init.
([Supabase — Supavisor 1.0 blog](https://supabase.com/blog/supavisor-postgres-connection-pooler) ·
[supabase/supavisor GitHub](https://github.com/supabase/supavisor))

Why best-in-world for our case: it is the only mainstream pooler purpose-built to be
**multi-tenant** (one cluster, many databases) *and* horizontally scalable on BEAM,
exactly the Borjie shape (many tenants behind one logical platform). It also:
- **Broadcasts named PREPARE** statements across all server connections so prepared
  statements survive transaction-mode pooling (memory cost per plan, throughput gain).
- **Load-balances reads** randomly across replicas; **auto-routes writes** to primary by
  "probing read replicas until it hits the primary with a successful write" (zero
  client-side complexity, writes cost a few ms more).
- Supports **query cancelation** (Ctrl-C in psql).
([Supabase — Supavisor 1.0 blog](https://supabase.com/blog/supavisor-postgres-connection-pooler))

### 1.2 Transaction mode (port 6543) vs session mode (port 5432) — the rule

- **Transaction mode (:6543)** — a server connection is borrowed for the duration of a
  *single transaction*, then returned. This is what lets one pool of ~N server
  connections serve thousands of clients. **Use this for serverless / Expo mobile /
  PostgREST / short web requests.**
- **Session mode (:5432-pooled or direct)** — connection held for the whole client
  session. Needed for session-scoped features.
([Supabase — Connection management](https://supabase.com/docs/guides/database/connection-management) ·
[Supabase — Supavisor & Connection Terminology](https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO))

**Transaction-mode gotchas (these break silently — audit Borjie for them):**
- `SET` / `SET search_path` outside a transaction "evaporates when the transaction ends."
- `pg_advisory_lock()` is session-scoped → use **`pg_advisory_xact_lock()`** (auto-releases
  on commit/rollback).
- `LISTEN/NOTIFY` subscriptions are session-scoped → need a **dedicated long-lived
  connection** that bypasses the transaction pooler.
- Slow queries still exhaust the pool, "just more slowly" — pooling is not a substitute
  for query optimization.
([TTB — PgBouncer & Rails](https://ttb.software/2026/04/11/postgres-connection-pooling-pgbouncer-rails/) ·
[DEV — PgBouncer complete guide](https://dev.to/geekyfox90/postgresql-connection-pooling-with-pgbouncer-a-complete-guide-2fam))

**Prepared statements in transaction mode** were historically the `prepared statement
"S_1" does not exist` error, because prepared statements are local to each backend
process. **PgBouncer 1.21+** added `max_prepared_statements` (start at ~10); **Supavisor
handles this natively** by broadcasting PREPAREs to all connections. So on Supavisor
transaction mode, prepared statements work; on raw PgBouncer < 1.21 they don't.
([pganalyze — PgBouncer 1.21 prepared statements](https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode))

### 1.3 Pool sizing — the formulas and the Supabase percentages

- **Theoretical active-backend ceiling (HikariCP / Postgres wiki):**
  `connections = ((core_count * 2) + effective_spindle_count)`. On SSD/NVMe the spindle
  term ≈ 1, so an 8-core box ≈ `2*8 + 1 = 17` (round to ~20) **active backends across the
  entire fleet** — not per pod. PG performance degrades past this due to context
  switching, lock contention, and shared-buffer eviction.
  ([JusDB — Pool sizing formula](https://www.jusdb.com/blog/postgresql-connection-pool-sizing-pgbouncer) ·
  [techinterview.org — pool sizing](https://www.techinterview.org/post/3233474194/system-design-database-connection-pooling-pgbouncer-hikaricp-pool-sizing-connection-limits-idle-timeout-performance/))
- **Supabase pool-size guidance:** if you lean heavily on the **PostgREST Data API**, do
  not raise pool size past **40%** of Database Max Connections; otherwise you can commit
  up to **80%**, leaving headroom for Auth, Storage, and Supabase reserved roles.
  ([Supabase — Connection management](https://supabase.com/docs/guides/database/connection-management))

### 1.4 Supabase compute tiers — exact connection limits (the planning table)

"Client connections" = how many clients can attach to the pooler simultaneously (capped
by the tier). "Backend/server connections" = pool size = actual connections opened to
Postgres. The Supavisor pooler client caps are **hard-coded** — to raise them you must
upgrade compute. (`max_connections` can be tuned down/up via the CLI
`postgres-config update --config max_connections=…` but is bounded by RAM.)

| Compute size | Direct (Postgres) connections | Pooler (client) connections |
|---|---|---|
| Nano (Free) | 60 | 200 |
| Micro | 60 | 200 |
| Small | 90 | 400 |
| Medium | 120 | 600 |
| Large | 160 | 800 |
| XL | 240 | 1,000 |
| 2XL | 380 | 1,500 |
| 4XL | 480 | 3,000 |
| 8XL | 490 | 6,000 |
| 12XL | 500 | 9,000 |
| 16XL | 500 | 12,000 |

([WebSearch — Supabase compute add-ons / connection terminology, corroborated by
Supavisor 1.0 client caps: Micro 200, Small 400, Large 800, 16XL 12,000](https://supabase.com/blog/supavisor-postgres-connection-pooler) ·
[Supabase — How to change max database connections](https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5))

### 1.5 The connection-exhaustion failure mode (what it looks like, how to catch it)

**Symptom chain:** clients receive `FATAL: sorry, too many clients already` / `remaining
connection slots are reserved` or, on the pooler, requests **queue then time out** when
active connections == pool_size. Root cause is almost always serverless/mobile fan-out
opening a connection per invocation, long-held transactions, or N+1 holding connections
during slow queries.
([DEV — Your Node.js app is probably killing your Postgres](https://dev.to/polliog/your-nodejs-app-is-probably-killing-your-postgresql-connection-pooling-explained-1db2))

**Diagnostics:** `pg_stat_activity` (live connections + `state` + `wait_event`), Supabase
Grafana (200+ metrics), and watch "active connections == pool_size" as the saturation
signal.
([Supabase — Connection management](https://supabase.com/docs/guides/database/connection-management))

**Borjie remediation order:** (1) every short-lived caller uses the **transaction
pooler :6543**, never a direct connection; (2) set `idle_in_transaction_session_timeout`
and `statement_timeout`; (3) size the pool by the active-backend formula, not by client
count; (4) only then consider bigger compute.

---

## 2. RLS performance at scale (and its pitfalls) — the highest-leverage Borjie item

RLS is FORCE-enabled on every tenant-scoped table in Borjie, so **every** SELECT/UPDATE
runs the policy expression. On big tables the wrong policy shape causes per-row
re-evaluation and seq scans that *time out*.

### 2.1 The four rules (with measured impact)

1. **Index the RLS column.** `user_id = auth.uid()` without an index → seq scan: "On
   10,000 rows… 50ms instead of 2ms. On 1,000,000 rows, it times out." Add
   `create index … using btree (user_id)` → ">100x" on large tables. For Borjie, every
   `tenant_id` (and any `user_id`/`owner_id`) used in a policy must be B-tree indexed.
2. **Wrap functions in a scalar subquery:** `auth.uid()` → `(select auth.uid())`. This
   forces an **initPlan** so the optimizer evaluates the function **once** and caches it,
   instead of per row.
3. **Use a `SECURITY DEFINER` + `STABLE` function** for tenant lookup. Marking it
   `STABLE` lets the planner cache the result for the whole statement: a slow policy
   ~450ms/10k rows became ~45ms/10k rows (**10x**) in the cited example.
4. **Always scope `TO authenticated`** (and the right role) on the policy. It does not
   speed up the signed-in user's query but "eliminate[s] 'anon' users without taxing the
   database to process the rest of the RLS."

([Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) ·
[SupaExplorer — Optimize RLS Policies for Performance](https://supaexplorer.com/best-practices/supabase-postgres/security-rls-performance/) ·
[Medium/AntStack — Optimizing RLS performance with Supabase](https://medium.com/@antstack/optimizing-rls-performance-with-supabase-postgres-fa4e2b6e196d))

### 2.2 Pitfalls specific to multi-tenant RLS

- **Subqueries/joins in the policy run per row.** "With 10,000 documents, Postgres runs
  10,000 subqueries even if you only need 10 rows." Push the tenant check to a cached
  STABLE function or a GUC, not a correlated subquery.
- **Don't double-filter.** Borjie binds `app.current_tenant_id` in api-gateway
  middleware and RLS enforces it — adding `WHERE tenant_id = $1` in app code on top is
  redundant work and a footgun if it drifts from the policy. (Borjie hard rule: never
  double-filter from app code.)
- **Test with `EXPLAIN ANALYZE`** on production-shaped data; the guidance is "optimize if
  queries exceed 50ms on your typical data size."
([SupaExplorer](https://supaexplorer.com/best-practices/supabase-postgres/security-rls-performance/) ·
[makerkit — Supabase RLS best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices))

**Borjie note:** because `app.current_tenant_id` is already a GUC set by middleware,
the cheapest correct policy is `tenant_id = (select current_setting('app.current_tenant_id')::uuid)`
with a B-tree index on `tenant_id` — single initPlan, index scan, no per-row function.

---

## 3. Read replicas + read/write split

Supabase read replicas use **streaming WAL replication**, **asynchronous** so primary
transactions aren't blocked (with replication lag). A **load balancer** auto-splits:
**non-GET (writes) → primary**, **GET (reads) → primary or replicas**. As of
**2025-04-04** the read routing changed from round-robin to **geo-routing** (closest DB),
cutting cross-region latency (the doc notes EU users seeing "100–150ms of network latency
on every query" before regional replicas). Each replica runs its **own PostgREST**
instance.
([Supabase — Read Replicas docs](https://supabase.com/docs/guides/platform/read-replicas) ·
[Supabase — Introducing Read Replicas](https://supabase.com/blog/introducing-read-replicas) ·
[Supabase — Improved Experimental Routing (Discussion #34494)](https://github.com/orgs/supabase/discussions/34494))

**Read-replica vs bigger compute — decision framework:**
- Replicas **only help reads**. Write-heavy → you need a **bigger primary** (all
  INSERT/UPDATE/DELETE go to primary). 
- Best replica use cases: **read-heavy (80%+ reads)**, **geo-distribution**, and
  **analytics isolation** ("the most common reason teams adopt Read Replicas").
- At the **16XL ceiling**, vertical scaling ends — "the only way to add read capacity is
  horizontal: spread reads across replicas."
- Replication conflicts can cancel long analytics queries; tune
  `max_standby_streaming_delay` (trades lag for query survival).
- Cost: at mid-tier comparable (4XL→8XL ≈ +$910/mo vs a 4XL replica ≈ +$960/mo); at high
  tiers replicas get more economical.
([Supabase — Read Replicas vs Bigger Compute](https://supabase.com/blog/read-replicas-vs-bigger-compute))

**Borjie caveat:** async lag means **read-your-writes** is not guaranteed on replicas.
The AI brain's audit-chain reads, ledger reads after a `post()`, and "did my write land"
flows must route to **primary** (or accept eventual consistency explicitly). Supavisor's
write-probing keeps writes correct; the risk is *stale reads*, not lost writes.

---

## 4. Partitioning + table sharding (within one Postgres)

### 4.1 Declarative partitioning (PG17) — RANGE / LIST / HASH

- **RANGE** (e.g. by `created_at` month) for time-series like audit/event/notification
  tables; **LIST** for categorical keys (region, mineral type); **HASH** (modulus/
  remainder) to spread tenants evenly when counts grow unpredictably.
- **Partition pruning** is the payoff: a `WHERE` on the partition key makes the planner
  scan only relevant partitions. `enable_partition_pruning = on` (default). Two phases:
  **plan-time** ("Subplans Removed") and **execution-time** ("never executed") for
  params/subqueries.
- **Hard constraints (these bite multi-tenant designs):**
  - A PRIMARY KEY / UNIQUE constraint **must include all partition-key columns** — so a
    table partitioned by `tenant_id` needs `(tenant_id, id)` as PK; there is **no global
    unique index across partitions** (uniqueness is per-partition only).
  - Indexes on a partitioned table are **sets of local indexes**, one per partition.
  - `BEFORE ROW INSERT` triggers can't change the destination partition.
- **Maintenance:** `ATTACH`/`DETACH PARTITION CONCURRENTLY` (SHARE UPDATE EXCLUSIVE lock)
  for low-lock rollovers; `DROP TABLE partition` is instant (no per-row delete) — ideal
  for retention.
- **Partition count guidance:** planner handles "up to a few thousand partitions fairly
  well, *provided* typical queries prune to a small number." Too many partitions → long
  planning time + memory; too few → giant indexes. OLAP tolerates more partitions than
  OLTP.
([PostgreSQL 18 docs — Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html))

### 4.2 Multi-tenant partitioning patterns

- **Partition-by-`tenant_id` (LIST/HASH)** isolates tenant data and lets you move
  inactive tenants to cheaper storage; combine with RLS for defense-in-depth. A
  **partition-per-tenant** model gives strong isolation but **operational overhead** —
  you must create a partition per tenant and the partition key must be in the PK.
- For Borjie, the right default is **NOT** partition-per-tenant for thousands of tenants
  (planner overhead). Better: **time-partition the high-churn append tables**
  (`intelligence_corpus_chunks` is content; audit/event/notification/ledger-journal are
  time-series candidates) and keep tenant isolation in **RLS + a B-tree on `tenant_id`**.
  Reserve **partition-/schema-per-tenant** for a handful of **whale tenants** later.
([PlanetScale — Approaches to tenancy in Postgres](https://planetscale.com/blog/approaches-to-tenancy-in-postgres) ·
[Medium — Data Isolation & Sharding Architectures for Multi-Tenant](https://medium.com/@justhamade/data-isolation-and-sharding-architectures-for-multi-tenant-systems-20584ae2bc31) ·
[Stormatics — Improving Postgres Performance with Partitioning](https://stormatics.tech/blogs/improving-postgresql-performance-with-partitioning))

### 4.3 Horizontal sharding across machines — Citus

Citus is a Postgres **extension** (coordinator + workers) that scales out "to millions of
tenants… without re-architecting," preserving SQL/joins/FK/ACID. Two models:

| | **Row-based** (`create_distributed_table(... 'tenant_id')`) | **Schema-based** (schema-per-tenant, Citus 12) |
|---|---|---|
| Best tenant range | **100 – 1M+** tenants (B2C) | **1 – 10k** tenants (B2B, larger tenants) |
| Setup | per-table distribution; tenant_id in every PK/FK/join/WHERE | config-only (`citus.enable_schema_based_sharding`); `CREATE SCHEMA` = a shard |
| Cross-tenant | parallel cross-tenant queries | not parallel; one schema per query |
| Custom per-tenant schema | no | yes |
| Isolation | RLS | schema permissions |
| Caveats | must co-locate by tenant_id | degrades > ~10k schemas (catalog cache) |

Both support **reference tables** (small, replicated to every node — e.g. status enums,
mineral categories, FX-rate lookups) for local joins/FKs. Citus 12 auto-rebalances
schemas across nodes by disk usage, no downtime.
([Citus — Multi-Tenant Apps](https://www.citusdata.com/use-cases/multi-tenant-apps/) ·
[Citus 12 — Schema-based sharding](https://www.citusdata.com/blog/2023/07/18/citus-12-schema-based-sharding-for-postgres/) ·
[Citus 13 — Sharding a Multi-Tenant App](https://docs.citusdata.com/en/stable/articles/sharding_mt_app.html))

> **Supabase reality check:** Supabase does **not** run managed Citus today, so "shard"
> for Borjie practically means **read replicas + partitioning now**, and if we ever
> outgrow a 16XL primary, **application-level sharding** (Figma's path) or a separate
> managed Citus/Postgres cluster — not a config flag. **UNVERIFIED** whether Supabase
> offers Citus on any plan (not found in fetched sources).

### 4.4 How the giants actually did it (proof the order matters)

**Notion** — ran the monolith through "five years and four orders of magnitude of growth"
until `VACUUM` stalled and **transaction-ID-wraparound** loomed. Sharded by **Workspace
ID** into **480 logical shards across 32 physical DBs** (480 chosen because it's highly
divisible → clean rebalancing to 40/48/96 hosts). Migration = **double-write via audit
log** (logical replication couldn't keep up with `block` write volume) → **3-day backfill
on 96 CPUs** → **dark reads** verified by a *different team* than wrote the migration →
**5-minute** switchover. Result: peak CPU/IOPS dropped from ~90% to ~20%; later re-sharded
32→96 hosts. Lessons: **shard earlier**, **aim for zero-downtime**, **fold the partition
key into the PK** (`(space_id, id)`).
([Notion — Herding elephants: sharding Postgres](https://www.notion.com/blog/sharding-postgres-at-notion) ·
[Notion — The Great Re-shard](https://www.notion.com/blog/the-great-re-shard))

**Figma** — grew the DB stack **~100x since 2020** via a deliberate ladder:
**(1) vertical scaling** (AWS's largest instance) → **(2) read replicas + caching** →
**(3) vertical partitioning** (move table groups like "files"/"orgs" to their own DBs) →
**(4) horizontal sharding** (2023+). They **rejected** Cockroach/TiDB/Spanner/Vitess to
avoid migration risk, expertise loss, and the timeline crunch ("only months of runway").
They sharded on **UserID/FileID/OrgID** (hashed for even distribution), grouped related
tables into **"colos"** (co-located, same shard key, support cross-table joins +
transactions within one key), and **separated logical from physical sharding** — using
**Postgres views** (`<10%` overhead) to roll out logical routing behind feature flags
before risky physical failover. **DBProxy** (Go, between app and PgBouncer) parses SQL →
AST → logical plan → physical plan, supports **scatter-gather** for shard-key-less
queries. First table took **9 months**; first physical shard had **~10s of partial
availability**.
([Figma — How Figma's Databases Team Lived to Tell the Scale](https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/) ·
[Figma — Growing pains of database architecture](https://www.figma.com/blog/how-figma-scaled-to-multiple-databases/) ·
[pganalyze — How Figma built DBProxy](https://pganalyze.com/blog/5mins-postgres-figma-dbproxy-sharding-postgres))

**Borjie takeaway:** both companies sharded **last**, after exhausting vertical + replicas
+ vertical partitioning, and both kept Postgres + ACID. That is the template.

---

## 5. pgvector / HNSW at scale (`intelligence_corpus_chunks`)

### 5.1 HNSW mechanics + parameters

HNSW = hierarchical navigable small-world graph; probabilistically layered (~1% of points
in the top layer, ~5% in the middle), query traverses sparse→dense.
- **`m`** = max connections per node per layer. Paper range **5–48**; common start **16**;
  acceptable 2–100. Smaller `m` → faster build, better for low-recall/low-dim; bigger `m`
  → better high-recall/high-dim.
- **`ef_construction`** = build-time candidate list (must be ≥ 2× `m`). Higher → better
  graph, much longer build, diminishing returns.
- **`ef_search`** (runtime, `SET hnsw.ef_search = N;`, default 40) = accuracy/latency dial
  per query; raise for higher recall.
([Crunchy Data — HNSW indexes with Postgres and pgvector](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector) ·
[Instaclustr — pgvector performance benchmark](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/))

### 5.2 Build time, RAM, and the index-must-fit-in-RAM rule

- **The graph must fit in `maintenance_work_mem` during build** or PG falls back to a
  **disk build that's 10–50x slower** (default `maintenance_work_mem` is 64 MB — far too
  low). Crunchy: ">1M rows… 6 minutes for the simplest indexes," "1M rows of AI embeddings
  can be **8 GB or larger**," and "you'll want all of this index **in memory**."
- Scaling guidance: for **5M vectors @ 1536-dim** budget **8–16 GB** working memory; use
  **7+ parallel maintenance workers**; build time for 1M+ rows ≈ 1–2 hrs at default
  params. Track **index-to-RAM ratio**; when the index hits **~60% of RAM**, plan the next
  step (bigger compute, partition, or quantize).
- **HNSW can't be updated incrementally in the background** — frequent data change → budget
  periodic **rebuilds**.
([Crunchy Data](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector) ·
[DEV — Scaling pgvector: memory, quantization, index build](https://dev.to/philip_mcclarence_2ef9475/scaling-pgvector-memory-quantization-and-index-build-strategies-8m2) ·
[pgvector#969 — tuning maintenance_work_mem](https://github.com/pgvector/pgvector/issues/969))

### 5.3 Quantization — the biggest scale lever for Borjie's corpus

- **`halfvec`** (16-bit floats): ~**50% storage/RAM savings**, "similar search quality and
  query performance," up to 4,000 dims. Recommendation: **start with `halfvec` on day
  one** — retrofitting quantization onto 50M full-precision vectors "is painful."
- **Binary quantization** (`bit`, up to 64,000 dims): up to **67x faster HNSW build** and
  far less storage, but **recall drops** — recover it with **re-ranking** (fetch top-K by
  binary, re-score with full vectors).
- pgvector vs IVFFlat (1M vectors, probes=10, WebSearch figure): HNSW recall@10 ≈ **0.98 @
  5ms** vs IVFFlat **0.95 @ 15ms** — HNSW is the right default for low-latency recall.
([Jonathan Katz — scalar/binary quantization for pgvector](https://jkatz05.com/post/postgres/pgvector-scalar-binary-quantization/) ·
[Neon — use halfvec, save 50% storage](https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost) ·
[AWS — load embeddings up to 67x faster with pgvector + Aurora](https://aws.amazon.com/blogs/database/load-vector-embeddings-up-to-67x-faster-with-pgvector-and-amazon-aurora/))

### 5.4 Multi-tenant vector at scale (the Borjie-specific corner)

pgvector supports **table partitioning + partial indexes**, but **lacks the automatic
filtered-ANN planning** dedicated vector engines have — i.e. `WHERE tenant_id = $1 ORDER BY
embedding <-> $2` can over-scan the HNSW graph then post-filter. For Borjie this matters
because the corpus is shared (`tenant_id = NULL` ground truth) **plus** per-tenant chunks.
Mitigations: **partial HNSW indexes per high-volume tenant**, or **partition the vector
table by tenant** for whale tenants, or keep the shared corpus in one well-built HNSW and
tenant overlays in smaller per-tenant indexes. Highly selective tenant filters "may need
partitioning or partial indexes."
([ParadeDB — pgvector limitations](https://www.paradedb.com/learn/postgresql/pgvector-limitations) ·
[Neon — optimize pgvector search](https://neon.com/docs/ai/ai-vector-search-optimization))

---

## 6. Hot partitions + tenant isolation at scale (noisy neighbours)

The **noisy-neighbour** problem is "one of the most common causes of silent SLA breaches"
— one tenant's batch job (e.g. "50,000 requests per minute") can "triple every other
customer's p99 latency." Defenses, layered:
- **Resource quotas** across dimensions: **request rate** (token/leaky-bucket at the API
  gateway), **concurrency** (parallel connections — "critical for preventing connection
  pool exhaustion"), **CPU/memory** (cgroups at container level), **bandwidth/egress**.
- **Hot-partition placement**: pin hot partitions to fast nodes, park cold data on cheap
  storage while preserving replication.
- **Isolation tiers**: pooled tables w/ `tenant_id` (cheapest) → schema-per-tenant →
  **DB-per-tenant** (strongest, "reduce noisy-neighbour effects while retaining
  operational efficiency") — promote whale/regulated tenants up the ladder.
([systemdr — Designing for Noisy Neighbors](https://systemdr.systemdrd.com/p/designing-for-noisy-neighbors-multi) ·
[Neon — The noisy neighbor problem in multitenant architectures](https://neon.com/blog/noisy-neighbor-multitenant) ·
[Redis — Data isolation in multi-tenant SaaS](https://redis.io/blog/data-isolation-multi-tenant-saas/) ·
[PingCAP — Stop noisy neighbors playbook](https://www.pingcap.com/playbook-noisy-neighbor-multi-tenant-mysql/))

**Borjie controls available today:** per-tenant **rate limits** at api-gateway (already a
hard rule), `statement_timeout` / `idle_in_transaction_session_timeout` per role, a
**bounded Supavisor pool** (caps total concurrency so one tenant can't drain it), and the
option to give a whale/regulated mining estate its **own Supabase project** (DB-per-tenant
escape hatch). RLS gives *correctness* isolation; it does **not** give *performance*
isolation — quotas + pooling do.

---

## 7. Query optimization at scale (N+1, missing indexes)

- **N+1 is "the single most common performance problem"** — one parent query + one child
  query per row, usually hidden in the ORM/PostgREST embeds. The insidious case: "a query
  that takes 2ms but runs 500,000 times an hour is a bigger CPU sink than one that takes
  800ms but runs twenty times." A **nested loop over a large outer side** in the plan = N+1
  or a missing join index.
- **Find them with `pg_stat_statements`** — sort by `total_exec_time DESC` (tracks calls,
  mean time, rows, buffer hits), then run **`EXPLAIN (ANALYZE, BUFFERS)`** on the worst
  ones.
- **Missing indexes** — `pg_stat_user_tables`: large tables with high `seq_scan` counts;
  "any table over 100MB with more than 10% sequential-scan access warrants investigation."
- **Fix patterns:** add the missing join/filter index (incl. **every `tenant_id` and
  RLS column**), collapse N+1 into a single join or `IN (...)`/`ANY($array)` batch, and
  prefer PostgREST resource embedding (one round-trip) over per-row client fetches.
([Medium — Inside pg_stat_statements](https://blog.elest.io/inside-postgres-pg_stat_statements-find-slow-queries-without-an-apm/) ·
[CYBERTEC — Find and fix a missing Postgres index](https://www.cybertec-postgresql.com/en/find-and-fix-a-missing-postgresql-index/) ·
[Medium — Postgres query anti-patterns](https://medium.com/@philmcc/postgresql-query-anti-patterns-and-common-mistakes-a08636852aec))

---

## 8. The concrete Borjie scaling path: 1 instance → millions of users

A staged ladder. **Do not skip steps** — each is 5–50x cheaper than the next and the
giants prove the order.

**Stage 0 — Foundations (do now, any scale).**
- Transaction pooler **:6543** for all serverless/Expo/PostgREST/web traffic; direct
  :5432 only for migrations/admin/LISTEN.
- B-tree index on **every** `tenant_id` and RLS-referenced column.
- RLS policies: `(select current_setting('app.current_tenant_id')::uuid)` form +
  `TO authenticated`, no per-row correlated subqueries.
- `halfvec` for the vector corpus from day one; `maintenance_work_mem` sized so HNSW
  builds in RAM; 7+ parallel workers.
- `pg_stat_statements` on; weekly N+1/missing-index sweep; `statement_timeout` +
  `idle_in_transaction_session_timeout` per role.

**Stage 1 — Vertical scale + pool tuning (10k–100k users).** Bump compute (Small→Large→
XL…), set pool size by `((cores*2)+1)` active backends and the 40%/80% PostgREST rule. Add
per-tenant rate limits at api-gateway. This alone carries most SaaS for years.
([Supabase — Read Replicas vs Bigger Compute](https://supabase.com/blog/read-replicas-vs-bigger-compute))

**Stage 2 — Read replicas (read-heavy / geo / analytics).** Add replicas when reads
dominate, when EU/East-Africa latency hurts, or to isolate the AI brain's heavy
read/analytics off the primary. Route ledger-post-confirmation and audit-chain reads to
**primary** (async lag). 
([Supabase — Read Replicas](https://supabase.com/docs/guides/platform/read-replicas))

**Stage 3 — Partition the hot tables (big append tables).** RANGE-partition time-series
(audit/event/notification/ledger-journal) by month for pruning + instant retention via
`DROP`/`DETACH`. Composite PK `(tenant_id, id)` or `(partition_key, id)`. Keep partition
count in the low thousands.
([PostgreSQL docs — Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html))

**Stage 4 — Isolate whale / regulated tenants.** Promote the heaviest or most-regulated
mining estates to **schema-per-tenant** or their **own Supabase project** (DB-per-tenant)
for hard performance + compliance isolation, leaving the long tail in the shared pooled
DB. This is the pragmatic "move tenants" lever before full sharding.
([PlanetScale — Approaches to tenancy in Postgres](https://planetscale.com/blog/approaches-to-tenancy-in-postgres) ·
[Citus 12 — schema-based sharding](https://www.citusdata.com/blog/2023/07/18/citus-12-schema-based-sharding-for-postgres/))

**Stage 5 — Horizontal sharding (only past a 16XL primary on writes).** Shard by
**`tenant_id`** (Borjie's natural key — already on every tenant-scoped table per our hard
rules). Either app-level routing (Figma/Notion model: hash key, co-locate related tables,
logical→physical with views + feature flags, double-write + dark-read verification, fold
key into PK) or a managed Citus/Postgres cluster (row-based for B2C tenant counts;
schema-based for fewer larger tenants). Reference tables for shared lookups (FX rates,
mineral/status enums, the shared corpus).
([Notion — sharding Postgres](https://www.notion.com/blog/sharding-postgres-at-notion) ·
[Figma — lived to tell the scale](https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/) ·
[Citus — Multi-Tenant Apps](https://www.citusdata.com/use-cases/multi-tenant-apps/))

**When to pull each lever — quick decision rules.**
- **Pool** → immediately, and whenever active connections approach the tier cap / you see
  `too many clients`.
- **Replicate** → reads ≥ ~70–80% of load, or geo latency, or analytics contention; never
  for write bottlenecks.
- **Partition** → a single table > ~100 GB / hundreds of millions of rows, or you need
  cheap time-based retention.
- **Move/isolate tenants** → a whale tenant causes noisy-neighbour p99 spikes, or a tenant
  needs regulatory/data-residency isolation.
- **Shard** → write throughput or working-set exceeds the **16XL** primary, VACUUM/wraparound
  pressure appears, or single-table size blows past partitioning limits. (Notion's actual
  triggers: stalling VACUUM + transaction-ID-wraparound risk.)

---

## Sources (all fetched or surfaced during this research)

**Connection pooling & scalability**
- https://supabase.com/blog/supavisor-postgres-connection-pooler
- https://github.com/supabase/supavisor
- https://supabase.com/docs/guides/database/connection-management
- https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO
- https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5
- https://www.citusdata.com/blog/2020/10/08/analyzing-connection-scalability/
- https://www.citusdata.com/blog/2020/10/25/improving-postgres-connection-scalability-snapshots/
- https://pganalyze.com/blog/postgres-14-performance-monitoring
- https://www.jusdb.com/blog/postgresql-connection-pool-sizing-pgbouncer
- https://www.techinterview.org/post/3233474194/system-design-database-connection-pooling-pgbouncer-hikaricp-pool-sizing-connection-limits-idle-timeout-performance/
- https://ttb.software/2026/04/11/postgres-connection-pooling-pgbouncer-rails/
- https://dev.to/geekyfox90/postgresql-connection-pooling-with-pgbouncer-a-complete-guide-2fam
- https://dev.to/polliog/your-nodejs-app-is-probably-killing-your-postgresql-connection-pooling-explained-1db2
- https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode
- https://www.cybertec-postgresql.com/en/tuning-max_connections-in-postgresql/

**RLS performance**
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supaexplorer.com/best-practices/supabase-postgres/security-rls-performance/
- https://medium.com/@antstack/optimizing-rls-performance-with-supabase-postgres-fa4e2b6e196d
- https://makerkit.dev/blog/tutorials/supabase-rls-best-practices

**Read replicas**
- https://supabase.com/docs/guides/platform/read-replicas
- https://supabase.com/blog/introducing-read-replicas
- https://supabase.com/blog/read-replicas-vs-bigger-compute
- https://github.com/orgs/supabase/discussions/34494

**Partitioning & sharding**
- https://www.postgresql.org/docs/current/ddl-partitioning.html
- https://planetscale.com/blog/approaches-to-tenancy-in-postgres
- https://medium.com/@justhamade/data-isolation-and-sharding-architectures-for-multi-tenant-systems-20584ae2bc31
- https://stormatics.tech/blogs/improving-postgresql-performance-with-partitioning
- https://www.citusdata.com/use-cases/multi-tenant-apps/
- https://www.citusdata.com/blog/2023/07/18/citus-12-schema-based-sharding-for-postgres/
- https://docs.citusdata.com/en/stable/articles/sharding_mt_app.html
- https://www.notion.com/blog/sharding-postgres-at-notion
- https://www.notion.com/blog/the-great-re-shard
- https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/
- https://www.figma.com/blog/how-figma-scaled-to-multiple-databases/
- https://pganalyze.com/blog/5mins-postgres-figma-dbproxy-sharding-postgres

**pgvector / HNSW**
- https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector
- https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/
- https://dev.to/philip_mcclarence_2ef9475/scaling-pgvector-memory-quantization-and-index-build-strategies-8m2
- https://github.com/pgvector/pgvector/issues/969
- https://jkatz05.com/post/postgres/pgvector-scalar-binary-quantization/
- https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost
- https://aws.amazon.com/blogs/database/load-vector-embeddings-up-to-67x-faster-with-pgvector-and-amazon-aurora/
- https://www.paradedb.com/learn/postgresql/pgvector-limitations
- https://neon.com/docs/ai/ai-vector-search-optimization

**Noisy neighbours / tenant isolation**
- https://systemdr.systemdrd.com/p/designing-for-noisy-neighbors-multi
- https://neon.com/blog/noisy-neighbor-multitenant
- https://redis.io/blog/data-isolation-multi-tenant-saas/
- https://www.pingcap.com/playbook-noisy-neighbor-multi-tenant-mysql/

**Query optimization**
- https://blog.elest.io/inside-postgres-pg_stat_statements-find-slow-queries-without-an-apm/
- https://www.cybertec-postgresql.com/en/find-and-fix-a-missing-postgresql-index/
- https://medium.com/@philmcc/postgresql-query-anti-patterns-and-common-mistakes-a08636852aec
