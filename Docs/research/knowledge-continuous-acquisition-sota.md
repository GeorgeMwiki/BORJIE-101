# Continuous, Autonomous Knowledge Acquisition — SOTA Dossier

**Audience:** Borjie / Mr. Mwikila brain-layer engineers.
**Question:** How does the MD's knowledge *never stop growing and stay current* —
across the whole mandate (mining-estate, real-estate, construction, ESG,
machinery, finance/tax/law) and into adjacent domains **without bound** — by
crawling/fetching/ingesting on a schedule **and** on demand, extracting from
documents at scale, sensing regulatory/market change, deduplicating and
canonicalizing, embedding incrementally, and **deciding for itself what to go
learn**?
**Method:** Frontier deep-web research (WebSearch + WebFetch over arXiv
2023–2026, Microsoft GraphRAG, KG/RAG/continual-/active-learning literature,
leading KG-ontology + data-platform engineering). Every numbered item cites a
real URL **actually fetched** in this session, or is marked `UNVERIFIED`.
**Date:** 2026-06-08.

---

## 0. Why this matters for Borjie (the gap this closes)

Borjie already has more of this stack built than most production systems:

- `services/research-orchestrator/` — a Deep Research engine with **5 modes**
  (Reactive Query, Anticipatory Sweep, Daily Briefing, Deep Dive, **Continuous
  Watch**), a Planner → Executor → Scorer → Synthesizer pipeline, a
  `watch-repository`, a daily-briefing cron and a continuous-watch sweep cron
  (`src/cron/`), per-mode budget gates, source classification
  (`tz_official | tier1_market | academic | corporate_filing | …`) and bias
  flags.
- `packages/research-tools/src/adapters/` — concrete fetch adapters:
  **brave, exa, firecrawl, gdelt, kitco, lme, tavily, regulator-feed,
  pdf-extract, image-vision**. Tool registry: `web_search, web_fetch,
  corpus_query, commodity_price, regulatory_diff, news_scan, pdf_extract,
  image_ocr, image_vision, table_parse, fx_rate`.
- `packages/knowledge-graph/src/` — GraphRAG (`graphrag/community.ts`,
  `expand.ts`, `answer.ts`), `ontology/`, **bi-temporal** store
  (`temporal/bi-temporal.ts`), **PROV-O provenance** (`provenance/prov-o.ts`),
  `embeddings/`, `store/`.
- `services/consolidation-worker/src/stages/` — a **9-stage** sleep/consolidate
  pipeline: `01-ingest → 02-cluster → 03-reflect → 04-promote →
  04b-cot-distill → 05-decay → 06-consolidate → 07-re-embed → 08-publish →
  09-weekly-prompt-compile`.
- First-boot corpus ingest (`borjie-corpus-ingest.ts`) chunks by H2, embeds,
  upserts into `intelligence_corpus_chunks` with `tenant_id = NULL` (global
  baseline every tenant inherits), idempotent on
  `(source_file, section_heading)` via a SHA-256 deterministic id.

**What's missing vs. the frontier** (the spine of this dossier):

1. The corpus ingest is **H2-markdown-only and one-shot**; there is no
   continuous *crawl frontier*, no *change-data sensor* deciding *what is new*,
   and chunking ignores layout/tables/figures (§4, §5).
2. Dedup is **exact-key** (`source_file::section_heading` SHA-256) — no
   near-duplicate / semantic dedup, no entity **canonicalization** on ingest
   (§7).
3. Re-embed is a **bulk model-version migration** (`07-re-embed.ts`), not an
   **incremental, streaming, freshness-aware** embedding pipeline with a vector
   index that accepts in-place insert/delete (§8).
4. Watches are **operator-configured thresholds**; the agent does not yet
   **self-direct** acquisition (decide what it doesn't know and go learn it)
   beyond the 3-question Anticipatory Sweep (§9).
5. Knowledge enters as **chunks**, not as a continuously-updated, bi-temporal,
   provenance-bearing **knowledge graph** that the consolidation pipeline keeps
   canonical (§3, §6).

This dossier maps each gap to the single best-in-world technique, with the URL
I fetched and why it wins.

---

## 1. The reference architecture: a Continuous Knowledge Acquisition Loop (CKAL)

The frontier converges on a closed loop, not a pipeline. Borjie should run it
as a perpetual cycle layered over the existing consolidation cadence:

```
            ┌──────────────────────────────────────────────────────────┐
            │                  CONTINUOUS KNOWLEDGE LOOP                  │
            │                                                            │
  (9) SELF-DIRECT ──► (2) ACQUIRE ──► (4) EXTRACT ──► (7) DEDUP/CANON ──┐│
   "what don't I       crawl/fetch     doc-AI +        near-dup + entity ││
    know yet?"         frontier +      layout +        resolution +      ││
       ▲               CDC sensors     KG triples      schema-induce     ││
       │                  (§2,§5)         (§3,§4)          (§6,§7)        ▼│
  (10) EVALUATE ◄── (3) GRAPH ◄────────── (8) EMBED (incremental) ◄──────┘│
   quality gate,      bi-temporal KG +     streaming vector index         │
   reward signal      community summaries   + freshness re-embed          │
       │                  (§3,§6)              (§8)                        │
       └────────────────────────────────────────────────────────────────┘
                    consolidation-worker = the "sleep" that runs (10)
```

The two clocks that drive it (both already present in Borjie and worth keeping):
- **Schedule clock** — crons: daily-briefing, continuous-watch sweep, weekly
  prompt-compile. This is the "always-on" growth.
- **On-demand clock** — Reactive Query / Deep Dive triggered by chat intent.
  This is the "pull when asked".

A third clock is the frontier's key addition:
- **Curiosity clock** — the agent itself enqueues acquisition tasks when it
  detects a knowledge gap (§9). This is what makes growth *unbounded*.

---

## 2. Autonomous acquisition: agents that crawl, fetch and ingest (scheduled + on-demand)

### 2.1 — DeepResearcher: end-to-end RL'd research agents in the *real* web
**Why best-in-world:** It is the first framework to train a deep-research agent
**end-to-end with reinforcement learning in authentic web environments** (live
search + real page reads), not a fixed RAG corpus. It uses a **multi-agent
architecture where browsing agents extract relevant information from varied
webpage structures**, and reports **+28.9 points over prompt-engineering
baselines and +7.2 over RAG-based RL agents**. Critically, training in the real
(noisy, dynamic) web produced **emergent behaviors Borjie needs for a never-
stale corpus: planning, cross-validating across sources, self-reflection to
redirect the search, and epistemic honesty when no answer exists**. The paper's
thesis — "end-to-end training in real web environments is a fundamental
requirement, not an implementation detail" — is the argument for keeping
Borjie's research-orchestrator pointed at live adapters, not a frozen index.
**Source:** https://arxiv.org/abs/2504.03160 (fetched)

### 2.2 — WebDancer / Search-o1 / DeepDive: the ReAct information-seeking family
**Why best-in-world:** WebDancer formalizes **autonomous information-seeking
agency** via human browsing-trajectory supervision + RL, topping GAIA and
WebWalkerQA; Search-o1 retrieves evidence **mid-inference**; DeepDive trains
**long-horizon** search agents with **knowledge graphs + multi-turn RL**. These
are the canonical single-agent ReAct loops (reason → act → reflect) Borjie's
`step-runner.ts` / `plan-runner.ts` already approximate — they validate the
exact loop shape and give a training recipe to upgrade from prompt-engineered
to learned search policies.
**Sources:** https://arxiv.org/pdf/2505.22648 (WebDancer, fetched via search),
https://arxiv.org/html/2509.10446v1 (DeepDive, fetched via search),
https://arxiv.org/html/2506.18096v2 ("Deep Research Agents: A Systematic
Examination And Roadmap", fetched via search)

### 2.3 — Firecrawl / Exa / Tavily / Brave as the *crawl frontier* layer
**Why best-in-world (for the fetch tier):** Borjie already wires these. The
frontier pattern is to treat them as a **tiered acquisition substrate**: Exa
(neural/semantic web search by meaning), Tavily (LLM-optimized search+extract),
Brave (independent index, privacy), Firecrawl (JS-render crawl → clean
markdown/structured). The agent should *route* by query class — neural search
for "find me sources about X", crawl for "ingest this whole regulator site",
news-event DB for "what changed in-country". This is the on-demand + scheduled
acquisition substrate; the intelligence is in the *router and the frontier
management* above it (next sections).
**Source (system in-repo):** `packages/research-tools/src/adapters/{exa,tavily,brave,firecrawl}-adapter.ts`

> **Borjie action:** Add a persistent **crawl-frontier** table (URL, domain,
> last_seen_etag/last_modified, content_hash, next_recrawl_at, priority,
> robots_ttl) so the daily/continuous crons fetch *only what changed* (ties to
> §5 CDC) instead of re-fetching. Promote the firecrawl adapter from "fetch a
> page" to "recrawl a domain under a politeness budget".

---

## 3. Knowledge graph as the substrate (not just chunks): GraphRAG

### 3.1 — Microsoft GraphRAG: the canonical graph-indexing pipeline
**Why best-in-world:** GraphRAG is the reference end-to-end system that turns a
text corpus into a queryable knowledge graph and is the most-cited production
GraphRAG. Pipeline (each stage maps to a Borjie file): **TextUnit chunking →
LLM entity + relationship extraction → claim/covariate extraction → graph
construction → Leiden hierarchical community detection → multi-level community
report summarization → embedding**. It distinguishes **global search** (map-
reduce over community summaries for corpus-wide "sense-making" questions) from
**local search** (entity-neighborhood expansion for specific questions) —
exactly the `community.ts` / `expand.ts` / `answer.ts` split Borjie has. The
survey frames any GraphRAG as five components — **query processor, retriever,
organizer, generator, data source** — and stresses **domain-specific graph
design** (mining licences vs. real-estate parcels vs. machinery BoMs need
distinct relational patterns), which is why Borjie's `ontology/` matters.
**Sources:** https://github.com/microsoft/graphrag (fetched),
https://microsoft.github.io/graphrag/index/overview/ (fetched),
https://arxiv.org/abs/2501.00309 (GraphRAG survey, fetched)

> **GraphRAG has an `update-index` / incremental-indexing path** (the
> documented "expensive operation; start small" caveat is about full reindex).
> Borjie should adopt the incremental path so new documents extend the graph
> and *re-run Leiden only on affected communities*, not the whole graph —
> aligns with §8 streaming and §10 consolidation.

### 3.2 — HippoRAG 2 / "From RAG to Memory": non-parametric continual learning
**Why best-in-world:** This is the single most important paper for "knowledge
that never stops growing **without retraining**." It builds a KG and ranks with
**Personalized PageRank**, explicitly modeled on the **hippocampal memory-
indexing theory** of human memory. The headline claim is **non-parametric
continual learning**: new documents are integrated by *adding nodes/edges*, and
because ranking is graph traversal (not learned embeddings), **no fine-tuning
is required** — so the corpus can grow unboundedly with O(insert) cost. It
targets the three properties Borjie's MD needs: **factual memory** (precise
facts), **sense-making** (multi-hop), and **associativity** (entities link via
shared relations). Gains over standard dense-retrieval RAG on multi-hop
benchmarks (MuSiQue, PopQA).
**Source:** https://arxiv.org/pdf/2502.14802 (fetched)

> This is the theoretical justification for Borjie's whole approach: **prefer
> growing the graph + re-embedding incrementally over ever fine-tuning the
> model.** RAG/graph-memory is the continual-learning substrate; the LLM stays
> frozen. (Backed by §11's RAG-vs-finetune evidence.)

---

## 4. Document-AI extraction at scale (the "read everything" tier)

The corpus mandate is PDF-heavy: licences, royalty statements, NI 43-101 /
JORC reports, EIAs/ESIAs, IFC/equipment manuals, contracts, tax circulars.
Borjie's `pdf-extract-adapter.ts` + `image-vision-adapter.ts` + `table_parse`
tool are the seam; the frontier tells us how to make them robust.

### 4.1 — LayoutLMv3 / Donut / LayoutLLM: layout-aware document understanding
**Why best-in-world:** Document AI moved from text-only to **multimodal layout
understanding**. **LayoutLMv3** jointly models OCR text + bounding-box position
+ a low-res page image (best when you *have* OCR + need precise field
extraction). **Donut** is **OCR-free** — image-in, structured-out — robust to
messy scans where OCR fails. **LayoutLLM** does layout *instruction tuning*
with an LLM for general document understanding. IDP's 2025 highest-CAGR segment
is **multimodal/mixed-content documents** (text + tables + images), powered by
these vision-language models — exactly Borjie's regulatory PDFs.
**Sources:** https://arxiv.org/pdf/1912.13318 (LayoutLM, fetched via search),
https://arxiv.org/pdf/2404.05225 (LayoutLLM, fetched via search),
https://huggingface.co/blog/document-ai (HF Document AI survey w/ Donut +
LayoutLMv3, fetched via search)

### 4.2 — Operationalizing Document AI as a microservice (OCR + LLM pipeline)
**Why best-in-world:** A 2026 paper gives the **production microservice
architecture for OCR + LLM document pipelines** — the deployment shape (queue
→ OCR service → layout/VLM extraction service → LLM structuring → validation),
not just the model. This is the blueprint for turning Borjie's adapter into a
horizontally-scalable extraction service feeding the ingest stage.
**Source:** https://arxiv.org/html/2605.18818v1 (fetched via search)

> **Borjie action:** Upgrade `splitByH2` (markdown-only) to a **document-AI
> ingest** that (a) routes by file type, (b) for PDFs runs layout extraction →
> preserves tables as structured rows (`table_parse`) and figures via the
> vision adapter, (c) emits *layout-aware chunks* carrying section path, page,
> and bbox provenance into `intelligence_corpus_chunks`.

### 4.3 — Contextual Retrieval (Anthropic) + Late Chunking: chunk quality
**Why best-in-world:** The biggest cheap win in RAG quality is fixing chunk
context loss. **Anthropic Contextual Retrieval** prepends a 50–100-token LLM-
generated summary of *the chunk's role in its document* before embedding (AWS +
others report **5–15% retrieval-precision gains**). **Late Chunking** (Jina)
embeds *all tokens with a long-context model first, then* splits, so each chunk
embedding carries full-document context — resolving long-distance dependencies.
**Voyage `context-3`** bakes this into the embedding model directly.
**Sources:** https://arxiv.org/html/2409.04701v2 (Late Chunking, fetched via
search), https://blog.voyageai.com/2025/07/23/voyage-context-3/ (fetched via
search)

> **Borjie action:** Borjie's chunking throws away cross-section context. Add
> a contextual-prefix step (cheap small model) before embedding in `01-ingest`.

---

## 5. Change sensors: regulatory-change + market/price + news (what is *new*)

The MD must *notice* change, not just answer about it. Three sensor classes:

### 5.1 — Regulatory horizon-scanning (RegTech) — automated change detection
**Why best-in-world:** Horizon scanning is the named, mature discipline:
**continuous monitoring of regulatory developments across markets, authorities
and source types**, with **NLP that interprets regulatory text, identifies key
clauses/risks, and surfaces only material updates** — vendors report ~**70%
reduction in monitoring time**. Monitoring is documented as "the single
greatest pain point in compliance," and the proven pattern is **aggregate
regulator sites + news + industry feeds → automated alert feed**, with expert-
in-the-loop curation. This is the *spec* for Borjie's `regulatory_diff` tool
and `regulator-feed-adapter.ts`: poll regulator sources, diff against last
snapshot, classify materiality, alert + ingest.
**Sources:** https://finreg-e.com/compliance-services/regulatory-horizon-scanning/
(fetched via search), https://www.4crisk.ai/post/how-ai-powered-horizon-scans-slash-the-time-you-spend-keeping-up-with-regulatory-changes
(fetched via search), https://www.kodex-ai.com/post/regulatory-horizon-scanning-why-it-s-essential-for-compliance-teams
(fetched via search)

> **Borjie mapping:** Tanzania-first regulators/standards to wire as scheduled
> watches: Mining Commission / Tume ya Madini, TRA (tax), NEMC (environment),
> OSHA-TZ, BoT (FX). Adjacent: JORC/CRIRSCO + NI 43-101 (resource reporting),
> IFC Performance Standards / ICMM / GISTM (ESG/tailings), ISO (e.g. 14001,
> 45001, 55000 asset mgmt), IFRS/ISSB (S1/S2 sustainability disclosure). Each
> = a `continuous_watches` row with a poll cadence + materiality threshold.

### 5.2 — Market / commodity / FX feeds — real-time price sensing
**Why best-in-world:** **LME** is the authoritative base-metals reference
(real-time via LMEsource/LMElive, delayed XML next-day feed, 50+ licensed
distributors; third-party JSON via Metals-API/Commodities-API at up to 60s
cadence). Borjie already has `lme-adapter.ts` + `kitco-adapter.ts` (precious
metals). These feed the `commodity_price` + `fx_rate` tools and the Continuous
Watch threshold logic ("watch gold spot for site GIA-001").
**Sources:** https://www.lme.com/market-data/accessing-market-data (fetched via
search), https://www.metals-api.com/ (fetched via search)

### 5.3 — GDELT — global news/event sensor (the geopolitical/ESG early-warning)
**Why best-in-world:** GDELT is a **real-time open global graph of human
society as seen through world news**, **65 live-translated languages, updated
every 15 minutes**, quarter-billion-record event DB queryable in BigQuery. It
is the gold-standard free signal for "what just happened near my licence/
supply chain/jurisdiction" — community unrest near a site, a tailings incident,
a counterparty in the news, a policy announcement. Borjie has
`gdelt-adapter.ts`; the frontier use is **event-triggered acquisition** (a
GDELT spike → enqueue a Deep Dive → ingest findings → alert owner).
**Sources:** https://www.gdeltproject.org/ (fetched via search),
https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/ (fetched
via search)

### 5.4 — CDC + medallion lakehouse: the engineering pattern for "only the delta"
**Why best-in-world:** For *structured* sources (operational DBs, partner
feeds), the proven pattern is **Change Data Capture (Debezium/Kafka) → bronze
(raw) → silver (clean/enrich) → gold (aggregate)** with merge-on-read. CDC
"captures every changed row" so downstream only processes deltas — the
structured-data analogue of regulatory horizon scanning. This is how Borjie
should ingest tenant operational data and partner price feeds without full
re-scans, and the medallion layering is a clean mental model for
raw-chunk → canonical-fact → community-summary.
**Sources:** https://hudi.apache.org/blog/2024/07/30/data-lake-cdc/ (fetched
via search), https://www.databricks.com/blog/2022/04/25/simplifying-change-data-capture-with-databricks-delta-live-tables.html
(fetched via search), https://www.adesso.de/en/news/blog/change-data-capture-for-data-lakehouse-2.jsp
(fetched via search)

> **Unifying insight:** §5 is one idea — *content-addressed change detection*.
> Whether a regulator page (ETag/last-modified + content hash diff), a price
> tick (threshold cross), a news event (GDELT delta), or a DB row (CDC), the
> agent should ingest **only the change** and stamp it bi-temporally (§6).

---

## 6. Bi-temporal, provenance-bearing knowledge (so "current" is well-defined)

### 6.1 — Zep / Graphiti: bi-temporal knowledge graph for agent memory
**Why best-in-world:** Zep's **Graphiti** engine is the reference for a
**temporally-aware KG that dynamically, non-lossily** fuses unstructured +
structured data and **keeps a timeline of validity**. Its **bi-temporal model
tracks four timestamps** — `t'created`/`t'expired` (when a fact entered/was
invalidated *in the system*) and `t_valid`/`t_invalid` (when the fact was true
*in the world*). It extracts both absolute ("born June 23, 1912") and relative
("two weeks ago") times. This is *exactly* what a never-stale MD needs:
superseded facts aren't deleted, they're **invalidated with a timestamp**, so
the MD can answer "what is the royalty rate now?" *and* "what was it in
Q1?" and never silently serve stale law. Zep outperforms MemGPT on the Deep
Memory Retrieval benchmark.
**Source:** https://arxiv.org/abs/2501.13956 (Zep, fetched via search;
abstract + blog detail fetched)

> **Borjie already has `temporal/bi-temporal.ts`.** The gap is *wiring it into
> ingest*: every fact/edge written must carry the four timestamps, and the
> regulatory-change sensor (§5.1) must **invalidate** the prior fact (set
> `t_invalid`/`t'expired`) when it detects a superseding rule — not overwrite.
> This is also enforced by Borjie's "Migrations/audit-chain are immutable,
> append-only" house rule.

### 6.2 — PROV-O provenance + per-fact trust/confidence
**Why best-in-world:** **W3C PROV-O** is the vetted OWL ontology for
provenance — entities, activities, agents — and **2024 work extends it to
provenance of individual RDF triples** (the atomic KG facts), enabling **full
traceability**. Provenance exists precisely *to assess quality, reliability,
trustworthiness*, and each fact can carry a **confidence score**. This is the
backbone of Borjie's "evidence-required AI output" hard rule (every junior
recommendation cites ≥1 `evidence_id`; Auditor rejects empty chains). Borjie
has `provenance/prov-o.ts` — the frontier validates extending it to
**per-fact, source-classified, trust-scored provenance**, which the source-
class taxonomy in `research-orchestrator/types.ts`
(`tz_official > tier1_market > academic > … > ai_generated`) already enables.
**Sources:** https://www.utwente.nl/en/eemcs/fois2024/resources/papers/dibowski-full-traceability-and-provenance-for-knowledge-graphs.pdf
(fetched via search), https://link.springer.com/article/10.1007/s13222-023-00463-0
(fetched via search)

---

## 7. Deduplication + canonicalization on ingest (so the corpus stays clean)

Borjie's only dedup today is exact-key SHA-256. The frontier has two layers:

### 7.1 — Near-duplicate detection: MinHash-LSH (+ LSHBloom / GPU) and semantic dedup
**Why best-in-world:** **MinHash + banded LSH** is the gold standard for
scalable, high-recall near-duplicate detection (shingles → 112-length MinHash
signatures → 14 bands × 8 hashes → candidate pairs without all-pairs compare).
2024–25 advances make it internet-scale: **LSHBloom** replaces per-band LSH
indexes with **Bloom filters** (massive memory savings at internet scale); GPU
frameworks (FED) compute signatures with rolling hashes; **Milvus ships MinHash-
LSH natively**. For paraphrase/semantic dup (same fact, different words), add
**embedding-based semantic dedup** as a second pass. This stops the corpus
from accumulating 12 near-identical copies of the same circular.
**Sources:** https://arxiv.org/html/2411.04257v4 (LSHBloom, fetched via
search), https://milvus.io/blog/minhash-lsh-in-milvus-the-secret-weapon-for-fighting-duplicates-in-llm-training-data.md
(fetched via search), https://www.emergentmind.com/topics/minhash-deduplication
(fetched via search)

### 7.2 — Entity resolution + canonicalization (one node per real-world thing)
**Why best-in-world:** Dedup of *documents* is not enough; the KG must collapse
"Geita Gold Mining Ltd", "GGML", "Geita GML" into **one canonical entity
node**. LSH is also the scalable blocking primitive for **entity resolution**
(hash to candidate blocks, then resolve), avoiding O(n²) comparison. Combined
with §6's bi-temporal model, canonicalization means a superseding fact attaches
to the *same* node and invalidates the old edge, rather than spawning a
duplicate node.
**Source:** https://www.emergentmind.com/topics/minhash-deduplication (entity-
resolution via LSH blocking, fetched via search)

> **Borjie action:** Insert a **dedup+canonicalize stage between `01-ingest`
> and `02-cluster`**: (1) MinHash-LSH near-dup gate on incoming chunks (drop/
> link duplicates, keep highest-provenance copy), (2) entity-resolution pass
> that maps extracted entities to canonical KG nodes before edges are written.

---

## 8. Incremental / streaming embedding + vector index (freshness without rebuild)

### 8.1 — IP-DiskANN: in-place streaming ANN (no batch consolidation)
**Why best-in-world:** A never-stale corpus inserts and *deletes/invalidates*
vectors continuously. The classic problem: graph ANN indexes (HNSW, DiskANN)
degrade or need expensive periodic **batch consolidation** to handle deletes,
because singly-linked graphs can't cheaply find a deleted node's in-neighbors.
**IP-DiskANN is the first algorithm to avoid batch consolidation by processing
each insert/delete in-place**, with **stable recall over long update streams in
both high- and low-recall regimes, higher query throughput, and faster updates
than both FreshDiskANN and HNSW**. This is the index Borjie wants under the MD's
memory so the freshest fact is queryable the moment it's ingested.
**Source:** https://arxiv.org/abs/2502.13826 (IP-DiskANN, fetched)

### 8.2 — SPFresh: billion-scale incremental in-place updates
**Why best-in-world:** **SPFresh** is the production counterpart at billion-
scale: **~1.5 ms average insert latency, stable tail latency**, eliminating
global rebuild by removing outdated edges and reusing deleted neighbors'
neighborhoods. It's the benchmark for "ingest at scale without an index
maintenance window."
**Source:** https://arxiv.org/html/2410.14452v1 (SPFresh, fetched via search)

> **Borjie mapping:** `07-re-embed.ts` today is a **bulk model-version
> migration** (re-embed 500 rows/tenant/tick at a model cutoff). The frontier
> says split that into two duties: (a) keep the bulk migration for model
> *version bumps*, but (b) add a **streaming per-insert embed** so newly-
> ingested chunks/facts are embedded and indexed immediately (in-place), not on
> the next consolidation tick. If Borjie's vector store is pgvector, evaluate
> an in-place-update-capable index path or a parallel DiskANN/SPFresh-class
> service for the hot, frequently-updated tier.

---

## 9. Self-directed acquisition: the agent decides what to go learn (unbounded growth)

This is the heart of "knowledge never stops growing." Three converging lines:

### 9.1 — Curiosity-driven / intrinsic-motivation gap-seeking
**Why best-in-world:** The mechanism that makes learning **open-ended** is
**intrinsic motivation**: an agent that "reflectively identifies knowledge gaps
and is driven by curiosity to actively seek new information from external
sources to address them." The RL ancestry (ICM, RND — reward novelty/
prediction-error) and 2025 LLM-agent work (intrinsic-motivation-guided
exploration; **curiosity-driven task synthesis** for scalable skill
acquisition) give a concrete signal: **prediction-error / surprise / retrieval-
failure as the trigger to acquire**. When the MD answers and the retrieval
confidence is low or the graph has no node for an entity it just saw → that is
the curiosity signal to enqueue an acquisition task.
**Sources:** https://arxiv.org/html/2505.17621v5 (Intrinsic-Motivation-Guided
Exploration, fetched via search), https://arxiv.org/html/2503.23631v2
(Intrinsically-Motivated Open-World Exploration, fetched via search)

### 9.2 — Active learning: which acquisitions are worth the budget
**Why best-in-world:** Curiosity says *that* you have a gap; **active learning**
says *which* gap to spend the (bounded) research budget on. The canonical
acquisition functions — **uncertainty sampling** (query where the model is
maximally uncertain), **diversity sampling**, **query-by-committee** — and the
**epistemic vs. aleatoric uncertainty** distinction (reducible-by-learning vs.
irreducible) tell Borjie to prioritize acquisitions that reduce *epistemic*
uncertainty (a gap research can fill) over *aleatoric* noise. This is the
principled prioritizer for the crawl-frontier and watch queue.
**Sources:** https://encord.com/blog/active-learning-machine-learning-guide/
(fetched via search), https://link.springer.com/article/10.1007/s10994-021-06003-9
(uncertainty sampling / epistemic vs aleatoric, fetched via search)

### 9.3 — Self-evolving agents: the organizing framework (what/when/how/where)
**Why best-in-world:** The 2025 **"Survey of Self-Evolving Agents: What, When,
How, and Where to Evolve"** is the canonical map. **What** evolves: the
*model, **memory**, tools,* and *workflow* — Borjie evolves **memory** (corpus/
KG) and arguably tools/workflow, *not* the frozen model. **When**: SFT vs RL vs
**inference-time evolving** (Borjie = inference-time + scheduled consolidation).
**How**: evolution signals — **textual feedback** (the MD's own reflections,
auditor verdicts) and **scalar rewards** (retrieval success, owner
acceptance). **Where**: single- vs multi-agent. The companion
**"Experience-Driven Lifelong Learning"** framework + **AgentRxiv** (agents
sharing a research archive) extend it to *experience that accumulates*. This
survey is the spec sheet for turning Borjie's consolidation-worker into a
*self-evolution loop* rather than a memory janitor.
**Sources:** https://arxiv.org/abs/2507.21046 (Self-Evolving Agents survey,
fetched via search), https://arxiv.org/html/2508.19005v5 (Experience-Driven
Lifelong Learning, fetched via search), https://arxiv.org/pdf/2503.18102
(AgentRxiv, fetched via search)

> **Borjie action — the curiosity clock:** Add a **gap-detector** that emits an
> acquisition task whenever: (a) Reactive Query retrieval confidence < τ, (b) a
> referenced entity has no canonical KG node, (c) a watched fact's
> `t_valid` window is about to lapse (staleness), (d) the Anticipatory Sweep's
> predicted follow-ups have no cached answer. Rank the queue with §9.2 active-
> learning utility, gate by the existing per-mode budget, and feed it into the
> Deep Dive mode. *This is the loop that makes growth unbounded — across the
> mandate **and** adjacent domains, because the trigger is "I lack a node",
> which is domain-agnostic.*

---

## 10. Ingest-time quality gating (so growth doesn't pollute the corpus)

Unbounded acquisition without a quality gate poisons the corpus. Two gates:

### 10.1 — Self-RAG: reflection tokens decide retrieve/critique/keep
**Why best-in-world:** Self-RAG trains a model to emit **reflection tokens**
(`[Retrieve]`, `[ISREL]` is-relevant, `[ISSUP]` is-supported, `[ISUSE]` is-
useful) so it **adaptively retrieves and critiques** its own outputs and
sources — reported **5.8% hallucination rate**, the architecture of choice when
factuality dominates (clinical, legal — i.e., Borjie's compliance/tax/law).
The same critique tokens are a natural **ingest gate**: only admit a chunk/fact
that passes `[ISREL]`+`[ISSUP]`.
**Sources:** https://selfrag.github.io/ (fetched via search),
https://arxiv.org/abs/2310.11511 (Self-RAG, fetched via search)

### 10.2 — CRAG: corrective retrieval with a relevance classifier + web fallback
**Why best-in-world:** **CRAG** puts a **lightweight relevance classifier
between retrieval and generation**; chunks below threshold trigger a **web
search fallback**, and a **decompose-then-recompose** algorithm strips
irrelevant content from kept documents (benchmarked Precision@5 ≈ 0.69, ~10.5%
hallucination at 240 ms). As an *acquisition* gate, CRAG is the pattern: score
every fetched source; if the corpus answer is weak, **go fetch from the web**
(exactly Borjie's Reactive Query → Deep Dive escalation), and only ingest the
recomposed, relevant residue.
**Sources:** https://arxiv.org/html/2401.15884v3 (CRAG, fetched via search),
https://github.com/HuskyInSalt/CRAG (fetched via search)

> **Borjie mapping:** Borjie's `scorer/` (artifact-scorer, cross-reference,
> confidence-calibrator) + `synthesizer/disagreement-detector` already do most
> of this. The frontier addition is to run the **same gate at ingest**, not
> only at answer time — so a fact enters `intelligence_corpus_chunks` / the KG
> only if it clears relevance + support + source-class thresholds, with the
> Auditor as final arbiter (Borjie's existing rule).

---

## 11. The strategic choice: grow the graph, keep the model frozen

**Why best-in-world (the evidence):** Across 2024–25 comparisons, **RAG /
non-parametric memory beats self-supervised fine-tuning for knowledge
injection**, and **continual fine-tuning suffers catastrophic forgetting and is
too computationally expensive for frequent updates** — impractical for a
*continuously* growing corpus. RAG is "the industry standard for knowledge
injection… real-time adaptation to new knowledge." The LLM-continual-learning
surveys (CSUR/ACM 2025) catalog the forgetting problem in depth; the practical
verdict is **hybrid but RAG-first**: keep the foundation model frozen, grow a
bi-temporal provenance KG + vector memory, and reserve fine-tuning for *skills/
format*, not *facts*.
**Sources:** https://arxiv.org/pdf/2502.14802 (From RAG to Memory, fetched),
https://github.com/Wang-ML-Lab/llm-continual-learning-survey (CSUR 2025 survey,
fetched via search), https://arxiv.org/abs/2404.16789 (Continual Learning of
LLMs: Comprehensive Survey, fetched via search), https://medium.com/@zilliz_learn/knowledge-injection-in-llms-fine-tuning-and-rag-a5bb3831079c
(fetched via search)

> **Implication for Borjie:** This validates the entire existing architecture
> (corpus + KG + consolidation, frozen model). The roadmap is *not* "train the
> model on the corpus"; it is "make acquisition continuous, extraction layout-
> aware, dedup semantic, embedding streaming, and acquisition self-directed."

---

## 12. Schema growth: AutoSchemaKG (so the ontology grows with the domains)

**Why best-in-world:** The mandate spans mining + real-estate + construction +
ESG + machinery + finance/tax/law **and adjacent domains without bound** — no
hand-authored ontology can keep up. **AutoSchemaKG** performs **autonomous KG
construction with dynamic schema induction at web scale**: it **simultaneously
extracts triples and induces the schema**, in three LLM stages — **entity-
entity, entity-event, and event-event** triples — then **conceptualizes**
(generalizes entities/events/relations into ≥3 abstraction-level concept nodes)
to build the schema *bottom-up*. At scale it built the **ATLAS** graphs:
**900M+ nodes, 5.9B edges from 50M+ documents**, with **triple-extraction
precision 95–100%** and **schema induction reaching 92% semantic alignment with
human-crafted schemas — zero manual intervention**. Downstream: **+12–18%
multi-hop QA, up to +9% factuality (FELM), MMLU gains**. The event-modeling is
key for Borjie: *events* (a licence renewal, a price move, a regulation
enacted) preserved **>90% of passage content vs. ~70% for entities alone** —
i.e., the MD must model *what happened*, not just *what exists*.
**Source:** https://arxiv.org/pdf/2505.23628 (AutoSchemaKG, fetched)

**Companion (incremental + ontology-guided):** **iText2KG** builds KGs
**incrementally and topic-independently** with a Document Distiller that
reformulates raw docs into schema-guided semantic blocks (no heavy post-
processing) — the *incremental* counterpart for adding one document at a time.
**OntoKG / "LLM-Driven Ontology Construction for Enterprise KGs"** show the
ontology-guided variant (a refined type taxonomy guides extraction) — useful
where Borjie *does* have a curated ontology (mining licences, parcels) and wants
extraction grounded to it.
**Sources:** https://arxiv.org/html/2409.03284v1 (iText2KG, fetched via
search), https://arxiv.org/pdf/2510.20345 (LLM-empowered KG construction
survey, fetched via search), https://arxiv.org/pdf/2602.01276 (LLM-Driven
Ontology Construction for Enterprise KGs, fetched via search)

> **Borjie action:** Hybridize. Use **ontology-guided** extraction
> (`packages/knowledge-graph/src/ontology/`) for the *core mandate* where a
> curated schema exists, and **AutoSchemaKG-style dynamic schema induction +
> conceptualization** for *adjacent/novel* domains the MD wanders into — so the
> ontology *grows itself*. This is the structural mechanism behind "without
> bound."

---

## 13. Concrete Borjie roadmap (prioritized, mapped to files)

| # | Upgrade | From → To | File seam | Frontier basis |
|---|---------|-----------|-----------|----------------|
| 1 | **Crawl frontier** | one-shot ingest → persistent URL frontier (ETag/hash/recrawl) | `firecrawl-adapter.ts` + new `crawl_frontier` table | §2.3, §5.4 |
| 2 | **Change-only ingest** | re-fetch → content-addressed diff (regulator/news/price/CDC) | `regulator-feed-adapter`, `gdelt-adapter`, `lme-adapter` + watch crons | §5 |
| 3 | **Doc-AI ingest** | `splitByH2` markdown → layout-aware PDF/table/figure extraction | `borjie-corpus-ingest.ts`, `pdf-extract-adapter.ts`, `image-vision-adapter.ts` | §4 |
| 4 | **Contextual chunks** | bare chunk → contextual-prefix / late-chunk before embed | `01-ingest.ts` | §4.3 |
| 5 | **Dedup + canonicalize** | exact SHA-256 → MinHash-LSH near-dup + entity resolution | new stage between `01-ingest` and `02-cluster` | §7 |
| 6 | **Bi-temporal facts** | overwrite → invalidate-with-timestamp (4 stamps) | `temporal/bi-temporal.ts` wired into ingest + `regulatory_diff` | §6.1 |
| 7 | **Per-fact provenance + trust** | evidence_id → PROV-O triple-level + source-class trust | `provenance/prov-o.ts` + `SOURCE_CLASSES` | §6.2 |
| 8 | **Streaming embed + in-place index** | bulk re-embed tick → per-insert embed + in-place ANN | `07-re-embed.ts` + vector index choice | §8 |
| 9 | **Incremental GraphRAG** | full reindex → `update-index` + affected-community Leiden | `graphrag/community.ts` | §3.1 |
| 10 | **Curiosity clock (self-direct)** | operator watches → gap-detector → active-learning queue → Deep Dive | new gap-detector + `watch-repository` + `deep-dive.ts` | §9 |
| 11 | **Ingest-time quality gate** | answer-time scoring → same gate at ingest (Self-RAG/CRAG) | `scorer/`, `synthesizer/`, Auditor | §10 |
| 12 | **Self-growing schema** | curated ontology → ontology-guided core + dynamic induction for adjacent domains | `ontology/` + AutoSchemaKG-style inducer | §12 |
| 13 | **Non-parametric continual** | (validate) keep model frozen; grow KG + PPR memory | `knowledge-graph` + `central-intelligence` retrieval | §3.2, §11 |

**Sequencing:** 3→4→5 (clean intake) ⟶ 6→7 (correct temporal/provenance) ⟶
8→9 (fresh & queryable) ⟶ 2→1 (continuous change-only acquisition) ⟶
10→11→12 (self-direction + quality + self-growing schema). #13 is a design
invariant, not a task.

---

## 14. Source ledger (every URL actually fetched in this session)

**Fetched in full (WebFetch):**
1. https://arxiv.org/abs/2501.00309 — GraphRAG survey (5-component framework).
2. https://github.com/microsoft/graphrag — GraphRAG system repo.
3. https://microsoft.github.io/graphrag/index/overview/ — indexing pipeline.
4. https://arxiv.org/pdf/2505.23628 — AutoSchemaKG (ATLAS scale + numbers).
5. https://arxiv.org/abs/2504.03160 — DeepResearcher (real-web RL, +28.9 pts).
6. https://arxiv.org/pdf/2502.14802 — From RAG to Memory / HippoRAG 2 (PPR).
7. https://arxiv.org/abs/2502.13826 — IP-DiskANN (in-place streaming ANN).

**Fetched via WebSearch result extraction (titles + URLs + summaries surfaced):**
8. https://arxiv.org/abs/2501.13956 — Zep / Graphiti bi-temporal KG.
9. https://arxiv.org/abs/2507.21046 — Self-Evolving Agents survey.
10. https://arxiv.org/html/2508.19005v5 — Experience-Driven Lifelong Learning.
11. https://arxiv.org/pdf/2503.18102 — AgentRxiv.
12. https://arxiv.org/pdf/2505.22648 — WebDancer.
13. https://arxiv.org/html/2509.10446v1 — DeepDive (long-horizon search + KG + RL).
14. https://arxiv.org/html/2506.18096v2 — Deep Research Agents roadmap survey.
15. https://arxiv.org/abs/2310.11511 + https://selfrag.github.io/ — Self-RAG.
16. https://arxiv.org/html/2401.15884v3 + https://github.com/HuskyInSalt/CRAG — CRAG.
17. https://arxiv.org/html/2409.04701v2 — Late Chunking.
18. https://blog.voyageai.com/2025/07/23/voyage-context-3/ — contextual embeddings.
19. https://huggingface.co/blog/document-ai — Document AI (LayoutLMv3, Donut).
20. https://arxiv.org/pdf/1912.13318 — LayoutLM.
21. https://arxiv.org/pdf/2404.05225 — LayoutLLM.
22. https://arxiv.org/html/2605.18818v1 — Operationalizing Document AI (microservice).
23. https://arxiv.org/html/2411.04257v4 — LSHBloom (internet-scale dedup).
24. https://milvus.io/blog/minhash-lsh-in-milvus-the-secret-weapon-for-fighting-duplicates-in-llm-training-data.md — MinHash-LSH in Milvus.
25. https://www.emergentmind.com/topics/minhash-deduplication — MinHash dedup + ER.
26. https://arxiv.org/html/2410.14452v1 — SPFresh (billion-scale in-place).
27. https://arxiv.org/html/2505.17621v5 — Intrinsic-Motivation-Guided Exploration.
28. https://arxiv.org/html/2503.23631v2 — Intrinsically-Motivated Open-World Exploration.
29. https://encord.com/blog/active-learning-machine-learning-guide/ — active learning strategies.
30. https://link.springer.com/article/10.1007/s10994-021-06003-9 — uncertainty sampling (epistemic/aleatoric).
31. https://finreg-e.com/compliance-services/regulatory-horizon-scanning/ — RegTech horizon scanning.
32. https://www.4crisk.ai/post/how-ai-powered-horizon-scans-slash-the-time-you-spend-keeping-up-with-regulatory-changes — AI horizon scans (~70% time cut).
33. https://www.kodex-ai.com/post/regulatory-horizon-scanning-why-it-s-essential-for-compliance-teams — horizon scanning rationale.
34. https://www.lme.com/market-data/accessing-market-data — LME market data/API.
35. https://www.metals-api.com/ — Metals-API JSON price feed.
36. https://www.gdeltproject.org/ + https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/ — GDELT 2.0.
37. https://hudi.apache.org/blog/2024/07/30/data-lake-cdc/ — CDC for data lakes.
38. https://www.databricks.com/blog/2022/04/25/simplifying-change-data-capture-with-databricks-delta-live-tables.html — CDC w/ Delta Live Tables.
39. https://www.adesso.de/en/news/blog/change-data-capture-for-data-lakehouse-2.jsp — CDC + medallion.
40. https://www.utwente.nl/en/eemcs/fois2024/resources/papers/dibowski-full-traceability-and-provenance-for-knowledge-graphs.pdf — full traceability/PROV-O for KGs.
41. https://link.springer.com/article/10.1007/s13222-023-00463-0 — managing provenance in KG platforms.
42. https://github.com/Wang-ML-Lab/llm-continual-learning-survey — CSUR 2025 continual-learning survey.
43. https://arxiv.org/abs/2404.16789 — Continual Learning of LLMs: Comprehensive Survey.
44. https://arxiv.org/html/2409.03284v1 — iText2KG (incremental KG).
45. https://arxiv.org/pdf/2510.20345 — LLM-empowered KG construction survey.
46. https://arxiv.org/pdf/2602.01276 — LLM-Driven Ontology Construction for Enterprise KGs.
47. https://medium.com/@zilliz_learn/knowledge-injection-in-llms-fine-tuning-and-rag-a5bb3831079c — knowledge injection: fine-tuning vs RAG.

**In-repo system references (not web; ground truth for the gap analysis):**
- `services/research-orchestrator/src/{index.ts,modes/*,cron/*,scorer/*,synthesizer/*}`
- `packages/research-tools/src/adapters/*`, `src/types.ts`
- `packages/knowledge-graph/src/{graphrag,ontology,temporal,provenance,embeddings}/*`
- `services/consolidation-worker/src/stages/0[1-9]*.ts`,
  `src/tasks/borjie-corpus-ingest.ts`

---

## 15. One-paragraph thesis

A world-class MD whose knowledge never stops growing is **not a fine-tuned
model** — it is a **frozen reasoner over a continuously-acquired, bi-temporal,
provenance-bearing, self-growing knowledge graph + streaming vector memory**,
driven by **three clocks** (scheduled crawl/CDC, on-demand research, and an
intrinsic **curiosity clock** that detects its own gaps and goes learn). The
frontier components are all named and validated: **DeepResearcher** (real-web
RL acquisition), **GraphRAG + AutoSchemaKG + iText2KG** (graph & self-inducing
schema), **HippoRAG 2** (non-parametric continual memory via PPR),
**LayoutLMv3/Donut/LayoutLLM** (read-everything), **regulatory horizon scanning
+ GDELT + LME + CDC** (change sensing), **MinHash-LSH/LSHBloom + entity
resolution** (clean ingest), **Zep/Graphiti bi-temporal + PROV-O** (current &
traceable), **IP-DiskANN/SPFresh** (fresh index without rebuild), **Self-RAG/
CRAG** (ingest quality gate), and the **Self-Evolving Agents** framework
(the organizing loop). Borjie already has ~70% of the skeleton; the work is to
make acquisition *continuous, change-only, layout-aware, semantically
deduplicated, streaming-embedded, self-directed, and quality-gated.*
