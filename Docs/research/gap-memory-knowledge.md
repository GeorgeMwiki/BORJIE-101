# Gap Dossier — MEMORY & KNOWLEDGE & CONTINUAL LEARNING

**Date:** 2026-06-08
**Dimension:** Memory · Knowledge · Continual Learning
**Method:** Code-grounded audit of `packages/` + `services/` (Borjie repo
primary; BossNyumba `BOSSNYUMBA101` cross-referenced) against the existing
SOTA dossiers in `Docs/research/`. Every gap below cites a file:line, a
schema, or a spec section. No hand-waving — if it is a gap, it has a lane.
**Scorer:** honest 0–5 vs the domain-AGI target.

> **AGI target (the bar we score against):** an MD whose knowledge is
> **unbounded, always-current, PhD-depth** across the whole mandate
> (mining-estate, real-estate, construction, ESG, machinery,
> finance/tax/law) **and adjacent domains without bound**; **durable
> compounding memory** that survives restarts and accumulates across
> sessions/tenants/people; **non-parametric continual learning** (grow the
> graph, freeze the model) with **no catastrophic forgetting**; a
> closed-loop **curiosity clock** that detects its own gaps and goes learn.
> Source bar: `knowledge-continuous-acquisition-sota.md` §0,§9,§11,§15;
> `frontier-compounding-knowledge-and-trust.md`.

---

## 0. Verdict

**Current level: 2.4 / 5. AGI target: 5.**

Borjie has built **~70% of the SOTA skeleton on disk** — 4 kernel-memory
substrates, a 6-layer memory-v2, cognitive-memory cells, persistent-memory,
a bi-temporal KG package, PROV-O provenance, GraphRAG (community/expand/
answer), a graph-rag-router, a 9-stage consolidation pipeline, a deep-
research orchestrator with 5 modes, a sleep-pass orchestrator, and a
person-spanning personal-KB. This is a genuinely strong foundation and the
2026-05-27 cognitive-infra audit is now **partly stale in Borjie's favour**:
`cognitive-memory` + `persistent-memory` are now wired into the live
`/turn` read path (`brain.hono.ts:645`), and person-spanning memory now
exists (`persons.schema.ts`, `personal-memory.schema.ts`,
`person-context.ts`).

But the gap to AGI is **wiring, durability, and the learning loop**, not
absence of code:

1. **The richest memory tiers are volatile or write-dead.** `memory-v2`
   (the 6-layer substrate) is **in-memory only** (no Drizzle store exists),
   so it is wiped on every gateway restart. `cognitive_memory_cells` has a
   live **recall** path but **no live `observe()` writer** anywhere in
   `services/` — the store is read-only-over-empty unless seeded elsewhere.
   `persistent_memory_session` recall is wired but **no live
   `createSessionMemoryUpsert` writer** exists. The personal-KB route is
   **read-only** (no INSERT into `personal_memory_cells`).
2. **The corpus is one-shot, manual, markdown-only, points at a dead
   path.** `DEFAULT_MINING_CORPUS_PATH` is a stale local-disk path
   (`brain-kernel-wiring.ts:131`); ingest is a CLI never wired into the
   scheduled worker; chunking is `splitByH2` (no layout/tables/figures);
   dedup is exact-key SHA-256 only.
3. **The KG is heuristic, not the continual-learning substrate.** Gateway
   ingest does substring `mentions` linking with **no LLM entity/relation
   extraction, no temporal stamps, no provenance** — even though the
   `temporal/bi-temporal.ts` and `provenance/prov-o.ts` modules are built
   and sitting unused. No incremental Leiden, no global GraphRAG search on
   the hot path.
4. **No curiosity clock.** Nothing detects "I lack a node" and enqueues
   acquisition. Continuous-watch is operator-configured thresholds only.
5. **The self-improvement loop is mostly dark.** `meta-learning-conductor`,
   `intel-self-improve`, `language-self-improve`, `learning-signal-emitter`,
   `tacit-knowledge`, `graph-database` are **built-but-unwired** (zero
   `services/` call sites). The consolidation worker runs a **stub
   consolidator** (1 fact / 5 turns, `consolidation.ts:133`), not the real
   Haiku consolidator, on the default path.
6. **Embedding spaces are inconsistent.** Corpus = OpenAI
   `text-embedding-3-large`@1024; cognitive/semantic/skills = `-3-small`@1536.
   The KG ingest copies the 1024-d corpus vector into `kg_nodes.embedding`,
   mixing spaces — cross-store ANN is incoherent.

This is a "lights are built but half are off, and the on ones leak" state.
The model is frozen (correct, per §11) but the non-parametric substrate
that is supposed to carry continual learning is **not durably accumulating**.

---

## 1. What is REAL and live (give credit)

| Capability | Evidence | Status |
|---|---|---|
| Per-turn semantic recall mirror | `kernel_memory_semantic` (vector 1536, `<=>` cosine); written by `conversation-memory-drizzle-adapter` every turn; read at kernel step 4 | LIVE |
| Cognitive-memory **recall** on `/turn` | `brain.hono.ts:624-645` reads `c.get('cognitive')` → `enrichBrainTurnWithCognitive`; cells Drizzle-backed when DB present (`cognitive-wiring.ts:364`) | LIVE (read only) |
| Corpus vector search at turn time | `chat-corpus-evidence.ts` — OpenAI `text-embedding-3-large` truncated to 1024-d, `ORDER BY embedding <-> $1`, keyword-OR fallback | LIVE |
| Consolidation reservoir → semantic facts | `consolidation-worker/src/consolidation.ts`; cron `k8s/consolidation-worker-cron.yaml` `0 2 * * *` | LIVE (stub consolidator) |
| 8-stage sleep cascade (skills loop) | `consolidation-worker/src/index.ts:684-742`; stage 04-promote → `skill_registry` (pgvector 1536), read by sovereign kernel | LIVE |
| Confidence decay | `stages/05-decay.ts`, `semantic.decay()` 0.995/day (mig 0121) | LIVE |
| Person-spanning memory substrate | `persons.schema.ts`, `personal-memory.schema.ts`, `person-context.ts`, `me-tenants.hono.ts`, `personal-kb.hono.ts` (read) | PARTIAL (read only, consent-gated) |
| Deep-research orchestrator | 5 modes (`research-orchestrator/src/modes/*`), 2 crons, scorer/synthesizer | LIVE (operator-driven) |
| Bi-temporal + PROV-O packages | `knowledge-graph/src/temporal/bi-temporal.ts`, `provenance/prov-o.ts` | BUILT, UNUSED by ingest |

---

## 2. Gaps (every one has a lane)

See the structured `gaps[]` for the machine-readable list. Narrative below.

### 2.1 Durability gaps (memory does not compound across restarts)

- **memory-v2 is in-memory only.** Every store under
  `packages/memory-v2/src/*/store-inmemory.ts`; there is **no
  `*-drizzle.ts` / `*-postgres.ts`**. Wired as `createInMemoryMemoryV2`
  (`service-registry.ts:474`). The "six-layer cognitive memory" (episodic,
  narrative, procedural, reflective, topic-files, cohort) is **wiped on
  every gateway restart** — the opposite of "durable compounding memory."
- **cognitive_memory_cells has no live writer.** `createObserve` is
  exported and the recall path is wired, but grep for `.observe(` across
  `services/api-gateway/src` returns **only Prometheus metrics**, never the
  cognitive-memory observe. So recall queries an empty/never-grown store.
- **persistent_memory_session write is dead.** `createSessionMemoryUpsert`
  appears only in the `cognitive-wiring.ts:52` docstring — never invoked.
  Session recall (`safeSessionRecall`) reads a store nothing writes.
- **personal_memory_cells write is dead.** `personal-kb.hono.ts` only
  `SELECT`s (lines 212, 293); no `INSERT INTO personal_memory_cells`. The
  person-spanning KB is a read surface over an unfilled table.

### 2.2 Corpus pipeline gaps (the dead-corpus-path + one-shot intake)

- **Dead default corpus path.** `brain-kernel-wiring.ts:131`
  `DEFAULT_MINING_CORPUS_PATH = '…/Claude Projects/Boji project/Docs/'` — a
  stale absolute local-disk path that will not exist in any deploy; only
  overridable by `MINING_CORPUS_PATH` env which is unset by default.
- **Corpus ingest is a manual CLI, never scheduled.** `borjie-corpus-
  ingest.ts` exposes a CLI (`borjie-corpus-cli.ts`); the consolidation
  worker `main()` (`index.ts:584`) wires reservoir-loop + OCR + 8-stage +
  attestor but **never** corpus ingest. The k8s cron runs `index.ts` only.
  So first-boot global corpus is a human-run one-shot.
- **Markdown-H2-only chunking.** `splitByH2` (`borjie-corpus-ingest.ts:155`)
  ignores tables, figures, page layout — the corpus is PDF-heavy (licences,
  NI 43-101/JORC, EIAs, tax circulars). Violates
  `knowledge-continuous-acquisition-sota.md` §4 (LayoutLMv3/Donut).
- **Exact-key dedup only.** `deterministicId` = SHA-256 of
  `source_file::section_heading` (`borjie-corpus-ingest.ts:232`). No
  MinHash-LSH near-dup, no semantic dedup, no entity canonicalization
  (§7).
- **No crawl frontier / change-only ingest.** No `crawl_frontier` table,
  no ETag/last-modified/content-hash diff. Re-ingest re-embeds everything
  (§2.3, §5.4).

### 2.3 Knowledge-graph gaps (KG is not the continual substrate)

- **Heuristic, not LLM, extraction.** Both KG writers are explicitly
  heuristic-only: gateway `ingest.ts` does case-insensitive substring
  `mentions` edges (`ingest.ts:476-495`); `services/knowledge-graph/
  grower.ts:13` "Heuristic-only — no LLM call." No entity-entity /
  entity-event / event-event triples (AutoSchemaKG §12), no dynamic schema
  induction.
- **Temporal + provenance modules unused on ingest.** `temporal/bi-
  temporal.ts` (4 timestamps) and `provenance/prov-o.ts` exist but
  `knowledge-graph/ingest.ts` writes neither — facts overwrite instead of
  invalidate-with-timestamp (§6). Violates "current is well-defined" and
  the CLAUDE.md append-only invariant for knowledge.
- **No incremental GraphRAG on hot path.** Leiden community detection runs
  only in the sleep-pass `graph-rag-community-summaries.ts` pass — which is
  itself unwired in prod (see 2.5). No `update-index`/affected-community
  recompute; no global map-reduce search at answer time.
- **Embedding-space split.** `intelligence_corpus_chunks` = vector(1024)
  (OpenAI 3-large@1024, despite schema docstring claiming Cohere embed-v3,
  `intelligence-corpus.schema.ts:14`); `cognitive_memory_cells` /
  `kernel_memory_semantic` / `skill_registry` = 1536 (3-small). KG ingest
  copies the 1024 corpus vector into `kg_nodes.embedding`
  (`ingest.ts:430-457`) — cross-store cosine is meaningless across spaces.

### 2.4 Continual-learning / curiosity gaps

- **No curiosity clock.** grep for `gap-detect|curiosity|enqueueAcquisition`
  across research-orchestrator + knowledge-graph = **zero hits**. Nothing
  fires acquisition on low recall-confidence, missing KG node, or staleness
  — the exact mechanism §9 says makes growth unbounded.
- **Continuous-watch is operator-config, not self-directed.**
  `modes/continuous-watch.ts:4-15` — "Once configured (e.g. 'watch gold
  spot…')". The agent does not decide what to watch.
- **No active-learning prioritizer.** No uncertainty/diversity acquisition
  function ranking a research queue under budget (§9.2).

### 2.5 Self-improvement loop gaps (built-but-dark)

- **Real consolidator not on default path.** `consolidation-worker` boots
  with `createStubConsolidator()` (`index.ts:625`, `consolidation.ts:133`)
  — 1 fact per 5 turns, fixed `recent-topic` key. The real Haiku
  consolidator is "plug-in compatible" but not the default wire.
- **Unwired self-improvement packages (zero `services/` call sites):**
  - `@borjie/meta-learning-conductor` — the measure→curate→reward→eval→
    decide→apply loop (`meta-learning-conductor/src/index.ts`). Unwired.
  - `@borjie/intel-self-improve` — verifiers + invocation audit. Unwired.
  - `@borjie/language-self-improve` — self-improve runner. Unwired.
  - `@borjie/learning-signal-emitter` — reward model + per-tier isolation.
    Unwired.
  - `@borjie/tacit-knowledge` — interview/extractor/consolidator. Unwired.
  - `@borjie/graph-database` — Neo4j/AGE/FalkorDB drivers + cypher. Unwired.
- **Sleep-pass orchestrator prod-dark.** `sleep-pass-orchestrator/src/
  standalone-bootstrap.ts` wires **in-memory adapters by default**;
  comments say "Production wiring (Drizzle + Redis adapters) lives in the
  api-gateway composition root once those adapters land" — they have not.
  The GraphRAG-community pass therefore does not run in prod.
- **No ingest-time quality gate.** Scoring (Self-RAG/CRAG §10) runs at
  answer time in the research scorer, not at ingest — unbounded acquisition
  would pollute the corpus if 2.4 lands without this.

---

## 3. Cross-repo note (BossNyumba)

BN (`Cursor Projects/BOSSNYUMBA101`) carries the lineage packages Borjie
should harvest: `continuous-learning`, `litfin-port-memory-extra`,
`graph-sync`, plus the same `knowledge-graph` / `memory-v2` /
`learning-signal-emitter` / `graph-privacy`. BN's `continuous-learning`
package is the most relevant prior art for closing 2.4/2.5 — it is the
named lane to port rather than rebuild. (Borjie has no `continuous-learning`
package; that absence is itself the tell for the curiosity-clock gap.)

---

## 4. Closure sequence (what to ship, in order)

1. **Durability first** (2.1): add Drizzle stores for `memory-v2`; wire the
   live `observe()` write on `/turn`; wire `createSessionMemoryUpsert` +
   personal_memory_cells INSERT. Without this, every other upgrade compounds
   nothing.
2. **One embedding space** (2.3): pick 1536 everywhere (or a re-embed lane
   to converge corpus → 1536); stop copying 1024 vectors into 1536 graphs.
3. **Corpus continuity** (2.2): fix `DEFAULT_MINING_CORPUS_PATH`, schedule
   ingest in the worker, add layout-aware doc-AI + crawl-frontier +
   change-only diff.
4. **KG as substrate** (2.3): LLM entity/relation extraction, wire the
   already-built bi-temporal + PROV-O modules into ingest, incremental
   Leiden, HippoRAG-style PPR retrieval.
5. **Real consolidator + light the loop** (2.5): swap stub → Haiku
   consolidator; wire `meta-learning-conductor` + `learning-signal-emitter`
   + prod sleep-pass adapters.
6. **Curiosity clock** (2.4): gap-detector → active-learning queue → Deep
   Dive, gated by budget + ingest-time Self-RAG/CRAG quality gate.

---

## 5. Source ledger (files actually read)

- `services/consolidation-worker/src/{index.ts,consolidation.ts,tasks/borjie-corpus-ingest.ts,tasks/borjie-corpus-adapters.ts,stages/05-decay.ts}`
- `services/api-gateway/src/composition/cognitive-wiring.ts`
- `services/api-gateway/src/composition/brain-kernel-wiring.ts` (corpus path, embedder)
- `services/api-gateway/src/composition/knowledge-graph/ingest.ts`
- `services/api-gateway/src/services/knowledge-graph/grower.ts`
- `services/api-gateway/src/routes/brain.hono.ts` (enrichment read path)
- `services/api-gateway/src/routes/personal-kb.hono.ts`
- `services/api-gateway/src/routes/mining/chat-corpus-evidence.ts`
- `services/research-orchestrator/src/modes/continuous-watch.ts`
- `services/sleep-pass-orchestrator/src/{standalone-bootstrap.ts,passes/graph-rag-community-summaries.ts}`
- `packages/memory-v2/src/*`, `packages/cognitive-memory/src/*`, `packages/persistent-memory/src/*`, `packages/knowledge-graph/src/{temporal,provenance,graphrag}/*`, `packages/meta-learning-conductor/src/index.ts`
- schemas: `intelligence-corpus.schema.ts`, `cognitive-memory.schema.ts`, `kernel-memory-semantic.schema.ts`, `personal-memory.schema.ts`, `persons.schema.ts`
- specs: `knowledge-continuous-acquisition-sota.md`, `borjie-cognitive-infra-audit.md`, `frontier-compounding-knowledge-and-trust.md`, `knowledge-organization-graphrag-sota.md`
- BN: `Cursor Projects/BOSSNYUMBA101/packages/*` (continuous-learning, litfin-port-memory-extra, graph-sync)
