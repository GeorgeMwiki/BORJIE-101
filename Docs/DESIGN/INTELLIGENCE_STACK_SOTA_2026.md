# Intelligence Stack — SOTA-2026 Master Specification

> The single source-of-truth design doc for Borjie's intelligence
> layer. Spans **seven sibling packages** that together give
> Mr. Mwikila — Borjie's founder-persona steward — the analytical
> reflexes of a Goldman commodities desk, a Cambridge causal-stats
> lab, and a McKinsey foresight team, all reduced to TypeScript
> ports + Python sidecars + a Neo4j connection pool.
>
> **Cross-links:** `GRAPH_RAG_ROUTER_SPEC.md` (18BB),
> `COGNITIVE_ENGINE_SPEC.md` (18T),
> `MEMORY_AMNESIA_PREVENTION_SOTA.md` (18GG),
> `INFORMATION_SYNTHESIS_SOTA_SPEC.md`,
> `DEEP_RESEARCH_SPEC.md`,
> `FIVE_LAYER_LOOP_ARCHITECTURE.md`,
> `FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`.
>
> **Status:** master spec. The seven sibling agents take this as
> their charter and build the packages inside the boundaries set
> below.

---

## 1. Vision — what "intelligent" means for Mr. Mwikila

Mr. Mwikila is not an analyst. He is a Tanzanian gold-room operator,
royalty negotiator, mine-site superintendent, and small-trader
shepherd, simultaneously. He talks in Swahili-English code-switch,
moves between dollars / shillings / grams / troy-ounces in the same
sentence, and asks questions that **collapse three timescales**:
yesterday's shift output, this quarter's LME curve, this year's
NEMC compliance window.

Borjie's intelligence stack must, in a single turn, be able to:

1. **Project** a number forward in time with a calibrated interval
   (gold price + 90d, royalty payable next quarter, container demand
   next month).
2. **Explain** what's actually driving the projection (causal, not
   just correlational).
3. **Detect** when something is off-pattern (a shift output spike,
   an unusual permit-renewal lag, a buyer paying more than market).
4. **Recommend** the next concrete action (file form, contact buyer,
   rebalance hedge).
5. **Show** the answer as a graph — entities, flows, time — that a
   non-quantitative reader can interrogate by clicking nodes.
6. **Cite** every datum back to its provenance (LME tick, USGS
   table, NEMC bulletin, internal sensor) so Mr. Mwikila can defend
   the number in court, in a board room, or on a WhatsApp group.
7. **Stay inside the tenant** — no buyer ever sees another buyer's
   data; no mine ever sees another mine's. Differential-privacy at
   the platform layer is the only way cross-tenant intelligence
   leaks back as a moat product.

This document defines **how the seven sibling packages divide that
work**, what SOTA primitives each pulls from, and where Python
sidecars are unavoidable.

---

## 2. The seven sibling packages

Boundaries below are the non-negotiable carve-up. Each is shipped
as a workspace package under `packages/`, each behind a
ports-and-adapters interface (TypeScript ports → in-memory and
production adapters).

| # | Package | Owns | Does NOT own |
|---|---|---|---|
| 1 | `@borjie/forecasting` (exists) | Time-series projection + intervals (price, royalty, demand, throughput). | Causal explanation; graph rendering. |
| 2 | `@borjie/data-analysis` (new) | Descriptive + inferential stats, regressions, hypothesis tests, ETL primitives over Arrow / DuckDB. | ML training; long-horizon foresight. |
| 3 | `@borjie/graph-db` (new) | Pluggable graph-store port (Kuzu in-process / Neo4j 5 production / FalkorDB cache) + Cypher query layer. | Embedding-based retrieval (that's `knowledge-graph` + `graph-rag-router`). |
| 4 | `@borjie/causal-inference` (new) | PC / PCMCI+ discovery, do-calculus identification, treatment-effect estimation, counterfactuals. Bridges to a Python sidecar. | Pure correlation / regression — that's `data-analysis`. |
| 5 | `@borjie/graph-viz` (new) | Renderable graph snapshots: Cytoscape.js / react-flow / Cosmograph / Sigma adapters with a Borjie GenUI block contract. | Layouts of non-graph data. |
| 6 | `@borjie/anomaly-detection` (new) | Outlier + drift detection over streams and snapshots; Isolation Forest, LOF, autoencoder, ADWIN / KSWIN. | Causal "why"; that's `causal-inference`. |
| 7 | `@borjie/recommendations` (new) | Buyer-seller match, next-best-action, similar-document, similar-deal; sequential + LLM-based reranking. | Long-form generation; that's `brain-llm-router`. |

Already wired (these the new packages plug into):

- `@borjie/graph-rag-router` (18BB) — query classification + hybrid retrieval.
- `@borjie/knowledge-graph` — entity / relation extraction, community summaries, PROV-O provenance, real-estate + mining ontology.
- `@borjie/research-tools` (18D) — deep-research toolchain.
- `@borjie/forecasting` — TGN + conformal intervals (ports defined; PyTorch sidecar pending).
- `@borjie/graph-privacy` — DP aggregations for cross-tenant moat.
- `@borjie/mining-commodity-intelligence` — domain-specific connectors.

---

## 3. Existing wired pieces — what they cover, what they don't

### 3.1 Already covered
- **Hierarchical retrieval** — `graph-rag-router` does query classification, Louvain/Leiden communities, RRF hybrid retrieval following Microsoft GraphRAG (Edge et al. arXiv:2404.16130, [arxiv.org](https://arxiv.org/abs/2404.16130), 2024-04, "From Local to Global: A Graph RAG Approach to Query-Focused Summarization").
- **Naive graph embeddings + community summary** — `knowledge-graph`.
- **Conformal prediction skeleton** — `forecasting/conformal`.
- **DP aggregations** — `graph-privacy`.
- **Connectors** — LME / USGS / NEMC / Kitco bridges in `mining-commodity-intelligence`.

### 3.2 The gaps the seven siblings close
| Gap | Sibling that closes it |
|---|---|
| No foundation-model forecasting (only TGN port) | `forecasting` — add Chronos-Bolt + TabPFN-TS + Moirai-2 adapters. |
| No descriptive-stats layer; everything goes to LLM | `data-analysis` |
| No actual graph DB — all in-memory | `graph-db` |
| No "why did X cause Y" — only correlation | `causal-inference` |
| No interactive graph render — only static images | `graph-viz` |
| No streaming outlier / drift channel | `anomaly-detection` |
| No matching / next-best-action surface | `recommendations` |

---

## 4. Per-domain SOTA picks + integration

### 4.1 Time-series forecasting — `@borjie/forecasting`

**Foundation models (zero-shot tier)**

The 2025-2026 frontier is **foundation models you can call zero-shot**, not bespoke per-tenant training. The integration pattern is uniform: a tenant's recent history (~ 512–2048 points) becomes context; the model emits quantile forecasts.

- **Chronos-Bolt** (Amazon, T5 encoder-decoder, ~5% lower error and **250× faster** than original Chronos, four sizes Tiny/Mini/Small/Base) — [aws.amazon.com](https://aws.amazon.com/blogs/machine-learning/fast-and-accurate-zero-shot-forecasting-with-chronos-bolt-and-autogluon/), "Fast and accurate zero-shot forecasting with Chronos-Bolt and AutoGluon", 2024-11; weights on HF [huggingface.co/amazon/chronos-bolt-base](https://huggingface.co/amazon/chronos-bolt-base), 2024-11. Primary engine for short-horizon (≤ 90d) gold/copper/USD-TZS forecasts.
- **TimesFM 2.5** (Google, decoder-only, 200M params, 16k context) — [research.google](https://research.google/blog/a-decoder-only-foundation-model-for-time-series-forecasting/), "A decoder-only foundation model for time-series forecasting", 2024-02; [github.com/google-research/timesfm](https://github.com/google-research/timesfm). Long-context tier for monthly+ horizons.
- **Moirai 2.0** (Salesforce, decoder-only, #1 GIFT-Eval MASE, 44% faster + 96% smaller than Moirai-1) — [salesforce.com/blog/moirai-2-0](https://www.salesforce.com/blog/moirai-2-0/), "Introducing Moirai 2.0", 2025-08; [github.com/SalesforceAIResearch/uni2ts](https://github.com/SalesforceAIResearch/uni2ts). Multivariate primary.
- **Moirai-MoE** (mixture-of-experts, +17% over Moirai at the same size, outperforms Chronos / TimesFM with **65× fewer activated params**) — [salesforce.com/blog/time-series-morai-moe](https://www.salesforce.com/blog/time-series-morai-moe/), 2024-11.
- **TimeGPT-2 / 2.1** (Nixtla, **+60% accuracy**, first multivariate in family) — [nixtla.io/blog/timegpt-2-1-announcement](https://www.nixtla.io/blog/timegpt-2-1-announcement), 2025; underlying paper arXiv:2310.03589 ([arxiv.org/abs/2310.03589](https://arxiv.org/abs/2310.03589), 2023-10). Hosted-API fallback when sidecar latency is poor.
- **TabPFN-TS** (Hoo et al. arXiv:2501.02945 — extends TabPFNv2 by temporal featurization, 11M params, **top of GIFT-Eval leaderboard**) — [arxiv.org/abs/2501.02945](https://arxiv.org/abs/2501.02945), "From Tables to Time", 2025-01. Surprise-strength tabular tier for tenant-level small-history forecasts.

**Specialist neural tier (tenant-trained)**

- **N-HiTS** (Challu et al. arXiv:2201.12886, +20% over transformers + 50× faster) — [arxiv.org/pdf/2201.12886](https://arxiv.org/pdf/2201.12886), 2022-01. Long-horizon hierarchical interpolation.
- **N-BEATS** — basis-expansion, M4 SOTA. Both shipped via [Nixtla NeuralForecast](https://pypi.org/project/neuralforecast/0.0.9/).
- **S-Mamba** + selective state-space models for linear-time long-horizon — [sciencedirect](https://www.sciencedirect.com/science/article/abs/pii/S0925231224019490), "Is Mamba effective for time series forecasting?", 2024. Fallback when context length blows transformer attention.
- **TGN (Temporal Graph Networks)** — already in the package — for graph-shaped time series (mine→buyer flows) — Rossi et al. arXiv:2006.10637 ([arxiv.org/pdf/2006.10637](https://arxiv.org/pdf/2006.10637)).

**Uncertainty layer**

- **Inductive conformal prediction** for distribution-free intervals; for non-stationary, **CPTC** (Conformal Prediction for Time-Series with Change Points, NeurIPS 2025) — [arxiv.org/abs/2509.02844](https://arxiv.org/abs/2509.02844), 2025-09. Survey: [arxiv.org/abs/2511.13608](https://arxiv.org/abs/2511.13608), "A Gentle Introduction to Conformal Time Series Forecasting", 2025-11.

**Mining-domain data feeds**

- **LME LMEsource / LMEselectMD** real-time data — [lme.com/market-data](https://www.lme.com/market-data); for derived feeds, Metals-API, Metals.dev (max 60s lag) — [metals.dev/docs](https://metals.dev/docs).
- **USGS Mineral Commodity Summaries 2025** (gold, silver, world production CSVs) — [data.usgs.gov/datacatalog/data/USGS:6797fdc7d34ea8c18376e1a0](https://data.usgs.gov/datacatalog/data/USGS:6797fdc7d34ea8c18376e1a0), 2025-01.
- **Kitco** spot prices (Metal Sentinel API resells Kitco-sourced ticks) — [kitco.com](https://www.kitco.com/), [metal-sentinel.com](https://metal-sentinel.com/), 2025.

**Architecture**

Ports defined in TypeScript (`ForecasterPort`, `CalibratorPort`, `DriverExplainerPort`); adapter to a **Python sidecar service** (`borjie-forecasting-sidecar`) running PyTorch + the four foundation models + `neuralforecast`. The sidecar exposes gRPC `Forecast(series, horizon, quantiles, model_id)`. The TypeScript layer owns provenance, audit hash chain, conformal calibration, and the canonical "forecast bundle" type (point + interval + drivers + citations).

### 4.2 Statistical / data-analysis — `@borjie/data-analysis`

**Pure-TS tier (no sidecar)**

- **simple-statistics** for descriptive + inferential stats — [simple-statistics.github.io](https://simple-statistics.github.io/), [npmjs.com/package/simple-statistics](https://www.npmjs.com/package/simple-statistics).
- **danfo.js v1** (Pandas-for-JS, full TS support) — [github.com/javascriptdata/danfojs](https://github.com/javascriptdata/danfojs); [danfo.jsdata.org](https://danfo.jsdata.org/), 2025.
- **ml-matrix** for linear algebra (latest 6.12.2) — [mljs.github.io/matrix](https://mljs.github.io/matrix/), [npmjs.com/package/ml-matrix](https://www.npmjs.com/package/ml-matrix), 2025.
- **papaparse** for CSV streaming (incl. web workers) — [npmjs.com/package/papaparse](https://www.npmjs.com/package/papaparse), 2025.

**OLAP tier (in-process)**

- **DuckDB Node.js bindings** + **Apache Arrow IPC** (zero-copy, 10–100× faster than plain JS objects) — [duckdb.org/docs/stable/clients/nodejs/reference](https://duckdb.org/docs/stable/clients/nodejs/reference); [duckdb.org/2025/05/23/arrow-ipc-support-in-duckdb](https://duckdb.org/2025/05/23/arrow-ipc-support-in-duckdb), "Arrow IPC Support in DuckDB", 2025-05. This is the engine for "give me last 90 days of mine-X output by shift"-style queries that LLMs should NEVER answer.
- **DuckDB-WASM** for in-browser dashboards (lazy-loaded on demand) — Motif Analytics piece 2024.

**Python sidecar for the things JS can't do well**

When a request needs scikit-learn / statsmodels / `arch` (GARCH) / `lifelines` survival, we route to the same forecasting sidecar (`borjie-stats-sidecar` shares the host). Boundary: anything **iterative / matrix-heavy beyond ml-matrix's wheelhouse** goes Python.

### 4.3 Graph database — `@borjie/graph-db`

Property graph wins for Borjie because: traversal-shaped queries dominate (mine→shipment→buyer→country), embeddings live alongside nodes, no W3C-style cross-org integration mandate. RDF stays an option for compliance-export modes only.

- **Property graph vs RDF** trade-off: property graphs align with embedding workflows + high-speed traversal + AI integration; RDF wins for ontology-reasoning + cross-org standards — [neo4j.com/blog/knowledge-graph/rdf-vs-property-graphs-knowledge-graphs](https://neo4j.com/blog/knowledge-graph/rdf-vs-property-graphs-knowledge-graphs/); [taewoon.kim/2025-10-06-knowledge-graph](https://taewoon.kim/2025-10-06-knowledge-graph/), "What Is a Knowledge Graph?", 2025-10.

**Three adapters, one port**

1. **Kuzu** (embedded, in-process, Cypher-compatible) for tests + low-traffic tenants — **374× faster** than Neo4j on 2-hop paths, **18× faster** ingestion — [thedataquarry.com/blog/embedded-db-2](https://thedataquarry.com/blog/embedded-db-2/); [vela.partners/blog/kuzudb-ai-agent-memory-graph-database](https://vela.partners/blog/kuzudb-ai-agent-memory-graph-database). **Note:** upstream archived Oct 2025 after Apple acquisition; pin **Vela-Engineering/kuzu** fork (concurrent multi-writer).
2. **Neo4j 5.x** (production primary) with native vector index + GraphRAG SDK + APOC — [memgraph.com/blog/neo4j-vs-memgraph](https://memgraph.com/blog/neo4j-vs-memgraph); [arcadedb.com/blog/neo4j-alternatives-in-2026](https://arcadedb.com/blog/neo4j-alternatives-in-2026-a-fair-look-at-the-open-source-options/), 2026.
3. **FalkorDB** (Redis-graph, optional GraphRAG cache) — **500× faster p99 / 10× faster p50** aggregate expansion vs Neo4j; ships GraphRAG-SDK + MCP — [falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j](https://www.falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j/); [falkordb.com/blog/graph-database-ai-agents](https://www.falkordb.com/blog/graph-database-ai-agents/).
4. **Apache AGE** (PostgreSQL extension) — escape hatch for tenants who already run Postgres at scale.
5. **ArangoDB** — only if a tenant wants multi-model (doc + graph + vector) in one — [arangodb.com/2025/09/multi-model-graph-database-to-genai-data-platform](https://arangodb.com/2025/09/multi-model-graph-database-to-genai-data-platform/), 2025-09.

**Connection pooling** lives in this package (PgBouncer-style for Neo4j Bolt). Cypher parameter binding mandatory; no template-string Cypher allowed (lint rule).

**Hybrid vector+graph retrieval** continues to live in `graph-rag-router`; `graph-db` only exposes the underlying graph primitives. RRF fusion already proven — [github.com/Raudaschl/rag-fusion](https://github.com/Raudaschl/rag-fusion); [glaforge.dev/posts/2026/02/10](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/), 2026-02. RRF k=60 default.

### 4.4 Causal inference — `@borjie/causal-inference`

Correlation is not enough for Mr. Mwikila. He needs to ask "if I raise the buyer-side commission, does my churn go down?", and **do-calculus** is the only honest answer.

- **Tigramite / PCMCI+** (Runge, NeurIPS-grade causal discovery on autocorrelated multivariate time series; 2025 application to flood drivers showed robustness) — [github.com/jakobrunge/tigramite](https://github.com/jakobrunge/tigramite); [journals.ametsoc.org/view/journals/aies/4/4/AIES-D-24-0114.1.xml](https://journals.ametsoc.org/view/journals/aies/4/4/AIES-D-24-0114.1.xml), "Evaluating the Robustness of PCMCI+ for Causal Discovery of Flood Drivers", 2025.
- **DoWhy 2.x** (PyWhy, model→identify→estimate→refute) — [github.com/py-why/dowhy](https://github.com/py-why/dowhy); [pywhy.org/dowhy/v0.8/](https://www.pywhy.org/dowhy/v0.8/).
- **EconML v0.16** (Microsoft ALICE — DML, orthogonal forests, causal forests, instrumental DML) — [github.com/py-why/EconML](https://github.com/py-why/EconML), v0.16.0 released 2025-07.
- **Causal Forest** for heterogeneous treatment effects (CATE) — [onlinelibrary.wiley.com/doi/full/10.1111/insr.12610](https://onlinelibrary.wiley.com/doi/full/10.1111/insr.12610), "How Do Applied Researchers Use the Causal Forest?", 2025 International Statistical Review.
- **SHAP** built into EconML for variable importance — same review, 2025.

**Architecture**: TypeScript port `CausalPort` with methods `discoverGraph(series)`, `identifyEffect(graph, treatment, outcome)`, `estimateEffect(query)`, `refute(estimate)`. Adapter calls `borjie-causal-sidecar` (Python, FastAPI). Always emits the assumed DAG so Mr. Mwikila can challenge identifiability. Refutation tests (placebo, random-confounder, subset) **mandatory** before any estimate ships.

### 4.5 Graph visualization — `@borjie/graph-viz`

Borjie shows graphs three ways: a small ad-hoc panel in the chat (≤ 200 nodes), a workspace canvas (≤ 5k nodes), and a "platform map" (≤ 1M nodes, GPU only). Pick the renderer per scale.

- **Cytoscape.js 3.x** (canvas, broad API, react-cytoscapejs binding) — [js.cytoscape.org](https://js.cytoscape.org/); [github.com/plotly/react-cytoscapejs](https://github.com/plotly/react-cytoscapejs). Workspace tier, ≤ 3k nodes before degradation — [pkgpulse.com/blog/cytoscape-vs-vis-network-vs-sigma](https://www.pkgpulse.com/blog/cytoscape-vs-vis-network-vs-sigma-graph-visualization-javascript-2026), 2026.
- **react-flow 12** (node-based workflow UI) — [cambridge-intelligence.com/blog/react-graph-visualization-library](https://cambridge-intelligence.com/blog/react-graph-visualization-library/). Used for any **workflow-shaped** graph (recipe authoring, approval chains).
- **Sigma.js 3 + graphology** (WebGL, event-driven, official React bindings @react-sigma) — same pkgpulse review. WebWorker layout via graphology-layout-forceatlas2.
- **Cosmograph / cosmos.gl** (GPU force-graph, **up to 1M nodes**, WebGL2 / luma.gl, joined OpenJS Foundation 2025) — [github.com/cosmosgl/graph](https://github.com/cosmosgl/graph); [openjsf.org/blog/introducing-cosmos-gl](https://openjsf.org/blog/introducing-cosmos-gl), 2025. Platform map tier.
- **Apache ECharts 6** graph series for analytical overlays + timeline-coupled rendering — [echarts.apache.org/handbook/en/basics/release-note/v6-feature](https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/), ECharts 6 release.
- **D3-force 7** as a layout primitive (never as a renderer) — [observablehq.com/@d3/force-directed-graph](https://observablehq.com/@d3/force-directed-graph).
- **Observable Plot 2** for grammar-of-graphics charts on graph-derived data (degree distribution, community size).

**GenUI contract**: package exports a `GraphBlock` that the front-end's GenUI block registry accepts. Same data shape regardless of renderer; renderer chosen automatically by node count.

### 4.6 Anomaly detection — `@borjie/anomaly-detection`

Two channels — point/outlier on snapshots + drift on streams. Both are **explained** through `causal-inference` once flagged.

**Outlier**

- **Isolation Forest** (real-time screening, works without labels, robust in high dim) — [medium piece](https://medium.com/@jorgemswork/anomaly-detection-without-neural-networks-isolation-forest-lof-and-other-useful-techniques-385e85e68c26), 2024. Recommended best-practice 2025 hybrid: IF first → LOF for flagged → feedback loop — same piece.
- **LOF (Local Outlier Factor)** — density-based, sensitive to k — same piece.
- **Autoencoder reconstruction error** for high-dim sensor data — [shadecoder guide](https://www.shadecoder.com/topics/autoencoder-for-anomaly-detection-a-comprehensive-guide-for-2025), 2025. Caveat: [arxiv.org/html/2501.13864v1](https://arxiv.org/html/2501.13864v1), "Autoencoders for Anomaly Detection are Unreliable", 2025-01 — anomalies far from manifold can reconstruct perfectly; use as a **secondary** signal only.
- **tsfresh** feature construction before IF — same MDPI evaluation 2025.

**Drift**

- **Evidently AI** patterns for data + concept + prediction drift — [arxiv.org/abs/2404.18673](https://arxiv.org/abs/2404.18673), "Open-Source Drift Detection Tools in Action", 2024-04.
- **NannyML** for ground-truth-free performance estimation — same paper.
- **ADWIN** for adaptive windowed drift (balanced detection accuracy/energy) and **KSWIN** for high-accuracy (event-triggered SHAP coupling demonstrated for mining-truck eco-driving) — [journal-isi.org/index.php/isi/article/view/1551](https://journal-isi.org/index.php/isi/article/view/1551), "Real-Time Explainable Concept Drift Detection for Eco-Driving in Mining Trucks", 2024.

**Architecture**: stream + snapshot ports; adapters for the four detectors. Outputs flow into the same audit hash chain as forecasts. Any flagged anomaly auto-spawns a `causal-inference` job that returns the candidate cause — **no anomaly ships to Mr. Mwikila without a "why"**.

### 4.7 Recommendations — `@borjie/recommendations`

Three jobs: buyer↔seller match, next-best-action for an operator, similar-deal / similar-doc retrieval. All three benefit from sequential + LLM-reranked candidates.

- **Matrix factorization** (SVD / NMF) as the classical floor — battle-tested.
- **SASRec** (causal self-attention, BCE / softmax-CE) and **BERT4Rec** (bidirectional, masked) — comparative study finds SASRec with full softmax-CE wins — [arxiv.org/pdf/2309.07602](https://arxiv.org/pdf/2309.07602), "Turning Dross Into Gold Loss: is BERT4Rec really better than SASRec?", 2023.
- **eSASRec** (modular enhancements, RecSys 2025) — [arxiv.org/pdf/2508.06450](https://arxiv.org/pdf/2508.06450), 2025-08.
- **BSARec** comparative replicability — [arxiv.org/html/2506.14692v1](https://arxiv.org/html/2506.14692v1), 2025-06.
- **P5** (T5-based unified rec, Pretrain-Prompt-Predict) — [arxiv.org/pdf/2203.13366](https://arxiv.org/pdf/2203.13366); reproducibility study [dl.acm.org/doi/10.1145/3640457.3688072](https://dl.acm.org/doi/10.1145/3640457.3688072), RecSys 2024.
- **GenRec** (LLaMA fine-tuned for generative recommendation) — [arxiv.org/pdf/2307.00457](https://arxiv.org/pdf/2307.00457).
- **Uncertainty quantification** for LLM-rec — [arxiv.org/pdf/2501.17630](https://arxiv.org/pdf/2501.17630), 2025-01.

**Multi-tenant pattern**: per-tenant `tenant_id` partitioning by Postgres RLS — [zenn.dev/shineos/articles/saas-multi-tenant-architecture-2025](https://zenn.dev/shineos/articles/saas-multi-tenant-architecture-2025?locale=en), 2025. No cross-tenant collaborative filtering except through `graph-privacy` DP aggregations.

**Architecture**: candidate-generation port (SASRec adapter) → reranker port (LLM via `brain-llm-router`) → diversity / business-rule layer → audit chain. Cold-start path uses `knowledge-graph` neighborhood expansion.

---

## 5. Mining-domain mapping — TZ problems × tools

| Mr. Mwikila's question | Tool chain |
|---|---|
| "What will gold close at end-of-quarter?" | LME/Kitco connector → `forecasting` Chronos-Bolt + CPTC interval. |
| "What's my royalty bill next quarter at +5% production?" | `data-analysis` (DuckDB roll-up) → `forecasting` TabPFN-TS tenant tier → narrative. |
| "Who in my buyer book consistently pays above market?" | `data-analysis` (z-score over price) → `recommendations` (rank). |
| "Did the new shift policy reduce safety incidents?" | `causal-inference` DoWhy diff-in-diff + Causal Forest CATE per crew. |
| "Show me the flow of gold from my mines to all buyers last 90d." | `graph-db` Cypher → `graph-viz` Cosmograph / Sigma rendering. |
| "Which deal looks like one I won last year?" | `knowledge-graph` neighborhood + `recommendations` SASRec rerank. |
| "Alert me when shift output drifts from baseline." | `anomaly-detection` ADWIN on rolling output → `causal-inference` "why" → push notification. |
| "What's NEMC's typical permit-renewal turnaround?" | `data-analysis` descriptive stats over `mining-commodity-intelligence` connector — NEMC issued default notices to 95 license-holders 2025-05-06, regulatory landscape per [dlapiperafrica](https://www.dlapiperafrica.com/en/tanzania/insights/2025/A29085_legal_alert_flyer_v2_africa-insight-item), 2025. |
| "Match me with a buyer for 80oz dore at LBMA fix +X%." | `recommendations` two-tower → `knowledge-graph` for compliance constraints. |

Local-content regulations 2025 (GN 563/2025; mandatory reserved goods list 2025-11-14): all recommendations involving suppliers must filter by `is_tanzanian_owned` predicate from the org-graph — [tanzaniainvest.com](https://www.tanzaniainvest.com/mining/mining-local-content-regulations-goods-services-list-2026); [dentons.com](https://www.dentons.com/en/insights/alerts/2025/november/27/mandatory-reservation-of-goods-and-services-in-the-mining-sector-for-indigenous-tanzanian-companies), 2025-11.

---

## 6. Architecture — ports, adapters, sidecars

### 6.1 Layering

```
TypeScript ports  (in @borjie/*)
       │
       ├── In-memory adapters    (test + dev)
       ├── Native JS adapters    (ml-matrix, simple-statistics, Cytoscape)
       └── Sidecar adapters      (gRPC → Python services)
               │
               ├── borjie-forecasting-sidecar  (PyTorch + Chronos / Moirai / TabPFN-TS / Tigramite-ish)
               ├── borjie-causal-sidecar       (DoWhy + EconML + Tigramite)
               ├── borjie-anomaly-sidecar      (sklearn + pyod + river)
               └── borjie-graph-sidecar        (igraph / networkx where Cypher is awkward)
```

Sidecars are **internal-only** services on the cluster bus. The TypeScript layer never embeds a Python runtime; it speaks gRPC, owns retries / circuit-breakers / tracing.

### 6.2 Neo4j connection pool

Lives in `@borjie/graph-db/src/neo4j-pool.ts`. Bolt driver with:
- Max pool size = `NEO4J_POOL_MAX` env (default 32).
- Connection acquisition timeout 5s.
- Health check ping every 30s.
- Per-tenant `database` separation (`database: tenant.id`) so even at the driver level cross-tenant queries are impossible.

### 6.3 Provenance

Every value emitted (forecast, anomaly, recommendation, edge) carries a `provenance: ProvO[]` chain hashed by `@borjie/audit-hash-chain`. Mr. Mwikila taps a number → modal shows raw source rows + transform DAG + model id + timestamp.

### 6.4 Two retrieval lanes

`graph-rag-router` continues to own routing. New addition: it can call out to `causal-inference` when the query class is **`why`** (regex-keyed plus LLM classifier), in addition to the existing vector / graph_local / graph_global / hybrid classes from GraphRAG (Edge et al. 2024).

---

## 7. Live-test discipline — no synthetic training data in production

- Synthetic data allowed **only** in unit tests, fast-check property tests, and Storybook fixtures.
- Every adapter ships with a **live-only smoke test** behind `CI=true && LIVE_DATA=true` flag (skipped on PRs, run nightly).
- No model is allowed to train on synthesized rows in production. Where labels are sparse (e.g., anomaly), we use **unsupervised** detectors (IF, LOF, autoencoder) on real tenant data with a feedback loop driven by Mr. Mwikila's "Was this useful?" thumbs.
- Foundation models (Chronos / Moirai / TabPFN-TS / TimesFM) are **always zero-shot**. We never fine-tune on tenant data inside the platform — fine-tuning happens only in a tenant-isolated, DP-bounded job inside `graph-privacy` (`borjie-finetune-sidecar`, future).
- Conformal calibration uses only the tenant's own held-out residuals.

---

## 8. Per-tenant isolation invariants

1. **Schema layer** — every row carries `tenant_id`; every Cypher query carries a `WHERE n.tenantId = $tenantId`; lint rule blocks Cypher without tenant binding.
2. **Connection layer** — Neo4j per-tenant database; Postgres RLS policy `tenant_isolation` on every table with `tenant_id`. Pattern from [zenn.dev/shineos/articles/saas-multi-tenant-architecture-2025](https://zenn.dev/shineos/articles/saas-multi-tenant-architecture-2025?locale=en), 2025.
3. **Sidecar layer** — every gRPC call carries `tenant_id` in metadata; sidecar refuses calls whose payload references entities not in that tenant's namespace.
4. **Cross-tenant** — only `graph-privacy` allowed to emit aggregate stats, with ε / δ DP guarantees, and only after the row count crosses a k-anonymity threshold (≥ 10 distinct tenants).
5. **Drift / anomaly comparisons** — never reach across tenants; baseline is always the tenant's own historic window.
6. **Recommendations** — collaborative-filtering uses only intra-tenant interactions; cross-tenant similarity comes from the DP platform graph only.
7. **Kubernetes ResourceQuotas** per tenant namespace to defeat the noisy-neighbor problem — same 2025 SaaS architecture review.

---

## 9. Top-7 next concrete builds (the seven sibling agents)

Each one is a separate workspace package, each its own agent.

1. **Agent A — `@borjie/forecasting` (uplift)**: keep TGN port; add Chronos-Bolt + TabPFN-TS + Moirai-2 + TimesFM adapters via `borjie-forecasting-sidecar`; wire CPTC for non-stationary intervals; add LME / USGS / Kitco feature joiners. **Deliverable**: forecast bundle returning `{point, q10, q90, drivers[], citations[], modelId, calibrationKind}` for a TZ gold-price 30-day horizon end-to-end live test.
2. **Agent B — `@borjie/data-analysis` (new)**: DuckDB + Arrow IPC adapter, simple-statistics wrappers, danfo.js DataFrame port; CSV/Parquet/Arrow ingestion via papaparse + Arrow JS; descriptive + inferential primitives (t-test, χ², ANOVA, OLS via ml-matrix). **Deliverable**: "median shift output last 30d ± 95% CI" inside chat in < 200ms.
3. **Agent C — `@borjie/graph-db` (new)**: Kuzu (Vela fork) + Neo4j 5 + FalkorDB + Apache AGE adapters behind one port; connection pool; Cypher param-binding lint rule. **Deliverable**: same Cypher query swaps cleanly across all three backends; per-tenant database isolation proven by a red-team test.
4. **Agent D — `@borjie/causal-inference` (new)**: Tigramite / PCMCI+ + DoWhy + EconML sidecar; identifiability + refutation always-on; emit DAG with every estimate. **Deliverable**: "did new shift policy reduce incidents?" answered with DML estimate + placebo refutation + drivers.
5. **Agent E — `@borjie/graph-viz` (new)**: GenUI block + Cytoscape / react-flow / Sigma / Cosmograph adapters, autoscale by node count; ECharts overlays; provenance modal. **Deliverable**: 50k-node tenant graph renders interactively in the workspace canvas at 60 FPS.
6. **Agent F — `@borjie/anomaly-detection` (new)**: IF + LOF + AE + ADWIN/KSWIN adapters; stream + snapshot ports; auto-spawn causal explainer. **Deliverable**: a synthetic shift-output drift fires within 2 windows + the causal sidecar returns a candidate cause.
7. **Agent G — `@borjie/recommendations` (new)**: SASRec / eSASRec primary, LLM rerank via `brain-llm-router`, P5/GenRec experimental; multi-tenant RLS; Tanzanian-owned filter for local-content compliance. **Deliverable**: a buyer-seller match call returning ranked candidates with reason codes.

Wave-target sequencing: A + C in parallel (sidecar + DB are the longest tails); then B + E (UI-bound); then D + F (depend on A and B); then G last (depends on B + C + E).

---

## 10. Deferred / future research

- **HippoRAG 2** as a memory tier under `graph-rag-router` — bring biomimetic LTM in once GraphRAG-style summarisation is stable — [marktechpost.com/2025/03/03/hipporag-2-advancing-long-term-memory-and-contextual-retrieval-in-large-language-models](https://www.marktechpost.com/2025/03/03/hipporag-2-advancing-long-term-memory-and-contextual-retrieval-in-large-language-models/), 2025-03; underlying paper [arxiv.org/abs/2405.14831](https://arxiv.org/abs/2405.14831).
- **LightRAG** dual-level retrieval as an A/B against current GraphRAG router (EMNLP 2025 Findings) — [aclanthology.org/2025.findings-emnlp.568](https://aclanthology.org/2025.findings-emnlp.568/); [arxiv.org/abs/2410.05779](https://arxiv.org/abs/2410.05779).
- **LATTICE** LLM-guided hierarchical retrieval (arXiv:2510.13217, BRIGHT +9% Recall@100) — [arxiv.org/abs/2510.13217](https://arxiv.org/abs/2510.13217), 2025-10. Candidate to replace `graph-rag-router`'s flat top-level routing with LLM-driven tree navigation.
- **KAG / OpenSPG** for professional-domain rigour (HotpotQA +19.6%, 2wiki +33.5%) — [arxiv.org/abs/2409.13731](https://arxiv.org/abs/2409.13731); [github.com/OpenSPG/openspg](https://github.com/OpenSPG/openspg). Worth a spike once compliance Q&A becomes a P0.
- **Differential privacy + federated learning** via Opacus + Flower — [github.com/meta-pytorch/opacus](https://github.com/meta-pytorch/opacus); [towardsdatascience.com/differentially-private-federated-learning-with-flower-and-opacus](https://towardsdatascience.com/differentially-private-federated-learning-with-flower-and-opacus-e14fb0d2d229/). Move `graph-privacy` from DP-aggregations to true federated SGD when buyer-network scale justifies.
- **Coden** continuous-prediction TGN — [arxiv.org/html/2602.12613v1](https://arxiv.org/html/2602.12613v1) — replace the current TGN scaffold when we ship workplace-streaming.
- **Causal foundation models** — too early as of 2026-05; revisit Q4 2026.

---

## Appendix A — citation index (selected)

(Every claim above hyperlinks to its source inline; this is the compact index. URL · title · date.)

**Forecasting**
- arxiv.org/abs/2310.03589 · TimeGPT-1 · 2023-10
- nixtla.io/blog/timegpt-2-1-announcement · TimeGPT 2.1 · 2025
- huggingface.co/amazon/chronos-bolt-base · Chronos-Bolt · 2024-11
- aws.amazon.com/blogs/machine-learning/fast-and-accurate-zero-shot-forecasting-with-chronos-bolt-and-autogluon · Chronos-Bolt + AutoGluon · 2024-11
- salesforce.com/blog/moirai-2-0 · Moirai 2.0 · 2025-08
- salesforce.com/blog/time-series-morai-moe · Moirai-MoE · 2024-11
- arxiv.org/abs/2501.02945 · TabPFN-TS · 2025-01
- research.google/blog/a-decoder-only-foundation-model-for-time-series-forecasting · TimesFM · 2024-02
- arxiv.org/pdf/2201.12886 · N-HiTS · 2022-01
- sciencedirect.com/.../S0925231224019490 · Mamba for TS · 2024
- arxiv.org/abs/2509.02844 · CPTC NeurIPS 2025 · 2025-09
- arxiv.org/abs/2511.13608 · Conformal TS survey · 2025-11

**Graph / KG**
- arxiv.org/abs/2404.16130 · Microsoft GraphRAG · 2024-04
- arxiv.org/abs/2405.14831 · HippoRAG · 2024-05
- marktechpost.com/2025/03/03/hipporag-2 · HippoRAG 2 · 2025-03
- arxiv.org/abs/2410.05779 · LightRAG · 2024/2025 EMNLP Findings
- arxiv.org/abs/2510.13217 · LATTICE · 2025-10
- arxiv.org/abs/2409.13731 · KAG · 2024-09 / WWW 2025
- neo4j.com/blog/knowledge-graph/rdf-vs-property-graphs-knowledge-graphs · 2025
- thedataquarry.com/blog/embedded-db-2 · Kuzu vs Neo4j · 2025
- falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j · 2025
- arangodb.com/2025/09/multi-model-graph-database-to-genai-data-platform · 2025-09

**Stats**
- simple-statistics.github.io · simple-statistics · live
- github.com/javascriptdata/danfojs · danfo.js v1 · 2025
- duckdb.org/2025/05/23/arrow-ipc-support-in-duckdb · Arrow IPC in DuckDB · 2025-05
- npmjs.com/package/papaparse · papaparse · 2025
- mljs.github.io/matrix · ml-matrix 6.12.2 · 2025

**Causal**
- github.com/jakobrunge/tigramite · Tigramite / PCMCI+ · live
- journals.ametsoc.org/.../AIES-D-24-0114.1.xml · PCMCI+ flood drivers · 2025
- github.com/py-why/dowhy · DoWhy · live
- github.com/py-why/EconML · EconML v0.16 · 2025-07
- onlinelibrary.wiley.com/doi/10.1111/insr.12610 · Causal Forest review · 2025

**Viz**
- js.cytoscape.org · Cytoscape.js · live
- cambridge-intelligence.com/blog/react-graph-visualization-library · 2025
- pkgpulse.com/blog/cytoscape-vs-vis-network-vs-sigma · 2026
- openjsf.org/blog/introducing-cosmos-gl · cosmos.gl · 2025
- echarts.apache.org/handbook/en/basics/release-note/v6-feature · ECharts 6 · 2025
- observablehq.com/@d3/force-directed-graph · D3-force · live

**Anomaly / drift**
- shadecoder.com/topics/autoencoder-for-anomaly-detection · 2025
- arxiv.org/html/2501.13864v1 · AE unreliability · 2025-01
- arxiv.org/abs/2404.18673 · Drift tools study · 2024-04
- journal-isi.org/.../1551 · KSWIN mining-truck · 2024

**Recommendations**
- arxiv.org/pdf/2309.07602 · SASRec vs BERT4Rec · 2023
- arxiv.org/pdf/2508.06450 · eSASRec · 2025-08
- arxiv.org/html/2506.14692v1 · BSARec replicability · 2025-06
- arxiv.org/pdf/2203.13366 · P5 · 2022
- arxiv.org/pdf/2307.00457 · GenRec · 2023
- arxiv.org/pdf/2501.17630 · LLM-rec uncertainty · 2025-01

**Mining data + TZ regs**
- lme.com/market-data · LME Market Data · live
- metals.dev/docs · Metals.dev · 2025
- data.usgs.gov/datacatalog/data/USGS:6797fdc7d34ea8c18376e1a0 · USGS MCS 2025 Gold · 2025-01
- pubs.usgs.gov/periodicals/mcs2025/mcs2025-silver.pdf · USGS MCS 2025 Silver · 2025-01
- kitco.com · Kitco · live
- metal-sentinel.com · Metal Sentinel (Kitco-sourced) · 2025
- lexafrica.com/2026/01/tanzania-mining-local-content-regulations · TZ local content · 2026-01
- tanzaniainvest.com/mining/mining-local-content-regulations-goods-services-list-2026 · 2026
- dlapiperafrica.com/en/tanzania/insights/2025/A29085 · TZ license compliance · 2025
- dentons.com/.../mandatory-reservation-of-goods-and-services · 2025-11

**Cross-cutting**
- zenn.dev/shineos/articles/saas-multi-tenant-architecture-2025 · 2025
- github.com/Raudaschl/rag-fusion · RAG-Fusion + RRF · live
- glaforge.dev/posts/2026/02/10 · RRF deep-dive · 2026-02
- github.com/meta-pytorch/opacus · Opacus · live

---

*End — this spec is the charter for the seven sibling build-out
agents. They take it as ground-truth and ship their packages inside
the boundaries above.*
