# Kernel Metacognition + Domain Expertise — SOTA dossier

**Lane:** metacognition · self-direction · domain-expertise
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** research subagent (web-heavy SOTA survey + grounding in `central-intelligence`/`ai-copilot`/`conformal-calibration-online`)
**Scope:** the MD reasoning ABOUT its own reasoning (knowing what it knows / does not, calibrated confidence, when-to-escalate / ask / create-a-tool / delegate; self-monitoring + Reflexion/self-critique; uncertainty-aware action; metacognitive control loops) AND domain-expertise modelling (turning the mandate corpus + tacit veteran knowledge into expert SCHEMAS / playbooks / heuristics the kernel reasons with). Anchored to **INV-D**: the structured PERCEIVE→ORIENT→ORGANIZE→CREATE→EXECUTE-TO-CLOSURE→LEARN loop. The bar is MIT/PhD-veteran, SOTA, best-in-world.

This is a research dossier only — no code, no commit. It maps frontier findings onto the existing kernel, names the gaps vs. our auditor / conformal / reflexion stack, and for every finding adds a **beyond-today** leap.

---

## 0. The thesis (one paragraph)

A genuine veteran MD is not "a smarter answer model." A veteran is defined by two things the answer-model lacks: (1) **metacognition** — a separate meta-level that *watches* the object-level reason, knows the edge of its own competence, and converts that knowledge into action (proceed / verify / abstain / ask / delegate / escalate / build-a-tool); and (2) **compiled domain expertise** — recognition-primed schemas, playbooks, and heuristics distilled from a corpus + tacit experience, so the veteran *recognises the situation-type instantly* instead of re-deriving from scratch every turn. The decisive 2026 result (Mirror, MGV, the "LLMs Know When They Know But Don't Act On It" harness) is that **the metacognition must be EXTERNAL ARCHITECTURE, not a prompt** — giving a model its own calibration score changes nothing (p > 0.05), but an architectural control loop cuts the confident-failure rate by **76%** (0.600 → 0.143). INV-D's structured cycle *is* exactly that external scaffold. Our job is to make every step of it metacognition-aware and expertise-backed, and to close the four places where our existing kernel measures self-knowledge but never acts on it.

---

## 1. The classic foundations (cite-by-name — the spine of the lane)

These are the load-bearing classics; every 2026 paper below re-derives them, so the kernel should be built on the originals directly.

- **Flavell (1979), "Metacognition and cognitive monitoring."** Defines *metacognitive knowledge* (what I know about my own cognition — capabilities, tasks, strategies) vs. *metacognitive experiences* vs. *strategies*. This is the taxonomy the 2026 self-improvement framework (§2.1) re-uses verbatim.
- **Nelson & Narens (1990), the object-level / meta-level model.** The canonical architecture: a **meta-level** holds a model of the object-level; two flows connect them — **MONITORING** (object→meta: confidence judgments, feeling-of-knowing/FOK, judgment-of-learning/JOL) and **CONTROL** (meta→object: allocate effort, select strategy, terminate, escalate). *Every* SOTA metacognitive harness below (MGV, the FOK/JOL test-time harness, MetaCogAgent) is a Nelson-Narens loop. **INV-D is a Nelson-Narens loop at organisation scale**: PERCEIVE/ORIENT = monitoring, ORGANIZE/CREATE/EXECUTE = control.
  - ref: Nelson & Narens, *Metamemory: A theoretical framework*, Psych. of Learning & Motivation 26 (1990); modern synthesis: "Metacognition: Monitoring and Controlling One's Own Knowledge, Reasoning and Decisions" (ResearchGate 332556754).
- **Signal Detection Theory → meta-d′/d′ (Maniscalco & Lau 2012; Fleming & Lau 2014).** The *measurable* definition of "knowing what you know": **d′** = task discrimination, **meta-d′** = how well confidence tracks correctness, and the ratio **meta-d′/d′ = metacognitive efficiency**. This is the metric we should compute *per domain* to find the literal edge of competence (see §2.3).
- **Klein (1989/1998), Recognition-Primed Decision (RPD) making, *Sources of Power*.** How experts *actually* decide under time pressure and uncertainty: they **recognise the situation-type**, retrieve a typical course of action, and mentally simulate it — they do **not** compare options from a blank slate. This is the cognitive-science name for INV-D's **ORIENT** step ("recognise the situation-TYPE via expert schemas + playbooks (recognition-primed), like a veteran; not a blank-slate think every turn").
- **Boyd's OODA loop (Observe-Orient-Decide-Act)** — the cybernetic decision cycle; INV-D's PERCEIVE/ORIENT/ORGANIZE/EXECUTE is OODA with an explicit CREATE (tool-synthesis) and LEARN bolt-on. Orient is the "big O" — the schema-laden step where expertise lives.
- **Snowden's Cynefin (2007).** Situation-type taxonomy: clear / complicated / complex / chaotic. A veteran routes differently per quadrant (apply-best-practice vs. analyse vs. probe-sense-respond vs. act-first). The ORIENT step should classify the Cynefin domain to pick the reasoning regime (recognition vs. deliberate search vs. probe).
- **Stafford Beer (1972), *Brain of the Firm* — the Viable System Model (VSM).** The cybernetic blueprint for an organisation that regulates itself: System 3 (operational control), System 4 (intelligence/environment-scanning = our PERCEIVE), System 5 (identity/policy = the inviolable rails). Borjie literally *is* "the brain layer"; VSM is the management-cybernetics precedent for an org-brain that watches itself.
- **Ashby's Law of Requisite Variety (1956).** A regulator must have at least as much variety as the system it regulates. The MD's metacognitive + expertise variety must match the mandate's variety — which is exactly why the kernel must be able to **CREATE** new organs (INV-C): fixed capability cannot regulate an unbounded mandate.

**Beyond-today leap (foundations):** treat INV-D not as an analogy to these classics but as a *typed implementation* of them — a `MetaLevel` object that literally holds a Nelson-Narens model of the object-level, exposes `monitor()` and `control()`, and is the same code in Borjie and BossNyumba (only the schema/playbook corpus differs). The kernel ships with a small "cognitive-science conformance suite" asserting the loop obeys Nelson-Narens (monitoring precedes control) and Ashby (capability-variety ≥ mandate-variety, measured) — making the philosophy machine-checkable.

---

## 2. Metacognition + self-direction — the 2026 frontier

### 2.1 The decisive finding: metacognition must be EXTERNAL ARCHITECTURE, not self-report

Three independent June-2026 results converge on one conclusion, and it is the single most important design directive in this lane:

- **Mirror: A Hierarchical Benchmark for Metacognitive Calibration in LLMs** (arXiv 2604.19809). Tests four tiers — atomic self-knowledge, cross-domain transfer, compositional prediction, adaptive self-regulation. Finding: models have **above-chance domain awareness** (they know their relative strengths), yet on weak-domain tasks **56.2% fail silently** with no external constraint. **Giving a model its own calibration score yields negligible improvement (p > 0.05); an architectural constraint cuts the confident-failure rate by 76% (0.600 → 0.143).** Human participants: **0%** confident-failure. Verdict: *"external metacognitive scaffolding, not better self-knowledge, is the path to safer agentic systems."* Compositional calibration collapses (error 0.434–0.758) — models calibrated per-skill cannot predict their performance on *combined-skill* tasks (directly relevant: a mining decision spans geology × royalty × FX × law).
- **"LLMs Know When They Know, but Do Not Act on It: A Metacognitive Harness for Test-time Scaling"** (arXiv 2605.14186). A Nelson-Narens harness: **FOK** (pre-solve confidence) → **Solve** → **JOL** (post-solve confidence) → **metacognitive gating** (learned SVM decides retry/accept) → **aggregation** (selects best attempt, *ignoring* confidence). On Claude Sonnet-4.6: HLE 48→60, LiveCodeBench 74.3→84.3, pooled 48.3→56.9 (+8.6); gains concentrate on low-confidence problems (16%→42%). Critical caveat: of nine models only one passed the diagnosis for *calibrated-enough-to-control* signals — the rest were "discriminative but miscalibrated" and needed recalibration first.
- **Production-calibration state-of-practice** (Zylos, 2026-04-18). RLHF *degrades* calibration (confident-sounding answers score higher regardless of truth). "Models can accurately verbalize uncertainty in isolation but fail to use it to guide their own decisions." Therefore: build uncertainty gating at the **infrastructure level**, make uncertainty a **first-class runtime value**, not a logged diagnostic.

**Why this matters for us:** INV-D's structured backend loop IS the architectural scaffold these papers say is the *only* thing that works. The leverage is enormous — but only if the loop's monitoring signals actually drive control. Today they do not (§4). Our recursive-HOT mixes a hedge sentence into the *prompt* — exactly the self-report intervention Mirror shows is worthless (p > 0.05). The fix is architectural gating, not better introspective prose.

**Beyond-today leap:** a per-tenant, per-domain **"confident-failure-rate" SLO** as a first-class product metric. Track the rate at which the MD acts (autonomously or recommends-as-fact) while objectively wrong, sliced by domain (geology/royalty/FX/HR/...). The autonomy-controller meta-rail (RSS-16) consumes it: a domain whose CFR exceeds threshold is auto-demoted to gated, and the curriculum (AUT-11) preferentially trains it. This makes "knows the edge of its competence and grows it deliberately" a closed control loop with a number, not an aspiration.

### 2.2 The control loop: Monitor-Generate-Verify and the Nelson-Narens harness

- **Monitor-Generate-Verify (MGV)** (arXiv 2511.04341) formalises Nelson-Narens for LLM reasoning as a typed loop: **Monitor** (assess confidence/coherence/constraint-fit) → on low confidence **Generate** (sample alternative reasoning paths) → **Verify** (validate against internal/task criteria) → accept or re-monitor. Design rules: **confidence-TRIGGERED intervention** (not uniform reprocessing — only spend compute where monitoring flags risk), calibrate monitoring sensitivity to task difficulty, treat verification as *active control* not passive feedback.
- This is the per-turn skeleton the kernel's think-pipeline should implement: a `monitor → (generate alternatives | proceed) → verify → gate` cycle, where the gate is calibrated (§2.4) and the verify step is GROUNDED (§2.5).

**Beyond-today leap:** make the MGV loop **value-of-information-aware**. Don't just trigger on low confidence — trigger when `expected_value_of_resolving_uncertainty × P(wrong) × consequence > cost_of_extra_compute`. A veteran does not re-think a $50 decision and a $5M licence call with the same effort. This is the metacognitive-economics layer the Triage paper (§2.3) shows current models lack entirely.

### 2.3 Prospective control + resource economics: Triage

**Triage** (arXiv 2605.13414) tests *prospective* metacognitive control — deciding, BEFORE acting, which problems to attempt, estimating per-task cost, and allocating a token/effort budget to maximise value. It operationalises four primitive judgments a veteran makes instinctively: **feasibility** (is this solvable at all?), **cost estimation**, **selection**, **sequencing**. Findings expose exactly the veteran-vs-novice gap: **binding-budget collapse** (when allocations are enforced, most models go *worse than random*), **planning-execution divergence** (models don't honour their own declared budgets), **unsolvable-blindness** (reasoning models fail to recognise infeasible items), and a **reasoning paradox** (more reasoning improves accuracy but NOT triage quality). Measured by an *oracle-normalised efficiency ratio* against ground truth, not self-report.

**Why this maps to INV-D ORGANIZE:** "decompose into loops/tasks/decisions; rank by consequence × reversibility; decide autonomous-vs-gated; delegate." That ranking IS prospective triage. Borjie should implement the four primitives explicitly: a **feasibility classifier** (is this in the mandate? do we have the evidence/tools? is it even decidable now?), a **cost estimator** (LLM tokens + sub-MD fan-out + human-approval latency), and a **consequence × reversibility scorer** (already named in the gap register) that *binds* the budget.

**Beyond-today leap:** a **"declare-then-honour" contract** enforced by the autonomy-controller. The MD declares, at ORGANIZE time, its plan + per-loop effort/spend ceiling + abstention list (what it will NOT attempt and why). The meta-rail then *enforces* the declared budget at EXECUTE time and logs declared-vs-actual divergence as a calibration signal feeding §2.1's CFR. This directly fixes Triage's "planning-execution divergence" failure mode that even frontier models exhibit — turning a known LLM weakness into a structural strength.

### 2.4 Calibrated, uncertainty-aware action: the three-layer confidence stack

The production consensus (Zylos 2026-04-18; conformal-abstention line: Selective Conformal Risk Control arXiv 2512.12844, Learning Conformal Abstention Policies arXiv 2502.06884) is a **three-layer** architecture — and we already own pieces of every layer but have wired none of them into the live turn:

1. **Measurement layer.** Don't trust verbalized confidence (RLHF-degraded; "confidence discretization" — models cluster on round-number anchors, Rescaling-Confidence arXiv 2603.09309). Use grounded signals: **semantic entropy** (sample → cluster by entailment → entropy over meaning-clusters; "gold standard for fact-based tasks"), **self-consistency / stability** (re-roll agreement), **token log-prob/entropy** (free but only an internal proxy), and **semantic-entropy probes** on hidden states for *unverbalized* hallucination risk.
2. **Gating layer (abstention).** Compare calibrated uncertainty to a threshold τ and **withhold or flag** above it. Conformal prediction gives distribution-free coverage guarantees; **Adaptive Conformal Inference** (Gibbs & Candès 2021) tunes τ online under drift — which is *exactly* the `conformal-calibration-online` package we already have (`aci.ts`). Learnable conformal abstention reports: +22% hallucination detection, +20% selective generation, **70–85% lower ECE**, ≥90% coverage at smaller set size.
3. **Escalation/deferral layer.** Route flagged cases to a human or a higher-capacity model rather than proceeding. ReDAct: deferring **only 15%** of decisions to a larger model matches full performance at a fraction of cost. This is the "ask / escalate" verb of a veteran.

A more sophisticated framing (AUQ, dual-process): treat uncertainty as **active control** — System 1 propagates confidence + semantic explanations through agent memory; System 2 triggers *targeted* recomputation only when uncertainty exceeds threshold (training-free, +10.7pp on ALFWorld). And **propagate uncertainty through the chain** to prevent the "Spiral of Hallucination" where an early epistemic error compounds across steps.

**Beyond-today leap:** a **per-domain conformal calibrator bank**. Today our ACI is one global state machine for forecasting. Instead, instantiate one online-conformal state *per domain-schema* (geology, royalty, FX, HSE, ...), each maintaining its own τ from its own observed coverage. The MD then carries a *vector* of calibrated competence — high-coverage in royalty, drifting in a newly-entered jurisdiction — and the gate/escalate decision reads the *relevant* domain's τ. Compositional tasks (Mirror's collapse case) take the *min* coverage across the domains they touch. This is the literal, numeric "edge of competence" map, self-updating from outcomes.

### 2.5 Self-monitoring + self-critique: from Reflexion to grounded critics

The arc of the field (Reflexion arXiv 2303.11366 → PRMs; Zylos 2026-05-12 synthesis):

- **Reflexion (2023):** store verbal self-critique in memory, retry with it. Pioneered verbal reinforcement (91% HumanEval).
- **The 2025/26 correction:** *intrinsic* self-correction is **fragile** — "the model that generated the wrong answer shares that exact blind spot when evaluating itself." The gains live in **grounded** self-correction: the correction signal comes from the *environment*, not model priors.
- **The production "Critic-in-the-Loop" pattern:** `agent → critic → [accept | revise → agent]`, with a **correction budget** (~3 attempts) before human escalation, and critic fidelity tiered by task: (1) **execution-grounding** (run the code / query the DB / re-check the ledger — highest reliability), (2) **LLM-as-judge with rubrics** (medium), (3) **Process Reward Models** (best for long-horizon — score each *step*, prune trajectories), (4) **multi-agent reflexion** with decorrelated roles (proposer/solver/judge) to break shared blind spots.
- **AgentPRM** (ACM Web Conf 2026): step-wise promise/progress reward models for agents — the long-horizon critic.

**Why this is the heart of the lane:** a veteran MD's self-critique is *grounded* — they check the assay, re-run the cashflow, call the lawyer. Our Reflexion stack exists (`reflexion-recorder/writer/retriever/loader`) and our Auditor is a counter-model critic, but both are intrinsic/heuristic today (§4). The upgrade is to make critique GROUNDED: the verify step must re-query the ledger / licence rows / corpus, not just re-prompt.

**Beyond-today leap:** a **decorrelated multi-critic council with a correction budget**, wired as the EXECUTE-TO-CLOSURE gate. Proposer (the persona) / solver (junior) / grounded-verifier (re-queries DB + corpus) / constitutional-critic (rails). The council's *disagreement* is itself a calibration signal: high disagreement → lower confidence → escalate. Budgeted at N rounds, then HITL. This is Reflexion + PRM + debate fused into one closure gate, and it directly implements INV-D's "never stop at proposes; drive to confirmed closure."

### 2.6 Self-aware delegation: knowing WHO should do it

**MetaCogAgent** (arXiv 2605.17292) is the most directly portable result for our junior-agent swarm. Each agent computes a **composite confidence**: `c = λ·c_verbalized + (1−λ)·c_profile` (λ=0.6), where `c_profile` is the agent's *historical success rate per cognitive dimension*. A **metacognitive-conflict detector** flags when verbalized and profile confidence diverge (→ be conservative). The **adaptive-delegation protocol**: execute directly if `c ≥ θ`; else broadcast to peers and route to the highest-confidence agent; if none clears θ, all solve and aggregate by confidence-weighted vote. **Capability-boundary learning** updates each profile via EMA: `p ← p + α·(reward − p)`, α=0.1. Results: 82.4% accuracy (+5.3 over majority-vote, +8.7 over AutoGen), delegation precision 0.841, **ECE 0.087**, 5% fewer API calls, smallest degradation on hard/cross-domain tasks. Ablations: removing self-assessment −6.8, removing adaptive delegation −5.1, removing boundary-learning −3.2.

**Why this is a near-drop-in:** we already have ~50 juniors and an Auditor that emits `confidence`. MetaCogAgent says: give each junior a **per-dimension competence profile** that *learns from outcomes*, compute composite confidence, and route delegation on it — and detect the verbalized-vs-historical conflict as a conservatism trigger. This is the formal version of "decide autonomous-vs-gated; delegate to junior agents/swarms" in INV-D ORGANIZE.

**Beyond-today leap:** fuse MetaCogAgent's `c_profile` with our per-domain conformal bank (§2.4) so the *same* competence vector drives (a) which junior gets the task, (b) whether the answer is gated/abstained, and (c) which domain the curriculum trains next. One unified, outcome-learned **competence tensor** [junior × domain × task-class → (meta-d′/d′, coverage, CFR)] is the MD's self-model of its own expertise — read at ORIENT, written at LEARN.

### 2.7 Intrinsic metacognitive learning: deliberately growing competence

**"Truly Self-Improving Agents Require Intrinsic Metacognitive Learning"** (ICML 2025 Position, arXiv 2506.05109) gives the formal three-component framework for an agent that grows its OWN competence (Flavell, operationalised):

1. **Metacognitive knowledge** — self-assessment of capabilities, tasks, and learning strategies (the competence tensor of §2.6).
2. **Metacognitive planning** — deciding *what* and *how* to learn (which blind-spot to close, by which mechanism — more retrieval? a new schema? a synthesized tool? a sub-MD?).
3. **Metacognitive evaluation** — reflecting on learning *experiences* to improve *future learning* (did closing that gap actually raise coverage? was the new schema used and did it help?).

Their core argument: today's self-improvement loops are **extrinsic** (fixed, human-designed) which "limits scalability and adaptability"; truly self-improving agents must run these loops *intrinsically*. Open challenges they name: responsibility-distribution (human vs. agent), evaluation of the metacognition itself, generalization across domains, and alignment-as-capability-grows.

**Why this is the LEARN+REPEAT step of INV-D:** the loop must not just store a reflexion — it must *plan its own learning* (pick the gap), *act on the plan* (synthesize the schema/tool/sub-MD via INV-C, gated by the meta-rail), and *evaluate whether learning worked* (did coverage rise?).

**Beyond-today leap — the self-calibrating expert that grows its own edge:** wire the three components into one nightly loop. (1) Knowledge: recompute the competence tensor from the day's outcomes. (2) Planning: rank blind-spots by `consequence × frequency × (1 − coverage)` and pick the top-k to close; choose the mechanism per gap (retrieval-gap → ingest; schema-gap → distil a new playbook; tool-gap → synthesize a tool; reasoning-gap → GEPA-optimise the junior prompt). (3) Evaluation: after closure, replay held-out cases and confirm coverage rose — if not, *roll back the change* (DGM archive) and try a different mechanism. The alignment invariant (per the position paper's open challenge): the agent may grow capability but the meta-rail (RSS-16, `inviolable.ts:482`) is immutable to it — money/licence/deletion stay HITL forever.

---

## 3. Domain expertise — turning the corpus + tacit knowledge into schemas the kernel reasons with

The other half of "veteran." A veteran is not a search engine over a manual; they have *compiled* the manual + decades of cases into instant-recognition schemas. SOTA gives a clean, controlled pipeline to manufacture that.

### 3.1 Recognition-primed schemas + case-based reasoning (the ORIENT engine)

- **Recognition-Primed Decision (Klein)** + **NDM prompting** (JMIR Biomed Eng 2026/1/e88053): prompting an LLM to reason *recognition-primed* — first classify the situation-type, then retrieve the typical course of action and mentally simulate it — outperforms blank-slate option-comparison on high-uncertainty real-world tasks. This is the literal implementation of INV-D ORIENT.
- **Case-Based Reasoning + LLM** (CBR-augmented LLM for safety-critical decisions, ScienceDirect S0925753526001256; agent-based collaborative RPD, USPTO 8442839): build an evolving **case base** of (situation → decision → outcome) records; at decision time **retrieve** the most-similar past cases and inject them as context; after acting, **retain** the new case. The classic CBR cycle — **Retrieve → Reuse → Revise → Retain** — *is* a learning loop that needs no fine-tuning, grounded in real prior outcomes.

**Mapping:** ORIENT = recognise situation-type (a learned classifier over our schema library) + retrieve top-k analogous past cases from the case base (which is our memory-v2 + cognitive-memory, once durable — MEM-01/02). The veteran's "I've seen this before" is a vector-similarity retrieve over outcome-labelled cases.

**Beyond-today leap:** a **typed schema library as the ORIENT vocabulary** — each schema = `{situation-signature, cues-to-watch, typical-playbook, failure-modes, who-to-delegate-to, evidence-required, reversibility-class}`. The PERCEIVE sensors emit cue-vectors; ORIENT does nearest-schema recognition (RPD) *and* nearest-case retrieval (CBR) in one step. When *no* schema matches above threshold, that itself is a metacognitive signal — "novel situation, Cynefin-complex, drop to deliberate search (LATS) and flag for a new schema to be distilled." Recognition-primed when it can be; deliberate-search when it must be; *and it knows which it's in*.

### 3.2 Compiling a corpus into a verifiable rule/schema base (controlled, anti-hallucination)

- **GOFAI meets Generative AI** (arXiv 2507.13550): the controlled pipeline to turn a domain corpus into an *expert system*. (1) **Domain-constrain** the scope (kills open-ended hallucination). (2) **LLM-extract** knowledge into an *explicit symbolic* representation (they use Prolog rules). (3) **Human-expert validates/corrects** the rule base before deployment. Result: interpretability + verifiable reasoning + the LLM's recall — a "transparent hybrid." Validated with Claude Sonnet and GPT-4 for factual adherence.
- **Neurosymbolic data-to-schema** (Neurosymbolic Graph Enrichment, arXiv 2411.12671; LLM-empowered KG construction survey arXiv 2510.20345): a **data-to-schema** process — generate instance-level graphs from raw text, then *abstract* ontological concepts by clustering/generalisation, then *extend* with heuristic/implicit rules. This is how the mandate corpus becomes the `miningOntology` the gap register says we're missing (KI-10).

**Why this is the right pattern for us:** the mandate corpus (Tumemadini regs, JORC/CRIRSCO, royalty law, LBMA, IAS 37, ...) must become **schemas + heuristics the kernel reasons with**, not just chunks it retrieves. The veteran doesn't re-read the regulation each time; the rule is *compiled in*. GOFAI's human-validated extraction is the anti-hallucination guarantee the mandate demands (every recommendation cites evidence; the Auditor rejects empty chains).

**Beyond-today leap — the "corpus → playbook" compiler as a standing org:** a nightly pipeline that ingests each corpus domain and *emits* (a) a typed schema (§3.1), (b) a set of explicit deterministic rules/thresholds (the GOFAI Prolog-equivalent — e.g. "if grade < cutoff then sub-economic", "if royalty rate × tonnage > X then licence-condition Y"), and (c) a recognition classifier. The deterministic rules become the spine of the domain juniors (the gap register's "deterministic-engine + LLM-narration + Auditor-gate" pattern), and the LLM only *narrates and contextualises* — never invents the rule. Human expert review gates each new rule (four-eyes). This is how Borjie becomes MIT/PhD-level on the *whole* mandate, structured: the corpus is compiled into reasoning organs, not left as a passive RAG index.

### 3.3 Distilling TACIT veteran knowledge into skills (the part no corpus contains)

The corpus has the *explicit* knowledge. The veteran's edge is *tacit* — "she'd push back here," "this counterparty always slips on settlement," "don't trust that assay lab in the rains." 2026 gives a pipeline for this exact thing:

- **COLLEAGUE.SKILL** (arXiv 2605.31264): automated distillation of a *person's/role's* expertise into reusable, **inspectable, correctable, governable** skills. Heterogeneous traces (chats, docs, decisions) → two tracks: **work.md** (procedures, standards, decision heuristics, lessons-learned) and **persona.md** (style, interaction rules). Versioned skill packages; natural-language correction ("she'd push back here") produces Markdown patches; previous versions archived for rollback.
- **Agent Skills survey** (arXiv 2602.12430; SoK Agentic Skills arXiv 2602.20867; SkillsBench arXiv 2602.12670): the architecture — **progressive disclosure** (L1 metadata in the system prompt; L2 instructions on trigger; L3 scripts/docs on demand — "like an onboarding guide for a new hire"). Acquisition modalities: human-authored, RL (SAGE: +8.9% completion, −59% tokens), autonomous discovery (SEAgent: 11.3→34.5% on unseen envs), compositional synthesis. **Curated skills raise pass rates +16.2pp (SkillsBench).** Governance is non-optional: **26.1% of community skills carry vulnerabilities**, script-bundling 2.12× riskier — hence a **Skill Trust & Lifecycle Governance Framework** (static analysis → semantic classification → behavioral sandbox → permission validation → graduated trust tiers).

**Why this is the missing organ:** our Voyager skill-capture exists but has no runtime caller (AUT-03/COG-08, gap register). The veteran's tacit edge should be *captured from verified trajectories* and *distilled from the owner's own corrections* into governed skills — and surfaced to juniors via progressive disclosure. The owner saying "no, in Geita we always do X" is a COLLEAGUE.SKILL correction patch.

**Beyond-today leap — the apprentice-to-master pipeline:** the MD starts as a *graduate* (corpus-compiled schemas only) and becomes a *veteran* by accreting tacit skills from three sources, all under the skill-governance gates: (1) **owner corrections** distilled into patches (COLLEAGUE.SKILL); (2) **verified successful trajectories** captured as skills (Voyager, AUT-03); (3) **its own near-misses** captured as failure-mode heuristics ("last time this counterparty's KYC was stale → check first"). Each skill is versioned, sandbox-validated, permission-scoped, and promoted only after N clean uses (graduated autonomy, AUT-04). The competence tensor (§2.6) tracks which skills are master-level vs. apprentice. *This is the literal mechanism by which the MD becomes a veteran rather than a graduate, and it grows forever.*

### 3.4 Breadth across the WHOLE mandate, structured

INV-D demands expert-on-everything-in-the-mandate. The domain map (gap register DM-*) shows ~11/24 mining domains DEEP, the rest SHALLOW/NONE; built-env 2/19. The structured path to MIT-veteran breadth:

- For **each** domain in the 24+19 matrix, manufacture the §3.2 triple (schema + deterministic rules + recognition classifier) from the corresponding corpus, plus the §3.1 case base, plus §3.3 tacit skills.
- The **deterministic-engine + LLM-narration + Auditor-gate** pattern (gap register) is the reusable factory: deterministic rules give correctness; the LLM gives a veteran's *voice*; the Auditor gives evidence-grounding. Replicate per domain.
- Cross-domain *composition* is where Mirror says models collapse — so the kernel must explicitly handle multi-domain decisions: take min-coverage across touched domains (§2.4), and when a decision spans geology × royalty × FX × law, run the multi-critic council (§2.5) with one critic per domain.

**Beyond-today leap — a domain-mastery dashboard with a maturity ladder.** Every mandate domain gets a public maturity level (NONE → SHALLOW → DEEP → VETERAN) computed from: schema coverage, deterministic-rule count, case-base size, tacit-skill count, and live competence-tensor metrics (meta-d′/d′, conformal coverage, CFR). The self-improvement loop (§2.7) drives every domain up the ladder deliberately, prioritised by `consequence × usage`. The product can *show the owner* "I am veteran on royalty and resource estimation, deep on FX, still apprentice on family-office succession — and here's what I'm learning this week." Self-knowledge made legible.

---

## 4. Our gaps vs. auditor / conformal / reflexion (what we have, where it falls short)

We own unusually strong raw material — and that is the point: the gap is almost entirely **wiring + grounding**, not greenfield. Each gap below is stated against a concrete file and the SOTA finding it fails.

1. **Confidence is regex `min()`, not calibrated, and never gates.** `packages/central-intelligence/src/kernel/confidence.ts` computes `overall = min(groundedness, stability, review, numericalConsistency)` where groundedness is a regex over "factual-signal" words and stability defaults to 1.0 because the re-roll is null (`COG-10`: `kernel.ts:1732 rerolledOutputText:null`). Per §2.1/§2.4 this is the worthless self-report. **Gap:** replace regex-groundedness with claim-extraction + NLI; turn on the re-roll for stakes≥high; feed the result into the conformal gate. (gap register COG-03, COG-10, RSS-22).

2. **The brain hard-stamps confidence = 1 / gates = pass.** `kernel.ts:3602-3614 translateOrchestratorResponse` overwrites every orchestrator answer as maximally confident. This is the *exact* "models persistently increase confidence despite contradictory evidence" pathology Mirror names — except we do it by construction. **Gap (BLOCKER-class):** run the real confidence scorer + policy-gate + conformal abstention BEFORE translation. (RSS-22/EXEC-rails).

3. **Conformal calibrator has ZERO live consumers.** `packages/conformal-calibration-online/src/aci.ts` is a correct Gibbs-Candès ACI state machine, but `conformal-confidence-gate.ts` is dark (gap register COG-03: "ZERO live consumers"). We have the §2.4 gating layer built and unplugged. **Gap:** feed the kernel `ConfidenceVector` into ACI; consume calibrated α inside the uncertainty-policy thresholds; instantiate the per-domain bank (§2.4 leap).

4. **Recursive-HOT / metacognition modules are pure regex and orphaned.** `metacognition/recursive-hot.ts` and `introspection/per-thought-self-model.ts`, `abductive/best-explanation.ts`, `defection-probe.ts` are heuristic and consumed by no live path (gap register COG-04, COG-05). Worse, recursive-HOT's output is *mixed into the prompt* — the self-report intervention Mirror proves is worthless (p > 0.05). **Gap:** make metacognition architectural (a gating step that changes *control flow*, not prose); back the heuristics with a Haiku judge in deep mode (COG-05).

5. **Auditor emits a raw `confidence: number`, ungrounded and uncalibrated.** `ai-copilot/.../auditor-agent.ts` does evidence-presence checks + a Haiku counter-model — good, and aligned with §2.5's multi-critic idea — but (a) its confidence is not calibrated against outcomes, (b) the critic is *intrinsic* (Haiku re-reads the same text) not *grounded* (re-query the ledger/DB/corpus), and (c) it is a single critic, not a decorrelated council. **Gap:** ground the verify (re-query state), calibrate the verdict's confidence against retained outcomes, and widen to a decorrelated council with a correction budget (§2.5 leap).

6. **Reflexion is recorded but the loop is not grounded or learning-planned.** `kernel/reflexion/*` records/writes/retrieves reflexions, but there is no grounded critic-in-the-loop with a correction budget, no plan-repair node (COG-13: "failures don't trigger early repair"), and no intrinsic-metacognitive-learning loop that *plans what to learn* (§2.7). **Gap:** wire grounded critic-in-the-loop as the EXECUTE-TO-CLOSURE gate; add the plan-repair branch; add the nightly metacognitive-learning loop.

7. **No competence model / capability-boundary learning.** Nothing computes meta-d′/d′ or a per-domain/per-junior outcome-learned competence profile (MetaCogAgent §2.6). Delegation is by static role, not learned competence (the gap register's juniors route on router prompts, not profiles). **Gap:** add the competence tensor + EMA boundary-learning + conflict-detection delegation. This is the largest *new* piece, and it's the one that makes "knows the edge of its competence" real.

8. **No prospective triage / declared-budget enforcement.** ORGANIZE ranks by consequence × reversibility (named) but there's no feasibility classifier, cost estimator, or declare-then-honour budget enforcement (§2.3). **Gap:** implement the four Triage primitives; enforce the declared budget at the meta-rail.

9. **No external CFR / confident-failure SLO.** Nothing tracks, per domain, the rate of acting-while-wrong — the one number Mirror says actually moves safety. **Gap:** instrument it; feed it to the autonomy-controller (RSS-16) and the curriculum (AUT-11).

10. **Expertise is RAG chunks, not compiled schemas.** The corpus is retrieved (when the pipe works — KI-01..17), but never compiled into schemas / deterministic rules / recognition classifiers / case base (§3). The `miningOntology` doesn't exist (KI-10). No tacit-skill distillation runs (AUT-03 dark; COLLEAGUE.SKILL pattern absent). **Gap:** build the corpus→playbook compiler (§3.2), the schema library + case base for ORIENT (§3.1), and the apprentice-to-master tacit-skill pipeline (§3.3).

**Net:** we are roughly two-thirds *built* and one-third *grounded+wired*. The frontier says the wiring is the whole game — the architectural loop, not the model's self-talk, is what cuts confident-failure 76%. INV-D is that loop; these ten gaps are the places it currently measures without acting, or reasons without compiled expertise.

---

## 5. Synthesis — the metacognitive, expert MD in one diagram (prose)

Per turn (Nelson-Narens / MGV / OODA, all the same loop):

- **PERCEIVE** (System-4 environment scan, VSM): sensors emit cue-vectors over ledger/calendar/corpus/regs/production/market/people; identify loops/needs the user hasn't asked about.
- **ORIENT** (RPD + CBR + Cynefin): recognise the situation-type against the typed schema library; retrieve top-k analogous cases; classify the Cynefin quadrant → pick recognition vs. deliberate-search regime. If no schema matches → "novel," drop to LATS and flag for schema distillation.
- **MONITOR** (meta-level): compute calibrated confidence via the three-layer stack — semantic entropy + self-consistency + the relevant per-domain conformal τ. Read the competence tensor for this domain/junior/task-class.
- **ORGANIZE** (prospective triage): feasibility → cost → consequence×reversibility → declare plan + budget + abstention list; decide autonomous-vs-gated; delegate to the highest-composite-confidence junior (MetaCogAgent), with conflict-detection conservatism.
- **CREATE** (INV-C, Ashby): if a schema/rule/tool/sub-MD is missing, synthesize it — under the body-change meta-rail + four-eyes + skill-governance gates.
- **EXECUTE-TO-CLOSURE** (grounded critic-in-the-loop): act; the decorrelated council (proposer/solver/grounded-verifier/constitutional-critic) re-queries real state; correction budget N then HITL escalate; drive every loop to *confirmed* closure, never "proposes."
- **CONTROL gate** (the architectural scaffold Mirror demands): if calibrated uncertainty > τ for the touched domains → abstain / ask / escalate / defer-to-bigger-model; if a HIGH-risk prefix (money/licence/deletion) → HITL always.
- **LEARN+REPEAT** (intrinsic metacognitive learning): retain the case (CBR); update the competence tensor (EMA); record reflexion; nightly, *plan what to learn* (rank blind-spots), *act* (ingest / distil schema / synthesize tool / GEPA-optimise), *evaluate* (did coverage rise? else roll back, DGM archive). The CFR SLO and the domain-maturity ladder make the growth legible.

Invisible to the user (INV-D): the owner only chats Mr. Mwikila. Same kernel powers BossNyumba — only the schema/playbook/case corpus differs.

---

## 6. Beyond-today — the singular leap

**A self-calibrating expert that knows the edge of its competence and grows it deliberately** is achievable by composing exactly the pieces above into one artefact: the **competence tensor** [domain × junior × task-class → (meta-d′/d′, conformal-coverage, confident-failure-rate, schema-maturity)], (a) READ at ORIENT/MONITOR to decide recognition-vs-search and proceed-vs-abstain-vs-delegate, (b) WRITTEN at LEARN from grounded outcomes, and (c) the OBJECTIVE FUNCTION of the nightly self-improvement loop, which deliberately drives the weakest high-consequence cells up the maturity ladder by the right mechanism (ingest / distil-schema / synthesize-tool / optimise-prompt / spawn-sub-MD), each gated by the immutable meta-rail. The tensor IS the MD's self-model of its own expertise; making it numeric, per-domain, outcome-learned, and the target of deliberate growth is what turns a strong answer-model into a veteran that knows what it doesn't know and closes the gap on purpose — the literal definition of MIT/PhD-veteran metacognition. The defining inversion vs. today's frontier: instead of hoping the model introspects better (which Mirror proves fails), Borjie makes the *architecture* hold the self-knowledge and act on it — and lets the model's only job be to narrate, ground, and grow it.
