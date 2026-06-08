# The State-of-the-Art AI Business Brain Stack

**A research dossier for building a best-in-world autonomous Managing Director (MD) brain**

**Audience:** Borjie engineering + the Mr. Mwikila brain-layer team
**Author context:** Compiled for the AI-native mining estate operating system (Borjie). The "autonomous MD" is the brain that reasons across licences, royalty, treasury, workforce, compliance, marketplace, holdings, succession and the full asset register.
**Date compiled:** 2026-06-08
**Today's reference date:** 2026-06-08 (Borjie environment clock)
**Status:** Living document. Every standard and capability below cites a real URL that was fetched during research. Where a claim could not be independently confirmed against a primary source, it is marked **UNVERIFIED**.

---

## 0. How to read this dossier

This document defines what *world-class* means for nine cognitive subsystems of an autonomous business brain, then maps each to where the capability should live in the Borjie codebase. It is written at the depth a PhD researcher or a 20-year management-consulting partner would expect: every section states (a) the SOTA technique, (b) why it is world-class, (c) the named standards/papers/products that anchor it, and (d) the concrete engineering pattern Borjie should adopt.

The nine subsystems:

1. Retrieval-augmented generation with knowledge graphs (GraphRAG)
2. Long-horizon memory architectures
3. Forecasting, anomaly detection & scenario planning
4. Causal inference for decisions
5. Calibration, confidence & uncertainty quantification
6. Multi-agent debate & verification
7. Evals & red-teaming for trust
8. Structured-output & tool orchestration
9. Trustworthy autonomous-agent design (the synthesis layer — Anthropic + OpenAI 2026 doctrine)

A tenth section covers governance/standards (NIST AI RMF GenAI Profile, Anthropic RSP) that bind all nine together for a regulated, money-moving estate brain.

---

## 1. GraphRAG — Retrieval-Augmented Generation over Knowledge Graphs

### Why this matters for an MD brain
A Managing Director does not answer fact-lookup questions; they answer **global sensemaking** questions — "What are the systemic risks across my entire licence portfolio this quarter?" — that require connecting facts across the whole corpus, not retrieving the single most similar chunk. Vector-only RAG fails at exactly this class of query because semantic similarity retrieves locally relevant passages but cannot synthesize relationships spanning a dataset.

### The state of the art
Microsoft Research's **GraphRAG** builds a knowledge graph from a corpus in two stages: (1) an LLM derives an **entity knowledge graph** (entities + relationships) from source documents; (2) it pre-generates **community summaries** for groups of closely related entities, detected via hierarchical community detection (the Leiden algorithm produces nested communities at multiple resolution levels). At query time it runs **global search** (a map-reduce over community summaries — each community produces a partial answer in the *map* phase, then partials are reduced into a final answer) versus **local search** (entity-anchored retrieval for specific questions). Microsoft reports "substantial improvements over a conventional RAG baseline for both the comprehensiveness and diversity of generated answers" on global sensemaking questions over datasets in the 1M-token range. ([GraphRAG paper, arXiv:2404.16130](https://arxiv.org/abs/2404.16130); [Microsoft Research GraphRAG project](https://www.microsoft.com/en-us/research/project/graphrag/))

**2026 evolution — cost/quality frontier:** Microsoft's **LazyGraphRAG** defers expensive graph/summary construction, "setting new standards for quality and cost efficiency" by optimizing the construction process to cut compute while preserving retrieval quality; GraphRAG/LazyGraphRAG are now production-grade and shipped inside Microsoft Discovery (Azure agentic research platform). ([Microsoft Research GraphRAG project](https://www.microsoft.com/en-us/research/project/graphrag/)) The open-source reference implementation is modular and actively maintained. ([microsoft/graphrag on GitHub](https://github.com/microsoft/graphrag))

**Why it is world-class:** It moves retrieval from "find similar text" to "reason over a structured, explainable map of how entities relate," which yields multi-hop, auditable, corpus-wide answers — and explainability is a hard requirement for a money-path brain. Neo4j frames GraphRAG's core advantage as overcoming vector-only limits by tapping "the rich connections and semantic relationships in a knowledge graph" for "more accurate and explainable responses." ([Neo4j: What is GraphRAG](https://neo4j.com/blog/genai/what-is-graphrag/))

### Engineering pattern for Borjie
- Build the entity graph from the mining corpus (licences, regulations, mineral playbooks) into a typed knowledge graph; precompute Leiden communities + community summaries.
- Route queries: **local search** for "what is the royalty rate for gold in Geita?" vs **global search** for "what cross-cutting compliance themes emerged this quarter?"
- Keep **every answer evidence-cited** (the existing Borjie invariant that each junior recommendation cites ≥1 `evidence_id`) by surfacing the graph paths/community IDs used. This satisfies the Auditor Agent's empty-evidence-chain rejection rule.

---

## 2. Long-Horizon Memory Architectures

### Why this matters for an MD brain
An MD's value compounds over years: they remember last season's negotiation, the precedent set two licences ago, the supplier who under-delivered. A brain that forgets at the context-window boundary is a fresh hire every morning. The canonical research finding here is blunt: **"Long context is not memory"** — extending windows to 200k tokens *underperforms* purpose-built memory systems on selective retrieval, and strong passive-recall does not translate into effective agentic decision-making. ([Memory for Autonomous LLM Agents survey, arXiv 2603.07670](https://arxiv.org/html/2603.07670v1))

### The state of the art — the four-layer memory stack
The field has converged on a cognitive-science-derived taxonomy (originating in CoALA — Cognitive Architectures for Language Agents):

| Memory type | Holds | "Answers the question" |
|---|---|---|
| **Working / short-term** | Whatever is in the current context window | What am I doing right now |
| **Episodic** | Timestamped concrete experiences ("on 3 Mar the Geita negotiation closed at X") with importance scores + embeddings | What happened |
| **Semantic** | Abstracted, de-contextualized knowledge ("this owner prefers conservative treasury posture") | What the policy/fact is |
| **Procedural** | Executable skills / reusable plans (verified routines, callable code) | How to do it |

([Memory survey, arXiv 2603.07670](https://arxiv.org/html/2603.07670v1); [Advancing Agentic Memory overview](https://vinithavn.medium.com/advancing-agentic-memory-an-overview-of-modern-memory-management-architectures-in-llm-agents-8df87b0da58f))

**Memory operations (the write-manage-read loop):** *Writing/encoding* (filter noise, canonicalize, deduplicate, priority-score by relevance + novelty); *managing/consolidation* (merge overlapping entries, resolve contradictions, temporal versioning); *retrieval* (semantic-similarity AND causally-grounded access). ([Memory survey](https://arxiv.org/html/2603.07670v1))

**Storage substrates:** context-resident (capacity-capped, prone to summarization drift); vector-indexed (scalable ANN search — RAG, Reflexion); structured SQL/graph (relational integrity); executable repositories (Voyager's skill library); parametric/weight-based (seamless but hard to audit/delete); and **hierarchical/tiered OS-inspired paging** — **MemGPT** (now **Letta**) pages between a main context (RAM), recall DB, and archival store (disk). ([Memory survey](https://arxiv.org/html/2603.07670v1); [Advancing Agentic Memory](https://vinithavn.medium.com/advancing-agentic-memory-an-overview-of-modern-memory-management-architectures-in-llm-agents-8df87b0da58f))

**Named systems lineage (verified from the survey):** RAG (2020, first generator+retriever coupling) → ReAct (2022, reasoning-action traces as working memory) → Reflexion (2023, verbal self-critiques as episodic memory, 91% HumanEval pass@1) → Generative Agents (2023, observe→reflect→plan cycle) → Voyager (2023, procedural skill library, 15.3× faster Minecraft progression) → MemGPT (2024, OS-tiered memory) → MemoryBank (2024, Ebbinghaus forgetting-curve decay) → Agentic Memory (2026, RL-optimized memory operations). ([Memory survey](https://arxiv.org/html/2603.07670v1))

**Anthropic's production doctrine for long-horizon memory** (the engineering, not just the research): three named techniques — **compaction** (summarize history near the window limit, "maximize recall first, then iterate for precision," preserving architectural decisions/unresolved bugs while discarding redundant tool outputs); **structured note-taking / agentic memory** (the agent writes notes persisted *outside* the context window and re-reads them — "persistent memory with minimal overhead"); and **sub-agent architectures** (specialists work in clean isolated context windows and return a "condensed, distilled summary... often 1,000–2,000 tokens"). ([Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) Anthropic's long-running-agent harness work adds: a `claude-progress.txt` progress file, git history with descriptive commits for revert/recovery, and a JSON feature-list with pass/fail status (the model "is less likely to inappropriately change or overwrite JSON files compared to Markdown"). ([Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents))

**Evaluation — the honest benchmarks:** Classical IR metrics (Precision@k, nDCG) fall short because they ignore whether the agent actually *uses* retrieved memory. Use **LoCoMo** (≤35 sessions, 300+ turns), **MemBench** (factual vs reflective memory), **MemoryAgentBench** (four cognitive competencies + explicit selective-forgetting), and **MemoryArena** (2026, multi-session interdependent tasks — models that are near-perfect on LoCoMo collapse to 40–60% here). ([Memory survey](https://arxiv.org/html/2603.07670v1))

### Engineering pattern for Borjie
- Implement all four layers, not two — most systems only do two layers well; the differentiator is real **procedural** (skill library) + **episodic** memory with consolidation.
- **Learn to forget**: principled consolidation + selective deletion under safety constraints, not hoard-vs-amnesia. Run "offline consolidation" during idle periods.
- Causally-grounded retrieval (traverse causal links, not just cosine similarity) — this dovetails with §4.
- Benchmark against MemoryArena-style multi-session interdependent tasks, not LoCoMo, before claiming the memory works.

---

## 3. Forecasting, Anomaly Detection & Scenario Planning

### Why this matters for an MD brain
Treasury runway, commodity-price exposure, equipment-failure risk, royalty receipts — every MD decision is a bet against an uncertain future. World-class means **probabilistic** forecasts (full distributions, not point estimates), **zero-shot generalization** across new mines/minerals, and **calibrated** uncertainty you can size positions against.

### State of the art — Time-Series Foundation Models (TSFMs)
Foundation models went mainstream for forecasting. The 2026 toolkit of zero-shot forecasters with open weights:

| Model | Vendor | Key properties |
|---|---|---|
| **TimesFM (2.5)** | Google Research | Patch-based decoder-only, pretrained on ~100B real-world time points; 200M params; reported #1 on **GIFT-Eval** across 28 datasets; enterprise-grade |
| **Chronos-2** | Amazon | Zero-shot, univariate + multivariate, covariate-informed; T5-based; 5 sizes (9M–710M) |
| **MOIRAI-2** | Salesforce | "Any-variate" attention, mixed frequencies, decoder-only |
| **Lag-Llama** | Open-source | **Probabilistic** outputs with uncertainty intervals; few-shot; CPU/GPU |
| **Time-LLM** | Open-source | Reuses frozen LLMs (GPT-2/LLaMA/BERT) as forecasting backbones |

([MachineLearningMastery: 2026 Time Series Toolkit](https://machinelearningmastery.com/the-2026-time-series-toolkit-5-foundation-models-for-autonomous-forecasting/); [TimesFM on Google Cloud BigQuery](https://docs.cloud.google.com/bigquery/docs/timesfm-model)) TSFMs turn forecasting "from a model training problem into a model-selection challenge" — adopt when you need fast deployment, cross-domain generalization, and low ML-infra overhead. Still evaluate per use case on uncertainty quantification, multivariate support, infra constraints and scale. ([MachineLearningMastery](https://machinelearningmastery.com/the-2026-time-series-toolkit-5-foundation-models-for-autonomous-forecasting/))

### Anomaly detection
TSFMs do anomaly detection by comparing current signals against their learned representation of normal behavior — flagging deviations, with cross-domain generalization improving zero-shot performance even where anomalies are rare. TimesFM specifically is used for predictive maintenance + anomaly detection (reported 10×–30× maintenance ROI in industrial settings). Newer work pushes adapters (**STAR**, state-aware) and LLM-mediated continuous adaptive detection (**CALM**) for streaming. ([Pebblous: TimesFM industrial forecasting](https://blog.pebblous.ai/report/timesfm-industrial-forecasting/en/); [STAR, arXiv 2510.16014](https://arxiv.org/pdf/2510.16014); [CALM, arXiv 2508.21273](https://arxiv.org/pdf/2508.21273))

### Forecast accuracy — the metrics that separate amateurs from world-class
Point-estimate accuracy is the wrong scorecard for a probabilistic brain. Use the right metric per question:
- **WMAPE** for multi-SKU/multi-series portfolios with mixed volumes.
- **MASE** (Mean Absolute Scaled Error) to compare across different-scale series — and because, unlike MAPE, it does not blow up on small/zero actuals.
- **Pinball loss** (a.k.a. quantile loss) to grade a *specific quantile* — essential when you set treasury safety buffers at, say, the 95th percentile; it tells you whether the model is good *at that tail*, not just on average.
- **CRPS** (Continuous Ranked Probability Score) + **calibration** for full-distribution quality.
- **Scaled Pinball Loss (SPL)** — the official scoring function of the **M5 Uncertainty competition**, designed to compare multiple series of different scales. ([Prospeo: Forecast Accuracy Metrics 2026](https://prospeo.io/s/forecast-accuracy-metrics); [Prospeo: Forecasting Metrics 2026](https://prospeo.io/s/forecasting-metrics); [M5 Uncertainty competition results (ResearchGate)](https://www.researchgate.net/publication/346493740_The_M5_Uncertainty_competition_Results_findings_and_conclusions))

### Scenario planning under uncertainty
World-class scenario planning replaces single-point deterministic forecasts with **probabilistic ranges** via **Monte Carlo simulation** — answering "how likely are we to come in under budget?" rather than "what is the budget?" Use it when the decision depends on multiple uncertain inputs that interact nonlinearly and where tail outcomes materially change the preferred action. Combine with **Bayesian networks** (graphical models for decision analysis under uncertainty) and Bayesian updating / MCMC; underpin everything with EV, variance, VaR and CVaR. The goal is a strategy that is **robust across scenarios**, not optimal for one. ([Lumivero: Monte Carlo intro](https://lumivero.com/resources/blog/an-introduction-to-monte-carlo-simulation/); [Galorath: Monte Carlo methods](https://galorath.com/risk/monte-carlo-simulation/); [Bayesian networks + Monte Carlo, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6950629/))

### Engineering pattern for Borjie
- Stand up a TSFM (TimesFM or Chronos-2) for zero-shot forecasting across mines/minerals; output quantiles, not points.
- Grade forecasts with MASE + Scaled Pinball Loss + CRPS on a rolling backtest; track quantile calibration explicitly.
- Wire anomaly detection off the same TSFM representations (treasury anomalies, equipment telemetry, royalty-receipt deviations).
- For strategic decisions, run Monte Carlo over the forecast distributions + a Bayesian-network model of estate dependencies; report VaR/CVaR and a scenario-robust recommendation, never a single number.

---

## 4. Causal Inference for Decisions

### Why this matters for an MD brain
Prediction answers "what will happen"; an MD must answer "what happens **if I act**" — the interventional and counterfactual questions. Correlational ML cannot distinguish "ice-cream sales predict drownings" from "ice-cream causes drownings." A brain that confuses the two will recommend disastrous interventions. The market is voting: causal-AI market valued at ~$81.4B (2025) projected to ~$116B (2026) with ~25% more orgs planning adoption by 2026. ([S&P Global: Causal AI](https://www.spglobal.com/en/research-insights/special-reports/causal-ai-how-cause-and-effect-will-change-artificial-intelligence) — *adoption figures via search-surfaced market reports; market-size figures themselves are* **UNVERIFIED** *against a primary report*)

### State of the art
The theoretical spine is **Judea Pearl's structural causal models (SCMs)**: structural equations, the **do-operator** for interventions, **do-calculus** (rules for deriving causal effects from observational data), and **counterfactuals** — the three rungs of the "ladder of causation" (association → intervention → counterfactual). ([NISS: Causal AI in Business Practices (Victor Lo slides)](https://www.niss.org/sites/default/files/news_attachments/Victor%20Lo%20Slides%20-%20Causal%20AI%20in%20Business%20Practices%2001.24.25.pdf))

Modern estimation methods that make this operational on observational business data:
- **Double / Debiased Machine Learning (DML)** — uses ML nuisance models with orthogonalization for valid treatment-effect estimates.
- **Causal forests** — heterogeneous treatment effects (who responds, not just average effect).
- **Uplift modeling** — models the *incremental* effect of an action per unit (the core of "treat vs don't-treat" decisions). Uber's open-source **CausalML** packages uplift + treatment-effect estimation.
- **Bayesian networks** for structured causal decision analysis.

([Towards Data Science: Causal Inference Is Eating ML](https://towardsdatascience.com/causal-inference-is-eating-machine-learning/); [WJARR: Causal AI for strategic business planning](https://wjarr.com/content/causal-ai-strategic-business-planning-uncovering-latent-drivers-long-term-organizational); [Uplift Modeling Under Limited Supervision, arXiv 2403.19289](https://arxiv.org/pdf/2403.19289))

**Emerging frontier — neuro-symbolic-causal agents:** combining LLM reasoning with explicit causal structure for robust multi-objective agents that don't just pattern-match. ([Neuro-Symbolic-Causal Architecture, arXiv 2510.23682](https://arxiv.org/pdf/2510.23682))

**Why it is world-class:** Causal AI lets the MD "simulate, test, and optimize strategic actions with scientific rigor" and "uncover latent drivers of long-term organizational performance and resilience" — i.e., reason about interventions, not just forecasts. ([WJARR](https://wjarr.com/content/causal-ai-strategic-business-planning-uncovering-latent-drivers-long-term-organizational))

### Engineering pattern for Borjie
- Encode the estate's causal structure (licence → production → royalty → treasury; workforce policy → productivity) as an SCM / Bayesian network.
- For "should I do X?" decisions, run **uplift / DML / causal-forest** estimation on historical data to get the incremental effect, with confidence intervals.
- Always surface the causal assumptions (the DAG) as part of the evidence chain — an MD recommendation should show *why* it believes the action causes the outcome, satisfying the evidence-required invariant.

---

## 5. Calibration, Confidence & Uncertainty Quantification

### Why this matters for an MD brain
An autonomous MD that is confidently wrong about a money-path decision is worse than no MD. World-class means the brain **knows what it doesn't know** and can **abstain or escalate** — confidence numbers that are *trustworthy*, not vibes.

### State of the art
**The hard truth:** asking an LLM for its own confidence ("how sure are you, 0–100?") is unreliable — models are poorly calibrated and prone to overconfidence; verbalized confidence is a weak signal. ([Zylos Research: LLM Calibration & UQ in Production AI Agents](https://zylos.ai/research/2026-04-18-llm-calibration-uncertainty-production-agents))

The credible techniques:
- **Conformal prediction** — distribution-free, finite-sample-valid **prediction sets** with a guaranteed coverage level, calibrated on a held-out set. Applied to LLMs to make prompt-level **answer/abstain** decisions and produce response-level prediction sets. Variants use logits, confidence scores, or self-consistency as the conformal score. ([Quantifying LLMs Uncertainty with Conformal Predictions (Capgemini)](https://medium.com/capgemini-invent-lab/quantifying-llms-uncertainty-with-conformal-predictions-567870e63e00); [Adaptive Conformal Semantic Entropy, arXiv 2605.04295](https://arxiv.org/html/2605.04295))
- **Conformal abstention** — use conformal bounds to make the model *abstain* (say "I don't know" / escalate) rather than hallucinate, directly mitigating hallucinations. ([Mitigating LLM Hallucinations via Conformal Abstention, arXiv 2405.01563](https://arxiv.org/pdf/2405.01563))
- **Semantic entropy** — sample multiple generations, cluster by *meaning* (not surface form), and measure dispersion across semantically distinct clusters; high semantic entropy correlates with errors, especially under distribution shift. More reliable than verbalized confidence but compute-heavy. ([Zylos Research](https://zylos.ai/research/2026-04-18-llm-calibration-uncertainty-production-agents); [Adaptive Conformal Semantic Entropy, arXiv 2605.04295](https://arxiv.org/html/2605.04295))
- **Selective prediction** — formally choose to predict-or-abstain to hit a target risk; **Prune 'n Predict** uses conformal prediction to optimize LLM decision-making by pruning options to a calibrated set. ([Prune 'n Predict, arXiv 2501.00555](https://arxiv.org/pdf/2501.00555))
- **Calibration-aware Fine-Tuning (CFT)** — preserves calibration while optimizing helpfulness, treating the alignment-vs-calibration tradeoff as an artifact of current training, not a law. ([Zylos Research](https://zylos.ai/research/2026-04-18-llm-calibration-uncertainty-production-agents))
- **Conformal bounds for LLM-as-judge** — even the evaluator's uncertainty can be bounded with interval evaluations. ([Analyzing Uncertainty of LLM-as-a-Judge, arXiv 2509.18658](https://arxiv.org/html/2509.18658v1))

**Production guidance:** "Semantic entropy or conformal bounds computed from actual generations are more reliable signals than verbalized confidence, though they require significant compute investment." ([Zylos Research](https://zylos.ai/research/2026-04-18-llm-calibration-uncertainty-production-agents))

### Engineering pattern for Borjie
- Replace any "model self-rated confidence" with **conformal prediction sets** calibrated per decision class (e.g., royalty calc vs strategic recommendation).
- Use **conformal abstention / selective prediction** to drive the escalate-to-human trigger: below the calibrated confidence threshold, the MD pauses and asks (consistent with OpenAI's failure-threshold human-intervention pattern, §9).
- For high-stakes/non-verifiable outputs, run **semantic-entropy** sampling and refuse to act on high-dispersion answers.
- Borjie already has `calibration-monitor`, `conformal-calibration-online`, and `conformal-calibration` packages — these should implement exactly this stack and feed the autonomy-governance gate.

---

## 6. Multi-Agent Debate & Verification

### Why this matters for an MD brain
A single model's first answer is a single point of failure. Boards exist because diverse, adversarial scrutiny catches errors one mind misses. World-class business brains reproduce this with **multi-agent debate** and **verification** before acting on consequential conclusions.

### State of the art
**Multiagent debate** (the foundational result): treat multiple instances of the model as a "multiagent society" — each instance independently proposes an answer + reasoning, then reads the others' answers and critiques/revises over several rounds, converging on a consensus. This "significantly enhances mathematical and strategic reasoning" and "improv[es] the factual validity of generated content, reducing fallacious answers and hallucinations." Accuracy scales with both more agents and more rounds (the original experiments used 3 agents × 2 rounds for compute reasons but showed gains from expanding either). It also works across different model architectures, leveraging complementary strengths. ([Improving Factuality and Reasoning through Multiagent Debate, arXiv:2305.14325](https://arxiv.org/abs/2305.14325); [project page](https://composable-models.github.io/llm_debate/))

**Cross-examination** — one model acts as a "cross-examiner," repeatedly asking follow-up questions of another's claims; this yields significant factuality gains over plain chain-of-thought.

**2026 debate frameworks (verified):**
- **Tool-MAD** — multi-agent debate for **fact verification** with *iterative external evidence retrieval* and dynamic interactions among specialized agents (vs static-evidence single-agent methods); up to **35% performance gains** over existing debate systems. ([Tool-MAD, arXiv 2601.04742](https://www.arxiv.org/pdf/2601.04742))
- **MAD-Fact** — debate framework for **long-form factuality** evaluation. ([MAD-Fact, arXiv 2510.22967](https://arxiv.org/html/2510.22967v2))
- **Markov-chain-based debate** — for hallucination *detection* on QA. ([arXiv 2406.03075](https://arxiv.org/pdf/2406.03075))
- Multi-agent debate also **hardens against adversarial attacks**. ([Combating Adversarial Attacks with Multi-Agent Debate, arXiv 2401.05998](https://arxiv.org/pdf/2401.05998))

**Anthropic's parallelization patterns** map debate to two production primitives: **sectioning** (independent subtasks in parallel — e.g., one agent processes the request while another screens it) and **voting** (run the same task multiple times for diverse outputs with an adjustable vote threshold — used for code-vuln review and content-appropriateness checks). ([Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents))

**Evaluator-optimizer loop** (Anthropic): one LLM generates, another evaluates and gives feedback, iterating — use when clear eval criteria exist and iteration demonstrably improves output (e.g., literary translation, multi-round search). ([Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents))

### Engineering pattern for Borjie
- For consequential/non-verifiable decisions, run **debate or voting** (3+ juniors, ≥2 rounds) before the MD commits; require evidence-grounded critiques (Tool-MAD style: agents must retrieve evidence, not just opine).
- Use an **evaluator/auditor agent** as the final gate (Borjie already has an Auditor Agent that rejects empty-evidence chains — extend it to run cross-examination on the winning answer).
- This is the "debate" half of Borjie's existing `blackboard-intel` / `blackboard-sota` and `central-intelligence/debate` machinery; the SOTA upgrade is *evidence-retrieving* debate + voting thresholds.

---

## 7. Evals & Red-Teaming for Trust

### Why this matters for an MD brain
You cannot deploy an autonomous money-mover on faith. World-class means a **continuous, calibrated, adversarial** evaluation regime — pre-deployment and in production — that scores not just final answers but the *trajectory* the agent took.

### State of the art — LLM-as-judge done rigorously
LLM-as-judge is the workhorse, but naive use is dangerous. The 2026 best-practice rules:
- **Calibrate against a labeled gold set before production** — "calibration against a labeled gold set is mandatory." Validate the judge against human baselines. ([FutureAGI: LLM-as-Judge Best Practices 2026](https://futureagi.com/blog/llm-as-judge-best-practices-2026); [Openlayer: LLM-as-Judge Guide March 2026](https://www.openlayer.com/blog/post/llm-as-judge-evaluation-guide))
- **Control known biases:** **position bias** (judges favor the first option / specific rubric positions), plus **length** and **family/self-preference** bias. Mitigate with **swap-and-average / both-order evaluation**, randomization, and **balanced-permutation** rubric strategies. ([Position Bias in Rubric-Based LLM-as-a-Judge, arXiv:2602.02219](https://arxiv.org/abs/2602.02219); [Position Bias in LLM Judges (Brenndoerfer)](https://mbrenndoerfer.com/writing/position-bias-in-llm-judges))
- **Cost tiering:** reserve frontier models (latest Claude/GPT/Gemini) for *calibration and audits*; use distilled small judges for production scale at 10–50× lower cost. ([FutureAGI](https://futureagi.com/blog/llm-as-judge-best-practices-2026))
- **Bound the judge's own uncertainty** with conformal interval evaluations (§5). ([arXiv 2509.18658](https://arxiv.org/html/2509.18658v1))

### Agentic / trajectory evaluation
For agents, scoring only the final answer is insufficient — **trajectory evaluation** scores "the path an agent takes... its sequence of tool calls, tool inputs and outputs, intermediate reasoning, and retries." Benchmarks: **TRAJECT-Bench** (fine-grained tool-selection + argument-correctness diagnostics), **AgentRewardBench** (1,302 web-agent trajectories; finding: *no single LLM excels across all benchmarks*), **ATBench** (safety-focused trajectory diagnosis). ([TRAJECT-Bench, arXiv:2510.04550](https://arxiv.org/abs/2510.04550); [AgentRewardBench, arXiv 2504.08942](https://arxiv.org/pdf/2504.08942); [Confident AI: LLM Agent Evaluation Metrics 2026](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide); [ATBench, arXiv 2604.02022](https://arxiv.org/pdf/2604.02022)) Toward standardization: the field is moving "from models to agents" in evaluation. ([Towards More Standardized AI Evaluation, arXiv 2602.18029](https://arxiv.org/pdf/2602.18029))

### Red-teaming — frontier-lab doctrine
Anthropic's **Frontier Red Team** runs novel adversarial tests including long-horizon, multi-step cyber-offense tasks, with a stated goal of red-teaming methods that "surpass the collective contributions from the hundreds of participants" in bug bounties. Their **Responsible Scaling Policy (RSP) v3.0** is the governance scaffold: capability thresholds trigger **AI Safety Levels (ASL)**; ASL-3 requires "not deploy[ing]... if [models] show any meaningful catastrophic misuse risk under adversarial testing by world-class red-teamers," with input/output classifiers as safeguards; **Frontier Safety Roadmaps** + **Risk Reports** (published every 3–6 months) provide transparent accountability across Security, Alignment, Safeguards, Policy, reviewed by third-party experts. ([Anthropic RSP v3.0](https://www.anthropic.com/news/responsible-scaling-policy-v3); [Anthropic Responsible Scaling Policy](https://www.anthropic.com/responsible-scaling-policy); [Fortune: Anthropic Red Team](https://fortune.com/2025/09/04/anthropic-red-team-pushes-ai-models-into-the-danger-zone-and-burnishes-companys-reputation-for-safety/))

### Engineering pattern for Borjie
- Build a **gold eval set** of MD decisions with human-labeled "correct," and calibrate the judge against it before trusting any automated score.
- Run **trajectory evals** (tool-call correctness, evidence-citation presence, escalation correctness) — not just answer evals.
- De-bias the judge (swap-and-average, balanced rubric permutation); bound its uncertainty conformally.
- Maintain a **standing red-team** (prompt injection, jailbreaks, money-path abuse, RLS-bypass attempts) with pre-deployment gates and in-production monitoring — mirroring RSP's pre-deployment + asynchronous-monitoring + rapid-response layers.
- Borjie packages `fairness-eval`, `bias-handling`, `ethics-framework`, `probe-runners`, `sae-probe` and the `evals/` red-team tree are the homes for this.

---

## 8. Structured-Output & Tool Orchestration

### Why this matters for an MD brain
Autonomy means *acting* — calling tools to post ledger entries, file compliance, draft contracts. Acting requires outputs that are machine-valid by construction and a tool layer the model can use without fumbling.

### State of the art — structured outputs
The 2026 paradigm is **schema-first development**: define schemas in Zod (TypeScript) / Pydantic (Python) *first*, then build prompts around them — don't "prompt for JSON and hope." Set `strict: true` so function calls "reliably adhere to the function schema" — recommended always-on. The **Context-Free Grammar (CFG) engine** enforces this at the token level: "the model literally cannot generate tokens that violate your schema." Production error-handling order: (1) did the model **refuse**? (graceful fallback) (2) was output **cut off**? (retry / extend max_tokens) (3) otherwise you're "guaranteed valid, schema-conformant output." ([OpenAI: Function calling guide](https://developers.openai.com/api/docs/guides/function-calling); [OpenAI: Structured outputs](https://platform.openai.com/docs/guides/structured-outputs); [Guide to structured outputs & function calling](https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms))

### State of the art — tool design (the Agent-Computer Interface)
Anthropic argues investing in the **Agent-Computer Interface (ACI)** deserves as much effort as human-computer interface (HCI) design:
- Give the model **enough tokens to reason** before committing to a format; keep formats close to text the model saw on the internet; eliminate overhead (line-counting, escaping).
- Document tools like a "docstring for a junior developer" — example usage, edge cases, boundaries, clear parameter names.
- **Poka-yoke** the arguments: "change the arguments so that it is harder to make mistakes" (e.g., require absolute filepaths to eliminate a whole error class).
- Test extensively; in their SWE-bench work Anthropic "spent more time optimizing tools than the overall prompt."

Context-engineering corollaries: tools must be **token-efficient** (return only needed bits), **self-contained, robust to error, and extremely clear**; avoid **bloated tool sets** with overlapping functionality; parameters "descriptive, unambiguous." ([Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents); [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))

### State of the art — the orchestration protocol layer (MCP + A2A)
**Model Context Protocol (MCP)** is now the open standard for connecting models to tools/data. Introduced by Anthropic (Nov 2024), it standardizes integration so an agent connects to MCP servers instead of bespoke per-tool orchestration; the protocol handles communication, auth, and error recovery. In Dec 2025 Anthropic **donated MCP to the Agentic AI Foundation** (a Linux Foundation directed fund, co-founded with Block and OpenAI) — vendor-neutral governance, like Kubernetes. SDKs exist for TypeScript, Python, C#, Java, Swift; 500+ public servers; growth to ~97M monthly installs in ~16 months. The complementary **A2A (Agent-to-Agent)** protocol coordinates *teams* of agents: "MCP gives an individual agent its hands... A2A gives a team of agents the ability to coordinate." 2026 MCP roadmap priorities: transport/scalability (stateful-session bottlenecks), reliable async Tasks (retry/expiry), governance maturation, and enterprise readiness (audit trails, SSO, gateways). ([Anthropic: Donating MCP / Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation); [Model Context Protocol — Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol); [MCP GitHub org](https://github.com/modelcontextprotocol); [MCP 2026 Roadmap](https://a2a-mcp.org/blog/mcp-2026-roadmap))

OpenAI's tool taxonomy for agents: **data tools** (retrieve context), **action tools** (take actions in systems), **orchestration tools** (other agents-as-tools). Instructions should be derived from existing **SOPs**. ([OpenAI: A practical guide to building agents (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf))

### Engineering pattern for Borjie
- Every MD action goes through a **strict-schema tool** (Zod) with CFG-level enforcement; never free-text the money path.
- Apply ACI discipline + poka-yoke to ledger/compliance tools (e.g., currency must be passed as a code, never inferred — aligning with the no-hardcoded-currency invariant).
- Expose Borjie capabilities via **MCP servers** (the repo already has `mcp`, `mcp-server`, `mcp-cost-persistence`); use A2A-style coordination for the manager→junior topology.
- Rate-rate tools (low/medium/high) and gate high-risk tool calls (see §9).

---

## 9. Trustworthy Autonomous-Agent Design (the synthesis)

This is where the nine subsystems become *one MD*. Two frontier labs have published the canonical doctrine; they agree on the spine.

### Anthropic — five principles for trustworthy agents
1. **Keep humans in control** — per-tool permissions ("always allow / needs approval / block"); **Plan Mode** (Claude shows its *complete* plan upfront for review/edit before execution, instead of step-by-step approvals); intervention available throughout; visible, steerable subagent coordination.
2. **Align with human values** — train models to *pause* in ambiguous situations ("raising concerns, seeking clarification, or declining to proceed" over acting on assumptions — Constitutional AI); calibrate when to act vs escalate, balancing excessive interruption against risky autonomy.
3. **Secure agents' interactions** — train to recognize prompt-injection patterns; monitor production traffic to block real attacks; external red-teaming; *multi-layered defense* ("no single line of defense is enough").
4. **Maintain transparency** — publish usage/failure-mode evidence; the open MCP standard; support standardized benchmarks and third-party evaluation.
5. **Protect privacy** — runs through every other principle.
([Anthropic: Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents))

### Anthropic — building-blocks taxonomy (workflows vs agents)
**Workflows** orchestrate LLMs+tools through *predefined code paths*; **agents** let the LLM *dynamically direct its own process*. Build up in this order, adding complexity only when needed: **augmented LLM** (retrieval + tools + memory) → **prompt chaining** (with validation "gates") → **routing** (classify then specialize; also model-tiering Haiku/Sonnet) → **parallelization** (sectioning + voting) → **orchestrator-workers** (dynamic decomposition + synthesis) → **evaluator-optimizer** (generate/critique loop) → **autonomous agents** (operate in a loop on environmental feedback, with **ground-truth acquisition each step, checkpoint pausing, and stopping conditions / max iterations**). Three guiding principles throughout: **maintain simplicity, prioritize transparency (show the plan), carefully craft the ACI.** Start with the simplest thing; single LLM calls with retrieval + examples often suffice; if you adopt a framework, "ensure you understand the underlying code." Safeguards: sandboxed testing, guardrails, **human review even when automated tests pass.** ([Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents))

### OpenAI — the practical agent doctrine
**When to build an agent (all should hold):** complex decision-making; hard-to-maintain rule systems; heavy reliance on unstructured data. Otherwise "a deterministic solution may suffice." **Three core components:** model, tools, instructions (derived from SOPs). **The run loop:** every orchestration has a *run* — a loop until an **exit condition** (a final-output tool, a no-tool-call response, errors, or max turns). **Orchestration:** start single-agent (use **prompt templates** with policy variables to manage complexity before going multi-agent), then graduate to multi-agent — the **manager pattern** (a central manager delegates to specialists via *tool calls*; edges = tool calls) or the **decentralized pattern** (peers *handoff* execution; edges = handoffs). ([OpenAI: A practical guide to building agents (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf); [OpenAI: A practical guide (landing)](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/))

**OpenAI's layered guardrails** ("a single one is unlikely to provide sufficient protection... multiple, specialized guardrails together"):
- **Relevance classifier** — keep responses in scope (flag off-topic).
- **Safety classifier** — detect jailbreaks / prompt injections.
- **PII filter** — vet output for personally identifiable information.
- **Moderation** — flag hate/harassment/violence.
- **Tool safeguards** — rate every tool **low/medium/high** (read vs write, reversibility, permissions, financial impact); high-risk → pause for checks or escalate.
- **Rules-based protections** — blocklists, input-length limits, regex (e.g., SQL-injection).
- **Output validation** — brand/values alignment via prompt + content checks.
The SDK treats guardrails as **first-class**, using **optimistic execution** with **tripwires** that raise exceptions on violation. ([OpenAI guide (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf))

**OpenAI — human intervention triggers (two):** (1) **exceeding failure thresholds** (retry/action limits → escalate); (2) **high-risk actions** (sensitive/irreversible/high-stakes — "canceling user orders, authorizing large refunds, or making payments") → human oversight until reliability is proven. ([OpenAI guide (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf))

**Autonomy is measurable + rising:** Anthropic reports the 99.9th-percentile agent turn duration nearly doubled (≈<25 min → >45 min) between Oct 2025 and Jan 2026, and showcased 7-hour autonomous coding runs — the autonomy that creates value also creates new risk, which is exactly why the guardrail/eval/calibration stack above is load-bearing. ([Anthropic: Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy); [IntuitionLabs: Anthropic's 2026 B2B vision](https://intuitionlabs.ai/articles/ai-agents-b2b-productivity-anthropic))

### Engineering pattern for Borjie
- The MD is a **manager-pattern orchestrator** over specialist juniors (persona-runtime / juniors / junior-ai-factory), each MCP-tooled.
- Wrap it in **layered guardrails** (relevance, safety/injection, PII, moderation, rules, output validation) + **tool risk-rating** that maps directly to the money-path invariant (every ledger write is "high" → gated).
- Default to **Plan Mode**: the MD presents its plan + evidence before executing consequential actions; per-action permissions.
- Hard **stopping conditions** + the two human-intervention triggers feed off the §5 calibration signal.

---

## 10. Governance & Standards Binding It All Together

For a regulated, money-moving, multi-jurisdiction estate brain (TZ launch; KE/UG/NG expansion), the cognitive stack must sit inside a recognized risk-governance frame.

### NIST AI Risk Management Framework — Generative AI Profile (NIST AI 600-1)
Published **26 July 2024**, NIST AI 600-1 is the cross-sectoral GenAI companion to the AI RMF 1.0. It is organized around the four core RMF functions — **Govern, Map, Measure, Manage** — and enumerates **12 GenAI risk categories**, with 200+ suggested actions mapped to RMF functions:
1. CBRN information or capabilities · 2. **Confabulation** (hallucination) · 3. Dangerous, violent, or hateful content · 4. **Data privacy** · 5. Environmental impacts · 6. Harmful bias or homogenization · 7. **Human-AI configuration** · 8. **Information integrity** · 9. **Information security** · 10. Intellectual property · 11. Obscene, degrading and/or abusive content · 12. Value chain and component integration.
The working group prioritized four areas: **Governance, Content Provenance, Pre-deployment Testing, and Incident Disclosure**; suggested actions emphasize red-teaming GenAI systems, testing against minimum bias/accuracy benchmarks, incident-response teams, and lifecycle governance integration. ([NIST AI 600-1 publication page](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence); [NIST AI 600-1 full PDF](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf); [DLA Piper: NIST GenAI Profile key points](https://www.dlapiper.com/en-us/insights/publications/ai-outlook/2024/nist-releases-its-generative-artificial-intelligence-profile)) An **agentic profile** of the NIST AI RMF is in development under the Cloud Security Alliance. ([CSA: Agentic NIST AI RMF Profile v1](https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/))

### Anthropic Responsible Scaling Policy v3.0
The governance pattern to emulate at estate scale: **capability thresholds** trigger stricter **AI Safety Levels (ASL)**; ASL-3 = input/output classifiers + a commitment not to deploy if adversarial testing by world-class red-teamers shows meaningful catastrophic-misuse risk; **Frontier Safety Roadmaps** (goals across Security/Alignment/Safeguards/Policy) + **Risk Reports** every 3–6 months + third-party external review. ([Anthropic RSP v3.0](https://www.anthropic.com/news/responsible-scaling-policy-v3))

### How Borjie should bind these
- Map the MD brain's controls to **Govern/Map/Measure/Manage**, with explicit mitigations for Confabulation (→ §5 conformal abstention + §1 evidence-cited GraphRAG), Information Integrity (→ §6 debate/verification), Information Security (→ §9 injection defenses, RLS, kill-switch), Human-AI Configuration (→ §9 human-intervention triggers, Plan Mode), and Data Privacy (→ PII filters, `data-protection`/`graph-privacy`/`dp-federation`).
- Adopt an RSP-style internal policy: capability-threshold gates on what the autonomous MD may do unsupervised, with periodic risk reports — Borjie's `autonomy-governance` + `mutation-authority` + `approval-grants` packages are the enforcement points.

---

## 11. Codebase mapping — which Borjie packages carry which capability

| Capability (section) | Borjie package(s) |
|---|---|
| GraphRAG / knowledge graph (§1) | `graph-rag-router`, `knowledge-graph`, `graph-database`, `graph-sync`, `org-graph`, `graph-viz`, `info-synthesis` |
| Long-horizon memory (§2) | `cognitive-memory`, `memory-v2`, `persistent-memory`, `memory-port-extensions`, `memory-tool-wire-adapter`, `user-context-store`, `tacit-knowledge`, `skill-library` (procedural) |
| Forecasting / anomaly / scenario (§3) | `forecasting`, `forecasting-engine`, `anomaly-detection`, `analytics`, `market-intelligence`, `mining-commodity-intelligence` |
| Causal inference (§4) | `causal-inference`, `belief-engine`, `reasoning-substrate`, `strategic-layer` |
| Calibration / uncertainty (§5) | `calibration-monitor`, `conformal-calibration-online`, `conformal-calibration`, `process-reward-model` |
| Multi-agent debate / verification (§6) | `blackboard-intel`, `blackboard-sota`, `central-intelligence` (debate/kernel), `loop-quality-gates`, `ai-reviewer`, Auditor Agent in `ai-copilot/audit-trail` |
| Evals / red-teaming (§7) | `fairness-eval`, `bias-handling`, `ethics-framework`, `probe-runners`, `sae-probe`, `ai-copilot/eval`, `evals/` tree, `post-training-rlvr` |
| Structured output / tool orchestration (§8) | `mcp`, `mcp-server`, `mcp-cost-persistence`, `agent-platform`, `agent-orchestrator`, `agent-runtime`, `module-orchestrator`, `workflow-engine`, `tool` wiring in `central-intelligence` |
| Trustworthy autonomy synthesis (§9) | `autonomy-governance`, `agent-security-guard`, `tenant-isolation-guard`, `mutation-authority`, `approval-grants`, `persona-runtime`, `juniors`, `junior-ai-factory`, `central-intelligence/policy-gate`, `central-intelligence/kernel` (inviolable / policy-gate) |
| Governance & standards (§10) | `compliance-pack`, `compliance-plugins`, `regulatory-tz-mining`, `jurisdiction-profiles`, `data-protection`, `graph-privacy`, `dp-federation`, `audit-hash-chain`, `observability`, `enterprise-hardening` |

**Persona/junior allocation:** the MD persona (manager-pattern orchestrator) lives in `persona-runtime`; domain juniors (treasury, compliance, geology, workforce, marketplace) are the specialist workers in `juniors` / `junior-ai-factory`, each MCP-tooled and debate-eligible. The Auditor Agent (`ai-copilot/audit-trail`) is the §6 verification gate; `autonomy-governance` is the §9 + §10 enforcement layer; `calibration-monitor` (§5) supplies the escalate-to-human signal.

---

## 12. The world-class bar, in one paragraph

A best-in-world autonomous MD brain answers *global sensemaking* questions over an explainable knowledge graph (GraphRAG), remembers across years via a four-layer episodic/semantic/procedural/working memory with principled consolidation and selective forgetting, forecasts the future as *calibrated distributions* (TSFM + pinball/CRPS/MASE), reasons about *interventions and counterfactuals* (SCMs, do-calculus, uplift/DML/causal forests) rather than mere correlations, *knows what it doesn't know* and abstains/escalates via conformal prediction and semantic entropy, subjects consequential conclusions to *evidence-retrieving multi-agent debate and an auditor*, is *continuously and adversarially evaluated* on trajectories (not just answers) with a calibrated, de-biased judge and a standing red team, *acts only through strict-schema, poka-yoke'd, risk-rated tools over MCP*, and is wrapped in *layered guardrails with Plan Mode, human-intervention triggers, and hard stopping conditions* — all bound inside the NIST AI RMF Govern/Map/Measure/Manage frame and an RSP-style capability-threshold governance policy. That is the bar Mr. Mwikila must clear.

---

## Sources (all fetched during research)

**Anthropic**
- Building effective agents — https://www.anthropic.com/research/building-effective-agents
- Trustworthy agents in practice — https://www.anthropic.com/research/trustworthy-agents
- Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Effective harnesses for long-running agents — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Measuring AI agent autonomy in practice — https://www.anthropic.com/research/measuring-agent-autonomy
- Responsible Scaling Policy v3.0 — https://www.anthropic.com/news/responsible-scaling-policy-v3
- Responsible Scaling Policy (overview) — https://www.anthropic.com/responsible-scaling-policy
- Donating MCP / Agentic AI Foundation — https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation

**OpenAI**
- A practical guide to building agents (PDF) — https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- A practical guide to building agents (landing) — https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- Function calling guide — https://developers.openai.com/api/docs/guides/function-calling
- Structured model outputs — https://platform.openai.com/docs/guides/structured-outputs

**GraphRAG / Knowledge Graphs**
- From Local to Global: A Graph RAG Approach (arXiv:2404.16130) — https://arxiv.org/abs/2404.16130
- Microsoft Research GraphRAG project — https://www.microsoft.com/en-us/research/project/graphrag/
- microsoft/graphrag (GitHub) — https://github.com/microsoft/graphrag
- Neo4j: What is GraphRAG — https://neo4j.com/blog/genai/what-is-graphrag/

**Memory**
- Memory for Autonomous LLM Agents survey (arXiv 2603.07670) — https://arxiv.org/html/2603.07670v1
- Advancing Agentic Memory overview — https://vinithavn.medium.com/advancing-agentic-memory-an-overview-of-modern-memory-management-architectures-in-llm-agents-8df87b0da58f

**Forecasting / Anomaly / Scenario**
- 2026 Time Series Toolkit (MachineLearningMastery) — https://machinelearningmastery.com/the-2026-time-series-toolkit-5-foundation-models-for-autonomous-forecasting/
- TimesFM on Google Cloud BigQuery — https://docs.cloud.google.com/bigquery/docs/timesfm-model
- Pebblous: TimesFM industrial forecasting — https://blog.pebblous.ai/report/timesfm-industrial-forecasting/en/
- STAR (arXiv 2510.16014) — https://arxiv.org/pdf/2510.16014
- CALM (arXiv 2508.21273) — https://arxiv.org/pdf/2508.21273
- Prospeo: Forecast Accuracy Metrics 2026 — https://prospeo.io/s/forecast-accuracy-metrics
- Prospeo: Forecasting Metrics 2026 — https://prospeo.io/s/forecasting-metrics
- M5 Uncertainty competition results — https://www.researchgate.net/publication/346493740_The_M5_Uncertainty_competition_Results_findings_and_conclusions
- Lumivero: Monte Carlo intro — https://lumivero.com/resources/blog/an-introduction-to-monte-carlo-simulation/
- Galorath: Monte Carlo methods — https://galorath.com/risk/monte-carlo-simulation/
- Bayesian networks + Monte Carlo (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC6950629/

**Causal inference**
- NISS: Causal AI in Business Practices (Victor Lo slides) — https://www.niss.org/sites/default/files/news_attachments/Victor%20Lo%20Slides%20-%20Causal%20AI%20in%20Business%20Practices%2001.24.25.pdf
- WJARR: Causal AI for strategic business planning — https://wjarr.com/content/causal-ai-strategic-business-planning-uncovering-latent-drivers-long-term-organizational
- S&P Global: Causal AI — https://www.spglobal.com/en/research-insights/special-reports/causal-ai-how-cause-and-effect-will-change-artificial-intelligence
- Towards Data Science: Causal Inference Is Eating ML — https://towardsdatascience.com/causal-inference-is-eating-machine-learning/
- Uplift Modeling Under Limited Supervision (arXiv 2403.19289) — https://arxiv.org/pdf/2403.19289
- Neuro-Symbolic-Causal Architecture (arXiv 2510.23682) — https://arxiv.org/pdf/2510.23682

**Calibration / Uncertainty**
- Zylos Research: LLM Calibration & UQ in Production AI Agents — https://zylos.ai/research/2026-04-18-llm-calibration-uncertainty-production-agents
- Capgemini: Quantifying LLMs Uncertainty with Conformal Predictions — https://medium.com/capgemini-invent-lab/quantifying-llms-uncertainty-with-conformal-predictions-567870e63e00
- Adaptive Conformal Semantic Entropy (arXiv 2605.04295) — https://arxiv.org/html/2605.04295
- Mitigating LLM Hallucinations via Conformal Abstention (arXiv 2405.01563) — https://arxiv.org/pdf/2405.01563
- Prune 'n Predict (arXiv 2501.00555) — https://arxiv.org/pdf/2501.00555
- Analyzing Uncertainty of LLM-as-a-Judge (arXiv 2509.18658) — https://arxiv.org/html/2509.18658v1

**Multi-agent debate / verification**
- Improving Factuality and Reasoning through Multiagent Debate (arXiv:2305.14325) — https://arxiv.org/abs/2305.14325
- Multiagent debate project page — https://composable-models.github.io/llm_debate/
- Tool-MAD (arXiv 2601.04742) — https://www.arxiv.org/pdf/2601.04742
- MAD-Fact (arXiv 2510.22967) — https://arxiv.org/html/2510.22967v2
- Markov-chain debate hallucination detection (arXiv 2406.03075) — https://arxiv.org/pdf/2406.03075
- Combating Adversarial Attacks with Multi-Agent Debate (arXiv 2401.05998) — https://arxiv.org/pdf/2401.05998

**Evals / red-teaming**
- FutureAGI: LLM-as-Judge Best Practices 2026 — https://futureagi.com/blog/llm-as-judge-best-practices-2026
- Openlayer: LLM-as-Judge Guide March 2026 — https://www.openlayer.com/blog/post/llm-as-judge-evaluation-guide
- Position Bias in Rubric-Based LLM-as-a-Judge (arXiv:2602.02219) — https://arxiv.org/abs/2602.02219
- Position Bias in LLM Judges (Brenndoerfer) — https://mbrenndoerfer.com/writing/position-bias-in-llm-judges
- TRAJECT-Bench (arXiv:2510.04550) — https://arxiv.org/abs/2510.04550
- AgentRewardBench (arXiv 2504.08942) — https://arxiv.org/pdf/2504.08942
- ATBench (arXiv 2604.02022) — https://arxiv.org/pdf/2604.02022
- Confident AI: LLM Agent Evaluation Metrics 2026 — https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide
- Towards More Standardized AI Evaluation (arXiv 2602.18029) — https://arxiv.org/pdf/2602.18029
- Fortune: Anthropic Red Team — https://fortune.com/2025/09/04/anthropic-red-team-pushes-ai-models-into-the-danger-zone-and-burnishes-companys-reputation-for-safety/

**Structured output / tool orchestration / MCP**
- Guide to structured outputs & function calling — https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms
- Model Context Protocol — Wikipedia — https://en.wikipedia.org/wiki/Model_Context_Protocol
- MCP GitHub org — https://github.com/modelcontextprotocol
- MCP 2026 Roadmap — https://a2a-mcp.org/blog/mcp-2026-roadmap

**Governance & standards**
- NIST AI 600-1 publication page — https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- NIST AI 600-1 full PDF — https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- DLA Piper: NIST GenAI Profile key points — https://www.dlapiper.com/en-us/insights/publications/ai-outlook/2024/nist-releases-its-generative-artificial-intelligence-profile
- CSA: Agentic NIST AI RMF Profile v1 — https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/

**Business / market context**
- IntuitionLabs: Anthropic's 2026 B2B vision — https://intuitionlabs.ai/articles/ai-agents-b2b-productivity-anthropic

### UNVERIFIED notes
- Causal-AI **market-size figures** (~$81.4B 2025 / ~$116B 2026) surfaced via secondary summaries citing Fortune Business Insights; the primary market report was **not** fetched. Treat as directional, not authoritative.
- The Borjie package-to-capability mapping in §11 is inferred from package *names* in `packages/` (directory listing confirmed) and the two CLAUDE.md codemap entries; internal implementations were not individually opened during this research pass.
