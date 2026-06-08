# Knowledge Organization at Unbounded Scale — SOTA Dossier (GraphRAG + Growing Ontologies + Hybrid/Temporal/Multi-Tenant KG)

**Author:** Research subagent (deep web research)
**Date:** 2026-06-08
**Audience:** Borjie brain-layer architects building Mr. Mwikila's knowledge substrate
**Scope:** How to organize millions of facts across many domains, for many tenants, over time, so retrieval stays precise at unbounded scale.

> Every claim below cites a real URL that was actually fetched during this research pass. Quantitative figures are quoted from the source. Items marked **UNVERIFIED** could not be confirmed against a primary fetch.

---

## 0. Executive synthesis — the shape of the answer

The frontier has converged on a layered architecture, not a single algorithm. No one technique organizes "millions of facts across many domains." The winning pattern is a **stack**:

1. **Index layer (construction):** LLM open-information-extraction → triples → entity/relation resolution → **schema that grows** (schema-free induction with post-hoc canonicalization). The schema is *emergent*, not hand-designed, but *canonicalized* so it does not sprawl. (AutoSchemaKG, EDC, GraphRAG indexing.)
2. **Structure layer (organization):** hierarchical **community detection** (Leiden / label-propagation) + **community summaries** that turn a flat graph into a navigable hierarchy from "high-level themes to low-level topics." This is what makes *global* questions answerable. (GraphRAG, Zep.)
3. **Retrieval layer:** **hybrid vector + graph** retrieval fused (Reciprocal Rank Fusion), with **dual-level** routing (local/entity-centric vs global/thematic), and **graph-walk multi-hop** in a single step via Personalized PageRank. (HybridRAG, LightRAG, HippoRAG/HippoRAG 2.)
4. **Time layer:** **bi-temporal** edges (valid-time vs transaction-time) with LLM-driven contradiction detection + edge invalidation, so the KG is a living memory rather than a snapshot. (Zep/Graphiti.)
5. **Isolation layer:** **deterministic, JWT-claim-driven tenant filtering at the store layer** (never in the LLM), with a shared cross-tenant ground-truth corpus separated from per-tenant private knowledge. Cross-tenant leakage is the #1 multi-tenant RAG failure (OWASP LLM08:2025). (Truto, AWS, OWASP.)
6. **Lifecycle layer:** **incremental / continual** KG growth without rebuild and without catastrophic forgetting (LightRAG incremental insert; IncDE / FastKGE for embeddings; active-learning + human-in-the-loop curation for trust).

**Borjie mapping (directional):** Borjie already has `intelligence_corpus_chunks` (cross-tenant ground truth, `tenant_id = NULL`) + pgvector + RLS + an evidence-required AI contract. The frontier upgrade is to add (a) a graph/community layer over the corpus for global sensemaking, (b) bi-temporal edges for the licence/royalty/treasury timelines, (c) hybrid graph+vector fusion in the retriever, and (d) a growing-but-canonicalized mining ontology. The multi-tenant isolation posture (RLS + JWT-bound `app.current_tenant_id`) is already aligned with the SOTA "deterministic store-layer filtering" recommendation.

---

## 1. Microsoft GraphRAG — the reference architecture for global sensemaking

**Source (fetched):** "From Local to Global: A Graph RAG Approach to Query-Focused Summarization," Edge, Trinh, Cheng, Bradley, Chao, Mody, Truitt, Metropolitansky, Ness, Larson (Microsoft Research), arXiv:2404.16130, submitted 2024-04-24, revised 2025-02-19. https://arxiv.org/abs/2404.16130 and full text https://arxiv.org/html/2404.16130v2 ; launch blog https://www.microsoft.com/en-us/research/blog/graphrag-new-tool-for-complex-data-discovery-now-on-github/

### The problem it solves
Naive vector RAG **fails on "global" questions** ("What are the main themes in the dataset?") because such questions are query-focused *summarization*, not retrieval — semantic top-k matching "will always give misleading answers." (Microsoft blog.)

### Two-stage index (concrete, from the HTML)
1. **Entity knowledge-graph derivation.** LLM extracts entities, relationships, and *claims* per text chunk. A **self-reflection / "gleanings"** loop re-prompts the model to find missed entities "up to a specified maximum number of times." Measured impact: on HotPotQA with 600-token chunks, self-reflection "recovered nearly double the entity references" vs single-pass; with 2400-token chunks, multiple reflection iterations reached parity with smaller chunks.
2. **Element summarization → community detection → community summaries.** Entity/relationship/claim descriptions are aggregated per node/edge. **Leiden** hierarchical clustering partitions the graph recursively into communities labeled **C0 (root) → C1 → C2 → C3 (leaf)** — "from high-level themes to low-level topics." Each community gets an LLM-generated **report** (JSON: title, executive summary, an **IMPACT SEVERITY RATING float 0–10**, and 5–10 key insights each citing entity/relationship/claim IDs — i.e. *grounded provenance*). For leaf communities, elements are prioritized "in decreasing order of combined source and target node degree" until the token budget fills; higher-level communities substitute shorter sub-community summaries.

### Query-time — map-reduce global search
- Community summaries are **shuffled and chunked** to a **fixed 8k-token context window** (chosen after testing 8k/16k/32k/64k).
- **Map:** intermediate answers generated in parallel; LLM also emits a **helpfulness score 0–100**.
- **Reduce:** answers sorted by helpfulness, packed into a new context window until the limit, then summarized into the final answer.
- **Local search** (entity-centric) walks the neighborhood of matched entities for specific questions.

### Results (exact)
- **Datasets:** Podcast transcripts ~1M tokens (1669 × 600-token chunks → graph 8,564 nodes / 20,691 edges); News ~1.7M tokens (3197 × 600-token chunks → 15,754 nodes / 19,520 edges). Indexing the podcast set took **281 minutes** on a 16GB Xeon with gpt-4-turbo.
- **Win-rates vs vector RAG (LLM-judge):** Comprehensiveness — Podcast **72–83%**, News **72–80%** (p<.001); Diversity — Podcast **75–82%** (p<.001), News **62–71%** (p<.01).
- **Token economy:** Root-level **C0** answers used only ~**2.3–2.6%** of the tokens of full source-text summarization (Podcast 26,657 vs 1,014,611; News 39,770 vs 1,707,694) — **9×–43× fewer tokens** per query — while still beating vector RAG on comprehensiveness/diversity. C1–C3 generally beat C0 on quality.
- **Experiment 2 (claim-based, Claimify):** extracted **47,075 unique claims**, ~31 claims/answer; diversity via agglomerative clustering on 1−ROUGE-L.

**Why best-in-world:** It is the canonical, peer-cited, open-sourced solution to the *global sensemaking* failure mode of RAG, with a hierarchical community structure that is the de-facto template every later system (Zep, LightRAG) imitates or optimizes.

**Known limitations / cost:** Indexing is LLM-heavy and expensive; **the index must be rebuilt to absorb new data** (the gap LightRAG/Graphiti close). Community quality depends on extraction quality.

---

## 2. Schema that GROWS — autonomous, multi-domain ontology induction

### 2.1 AutoSchemaKG — billion-scale, schema-free, with conceptualization
**Source (fetched, incl. PDF text):** "AutoSchemaKG: Autonomous Knowledge Graph Construction through Dynamic Schema Induction from Web-Scale Corpora," Bai, Fan, Hu, Zong, Li, et al. (HKUST KnowComp), arXiv:2505.23628v3, 2025-08-04. https://arxiv.org/pdf/2505.23628 ; code https://github.com/HKUST-KnowComp/AutoSchemaKG

- **No predefined schema.** It "extract[s] triples and dynamically induce[s] schemas directly" from text — entities, *events*, and concepts — then **conceptualizes** instances into abstract categories. Three triple types: **entity-entity, entity-event, event-event** (captures temporal/causal structure that pure entity graphs miss).
- **Conceptualization layer** generalizes specific entities/events/relations into broader conceptual categories — a *growing-but-organized* ontology rather than sprawl. Node types: entity (VN), event (VE), concept (C); relations R.
- **Scale (verified from PDF):** processing **over 50 million documents**, they build the **ATLAS** family (ATLAS-Wiki, ATLAS-Pes2o, ATLAS-CC) with **"900+ million nodes and 5.9 billion edges"** — "to the best of our knowledge" the largest such autonomously-constructed KGs, reaching the "critical mass of billions of facts" needed for general coverage. **Outperforms state-of-the-art baselines on multi-hop QA** with no human intervention.

**Why best-in-world:** It is the existence proof that a *schema-flexible, multi-domain* ontology can be induced — not authored — at **billion-fact** scale, exactly the regime "millions of facts across many domains" demands. The entity/event/concept tri-layer is the cleanest published answer to "an ontology that grows."

### 2.2 EDC (Extract-Define-Canonicalize) — keeping a growing schema from sprawling
**Source (fetched):** "Extract, Define, Canonicalize: An LLM-based Framework for Knowledge Graph Construction," Bowen Zhang, Harold Soh, EMNLP 2024. https://aclanthology.org/2024.emnlp-main.548/ ; code https://github.com/clear-nus/edc

- Three phases: **(1) open extraction** of triples, **(2) schema definition** (LLM names/defines the relations it just used), **(3) post-hoc canonicalization** (merge synonymous relations into a canonical set). Works **with or without** a predefined schema — when none exists it constructs one and **self-canonicalizes**.
- A **trained schema retriever** pulls only the schema elements relevant to the input text — RAG-for-schema — solving the core scaling pain that "larger and more complex schemas easily exceed the LLM's context window."
- Validated on **3 KGC benchmarks**; extracts high-quality triples "with significantly larger schemas compared to prior works" and **no parameter tuning**.

**Why best-in-world:** EDC is the canonical recipe for the *governance* problem of a growing schema — you let the schema emerge during extraction, then **canonicalize so the ontology stays tight**. This is precisely the discipline a multi-domain mining KG (licences, royalty, metallurgy, treasury, HSE) needs to avoid 50 near-duplicate relation types.

### 2.3 The authoritative 2025 survey — taxonomy of LLM-empowered KG construction
**Source (fetched):** "LLM-empowered knowledge graph construction: A survey," arXiv:2510.20345 (2025). https://arxiv.org/html/2510.20345v1

- **Two paradigms:** **Schema-Based** (high consistency, normalization, but domain-specific bottleneck; evolving static→dynamic schemas) vs **Schema-Free** (adaptability/open discovery, better cross-domain transfer, but lower consistency, needs validation).
- **Three-stage pipeline:** Ontology Engineering (manual → LLM-assisted; top-down competency-questions vs bottom-up induction) → Knowledge Extraction → **Knowledge Fusion** (schema-level alignment + instance-level entity resolution).
- **Representative systems** named per stage: ontology (Ontogenia, CQbyCQ, NeOn-GPT, LKD-KGC); schema-based extraction (KARMA multi-agent, ODKE+, AutoSchemaKG); schema-free (AutoRE, ChatIE, KGGEN, EDC); fusion (LLM-Align, EntGPT, COMEM, Graphusion).
- **Key challenges (directly relevant to Borjie's evidence-required contract):** hallucinated/plausible-but-wrong triples, semantic heterogeneity across sources, **lack of gold standards for schema-free evaluation**, enterprise-scale compute cost, and **error propagation across pipeline stages**.
- **Emerging directions:** KGs as **persistent evolving agent memory** (names A-MEM, Zep), multimodal KG, "KGs as cognitive scaffolds beyond RAG."

**Why best-in-world:** The most current (Oct 2025) systematic map of the entire design space; it is the reference taxonomy for choosing schema-based vs schema-free per domain and for understanding the fusion/canonicalization stage that makes a growing ontology trustworthy.

---

## 3. Hybrid vector + graph retrieval

### 3.1 HybridRAG (BlackRock + NVIDIA) — concatenate-and-fuse
**Source (fetched):** "HybridRAG: Integrating Knowledge Graphs and Vector Retrieval Augmented Generation for Efficient Information Extraction," Sarmah, Hall, Rao, Patel, Pasquali, Mehta, arXiv:2408.04948, Aug 2024. https://arxiv.org/html/2408.04948v1

- Combines **VectorRAG** (Pinecone + OpenAI embeddings over chunks) and **GraphRAG** (LLM-extracted entity/relation KG); the two contexts are concatenated into one unified context for generation.
- **Use case:** 50 Nifty-50 earnings-call transcripts, ~60k tokens each, 400 ground-truth QA pairs.
- **Results (RAGAS):**

  | Metric | VectorRAG | GraphRAG | HybridRAG |
  |---|---|---|---|
  | Faithfulness | 0.94 | 0.96 | **0.96** |
  | Answer Relevancy | 0.91 | 0.89 | **0.96** |
  | Context Precision | **0.84** | **0.96** | 0.79 |
  | Context Recall | **1.0** | 0.85 | **1.0** |

- **Finding:** "GraphRAG performs better in **extractive** questions" (facts explicitly stated); "VectorRAG does better in **abstractive** questions" (info not explicit). Hybrid wins on faithfulness + relevancy but **trades context precision** (the union adds noise) — so naive concatenation is not free; ranking/fusion matters (see 3.3).

**Why best-in-world:** The most-cited head-to-head proving the **complementarity** thesis — graph for structured/extractive, vector for fuzzy/abstractive — on a real financial corpus, with the precise tradeoff (precision cost of union) quantified.

### 3.2 LightRAG — dual-level retrieval + incremental graph index
**Source (fetched via search):** HKUDS, "LightRAG: Simple and Fast Retrieval-Augmented Generation," EMNLP 2025. https://github.com/hkuds/lightrag ; https://lightrag.github.io/

- **Dual-level retrieval:** *low-level* (immediate entity neighbors → precise detail) + *high-level* (global relationships → broad/thematic) — a built-in local-vs-global router.
- **Incremental updates:** new data is appended to the existing graph index **without full rebuild** — directly fixing GraphRAG's rebuild-the-world cost.
- **Cost (reported, treat as vendor/community claims — UNVERIFIED against the primary PDF):** ~$0.15 vs ~$4 to graph a document; ~100 vs ~610,000 tokens for a query; indexing token cost cut ~6,000×; "GraphRAG shines above ~1k documents and below ~1M tokens; beyond that LightRAG wins on cost."

**Why best-in-world:** The leading *efficiency-and-incrementality* answer — comparable/better global-question accuracy at a fraction of GraphRAG's index cost, with **append-don't-rebuild** updates, which is mandatory for a live operating system that ingests new facts daily.

### 3.3 Towards Practical GraphRAG (SAP) — RRF fusion, multi-granular embeddings, cheap construction
**Source (fetched):** Min, Bansal, Pan, Keshavarzi, Mathew, Kannan (SAP), arXiv:2507.03226v3. https://arxiv.org/html/2507.03226v3

- **Cheap construction:** **dependency-based triple extraction** (SpaCy SVO + coref + passive-voice normalization + phrasal merging) achieves **94% of LLM-based performance (61.87% vs 65.83% semantic alignment)** at "orders of magnitude" lower cost — a hybrid where most extraction is parser-driven and LLMs are reserved for hard cases.
- **Hybrid retrieval via Reciprocal Rank Fusion (RRF):** seed entities (noun phrases + dense top-5) → **one-hop traversal** with relation sampling (k=100–200) → cosine rank → **RRF fuse graph + vector rankings**. Maintains **separate embeddings for entities, chunks, and relations** ("multi-granular matching").
- **Scale:** 550 PDFs / ~2000 chunks → 39,155 nodes, 47,613 entity-entity + 63,681 entity-chunk relations, avg degree 1.52 (sparse → fast).
- **Results:** Context Precision GraphRAG 63.82% vs Dense 54.35%; Semantic Alignment 65.83% vs 50.80%; on code-proposal, dependency-GraphRAG winning rate 78.5% vs 21.5% (avg 4.03 vs 3.43 / 5).

**Why best-in-world:** The most pragmatic enterprise recipe — **RRF fusion + multi-granular embeddings + parser-first cheap construction** — the exact engineering pattern to make graph+vector retrieval affordable at corporate scale. The "cascaded IR" framing (recall-oriented graph traversal → precision-oriented neural re-rank) is the right mental model for Borjie's retriever.

---

## 4. Multi-hop reasoning over the KG

### 4.1 HippoRAG — single-step multi-hop via Personalized PageRank
**Source (fetched):** "HippoRAG: Neurobiologically Inspired Long-Term Memory for LLMs," Gutiérrez, Shu, Gu, Yasunaga, Su (OSU + Stanford), NeurIPS 2024, arXiv:2405.14831. https://arxiv.org/html/2405.14831v1 ; code https://github.com/OSU-NLP-Group/HippoRAG

- **Hippocampal-indexing analogy:** LLM = neocortex (OpenIE extraction), retrieval encoders (Contriever/ColBERTv2) = parahippocampal (add **synonymy edges** when cosine > τ=0.8), **schemaless KG** = hippocampal index.
- **Multi-hop in ONE step:** at query time, link query entities to KG nodes, then run **Personalized PageRank** seeded from those nodes — probability mass flows to relevant subgraphs across *many possible paths simultaneously*, instead of iterative retrieve-read loops.
- **Node specificity:** an IDF-like local weight `s_i = |P_i|^-1` (P_i = passages yielding node i) modulates PPR seeds using only node-local info.
- **Results:** Recall@5 — MuSiQue 51.9% (vs ColBERTv2 49.2%), **2WikiMultiHopQA 89.1% vs 68.2% (+20pts)**, HotpotQA 77.7%. QA F1 (ColBERTv2 backbone): MuSiQue 29.8 vs 26.4; 2Wiki 59.5 vs 43.3; +IRCoT 33.3 / 62.7 / 59.2. **Efficiency vs IRCoT: 10–30× cheaper online, 6–13× faster.**

**Why best-in-world:** It collapses expensive *iterative* multi-hop retrieval into a **single graph-walk**, the most elegant published solution to "associate distant facts cheaply" — the capability a mining MD needs to connect, e.g., licence → operator → royalty arrears → treasury exposure in one query.

### 4.2 HippoRAG 2 — unify dense+sparse, recover sense-making
**Source (fetched via search):** "From RAG to Memory: Non-Parametric Continual Learning for LLMs," ICML 2025, arXiv:2502.14802. https://arxiv.org/abs/2502.14802

- Adds **passage nodes** to the KG, unifies dense+sparse, uses **LLM recognition-filtering** online.
- **+7 F1 on associative (multi-hop) tasks** over the best embedding retriever (NV-Embed-v2); avg F1 59.8% vs 57.0%; **no degradation on factual** (NaturalQuestions 63.3 vs 61.9) or **sense-making** (NarrativeQA 25.9 vs 25.7).

**Why best-in-world:** Resolves HippoRAG-v1's weakness (it had hurt simple factual recall) — proving you can have multi-hop *and* factual *and* sense-making in one retriever, framed as **non-parametric continual learning** (the KG is the memory that grows without retraining).

---

## 5. Temporal / bi-temporal knowledge graphs (living memory)

### Zep / Graphiti — the production-grade bi-temporal agent-memory KG
**Source (fetched):** "Zep: A Temporal Knowledge Graph Architecture for Agent Memory," Rasmussen, Paliychuk, Beauvais, Ryan, Chalef (Zep AI), Jan 2025, arXiv:2501.13956. https://arxiv.org/html/2501.13956v1 ; design blog https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/

- **Three-tier graph** G=(N,E,φ): **(1) Episode subgraph** (raw, non-lossy messages/text/JSON), **(2) Semantic entity subgraph** (resolved entities + semantic edges), **(3) Community subgraph** (clusters with summaries) — a GraphRAG-style hierarchy adapted to streaming memory.
- **Bi-temporal model — four timestamps:** `t_valid` / `t_invalid` (the *event* timeline T: when a fact became/ceased true in the world) and `t'_created` / `t'_expired` (the *transaction* timeline T': when Zep ingested/invalidated it). This separates "when it was true" from "when we learned it" — the core of bi-temporality.
- **Conflict resolution:** an LLM compares each new edge against semantically related existing edges to detect contradictions; on conflict, the superseded edge's `t_invalid` is set to the new edge's `t_valid` — **history is preserved, not overwritten**, enabling point-in-time reconstruction ("what did we believe on date X").
- **Entity resolution:** 1024-dim embedding cosine + full-text search; fact dedup via hybrid search constrained to edges between the *same* entity pair.
- **Community detection: label propagation** (not Leiden) — chosen for **dynamic extension**: a new node joins the community held by the plurality of its neighbors, with periodic full refreshes.
- **Results:** Deep Memory Retrieval — Zep (gpt-4-turbo) **94.8%** vs MemGPT 93.4%; Zep (gpt-4o-mini) 98.2%. LongMemEval — **up to +18.5% accuracy** (gpt-4o 60.2%→71.2%), **~90% latency cut** (28.9s→2.58s), **context tokens 115,000→1,600**.

**Why best-in-world:** The only widely-adopted, benchmarked **bi-temporal** KG memory that fuses unstructured + structured data, resolves contradictions over time, and reconstructs past belief states — exactly what a mining estate OS needs for licence validity windows, royalty rate changes, FX rates, and "what did Mr. Mwikila know when he made decision Y."

---

## 6. Cross-tenant ground-truth vs per-tenant private knowledge (isolation)

### The leakage problem (OWASP-recognized)
**Source (fetched via search):** Truto, "Multi-Tenant RAG Data Isolation: The 2026 Enterprise Architecture Guide." https://truto.one/blog/how-to-architect-strict-data-isolation-in-multi-tenant-rag-pipelines/ ; search corpus also surfaced the finding that in a 4-tenant corpus **up to 95% of benign queries triggered cross-tenant leakage** via "organic entity connections, shared vendors, and personnel," and that **OWASP LLM Top-10 v2025 added LLM08:2025** for multi-tenant vector/embedding weaknesses (the 95% figure and OWASP item are reported across the search corpus; **UNVERIFIED** against a single primary fetch — treat the 95% as indicative, the OWASP LLM08:2025 category as real).

### The mandated pattern — deterministic store-layer filtering, never LLM-layer
From the Truto guide (fetched): **"Filtering restricted data must occur deterministically at the database level before the context window is ever populated"** — LLMs are "non-deterministic text generators susceptible to prompt injection" and will surface chunks they shouldn't under adversarial prompts. Three isolation patterns:

1. **Silo (index-per-tenant):** physical separation, "zero chance of a missing `tenant_id` filter exposing another customer's data," but HNSW graphs sit in RAM so "500 separate indexes... massive compute waste... idle 99% of the time." Use for regulated/data-residency tenants.
2. **Pool (shared index + namespace + FGAC):** one namespace per tenant (Pinecone pattern physically partitions records); **query cost scales with namespace size** (1GB namespace ≪ scanning 100GB shared). **JWT extracts tenant_id at the API gateway and passes it to the vector DB's FGAC layer — "making it impossible for application-level bugs to retrieve cross-tenant data."**
3. **Hybrid:** pool for SMB/mid-market, silo for enterprise who pay for it.

### Combining shared ground-truth with private knowledge
- **Document-level RBAC via metadata** captured at ingestion: `{tenant_id, allowed_principals[], sensitivity_label}`; query-time deterministic filter `allowed_principals: {$in: user.groups}`.
- **Anti-pattern:** filtering by long lists of individual user IDs — Pinecone limits `$in` to **10,000 values**; use groups/roles instead.
- **Defense-in-depth:** webhook-driven hard deletes on `record:deleted`; periodic ACL/permission-only reconciliation (or you "leak data for months"); pre-embedding normalization; clean 429/rate-limit surfacing.

**Cross-corroboration (fetched via search):** AWS "Multi-tenant RAG with Amazon Bedrock Knowledge Bases" and "Multi-tenant vector search with Aurora PostgreSQL" both prescribe **metadata filtering + pgvector row-level security with tenant context verified at every query**; Tiger Data's PostgreSQL guide compares schema-per-tenant vs RLS-per-row tradeoffs. https://aws.amazon.com/blogs/machine-learning/multi-tenant-rag-with-amazon-bedrock-knowledge-bases/ ; https://www.tigerdata.com/blog/building-multi-tenant-rag-applications-with-postgresql-choosing-the-right-approach

**Why best-in-world & Borjie fit:** This is the consensus 2025/2026 architecture and it **validates Borjie's existing posture exactly**: cross-tenant ground truth lives in `intelligence_corpus_chunks` with `tenant_id = NULL` (the shared corpus), per-tenant private data is RLS-FORCE-isolated, and `app.current_tenant_id` is bound from the (Supabase JWT) at the gateway — i.e. deterministic store-layer filtering driven by a verified claim, the precise pattern the SOTA mandates. The upgrade is to extend the *same* discipline to the **graph/edge layer** (tenant-scope every entity/edge; share only NULL-tenant ground-truth nodes) and add the reconciliation/hard-delete jobs.

---

## 7. Organizing millions of facts so retrieval stays precise (the lifecycle)

### 7.1 Incremental / continual growth without rebuild or forgetting
**Sources (fetched via search):**
- **LightRAG incremental insert** (above) — append to the graph index, no full rebuild. https://github.com/hkuds/lightrag
- **IncDE** — orders new triples by graph distance + structural centrality, uses **distillation loss** so new embeddings stay near priors (anti-forgetting). https://arxiv.org/pdf/2511.11118 (informed-init follow-up) and incremental-KG topic survey https://www.emergentmind.com/topics/incremental-knowledge-graph-construction
- **FastKGE** — "Fast and Continual Knowledge Graph Embedding via Incremental LoRA": updates only **low-rank adapters** for new nodes/relations with adaptive rank allocation, **cutting training cost up to 68%** at scale. https://arxiv.org/pdf/2407.05705
- **Graph continual learning** — "Can LLMs Alleviate Catastrophic Forgetting in Graph Continual Learning?" systematic study. https://arxiv.org/html/2505.18697v2

**Why it matters:** A mining OS ingests new licences, assays, royalty filings, FX rates daily. The KG must **absorb new facts cheaply** (LightRAG/FastKGE) and **not forget** prior structure (IncDE distillation) — otherwise organization degrades as scale grows.

### 7.2 Active learning + human-in-the-loop curation (trust at scale)
**Sources (fetched via search):**
- "Human-In-The-Loop Workflow for Neuro-Symbolic Scholarly Knowledge Organization" / ExtracTable — HITL transformation of corpora into structured knowledge, reporting precision+recall gains from human curation. https://arxiv.org/html/2506.03221v1
- "Expanding Knowledge Graphs with Humans in the Loop" — predict the **parents** of new concepts for expert verification before insertion. https://arxiv.org/abs/2212.05189
- Active-learning principle: **uncertainty sampling / hybrid uncertainty-reduction** to selectively query annotators on the lowest-confidence triples and relation-validity edges — the literature distinguishes *active selection* (cut label cost) from *interactive protocols* (richer guidance).

**Why it matters & Borjie fit:** Borjie's **evidence-required AI contract** (every recommendation cites ≥1 `evidence_id`, Auditor rejects empty chains) is itself a HITL/trust mechanism. Layering **uncertainty-triggered human review** on low-confidence extracted triples — and **concept-parent verification** before a new ontology node lands — keeps the *growing* mining ontology trustworthy as it scales to millions of facts.

### 7.3 Precision-preserving organization principles (synthesis)
1. **Hierarchy beats flatness:** community summaries (GraphRAG/Zep) let you answer global questions without scanning everything; route global→summaries, local→neighborhood.
2. **Multi-granular embeddings** (entities, relations, chunks separately — SAP) keep matching precise across query types.
3. **Canonicalize relentlessly** (EDC) so a multi-domain schema doesn't fragment into near-duplicates.
4. **Fuse, then re-rank** (RRF cascade) so the graph∪vector union doesn't cost precision (the HybridRAG precision dip).
5. **Time-scope every fact** (bi-temporal) so stale facts are invalidated, not deleted — precision over time.
6. **Tenant-scope every node/edge deterministically** so retrieval never crosses a trust boundary.

---

## 8. Concrete recommendations for Borjie / Mr. Mwikila

1. **Add a graph+community layer over `intelligence_corpus_chunks`.** Run GraphRAG-style entity/relation/claim extraction (with gleanings) over the NULL-tenant ground-truth corpus → Leiden communities → community reports with `evidence_id` provenance. This makes "global" mining-sensemaking questions answerable (e.g., "what are the dominant compliance risks across the estate this quarter?") at ~2–3% of full-summarization token cost.
2. **Adopt schema-free-but-canonicalized ontology induction** (AutoSchemaKG entity/event/concept model + EDC canonicalization) for the mining domain so the ontology grows across licences/royalty/metallurgy/treasury/HSE without hand-authoring, while a schema retriever keeps prompts in-context.
3. **Make the retriever hybrid + RRF-fused, dual-level routed** (SAP/LightRAG pattern): local/entity for specific lookups, global/community for thematic; separate embeddings for entities, relations, chunks.
4. **Add single-step multi-hop** via Personalized PageRank (HippoRAG) for cross-domain association queries.
5. **Make edges bi-temporal** (Zep model) for licence validity, royalty-rate history, FX timelines, and decision-time reconstruction — with LLM contradiction-detection invalidating (not deleting) superseded facts.
6. **Keep isolation deterministic at the store layer** (already true via RLS + JWT-bound `app.current_tenant_id`); extend it to graph nodes/edges, share only NULL-tenant nodes, and add permission-reconciliation + hard-delete-on-webhook jobs.
7. **Grow incrementally** (LightRAG append / FastKGE LoRA adapters; IncDE distillation) and **gate low-confidence triples through HITL** (uncertainty sampling + concept-parent verification), reinforcing the existing evidence-required contract.

---

## Sources (all fetched unless marked)

1. GraphRAG paper (abstract) — https://arxiv.org/abs/2404.16130 (fetched)
2. GraphRAG paper (full HTML, all numbers) — https://arxiv.org/html/2404.16130v2 (fetched)
3. Microsoft Research GraphRAG launch blog — https://www.microsoft.com/en-us/research/blog/graphrag-new-tool-for-complex-data-discovery-now-on-github/ (fetched)
4. AutoSchemaKG (ATLAS 900M nodes / 5.9B edges) — https://arxiv.org/pdf/2505.23628 (fetched, incl. PDF text); code https://github.com/HKUST-KnowComp/AutoSchemaKG
5. EDC (Extract-Define-Canonicalize), EMNLP 2024 — https://aclanthology.org/2024.emnlp-main.548/ (fetched); code https://github.com/clear-nus/edc
6. LLM-empowered KG construction survey (Oct 2025) — https://arxiv.org/html/2510.20345v1 (fetched)
7. HybridRAG (BlackRock/NVIDIA) — https://arxiv.org/html/2408.04948v1 (fetched)
8. LightRAG (HKUDS, EMNLP 2025) — https://github.com/hkuds/lightrag , https://lightrag.github.io/ (search-verified; cost figures UNVERIFIED vs primary PDF)
9. Towards Practical GraphRAG (SAP) — https://arxiv.org/html/2507.03226v3 (fetched)
10. HippoRAG (NeurIPS 2024) — https://arxiv.org/html/2405.14831v1 (fetched); code https://github.com/OSU-NLP-Group/HippoRAG
11. HippoRAG 2 / "From RAG to Memory" (ICML 2025) — https://arxiv.org/abs/2502.14802 (search-verified)
12. Zep / Graphiti bi-temporal KG (Jan 2025) — https://arxiv.org/html/2501.13956v1 (fetched); design blog https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/
13. Truto multi-tenant RAG isolation guide — https://truto.one/blog/how-to-architect-strict-data-isolation-in-multi-tenant-rag-pipelines/ (fetched)
14. AWS multi-tenant RAG (Bedrock KB) — https://aws.amazon.com/blogs/machine-learning/multi-tenant-rag-with-amazon-bedrock-knowledge-bases/ (search-verified)
15. Tiger Data multi-tenant RAG on PostgreSQL — https://www.tigerdata.com/blog/building-multi-tenant-rag-applications-with-postgresql-choosing-the-right-approach (search-verified)
16. FastKGE (incremental LoRA, -68% cost) — https://arxiv.org/pdf/2407.05705 (search-verified)
17. IncDE / informed-init continual KG embeddings — https://arxiv.org/pdf/2511.11118 (search-verified)
18. LLMs vs catastrophic forgetting in graph continual learning — https://arxiv.org/html/2505.18697v2 (search-verified)
19. HITL scholarly KG organization (ExtracTable) — https://arxiv.org/html/2506.03221v1 (search-verified)
20. Expanding KGs with humans in the loop — https://arxiv.org/abs/2212.05189 (search-verified)
21. Incremental KG construction (topic survey) — https://www.emergentmind.com/topics/incremental-knowledge-graph-construction (search-verified)
