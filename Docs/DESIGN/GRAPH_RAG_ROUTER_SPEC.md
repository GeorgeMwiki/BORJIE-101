# GraphRAG Router — Design Specification

> Wave 18BB / retrieval-substrate framing — the spec that closes the
> founder-flagged P0 gap: "GraphRAG hierarchical retrieval is not the
> default — `knowledge-graph` exists but everything routes through
> pgvector; no community summaries."
>
> **Cross-links:** `UNIFIED_COGNITIVE_MEMORY_SPEC.md` (18AA),
> `COGNITIVE_ENGINE_SPEC.md` (18T), `MEMORY_AMNESIA_PREVENTION_SOTA.md`
> (18GG), `INFORMATION_SYNTHESIS_SOTA_SPEC.md`.

---

## 1. The Problem

Today every retrieval path in BORJIE — Mr. Mwikila's recall, junior
research, classroom Q&A, document RAG, memory cell recall — funnels
through pgvector. The pattern is uniform: embed the query, ANN-search
the corpus, return the top-K most-similar chunks.

pgvector is excellent at one thing: surfacing chunks whose embedding
sits closest to the query embedding in cosine-space. That works when
the answer is **contained inside a single chunk**.

It breaks down in three recurring shapes of question Mr. Mwikila must
answer every day:

1. **Multi-hop relationships.** "Which agents that report into the
   Geita district MD have flagged ore-grade anomalies the same week
   that FX-Treasury executed a hedge against TZS?" The answer is not
   sitting in any single chunk — it sits in the *joins* between
   chunks. Vector similarity has no concept of *joins*.
2. **Holistic / aggregate questions.** "What are the dominant themes
   across this quarter's research turns?" Top-K chunk retrieval will
   return ten chunks that look similar to the word "themes" — it
   cannot summarise the whole corpus.
3. **Structured navigation.** "Show me everything connected to the
   Buyer-X negotiation cluster." Vector similarity returns chunks
   that *mention* Buyer-X — not chunks that are *structurally
   linked* to Buyer-X via signed contracts, prior bids, or staff
   assignments.

`packages/knowledge-graph` already extracts entities and edges, so
the raw graph substrate exists. What is missing is (a) **Microsoft
GraphRAG-style hierarchical community summaries**, and (b) a
**router** in front of every retrieval call that decides — per query —
whether pgvector, the graph, or a hybrid is the correct backend.
Without this, the graph is a museum piece and pgvector carries
queries it is structurally incapable of answering.

---

## 2. The GraphRAG Model (what we adopt)

We adopt Microsoft's GraphRAG hierarchical retrieval pattern (Edge
et al. 2024; reinforced by LightRAG dual-level retrieval in EMNLP
2025 and Leiden-based community detection in the canonical pipeline).
The model is a four-stage offline build plus a per-query routing
decision:

**Stage A — Entity & relation extraction.** An LLM scans each chunk
and emits `{name, type, description}` entities and `{from, to, kind,
description}` relations. De-duplication merges co-referent entities
across chunks (case-insensitive name match + LLM-disambiguated
near-matches).

**Stage B — Graph construction.** Entities become nodes; relations
become typed edges. Nodes accumulate descriptions from every chunk
that mentions them (LLM-summarised when descriptions diverge).
This is the substrate `packages/knowledge-graph` already covers.

**Stage C — Community detection.** We run the **Leiden algorithm**
over the graph to detect *hierarchical* clusters of densely-connected
entities. Leiden is the canonical choice (it guarantees well-connected
communities, unlike Louvain) and produces a tree: Level 0 = finest
clusters, Level 1 = aggregates of Level 0, etc. We use
`graphology-communities-louvain` as the runtime dependency (Louvain is
acceptable for v1; the port to true Leiden via `graphology-communities-leiden`
is a Phase-2 swap behind the same interface).

**Stage D — Community summarisation.** For each community, an LLM
ingests `{entities, relations, source-chunk-snippets}` and emits a
2–5 paragraph summary. These summaries are *the* hierarchical index
into the corpus. Microsoft's research and the LazyGraphRAG follow-up
both confirm: summaries are expensive to generate but cheap to query,
and precomputing them at corpus-build time pays off in every later
retrieval.

The four stages are **batch / offline** work. They belong on the
sleep-pass orchestrator (§4). Inference-time retrieval reads, never
writes, the graph and the summary store.

---

## 3. The Router Contract

The router sits in front of every retrieval call. Its single job:
**classify the query, pick the backend, return chunks**. It does not
itself call an LLM for generation — it only chooses *what to feed* an
LLM.

```typescript
export type RetrievalMode = 'vector' | 'graph_local' | 'graph_global' | 'hybrid';

export interface RouteDecision {
  readonly mode: RetrievalMode;
  readonly reason: string;        // human-auditable
  readonly confidence: number;    // 0..1
}

export interface RouterPort {
  classify(query: string, ctx: QueryContext): RouteDecision;
  retrieve(
    query: string,
    decision: RouteDecision,
    ctx: QueryContext,
  ): Promise<RetrievedChunk[]>;
}
```

`classify` is a fast, deterministic heuristic — no LLM call in the
hot path. It scores the query along four axes:

| Axis | Signal | Backend bias |
|------|--------|--------------|
| **Entity-name density** | Number of detected named entities | high → graph |
| **Relational keywords** | "between", "vs", "connected to", "reports to" | high → graph |
| **Aggregation keywords** | "summarise", "themes", "across", "overall" | high → graph_global |
| **Specificity** | Long quote spans, exact phrases, numbers | high → vector |

Decision matrix (deliberately simple):

- **vector** — default; high specificity, low entity density.
- **graph_local** — high entity density, low aggregation. Fan-out
  from named entities, then pull connected sub-graph.
- **graph_global** — high aggregation keywords. Read community
  summaries top-down (start at root community, descend on relevance).
- **hybrid** — neither dominant. Run vector and graph_local in
  parallel; merge with reciprocal-rank fusion (k=60).

The matrix is encoded in `query-classifier.ts` as pure thresholds
(no LLM). An LLM-assisted upgrade path (calibrated softmax over the
four axes) is documented but not v1.

---

## 4. Sleep-Pass: Community Summary Generation

Community summaries are expensive (one LLM call per community, plus
re-summarisation when the underlying graph drifts). They belong on
the nightly sleep-pass orchestrator, not on the hot path.

`services/sleep-pass-orchestrator/src/passes/graph-rag-community-summaries.ts`
implements `createGraphRAGCommunitySummariesPass`. The pass:

1. Walks every tenant's `knowledge_graph_entities` + `knowledge_graph_relations`
   tables via the injected `GraphRAGAdapter`.
2. Builds an in-memory graph (per tenant).
3. Runs Louvain/Leiden community detection (lightweight implementation).
4. For each community whose `signature_hash` (sha256 of node-id set)
   has changed since the previous run, calls the injected
   `summariseCommunity(entities, relations) → string` LLM port.
5. Writes the new summary into `kg_community_summaries` with a fresh
   `signature_hash` so the next run can detect drift cheaply.
6. Emits a chain-of-audit row via `@borjie/audit-hash-chain`.

The pass is **idempotent**: re-running on an unchanged graph re-uses
all existing summaries (signature-hash short-circuit). It is
**time-boxed** by the orchestrator's `AbortController` — partial
progress is durable because each community summary is written
independently. It is **tenant-scoped**: every read and write sets the
`app.tenant_id` GUC before touching the row-level-security tables.

Schedule: `daily` at 03:30 (off-peak in EAT), priority 3, max
duration 30 min per tenant, min interval 18 h.

---

## 5. Schema

Migration `00NN_graph_rag.sql` adds four tables. All are
tenant-scoped, RLS-enabled via the canonical `app.tenant_id` GUC
policy from migration 0003.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `knowledge_graph_entities` | One row per de-duped entity in the corpus graph. | `id`, `tenant_id`, `name`, `type`, `description`, `embedding vector(1536)`, `mention_count`, `source_chunk_ids text[]`, `audit_hash` |
| `knowledge_graph_relations` | One row per typed edge between two entities. | `id`, `tenant_id`, `from_entity_id`, `to_entity_id`, `kind`, `description`, `weight`, `source_chunk_ids text[]`, `audit_hash` |
| `kg_communities` | One row per community detected at any hierarchy level. | `id`, `tenant_id`, `level`, `parent_community_id`, `member_entity_ids text[]`, `signature_hash`, `detected_at`, `audit_hash` |
| `kg_community_summaries` | LLM-generated summary per community version. | `id`, `tenant_id`, `community_id`, `summary_md`, `model_id`, `token_count`, `signature_hash`, `generated_at`, `audit_hash` |

Indexes: HNSW on `knowledge_graph_entities.embedding`; B-tree on
`(tenant_id, name)` for entity lookup; B-tree on
`knowledge_graph_relations.(tenant_id, from_entity_id)` and the
reverse; B-tree on `kg_communities.(tenant_id, level)`; B-tree on
`kg_community_summaries.(tenant_id, community_id, generated_at DESC)`.

Foreign keys: `knowledge_graph_relations.from_entity_id` →
`knowledge_graph_entities.id` (ON DELETE CASCADE); same for `to_`.
`kg_communities.parent_community_id` → `kg_communities.id`
(ON DELETE SET NULL). `kg_community_summaries.community_id` →
`kg_communities.id` (ON DELETE CASCADE).

---

## 6. Anti-Patterns (what NOT to do)

1. **Do not bypass the router.** Every retrieval call goes through
   `RouterPort.retrieve`. No callers reach into pgvector or the graph
   directly. The router is the single seam where vector / graph /
   hybrid decisions are auditable.
2. **Do not regenerate community summaries on every query.** The
   sleep-pass is the only writer of `kg_community_summaries`. Hot-path
   readers consume cached summaries.
3. **Do not skip the signature-hash check.** Re-summarising an
   unchanged community burns LLM tokens for zero new information.
4. **Do not let graph traversal exceed two hops on the hot path.**
   Production hybrid systems consistently report graph-traversal
   latency as the #1 incident driver. We cap at 2 hops and 50 nodes
   per query; deeper traversals are sleep-pass-only.
5. **Do not extract entities synchronously on user input.** Entity
   extraction is part of the nightly corpus build, not the per-query
   path.
6. **Do not collapse `graph_local` and `graph_global` into one
   "graph" mode.** They have fundamentally different cost profiles
   (fan-out from N entities vs. read M community summaries) and
   different quality characteristics. The router must distinguish.

---

## 7. Phase-2 Integration with Cognitive Engine D5

`COGNITIVE_ENGINE_SPEC.md` defines a Discipline-5 ("relevance
pruning") step where the cognitive loop must prune the candidate
inventory before dispatch. Today D5 is a no-op (`cognitive-loop.ts`
line 161: "Discipline 5 — relevance pruning happens implicitly in
the candidate list (caller pre-pruned)").

In Phase 2 the GraphRAG router becomes D5's pruning oracle:

1. Cognitive loop assembles candidate memory cells via
   `cognitive-memory.recall(query)`.
2. Loop calls `routerPort.classify(query, ctx)`.
3. If decision is `graph_local` or `graph_global`, the loop walks
   the graph from each candidate cell's entity links and *adds* the
   one-hop neighbourhood to the candidate set before D5 prunes.
4. D5 then ranks the expanded candidate set by graph centrality +
   cosine similarity + recency, and prunes to top-N.

This unlocks Mr. Mwikila's cross-specialisation reasoning: a Geology
discovery linked via shared entities to a Marketplace memory cell is
visible at decision time, not lost in the cosine gap.

The router's `classify` is also the entry hook for the
`@borjie/brain-llm-router` cost meter — graph queries are cheaper
than vector queries on holistic questions (community summary lookup
is O(log N) vs. O(N) chunk scan), and the cost meter records that.

---

## 8. Audit & Provenance

Every row in all four tables carries an `audit_hash` produced via
`@borjie/audit-hash-chain.hashChainEntry`. The hash covers
`{tenantId, table, rowKey, payload}` so any tampering with entity
descriptions, relations, or community summaries is detectable on the
nightly `audit-chain-verify` sleep pass.

Community-summary regeneration writes a new row (never updates
in-place) so the historical summary chain is preserved — useful for
A/B comparison of summarisation prompts and for reproducing a query
result that depended on yesterday's summary.

---

## 9. Out of Scope (v1)

- True Leiden (we ship Louvain; Leiden is a one-line dependency swap).
- Cross-tenant federated communities.
- LLM-driven entity reconciliation across languages (English-only v1).
- LazyGraphRAG-style lazy community materialisation (v2 candidate).
- Graph visualisation surfaces — `packages/knowledge-graph/src/viz`
  remains the surface for that; the router does not render.

---

## 10. Sources

- Edge et al., *From Local to Global: A GraphRAG Approach to Query-Focused Summarization* (arXiv 2404.16130).
- Microsoft Research, *GraphRAG: Improving global search via dynamic community selection*.
- HKUDS, *LightRAG: Simple and Fast Retrieval-Augmented Generation* (EMNLP 2025).
- `gusye1234/nano-graphrag` — the simple, hackable GraphRAG implementation.
- Traag, Waltman, van Eck (2019), *From Louvain to Leiden: guaranteeing well-connected communities*.
- *LLM-guided Hierarchical Retrieval* (arXiv 2510.13217) — LATTICE framework.
- *Hybrid Vector-Graph Retrieval Patterns* — production lessons.

---

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
