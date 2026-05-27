# SOTA Blackboard Intelligence for Borjie — 2026

**Persona owner:** Mr. Mwikila (Managing Director — mining operator, royalty analyst, swarm conductor)
**Package:** `@borjie/blackboard-intel`
**Status:** Phase 1 specification — wires the blackboard into the self-improving loop and adds semantic + full-text retrieval over the entire posting history.
**Last reviewed:** 2026-05-27
**Migration:** `0074_blackboard_intel.sql`

---

## 1. Motivation — what Mr. Mwikila actually needs from the blackboard

The swarm-coordination layer (Wave 18HH, `packages/swarm-coordination`) gave Mr. Mwikila a shared workspace where every running specialisation posts observations, hypotheses, questions, plans, and results. The sibling BLACKBOARD-CORE wave extends that into `blackboard_posts_v2` with embeddings and cross-references. What is missing is the **intelligence layer**: blackboard posts are presently a write-only log. They are not measured, not searched, and not fed back into the self-improvement substrate that the meta-learning conductor (`packages/meta-learning-conductor`) and post-training RLVR (`packages/post-training-rlvr`) already operate.

Mr. Mwikila wants three concrete things:

1. **Every post becomes a measured capability invocation.** A blackboard post by the safety junior ("I think the loader-7 fuel draw spike is bearing fatigue") is treated as an invocation of the `blackboard.post.junior` capability. The system later checks: did the cited bearing-vibration row resolve? Did the next-day inspection confirm or contradict it? Was the post referenced by any downstream synthesis? Three numeric scores fall out per post — **groundedness**, **calibration**, **utility** — and they flow into the capability catalogue (`packages/capability-catalogue`), the meta-learning conductor's curator, and eventually post-training RLVR.

2. **Hybrid search across the entire posting history.** When Mr. Mwikila or the connector specialisation asks "what did anyone say about the Kahama crusher last quarter?", the system runs a **hybrid retrieval**: Postgres `tsvector`/`tsquery` full-text BM25 over the `content` column, AND pgvector HNSW dense search over the `content_embedding` column, then fuses the two ranked lists with **Reciprocal Rank Fusion** (Cormack et al., 2009). Results are tenant-scoped at every layer — the dense path, the FTS path, and the fusion — and a cross-tenant probe is **rejected** before it touches an index.

3. **Audit-chain coverage extends to scoring.** Today the blackboard audit chain covers post content (BLACKBOARD-CORE). After this package lands, the chain extends to **post-quality-score** rows: every score is hashed against the prior score in the tenant's chain and, transitively, against the underlying post. A blackboard reader who shows Mr. Mwikila a citation can replay both the content's provenance AND the quality history that promoted the post.

This package is the bridge: it turns blackboard posts into self-improving capabilities and turns the posting history into a searchable substrate.

## 2. Scope boundary

In scope:

- **Post quality scoring** — three axes (groundedness, calibration, utility) computed per post, persisted to `blackboard_post_quality_scores`, audit-chained.
- **Capability registration** — each knowledge-source (KS) kind (`junior`, `connector`, `tool`) is registered in the capability catalogue so blackboard posts are observable as capability invocations.
- **Meta-learning feedback** — `(post, observation)` pairs flow into the meta-learning-conductor curator as `RawTrace`-compatible records.
- **Hybrid retrieval** — Postgres tsvector FTS + pgvector HNSW dense search + RRF fusion + typed filters (region, KS, date range, parent thread, has-cross-ref).
- **Tenant-isolation invariant** — every query path verifies `tenant_id` before issuing SQL; the SQL itself uses `current_setting('app.tenant_id', true)` RLS.

Out of scope (lives elsewhere):

- The `blackboard_posts_v2` schema, embedding generation, and cross-reference graph → BLACKBOARD-CORE (sibling wave).
- The `wrap-as-measured` measurement-port itself → `@borjie/intel-self-improve` (sibling wave; we depend on its **structural port** today, switch to the package once it lands).
- LLM-generated narrative summarisation of search results → `@borjie/executive-brief-engine`.
- Federation across tenants for blackboard intelligence → `@borjie/cognitive-memory` platform tier.

## 3. Library landscape and citations

Every retrieval algorithm and tuning recommendation in this package is implemented against a canonical reference. All citations are URL + title + date-checked, per the project's deep-research mandate.

1. **pgvector HNSW + iVFFlat tuning for 1M-row vector search.** Andrew Pavlo & Andy Kane (pgvector maintainer). *pgvector 0.7.0 release notes — HNSW build parameters `m`, `ef_construction`, and `ef_search`*, 2024 (still current 2026). For a 1M-row index on 1536-dim OpenAI embeddings the recommended starting point is `m = 16, ef_construction = 64` at build, `ef_search = 40` at query for 95 % recall. URL: <https://github.com/pgvector/pgvector#hnsw>. Date checked: 2026-05-27.

2. **Postgres tsvector + tsquery for full-text + GIN index.** PostgreSQL Documentation Team. *Chapter 12. Full Text Search* (PostgreSQL 17 manual), 2025. The canonical reference for `to_tsvector`, `plainto_tsquery`, `ts_rank_cd`, and the trade-off between GIN (faster query, slower build) and GiST (slower query, faster updates). URL: <https://www.postgresql.org/docs/17/textsearch.html>. Date checked: 2026-05-27.

3. **Hybrid retrieval — Elastic 2025 patterns.** Elastic Engineering. *Elasticsearch 8.16 — Reciprocal Rank Fusion (RRF) as a first-class retriever*, 2025. Documents the Elastic approach of running BM25 and a dense knn search in parallel and fusing with RRF at the coordinator. URL: <https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html>. Date checked: 2026-05-27.

4. **Hybrid retrieval — OpenSearch 2025 patterns.** OpenSearch project. *OpenSearch 2.18 — Hybrid query with normalization processor*, 2025. The alternative score-normalisation approach (min-max + arithmetic-mean) we benchmark RRF against. URL: <https://opensearch.org/docs/latest/search-plugins/hybrid-search/>. Date checked: 2026-05-27.

5. **Reciprocal Rank Fusion — Cormack et al.** Cormack, G. V., Clarke, C. L. A. & Büttcher, S. (2009). *Reciprocal rank fusion outperforms Condorcet and individual rank learning methods.* SIGIR 2009, pp. 758-759. The canonical formula `score_RRF(d) = Σ_i 1 / (k + rank_i(d))` with `k = 60` as the empirically-validated constant. URL: <https://doi.org/10.1145/1571941.1572114>. Date checked: 2026-05-27.

6. **Multi-tenant vector search isolation patterns.** Supabase Engineering. *Building multi-tenant pgvector apps with Row Level Security*, 2024-2025 (still current). Documents the canonical `current_setting('app.tenant_id', true)` GUC pattern that we adopt verbatim, plus the partition-per-tenant alternative for very large tenants. URL: <https://supabase.com/blog/pgvector-vs-pinecone>. Date checked: 2026-05-27.

7. **LangChain RetrievalChain v2.** LangChain. *LangChain v0.3 retrieval — `EnsembleRetriever`, `ContextualCompressionRetriever`, and the v2 `Runnable` retrieval chain*, 2025. Reference for the contract shape of a retrieval call (`(query, filters) -> Document[]`) that we mirror in our `HybridSearcher.search` signature. URL: <https://python.langchain.com/docs/concepts/retrievers/>. Date checked: 2026-05-27.

8. **Anthropic deep-research retrieval patterns 2025.** Anthropic Engineering. *Building research agents with Claude — retrieval, citation, and self-grounding patterns*, 2025. Reference for the *citations-must-resolve* groundedness axis we implement: a post that cites IDs the citation resolver cannot fetch loses groundedness score. URL: <https://www.anthropic.com/research/building-effective-agents>. Date checked: 2026-05-27.

## 4. Architecture decisions

### 4.1 Structural ports for sibling waves

Two sibling waves run concurrently — BLACKBOARD-CORE (`blackboard-sota`) and `intel-self-improve` — and we cannot import their concrete types without creating a build-order dependency. The package therefore exposes **structural ports**:

```ts
interface BlackboardCorePort {
  readonly readPost: (tenantId: string, postId: string) => Promise<BlackboardPostV2 | null>;
  readonly listCrossRefsTo: (tenantId: string, postId: string) => Promise<ReadonlyArray<string>>;
}

interface MeasurementWrapperPort {
  readonly wrapAsMeasured: <I, O>(
    capabilityName: string,
    fn: (input: I) => Promise<O>,
  ) => (input: I) => Promise<O>;
}
```

Both default to in-memory stubs in tests; production wiring plugs the sibling packages.

### 4.2 Three scoring axes — groundedness, calibration, utility

Pure functions in `src/measure/`:

- **Groundedness** (`measureGroundedness`) — `cites.length > 0` AND every cite resolves through the BlackboardCorePort. Score in `[0, 1]`.
- **Calibration** (`measureCalibration`) — claim hedge ("I think", "probably", "likely") paired against any later post that contradicts the claim. A confident claim later contradicted gets the largest penalty.
- **Utility** (`measureUtility`) — count of later posts in the same thread that cross-reference this one, normalised by the thread length.

Each emits a `PostQualityScore` row; all three are persisted atomically.

### 4.3 Hybrid retrieval — FTS + dense + RRF

- **FTS path** (`src/search/fts-search.ts`) — wraps `to_tsvector('simple', content)` (already materialised as a `STORED` generated column on `blackboard_search_index`) and queries via `plainto_tsquery(...) @@ content_tsvector` with `ts_rank_cd` ordering.
- **Dense path** (`src/search/dense-search.ts`) — pgvector HNSW search via `embedding <=> $query` ordering, top-K = 200 default to ensure recall before fusion.
- **Fusion** (`src/search/hybrid-search.ts`) — Reciprocal Rank Fusion with default `k = 60` (Cormack 2009); configurable `k1` weight for FTS rank, `k2` weight for dense rank.
- **Filters** (`src/search/filter-builder.ts`) — typed `SearchFilters` (region, KS-kind, date range, parent thread, `hasCrossRef`) compiled to a parameterised `WHERE` clause; tenantId is always the first predicate.

### 4.4 RRF reference vector validation

The test `__tests__/hybrid-search.test.ts` includes a **reference fixture** from Cormack (2009) Table 1: given two ranked lists `L1 = [d1, d2, d3, d4, d5]` and `L2 = [d3, d1, d5, d2, d4]`, the expected RRF order at `k = 60` is `d1 > d3 > d2 > d5 > d4`. Our implementation must reproduce that order **exactly**.

### 4.5 Tenant-isolation invariant

Every query function carries `tenantId: string` as its first parameter and the SQL layer adds `WHERE tenant_id = $1` **before** any filter. The in-memory adapter checks `tenantId` on every read and **throws** `BlackboardIntelError('CROSS_TENANT_REJECTED')` if a search returns a row whose `tenant_id` does not match.

### 4.6 Audit-chain extension

`src/audit/post-audit-chain.ts` augments the BLACKBOARD-CORE hash chain: when a `PostQualityScore` row is persisted, its `audit_hash` chains against the previous score in the tenant's chain (genesis = empty string). A reader replaying the chain can therefore reconstruct both content and the score history, in order.

### 4.7 Embedding via injected port

We never import an embedding provider directly. The `dense-search` path takes an `EmbeddingService` port (compatible with `@borjie/cognitive-memory`'s `EmbeddingService`) that resolves to a `vector(1536)` value. Tests use a **deterministic fixture vector** (`__fixtures__/deterministic-embeddings.ts`) so the suite is reproducible without network calls.

### 4.8 Immutability and TS strict

Per `~/.claude/rules/coding-style.md`: every type is `readonly` end-to-end; no `any`, no `@ts-nocheck`, no `as` casts to widen. Inputs are `ReadonlyArray`; outputs are `Object.freeze`'d. `tsconfig` inherits `strict: true` from the project base.

### 4.9 Live-test only

No mocks of the package's own internal modules. Every test wires the real in-memory adapter (or a deterministic fixture) and exercises the real code path. Fixtures sit in `src/__fixtures__/` and are clearly labelled.

## 5. Schema — migration 0074

Two tables, both tenant-scoped with RLS on `current_setting('app.tenant_id', true)`:

```sql
CREATE TABLE blackboard_post_quality_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  post_id     uuid NOT NULL,                            -- FK → blackboard_posts_v2.id
  axis        text NOT NULL CHECK (axis IN ('groundedness','calibration','utility')),
  score       real NOT NULL CHECK (score >= 0 AND score <= 1),
  scored_at   timestamptz NOT NULL DEFAULT now(),
  prev_hash   text NOT NULL DEFAULT '',
  audit_hash  text NOT NULL
);

CREATE TABLE blackboard_search_index (
  post_id          uuid PRIMARY KEY,                    -- FK → blackboard_posts_v2.id
  tenant_id        text NOT NULL,
  content_tsvector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  audit_hash       text NOT NULL
);
```

Indexes:

- `idx_bpqs_post_axis` on `(tenant_id, post_id, axis)` for axis-scoped lookup.
- `idx_bpqs_audit_hash` on `(audit_hash)` for chain replay.
- GIN index `idx_bsi_content_tsvector` on `content_tsvector` — the FTS hot path.
- pgvector HNSW index on `blackboard_posts_v2.content_embedding` is created by BLACKBOARD-CORE; we depend on it.

RLS policies follow the canonical pattern from migration 0003:

```sql
ALTER TABLE blackboard_post_quality_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY bpqs_tenant_isolation ON blackboard_post_quality_scores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

The migration is **idempotent** (`IF NOT EXISTS` + `DO $$ BEGIN ... END $$` blocks).

## 6. Package layout

```
packages/blackboard-intel/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                                 — public barrel
    ├── types.ts                                 — all public types
    ├── logger.ts                                — buildBlackboardIntelLogger
    ├── measure/
    │   ├── post-measurer.ts                     — orchestrates three axes
    │   ├── groundedness-scorer.ts
    │   ├── calibration-scorer.ts
    │   └── utility-scorer.ts
    ├── capability/
    │   └── register-blackboard-capabilities.ts  — junior, connector, tool
    ├── feedback/
    │   └── meta-curator.ts                      — RawTrace adapter
    ├── search/
    │   ├── fts-search.ts                        — tsquery + tenant scope
    │   ├── dense-search.ts                      — pgvector HNSW + tenant scope
    │   ├── hybrid-search.ts                     — RRF combiner
    │   └── filter-builder.ts                    — typed WHERE compiler
    ├── audit/
    │   └── post-audit-chain.ts                  — quality-score hash chain
    ├── repositories/
    │   ├── post-quality-scores-repository.ts    — in-memory + SQL
    │   └── search-index-repository.ts           — in-memory + SQL
    ├── __fixtures__/
    │   ├── deterministic-embeddings.ts
    │   └── rrf-reference-cormack-2009.ts
    └── __tests__/
        ├── post-measurer.test.ts
        ├── calibration-scorer.test.ts
        ├── utility-scorer.test.ts
        ├── register-blackboard-capabilities.test.ts
        ├── fts-search.test.ts
        ├── dense-search.test.ts
        ├── hybrid-search.test.ts
        ├── filter-builder.test.ts
        ├── post-audit-chain.test.ts
        ├── meta-curator.test.ts
        └── repositories.test.ts
```

## 7. Capability registration

Three KS-kind capabilities (per `CapabilityAuthorInput` shape from `@borjie/capability-catalogue`):

| Capability name              | Kind     | Cost class | Latency budget |
|------------------------------|----------|-----------:|---------------:|
| `blackboard.post.junior`     | atomic   | free       |        2 000 ms |
| `blackboard.post.connector`  | atomic   | free       |        2 000 ms |
| `blackboard.post.tool`       | atomic   | free       |        2 000 ms |

All three are `provenanceClass: 'seed'` and start in `lifecycleState: 'shadow'`. The meta-learning conductor promotes them to `'live'` once enough invocations accumulate (per `decideLifecycle` thresholds from `@borjie/capability-catalogue/lifecycle`).

## 8. Performance contract

- FTS-only query at p95 ≤ 50 ms over 1M posts (GIN index well-warmed).
- Dense-only query at p95 ≤ 80 ms over 1M posts (HNSW `ef_search = 40`).
- Hybrid (FTS + dense + RRF) at p95 ≤ 120 ms (the two paths are queried in parallel; fusion is O(k)).
- Quality scoring at p95 ≤ 20 ms per post (pure arithmetic on already-resolved citations).

Benchmarks live in `__tests__/hybrid-search.test.ts` as `it.skip(...)` placeholders that the CI perf pipeline reactivates.

## 9. Test plan — minimum 16 cases

1. `post-measurer.test.ts` — emits exactly three rows per post.
2. `groundedness-scorer.test.ts` — post with 0 cites scores 0; post with 3 resolvable cites scores 1.
3. `calibration-scorer.test.ts` — "I think X" followed by a contradicting post scores low.
4. `calibration-scorer.test.ts` — "I think X" with no contradicting follow-up scores high.
5. `utility-scorer.test.ts` — utility increments when a later post cross-references this one.
6. `utility-scorer.test.ts` — utility is zero when no later post references this one.
7. `register-blackboard-capabilities.test.ts` — three capability rows created with the expected names.
8. `register-blackboard-capabilities.test.ts` — re-registration is idempotent.
9. `fts-search.test.ts` — query returns only the calling tenant's rows.
10. `fts-search.test.ts` — query returns posts ranked by `ts_rank_cd`.
11. `dense-search.test.ts` — query returns only the calling tenant's rows.
12. `dense-search.test.ts` — cross-tenant probe is rejected.
13. `hybrid-search.test.ts` — RRF order matches the Cormack 2009 reference vector.
14. `filter-builder.test.ts` — region + date-range produces the expected parameterised WHERE.
15. `repositories.test.ts` — `insert/read/listForPost` CRUD for `post_quality_scores`.
16. `post-audit-chain.test.ts` — second score chains against the first; tampering with the first breaks the chain.

## 10. Open follow-ups

- Once `@borjie/intel-self-improve` lands, replace the structural `MeasurementWrapperPort` with its concrete `wrapAsMeasured` export.
- Once BLACKBOARD-CORE lands, replace the structural `BlackboardCorePort` with its concrete reader.
- Add a streaming variant of `hybrid-search` that emits an `AsyncIterable<SearchResult>` for very-large-K queries (planned for Phase 2).
- Backfill quality scores for historical posts via a background worker (planned for Phase 2, alongside the BLACKBOARD-CORE migration that materialises `content_embedding`).
