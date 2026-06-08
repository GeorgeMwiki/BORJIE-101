# Kernel Cognitive Architectures — Structuring an LLM Mind for Veteran-Grade, General, Structured Cognition

**Lane:** cognitive-architectures
**Author:** research subagent (deep-dive)
**Date:** 2026-06-08
**Scope:** How to structure an LLM-based agent MIND so it runs a continuous, structured, veteran-grade cognitive cycle (INV-D), not a per-request prompt chain. Survey of classic cognitive architectures (Soar, ACT-R, LIDA/Global Workspace, CLARION) and their 2026 LLM incarnations (CoALA and successors). Maps each INV-D cycle stage to a concrete `packages/central-intelligence` kernel component, then states our gaps versus the bar.
**Sister system:** BossNyumba (real-estate) shares this exact kernel; only the domain layer differs. Everything below is domain-agnostic by construction.

---

## 0. The thesis in one paragraph

A veteran mining-estate MD does not "answer prompts." She runs a *resident mind*: senses always on, a library of recognised situation-types, a habit of decomposing by consequence, the reflex to build the missing tool, and the discipline to drive every loop to confirmed closure — then sleep, reflect, and repeat. The 60-year cognitive-science canon (Soar, ACT-R, LIDA, CLARION) already formalised this as a **cognitive cycle running over modular memory**. The 2023 **CoALA** paper ([Sumers, Yao, Narasimhan & Griffiths, TMLR](https://arxiv.org/abs/2309.02427)) re-expressed it for LLM agents: *working / episodic / semantic / procedural memory + an internal/external action space + a propose→evaluate→select→execute decision cycle*. INV-D **is** a cognitive cycle. Borjie's kernel already implements ~90% of the *stages* (the 14-step `think()` pipeline + the orchestrator main-loop + the agency wake-loop). **The single structural gap is that the cycle is still triggered, not resident:** it fires per HTTP request (`think(req)`) and per cron tick (`runWakeCycle`), where the SOTA bar — and INV-D's literal wording ("CONTINUOUS, STRUCTURED cognitive cycle in the BACKEND … continue perpetually") — demands a *persistent mind that holds a current situational model between turns and runs its own cycle whether or not the owner is typing.*

---

## 1. The classic cognitive architectures — what each teaches us

These are not history-for-history's-sake. Each contributes one load-bearing idea the LLM-agent field is currently *re-deriving badly*, and each maps onto an INV-D stage.

### 1.1 Soar (Laird, Newell, Rosenbloom, 1983–) — the decision cycle + impasse-driven subgoaling

Soar treats cognition as a **single uniform decision cycle**: *elaborate → propose operators → evaluate (preferences) → decide → apply*. Its two killer ideas:

- **Impasse-driven subgoaling.** When the cycle cannot decide (a tie, a no-change, a conflict), Soar automatically *creates a subgoal* to resolve the impasse — and the result is **chunked** into a new production so the same impasse is resolved instantly next time. This is the original "learn a new skill exactly where the existing skill runs out."
- **The OODA / observe-decide-act lineage.** Soar's cycle is the ancestor of ReAct; the 2026 mapping literature notes ReAct "lacks the explicit commitment step present in Soar" ([Zylos, *Cognitive Architectures for AI Agents*, Mar 2026](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)).

**Borjie analogue:** Soar's impasse → subgoal → chunk loop is *exactly* `orchestrator/self-extension.ts` (`detectRecurringGap` → `proposeNewSubMd` → `compileAndDeploySubMd`) plus `agency/stall-detector.ts`. We have the mechanism. What we lack is Soar's *immediacy*: Soar chunks on the spot, mid-cycle; we batch-detect gaps on a daily/weekly scheduled job.

### 1.2 ACT-R (Anderson, 1993–) — declarative/procedural split + activation-weighted retrieval

ACT-R separates **declarative memory** (chunks/facts) from **procedural memory** (production rules), connected through buffers (goal, retrieval, imaginal) that form a central blackboard. Its load-bearing idea is **sub-symbolic activation**: every declarative chunk carries a *base-level activation* (recency × frequency) plus spreading activation from the current context; retrieval is *not* a keyword match but a softmax over activation. This is why ACT-R recalls "the relevant fact" rather than "all matching facts."

**Borjie analogue:** the declarative/procedural split is real in the kernel — `memory/` (episodic-amem, hybrid-retrieval, mmr-rerank) is declarative; `power-tools/` + `skill-library/` + sub-MD registry is procedural. The 2026 article makes the mapping explicit: procedural memory = tool definitions/system prompts; declarative = RAG/semantic search ([Zylos, 2026](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)). Our `hybrid-retrieval.ts` + `mmr-rerank.ts` is a (good) approximation of ACT-R's activation-weighted recall; the gap is that activation is *not persistent across turns* — there is no resident "what is currently salient on this estate" accumulator that decays and spreads between requests.

### 1.3 LIDA (Franklin, Baars' Global Workspace Theory, 2000s) — the continuous cognitive cycle + attention bottleneck

LIDA is the architecture that matters most for INV-D, because it is the one that is *genuinely continuous*. LIDA runs a **cognitive cycle ~every 200–300 ms, forever**, in three phases ([Franklin et al., *LIDA cognitive model tutorial*](https://digitalcommons.memphis.edu/cgi/viewcontent.cgi?article=1017&context=ccrg_papers); [PLOS One, *The Timing of the Cognitive Cycle*](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0014803)):

1. **Understanding** — sensory memory → feature detectors → a **Current Situational Model** is assembled/updated.
2. **Consciousness/Attention** — *attention codelets* (tiny concurrent agents) form coalitions of the most salient content; a competition in the **Global Workspace** selects the single winning coalition, which is **broadcast** globally.
3. **Action selection & learning** — the broadcast recruits behaviour schemes; one acts; perceptual/episodic/procedural learning happens *from the broadcast*.

Two ideas Borjie must steal:
- **The Current Situational Model persists between cycles.** LIDA does not rebuild understanding from scratch each tick — it *updates* a standing model. This is the antidote to "every `think()` re-reads the world cold."
- **The attention bottleneck is a feature, not a bug.** GWT's competition-then-single-broadcast is the discipline that stops "stuff everything in context." The 2026 mapping warns the analogue is transformer attention and that "stuffing the context window degrades decision quality by diluting signal" ([Zylos, 2026](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)).

**Borjie analogue:** the *winner-take-all broadcast* is our `modality-arbiter` + `cognitive-load.ts` + `ttc-allocator.ts` (which content earns the expensive deliberation). The *Current Situational Model* is the gap — `world-model/state-vectors.ts` + `regime-detector.ts` exist but are computed per-call, not maintained as a standing, decaying estate model.

### 1.4 CLARION (Sun, 2000s) — dual-process + the metacognitive subsystem (MCS)

CLARION's contribution is **explicit dual representation across four subsystems** ([Wikipedia, *CLARION*](https://en.wikipedia.org/wiki/CLARION_(cognitive_architecture)); [Sun, *The CLARION Cognitive Architecture: A Tutorial*](https://www.researchgate.net/publication/228726745_The_CLARION_Cognitive_Architecture_A_Tutorial)):
- **ACS** (action-centred, procedural), **NACS** (non-action-centred, declarative), **MS** (motivational), **MCS** (**metacognitive — regulates the others**).
- Each subsystem has a *top level* (explicit, deliberate, System-2-like rules) and a *bottom level* (implicit, intuitive, System-1-like neural). The bottom level handles the routine; the top level is engaged only when needed.

The two ideas to steal:
- **A first-class metacognitive subsystem** that *regulates* the rest (how hard to think, which subsystem to trust, when to switch strategy). This is precisely the System-1/System-2 arbitration the 2026 literature calls a "meta-cognitive controller" that "assesses the need to employ System 2 solvers by considering resource constraints, abilities of solvers, past experience, and expected reward" ([*Thinking Fast and Slow in AI*, arXiv:2110.01834](https://arxiv.org/pdf/2110.01834)).
- **A motivational subsystem** — standing drives/goals that *generate* activity, the missing organ that turns a reactive agent into a self-starting one. This is the formal name for INV-D's "identify loops the user has not asked about."

**Borjie analogue:** the MCS already exists and is unusually strong — `metacognition/` (activation-probe, recursive-hot, defection-probe, autobiography), `introspection/` (per-thought-self-model, body-schema-reader, capability-cards), `self-awareness.ts`, `uncertainty-policy.ts`, `ttc-allocator.ts`, `model-tiering.ts`. The dual-process split is `fast-path-router.ts` / `orchestrator-fast-cache.ts` (System 1) vs the full `think()` pipeline / LATS / debate (System 2). **The motivational subsystem (MS) is the thin spot** — `agency/goals/` + `agency/initiative/wake-triggers/` are detector-driven, not drive-driven; there is no standing utility/motivation field that *ranks what the estate most needs attention on right now* independent of an incoming trigger.

---

## 2. The 2026 LLM incarnation — from prompt-chains to persistent minds

### 2.1 CoALA — the Rosetta Stone (and our self-classification)

CoALA ([arXiv:2309.02427](https://arxiv.org/abs/2309.02427); [html v3](https://arxiv.org/html/2309.02427v3)) is the canonical bridge from the classics to LLM agents. It says a language agent = **modular memory + structured action space + a decision procedure**, and treats *the LLM as a probabilistic production system* (a direct Soar lineage — "the LLM defines a probability distribution over which productions to select").

**Memory modules (CoALA):**
- **Working memory** — "active and readily available information as symbolic variables for the current decision cycle … the central hub connecting different components."
- **Episodic** — "experience from earlier decision cycles."
- **Semantic** — "knowledge about the world and itself."
- **Procedural** — "implicit knowledge in LLM weights" + "explicit knowledge written in the agent's code."

**Action space (CoALA):**
- **Internal:** *Retrieval* (long-term → working), *Reasoning* (process working memory → new info), *Learning* (write to long-term).
- **External:** *Grounding* (act on the world + process feedback). CoALA's classifier note: the external leg "is where permission gating, reversibility, cost, and the lethal trifecta live" ([AgentPatterns, *CoALA classifier*](https://agentpatterns.ai/frameworks/coala-cognitive-architecture-language-agents/)) — exactly Borjie's HITL money/licence/deletion rails.

**Decision cycle (CoALA):** a **planning stage** of *Proposal → Evaluation → Selection*, then an **execution stage**. "A four-phase cycle that repeats until termination." The classifier's diagnostic is the **missing-slot question**: *which of the four memories does your harness lack?*

**Borjie's CoALA self-classification (the verdict):**

| CoALA slot | Borjie component | Status |
|---|---|---|
| Working memory | the per-turn `think()` working set / orchestrator transcript + `context-budget.ts` | present, **per-turn only** |
| Episodic memory | `memory/episodic-amem.ts`, reflexion store, `cot-reservoir.ts` | present, persisted (memory-v2 Drizzle) |
| Semantic memory | `intelligence_corpus_chunks`, `embedder.ts`, `hybrid-retrieval.ts`, world-model | present |
| Procedural memory | `power-tools/`, `skill-library/`, sub-MD registry, prompt-layers | present, **self-extending** (rare) |
| Internal: Retrieval | step 4/4b–4f memory recall | present |
| Internal: Reasoning | sensor call + LATS + debate + self-RAG | present, **strong** |
| Internal: Learning | reflexion-writer, continuous-grading, prompt-evolution, sleep | present, **strong** |
| External: Grounding | `agency/executor`, action-tools, tool-dispatcher, four-eye rails | present, **rails strong** |
| Decision: Propose | `orchestrator/plan.ts` + `search-planner.ts` + LATS candidate gen | present |
| Decision: Evaluate | `sensors/self-grading-judge.ts`, `critics/`, `counter-model/`, debate | present, **strong** |
| Decision: Select | `orchestrator/decision.ts`, `policy-gate.ts`, `risk-tier.ts` | present |
| Decision: Execute | `main-loop.ts` dispatch + executor | present |

**No CoALA slot is empty.** Borjie is, by CoALA's own classifier, a complete cognitive architecture. The deficiency is not a *missing module* — it is the **decision cycle's trigger model**: CoALA's "repeats until termination" is implemented as "repeats until this HTTP request terminates," not "repeats until the estate is at rest."

### 2.2 The frontier moves the bar: persistent minds, not request loops

The June-2026 literature is unanimous that the next step is *persistence between sessions*:

- **Reflection is what makes a mind durable.** In the Generative Agents line of work, *removing reflection collapsed multi-day coherence into repetitive context-free behaviour within ~48 simulated hours* ([Memory for Autonomous LLM Agents survey, arXiv:2603.07670](https://arxiv.org/abs/2603.07670)). Borjie has reflexion + sleep — but it runs as a nightly canary, not as a load-bearing organ the daytime mind depends on.
- **Sleep-time compute** — "the LLM, when not actively responding to the user but still with access to context, reasons about that context offline rather than idling" ([*Sleep-time Compute*, arXiv:2504.13171](https://arxiv.org/pdf/2504.13171)); the 2026 follow-up consolidates recent context into persistent fast weights during an offline pass ([*Language Models Need Sleep*, arXiv:2605.26099](https://arxiv.org/html/2605.26099v1)). This is the formal SOTA name for INV-D's "LEARN+REPEAT … continue perpetually."
- **Two-loop (fast/slow) agent bodies** — DPT-Agent and successors run a **Fast Loop** (low-latency reaction) concurrently with a **Slow Loop** ("in-depth reasoning to generate high-level insights") ([*From Generative to Agentic AI: A Roadmap in 2026*](https://medium.com/@anicomanesh/from-generative-to-agentic-ai-a-roadmap-in-2026-8e553b43aeda)). This is CLARION's dual level made architectural, and it is exactly the shape INV-D wants: a chat-latency fast loop for the owner, a perpetual slow loop running the perceive→…→learn cycle on the estate.
- **The session/governor/executor separation** ([Zylos, 2026](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)) — the conversational layer emits *intents only* and has no channel to the executor that bypasses policy. Borjie already enforces this computationally (chat → orchestrator decision → policy-gate/four-eye → executor); worth naming as a SOTA-aligned strength.
- **Ambient agents need a standing context buffer** distinct from session context — "analogous to the human experience of waking up and reviewing what happened overnight" ([Zylos, 2026](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)). This is the **Current Situational Model** (LIDA) wearing 2026 clothes, and it is Borjie's single biggest missing organ.

---

## 3. INV-D cycle → concrete kernel component map

The veteran-MD cycle in INV-D maps cleanly onto kernel modules. This is the spine of the dossier: it shows we are not missing stages, only the *resident loop* that runs them.

| INV-D stage | Cog-arch analogue | Borjie kernel component(s) | What's solid | What's thin |
|---|---|---|---|---|
| **PERCEIVE** (always-on senses; find loops nobody asked about) | LIDA *Understanding* + sensory codelets; CLARION *MS* drives | `kernel/sensors/`, `sensor-failover.ts`, `awareness-scopes.ts`, `agency/initiative/real-detectors.ts` (arrears/lease/vacancy → mining analogues), `drift-detector.ts`, `cohort-signal.ts` | sensors + failover + detectors all real | **no standing Current Situational Model**; perception is recomputed per `think()`/per cron tick, not maintained |
| **ORIENT** (recognise situation-TYPE via expert schemas; recognition-primed) | Klein **RPD** (pattern-match a prototype, not enumerate options); Soar *elaboration*; ACT-R chunk activation | `world-model/regime-detector.ts`, `world-model/state-vectors.ts`, `persona/` schemas, `vp-personas/`, `theory-of-mind.ts`, `risk-tier.ts` | regime detection + persona schemas exist | **no explicit RPD prototype library** — situation-types are implicit in prompts/personas, not a typed, retrievable schema set keyed by cues |
| **ORGANIZE** (decompose; rank by consequence × reversibility; autonomous-vs-gated; delegate) | Soar *operator proposal/preference*; CoALA *Propose→Evaluate→Select* | `orchestrator/plan.ts`, `search-planner.ts`, `lats-search.ts`, `risk-tier.ts`, `policy-gate.ts`, `four-eye-approval.ts`, `sub-mds/`, `planner-dispatcher.ts` | **strong** — consequence×reversibility is literally `risk-tier.ts`; delegation to sub-MDs is real | ranking is per-turn; no standing priority queue across the whole estate |
| **CREATE** (build/compose the missing tool/organ; INV-C) | Soar *impasse → subgoal → chunk*; CoALA *meta-learning by modifying agent code* | `orchestrator/self-extension.ts`, `agency/stall-detector.ts`, `tool-spec.ts`, `skill-library/`, `power-tools/`, `consolidation/` | self-extension + skill-library are a genuine differentiator | fires on **scheduled** gap-detection, not Soar-style **on-impasse mid-cycle** |
| **EXECUTE-TO-CLOSURE** (drive every loop to confirmed closure; retry/escalate; never stop at "proposes") | LIDA *action selection*; CoALA *grounding* + observe feedback | `agency/executor/`, `agency/action-tools/`, `main-loop.ts` dispatch + `monitor` decision kind, `agency/goals/goal-tracker.ts`, `stall-detector.ts`, four-eye/HITL rails | executor + goal-tracker + stall-detector + monitor decision = real closure machinery | closure is **per-goal**; no perpetual supervisor that re-enters open loops every cycle until confirmed-closed |
| **LEARN + REPEAT** (reflect, update mental models + memory, continue perpetually) | LIDA learning-from-broadcast; ACT-R activation update; CLARION bottom-up rule extraction; **sleep-time compute** | `reflexion/` (+`sleep/`), `continuous-grading.ts`, `prompt-evolution/`, `consolidation/`, `memory/` (memory-v2 Drizzle), `learning-loop-port.ts`, `metacognition/autobiography.ts` | reflexion + sleep + consolidation + persisted memory all exist | runs as **nightly canary**, not as the daytime mind's standing dependency; "continue perpetually" is the unmet word |
| **(meta) regulate the whole cycle** | CLARION **MCS**; System-1/2 meta-controller | `metacognition/`, `introspection/`, `self-awareness.ts`, `uncertainty-policy.ts`, `ttc-allocator.ts`, `model-tiering.ts`, `fast-path-router.ts` | **unusually strong** — genuine MCS | not wired to govern a *resident* loop (there is no resident loop yet) |
| **(meta) consciousness / attention bottleneck** | LIDA Global Workspace winner-take-all broadcast | `modality-arbiter.ts`, `cognitive-load.ts`, `context-budget.ts`, `orchestrator-fast-cache.ts` | arbiter + load-shedding exist | no single "what is the estate's one most-salient concern right now" broadcast that the whole mind orients to |

---

## 4. SOTA findings (numbered, citable)

1. **CoALA is the field's accepted bridge** from Soar/ACT-R/LIDA/CLARION to LLM agents: *modular memory (working/episodic/semantic/procedural) + internal/external actions (retrieve/reason/learn/ground) + a propose→evaluate→select→execute cycle*, with the LLM cast as a probabilistic production system ([Sumers et al., arXiv:2309.02427](https://arxiv.org/abs/2309.02427)).
2. **CoALA's diagnostic is the "missing-slot question."** By that test Borjie has **zero empty slots** — it is already a complete cognitive architecture; the defect is the *cycle trigger*, not a *missing organ* ([AgentPatterns CoALA classifier](https://agentpatterns.ai/frameworks/coala-cognitive-architecture-language-agents/)).
3. **LIDA is the only classic architecture that is genuinely continuous** — a ~200–300 ms cognitive cycle that *updates a persistent Current Situational Model* rather than rebuilding understanding each tick, with a Global-Workspace attention bottleneck (compete → single broadcast) ([Franklin LIDA tutorial](https://digitalcommons.memphis.edu/cgi/viewcontent.cgi?article=1017&context=ccrg_papers); [PLOS One timing study](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0014803)). This is the literal template for INV-D's "continuous, structured cycle."
4. **Soar's impasse→subgoal→chunk** is the canonical "learn a new skill exactly where the old one runs out," and it happens *mid-cycle, immediately* — the gold standard our scheduled `self-extension.ts` should converge toward ([Zylos 2026 mapping](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)).
5. **ACT-R's activation-weighted retrieval** (base-level recency×frequency + spreading activation) is the principled answer to "recall the relevant fact, not all matching facts"; Borjie's `hybrid-retrieval + mmr-rerank` approximates it but holds **no persistent activation field** between turns.
6. **CLARION contributes the metacognitive subsystem (MCS) and motivational subsystem (MS)** — explicit organs for *regulating thinking* and for *self-generated drives* ([CLARION tutorial, Sun](https://www.researchgate.net/publication/228726745_The_CLARION_Cognitive_Architecture_A_Tutorial)). Borjie's MCS is strong; its MS (standing drives) is the thin spot.
7. **Recognition-Primed Decision (Klein, NDM)** is the cognitive science of *veteran* judgment: experts pattern-match a prototype and mentally simulate one option rather than enumerate — reliable exactly when the domain is regular and feedback is fast ([RPD glossary](https://primores.org/wiki/glossary/recognition-primed-decision/)). INV-D's "recognise the situation-TYPE … not a blank-slate think every turn" is RPD by name; Borjie lacks a *typed, cue-indexed prototype library*.
8. **Dual-process / two-loop is the 2026 production consensus:** a Fast Loop (reactive, low-latency) concurrent with a Slow Loop (deliberative, insight-generating), with a meta-controller that engages System 2 only when "resource constraints, solver ability, past experience, and expected reward" warrant it ([Thinking Fast and Slow in AI, arXiv:2110.01834](https://arxiv.org/pdf/2110.01834); [DPT-Agent line, 2026 roadmap](https://medium.com/@anicomanesh/from-generative-to-agentic-ai-a-roadmap-in-2026-8e553b43aeda)). Borjie has the pieces (`fast-path-router` vs full pipeline + `ttc-allocator`) but not as **two concurrently running loops**.
9. **Sleep-time compute is the SOTA name for INV-D's LEARN+REPEAT**: reason over accumulated context while idle, consolidate into persistent state/fast-weights, so daytime prediction is cheaper and sharper ([Sleep-time Compute, arXiv:2504.13171](https://arxiv.org/pdf/2504.13171); [Language Models Need Sleep, arXiv:2605.26099](https://arxiv.org/html/2605.26099v1)). Borjie's reflexion-sleep exists but is a *nightly canary*, not a load-bearing organ.
10. **Reflection is load-bearing, not optional:** removing it collapses multi-day coherence within ~48 simulated hours (Generative Agents line) ([Memory survey, arXiv:2603.07670](https://arxiv.org/abs/2603.07670)). A persistent estate-mind without a standing reflection dependency *will* degrade.
11. **Ambient agents require a standing "overnight" context buffer** separate from session context — the engineering name for LIDA's Current Situational Model ([Zylos 2026](https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action)). This is Borjie's #1 missing organ.
12. **Session→Governor→Executor computational separation** (conversational layer emits intents only; no bypass channel to the executor) is SOTA security-cognition; Borjie already enforces it (chat → orchestrator decision → policy-gate/four-eye → executor) — a strength to preserve, not a gap.

---

## 5. Beyond-today leaps (one per finding — the world-class moves)

1. **CoALA-as-self-audit organ.** Wire CoALA's missing-slot classifier as a *continuous self-introspection probe* (`introspection/capability-cards.ts`): the kernel periodically asks "is any of my four memories or four actions degraded/dark right now?" and proposes its own remediation sub-MD. The architecture audits its own completeness.
2. **From per-request cycle to resident `EstateMind` loop.** Promote the cycle out of `think(req)` into a long-lived `EstateMind.tick()` (a Slow Loop) that runs the PERCEIVE→…→LEARN cycle on a heartbeat per tenant, holding state between ticks. `think(req)` becomes the *Fast Loop* that reads the resident mind's current situational model instead of recomputing it. (Directly INV-D's "continuous … in the BACKEND.")
3. **LIDA Current Situational Model as a first-class kernel object.** Stand up a persistent, decaying `SituationalModel` per tenant (extend `world-model/state-vectors.ts`) that the Slow Loop *updates* every tick and every Fast-Loop turn *reads*. This is the "waking up and reviewing overnight" buffer — the single highest-leverage organ.
4. **Soar-style mid-cycle impasse chunking.** Let the orchestrator raise an *impasse* the instant a decision cannot be made (no tool, ambiguous evaluation, repeated stall) and call `self-extension.ts` *in-loop*, not on a daily cron — then chunk the resolution into the skill-library so the identical impasse never recurs. Closes the gap between Soar's immediacy and our batch detection.
5. **ACT-R persistent activation field.** Give the situational model an ACT-R-style activation layer: every entity (a licence, a counterparty, a pit, an arrears case) carries base-level activation (recency×frequency) + spreading activation from the current concern; retrieval and *attention* are softmaxes over it. "What's salient on the estate right now" becomes a computed field, not a query.
6. **CLARION MCS as the autonomy governor + MS as the self-starter.** Elevate the metacognition modules into an explicit `MCS` that owns System-1/2 arbitration *for the resident loop* (how much deliberation this tick deserves), and add a `MotivationalSubsystem` of standing estate drives (cash-runway, licence-currency, safety, offtake-coverage) whose *unsatisfied* drives generate work with no incoming trigger. This is the formal organ behind "loops the user has no idea about."
7. **A typed Recognition-Primed prototype library.** Build a cue-indexed `SituationPrototype` store: each prototype = {cues, typical goals, expectancies, the one course of action it primes, mental-simulation checks}. ORIENT becomes a fast retrieval over prototypes (veteran reflex) with the full LATS/debate pipeline reserved for diagnose/novel cases (RPD levels 2–3). Veteran speed on the 80%, deep deliberation on the 20%.
8. **Two concurrently-running loops, one mind.** Run Fast Loop (owner-facing, sub-second, reads situational model) and Slow Loop (estate-facing, perpetual, writes situational model) as *genuinely concurrent* processes sharing memory-v2 — the MCS arbitrates compute between them. The owner experiences instant chat; the estate experiences a tireless resident MD.
9. **Sleep-time compute as a daytime dependency, not a canary.** Run consolidation/reflexion in the *idle gaps between owner turns* (not just nightly): pre-compute likely next-questions, pre-stage decisions for open loops, fold the day's events into the situational model. Promote `reflexion/sleep` from canary to a scheduled inter-turn organ the Fast Loop depends on for warm answers.
10. **Reflection as a coherence SLO.** Treat "multi-day coherence" as a measurable SLO with a degradation alarm: if reflection lags, the situational model staleness rises, and the MCS escalates consolidation priority — guaranteeing the Generative-Agents collapse can never silently happen.
11. **Overnight brief as the mind's externalised consciousness.** Each morning the situational model's top-broadcast (the GWT winner) becomes the owner's proactive brief: "here are the three things I'd be worried about as your MD." The attention bottleneck's single broadcast *is* the daily executive summary — consciousness made into product.
12. **Keep and harden Session→Governor→Executor; add an intent firewall.** Preserve the existing chat→decision→policy→executor separation; formalise it as an explicit `IntentFirewall` boundary type so the chat layer provably cannot emit a side-effecting action that skips `policy-gate`/four-eye — turning a strong implicit property into a typed, testable invariant.

---

## 6. Our gaps vs the bar (consolidated, prioritised)

1. **GAP-COG-1 (structural, highest leverage): The cognitive cycle is triggered, not resident.** `think(req)` fires per HTTP request; `agency/initiative/wake-loop.ts` is explicitly *"single-pass … callers schedule it (cron, queue worker, SaaS scheduler)."* There is no long-lived per-tenant mind that runs PERCEIVE→…→LEARN on its own heartbeat and holds state between ticks. INV-D's literal "CONTINUOUS … continue perpetually" and LIDA's continuous cycle are unmet. **Fix: leaps #2, #3, #8.**
2. **GAP-COG-2: No persistent Current Situational Model.** `world-model/state-vectors.ts` + `regime-detector.ts` compute per-call; nothing maintains a standing, decaying "state of the estate" buffer that perception updates and every turn reads. This is the LIDA/ambient-agent "overnight buffer." **Fix: leap #3 (+ #5 activation).**
3. **GAP-COG-3: ORIENT has no typed RPD prototype library.** Situation-types are implicit in personas/prompts; there is no cue-indexed schema store enabling recognition-primed (veteran-reflex) orientation, so every turn risks a blank-slate deliberation. **Fix: leap #7.**
4. **GAP-COG-4: CREATE fires on a schedule, not on impasse.** `self-extension.ts`/`stall-detector.ts` run as daily/weekly jobs; Soar chunks the moment it hits an impasse. Tool/sub-MD synthesis should be raisable mid-cycle. **Fix: leap #4.**
5. **GAP-COG-5: LEARN+REPEAT (sleep/reflexion) is a nightly canary, not a daytime dependency.** Reflexion-sleep exists but the daytime mind does not depend on inter-turn consolidation; coherence has no SLO. **Fix: leaps #9, #10.**
6. **GAP-COG-6: No motivational subsystem (standing drives).** Initiative is detector-driven; there is no CLARION-style MS of unsatisfied estate drives that *generate* work with no trigger — the formal organ behind "loops the user has not asked about." **Fix: leap #6.**
7. **GAP-COG-7: The metacognitive subsystem is strong but not governing a resident loop.** `metacognition/` + `introspection/` + `ttc-allocator` are excellent, but with no resident loop to govern, the MCS only regulates single turns. Once GAP-COG-1 is closed, wire the MCS as the cross-loop compute arbiter. **Fix: leap #6, #8.**
8. **GAP-COG-8 (low): No explicit Global-Workspace single broadcast.** The arbiter + cognitive-load do winner-selection per turn, but there is no estate-level "one most-salient concern" broadcast that the whole mind (and the morning brief) orients to. **Fix: leap #11.**
9. **Strength to preserve (anti-gap):** Session→Governor→Executor separation and the money/licence/deletion HITL rails already match the SOTA security-cognition bar; formalise as a typed invariant rather than re-architecting. **Fix: leap #12.**

**Bottom line:** Borjie's kernel is, by CoALA's own classifier, a *complete* cognitive architecture with an unusually strong metacognitive subsystem and real self-extension — ahead of most 2026 agent harnesses on stage coverage. The one thing standing between it and the world-class bar is the **trigger model**: it must graduate from a per-request/per-cron cognitive *chain* to a **resident, continuously-cycling estate-MD mind** with a persistent Current Situational Model — exactly what INV-D wrote and what LIDA, sleep-time compute, and the 2026 ambient-agent literature independently converge on.
