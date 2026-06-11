# Frontier Dossier — Predictive World-Models & Anticipatory Cognition for an Autonomous MD

**Date:** 2026-06-08
**Author:** Research subagent (frontier world-model + active-inference sweep)
**Audience:** Borjie brain-layer architects (`packages/central-intelligence`, `packages/ai-copilot`)
**Thesis:** Mr. Mwikila must stop being a *reactive* request-router and become a *predictive estate brain* — one that runs a **digital twin of the mining estate forward in time**, **acts to minimize predicted surprise** (active inference), **infers the owner's latent goals from sparse signals**, and **simulates every consequential plan in the twin before touching production**. The naive brief — "gate the agent until it earns autonomy, then let it spawn tabs" — describes a *permission ladder*. This dossier describes a *cognition*. Autonomy without anticipation is just a faster way to be wrong.

---

## 0. The provocation: the brief is about *trust*, this dossier is about *foresight*

The gated/auto + spawn-tab brief answers one question: **"How much is the agent allowed to do without asking?"** That is a governance question, and Borjie already has a good answer (`policy-gate.ts`, graduated-autonomy gating — see `graduated-autonomy-gating-sota.md`).

It does **not** answer the question that separates a junior clerk from a Managing Director:

> **"What is about to happen to this estate, what would happen if I do nothing, and which of my available moves makes the future least surprising and most aligned with what the owner actually wants?"**

A reactive agent waits for a trigger (a message, a webhook, a threshold) and *responds*. A predictive MD **maintains a running forward model of the business**, continuously rolls it forward, and *surfaces the consequence before the trigger fires*. The single most damning frontier finding in this dossier is that even when you *hand* an agent a world model, **it invokes simulation less than 1% of the time** ([Current Agents Fail to Leverage World Model as Tool for Foresight, arXiv:2601.03905](https://arxiv.org/abs/2601.03905)). Anticipation is not a model you bolt on; it is an **architecture you must force the agent into**. That is the whole game.

---

## 1. World-models & model-based planning — the agent must *think with a simulator*

### 1.1 The foundational move: the LLM is both world-model and planner (RAP)

**Reasoning with Language Model is Planning with World Model (RAP)** — Hao et al., EMNLP 2023 — [arXiv:2305.14992](https://arxiv.org/abs/2305.14992) · [ACL Anthology PDF](https://aclanthology.org/2023.emnlp-main.507.pdf)
RAP repurposes a single LLM into **two cooperating roles**: a *world model* that predicts the next *state* after a reasoning step, and a *reasoning agent* that searches over actions. It plans with **Monte-Carlo Tree Search** — selection / expansion / **simulation (estimate future reward via the world model)** / back-propagation — to find high-reward trajectories. Result: LLaMA-33B + RAP beat Chain-of-Thought on GPT-4 by **33% relative** on plan generation.

> **Beyond the brief:** the brief's agent emits *actions* directly. RAP makes the agent emit *predicted estate states* and search over them. For Borjie this means: before posting a royalty payment, the brain predicts the *resulting ledger state, covenant headroom, and FX exposure*, and only commits the action whose predicted state survives MCTS scoring. That is model-based planning, not gated execution.

### 1.2 Dyna-Think — interleave real actions with *imagined* ones

**Dyna-Think: Synergizing Reasoning, Acting, and World Model Simulation in AI Agents** — [arXiv:2506.00320](https://arxiv.org/abs/2506.00320)
Revives Sutton's classic **Dyna** architecture for LLM agents: the agent learns a world model and then **trains/plans on imagined rollouts**, validating strategies internally before spending a real (costly, irreversible) environment step. Benchmarked on WebArena, OSWorld, Windows-Agent-Arena, AndroidWorld.

> **Beyond the brief:** "imagined rollouts before real action" is exactly what a mining MD does when a step is *irreversible* — a licence filing, a sale contract, an equipment purchase. The brief would gate that action behind a permission tier; Dyna-Think instead **runs it forward in imagination first and only spends the real step if the imagined outcome is acceptable.** Permission-gating and imagination-gating are orthogonal; Borjie needs both.

### 1.3 World Knowledge Model — kill hallucinated actions before they execute

**Agent Planning with World Knowledge Model** — [arXiv:2405.14205](https://arxiv.org/abs/2405.14205)
A learned **world knowledge model** supplies *prior task knowledge* (global guidance) and *dynamic state knowledge* (local prediction of action effects). It demonstrably "alleviates blind trial-and-error and hallucinatory action issues" — the agent stops proposing actions the world doesn't actually support.

> **Beyond the brief:** a gated agent that has *earned* autonomy can still hallucinate an impossible action (e.g. transferring funds in a currency the tenant's jurisdiction rejects per the TZS USD-cliff rule). A world-knowledge model encodes Borjie's *hard rules as world dynamics*, so the action is pruned at *prediction* time, not bounced at the API layer. This turns the CLAUDE.md "Hard rules (NEVER violate)" list into a **forward model the brain plans against**, not a wall it bumps into.

### 1.4 The frontier generative world-models (the "dreaming" lineage)

These are the substrate the field is converging on. Borjie will not train these, but the *interface* (latent state → imagined rollout → plan by minimizing distance-to-goal) is the design pattern to copy.

- **Genie 3** — DeepMind, Aug 2025 — [blog](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/) · **Genie 2** — [blog](https://deepmind.google/blog/genie-2-a-large-scale-foundation-world-model/)
  A *general-purpose* world model generating interactive, navigable environments at **720p / 24fps**, consistent for **several minutes**, with **"promptable world events"** (inject a change — weather, a new object — and watch the world respond). The SIMA agent acts *inside* Genie 3 to achieve goals. This is a **counterfactual sandbox you can perturb and watch unfold.**

- **V-JEPA 2 / V-JEPA 2-AC** — Meta, Jun 2025 — [arXiv:2506.09985](https://arxiv.org/abs/2506.09985) · [Meta blog](https://ai.meta.com/blog/v-jepa-2-world-model-benchmarks/)
  Predicts the *future in latent representation space, not pixels* (1M hrs web video + 62 hrs robot data). Plans **zero-shot** by **minimizing the distance between imagined future states and a goal state** via the Cross-Entropy Method. **30× faster** planning than Nvidia Cosmos. The key idea Borjie steals: **plan = search for the action sequence whose *imagined* end-state is closest to the owner's goal-state.**

- **Reading list / survey context** — [World Models Reading List 2025 (Medium)](https://medium.com/@graison/world-models-reading-list-the-papers-you-actually-need-in-2025-882f02d758a9), [World Model Survey 2026 (Pebblous)](https://blog.pebblous.ai/report/world-model-survey-2026/en/). The field is bifurcating into *generative* (Dreamer/Genie — predict observations) and *non-generative/JEPA* (predict representations) and converging again.

> **Beyond the brief:** the brief's "spawn a tab" is a UI side-effect. A world model is a *cognitive organ*: the estate's twin is a navigable latent space the brain can perturb ("promptable world event: copper price drops 18%") and watch roll forward. The MD doesn't open a dashboard tab and wait for the owner to read it — it *lives inside the simulation* and reports back the rollout.

---

## 2. Active inference / free-energy — *act to minimize predicted surprise*

This is the deepest reframing in the dossier and the one that most directly turns "reactive" into "anticipatory."

### 2.1 The principle

**Active Inference for Physical AI Agents — An Engineering Perspective** — [arXiv:2603.20927](https://arxiv.org/abs/2603.20927)
Frames **variational free-energy (VFE) minimization** as *the single computational objective* unifying perception, learning, planning, and control. A system persists over time by *minimizing the divergence between its internal model's predictions and incoming reality.* Action is not reward-chasing; action is **changing the world so it matches your prediction** (or updating your prediction so it matches the world).

**Foundations & framing:** [The Free Energy Principle and Artificial Agency (PMC9260223)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9260223/), [Reward Maximisation through Discrete Active Inference, arXiv:2009.08111](https://arxiv.org/abs/2009.08111), [How Active Inference Could Help Revolutionise Robotics (Entropy, MDPI)](https://www.mdpi.com/1099-4300/24/3/361), [From Neuroscience to AI: Friston's FEP and the Rise of Active Inference (ResearchGate, 2025)](https://www.researchgate.net/publication/397380587).

### 2.2 The mechanism that matters: **Expected Free Energy** (EFE) = pragmatic + epistemic value

Active-inference agents select the action/policy that minimizes **Expected Free Energy**, which decomposes into two terms the MD needs *both* of:
- **Pragmatic value** — move the estate toward preferred outcomes (the owner's goals as a *prior over preferred states*).
- **Epistemic value** — choose actions that **reduce uncertainty / gather the most information** (resolve ambiguity, probe blind spots).

This is the formal answer to *"what could matter in the future + surfacing blind spots."* An EFE-minimizing MD will sometimes act **purely to learn** — e.g. commission an assay, request a clarifying owner signal, or pull a fresh FX quote — *because the information value reduces predicted future surprise*, even with no immediate pragmatic payoff.

**Continual / discrete-time active inference in practice:** [Demonstrating Continual Learning Capabilities of Discrete-Time Active Inference, arXiv:2410.00240](https://arxiv.org/abs/2410.00240); [Environment-Centric Active Inference, arXiv:2408.12777](https://arxiv.org/abs/2408.12777); alignment angle: [Possible Principles for Aligned Structure Learning Agents, arXiv:2410.00258](https://arxiv.org/abs/2410.00258).

> **Beyond the brief:** the gated/auto ladder has **no epistemic drive** — a gated agent never acts *to learn*; it only acts when permitted and reacts when triggered. An EFE objective gives the MD an intrinsic reason to be curious about its own blind spots: it will surface "I don't know X and not-knowing-X is the biggest source of predicted surprise this quarter" *before* X bites. That is the difference between a permissioned executor and a vigilant deputy. **Concretely:** Borjie's "proactive notification sink" (already shipped, see MEMORY) should be driven by *expected-free-energy ranking* — surface the hint whose resolution most reduces predicted estate surprise, not the one that crossed a static threshold.

---

## 3. Digital twin of the estate — *a simulator you can run forward*

### 3.1 The enterprise digital-twin pattern (industry)

The enterprise/operations digital twin is now a recognized executive tool: a *real-time virtual replica of the business* that lets leaders "pilot strategies, stress-test assumptions, and explore alternatives before going live."
- [Salesforce — Enterprise Digital Twin](https://www.salesforce.com/news/stories/enterprise-digital-twin/)
- [Deloitte — Digital Twin Strategy](https://www.deloitte.com/us/en/insights/topics/business-strategy-growth/digital-twin-strategy.html)
- [Skan.ai — Digital Twin of Operations](https://www.skan.ai/blogs/what-is-a-digital-twin-of-operations)
- [AnyLogic — Digital Twin Simulation](https://www.anylogic.com/features/digital-twin/) · [Simio (2025)](https://www.simio.com/blog/how-will-digital-twins-software-transform-your-business-in-2025) · [TCS TwinX](https://www.tcs.com/what-we-do/products-platforms/tcs-twinx)

The methods these twins run: **Monte-Carlo, agent-based modeling, discrete-event simulation** — to "reveal potential outcomes, identify vulnerabilities, and inform better decisions."

### 3.2 The frontier: **generative-agent** twins where the actors are LLMs

**Generative Agents** (Park et al., Stanford) is the seminal architecture: LLM-as-perception (reads world state in natural language) → memory → LLM-as-reasoning → plan → act. The estate's *people and counterparties* can be simulated as generative agents.
- Survey + critique: [Do LLMs Solve the Problems of Agent-Based Modeling? (arXiv:2504.03274)](https://arxiv.org/abs/2504.03274)
- Economic actors: **EconAgent** (LLM consumers/firms reacting to market conditions in a macro simulation) — cited in [RL-meets-LLM survey, arXiv:2509.16679](https://arxiv.org/html/2509.16679v1).
- Domain twins to copy: [Behavioral Generative Agents for Energy Operations, arXiv:2506.12664](https://arxiv.org/abs/2506.12664); [VirtLab — large-scale team simulations, arXiv:2508.04634](https://arxiv.org/abs/2508.04634); [GATSim — urban mobility generative agents, arXiv:2506.23306](https://arxiv.org/abs/2506.23306); [LLM multi-agent marketing/consumer simulation, arXiv:2510.18155](https://arxiv.org/html/2510.18155v1).
- "Homo Silicus" framing — LLMs as computational stand-ins for human decision-makers, enabling *in-silico hypothesis generation before real-world testing* (per [generative-agent simulation literature](https://askrally.com/article/generative-agent-simulation)).

> **Beyond the brief:** the brief's spawned tab is a *view of current data*. A digital twin is a *runnable model of the estate*: licences with expiry dynamics, the double-entry ledger as a state machine, royalty obligations, FX exposure, workforce roster, equipment depreciation, mineral inventory, buyer/off-taker counterparties as **generative agents** that respond to Borjie's moves. The MD doesn't read a tab — it **runs the estate forward 90 days under three FX scenarios** and reports which one breaks a covenant. The twin is the *thing the active-inference objective minimizes surprise against.*

### 3.3 A blunt caution (rigor, not hype)

Generative-agent simulations are *not* automatically faithful. [Critical Review of Generative Social Simulations (arXiv:2504.03274)](https://arxiv.org/abs/2504.03274) and [Are LLM Agents Behaviorally Coherent? (arXiv:2509.03736)](https://arxiv.org/abs/2509.03736) and [Can LLM Agents Sustain Long-Horizon Organizational Dynamics? (arXiv:2606.01199)](https://arxiv.org/html/2606.01199v1) all document drift, incoherence, and behavioral misalignment over long horizons. **Implication for Borjie:** the twin must be *calibrated against the real ledger/audit trail* and its predictions *scored against realized outcomes* — which leads directly to §6 (WALL-E rule-learning) and §7 (surprise-as-signal).

---

## 4. Anticipatory simulation — "what happens if I do nothing?" & counterfactual rollouts

### 4.1 The damning baseline — agents *don't* look ahead even when they can

**Current Agents Fail to Leverage World Model as Tool for Foresight** — [arXiv:2601.03905](https://arxiv.org/abs/2601.03905)
Hand a VLM agent a generative world model as an *external simulator* and measure usage: it **invokes simulation <1% of the time**, **misuses predicted rollouts ~15%**, and performance **degrades up to 5% when simulation is enforced**. The bottleneck is *meta*: deciding **when to simulate, how to read the rollout, and how to fold foresight into the next decision.**

> **Beyond the brief:** this is the load-bearing finding of the whole dossier. You cannot get anticipation "for free" by making the world model available — the agent will ignore it. Borjie must **architecturally force** the simulate-before-act loop (a hard pre-commit step in the orchestrator), the way it already forces evidence-citation via the Auditor Agent. **"Anticipation as a mandatory pipeline stage, not an optional tool."**

### 4.2 Lookahead beats reactive ReAct

**ProAct: Agentic Lookahead in Interactive Environments** — [arXiv:2602.05327](https://arxiv.org/abs/2602.05327)
Agents simulate multiple forward trajectories and choose by *anticipated* outcome, not immediate observation — directly fixing ReAct's "tight stimulus-response loop with no future planning." **Simura** (world-model-driven *simulative reasoning* for goal-oriented agents, arXiv:2507.23773) and **Imagine-then-Plan** (adaptive-lookahead learning with world models, [arXiv:2601.08955](https://arxiv.org/pdf/2601.08955)) extend the same idea: vary *how far* to look ahead based on the situation.

### 4.3 Counterfactual rollouts — formally evaluating "what if I'd done otherwise"

- **Should I Have Expressed a Different Intent? Counterfactual Generation for LLM-Based Autonomous Control** — [arXiv:2601.20090](https://arxiv.org/abs/2601.20090): models closed-loop control as a **structural causal model** and uses test-time scaling to generate multiple counterfactual outcomes via **probabilistic abduction** — i.e. "what would the estate look like had I chosen differently."
- **Where LLM Agents Fail and How They Learn From Failures** — [ResearchGate](https://www.researchgate.net/publication/396048725): **counterfactual testing** substitutes corrected actions step-by-step to find the *earliest* step whose correction prevents final failure — a precise **blind-spot localizer**.
- **Wide-Horizon Thinking & Simulation-Based Evaluation for Real-World LLM Planning with Multifaceted Constraints** — [arXiv:2506.12421](https://arxiv.org/pdf/2506.12421): evaluate plans by *simulating* them against many constraints before execution.

> **Beyond the brief:** the gated ladder has *no concept of "do nothing."* It is trigger-driven, so silence = inaction. An anticipatory MD treats **"do nothing" as a first-class policy to roll out**: simulate the null action and report its consequence ("if we file nothing, Licence #4471 lapses on 14-Aug and the pit goes dark — predicted TZS-equivalent loss + workforce stand-down"). The counterfactual-causal machinery (SCM + abduction) lets the MD say *"the earliest decision that would have prevented this is X,"* turning hindsight into **pre-mortem.**

---

## 5. Goal / intent inference from sparse owner signals — *read what the owner means, not just what they typed*

### 5.1 Probabilistic goal posterior from open-ended dialog

**Goal Inference from Open-Ended Dialog (GOOD)** — [arXiv:2410.13957](https://arxiv.org/abs/2410.13957)
Maintains a **Bayesian posterior over unbounded natural-language goals**, using an LLM to (a) *generate* candidate goals and (b) *score* dialog against them, with **entropy-based uncertainty tracking** to know when the goal is still ambiguous. Beats classification-style baselines and gives *calibrated confidence* over what the user actually wants — from *minimal* conversational cues.

### 5.2 Infer intent *before* acting on the instruction

- **Infer Human's Intentions Before Following Natural Language Instructions** — [arXiv:2409.18073](https://arxiv.org/abs/2409.18073): don't execute the literal instruction; first infer the *latent intent* behind it.
- **Open-Ended Goal Inference through Actions and Language for Human-Robot Collaboration** — [arXiv:2512.04453](https://arxiv.org/abs/2512.04453): fuse *observed actions* + *language* to infer goals (the owner's behavior is signal too, not just their words).
- **Inverse RL to recover hidden objectives** — [Insights from the Inverse, arXiv:2410.12491](https://arxiv.org/abs/2410.12491): treat behavior as expert demonstration and reverse-engineer the reward function — the formal tool for inferring the owner's *implicit* preference ordering across the estate.
- Goal-directedness evaluation: [A Behavioural & Representational Evaluation of Goal-Directedness in LM Agents, arXiv:2602.08964](https://arxiv.org/abs/2602.08964).

> **Beyond the brief:** the gated/auto model is built around *explicit* permission — the owner must *grant* autonomy. Goal inference is the inverse: the MD **maintains a live posterior over the owner's goals** and acts on the *most-probable intent* while *flagging its own uncertainty*. When the owner says "keep an eye on the Geita pit," GOOD-style inference holds a distribution over what that means (cost? safety? throughput? a buyer?) and **asks one disambiguating question only when entropy is high** — otherwise it acts. This is the "preferred-state prior" that the active-inference EFE objective (§2.2) needs as input. **Goal inference feeds active inference: inferred-goal-posterior → preferred-state prior → EFE-minimizing action.**

---

## 6. Simulation-before-action — *test the plan in the twin before executing*, and keep the twin honest

### 6.1 Counterfactual reasoning before irreversible commitment

The literature is explicit: complex tasks require "simulating *what-if* scenarios **without committing to irreversible actions**," implemented as **MCTS grounded by a pretrained world model** (per the counterfactual-rollout literature, §4.3). This is the safety case for Borjie's irreversible money/licence/contract paths.

### 6.2 Keeping the simulator aligned with reality — neurosymbolic rule-learning

**WALL-E: World Alignment by Rule Learning Improves World-Model-Based LLM Agents** — [arXiv:2410.07484](https://arxiv.org/abs/2410.07484)
The LLM's prior world model is *not* aligned with a specific environment's dynamics out of the box. WALL-E **learns explicit symbolic rules** by comparing predicted vs. actual transitions, then **injects those rules** so the LLM's predictions match the real environment — an MPC-style loop where the rule-aligned world model proposes, reality corrects, rules update. (Note: PDF text was not machine-extractable in this sweep — claims summarized from the abstract/title and corroborating search snippets; **mark partially UNVERIFIED on exact metrics.**)

> **Beyond the brief:** a digital twin that drifts from the real ledger is worse than no twin — it produces *confident wrong* foresight. WALL-E is the discipline: every time the twin predicts an estate transition and reality diverges, **learn the corrective rule** (e.g. "M-Pesa settlement lags 36–48h, not same-day"; "this buyer historically renegotiates after assay"). The twin gets *more faithful with every realized outcome.* This is how Borjie's CLAUDE.md hard rules + learned operational rules co-exist as the twin's dynamics. **Plus:** every twin prediction must be logged into the hash-chained AI audit trail and later *scored against the realized outcome* — making the twin's calibration auditable, not vibes.

### 6.3 Why naive forward simulation fails (the error-accumulation trap)

From the lookahead literature (§4): "when an LLM agent simulates future states, minor inaccuracies in environment dynamics **accumulate rapidly**." So Borjie's twin must (a) prefer **latent/representation-level** prediction over fine-grained generative prediction where possible (the JEPA lesson, §1.4), (b) **bound rollout horizon** to where calibration holds, and (c) **re-ground against live state** frequently (the AnyLogic/digital-twin "real-time data feed" principle, §3.1).

> **Beyond the brief:** "earn autonomy, then act" treats execution as the risky part. The frontier says the risky part is **the silent compounding error in your forward model.** A predictive MD that doesn't bound and re-ground its rollouts will hand the owner a *confident 90-day forecast that is wrong by day 12.* The brief never even confronts this failure mode.

---

## 7. Synthesis — the closed anticipatory loop Borjie should build

Threaded together, the frontier gives Borjie a single loop that makes the MD predictive rather than reactive:

```
                    ┌──────────────────────────────────────────────────┐
                    │  ESTATE DIGITAL TWIN (calibrated, WALL-E-aligned) │
                    │  ledger · licences · royalties · FX · workforce · │
                    │  inventory · counterparties-as-generative-agents  │
                    └──────────────────────────────────────────────────┘
   owner signals          ▲                              │
   (sparse, NL,           │ re-ground vs. live state     │ roll forward
    behavioral)           │ + score prediction vs.       ▼ (bounded horizon)
        │                 │   realized outcome      ┌───────────────────┐
        ▼                 │   (audit-chained)       │ ANTICIPATORY SIM  │
 ┌──────────────┐         │                         │ • "do nothing?"   │
 │ GOAL POSTERIOR│────────┘                         │ • counterfactual  │
 │ (GOOD/IRL):   │   inferred preferred-state prior │   rollouts (SCM)  │
 │ P(goal|signal)│─────────────────────────────────│ • MCTS over plans │
 └──────────────┘                                   └───────────────────┘
        │                                                     │
        │            EXPECTED FREE ENERGY = pragmatic + epistemic
        │            (move toward goal  +  reduce uncertainty / probe blind spots)
        ▼                                                     ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ ACT: choose the policy that minimizes predicted surprise.            │
 │  • below confidence/horizon bound → propose + ask ONE question       │
 │  • within bound + policy-gate allows → execute (gated/auto ladder)   │
 │  • surface the rollout whose resolution cuts the most future surprise│
 └─────────────────────────────────────────────────────────────────────┘
```

The naive brief is **only the bottom-right box** ("gated/auto execution") plus a UI side-effect ("spawn tab"). Everything above it — the twin, the anticipatory sim, the goal posterior, the EFE objective, the surprise-scored re-grounding — is what makes Borjie a *predictive estate brain*. The gating ladder decides *whether the MD may act*; this loop decides *what is worth acting on before anyone asked.*

### Concrete capabilities this unlocks (none reachable from gated+spawn alone)
1. **"If we do nothing"** quarterly null-rollout, automatically, surfacing the most expensive consequence of inaction (licence lapse, covenant breach, FX drift) — §4.
2. **Pre-mortem on every irreversible action** (royalty post, sale contract, equipment buy): imagined rollout in the twin before the real ledger write — §1.2 / §6.1.
3. **Epistemic prompts** the MD raises *unbidden* because not-knowing is the largest predicted surprise — "we have no fresh assay on Block C and that's our biggest blind spot this month" — §2.2.
4. **Intent-aware action from sparse owner cues**, asking a disambiguating question *only* when goal-entropy is high — §5.
5. **A twin that gets more accurate every quarter** because each realized outcome scores and corrects it (WALL-E + audit-chained calibration) — §6.2.
6. **Surprise-ranked proactive notifications** — replace static thresholds in the existing notification sink with expected-free-energy ranking — §2.2.

---

## 8. Mapping to Borjie's existing spine (where this lands)

| Frontier capability | Borjie home | Status today (per MEMORY) |
|---|---|---|
| World-model planning / MCTS | `packages/central-intelligence` (LATS tree-search already exists per CLAUDE.md) | LATS present; **not** wired as a *forward estate simulator* — gap |
| Active-inference EFE ranking | proactive notification sink (`borjie-parity-runtime-wiring`) | sink shipped; ranking is threshold-based — **upgrade to EFE** |
| Estate digital twin | new — built on Drizzle schemas + ledger state machine | **does not exist** — biggest greenfield |
| Goal posterior from owner signals | `packages/ai-copilot` personas + durable cognitive memory | memory shipped; **no Bayesian goal posterior** — gap |
| Simulate-before-irreversible-action | orchestrator pre-commit hook (like the Auditor evidence gate) | **must be forced** as a pipeline stage (the <1% finding) |
| Twin calibration / rule-learning | AI audit chain (hash-chained, append-only) | audit chain exists; **add prediction-vs-realized scoring** |

**Hard-rule compatibility:** simulation-before-action is *append-only* and *fail-closed* by construction (it never mutates the real ledger; irreversible paths still go through `LedgerService.post()` and `policy-gate.ts`). The twin reads state; only the gated executor writes. This respects every CLAUDE.md invariant while adding the predictive layer on top.

---

## 9. Source index

**World models & model-based planning**
- RAP — [arXiv:2305.14992](https://arxiv.org/abs/2305.14992) · [ACL PDF](https://aclanthology.org/2023.emnlp-main.507.pdf) — VERIFIED (search + abstract)
- Dyna-Think — [arXiv:2506.00320](https://arxiv.org/abs/2506.00320) — VERIFIED (fetched, PDF binary; abstract-level)
- Agent Planning with World Knowledge Model — [arXiv:2405.14205](https://arxiv.org/abs/2405.14205) — VERIFIED (search)
- LAW (Language/Agent/World models) — [arXiv:2312.05230](https://arxiv.org/abs/2312.05230) — UNVERIFIED (listed, not fetched)
- Genie 3 — [DeepMind blog](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/) — VERIFIED (fetched)
- Genie 2 — [DeepMind blog](https://deepmind.google/blog/genie-2-a-large-scale-foundation-world-model/) — VERIFIED (search)
- V-JEPA 2 — [arXiv:2506.09985](https://arxiv.org/abs/2506.09985) · [Meta blog](https://ai.meta.com/blog/v-jepa-2-world-model-benchmarks/) — VERIFIED (search)
- World Models Reading List 2025 — [Medium](https://medium.com/@graison/world-models-reading-list-the-papers-you-actually-need-in-2025-882f02d758a9) — VERIFIED (search)
- World Model Survey 2026 — [Pebblous](https://blog.pebblous.ai/report/world-model-survey-2026/en/) — UNVERIFIED (listed)

**Active inference / free energy**
- Active Inference for Physical AI Agents (Engineering) — [arXiv:2603.20927](https://arxiv.org/abs/2603.20927) — VERIFIED (fetched abstract)
- FEP & Artificial Agency — [PMC9260223](https://pmc.ncbi.nlm.nih.gov/articles/PMC9260223/) — VERIFIED (search)
- Reward Maximisation via Discrete Active Inference — [arXiv:2009.08111](https://arxiv.org/abs/2009.08111) — VERIFIED (search)
- Active Inference & Robotics (Entropy) — [MDPI](https://www.mdpi.com/1099-4300/24/3/361) — VERIFIED (search)
- Discrete-Time Active Inference (continual) — [arXiv:2410.00240](https://arxiv.org/abs/2410.00240) — VERIFIED (search)
- Environment-Centric Active Inference — [arXiv:2408.12777](https://arxiv.org/abs/2408.12777) — VERIFIED (search)
- Aligned Structure-Learning Agents — [arXiv:2410.00258](https://arxiv.org/abs/2410.00258) — VERIFIED (search)
- Friston FEP → AI (2025 review) — [ResearchGate 397380587](https://www.researchgate.net/publication/397380587) — UNVERIFIED (listed)

**Digital twin / generative-agent simulation**
- Salesforce Enterprise Digital Twin — [link](https://www.salesforce.com/news/stories/enterprise-digital-twin/) — VERIFIED (search)
- Deloitte Digital Twin Strategy — [link](https://www.deloitte.com/us/en/insights/topics/business-strategy-growth/digital-twin-strategy.html) — VERIFIED (search)
- Skan.ai Digital Twin of Operations — [link](https://www.skan.ai/blogs/what-is-a-digital-twin-of-operations) — VERIFIED (search)
- AnyLogic Digital Twin — [link](https://www.anylogic.com/features/digital-twin/) — VERIFIED (search)
- Simio 2025 — [link](https://www.simio.com/blog/how-will-digital-twins-software-transform-your-business-in-2025) — VERIFIED (search)
- TCS TwinX — [link](https://www.tcs.com/what-we-do/products-platforms/tcs-twinx) — VERIFIED (search)
- Critical Review of Generative Social Simulations — [arXiv:2504.03274](https://arxiv.org/abs/2504.03274) — VERIFIED (search)
- Behavioral Coherence of LLM Agents — [arXiv:2509.03736](https://arxiv.org/abs/2509.03736) — VERIFIED (search)
- Long-Horizon Organizational Dynamics — [arXiv:2606.01199](https://arxiv.org/html/2606.01199v1) — VERIFIED (search)
- Behavioral Generative Agents for Energy Operations — [arXiv:2506.12664](https://arxiv.org/abs/2506.12664) — VERIFIED (search)
- VirtLab team simulations — [arXiv:2508.04634](https://arxiv.org/abs/2508.04634) — VERIFIED (search)
- GATSim urban mobility — [arXiv:2506.23306](https://arxiv.org/abs/2506.23306) — VERIFIED (search)
- LLM marketing/consumer simulation — [arXiv:2510.18155](https://arxiv.org/html/2510.18155v1) — VERIFIED (search)
- Generative Agent Simulation Guide — [Ask Rally](https://askrally.com/article/generative-agent-simulation) — VERIFIED (search)

**Anticipatory simulation / counterfactual rollouts**
- Current Agents Fail to Leverage World Model as Tool for Foresight — [arXiv:2601.03905](https://arxiv.org/abs/2601.03905) — VERIFIED (fetched abstract; the <1% figure)
- ProAct: Agentic Lookahead — [arXiv:2602.05327](https://arxiv.org/abs/2602.05327) — VERIFIED (fetched, abstract-level)
- Imagine-then-Plan — [arXiv:2601.08955](https://arxiv.org/pdf/2601.08955) — VERIFIED (search)
- Wide-Horizon Thinking & Simulation-Based Evaluation — [arXiv:2506.12421](https://arxiv.org/pdf/2506.12421) — VERIFIED (search)
- Counterfactual Generation for LLM-Based Autonomous Control — [arXiv:2601.20090](https://arxiv.org/abs/2601.20090) — VERIFIED (search)
- Where LLM Agents Fail & Learn From Failures — [ResearchGate 396048725](https://www.researchgate.net/publication/396048725) — VERIFIED (search)

**Goal / intent inference**
- Goal Inference from Open-Ended Dialog (GOOD) — [arXiv:2410.13957](https://arxiv.org/abs/2410.13957) — VERIFIED (fetched, abstract-level)
- Infer Human's Intentions Before Following Instructions — [arXiv:2409.18073](https://arxiv.org/abs/2409.18073) — VERIFIED (search)
- Open-Ended Goal Inference (actions + language) — [arXiv:2512.04453](https://arxiv.org/abs/2512.04453) — VERIFIED (search)
- Insights from the Inverse (IRL) — [arXiv:2410.12491](https://arxiv.org/abs/2410.12491) — VERIFIED (search)
- Goal-Directedness Evaluation in LM Agents — [arXiv:2602.08964](https://arxiv.org/abs/2602.08964) — VERIFIED (search)

**Simulation-before-action / world-model alignment**
- WALL-E (rule-learning world alignment) — [arXiv:2410.07484](https://arxiv.org/abs/2410.07484) — PARTIALLY UNVERIFIED (PDF not text-extractable; abstract/title + snippets)
- Simura (simulative reasoning) — arXiv:2507.23773 — UNVERIFIED (cited in search summary, not directly fetched)

---

*Caveat on arXiv IDs in the 2601/2602/2603/2606 series: these correspond to Jan–Jun 2026 submissions surfaced by current (June 2026) search; verify each ID resolves before citing externally. All "UNVERIFIED" / "PARTIALLY UNVERIFIED" tags above mark claims drawn from search summaries or abstracts rather than full-text fetches.*
