# Domain-AGI Brain Layer — SOTA Target

**A research dossier on engineering an AGI-level brain layer around a frontier LLM, bounded to a domain + mandate (autonomously master and operate a mining estate / a real-estate business end-to-end).**

- **Author:** research subagent (deep web research, frontier sources)
- **Date:** 2026-06-08
- **Audience:** Borjie architects designing Mr. Mwikila (the brain layer of an AI-native mining estate OS)
- **Scope:** What a brain layer must contain to achieve *general intelligence bounded to a domain + mandate* — not general AGI. How to define, build, and *measure* "domain-AGI."
- **Verification note:** Every claim is tagged with a real URL where it is sourced. Claims I could not anchor to a retrieved source are marked **[UNVERIFIED]**. Quantitative figures (time-horizons, benchmark scores) move fast; the cited number + date is given so it can be re-checked.

---

## 0. Thesis in one paragraph

A frontier LLM (Opus-4.8-class) is a *probabilistic production system* — a powerful but stateless, myopic, calibration-poor next-token predictor. "Domain-AGI" is **not a bigger model**; it is a **cognitive architecture wrapped around the model** that supplies exactly the faculties the bare model lacks — persistent multi-store memory, an explicit decision cycle, hierarchical planning over a world model, continual learning that writes back to long-term memory, metacognitive self-monitoring with calibrated abstention, goal/intention management with commitment, grounded perception and actuation, and governed autonomy. The target is to score at **Expert/Virtuoso performance on the *breadth of one domain*** (every task a top human estate director / mine GM does) at **DeepMind Autonomy Level 4-5 under governance**, while generalizing to *novel within-domain situations* with the skill-acquisition efficiency that defines intelligence (Chollet). This dossier specifies what that brain layer must contain, the measurable gap between today's best agents and that target, and how to define + measure domain-AGI.

---

## 1. The LLM-as-cognitive-core pattern and classical cognitive architectures

### 1.1 Why a brain layer at all — the LLM is a probabilistic production system

The most rigorous framing comes from **CoALA — "Cognitive Architectures for Language Agents"** (Sumers, Yao, Narasimhan, Griffiths, 2023/24). CoALA's foundational analogy: an LLM is a **probabilistic production system**. Classical production systems (Post, 1943; Newell) rewrite strings via rules `X Y Z → X W Z`; an LLM "defines a distribution over which productions to select when presented with input X, yielding a distribution P(Yᵢ|X) over completions" — i.e. it samples a possible completion each call. Prompting methods are just *control flow* that sequences productions. This reframes the whole agent-engineering problem: we are building a **control architecture around a stochastic production engine**, which is precisely what Soar/ACT-R did around hand-written rules.
Source: https://arxiv.org/abs/2309.02427 , https://arxiv.org/html/2309.02427v3

### 1.2 The CoALA reference architecture (the canonical blueprint)

CoALA decomposes a language agent into **memory modules + action space + decision procedure**:

**Memory modules** (mirroring Soar/ACT-R):
- **Working memory** — "maintains active and readily available information as symbolic variables for the current decision cycle." A data structure persisting across LLM calls; synthesizes prompt inputs, stores parsed outputs back for execution.
- **Episodic memory** — "stores experience from earlier decision cycles": input-output pairs, event flows, trajectories from previous episodes. Read during planning, written by learning actions.
- **Semantic memory** — "an agent's knowledge about the world and itself": fixed external DBs (Wikipedia) *or* autonomously built knowledge from reasoning over experience. Read+write.
- **Procedural memory** — two forms: *implicit* (knowledge in LLM weights) and *explicit* (knowledge in the agent's code — reasoning templates, grounding skills, retrieval procedures, decision procedures themselves).

**Action space** (internal vs external):
- **Reasoning actions** — read+write *working* memory ("process the contents of working memory to generate new information").
- **Retrieval actions** — read long-term → working memory (rule-based, sparse, or dense retrieval).
- **Learning actions** — *write* to long-term memory: update episodic (trajectories), update semantic (inferences/knowledge from reasoning), update LLM parameters (fine-tuning), **update agent code** (templates, skills, retrieval procedures) — i.e. self-modification of procedure.
- **Grounding (external) actions** — "executes external actions and processes environmental feedback into working memory as text" across physical, dialogue, and digital environments.

**Decision procedure** (the agent loop): a repeated cycle with a **Planning stage** — *Proposal* (reason/retrieve to sample candidate actions), *Evaluation* (assign value via heuristics, LLM perplexity, learned values, or LLM reasoning), *Selection* (argmax / softmax / majority vote, or reject-and-loop) — followed by an **Execution stage** (run the procedure; observe; loop).

**CoALA's actionable directions** (still the SOTA to-do list): structure agents modularly with standardized Memory/Action/Agent abstractions; use code *sparingly* to complement LLM limits (e.g. tree search to counter autoregressive myopia); integrate retrieval+reasoning for grounded planning; **meta-learn by updating procedural memory** (learn better retrieval/reasoning procedures); study interaction effects across multiple forms of learning.
Source: https://arxiv.org/html/2309.02427v3

### 1.3 The classical canon and how it maps

| Architecture | Core idea | What it contributes to a brain layer | Source |
|---|---|---|---|
| **Soar** (Laird, Rosenbloom, Newell) | Production-rule decision cycle; working/procedural/semantic/episodic memory; *impasse → subgoal* universal subgoaling; chunking (learn rules from problem-solving) | The observe-decide-act cycle with explicit **operator proposal/selection/application**; impasse-driven subgoaling = hierarchical planning by necessity; chunking = procedural learning | https://arxiv.org/abs/2201.09305 |
| **ACT-R** (Anderson) | Declarative + procedural memory; sub-symbolic activation (recency/frequency) governs retrieval; modular (vision, motor, goal) buffers | Activation-weighted memory retrieval (which memories surface), modular perception/motor, integrated theory of perception+memory+goals+action | https://arxiv.org/abs/2201.09305 |
| **LIDA** (Franklin) | Global Workspace Theory; perceive → understand → *conscious broadcast* (attention/competition) → act, on a cognitive cycle (~tens of ms) | The **cognitive cycle** and **attention as competition for a global workspace** — a principled basis for *what enters working memory* | https://arxiv.org/pdf/2408.09176 |
| **CoALA** | LLM as probabilistic production core inside the above structure | The bridge: classical structure + LLM productions | https://arxiv.org/html/2309.02427v3 |

**Wray, Kirk & Laird, "Applying Cognitive Design Patterns to General LLM Agents" (AGI-2025)** is the most direct prescriptive bridge: it maps the **Soar observe-decide-act cycle onto ReAct (Reason+Act)** and identifies that ReAct *lacks the explicit commitment step* present in Soar — i.e. today's LLM agents skip the deliberate operator-selection/commitment phase, which is a concrete, namable architectural gap to close.
Source: https://arxiv.org/abs/2505.07087 , https://arxiv.org/html/2505.07087v2

**Cognitive LLMs / LLM-ACTR** (Wu, Oltramari, Francis, Giles, Ritter, 2024) is the leading *neuro-symbolic fusion* exemplar: it extracts ACT-R's internal decision process as latent neural representations, injects them into trainable LLM adapter layers, and fine-tunes — explicitly to resolve "the dichotomy between the human-like yet constrained reasoning of cognitive architectures and the broad but noisy inference of LLMs," targeting *grounded, deliberate (System-2) decision-making* and reduced hallucination on manufacturing-decision tasks. This is the template for **fusing a domain decision model into the core** rather than only prompting around it.
Source: https://arxiv.org/abs/2408.09176

**LeCun's "A Path Towards Autonomous Machine Intelligence" (2022)** supplies the contrasting *objective-driven, model-based* blueprint: six modules — **Configurator** (sets objectives/sub-goals), **Perception** (encodes observations), **World Model** (predicts future states), **Cost Module** (evaluates outcomes/intrinsic motivation), **Actor** (proposes actions, plans by optimizing cost through the world model), **Short-Term Memory**. JEPA / H-JEPA give *hierarchical prediction at multiple time-scales and abstraction levels* in representation space (not pixels/tokens). For a domain brain layer this argues for an **explicit, learned world model of the estate** and **planning-as-optimization against a cost/objective module** — a complement to the production-system view.
Source: https://openreview.net/pdf?id=BZ5a1r-kVsf , https://cis.temple.edu/tagit/presentations/A%20Path%20Towards%20Autonomous%20Machine%20Intelligence.pdf

**Synthesis for the brain layer:** take CoALA's memory+action+decision skeleton, add **Soar's explicit commitment/operator-selection step** (the missing ReAct piece), **ACT-R's activation-weighted retrieval** (which memory surfaces), **LIDA's attention-as-competition** (what enters working memory), and **LeCun's world-model + cost-module** (model-based planning and objective-driven control), with **LLM-ACTR-style neuro-symbolic fusion** for the domain's deliberate decisions. That is the reference target.

---

## 2. The dimensions of general intelligence a domain-AGI needs

A domain-AGI must possess the *full set* of general-intelligence faculties — but instantiated and saturated *within the domain boundary*. The DeepMind Levels-of-AGI principles are explicit that a general system needs "metacognitive abilities like learning new skills," and that *cognitive + metacognitive* tasks (not embodiment) are the core (https://arxiv.org/html/2311.02462v2). Below, each dimension: what it is, the SOTA mechanism, and the domain-bounded target.

### 2.1 Perception (multimodal grounding)
- **What:** ingest the world the domain lives in — documents, sensor/IoT telemetry, images (drone/satellite/site photos, assay sheets), audio, geospatial, financial feeds — and convert to symbolic working-memory content.
- **SOTA:** CoALA *grounding actions* process environmental feedback "into working memory as text"; GAIA proves multimodality+web+tool perception is a *fundamental ability* and a hard gap (humans 92% vs GPT-4-plugins 15%). https://arxiv.org/abs/2311.12983
- **Domain target:** every signal an estate generates (licences, royalty filings, ore grades, equipment vibration, satellite-detected encroachment, market prices) is perceivable and reduced to grounded symbols with provenance.

### 2.2 Working memory + long-term memory (the multi-store)
- **What:** an active scratchpad for the current cycle (working), plus durable episodic/semantic/procedural stores.
- **SOTA mechanisms:**
  - **MemGPT / LLMs-as-OS** (Packer et al., 2023): hierarchical virtual context — *main context (RAM)*, *recall storage (disk, searchable past messages)*, *archival storage (cold, vector-indexed)* — with the LLM using function calls to page memory in/out. The "virtual memory for context windows" paradigm. https://arxiv.org/abs/2310.08560
  - **Generative Agents** (Park et al., 2023): the *memory stream* (chronological observations/plans/reflections) with retrieval scored by **recency × importance × relevance** — directly echoing ACT-R activation. https://arxiv.org/abs/2304.03442
- **Domain target:** episodic memory of every decision/outcome on the estate; semantic memory = the estate's evolving world-knowledge (regulations, geology, counterparties); procedural memory = reusable playbooks/skills. Retrieval governs *what surfaces* under attention.

### 2.3 Reasoning (System-1 fast / System-2 deliberate)
- **What:** fast pattern completion *and* slow, search-based deliberation.
- **SOTA:** Tree-of-Thoughts (search over reasoning); **Reasoning-via-Planning (RAP)** repurposes the LLM as *both world model and reasoning agent* and plans with **MCTS** over the reasoning space (LLaMA-33B+RAP > CoT+GPT-4, +33% on plan generation). The key insight: bare LLMs "lack an internal world model to predict state and simulate long-term outcomes." https://arxiv.org/pdf/2305.14992 , https://aclanthology.org/2023.emnlp-main.507/
- **Domain target:** deliberate, search-based reasoning for high-stakes estate decisions (capital allocation, mine-plan changes, contract structuring), with the LLM simulating outcomes against a domain world model before committing.

### 2.4 Hierarchical planning
- **What:** decompose long-horizon goals into milestones → subgoals → primitive actions, *adaptively* by difficulty.
- **SOTA:** **ADaPT** (As-needed Decomposition and Planning) recursively decomposes a subtask *only when* the executor cannot directly handle it — adapting to both task complexity and model capability; **HiPlan** combines coarse global milestone guides with fine local hints from a retrieval-augmented milestone library; **HyperTree Planning / ReAcTree** generalize ToT to tree/hypertree decomposition; classical **HTN** decomposes into reusable parameterized sub-task policies. https://apxml.com/courses/agentic-llm-memory-architectures/chapter-4-complex-planning-tool-integration/task-decomposition-strategies , https://arxiv.org/pdf/2505.02322
- **Domain target:** plan at estate-strategy → site-program → shift-task granularity, replanning on perturbation but *not on every perturbation* (see commitment, §2.8).

### 2.5 Continual / lifelong learning (write-back without forgetting)
- **What:** accumulate skill and knowledge across the estate's lifetime; *do not catastrophically forget* prior policies/preferences when capabilities expand.
- **SOTA:** "Lifelong Learning of LLM-based Agents: A Roadmap" (2501.07278) frames perception/memory/action-module lifelong learning; mitigation families = **rehearsal, regularization, architectural** (+ hybrids). The production-relevant failure modes named in 2025: agents giving *outdated answers after policy updates*, *missing newly introduced rules*, *forgetting established user preferences after capability expansion*. **Voyager** is the canonical *non-gradient* lifelong learner: an **ever-growing skill library of executable code** (interpretable, compositional, temporally extended) plus an **automatic curriculum** — skills compound and *alleviate catastrophic forgetting* because they are stored externally, not in weights, and transfer to new worlds. https://arxiv.org/abs/2501.07278 , https://arxiv.org/abs/2305.16291
- **Domain target:** the brain layer *gets better at running the estate every month* by writing back episodic outcomes, distilling reusable playbooks (Voyager-style skill library), and updating semantic knowledge — **prefer external memory/skill-library writes over weight updates** for the bulk of learning (avoids forgetting; auditable), reserving fine-tuning for stable, high-frequency domain priors.

### 2.6 Metacognition / self-monitoring / calibration (CRITICAL)
- **What:** monitor its own reasoning, *know what it knows*, calibrate confidence, and act on it (allocate more reasoning, retrieve, or abstain/escalate).
- **SOTA & the hard truth:** Metacognition = self-monitoring, self-evaluation, strategic adaptation, self-reflection, self-regulation. But 2025-26 evidence is sobering: LLMs **"know when they know, but do not act on it"** — confidence can correlate with accuracy, yet does *not* translate into adaptive reasoning effort (the **knowing-doing gap**); the **MIRROR** benchmark specifically measures whether calibration *transfers to action selection*, and finds limited transfer; multiple 2025-26 papers report *limited* and *non-individuated* metacognition. https://arxiv.org/html/2605.14186 , https://arxiv.org/html/2604.19809v1 , https://arxiv.org/pdf/2509.21545
- **Domain target — the highest-leverage build:** the brain layer must supply metacognition *the model lacks* as **explicit architecture**: a monitor that scores confidence per claim, an **uncertainty-gated controller** that escalates reasoning depth / triggers retrieval / abstains-and-escalates-to-human on low confidence, and a calibration layer trained on the estate's own outcome history. This is where Borjie's evidence-required output rule and four-eyes/kill-switch gating live conceptually.

### 2.7 Embodiment / actuation (digital + cyber-physical)
- **What:** act on the world, not just advise — file with regulators, post ledger entries, dispatch crews, control/recommend on equipment, transact in the marketplace.
- **SOTA:** DeepMind's principles say embodiment is *not required* for AGI (cognitive/metacognitive focus) — but **autonomy** (planning, acting, tool use) is a measured axis. CoALA's grounding actions span physical/dialogue/digital. https://arxiv.org/html/2311.02462v2
- **Domain target:** a typed, governed **actuation layer** (tools/APIs) where each action is reversible-where-possible, logged, and permissioned — i.e. the estate is the agent's "body."

### 2.8 Goal / intention management (BDI + commitment)
- **What:** maintain beliefs (world state/memory), desires (goals/mandate), intentions (committed plans); revise intentions only when triggers fire — *do not re-plan on every perturbation*.
- **SOTA:** The **BDI** model maps cleanly: Beliefs→world-state+memory (scratchpads, episodic logs, semantic stores), Desires→assigned via mandate/objectives, Intentions→committed plans. Its two durable ideas: **commitment strategies** (stick to intentions while conditions hold) and **intention revision** (drop/suspend/replace on trigger). This is exactly the **commitment step Wray-Kirk-Laird flag as missing from ReAct**. https://arxiv.org/pdf/2509.02515 , https://arxiv.org/abs/2505.07087
- **Domain target:** the brain layer holds the *mandate* as standing desires, commits to multi-day/week intentions (mine plan, sales program), and revises only on material triggers — giving stable, non-thrashing autonomous operation.

### 2.9 Social / communication (multi-stakeholder + multi-agent)
- **What:** communicate with owners, managers, crews, regulators, buyers; coordinate a *team* of specialist sub-agents.
- **SOTA:** Anthropic's **workflow/agent patterns** — Augmented LLM (retrieval+tools+memory) as the unit; *prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer*; agents = systems that "dynamically direct their own processes and tool usage." Orchestrator-workers = a lead LLM dynamically decomposes and delegates to workers and synthesizes — the basis for a *team of juniors under an MD*. Generative Agents showed believable emergent social coordination from observation→memory→reflection→plan. https://www.anthropic.com/research/building-effective-agents , https://arxiv.org/abs/2304.03442
- **Domain target:** Borjie's MD-as-orchestrator over domain junior agents (metallurgy, compliance, FX/treasury, safety, sales/offtake…), plus calibrated, bilingual, evidence-cited communication with humans.

### 2.10 Self-improvement (bounded, grounded)
- **What:** improve its own procedures/prompts/skills over time.
- **SOTA & limits:** **STOP** (Self-Taught Optimizer) recursively self-improves a *code improver* (proposing beam search, genetic algorithms, simulated annealing as strategies) — but the model weights are unchanged, so it is **not full recursive self-improvement**. **Gödel Agent** explores self-referential self-modification. The crucial 2026 caution: "On the Limits of Self-Improving in LLMs" — **fully autonomous recursive generative retraining converges to degenerative fixed points, not an intelligence explosion**; "sustained self-improvement requires persistent grounding" (real-world feedback) "or a transition from distributional optimisation to mechanism-based inference." https://arxiv.org/abs/2310.02304 , https://arxiv.org/pdf/2410.04444 , https://arxiv.org/html/2601.05280v2
- **Domain target:** self-improvement is *real but must be grounded* — improve prompts/skills/retrieval procedures (CoALA procedural-memory updates; Voyager skill library) **against the estate's real outcomes**, never via ungrounded self-retraining. This is the safe, effective form of §2.5.

### 2.11 Robustness / calibration / safety (and abstention)
- **What:** be reliable under distribution shift, adversarial input, and at the edge of competence; quantify uncertainty; abstain when appropriate.
- **SOTA:** Hallucination surveys (ACM TOIS, Jan 2025) formalize taxonomy+mitigation; **"Know Your Limits: A Survey of Abstention in LLMs"** treats *abstention* as a first-class capability; uncertainty methods split into **white-box** (token probs, entropy) and **black-box** (multi-sample consistency, semantic grouping); selective-prediction systems abstain under high uncertainty; behavior-calibrated RL lets smaller models *surpass frontier models on uncertainty quantification*; caution: "entropy alone is insufficient for safe selective prediction." https://www.researchgate.net/publication/393331033_Know_Your_Limits_A_Survey_of_Abstention_in_Large_Language_Models , https://arxiv.org/abs/2512.19920 , https://arxiv.org/pdf/2603.21172
- **Domain target:** an estate brain that *abstains and escalates* on out-of-competence or high-stakes-low-confidence decisions is far more valuable (and safe) than one that always answers. Couple this with OpenAI's governance practices (§4).

---

## 3. The measurable gap: today's best agents vs domain-AGI

The gap is best read off four orthogonal yardsticks.

### 3.1 Task **length / horizon** — the autonomy gap
**METR, "Measuring AI Ability to Complete Long Tasks" (2025, arXiv:2503.14499)** introduces the **50%-task-completion time horizon** = the human-time-length of tasks a model completes with 50% success. It has **doubled ~every 7 months for 6 years** (with 2024-25 data suggesting *acceleration*). Reported points: GPT-2 ≈ 2 seconds; Claude 3.7 Sonnet ≈ 50 minutes; o3 ≈ ~2 hours; and (latest cited) an Opus-4.6-class model ≈ **~12 hours** at the 50% horizon. https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/ , https://arxiv.org/abs/2503.14499
**Gap:** running a mining estate is a *months-to-years* horizon at 90-99% reliability. Even a 12-hour-50% frontier model is ~3-4 doublings short of *day-long* autonomy and far from *month-long* at the reliability an estate needs. **This is the single biggest quantitative gap, and it is the gap the brain layer is built to close** — horizon and reliability come from *architecture* (memory persistence, checkpointing, replanning, escalation), not from raw model horizon alone.

### 3.2 General-assistant competence — the tool/multimodal grounding gap
**GAIA (2311.12983):** real-world questions needing reasoning + multimodality + web + tool use. **Humans 92% vs GPT-4-with-plugins 15%** at launch — "conceptually simple yet challenging." Leaderboards have since risen substantially, but GAIA still measures the *grounded, multi-step, tool-using* competence a domain operator needs daily. https://arxiv.org/abs/2311.12983
**Gap:** robust multi-step tool orchestration with real-world grounding remains the differentiator between a chatbot and an operator.

### 3.3 Fluid intelligence / novel generalization — the skill-acquisition gap
**ARC-AGI (Chollet, "On the Measure of Intelligence"):** intelligence = **skill-acquisition efficiency on novel tasks**, not task-specific performance/memorized knowledge — memorization is ineffective by construction (rules must be induced from ~3 examples). ARC-AGI-1: o3-preview reached **75% (low compute) / 87% (high compute)**. **ARC-AGI-2** (Chollet et al., 2025, 2505.11831) is calibrated to human difficulty: **top AI < 5%, humans ~75%** at release; ARC Prize 2025 top private score reached **~24%**. https://arcprize.org/arc-agi/1 , https://arxiv.org/pdf/2505.11831 , https://arxiv.org/html/2601.10904v1
**Gap & nuance:** ARC measures *general* fluid reasoning. A *domain*-AGI needs fluid generalization **within its domain** (novel ore body, new regulation, unseen counterparty structure) — narrower than ARC, but the same faculty. The lesson: bench your system on **held-out novel within-domain situations**, not memorized playbooks.

### 3.4 Metacognitive transfer — the knowing-doing gap
Confidence may correlate with accuracy, but models **do not act on it** (MIRROR; "know when they know but don't act"). For autonomous operation this is the most *dangerous* gap: a system that is wrong without knowing-and-acting on it will take irreversible estate actions. https://arxiv.org/html/2605.14186 , https://arxiv.org/html/2604.19809v1

### 3.5 Compact gap table

| Yardstick | Best agents today (cited) | Domain-AGI target | Gap closes via |
|---|---|---|---|
| Time horizon (50%) | ~12h (Opus-4.6-class, METR) | months @ 90-99% | persistent memory, checkpointing, replanning, escalation |
| General-assistant (GAIA) | rising from 15% (humans 92%) | near-human multi-step tool grounding *in-domain* | typed actuation, robust tool/ACI design |
| Fluid reasoning (ARC-AGI-2) | ~24% top (humans ~75%) | strong novel *within-domain* generalization | world model + search (RAP/MCTS), skill library |
| Metacognitive transfer (MIRROR) | limited transfer | calibrated abstain/escalate | explicit uncertainty-gated controller |

---

## 4. Defining and measuring "domain-AGI"

### 4.1 Definition (operational)
**Domain-AGI = a system that performs the *full breadth of cognitive + metacognitive tasks within a bounded domain + mandate* at Expert-to-Virtuoso human performance, operating at high autonomy under governance, while generalizing efficiently to *novel within-domain* situations.** This is the DeepMind matrix collapsed to one domain: drive *Performance* (depth) up across the *entire task-breadth of the domain* (the domain's "generality"), at high *Autonomy* — under deliberately-chosen governance constraints.

### 4.2 Performance levels (DeepMind, depth)
Level 0 No AI → **1 Emerging** (≥ unskilled human) → **2 Competent** (≥50th pct skilled adults) → **3 Expert** (≥90th pct) → **4 Virtuoso** (≥99th pct) → **5 Superhuman** (>100% of humans). Frontier LLMs today ≈ *Emerging AGI* (general) per the paper. The six defining principles: *capabilities not processes; generality AND performance; cognitive+metacognitive (not embodiment); potential not deployment; ecological validity (real tasks people value); path not single endpoint.*
Source: https://arxiv.org/html/2311.02462v2

### 4.3 Autonomy levels (DeepMind, decoupled from capability) — the deployment dial
| Autonomy | Description | Example | Unlocked by |
|---|---|---|---|
| 0 No AI | human does everything | text editor | — |
| 1 AI as **Tool** | human controls; AI automates sub-tasks | grammar/translation | Emerging→Competent Narrow |
| 2 AI as **Consultant** | substantive role when invoked | summarization, code-gen | Competent Narrow→Emerging AGI |
| 3 AI as **Collaborator** | co-equal interaction | AI training partner | Emerging AGI |
| 4 AI as **Expert** | AI drives; human guides | scientific-discovery systems | Virtuoso Narrow / Expert AGI |
| 5 AI as **Agent** | fully autonomous | autonomous assistant (not yet deployed) | Virtuoso AGI / ASI |

**Decoupling is the key design freedom:** higher autonomy is *unlocked* by capability but you may deliberately deploy *lower* autonomy for safety. A domain-AGI estate brain can be Expert-capable yet run at Autonomy 2-4 per task class (e.g. Tool for irreversible money moves under four-eyes, Expert for routine ops). Borjie's graduated-autonomy gating is exactly this dial. https://arxiv.org/html/2311.02462v2

### 4.4 Governance constraints that *define* responsible domain-AGI
OpenAI's **seven practices for governing agentic AI** (Shavit, Agarwal et al., 2023) are the operating envelope: **evaluate suitability, constrain action space, set default behaviors, ensure legibility, automatic monitoring, attributability, interruptibility** — plus action-space boundaries, gradual rollout, reversibility/shutdown, and an *action ledger* for users. https://cdn.openai.com/papers/practices-for-governing-agentic-ai-systems.pdf , https://openai.com/index/practices-for-governing-agentic-ai-systems/

### 4.5 How to *measure* it — an evaluation program
1. **Capability evals (breadth × depth):** enumerate the domain's task taxonomy (estate: licensing, royalty, geology/grade, mine-plan, treasury/FX, compliance/ESG, safety/HSE, workforce, marketplace/offtake, holdings/succession). For each, define an Expert/Virtuoso rubric and score against *skilled-human percentile* (DeepMind bands). Use **ecologically valid** tasks people in the role actually do.
2. **Autonomy levels per task-class:** assign each task a target DeepMind autonomy level and measure realized autonomy (human-intervention rate, escalation rate, reversibility).
3. **Within-domain generalization (the ARC discipline):** hold out **novel** situations (new ore body, new regulation, unseen contract) and measure skill-acquisition efficiency — solve-from-few-examples, not from memorized playbooks. https://arcprize.org/arc-agi/1
4. **Horizon/reliability:** apply the METR method *in-domain* — the human-time-length of estate tasks the system completes at 50% and at 90-99% reliability; track the doubling trend. https://arxiv.org/abs/2503.14499
5. **Multi-step grounded competence:** a GAIA-style in-domain suite (real docs, real tools, multimodal, multi-step). https://arxiv.org/abs/2311.12983
6. **Metacognition/calibration:** measure confidence-accuracy calibration (ECE) *and* the **knowing-doing transfer** (does low confidence actually trigger more reasoning / retrieval / abstention / escalation?) à la MIRROR. https://arxiv.org/html/2604.19809v1
7. **Robustness/safety:** adversarial/red-team, abstention quality (does it decline the *right* questions?), reversibility and shutdown drills (OpenAI practices). https://cdn.openai.com/papers/practices-for-governing-agentic-ai-systems.pdf
8. **Continual-learning regression:** verify capability expansions don't induce the named forgetting failure modes (stale answers, missed new rules, dropped preferences). https://arxiv.org/abs/2501.07278

**A domain-AGI claim is earned only when all eight hold simultaneously** — high depth across full breadth, at target autonomy, with novel-situation generalization, long reliable horizons, grounded multi-step competence, calibrated metacognition that *acts*, robust+abstaining behavior, and no continual-learning regression.

---

## 5. The brain-layer build checklist (synthesis → Borjie)

A frontier-LLM domain-AGI brain layer must contain, concretely:

1. **Multi-store memory** — working (typed scratchpad) + episodic (every decision/outcome) + semantic (estate world-knowledge) + procedural (playbooks/skills), with **MemGPT-style virtual paging** and **recency×importance×relevance** retrieval (CoALA + MemGPT + Generative Agents).
2. **Explicit decision cycle with a commitment step** — Proposal → Evaluation → **Selection/Commitment** → Execution → Observe (CoALA + the Soar/ReAct commitment fix from Wray-Kirk-Laird).
3. **World model + model-based planning** — simulate outcomes before committing; plan via search (RAP/MCTS, ToT) and **hierarchical, as-needed decomposition** (ADaPT/HiPlan/HTN); a Cost/Objective module (LeCun) carrying the mandate.
4. **BDI goal/intention management** — standing desires = mandate; committed intentions with revision triggers; no thrashing.
5. **Metacognitive controller (top priority)** — per-claim confidence, calibration trained on estate outcomes, **uncertainty-gated** escalation/abstention; close the knowing-doing gap *architecturally*.
6. **Grounded perception + typed/governed actuation** — every estate signal in; every action out is typed, permissioned, logged, reversible-where-possible (CoALA grounding + OpenAI action-space constraints).
7. **Grounded continual learning** — write-back to episodic/semantic + a **Voyager-style skill library** of reusable executable playbooks; CoALA procedural-memory (prompt/retrieval) self-improvement *against real outcomes*; fine-tune sparingly; guard against forgetting.
8. **Orchestrator-workers society** — an MD lead agent over domain juniors (Anthropic patterns), with evaluator-optimizer loops and routing.
9. **Governance envelope** — DeepMind autonomy-dial per task-class + OpenAI's seven practices (legibility, monitoring, attributability, interruptibility, gradual rollout, kill-switch). Decouple capability from autonomy deliberately.
10. **The eight-axis eval harness** (§4.5) wired as a standing regression suite — the definition of done for "domain-AGI."

The unifying principle (CoALA + the self-improvement-limits literature): **use code/architecture sparingly but deliberately to supply exactly what the stochastic core lacks — persistence, deliberation, calibration, commitment, and grounded learning — and keep all improvement grounded in the estate's real outcomes.**

---

## 6. Source ledger (all verified via retrieval)

**Cognitive architectures & LLM-as-core**
- CoALA — Cognitive Architectures for Language Agents: https://arxiv.org/abs/2309.02427 · full text https://arxiv.org/html/2309.02427v3
- Applying Cognitive Design Patterns to General LLM Agents (Wray, Kirk, Laird, AGI-2025): https://arxiv.org/abs/2505.07087 · https://arxiv.org/html/2505.07087v2
- Cognitive LLMs / LLM-ACTR (ACT-R + LLM fusion): https://arxiv.org/abs/2408.09176
- Analysis & Comparison of ACT-R and Soar: https://arxiv.org/abs/2201.09305
- LeCun, A Path Towards Autonomous Machine Intelligence (JEPA/H-JEPA): https://openreview.net/pdf?id=BZ5a1r-kVsf

**Memory, reasoning, planning, learning mechanisms**
- MemGPT — Towards LLMs as Operating Systems: https://arxiv.org/abs/2310.08560
- Generative Agents (memory stream / reflection / planning): https://arxiv.org/abs/2304.03442
- Reasoning via Planning (RAP, LLM-as-world-model + MCTS): https://arxiv.org/pdf/2305.14992 · https://aclanthology.org/2023.emnlp-main.507/
- Hierarchical planning (ADaPT / HyperTree / decomposition): https://arxiv.org/pdf/2505.02322 · https://apxml.com/courses/agentic-llm-memory-architectures/chapter-4-complex-planning-tool-integration/task-decomposition-strategies
- Lifelong Learning of LLM-based Agents: A Roadmap: https://arxiv.org/abs/2501.07278
- Voyager (skill library, open-ended lifelong learning): https://arxiv.org/abs/2305.16291
- Reflexion (verbal RL / self-reflection): https://arxiv.org/abs/2303.11366

**Metacognition, calibration, robustness, self-improvement**
- LLMs Know When They Know but Don't Act (metacognitive harness): https://arxiv.org/html/2605.14186
- MIRROR (metacognitive calibration benchmark): https://arxiv.org/html/2604.19809v1
- Evidence for Limited Metacognition in LLMs: https://arxiv.org/pdf/2509.21545
- Know Your Limits: Survey of Abstention in LLMs: https://www.researchgate.net/publication/393331033_Know_Your_Limits_A_Survey_of_Abstention_in_Large_Language_Models
- Behaviorally Calibrated RL for hallucination: https://arxiv.org/abs/2512.19920
- Entropy alone insufficient for safe selective prediction: https://arxiv.org/pdf/2603.21172
- STOP — Self-Taught Optimizer: https://arxiv.org/abs/2310.02304
- Gödel Agent (self-referential self-improvement): https://arxiv.org/pdf/2410.04444
- On the Limits of Self-Improving in LLMs: https://arxiv.org/html/2601.05280v2

**Defining & measuring AGI / agents / autonomy**
- Levels of AGI (Morris et al., DeepMind): https://arxiv.org/html/2311.02462v2 · https://proceedings.mlr.press/v235/morris24b.html
- ARC-AGI-1 (Chollet, skill-acquisition efficiency): https://arcprize.org/arc-agi/1
- ARC-AGI-2 (Chollet et al., 2025): https://arxiv.org/pdf/2505.11831 · ARC Prize 2025 report https://arxiv.org/html/2601.10904v1
- GAIA — Benchmark for General AI Assistants: https://arxiv.org/abs/2311.12983
- METR — Measuring AI Ability to Complete Long Tasks: https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/ · https://arxiv.org/abs/2503.14499
- Anthropic — Building Effective Agents: https://www.anthropic.com/research/building-effective-agents
- OpenAI — Practices for Governing Agentic AI Systems: https://cdn.openai.com/papers/practices-for-governing-agentic-ai-systems.pdf · https://openai.com/index/practices-for-governing-agentic-ai-systems/
- BDI for LLM agents (classic vs LLM-driven): https://arxiv.org/pdf/2509.02515

**Note on dates:** time-horizon figures, ARC-AGI-2 scores, and "frontier model" labels are as cited (2025-2026 snapshots) and should be re-verified against the linked sources before use in any external claim. Forward-dated arXiv IDs (e.g. 26xx.*) appeared in June-2026 search results and are cited as returned; treat the specific numbers as **time-sensitive** rather than fixed.
