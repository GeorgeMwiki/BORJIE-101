# Knowledge Verification, Freshness & Provenance — SOTA Dossier

**Audience:** Borjie brain-layer architects (Mr. Mwikila), central-intelligence
kernel, ai-copilot juniors, intelligence-corpus ingestion.
**Date:** 2026-06-08
**Question this answers:** As Borjie's knowledge base grows without bound
(corpus chunks, LMBM evidence, agent-learned facts, market/regulatory data),
how do we keep every fact **correct, current, and cited** — so that no stale or
wrong fact ever drives an autonomous MD decision?

> **Borjie hard rule this dossier serves:** *"Evidence-required AI output. Every
> junior recommendation cites ≥1 evidence_id from LMBM or intelligence corpus.
> The Auditor Agent rejects responses with empty evidence chains."* (CLAUDE.md)
> This document is the SOTA spine behind that rule and extends it from
> *citation-present* to *citation-verified, conflict-resolved, freshness-scored,
> and provenance-tracked.*

Every numbered finding cites a URL actually fetched during research. Items not
fetched are marked **UNVERIFIED**.

---

## 0. The seven-layer trust stack (executive map)

Trustworthy infinite knowledge is not one technique; it is a **pipeline of
gates**, each rejecting a different failure mode. Order matters — cheap
deterministic checks first, expensive model-based checks last.

| Layer | Failure it stops | SOTA mechanism | Borjie wiring target |
|------|------------------|----------------|----------------------|
| 1. **Evidence grounding** | "I made it up" | Retrieval + entity/relationship graph populating context (GraphRAG) | corpus retrieval → context |
| 2. **Citation / attribution** | "cited but not supported" | NLI-entailment citation recall+precision (ALCE, AutoAIS) | Auditor Agent evidence-chain check |
| 3. **Atomic-fact verification** | "mix of true+false in one answer" | Decompose → verify each atomic fact (FActScore, SAFE) | per-claim verification before emit |
| 4. **Conflict / contradiction resolution** | "two sources disagree" | Truth-discovery (sensitivity/specificity, source-reliability EM) + temporal constraints | LMBM fact-fusion |
| 5. **Source-trust weighting** | "low-quality source wins by volume" | Iterative reliability estimation; not majority vote | source_reliability column |
| 6. **Recency / staleness** | "correct but outdated" | Deterministic recency resolver + valid-time TKG | as-of queries, decay, re-validation |
| 7. **Confidence / abstention** | "confidently wrong" | Semantic entropy, calibration, refuse/escalate | NOI threshold + human-in-loop |
| (cross-cut) **Provenance / lineage** | "can't audit how we knew" | W3C PROV (entity/activity/agent) + OpenLineage | hash-chained audit + lineage graph |

The rest of this dossier treats each layer in depth, then gives the Borjie
implementation blueprint (§9).

---

## 1. Evidence grounding — retrieval + knowledge-graph context

**The principle:** an LLM should answer *from retrieved structured evidence*,
not from parametric memory, and every assertion should carry **source-grounding
information** at generation time.

### 1.1 Microsoft GraphRAG — provenance-first retrieval

Source fetched: <https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/>

- GraphRAG combines **text extraction, network analysis, and LLM
  summarization** into one end-to-end system. It extracts entities and
  relationships into an LLM-generated knowledge graph, then uses that graph to
  populate the context window with **higher-relevance** material tied directly
  to original sources.
- **Provenance is a first-class output.** The system provides "provenance, or
  source grounding information, as it generates each response." Each assertion
  carries citations back to specific source documents (with publication dates and
  highlighted text excerpts), so "a human user [can] quickly and accurately
  **audit** the LLM's output directly against the original source material."
- **Pre-generated community summaries** carry "provenance back to original source
  material," allowing claim verification against raw documents.
- **Faithfulness:** measured with SelfCheckGPT, GraphRAG achieves "similar level
  of faithfulness to baseline RAG" while improving comprehensiveness. The
  grounding mechanism functionally reduces hallucination by constraining outputs
  to dataset-derived structures.

### 1.2 GraphRAG mechanics (Local / Global / DRIFT)

Source fetched: search synthesis incl. arXiv:2404.16130 *"From Local to Global:
A Graph RAG Approach to Query-Focused Summarization"*
<https://arxiv.org/html/2404.16130v2> and DRIFT
<https://www.microsoft.com/en-us/research/blog/introducing-drift-search-combining-global-and-local-search-methods-to-improve-quality-and-efficiency/>

- Build KG from documents → detect **communities of related entities with the
  Leiden algorithm**, applied **hierarchically** (recursively partition until
  leaf communities) → generate hierarchical NL summaries → use that structure at
  query time.
- **Global search** answers corpus-wide "sense-making" questions via community
  summaries; **local search** answers entity-specific questions; **DRIFT search**
  (Dynamic Reasoning and Inference with Flexible Traversal, late-2024) does a
  semantic search over community reports for a broad answer, generates follow-up
  questions, runs them as parallel local searches, then re-ranks and merges.
- **Evaluation:** on a podcast corpus (~1M tokens; 8,564 entities; 20,691 edges)
  and a news corpus (~1.7M tokens; 15,754 entities; 19,520 edges), GraphRAG won
  **72–83% comprehensiveness** and **62–82% diversity** head-to-head vs naive RAG.
- **Why best-in-world:** GraphRAG is the reference design for *citable*,
  multi-hop, corpus-spanning answers with built-in source attribution — exactly
  what an estate "company brain" needs when a single decision depends on facts
  scattered across licences, royalty rules, and market reports.

**Borjie takeaway:** the intelligence corpus already ingests chunks
(`tenant_id = NULL` ground truth). A GraphRAG-style entity/relationship layer on
top of `intelligence_corpus_chunks` would let Mr. Mwikila answer cross-document
("how does this royalty change interact with this off-take contract") *with
per-assertion provenance* rather than chunk-bag similarity.

---

## 2. Citation & attribution verification — "cited" ≠ "supported"

A citation is worthless unless an automated check confirms the cited passage
**actually entails** the statement. This is the core of Borjie's Auditor rule.

### 2.1 ALCE — citation recall & precision via NLI entailment

Source fetched: <https://ar5iv.labs.arxiv.org/html/2305.14627> and
<https://arxiv.org/abs/2305.14627> (Gao et al., *Enabling LLMs to Generate Text
with Citations*, EMNLP 2023 — the first automatic benchmark for LLM citation
evaluation, "ALCE").

Three evaluation dimensions: **fluency** (MAUVE), **correctness**
(dataset-specific: exact-match / claim-recall), and **citation quality** (recall
+ precision via NLI entailment). Formal definitions extracted:

- **Citation recall = 1** for statement *sᵢ* iff (a) at least one citation
  exists (𝒞ᵢ ≠ ∅) **and** (b) the **concatenated cited passages entail the
  statement** — `ϕ(concat(𝒞ᵢ), sᵢ) = 1`, where ϕ is an NLI model (TRUE). Scored
  binary per statement, averaged.
- **Citation precision** detects *irrelevant* citations. A citation `c_{i,j}` is
  irrelevant iff (a) it alone does **not** support the statement
  `ϕ(c_{i,j}, sᵢ)=0` **and** (b) the remaining citations still fully support it
  `ϕ(concat(𝒞ᵢ\{c_{i,j}}), sᵢ)=1`. Each citation scores precision 1 only when
  the statement has recall=1 and the citation is not irrelevant.
- Human evaluation confirmed **strong correlation** of these automatic metrics
  with human judgement.
- **Why best-in-world:** ALCE turned "does it cite sources?" into a *measurable,
  NLI-grounded* recall/precision pair. This is the exact operationalization of
  Borjie's "Auditor rejects empty/weak evidence chains" — recall<1 = unsupported
  claim → reject; precision<1 = padded citations → flag.

### 2.2 Attribution ≠ correctness; AutoAIS lineage

Source fetched: search synthesis incl. arXiv:2406.15264 *"Towards Fine-Grained
Citation Evaluation"* <https://arxiv.org/html/2406.15264v1> and arXiv:2412.18004
*"Correctness is not Faithfulness"* <https://arxiv.org/pdf/2412.18004>.

- **Attribution** = whether *every claim* in the response is **supported by its
  cited evidence** — formally distinct from *citation correctness* (right source
  pointer) and from *answer correctness* (right answer). A response can be
  correct yet unfaithful (right answer, wrong/no support) — a silent trust
  failure.
- Lineage of automated attribution verification: **AutoAIS** (Google,
  NLI-based) → **ALCE** → **AttributionBench**. NLI models are the workhorse for
  "does cited text entail the claim."
- **Borjie takeaway:** the Auditor must check **faithfulness** (claim entailed by
  evidence), not merely "an evidence_id is attached." A junior that returns the
  right number with an unrelated `evidence_id` must still be rejected.

### 2.3 Atomic-fact decomposition — FActScore & SAFE

Source fetched: search synthesis incl. arXiv:2305.14251 *FActScore*
<https://arxiv.org/abs/2305.14251> (Min et al., EMNLP 2023) and GitHub
<https://github.com/shmsw25/factscore>.

- **FActScore** decomposes a long-form generation into **atomic facts** and
  computes the **% of atomic facts supported** by a reliable knowledge source —
  because real answers are a *mix* of supported and unsupported pieces, so binary
  quality judgement is inadequate.
- The automated estimator (retrieval + strong LM) tracks human FActScore with
  **<2% error**. Headline: ChatGPT scored only **58% FActScore** on people
  biographies — i.e., ~42% of atomic facts unsupported.
- **SAFE** (DeepMind, *Long-form factuality / Search-Augmented Factuality
  Evaluator*) extends this: split into atomic facts, then *for each fact* issue
  Google searches and reason over results — automated, search-grounded
  per-fact verification. **UNVERIFIED** (named in searches but page not fetched).
- **Why best-in-world:** atomic decomposition is the only way to give a junior's
  multi-claim recommendation a *granular* trust score instead of a coarse
  pass/fail. Borjie can attach a per-recommendation FActScore-style metric:
  "8/9 atomic claims source-grounded; 1 flagged for human review."

---

## 3. Conflict & contradiction detection across sources

When two corpus chunks, two market feeds, or a learned fact and a regulation
disagree, the system must **detect** the conflict and **resolve** it — not
silently pick the higher-ranked chunk.

### 3.1 Temporal constraint conflict detection on KGs

Source fetched: search synthesis incl. arXiv:2304.09015 **PaTeCon**
<https://arxiv.org/pdf/2304.09015>, arXiv:2312.11053 *"Conflict Detection for
Temporal KGs: A Fast Constraint…"* <https://arxiv.org/pdf/2312.11053>, and
Springer *"Explainable Temporal Fact Validation Through Constraints Discovery"*
<https://link.springer.com/chapter/10.1007/978-3-031-94575-5_13>.

- Facts under **exclusivity constraints** (one birth date, one *current* primary
  licence-holder, one active royalty rate) are contradicted by newly added
  conflicting info during updates → need resolution that accounts for **context,
  source reliability, and temporal cues**.
- **PaTeCon** mines temporal constraints (patterns) **automatically** from the
  graph and flags facts that violate them — no hand-authored rules.
- **Explainable temporal fact validation** classifies facts by temporal validity
  using discovered simple+complex temporal constraints over an entity's timeline,
  and is *explainable* (it can say *why* a fact is judged valid/invalid).
- **Why best-in-world:** mined temporal constraints turn "two values for the same
  exclusive slot" into an *auto-detected* contradiction with an explanation —
  ideal for licence/royalty/owner-of-record facts where only one value can be
  valid at any instant.

### 3.2 Conflict-aware extraction & agentic resolution

Source fetched: search synthesis incl. arXiv:2509.11330 *"Decoding Plastic
Toxicity… Conflict-Aware Relational Metapath Extraction"*
<https://arxiv.org/pdf/2509.11330> and arXiv:2603.25097 *ElephantBroker*
<https://arxiv.org/pdf/2603.25097>.

- Methods now resolve conflicting relations from different sources **based on
  confidence scores and source credibility** rather than first-write-wins.
- *EvoKG*-style frameworks build/update KGs from unstructured text while
  explicitly handling **contradiction and noise** in temporal facts.
  **UNVERIFIED** (named in search snippet; primary not fetched).
- **Borjie takeaway:** when two juniors (or two ingest passes) assert different
  values, route to a **resolution step** keyed on (source reliability × recency ×
  entailment-strength), and *record the losing claim* with the reason — never
  delete it (audit-chain principle).

---

## 4. Source-trust & reliability weighting — truth discovery

The classical, battle-tested answer to "which source do I believe when they
conflict": **jointly infer the truth and each source's reliability** —
reliability is *latent*, learned from agreement patterns, not assigned by hand.

### 4.1 Bayesian truth discovery (sensitivity/specificity)

Source fetched: arXiv:1203.0058 *"A Bayesian Approach to Discovering Truth from
Conflicting Sources for Data Integration"* (Zhao et al., VLDB 2012) —
<https://arxiv.org/pdf/1203.0058>.

- Each source's reliability is modelled by two latent parameters:
  **sensitivity** (P[source says true | truly true]) and **specificity**
  (P[source says false | truly false]) — allowing **asymmetric, heterogeneous**
  source quality instead of a single accuracy number.
- Truth values and source parameters are inferred **simultaneously** via an
  EM-style loop: init truth (majority vote) → E-step estimate source params from
  current truth beliefs → M-step reweight truth probabilities by source
  reliability → iterate to convergence.
- The weighting is the key mechanism: a positive claim contributes to posterior
  truth in proportion to the source's **sensitivity**; a negative claim in
  proportion to its **specificity**. Sources that drift from emerging consensus
  lose weight.
- **Why best-in-world:** it handles **systematic bias** and **copying/plagiarism
  between sources** far better than majority vote — exactly the regime of mining
  market data where many feeds echo one another.

### 4.2 The optimization view + TruthFinder + evolving truth

Source fetched: search synthesis incl. SIGMOD-2014 truth-discovery
<https://dl.acm.org/doi/10.1145/2588555.2610509>, arXiv:1509.00104 *"Truth
Discovery to Resolve Object Conflicts in Linked Data"*
<https://arxiv.org/pdf/1509.00104>, and PMC *"On the Discovery of Evolving
Truth"* <https://pmc.ncbi.nlm.nih.gov/articles/PMC4688022/>.

- General framing: minimize the **reliability-weighted deviation** between
  inferred truths and per-source observations, with truths and source weights as
  two coupled unknown variable sets.
- **TruthFinder** ("a website is trustworthy if it provides many facts with high
  confidence; a fact is confident if asserted by trustworthy sources") iterates
  to a fixed point and gave **~10% relative improvement over naive majority
  vote.**
- **Evolving truth:** dedicated algorithms capture **temporal relations** among
  both facts and source reliability — both evolve over time (a source good last
  year may be stale now). This is the bridge to §5.
- **Why best-in-world:** these are the *deployed, decade-proven* algorithms
  behind enterprise data fusion; they convert "trust by gut" into "trust by
  measured, evolving reliability."

**Borjie takeaway:** add a `source_reliability` (and a per-source
sensitivity/specificity) that is **learned from agreement history**, not a static
admin field. Weight conflict resolution and confidence by it.

---

## 5. Recency, staleness & re-validation — "correct but outdated" is still wrong

The most insidious failure for an autonomous MD: a fact that *was* true. Royalty
rates change, licences expire, prices move, owners-of-record transfer.

### 5.1 Don't ask the LLM to track freshness — deterministic resolution

Source fetched: arXiv:2606.01435 *"Don't Ask the LLM to Track Freshness: A
Deterministic Recipe for Memory Conflict Resolution"* —
<https://arxiv.org/html/2606.01435v1>.

- **The problem is brutal:** on MemoryAgentBench's FactConsolidation task, even
  the best published system (HippoRAG-v2) hits only **54%** single-hop; temporal
  KG systems (Zep/Graphiti) **7%**; **all 22 systems ≤7% on multi-hop.** Despite
  prompts explicitly stating "newer facts have larger serial numbers," LLMs fail
  to apply the rule.
- **Two LLM failure modes:** *Prior-Override* (when training-data priors conflict
  with the newer fact, the LLM emits its prior despite freshness rules) and
  *Serial-Comparison Drift* (as context grows, the LLM loses track of which
  serial is largest — accuracy 75% @64K → 61% @262K).
- **The deterministic recipe:** (1) BM25 retrieve top-10 candidate facts; (2) LLM
  extracts which retrieved facts semantically answer the question, **preserving
  version metadata**; (3) **deterministic Python `max(serial)`** picks the newest
  — bypassing LLM judgement for the freshness decision.
- **Results:** single-hop **78.0%** (gpt-4o-mini, +24pp over HippoRAG-v2;
  **82% @262K**, +28pp), **94.8%** with gpt-4o; multi-hop **30.2%** (+23pp over
  best published). Matched-setup swap LLM→deterministic = **+10.8pp** average,
  **+21pp** at longest context.
- **Key insight:** the bottleneck is **assembly (post-retrieval aggregation)**,
  *not storage*. Elaborate KG/agentic memory doesn't help; **deterministic code
  wins.** This mirrors Borjie's own MEMORY note: *"move freshness/recency into
  deterministic code rather than LLM prompting — exact, cheaper, auditable."*
- **Why best-in-world:** it is the cleanest, most quantified proof that **freshness
  must be a deterministic resolver over versioned facts**, never an LLM judgement.

### 5.2 Valid-time temporal KGs & decay

Source fetched: search synthesis incl. arXiv:2509.19376 *"Solving Freshness in
RAG: A Simple Recency Prior…"* <https://arxiv.org/pdf/2509.19376>, ACM CIKM 2025
*"When Facts Expire: Benchmarking Temporal Validity in Knowledge Graphs"*
<https://dl.acm.org/doi/10.1145/3746252.3761648>, arXiv:2603.11768 *SSGM —
Governing Evolving Memory* <https://arxiv.org/html/2603.11768v1>, and
arXiv:2510.07238 *"When Benchmarks Age"* <https://arxiv.org/html/2510.07238>.

- **Valid-time modelling:** TKGs (Wikidata/YAGO style) attach **time-bound
  validity intervals** to facts. *Validating* those intervals to ensure TKG
  reliability remains underexplored — a research frontier, not a solved problem.
- **Temporal obsolescence** = the failure where stored info is *factually
  correct but outdated*; without **decay functions** agents retrieve and act on
  stale data. A time-aware scoring method **fuses content similarity with recency
  weighting** at retrieval.
- **Stale-input regression (critical):** even when a model's *internal* knowledge
  is updated, including **outdated retrieved passages causes it to regress toward
  the older information** — updated knowledge is **not robust** against stale
  input. ⇒ You cannot rely on the model to "know better"; you must *not feed it
  stale evidence*.
- **Benchmarks age:** static snapshot benchmarks become misleading as facts
  expire; LLM accuracy degrades sharply on newly-introduced / time-sensitive
  questions. ⇒ Borjie's own evals must be **re-validated on a clock.**
- **Why best-in-world:** these works establish the discipline: **stamp every fact
  with valid-from / valid-to + an as-of**, decay confidence over time, and
  **re-validate** before the fact drives a decision.

### 5.3 Re-validation as a continual process

- Combine §4 (evolving truth) + §5.1 (deterministic recency) + §5.2 (valid-time):
  a fact is not "true forever once cited." It carries an **expiry / re-check
  cadence**; on read past expiry it is **re-validated** (re-retrieve source,
  re-run entailment) before use, else its confidence is **discounted** and the
  consuming junior is told.

---

## 6. Hallucination-resistance via retrieval + verification loops

Beyond grounding (§1), SOTA closes the loop: the model **critiques its own
retrieval and generation** and revises.

### 6.1 Self-RAG — learn to retrieve, generate, critique

Source fetched: <https://selfrag.github.io/> and
<https://arxiv.org/abs/2310.11511> (Asai et al., ICLR 2024).

- A single LM emits **reflection tokens** that gate the whole pipeline:
  - **Retrieve** — decide *whether* retrieval is needed for this segment (adaptive,
    can retrieve many/once/never);
  - **IsRel** (relevance) — is the retrieved passage pertinent?
  - **IsSup** (support) — **do the retrieved passages substantiate the
    generation?** (the grounding check);
  - **IsUse** (utility) — overall response quality.
- Inference uses **segment-level beam search interpolating critique-token
  probabilities**, so operators can dial up "supported-by-evidence" weight
  *without retraining.*
- **Results:** Self-RAG 7B/13B **outperforms ChatGPT and retrieval-augmented
  Llama2-Chat across six tasks**; on open-domain QA, removing retrieval costs ~40%
  relative; on fact-verification (PubHealth) only ~2% — i.e., it learned *when*
  evidence matters.
- **Why best-in-world:** it bakes the **"is this supported?"** gate into
  generation, making support-checking *intrinsic*, not a bolt-on.

### 6.2 Corrective RAG (CRAG) & verification loops

Source fetched: search synthesis (Self-RAG/CRAG family) — see
<https://arxiv.org/abs/2310.11511> result set.

- **CRAG** adds a **retrieval evaluator**: if retrieved evidence is judged
  insufficient/incorrect, it **triggers corrective actions** (e.g., web search,
  re-retrieval, decompose-then-recompose) before generating.
- Self-RAG + CRAG define the pattern: **verification loops that assess retrieved
  evidence and revise outputs** — primarily for *internal consistency* (answer
  aligns with context).
- **Borjie takeaway:** the kernel already debates/critiques; wire a CRAG-style
  **evidence-sufficiency gate** so that "evidence too thin / contradictory" =
  re-retrieve or escalate, *never* answer-anyway.

### 6.3 Metamorphic / structural hallucination auditing

Source fetched: search synthesis incl. arXiv:2509.09360 **MetaRAG**
<https://arxiv.org/html/2509.09360v2>, arXiv:2512.01659 **HalluGraph**
<https://arxiv.org/html/2512.01659v1>, and the LLM-hallucination survey
arXiv:2510.06265 <https://arxiv.org/pdf/2510.06265>.

- **MetaRAG (2025):** *metamorphic testing* — decompose the answer into factoids,
  apply **mutation rules** and check factual consistency vs retrieved evidence,
  **zero-resource, black-box** (no labels, no logits needed) — deployable as an
  online auditor.
- **HalluGraph (2025, legal RAG):** **structural verification via KG alignment** —
  align generated text to a knowledge graph and **penalize structural mismatches**;
  significantly outperforms semantic-similarity and NLI baselines and yields an
  **auditable** verdict. *Legal RAG = closest analogue to Borjie's compliance /
  licence domain, where verifiable faithfulness is non-negotiable.*
- **Why best-in-world:** MetaRAG gives a cheap always-on online check; HalluGraph
  gives an *auditable, graph-grounded* check for high-stakes domains.

---

## 7. Confidence & uncertainty on knowledge — know what you don't know

The last gate before action: a calibrated confidence that licenses **answer vs
abstain vs escalate**.

### 7.1 Semantic entropy (Nature 2024)

Source fetched: <https://oatml.cs.ox.ac.uk/blog/2024/06/19/detecting_hallucinations_2024.html>
(Farquhar, Kuhn, Kossen, Gal et al., *Nature* 2024) and PubMed
<https://pubmed.ncbi.nlm.nih.gov/38898292/>.

- Method: (1) **sample K answers** (5+); (2) compute sequence probabilities; (3)
  **cluster answers by meaning** via **bidirectional NLI entailment**; (4) compute
  **entropy over meaning-clusters**, not tokens. High semantic entropy = the model
  is uncertain about *meaning*, not just phrasing.
- Detects **confabulations** — "makes something up for no reason" (different
  answers to the same prompt under different seeds), the most common hallucination
  type. Robust across GPT-4, LLaMA 2, Falcon; QA, math, biology.
- Beats all baselines on **AUROC** (predict correctness) and **AURAC** (accuracy
  after rejecting uncertain). Cost ≈ **10× a single QA** (sampling + clustering).
- **Cannot** catch *learned* wrong reasoning, domain-transfer failures, or
  deliberate deception — pair with retrieval verification (§§2,6).

### 7.2 Cheap variants & calibration

Source fetched: search synthesis incl. arXiv:2406.15927 **Semantic Entropy
Probes** <https://arxiv.org/abs/2406.15927>, arXiv:2505.20045 *Uncertainty-Aware
Attention Heads* <https://arxiv.org/pdf/2505.20045>, KDD-2025 UQ tutorial survey
<https://xiao0o0o.github.io/2025KDD_tutorial/survey.pdf>.

- **Semantic Entropy Probes (SEPs):** approximate semantic entropy **from the
  hidden states of a single generation** — near-zero extra cost, no K-sampling.
  Production-viable.
- **Calibration caveat:** raw token-probability is ambiguous — low token prob can
  mean *low factual confidence* **or** *just unusual phrasing*; do not equate
  log-prob with truth-confidence. Calibrate (temperature / verbalized
  confidence / probes) so a stated "0.8" *means* 80% empirical accuracy.
- **Why best-in-world:** semantic entropy is the **Nature-validated** standard for
  "is this answer likely a confabulation?"; SEPs make it cheap enough to run on
  every junior emission.

### 7.3 Abstention & escalation policy

- Map confidence → action: **answer** (high), **retrieve-more / self-correct**
  (mid, §6), **abstain / escalate to human** (low). This is the SOTA expression of
  Borjie's NOI threshold + graduated-autonomy gating — a *calibrated* gate, not a
  fixed prompt.

---

## 8. Provenance & lineage — the auditable backbone

Verification (§§1–7) decides *what to believe*; provenance records *how we came
to believe it*, immutably, for audit and rollback.

### 8.1 W3C PROV — the entity/activity/agent model

Source fetched: search synthesis incl. W3C PROV
<https://www.w3.org/2001/sw/wiki/PROV> and EDBT-2013
<https://dl.acm.org/doi/10.1145/2452376.2452478>.

- W3C **PROV** is the domain-agnostic, **W3C-Recommendation** provenance data
  model: three core concepts — **Entities** (data/artifacts), **Activities**
  (processes that create/transform), **Agents** (people/systems responsible) — plus
  relations (`wasGeneratedBy`, `used`, `wasAttributedTo`, `wasDerivedFrom`,
  `wasAssociatedWith`). It is the **interoperability substrate** for provenance
  across systems.
- **Why best-in-world:** it is *the* standard. Every fact's lineage ("who/what
  produced it, from what, when") expressible in one vendor-neutral graph that
  external auditors and regulators already understand.

### 8.2 OpenLineage — operational pipeline lineage

Source fetched: search synthesis (same query set) — OpenLineage / LF AI & Data.

- **OpenLineage** (LF AI & Data) is the open standard for **collecting lineage
  metadata from running pipelines**, with integrations for Airflow, Spark, dbt,
  Snowflake, BigQuery — the **industry standard for pipeline-level lineage** since
  2020 (watsonx expanded support early 2026).
- **Division of labour:** W3C PROV = the *model* (semantics of provenance);
  OpenLineage = the *operational capture* in data pipelines. Use PROV for the
  fact-lineage graph, OpenLineage-style instrumentation for the ingest pipeline.

### 8.3 Provenance in ML systems

Source fetched: arXiv:2507.01075 *"Provenance Tracking in Large-Scale Machine
Learning Systems"* — <https://arxiv.org/pdf/2507.01075>.

- Tracks dataset versions, hyperparameters, intermediate outputs, compute, and
  training steps; **follows the W3C PROV entity/activity/agent model** ("who did
  what to which data and when"). Capture via framework metadata extraction,
  workflow instrumentation, experiment-tracking integration, **graph-based
  storage** for efficient lineage queries — automated to minimise manual overhead.
- Motivation = **trustworthiness, reproducibility, bias-audit, and verification**
  for consequential domains (finance/health/policy) — directly parallel to
  Borjie's regulated mining-estate decisions.
- **Borjie alignment:** the existing **hash-chained, append-only AI audit chain**
  *is* a PROV-style activity log; extend it with explicit **entity (fact) ↔
  derived-from ↔ source-chunk** edges so every fact answers "what was I derived
  from, by which activity, attributed to which agent."

### 8.4 Continual-update danger: editing parametric knowledge

Source fetched: search synthesis incl. arXiv:2401.07453 *"Model Editing at Scale
leads to Gradual and Catastrophic Forgetting"* <https://arxiv.org/html/2401.07453v2>,
WISE/OpenReview <https://openreview.net/pdf?id=VJMYOfJVC2>, arXiv:2502.04390
*"In Praise of Stubbornness"* <https://arxiv.org/pdf/2502.04390>.

- **ROME / MEMIT** locate factual associations (causal tracing) then edit MLP
  weights to inject new facts (ROME = 1 layer; MEMIT = mass-edit across layers).
- **Hard warning:** **model editing at scale causes gradual and catastrophic
  forgetting** — sequential parametric edits degrade the model. Lifelong editing
  struggles with stability.
- **Architectural conclusion for Borjie:** keep **mutable knowledge in the
  external, versioned, provenance-tracked store** (retrieval-time), **not** in
  model weights. Edits to facts = new rows + new lineage + new valid-time, *never*
  weight surgery. This is consistent with Borjie's immutability + append-only
  invariants.

### 8.5 Active learning / human-in-the-loop for curation

Source fetched: search synthesis incl. arXiv:2509.10557 **HiLWS**
<https://arxiv.org/html/2509.10557v1>.

- HITL weak-supervision frameworks **prioritise ambiguous cases for expert
  adjudication**, raising reliability under noise; active-learning
  (e.g. ALIF) integrates expert feedback to catch domain-specific anomalies while
  minimising labelling.
- **Borjie alignment:** route **low-confidence / contradiction-flagged / expired**
  facts (the union of §§3,5,7 flags) to a human-review queue — *active learning on
  the knowledge base itself.* Human verdicts feed back as high-reliability sources
  (§4), tightening the loop. This is graduated autonomy applied to knowledge, not
  just actions.

---

## 9. Borjie implementation blueprint (synthesis)

A concrete, SOTA-grounded design to keep the ever-growing knowledge base correct,
current, and cited. Each item maps to an existing Borjie invariant where possible.

**Data model (extend the fact/evidence store):**
- Every fact row carries: `claim`, `evidence_ids[]`, `valid_from`, `valid_to`,
  `as_of`, `source_id`, `source_reliability` (learned, §4), `confidence`
  (calibrated, §7), `entailment_strength` (NLI score vs cited passage, §2),
  `re_validate_after` (decay clock, §5), `superseded_by` (never delete; §3 audit).
- Lineage edges in PROV form (§8): `fact —wasDerivedFrom→ source_chunk`,
  `fact —wasGeneratedBy→ ingest/inference activity —wasAssociatedWith→ agent`.

**Write path (ingest / agent-learned fact):**
1. Ground & extract (GraphRAG entity/relationship over corpus, §1).
2. Atomic-decompose; for each atomic claim run **NLI entailment vs cited
   passage** → reject claims with recall<1 (§2.1/2.3).
3. Conflict check: temporal-constraint + exclusivity contradiction detection vs
   existing facts (§3); on conflict, run truth-discovery resolution
   (reliability × recency × entailment), keep loser as `superseded_by` (§3/§4).
4. Stamp valid-time + re-validate clock; compute calibrated confidence (§5/§7).
5. Write fact + PROV lineage to append-only store; emit audit-chain entry (§8).

**Read path (junior/MD needs a fact):**
1. Retrieve candidates; **deterministic recency resolver** picks newest valid
   `max(valid_from)`/serial — *never* let the LLM judge freshness (§5.1).
2. If past `re_validate_after`: re-retrieve + re-entail before use, else discount
   confidence and surface staleness (§5.3).
3. Self-RAG / CRAG support gate: is the answer **substantiated** by the evidence?
   insufficient ⇒ re-retrieve or escalate (§6).
4. Semantic-entropy / SEP confidence (§7): high ⇒ answer; mid ⇒ self-correct;
   low ⇒ abstain/escalate to human (graduated autonomy / NOI threshold).
5. Emit answer with **per-assertion citations**; the **Auditor Agent** enforces
   citation recall=1 (faithfulness, not mere presence) before release (§2 +
   CLAUDE.md rule).

**Continual correctness (the clock):**
- Re-validation jobs sweep expired facts (§5); contradiction/low-confidence facts
  route to **human-in-the-loop active-learning queue** (§8.5); human verdicts
  become high-reliability sources that re-weight truth discovery (§4).
- **Never edit model weights** to fix a fact — fix the external store + lineage
  (§8.4). Re-validate **evals on a clock** too (benchmarks age, §5.2).

**Determinism-first principle (cross-cutting, the dossier's loudest lesson):**
freshness comparison, exclusivity-conflict detection, and citation-entailment
gating should be **deterministic code over structured metadata** wherever
possible — the freshness paper proves deterministic `max(serial)` beats every
LLM-judgement memory system by 10–28pp and is *cheaper and auditable* (§5.1).
Reserve the LLM for extraction, entailment scoring, and synthesis — not for
adjudicating which fact is newer or whether two exclusive values conflict.

---

## 10. Open frontiers (honest gaps)

- **Validating temporal validity itself** is underexplored — TKGs store
  valid-time but auto-checking those intervals is open (§5.2).
- **Multi-hop memory consolidation** is near-broken across the board (≤7%
  multi-hop on FactConsolidation before the deterministic fix) (§5.1).
- **Semantic entropy can't catch learned-wrong reasoning or deception** —
  needs retrieval-verification + structural (HalluGraph) auditing alongside (§7.1).
- **Calibration drift** under domain shift (mining/Tanzania jurisdiction) means
  confidence numbers need *local* recalibration, not borrowed defaults (§7.2).
- **Provenance completeness** depends on instrumentation discipline at ingest —
  un-instrumented paths = lineage blind spots (§8.3), the same class of risk as
  Borjie's prior schema-drift blind spot.

---

## Sources (all fetched unless marked UNVERIFIED in-text)

1. Microsoft Research — GraphRAG blog: <https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/>
2. GraphRAG "Local to Global" (arXiv:2404.16130): <https://arxiv.org/html/2404.16130v2>
3. Microsoft Research — DRIFT search: <https://www.microsoft.com/en-us/research/blog/introducing-drift-search-combining-global-and-local-search-methods-to-improve-quality-and-efficiency/>
4. ALCE (arXiv:2305.14627) — ar5iv: <https://ar5iv.labs.arxiv.org/html/2305.14627> ; abs: <https://arxiv.org/abs/2305.14627>
5. Fine-Grained Citation Evaluation (arXiv:2406.15264): <https://arxiv.org/html/2406.15264v1>
6. Correctness is not Faithfulness (arXiv:2412.18004): <https://arxiv.org/pdf/2412.18004>
7. FActScore (arXiv:2305.14251): <https://arxiv.org/abs/2305.14251> ; code: <https://github.com/shmsw25/factscore>
8. PaTeCon temporal-constraint conflict (arXiv:2304.09015): <https://arxiv.org/pdf/2304.09015>
9. Conflict Detection for Temporal KGs (arXiv:2312.11053): <https://arxiv.org/pdf/2312.11053>
10. Explainable Temporal Fact Validation (Springer): <https://link.springer.com/chapter/10.1007/978-3-031-94575-5_13>
11. Conflict-Aware Relational Metapath Extraction (arXiv:2509.11330): <https://arxiv.org/pdf/2509.11330>
12. ElephantBroker — knowledge-grounded cognitive runtime (arXiv:2603.25097): <https://arxiv.org/pdf/2603.25097>
13. Bayesian Truth Discovery — Zhao et al. VLDB 2012 (arXiv:1203.0058): <https://arxiv.org/pdf/1203.0058>
14. Truth discovery + source reliability — SIGMOD 2014: <https://dl.acm.org/doi/10.1145/2588555.2610509>
15. Truth Discovery in Linked Data (arXiv:1509.00104): <https://arxiv.org/pdf/1509.00104>
16. On the Discovery of Evolving Truth (PMC): <https://pmc.ncbi.nlm.nih.gov/articles/PMC4688022/>
17. Don't Ask the LLM to Track Freshness (arXiv:2606.01435): <https://arxiv.org/html/2606.01435v1>
18. Solving Freshness in RAG — recency prior (arXiv:2509.19376): <https://arxiv.org/pdf/2509.19376>
19. When Facts Expire — temporal validity benchmark (ACM CIKM 2025): <https://dl.acm.org/doi/10.1145/3746252.3761648>
20. SSGM — Governing Evolving Memory (arXiv:2603.11768): <https://arxiv.org/html/2603.11768v1>
21. When Benchmarks Age (arXiv:2510.07238): <https://arxiv.org/html/2510.07238>
22. Self-RAG (arXiv:2310.11511) — project: <https://selfrag.github.io/> ; abs: <https://arxiv.org/abs/2310.11511>
23. MetaRAG — metamorphic hallucination testing (arXiv:2509.09360): <https://arxiv.org/html/2509.09360v2>
24. HalluGraph — auditable legal-RAG hallucination detection (arXiv:2512.01659): <https://arxiv.org/html/2512.01659v1>
25. LLM Hallucination survey (arXiv:2510.06265): <https://arxiv.org/pdf/2510.06265>
26. Semantic Entropy — Farquhar et al. Nature 2024 (OATML blog): <https://oatml.cs.ox.ac.uk/blog/2024/06/19/detecting_hallucinations_2024.html> ; PubMed: <https://pubmed.ncbi.nlm.nih.gov/38898292/>
27. Semantic Entropy Probes (arXiv:2406.15927): <https://arxiv.org/abs/2406.15927>
28. Uncertainty-Aware Attention Heads (arXiv:2505.20045): <https://arxiv.org/pdf/2505.20045>
29. UQ & Calibration in LLMs — KDD 2025 tutorial survey: <https://xiao0o0o.github.io/2025KDD_tutorial/survey.pdf>
30. W3C PROV — Semantic Web standard: <https://www.w3.org/2001/sw/wiki/PROV>
31. W3C PROV family of specs (EDBT 2013): <https://dl.acm.org/doi/10.1145/2452376.2452478>
32. Provenance Tracking in Large-Scale ML Systems (arXiv:2507.01075): <https://arxiv.org/pdf/2507.01075>
33. Model Editing at Scale → Catastrophic Forgetting (arXiv:2401.07453): <https://arxiv.org/html/2401.07453v2>
34. WISE — lifelong model editing memory (OpenReview): <https://openreview.net/pdf?id=VJMYOfJVC2>
35. In Praise of Stubbornness — cognitive-dissonance-aware continual update (arXiv:2502.04390): <https://arxiv.org/pdf/2502.04390>
36. HiLWS — human-in-the-loop weak supervision (arXiv:2509.10557): <https://arxiv.org/html/2509.10557v1>
