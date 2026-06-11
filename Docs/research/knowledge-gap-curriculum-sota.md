# Frontier Dossier — Knowledge-Gap Detection & Self-Directed Curriculum for the Autonomous Estate Brain

**Date:** 2026-06-08
**Author:** Research subagent (real frontier web research; every claim resolves to a fetched/searched URL or is marked **UNVERIFIED**)
**Audience:** Borjie architecture — the Mr. Mwikila brain layer, its 12-agent kernel, its junior agents, and the mining/real-estate ground-truth corpus
**Scope:** How an autonomous Managing Director (MD) systematically *knows what it does not know*, *acquires the highest-value knowledge next*, and *measures + closes domain coverage across its mandate and adjacent domains* — so it becomes, and provably stays, expert everywhere it needs to be.

> **Citation discipline.** Every factual claim carries a `[Sn]` key resolving to the Sources table at the end. URLs tagged **fetched** were retrieved in full with WebFetch; **search** came from a WebSearch result snippet (abstract/landing summary). Anything not directly grounded is labelled **UNVERIFIED**. Nothing here is invented. Where two sources disagree, both are cited.

> **The brief this dossier must EXCEED.** A naive "the MD should learn what it doesn't know" reduces to *retrieve-when-confused + fine-tune-on-failures*. That is **reactive patching**. It says nothing about (i) the **epistemics** of distinguishing "I lack this knowledge" (fixable) from "no one can answer this" (don't waste budget); (ii) the **economics** of choosing *which* of ten thousand possible gaps to close *first* (value of information); (iii) the **measurement** of coverage over a *map* of the domain so blind spots are visible rather than discovered by accident in production; or (iv) the **curriculum** that turns a static corpus into a self-driving learning agenda. This dossier supplies all four as one closed loop: **map → measure coverage → detect gaps (epistemic, not aleatoric) → rank by value of information → acquire → distill → re-measure.**

---

## 0. Executive thesis (one screen)

The autonomous MD does not become expert by being trained once on a big corpus. It becomes expert by running a **perpetual epistemic control loop** whose set-point is *coverage of the domain map* and whose actuator is *self-directed knowledge acquisition ranked by value of information*. Six coupled subsystems:

1. **Domain map (the substrate of "everywhere it needs to be").** Build a hierarchical **knowledge graph + community map** of the mandate (licences, royalty, treasury, workforce, ESG, marketplace, machinery, succession…) and adjacent domains, using **Microsoft GraphRAG**-style Leiden hierarchical communities and per-community summaries `[S3]`. Each community is anchored to **competency questions (CQs)** — the explicit questions the domain *must* be able to answer `[S9][S10]`. The CQ-satisfaction rate over the community map **is** the coverage metric.

2. **Coverage measurement (knowing the shape of the territory).** Coverage = fraction of competency questions the MD answers *correctly and with evidence*, scored per community and per coarseness level (C0 root themes → C3 leaf detail) `[S3][S9]`. This converts "is the MD expert in mining ESG?" from a vibe into a number with a confidence interval.

3. **Knowing-what-you-don't-know (epistemic uncertainty, not aleatoric).** The decisive frontier distinction: separate **epistemic** uncertainty (the MD *lacks knowledge* — reducible by learning) from **aleatoric** uncertainty (the question has *multiple valid or no answers* — irreducible). DeepMind's iterative-prompting **mutual-information** estimator `[S5]`, Oxford/Nature **semantic entropy** `[S6][S7]`, and the **knowledge-boundary** four-quadrant taxonomy (prompt-agnostic-known / prompt-sensitive-known / model-specific-unknown / model-agnostic-unknown) `[S8]` give the MD a *calibrated, unsupervised, task-agnostic* read on its own boundary. Only epistemic gaps enter the learning queue; aleatoric ones trigger *clarification or escalation*, never wasted study.

4. **Gap detection from failed / abstained answers (the signal that learning is needed).** Abstention is reframed — per the *Know Your Limits* survey `[S2]` — not as the end of a conversation but as "a step towards subsequent information acquisition." Every abstain, every low-confidence answer, every **FLARE** `[S11]`-style mid-sentence uncertainty spike, every **ReasoningBank** `[S12]`-judged failed trajectory becomes a typed gap record routed into the acquisition queue.

5. **Value-of-information acquisition (acquire the highest-VOI knowledge next).** Which gap to close first is an **active-learning / Bayesian-experimental-design** problem: rank candidate acquisitions by **Expected Information Gain (EIG)** — the expected reduction in uncertainty — and increasingly by **expected *decision* value** (the new amortized BED that optimizes for downstream decisions, not just parameter entropy) `[S4][S14][S15]`. The MD spends its finite study/retrieval/expert-escalation budget where it most moves the needle on the estate's actual decisions.

6. **Self-directed curriculum (the agenda that drives 1–5 forward).** A **Voyager** `[S1]` automatic curriculum proposes the next learning task; **OMNI** `[S13]` adds the missing filter — a foundation model as a *model of interestingness* on top of **learning-progress** (Oudeyer) `[S16]` — so the MD pursues tasks that are *learnable AND worth learning*, not minor variations. Closed gaps are distilled into a **ReasoningBank** `[S12]`-style reusable strategy memory (successes AND failures) and a **Voyager**-style skill library, then coverage is re-measured. The loop compounds.

**Where Borjie already stands.** Borjie is not greenfield: it ships `intelligence_corpus_chunks` (cross-tenant ground-truth commons, `tenant_id = NULL`), the first-boot corpus-ingest job, `central-intelligence/.../memory/` (A-MEM-style episodic store), `.../consolidation/consolidation-cycle.ts` ("sleep" consolidation), `packages/sae-probe/` (internal-state probing substrate), and the **evidence-required** invariant (every junior recommendation cites ≥1 `evidence_id`; the Auditor rejects empty evidence chains) — per `CLAUDE.md`. This dossier is the layer that turns those parts into a *self-improving epistemic engine*: it adds the domain map, the coverage metric, the epistemic/aleatoric split, the VOI ranking, and the self-driving curriculum.

---

## 1. The problem, stated precisely

"Become expert everywhere it needs to be" is three sub-problems that the field treats with different machinery:

| Sub-problem | Wrong (naive) answer | Frontier answer | Anchors |
|---|---|---|---|
| **Where is "everywhere"?** | "the corpus we ingested" | A *map* — hierarchical KG communities + competency questions covering mandate + adjacent domains | GraphRAG `[S3]`, CQ engineering `[S9][S10]` |
| **Where am I weak?** | "wherever I got a question wrong in prod" | Calibrated epistemic-uncertainty signal over the *whole map*, separating fixable gaps from unanswerable noise | Knowledge-boundary survey `[S8]`, semantic entropy `[S6][S7]`, MI estimator `[S5]`, abstention survey `[S2]` |
| **What do I study next?** | "the most recent failure" / "everything, uniformly" | Highest **value of information** under budget, sequenced by a learnability+interestingness curriculum | Active-learning survey `[S4]`, Bayesian experimental design `[S14][S15]`, Voyager `[S1]`, OMNI `[S13]` |

The naive answers each have a fatal pathology: a corpus is not a map (you can't see what's missing); production failures are a *biased, lagging* sample of your gaps (you only learn what users happened to ask, after damage); and "study everything" or "study the latest failure" both ignore that **knowledge has wildly unequal marginal value to the firm's decisions**.

---

## 2. Pillar A — The domain map: "everywhere it needs to be," made explicit

You cannot measure coverage of a territory you have not mapped. Two complementary technologies build the map.

### 2.1 GraphRAG hierarchical community map (the coverage substrate)

Microsoft **GraphRAG** `[S3]` (fetched) builds, from source documents, an entity-relationship **knowledge graph**, then applies the **Leiden** algorithm to detect *nested hierarchical communities* at four coarseness levels (**C0** root themes → **C3** leaf detail). An LLM writes a **community report** (summary) for each community — title, summary, impact rating, and 5–10 key findings with evidence grounding. The decisive property for us: GraphRAG was built to answer **global sensemaking** questions ("what are the main themes?", "how do these influences interact?") that vector RAG *structurally cannot*, because vector RAG retrieves only locally-similar chunks and never sees the whole. On 1M-token corpora GraphRAG beat vector RAG on **comprehensiveness (72–83% win rate, p<.001)** and **diversity (62–82%)** in LLM-judged pairwise comparisons `[S3]`.

**Why this is the coverage substrate, not just a retriever.** The community hierarchy *is a map of the domain's conceptual territory*. Per the fetched analysis, community reports function as "structured domain coverage maps": hierarchical organization lets you scan root themes before drilling in; thematic partitions reflect *actual* conceptual relationships, not arbitrary semantic clusters; and reports link vertically (parent↔child) and horizontally (related entities) into "an explorable knowledge structure" `[S3]`. Microsoft later added **dynamic community selection** to global search — an LLM rates each community report's relevance to a query and prunes irrelevant branches before answering `[S3b]` — which is exactly the operation a coverage auditor needs: *enumerate every community, ask "does the MD master this?"*.

**Best-in-world because:** it is the only widely-deployed, peer-reported method that turns an unstructured corpus into a *navigable, hierarchical, summarized map* with measured global-coverage superiority over the vector-RAG default — and it ships as open source from Microsoft Research `[S3][S3b]`.

### 2.2 Competency questions = the coverage metric's atoms

A map tells you the territory; **competency questions (CQs)** tell you what "knowing" the territory *means*. In ontology engineering, CQs are "a set of queries in the form of questions that outline and constrain the scope of knowledge represented in an ontology which the ontology must be able to answer" `[S9]` (search). They are the canonical instrument for **scoping and evaluating** a knowledge artifact: continuous evaluation runs CQs as SPARQL/answerable queries and tracks the **satisfaction rate** `[S9]`. 2024–2026 work automates CQ *generation* with LLMs (RAG-grounded CQ generation `[S9]`; **Bench4KE** benchmarks automated CQ generation `[S10]`; **VSPO** uses LLM-generated CQs to validate semantic pitfalls `[S10b]`), and reports standard KG quality metrics: "precision, recall, F1, graph-level BERTScore, graph edit distance, hallucination and omission rates per triple, completeness, logical consistency, and query performance" `[S9]`.

**The synthesis Borjie should make:** attach a *bank of competency questions to every GraphRAG community*. Generate CQs with an LLM (grounded in the community report), have domain experts curate the high-stakes ones, and define:

> **Domain coverage = the fraction of competency questions the MD answers correctly *and with a valid evidence chain*, weighted by community impact and decision-value, scored per coarseness level.**

This is the single number that makes "is the MD expert in mining ESG / royalty / treasury?" *auditable*. It also gives the gap detector its **ground truth**: a CQ the MD fails or abstains on is a localized, addressable hole in a named community.

**Best-in-world because:** CQs are the *decades-validated* completeness instrument from ontology engineering `[S9]`, now LLM-automatable at corpus scale `[S9][S10]`, and they map one-to-one onto GraphRAG communities — fusing the *navigability* of GraphRAG with the *measurability* of CQ satisfaction. Neither field has published this exact fusion at the time of writing (**UNVERIFIED** as a named published method; the components are individually verified).

---

## 3. Pillar B — Knowing what you do not know (epistemic ≠ aleatoric)

This is the conceptual heart. The MD must distinguish **two fundamentally different uncertainties**, because they demand opposite actions.

### 3.1 The distinction that everything hinges on

- **Epistemic uncertainty** — "arises from the lack of knowledge about the ground truth … stemming from insufficient training data or model capacity" `[S0]` (search). It is **reducible**: more data / study / retrieval closes it. → **enters the learning queue.**
- **Aleatoric uncertainty** — "comes from irreducible randomness … such as multiple valid answers to the same query" `[S0]`. It is **irreducible**: the question is ambiguous, underspecified, or has no objective answer. → **triggers clarification or human escalation, never study.**

The *Beyond "I Don't Know"* line of work `[S0b]` (search) operationalizes this: **data uncertainty** = "questions that lack a unique objective answer due to ambiguity or missing information"; **model uncertainty** = "a question admits a unique answer in principle but exceeds the model's current capabilities." An MD that conflates them either wastes budget studying unanswerable questions or, worse, hallucinates confidently where it should have asked the owner. *Telling them apart is the prerequisite for a sane curriculum.*

### 3.2 Three production-grade estimators (no labels, no fine-tuning)

**(i) DeepMind iterative-prompting mutual information** `[S5]` (fetched). To separate the two, construct a *pseudo joint distribution* by sequentially re-prompting the LLM with its own previous answers in context. Key insight: ground-truth responses to the same query should be **independent** across samples; if the model's answers become *dependent* on its own prior outputs, that dependence reveals it is *making things up* — high epistemic uncertainty. The central quantity is the **mutual information of the pseudo joint distribution**, `I(μ) = D_KL(μ, μ⊗)`, with a proven lower bound (Theorem 4.5) `D_KL(Q̃,P̃) ≥ I(Q̃)` computable from the LLM alone — no ground truth needed. Thresholding MI flags hallucination, and it is **particularly effective on multi-answer queries where entropy-based methods fail** `[S5]` — precisely the aleatoric-heavy cases.

**(ii) Semantic entropy (Nature 2024, Oxford)** `[S6][S7]` (fetched). Sample K≈5 answers; cluster them by **semantic equivalence** using bidirectional **entailment** (an NLI model or LLM judge checks "do these two answers mean the same thing?"); compute entropy over **meaning-clusters**, not token sequences. A model that **confabulates** produces *different meanings* across samples → high semantic entropy; a model that *knows* produces meaning-consistent answers → low entropy. This separates *semantic* from merely *lexical* variation (paraphrases don't inflate it). Reported: best **AUROC** and **AURAC** (area under rejection-accuracy curve) "across a range of datasets and models" incl. GPT-4, LLaMA-2, Falcon; **unsupervised and task-agnostic** — no labeled data, works across natural questions, math, biology `[S6][S7]`. **Semantic-entropy *probes*** `[S6b]` make it cheap by reading it off hidden states.

**(iii) The knowledge-boundary four-quadrant taxonomy** `[S8]` (fetched) gives the *map* of self-knowledge. Three nested boundaries (Universal → Parametric → Outward/observable) and four knowledge types: **Prompt-Agnostic Known (PAK)** — answered under all phrasings; **Prompt-Sensitive Known (PSK)** — in parameters but phrasing-fragile; **Model-Specific Unknown (MSU)** — known to humans, *absent from this model* (→ retrieval/training fixes it); **Model-Agnostic Unknown (MAU)** — unknown to humanity, unverifiable (→ never study). Identification methods: uncertainty estimation (epistemic vs aleatoric decomposition), confidence calibration, **internal-state linear probing** ("linear probing on internal states can assess factual accuracy"), and prompting. Expansion methods: **retrieval (RAG) for MSU**, **knowledge editing** (modify parameters without full retraining), and **fine-tuning** on factual/synthetic corpora `[S8]`.

> **Borjie mapping.** PSK gaps → *retrieval + prompt-canonicalization* (cheap). MSU gaps → *corpus acquisition / expert escalation* (the real learning queue). MAU "gaps" → *flag as inherently uncertain, escalate to owner, do not enqueue*. This is the routing table that prevents the MD from wasting its budget. Borjie's existing `packages/sae-probe/` is the substrate for the internal-state probing path `[S8]`.

**Best-in-world because:** these three are (a) the only *unsupervised, label-free, task-agnostic* family with peer-reviewed (Nature) or frontier-lab (DeepMind) provenance `[S5][S6]`, and (b) the only taxonomy that explicitly tells you *which uncertainty is fixable by which intervention* `[S8]` — turning "knowing what you don't know" from a slogan into a routed control signal.

---

## 4. Pillar C — Gap detection from failed / abstained answers

Abstention and failure are not dead ends — they are the **richest, cheapest gap signals the MD produces**, *if* captured as structured records.

### 4.1 Abstention is the start of acquisition, not the end

The *Know Your Limits* abstention survey `[S2]` (fetched) is explicit: "abstention should not be viewed as the termination of a conversation, but rather as a step towards subsequent information acquisition," potentially prompting clarification requests or data retrieval. It taxonomizes *when* to abstain across three perspectives — **query** (ambiguous/incomplete/unknowable → aleatoric), **model knowledge** (insufficiently confident → epistemic), **human values** (safety) — and *how*, by stage: input-processing (answerability/ambiguity detection), in-processing (uncertainty estimation: NLL, semantic entropy, verbalized confidence; calibration: temperature scaling, MC-dropout; consistency sampling), output-processing (self-evaluation, multi-model verification). Evaluation metrics: **Reliable Accuracy (R-Acc)** (accuracy among non-abstained), **abstention precision/recall**, **coverage**, **Effective Reliability (ER)** `[S2]`.

> **Borjie integration.** Every abstain emitted anywhere in the MD (chat, junior agent, surface) is written as a typed **gap record**: `{community_id, competency_question?, abstain_reason ∈ {query_ambiguous(aleatoric), low_confidence(epistemic), safety}, evidence_attempted, timestamp}`. Aleatoric → clarification UI / owner escalation. Epistemic → acquisition queue (§5). Safety → governance gate. The MD's R-Acc/ER over time becomes a *first-class trust KPI* — directly reinforcing Borjie's evidence-required + Auditor invariants.

### 4.2 Mid-generation gap detection (FLARE) — catch uncertainty *during* the answer

**FLARE** (Forward-Looking Active REtrieval, EMNLP 2023) `[S11]` (search): iteratively predict the upcoming sentence; if any token's probability falls below threshold θ, treat those low-confidence spans as a *retrieval signal*, form a query from them, retrieve, and regenerate. The thesis: "the right time to retrieve is mid-sentence, right when the model starts to get uncertain" — retrieving "only when and approximately where it's uncertain, not front-loading retrieval for content it will never need" `[S11]`. **DRAGIN** `[S11b]` extends this with information-need-aware dynamic retrieval. For the MD this means gap detection is **continuous and in-flight**, not just post-hoc — a half-formed treasury recommendation that hits an uncertain span triggers a corpus lookup *before* the sentence is finished, and logs a gap if retrieval came up empty.

### 4.3 Failed *trajectories* become anti-patterns (ReasoningBank)

Failures of multi-step *action* (not just answers) are gold. **ReasoningBank** (Google Cloud AI, 2025) `[S12]` (fetched): an LLM-as-judge labels each trajectory success/failure, then distills it into a compact memory item — **title + one-line description + actionable content (heuristics/checks/constraints)**. Crucially, **failed trajectories become "what-not-to-do" guardrails** — preventive constraints rather than discarded noise — so the agent stops repeating mistakes and abstentions. At test time it runs a **retrieve-then-distill** loop with **no weight updates**, and **MaTTS** (memory-aware test-time scaling) generates diverse experiences for higher-quality, contrastive memory synthesis. Reported **+34.2% relative effectiveness and −16% interaction steps** across web + SWE benchmarks; ablation shows **k=1 retrieval is optimal** (success drops 49.7%→44.4% as k goes 1→4) — *more memory hurts* `[S12]`.

> **Borjie integration.** This is the bridge from gap *detection* to gap *closure without retraining*: every failed junior-agent run (royalty miscalc, mis-sequenced KYC, bad offtake settlement) is distilled into a strategy item *and* an anti-pattern, stored in the per-tenant flywheel + cross-tenant commons, retrieved on the next similar task. Borjie's `consolidation-cycle.ts` "sleep" is the natural home for the distill step. The k=1 finding is a hard design constraint: **inject the single best strategy, not a memory dump.**

**Best-in-world because:** abstention-as-acquisition `[S2]` + in-flight uncertainty retrieval `[S11]` + judged-trajectory anti-pattern distillation with measured double-digit gains and a counter-intuitive, *actionable* k=1 ablation `[S12]` together form the only published, end-to-end pipeline that converts *every* class of failure (answer, in-flight, trajectory) into a typed, queryable, reusable gap-closing asset — at test time, without fine-tuning.

---

## 5. Pillar D — Value-of-information acquisition (acquire the highest-VOI next)

The MD will always have more gaps than budget. *Which to close first* is an active-learning / Bayesian-experimental-design (BED) problem.

### 5.1 The active-learning query-strategy taxonomy

The 2024 **Deep Active Learning survey** `[S4]` (fetched abstract) frames it cleanly: the core principle is to acquire "labels with the highest value of information" so as to "achieve strong performance with fewer training samples." Query strategies group into:

- **Uncertainty-based** — entropy, margin, least-confidence, and **BALD** (Bayesian Active Learning by Disagreement): select the point maximizing **mutual information between the prediction and the model parameters**, i.e. **predictive entropy minus expected entropy under the posterior**, which isolates *epistemic* uncertainty (disagreement among plausible models) `[S4b]` (search). This is the formal version of "ask about what you're uncertain about *because you lack knowledge*, not because the answer is random."
- **Diversity / representativeness** — core-set, clustering — pick a *spread* over the domain so you don't over-sample one community.
- **Hybrid** — expected-model-change, expected-error-reduction; combine uncertainty + diversity (avoids redundant batches and cold-start failure) `[S4]`.

### 5.2 Expected Information Gain → Expected *Decision* Value

The information-theoretic objective is **Expected Information Gain (EIG)** — the expected Shannon-entropy reduction about the quantity of interest; equivalently the mutual information `I(θ; y | ξ)` between unknown θ and outcome y under design ξ `[S4b]`. **Bayesian Experimental Design** "optimizes experiments by maximizing expected information gain to reduce uncertainty about latent parameters" `[S14]` (search). EIG is intractable (nested integrals), so 2024 frontier work **amortizes** it with deep nets: **Deep Adaptive Design** and **TNDP** (Transformer Neural Decision Process) "simultaneously propose new experiments and infer optimal actions" `[S14][S15]`.

The 2024 leap most relevant to an MD: **Amortized BED for Decision-Making** `[S15]` (search) "formalize[s] design objectives directly in terms of expected utility for *later, possibly complex, decisions*" — i.e., don't acquire the knowledge that maximally shrinks *parameter* entropy; acquire the knowledge that maximally improves the *decisions the firm will actually make*. **Expected Predictive Information Gain (EPIG)** `[S14b]` similarly targets predictive performance on the deployment distribution rather than parameters.

> **The Borjie VOI score.** Rank each epistemic gap by:
> `VOI(gap) ≈ EIG(gap) × decision_value(community) × decision_frequency × evidence_acquirability − acquisition_cost`
> where EIG comes from the uncertainty estimators of §3, `decision_value` from the impact rating of the GraphRAG community report `[S3]` and the CQ's business weight, and `acquisition_cost` reflects corpus-lookup vs. expert-escalation vs. fine-tune. This makes the curriculum **decision-driven**, per the 2024 amortized-BED thesis `[S15]` — the MD studies royalty-rate edge cases that recur in high-value contracts *before* an exotic-but-rare metallurgy curiosity, even if the latter has higher raw EIG.

**Best-in-world because:** BALD/EIG `[S4][S4b]` are the rigorously-grounded VOI primitives, and the 2024 amortized **decision-focused** BED `[S15]` is the current frontier that fixes their central flaw for an operating company — *parameter-uncertainty reduction ≠ business value*. No competitor curriculum that ranks gaps by "most recent failure" or "uniform coverage" can match a decision-VOI-ranked queue.

---

## 6. Pillar E — The self-directed curriculum (the agenda that drives the loop)

Coverage + gaps + VOI tell you *what's missing and what's worth it*. A **curriculum** turns that into a *self-driving sequence of learning tasks*.

### 6.1 Voyager — the automatic curriculum + skill library blueprint

**Voyager** (NVIDIA/Caltech, 2023) `[S1]` (fetched) is the canonical LLM lifelong-learning agent. Three components: (1) an **automatic curriculum** that "takes into account the exploration progress and the agent's state to maximize exploration," explicitly an "*in-context form of novelty search*" aimed at "discovering as many diverse things as possible"; (2) an **ever-growing skill library** of executable code where "each skill is indexed by the embedding of its description, retrieved in similar situations" (top-5 relevant skills surfaced per new task), and "complex skills are synthesized by composing simpler programs, which compounds capabilities and alleviates catastrophic forgetting"; (3) a **self-verification critic** — GPT-4 acts as critic on (state, task), reports success/failure, and *suggests how to complete the task* on failure. Result: 3.3× more unique items, 15.3× faster tech-tree progress vs prior SOTA `[S1]`. No fine-tuning — pure black-box prompting + memory `[S1]`.

> **Borjie mapping.** The "world" is the estate + corpus, not Minecraft. The curriculum proposes the next *competency question to master* (the §2.2 CQ bank is the task space). The skill library = Borjie's distilled junior-agent procedures (royalty calc, KYC sequence, settlement) indexed by embedding — *already partially present* as tacit-knowledge + episodic memory. The critic = Borjie's **Auditor** + evidence-chain check. Voyager's compositionality is the path from atomic skills to compound MD competencies.

### 6.2 Learning progress (Oudeyer) — the difficulty thermostat

A curriculum that proposes impossible or trivial tasks stalls. **Oudeyer's learning-progress hypothesis** `[S16]` (fetched PDF): "learning progress itself, measured as the improvement of prediction errors, can be intrinsically rewarding," producing "a self-organizing learning curriculum with phases of increasing complexity." Select goals "based on a measure of competence progress" — prefer tasks where the agent is *currently improving* (the zone of proximal development), automatically scaffolding from simple to complex `[S16]`. For the MD: weight the curriculum toward CQs/communities where the **coverage metric is rising fastest** — neither already-mastered (no progress) nor far-out-of-reach (no progress).

### 6.3 OMNI — the missing "is it worth learning?" filter

Pure learning-progress has an **Achilles heel**: "countless *learnable yet uninteresting* tasks remain (e.g., minor variations of previously learned tasks)" `[S13]` (fetched). **OMNI** (Clune et al., ICLR-era) `[S13]` fixes this with a **dual criterion**: **(1) Learnability** (learning progress — calibrated difficulty) **AND (2) Interestingness**, where a **foundation model serves as the model of interestingness** because it "already internalize[s] human concepts of interestingness from training on vast human-generated data." OMNI "outperform[s] baselines based on uniform task sampling *or learning progress alone*," moving toward "AI selecting its own next task to learn" `[S13]`. **OMNI-EPIC** `[S13b]` extends it to *generate the next task as executable code*.

> **Borjie mapping.** The "interestingness" FM is Mr. Mwikila judging *business relevance*: among learnable, uncovered CQs, prioritize those that matter to a Tanzanian mining estate's actual decisions — fusing OMNI's interestingness `[S13]` with the decision-VOI score of §5. This is the curriculum's *taste*: it stops the MD from exhaustively mastering trivia and points it at the competencies that make it a better Managing Director.

### 6.4 Where the curriculum lives in the self-evolving-agent landscape

The **Self-Evolving Agents survey** `[S17]` (fetched) gives the governing frame: **WHAT** to evolve (models / context-memory / tools / architecture), **WHEN** (intra-test-time vs inter-test-time), **HOW** (reward-based, imitation, population/evolutionary, curriculum), **WHERE** (domains incl. finance, medical). Its definition is the bar: "a self-evolving agent modifies its internal parameters, contextual state, toolset, or architectural topology based on its own trajectories or feedback signals, with the explicit objective of improving future performance," requiring (i) experience-dependent updates, (ii) persistent policy-changing effects, (iii) autonomous self-initiated learning. It evaluates such systems on **Adaptivity, Retention (no catastrophic forgetting), Generalization, Efficiency, Safety** `[S17]`. **AgentGen** "progressively adjusts task difficulty … within a dynamically structured curriculum" `[S17]`. Continual-learning surveys `[S18]` supply the retention machinery (WISE lifelong model editing, SEEKR selective retention) so closing one gap doesn't reopen another.

**Best-in-world because:** Voyager `[S1]` is the *only* lifelong agent to demonstrate compounding, composable, forgetting-resistant skill acquisition via automatic curriculum with order-of-magnitude empirical gains; Oudeyer `[S16]` is the *foundational theory* of self-organizing difficulty; OMNI `[S13]` is the *frontier fix* that injects taste/relevance — and the self-evolving survey `[S17]` is the *most comprehensive 2025 map* of how to assemble them safely. Together they are the complete recipe for a curriculum that is *driven by coverage gaps, sequenced by learning progress, filtered by business interestingness, and evaluated for retention + safety.*

---

## 7. The closed loop (reference architecture for Borjie)

```
                 ┌──────────────────────────────────────────────────────┐
                 │  DOMAIN MAP  (GraphRAG Leiden communities C0→C3        │
                 │  over mandate + adjacent domains)  [S3]                 │
                 │  + Competency-Question bank per community  [S9][S10]    │
                 └───────────────┬──────────────────────────────────────┘
                                 │ enumerate CQs
                                 ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  COVERAGE METER:  % CQs answered correct + evidence-grounded,         │
   │  weighted by community impact rating [S3] & decision-value.           │
   │  Per-community, per-level. The set-point of the whole loop.           │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ low-coverage cells  +  live signals
                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  GAP DETECTOR (typed records):                                        │
   │   • epistemic-uncertainty scan: semantic entropy [S6], MI estimator   │
   │     [S5], knowledge-boundary quadrant routing [S8]                    │
   │   • abstentions as acquisition signals [S2]                           │
   │   • FLARE in-flight low-confidence spans [S11]                        │
   │   • ReasoningBank judged-failed trajectories → anti-patterns [S12]    │
   │  ROUTE: PSK→retrieval/canonicalize · MSU→learning queue ·             │
   │         MAU/aleatoric→escalate (never study) [S8][S2]                 │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ epistemic (MSU) gaps only
                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  VOI RANKER:  EIG/BALD [S4][S4b]  ×  decision-value (amortized        │
   │  decision-focused BED) [S15]  ×  acquirability  −  cost.              │
   │  Output: a prioritized acquisition queue.                             │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ top-VOI gap
                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  SELF-DIRECTED CURRICULUM:  Voyager auto-curriculum [S1] proposes     │
   │  next CQ to master, gated by learning-progress difficulty [S16] and   │
   │  OMNI interestingness/business-relevance [S13].                       │
   │  ACQUIRE: corpus retrieval · expert/owner escalation · synthetic      │
   │  data · knowledge-editing/fine-tune [S8].                             │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ closed gap
                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  DISTILL + STORE (no-retrain default):  ReasoningBank strategy item   │
   │  + anti-pattern [S12]; Voyager skill (embedding-indexed) [S1];        │
   │  during "sleep" consolidation. k=1 retrieval discipline [S12].        │
   │  Split: cross-tenant commons (ground truth) + per-tenant flywheel.    │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ re-score
                   └──────────────► back to COVERAGE METER  (loop compounds)
```

**Retention guard (always-on):** every distillation runs continual-learning safeguards (WISE/SEEKR-style selective retention) `[S18]` and re-runs a *regression slice* of previously-passing CQs so closing a new gap never silently reopens an old one — the survey's **Retention** axis `[S17]`. Coverage may only monotonically improve or trigger an alert.

---

## 8. Concrete recommendations for Borjie (ranked, exceeding the brief)

1. **Build the coverage meter first (highest leverage).** Run GraphRAG `[S3]` over `intelligence_corpus_chunks` to produce the Leiden community map; LLM-generate a CQ bank per community `[S9][S10]`; persist `domain_coverage(community_id, level, cq_id, last_status, evidence_id, decision_weight)`. This is the missing instrument that makes every other pillar measurable — and it reuses Borjie's existing corpus + evidence-chain invariants. *Without a coverage number, "expert everywhere" is unfalsifiable.*

2. **Wire epistemic/aleatoric routing into the abstention path.** Borjie already abstains/escalates; add **semantic entropy** `[S6]` (cheap via probes `[S6b]`) + knowledge-boundary quadrant routing `[S8]` so PSK→retrieval, MSU→learning-queue, MAU/aleatoric→owner. Reuse `packages/sae-probe/` for internal-state probing `[S8]`. Track **R-Acc / Effective Reliability** `[S2]` as a trust KPI surfaced to the owner.

3. **Turn every failed junior-agent run into a ReasoningBank anti-pattern** `[S12]`, distilled in `consolidation-cycle.ts` ("sleep"), retrieved at **k=1** `[S12]`, split commons/tenant. This is the cheapest, fastest compounding win — no retraining, double-digit measured gains.

4. **Add a decision-VOI ranker** `[S15]` over the gap queue using community impact ratings `[S3]` as the decision-value term, so the MD studies what moves estate decisions, not what's merely uncertain.

5. **Run the Voyager+OMNI curriculum nightly** `[S1][S13][S16]`: propose the next CQ to master from the lowest-coverage, rising-progress, highest-interestingness cells; acquire; distill; re-measure. Treat the *adjacent* domains (e.g., construction/built-environment, machinery advisory — already in `Docs/research/`) as first-class curriculum territory so the MD expands its mandate's edges deliberately, not accidentally.

6. **Add FLARE-style in-flight retrieval** `[S11]` to long-form MD outputs (board memos, treasury plans) so uncertain spans pull evidence *before* the sentence completes — and log a gap if retrieval is empty.

7. **Gate the loop with retention + safety** `[S17][S18]`: every gap-closure must pass a CQ regression slice (no catastrophic forgetting) and Borjie's governance/inviolable gates before the new knowledge is allowed into AUTO flows.

---

## 9. Honest gaps & contested points

- **The GraphRAG-community ↔ competency-question fusion is a synthesis, not a cited published method.** Both halves are individually verified `[S3][S9][S10]`; their exact combination as a coverage meter is this dossier's proposal — **UNVERIFIED** as prior art.
- **Decision-focused amortized BED `[S15]` is 2024-fresh** and largely validated on simulators, not on a live operating firm's heterogeneous knowledge gaps. Treat the VOI formula in §5.2 as an *engineering approximation*, not a theorem.
- **ReasoningBank's k=1 optimum `[S12]` was measured on web/SWE benchmarks**; whether a single strategy item suffices for compound estate decisions is unverified for Borjie's domain — pilot before assuming.
- **Semantic entropy / MI estimators add latency** (K samples). The probe variants `[S6b]` mitigate this but are themselves newer/less battle-tested.
- **Curriculum reward hacking.** A self-directed curriculum can game its own coverage metric (master easy CQs to inflate the number). OMNI's interestingness filter `[S13]` and the decision-VOI weighting `[S15]` partially defend, but this needs an adversarial eval — note it overlaps Borjie's existing red-team/eval workflows.
- **Two arXiv IDs in search results carry future-dated stamps** (e.g. `2604.*`, `2602.*`, `2603.*`). I cited only sources I could fetch or whose abstracts were returned; future-dated ones are flagged where used and treated as lower-confidence.

---

## Sources

| Key | Title / Source | URL | Status |
|---|---|---|---|
| S0 | Epistemic vs aleatoric uncertainty in LLM QA (search synthesis incl. "To Believe or Not to Believe Your LLM") | https://arxiv.org/html/2406.02543v2 | search |
| S0b | Beyond "I Don't Know": Evaluating LLM Self-Awareness in Discriminating Data and Model Uncertainty | https://arxiv.org/html/2604.17293 | search (future-dated id; lower-confidence) |
| S1 | Voyager: An Open-Ended Embodied Agent with LLMs (Wang et al., 2023) — abstract + project page | https://arxiv.org/abs/2305.16291 · https://voyager.minedojo.org/ | fetched |
| S2 | Know Your Limits: A Survey of Abstention in LLMs | https://arxiv.org/html/2407.18418v2 | fetched |
| S3 | From Local to Global: A GraphRAG Approach to Query-Focused Summarization (Microsoft, 2024) | https://arxiv.org/html/2404.16130v2 | fetched |
| S3b | GraphRAG: Improving global search via dynamic community selection (Microsoft Research) | https://www.microsoft.com/en-us/research/blog/graphrag-improving-global-search-via-dynamic-community-selection/ | search |
| S4 | A Survey on Deep Active Learning: Recent Advances and New Frontiers (2024) | https://arxiv.org/abs/2405.00334 | fetched (abstract) |
| S4b | BALD / Expected Information Gain (mutual information acquisition; BED connection) | https://www.emergentmind.com/topics/bayesian-active-learning-by-disagreement-bald · https://ae-foster.github.io/posts/2022/04/27/bed-bald.html | search |
| S5 | To Believe or Not to Believe Your LLM (DeepMind) — iterative-prompting mutual information | https://arxiv.org/html/2406.02543v2 | fetched |
| S6 | Detecting hallucinations in LLMs using semantic entropy (Farquhar et al., Nature 2024) | https://www.nature.com/articles/s41586-024-07421-0 · https://oatml.cs.ox.ac.uk/blog/2024/06/19/detecting_hallucinations_2024.html | fetched (OATML blog) |
| S6b | Semantic Entropy Probes: cheap hallucination detection from hidden states | https://arxiv.org/pdf/2406.15927 | search |
| S7 | Semantic entropy — Nature record / IDEAS metadata | https://ideas.repec.org/a/nat/nature/v630y2024i8017d10.1038_s41586-024-07421-0.html | search |
| S8 | Knowledge Boundary of Large Language Models: A Survey (Dec 2024) | https://arxiv.org/html/2412.12472v1 | fetched |
| S9 | A RAG Approach for Generating Competency Questions in Ontology Engineering (2024) + KG quality metrics synthesis | https://arxiv.org/html/2409.08820v1 | search |
| S10 | Bench4KE: Benchmarking Automated Competency Question Generation | https://arxiv.org/pdf/2505.24554 | search |
| S10b | VSPO: Validating Semantic Pitfalls in Ontology via LLM-Based CQ Generation | https://arxiv.org/pdf/2511.07991 | search |
| S11 | FLARE: Active Retrieval Augmented Generation (Jiang et al., EMNLP 2023) | https://arxiv.org/abs/2305.06983 | search |
| S11b | DRAGIN: Dynamic RAG based on Information Needs of LLMs | https://arxiv.org/pdf/2403.10081 | search |
| S12 | ReasoningBank: Scaling Agent Self-Evolving with Reasoning Memory (Google, 2025) | https://arxiv.org/abs/2509.25140 | fetched |
| S13 | OMNI: Open-endedness via Models of human Notions of Interestingness (Zhang, Lehman, Stanley, Clune) | https://arxiv.org/abs/2306.01711 | fetched |
| S13b | OMNI-EPIC: …with Environments Programmed in Code | https://arxiv.org/abs/2405.15568 | search |
| S14 | Bayesian Experimental Design (EIG; topic overview) | https://www.emergentmind.com/topics/bayesian-experimental-design-bed | search |
| S14b | Expected Predictive Information Gain (EPIG) | https://www.emergentmind.com/topics/expected-predictive-information-gain-epig | search |
| S15 | Amortized Bayesian Experimental Design for Decision-Making (Huang et al., 2024; TNDP) | https://arxiv.org/pdf/2411.02064 | search |
| S16 | Intrinsic motivation, curiosity, and learning: learning-progress curriculum (Oudeyer, Gottlieb, Lopes) | http://www.pyoudeyer.com/oudeyerGottliebLopesPBR16.pdf | fetched |
| S17 | A Survey of Self-Evolving Agents: What, When, How, and Where to Evolve | https://arxiv.org/html/2507.21046v4 | fetched |
| S18 | Continual / Lifelong Learning of LLMs surveys (catastrophic forgetting, WISE, SEEKR) | https://arxiv.org/abs/2404.16789 · https://arxiv.org/pdf/2406.06391 | search |

---

*End of dossier. The loop's invariant: the MD's coverage number over its decision-weighted domain map may only rise — and every rise is an evidence-grounded, VOI-justified, retention-checked closure of a gap it identified in itself.*
