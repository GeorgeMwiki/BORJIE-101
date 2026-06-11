# SOTA: Management Cybernetics & Veteran Reasoning — the STRUCTURE behind Mr. Mwikila

**The control-theory + naturalistic-decision blueprint that makes the MD reason like a
veteran running an estate, not a chatbot that thinks-from-scratch every turn.**

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** Research subagent (web-grounded; every claim resolves to a fetched/searched URL)
**Audience:** Borjie brain-layer engineers wiring Mr. Mwikila's cognitive kernel; the same
kernel powers BossNyumba (real-estate-deep) — only the domain layer differs.
**Lane:** `management-cybernetics-veteran-reasoning`
**Anchor invariant:** INV-D (`Docs/research/MASTER_GAP_REGISTER.md`) — the MD runs a
CONTINUOUS, STRUCTURED cognitive cycle in the BACKEND
(PERCEIVE → ORIENT → ORGANIZE → CREATE → EXECUTE-TO-CLOSURE → LEARN+REPEAT), GENERAL
across any situation, never hardcoded. The user only CHATS the persona as if a real
veteran MD sits behind a laptop. Rails: money/licence/deletion stay HITL.

> **Citation discipline.** Every factual claim carries a `[Sn]` key resolving to a URL in
> the Sources table. `fetched` = retrieved in full with WebFetch; `search` = WebSearch
> result snippet. Anything not grounded is labelled **UNVERIFIED**. Nothing is invented.

---

## 0. One-paragraph thesis

A chatbot answers a turn. A *veteran MD* runs a **standing control system** over the
estate: senses always on, a stable identity and mandate at the top, an intelligence
function modelling the future, a control function allocating today's resources,
operations doing the work, and a fast pain/pleasure alarm line that jumps levels when
something breaks. Three bodies of classical theory already encode exactly this structure
and have been doing so for 50+ years: **Stafford Beer's Viable System Model (VSM)** gives
the *organ chart of any self-managing system* (Systems 1–5 + algedonic channel + recursion)
`[S1][S7][S8]`; **IBM's MAPE-K** gives the *autonomic control loop* (Monitor → Analyze →
Plan → Execute over shared Knowledge) that is the engineering-grade restatement of the
same idea `[S2]`; and **Klein's Recognition-Primed Decision model (RPD)** + **Boyd's OODA**
explain *how a veteran actually decides* — not by enumerating options but by recognising
a situation-type and mentally simulating one good action, with **Orientation** as the
pivot `[S3][S5][S11]`. The deepest law under all of it is **Ashby's Law of Requisite
Variety**: a regulator must command at least as much variety as the system it regulates
(`V(controller) ≥ V(disturbance)`) `[S6]`. Mr. Mwikila's kernel should be *explicitly*
architected as a VSM whose loop is MAPE-K and whose decision style is RPD/OODA — and,
the beyond-today leap, **recursive**: every sub-MD and junior is itself a viable mini-MD
running the same loop one level down. INV-D is already this cycle; this dossier shows the
classical spine that makes it rigorous, names where our code already implements each
organ, and lists the gaps.

---

## 1. Stafford Beer's Viable System Model — the organ chart of self-management

Beer introduced the VSM in *Brain of the Firm* (1972), building on second-order
cybernetics (von Foerster) and Ashby's Law `[S1]`. A **viable system** is any system
organised to survive in a changing environment; Beer's claim is that *every* viable system
— a cell, a person, a firm, a state — necessarily contains the same five interacting
subsystems `[S7]`. The five:

| VSM | Beer's name | Function (sourced) | Time-horizon |
|---|---|---|---|
| **System 1** | Operations / Primary activities | "Day-to-day activities conducted by constituent parts interacting with the environment — the *doing* parts" `[S1]` | Now |
| **System 2** | Coordination | "Co-ordinating functions that align the day-to-day activities of System 1 with each other" — anti-oscillation, conflict-damping `[S1]` | Now |
| **System 3** | Control | "Structures put in place by senior leadership to dictate rules, rights, resources and responsibilities within System 1" — the *inside-and-now* `[S1]`. **System 3\*** audits past performance directly `[S7]` | Today / this period |
| **System 4** | Intelligence | "Looks externally at the environment, establishes which factors may impact operations and how it must adapt to remain viable" — models possible futures `[S1]` | Future / outside |
| **System 5** | Policy / Identity | "Defines the identity and ethos of the organization — its characteristics and purpose — by monitoring System 3 and System 4" `[S1]` | Always |

Three structural ideas matter more than the boxes:

1. **The 3–4 homeostat.** S3 (today's reality, inside) and S4 (tomorrow's possibility,
   outside) are in permanent tension; S5 *only* intervenes when that balance breaks.
   "If the 3-4 homeostat is working well, there may be little for System 5 to do" `[S7]`.
   This is the single most important governance pattern: **the boss should be mostly
   quiet.** A well-built MD resolves most things in the S3↔S4 loop and escalates to the
   owner (S5) only on genuine balance-breaks.

2. **The algedonic channel.** "Algedonic alerts (Greek *algos* pain, *hedos* pleasure)
   are alarms and rewards that escalate through the levels of recursion when actual
   performance fails or exceeds capability, typically after a timeout. The algedonic
   channel is about what's happening NOW" `[S7]`. It *bypasses* the normal reporting
   hierarchy — a pain signal jumps straight from a System 1 unit to System 5. This is the
   cybernetic name for "wake the owner up at 2am because a licence is about to lapse."

3. **Recursion + variety.** "Every viable system contains viable systems, all the way
   down; each System 1 entity contains a complete VSM at the next level of recursion down"
   `[S7]`. And requisite variety must hold at *every* level: each unit must "amplify their
   own variety when necessary, and attenuate any input" `[S7]`. **Attenuators** compress
   environmental variety up the chain (dashboards, summaries); **amplifiers** expand
   management variety down the chain (policies, tools, delegation).

Critically, the modern frontier has already mapped VSM onto LLM multi-agent systems.
Gorelkin's 2026 piece maps S1→specialized task agents, S2→lateral peer-coordination,
S3→resource-orchestration/optimization agents, S4→scenario-modelling + anomaly-detection
agents, S5→alignment + policy-constraint agents, and explicitly recommends the recursive
"fractal architecture that scales naturally" plus a **tiered-intelligence cost strategy**:
frontier models for S4/S5 strategic reasoning, cheap local models for S1–S3 routine ops
`[S8]`. We already do model-tiering (`kernel/model-tiering.ts`); VSM tells us *which
tier maps to which cognitive organ.*

---

## 2. MAPE-K — the autonomic control loop (engineering restatement of VSM)

IBM (Kephart & Chess, 2003; IBM autonomic-computing blueprint, 2006) gave the
self-managing system its canonical control loop `[S2]`:

- **Monitor** — collect state via sensors (the current state of the managed element)
- **Analyze** — search the data for *symptoms* (gap between current and desired behaviour)
- **Plan** — decide whether/how to adapt to meet goals
- **Execute** — carry out the adaptation via actuators/effectors
- **Knowledge** — a shared repository all four phases read/write `[S2]`

The four self-* properties it targets — **self-configuration, self-optimization,
self-protection, self-healing** `[S2]` — are exactly the autonomy goals INV-D wants for
the estate. MAPE-K is the *operational* loop; VSM is the *organisational* structure. They
compose cleanly:

```
                    ┌──────────  System 5 (identity / mandate / policy)  ──────────┐
                    │                     (rarely intervenes)                       │
   FEEDFORWARD ───► System 4 (Analyze-future: forecasting, regime, scenarios)      │
                    │            ↕  3–4 homeostat  (most decisions resolve here)    │
   FEEDBACK   ────► System 3 (Plan + control: allocate, gate, autonomy policy)     │
                    │            System 3*  (Analyze-past: audit)                    │
                    │            System 2  (Coordinate: dispatch, de-conflict)       │
                    │            System 1  (Execute: juniors + sub-MDs)              │
                    └──────────  algedonic line: pain/pleasure jumps to S5  ─────────┘
       Monitor (always-on senses) feeds every level · Knowledge = memory-v2 + corpus + KG
```

The control-theory texture matters: effective control combines **feedforward** (act on a
disturbance *before* it hits the system — anticipatory) + **feedback** (correct on
measured deviation) + **buffering** `[S6 control]`. **System 4 is the feedforward
controller** (forecasting prevents the deviation); **System 3 is the feedback controller**
(corrects measured variance). Most agent stacks only do feedback (react to what already
broke). A veteran MD's edge is feedforward — INV-D's "identify loops/needs the user has
NOT asked about, before anyone asks" is literally feedforward cybernetic control.

---

## 3. How a veteran actually DECIDES — RPD, OODA, NDM, BDI

INV-D demands "recognition-primed, like a veteran; not a blank-slate think every turn."
This is a precise, named cognitive science, not a metaphor.

### 3.1 Recognition-Primed Decision (Klein) — the core of ORIENT

Klein, Calderwood & Clinton-Cirocco (late 1980s; *Sources of Power*, 1999) studied
firefighters, paramedics, nuclear techs — experts deciding under time pressure `[S3][S9]`.
The finding that overturned classical decision theory: **experts do NOT generate and
compare multiple options. They recognise the situation-type and act on the first workable
option, validated by mental simulation** `[S3]`. RPD has three variations `[S3]`:

1. **Simple match** — recognise the situation, the typical action comes with it; act.
2. **Diagnose** — situation is unfamiliar; spend time to classify it (feature-matching,
   story-building) until it maps to a known type.
3. **Evaluate a single course of action** — mentally *simulate* the first option;
   if the simulation surfaces problems, tweak it or move to the next typical option —
   *serially*, never in parallel-compare.

The implication for the kernel is sharp: **the expensive multi-option search (LATS /
Tree-of-Thoughts) is the EXCEPTION, not the rule.** A veteran reaches for tree-search only
when recognition fails (RPD variation 2/3). Today's frontier confirms the split: ToolTree
and LATS frame deliberate tool-planning as MCTS/tree-search guided by pre/post rewards
`[S12][S13]` — powerful but 4×–15× the tokens. The veteran move is **recognition-first,
search-on-failure**: retrieve the matching schema/playbook, simulate it, and only escalate
to LATS when no schema matches or the simulation fails. We have LATS
(`orchestrator/lats-search.ts`); we lack the *recognition gate in front of it.*

### 3.2 OODA (Boyd) — Orientation is the schwerpunkt

Boyd's OODA (Observe-Orient-Decide-Act) is widely flattened into four sequential steps;
Boyd's real model is richer `[S5][S14]`. **Orientation is the schwerpunkt (focal point)
of the entire loop — every feedback loop flows through it** `[S5]`. Orientation is shaped
by cultural traditions, genetic heritage, previous experience, and new information; it is
where raw observation becomes *meaning* `[S14]`. Two consequences:

- **Implicit Guidance & Control (IG&C):** in a *familiar* situation the operator skips the
  explicit Decide step entirely — orientation flows straight to action `[S5][S14]`. This
  is RPD's "simple match" in control-loop clothing. The kernel's `fast-path-router.ts` is
  exactly this: recognised → act without the full deliberation pipeline.
- **Getting inside the opponent's loop / tempo:** advantage comes from cycling faster than
  the adversary `[S14]`. For an estate the "adversary" is the rate of change of the world
  (a regulator deadline, a price move, an equipment failure). The MD must close loops
  *faster than the estate's problems compound* — which is the cybernetic argument for an
  always-on backend rather than turn-by-turn chat.

### 3.3 Naturalistic Decision Making (NDM) — the field, not just the model

RPD lives inside NDM: "the study of how people make decisions in demanding, high-pressure
situations" `[S3]`. The estate is an NDM environment — ill-structured, dynamic, high-stakes,
time-pressured, with shifting goals. NDM's lesson for us: **optimise for good-enough
fast decisions validated by simulation, not provably-optimal slow ones.** The sub-MD
README already internalises this ("optimise for single-step task-quality, never for
unbounded multi-step autonomy" — a 10-step 85%-reliable chain → ~20% end-to-end).

### 3.4 BDI (Bratman / Rao & Georgeff) — the commitment layer

The Belief-Desire-Intention architecture supplies the missing piece RPD doesn't: **why a
veteran doesn't re-decide everything every tick.** Beliefs = the agent's world model;
Desires = goals; **Intentions = committed plans the agent will not casually abandon**
`[S4][S10]`. Rao & Georgeff's practical insight (from the Procedural Reasoning System) is
that the abstract logic doesn't compute — you ship a *plan library* (recipes) the agent
selects from, and **commitment to intentions provides stability** so the agent isn't
blown around by every new observation `[S4]`. This is the antidote to the "re-plan from
scratch each turn" failure mode. Mr. Mwikila's `agency/goals` (persistent objectives) +
`agency/initiative` (wake-loop) is a BDI skeleton; the *intention-commitment / persistence*
discipline (don't drop a goal just because a new turn arrived) is the gap.

---

## 4. The deepest law: Ashby's Requisite Variety — and why it sizes everything

"Only variety can absorb variety": a regulator must possess at least as many possible
responses as the system it regulates has disturbances — `V(C) ≥ V(D)`, the *first law of
cybernetics* `[S6]`. Three operational consequences for Mr. Mwikila:

1. **The estate generates effectively unbounded variety** (licences × minerals × people ×
   markets × regs × equipment × weather). A *fixed* tool catalog can never match it. This
   is the cybernetic proof of INV-C: the brain must *create/compose tools on demand* to
   keep `V(C) ≥ V(D)`. Tool-synthesis isn't a nice-to-have; it's requisite variety.
2. **Variety engineering = attenuate up, amplify down** `[S7]`. Up: senses + summaries
   compress the estate's variety into something the owner can hold (one chat). Down:
   policies, delegation tiers, and synthesized tools amplify the MD's variety to meet the
   ground. Our lenses (INV-B) are attenuators; our sub-MDs/juniors are amplifiers.
3. **Recursion distributes variety.** No single controller can hold the whole estate's
   variety; VSM solves this by recursion — each level handles its own variety locally and
   passes only the residual up the algedonic line `[S7]`. This is why the recursive-mini-MD
   beyond-today leap (§7) is not gold-plating — it is the *only* variety-viable architecture.

---

## 5. Mapping VSM + MAPE-K onto Mr. Mwikila — and what we ALREADY have

INV-D's six phases are MAPE-K with a CREATE phase bolted on (tool-synthesis) and a
LEARN phase made explicit. The phase↔organ↔code map:

| INV-D phase | VSM organ | MAPE-K | What we HAVE (code) | Status |
|---|---|---|---|---|
| **PERCEIVE** | Monitor (feeds all levels) | Monitor | `kernel/sensors/` (anthropic-sensor, self-grading-judge), `sensor-failover-cascade.ts`, `agency/wake-triggers`, `proactive-nudge.ts`, `cohort-signal.ts` | Partial — senses exist; **always-on continuous** loop is the gap |
| **ORIENT** | System 4 (intelligence) + S3* (audit-past) | Analyze | `world-model/regime-detector.ts` (stable/tightening/loosening/shock), `state-vectors.ts`, `trajectory.ts`, `theory-of-mind.ts`, `fast-path-router.ts` (IG&C) | Partial — regime classifier ≈ situation-typing; **no explicit RPD schema/playbook library** |
| **ORGANIZE** | System 3 (control) + System 2 (coordination) | Plan | `agency/goals` (plan decomposer), `orchestrator/planner-dispatcher.ts`, `tool-dispatcher.ts`, `risk-tier.ts`, `policy-gate/tier-policy-resolver.ts`, `four-eye-approval.ts` | Strong — decompose + rank + gate + delegate present |
| **CREATE** | (variety amplification) | Plan→Execute | `orchestrator/self-extension.ts`, `kernel/power-tools/`, INV-C tool-synthesis | Partial — self-extension exists; needs the requisite-variety framing |
| **EXECUTE-TO-CLOSURE** | System 1 (operations) | Execute | `agency/executor/` (+ autonomy policy + audit), `sub-mds/*` (OBSERVE→MAP→REDESIGN→AUTOMATE), juniors in `packages/ai-copilot`, `agency/stall-detector.ts` | Strong — executor + sub-MDs + stall-detection present |
| **LEARN+REPEAT** | System 3↔4 homeostat update | Knowledge | `kernel/reflexion/`, `continuous-grading.ts`, `learning-loop-port.ts`, memory-v2, `drift-detector.ts` | Strong — reflexion + grading + durable memory present |
| **IDENTITY (always)** | System 5 (policy) | Knowledge/goals | `kernel/identity.ts`, `public-inviolable.ts`, `policy-gate/high-risk-literal-only.ts`, persona mandate | Strong — mandate + inviolable rails present |
| **ESCALATION (now)** | Algedonic channel | (cross-cut) | `agency/stall-detector.ts`, `agency/wake-triggers`, kill-switch (fail-closed), four-eye | Partial — pieces exist; **no unified algedonic line that jumps levels to the owner** |

**Standout finding — we already built a domain-specific MAPE-K loop and didn't name it.**
The sub-MD pipeline `OBSERVE → MAP → REDESIGN → AUTOMATE` (`sub-mds/README.md`) *is*
Monitor → Analyze → Plan → Execute, scoped to a reversible task-contract, with
`recordOutcome(actual, predicted)` as the Knowledge write-back. Each sub-MD is therefore
**already a viable mini-system at recursion level −1** — it just isn't framed or wired as
a recursive VSM. This is the single biggest leverage point: we are one rename + one
recursion-contract away from the fractal architecture VSM prescribes.

The 3–4 homeostat is also *latent but unbuilt*: `world-model/regime-detector` (S4-future)
and `agency/executor` autonomy policy (S3-control) exist as separate modules with **no
explicit homeostat loop between them** and no rule that S5 (owner) is engaged only on
homeostat-break. Today escalation is ad-hoc per-feature, not a principled algedonic line.

---

## 6. SOTA findings — the current frontier (June 2026)

1. **2026 = "proactive autonomy."** The hallmark of 2026 agents: "instead of waiting for
   human prompts, autonomous agents continuously monitor external signals" and are
   "triggered by system events, schedule timers, or real-time data changes" — they
   "analyze, decompose, select tools, and execute end-to-end within guardrails," then
   "trace the defect, identify alternatives, draft POs, and notify with a summary of the
   corrective action taken" `[S15]`. This is INV-D's EXECUTE-TO-CLOSURE almost verbatim,
   and the industry has crossed it (projection: 40% of business apps ship autonomous
   agents by end-2026) `[S15]`. **The bar moved: "proposes" is now table-stakes failure.**

2. **CoALA is the academic backbone.** Cognitive Architectures for Language Agents
   (Sumers et al., 2023) models every agent as memory modules (working/episodic/semantic/
   procedural) + internal/external action spaces + a propose-evaluate-select decision loop
   `[S11]`. The 2026 consensus: "modern frameworks independently converged on a three-phase
   loop — perceive, reason, act, observe, repeat — and treat it as the basic unit of agent
   design; OODA's *orient* phase corresponds to retrieval/context-building" `[S11]`. This
   validates structuring the kernel as PERCEIVE/ORIENT/… and maps memory-v2's layers onto
   CoALA's memory taxonomy.

3. **VSM is being actively adopted for cost-effective enterprise agentic systems.**
   Gorelkin (2026) maps S1–S5 onto agent roles, recommends the recursive fractal scale-out,
   and prescribes tiered intelligence (frontier models for S4/S5, cheap local for S1–S3)
   `[S8]`. We are early to this — most stacks are flat swarms with no S5 identity organ.

4. **Tree-search planning has matured but stays expensive.** LATS unifies reasoning +
   acting + planning via MCTS with an LLM value function `[S13]`; ToolTree adds dual-feedback
   MCTS with bidirectional pruning for tool-planning `[S12]`; AgentPRM brings step-wise
   process reward models that capture inter-step dependence toward the final goal `[S16]`.
   The frontier's own guidance (Anthropic, echoed across the field): climb the
   orchestration ladder only when the latency/cost trade pays off. RPD says the same thing
   from cognitive science. **Convergent evidence: recognition-first, search-on-failure.**

5. **Feedforward control is the under-built half.** Cybernetics: effective regulation =
   feedforward (pre-empt the disturbance) + feedback (correct measured deviation) +
   buffering `[S6 control]`. Most agent stacks are pure feedback. The veteran-MD
   differentiator is System-4 feedforward: forecasting that prevents the deviation. We have
   the substrate (`regime-detector`, forecasting work in `build-spec-forecasting.md`) but
   not the closed feedforward→action wiring.

---

## 7. Beyond-today leaps (one per major finding)

- **B1 · Recursive VSM estate-brain (the flagship leap).** Re-frame every sub-MD and junior
  as a *viable mini-MD* running the full INV-D loop one recursion level down, with its own
  S1–S5 and its own algedonic line to its parent. The estate becomes a fractal of MDs:
  estate-MD (S5=owner mandate) → site-MD (a Geita pit is its own viable system) →
  function-MD (the royalty-chaser is viable over its slice). Variety is handled locally at
  each level; only the residual escalates. This is the *only* architecture that satisfies
  Ashby at estate scale `[S6][S7]`. Concretely: promote `sub-mds/*` from task-contracts to
  recursion-level VSM nodes; give the registry a `parentMd` edge and a per-node algedonic
  threshold. *Beyond today:* no shipped product runs a recursively-viable org-brain — flat
  swarms can't because they have no S5 per level.

- **B2 · The 3–4 homeostat as a first-class organ.** Build an explicit `Homeostat34`
  module that holds S4-future (regime/forecast) against S3-present (capacity/commitments)
  and emits a single scalar *balance signal*. **The owner (S5) is engaged ONLY on
  homeostat-break** — encoding Beer's "if the 3-4 homeostat works, S5 has little to do"
  `[S7]`. This is the principled replacement for today's ad-hoc per-feature escalation and
  the cure for owner-fatigue. *Beyond today:* a brain that mathematically decides when to
  bother the human, instead of a fixed approval-tier table.

- **B3 · A unified algedonic spine.** One pain/pleasure channel that any node at any
  recursion level can fire, that *bypasses* the normal report hierarchy and lands on S5
  after a timeout, with pleasure signals (a deal closed, a forecast beaten) reinforcing the
  schema that produced them `[S7]`. Fold `stall-detector`, `wake-triggers`, kill-switch,
  and four-eye into this spine. *Beyond today:* most agent monitoring is dashboards (pull);
  algedonic is push-on-pain with guaranteed escalation — the difference between a smoke
  detector and a quarterly report.

- **B4 · A recognition gate in front of LATS (RPD-first kernel).** Insert an explicit
  ORIENT recogniser: retrieve the matching domain schema/playbook (a veteran's mental
  library), run a cheap mental-simulation critic on the first option, and ESCALATE to LATS
  tree-search only on no-match or simulation-fail `[S3][S13]`. This makes the common case
  veteran-fast and cheap and reserves 4×–15× token spend for genuine novelty. *Beyond
  today:* a measured `recognition-rate` KPI — the % of turns resolved by schema-match vs
  tree-search — as a direct proxy for how "veteran" the MD has become; it should rise over
  the estate's life as the playbook library compounds.

- **B5 · Intention-commitment (BDI persistence) discipline.** Give goals a commitment
  state so the MD doesn't re-decide everything each turn; an intention is dropped only on
  explicit reconsideration triggers (goal achieved, became impossible, superseded by S5)
  `[S4][S10]`. *Beyond today:* stable multi-day pursuit of an estate objective through
  hundreds of unrelated chat turns — the behavioural signature of a real MD vs a stateless
  assistant.

- **B6 · Feedforward-first control.** Wire `regime-detector`/forecasting (S4) directly into
  pre-emptive action proposals so the MD acts on a *predicted* disturbance before it lands
  (a forecast royalty shortfall triggers a financing loop now, not after the miss) `[S6
  control]`. *Beyond today:* the MD's headline metric becomes *deviations prevented*, not
  *deviations corrected* — the literal definition of a great operator.

- **B7 · Variety-instrumented self-extension.** Make INV-C tool-synthesis fire on a
  *measured variety gap*: when the disturbance variety the MD faces exceeds its response
  variety (`V(D) > V(C)`), that is the formal trigger to synthesize/compose a new tool
  `[S6]`. *Beyond today:* tool-creation becomes a closed cybernetic control law, not a
  heuristic — the brain provably keeps requisite variety as the estate grows.

---

## 8. Our gaps (buildable, mapped to the register)

1. **No always-on continuous PERCEIVE loop.** Senses exist (`sensors/`, `wake-triggers`,
   `proactive-nudge`) but fire per-turn/per-trigger, not as a standing Monitor that runs
   independent of chat. INV-D demands continuous backend perception. (relates to AUT/EA in
   `MASTER_GAP_REGISTER.md`).

2. **No explicit 3–4 homeostat + no principled escalation law.** S4 (regime/forecast) and
   S3 (executor/autonomy) are separate; escalation to the owner is ad-hoc per feature.
   Build B2.

3. **No unified algedonic channel.** `stall-detector`, `wake-triggers`, kill-switch,
   four-eye are disjoint. Build B3.

4. **No RPD schema/playbook library or recognition gate.** `regime-detector` types the
   *market*, not the *situation*; LATS runs without a recognition pre-filter. The veteran's
   mental playbook (situation-type → typical action) doesn't exist as a retrievable store.
   Build B4. (relates to COG cognition gaps).

5. **Sub-MDs are not recursive VSM nodes.** They already run a MAPE-K pipeline but lack a
   `parentMd` recursion edge, per-node S5 identity, and a per-node algedonic threshold.
   Build B1. (relates to ORCHESTRATION_SPEC recursion).

6. **Feedback-only control; feedforward unwired.** Forecast substrate exists but does not
   close into pre-emptive action. Build B6.

7. **BDI intention-commitment missing.** `agency/goals` persist but have no commitment
   state / reconsideration-trigger discipline, so plans are vulnerable to per-turn churn.
   Build B5.

8. **Tool-synthesis lacks a variety trigger.** `self-extension.ts` exists but isn't fired
   by a measured `V(D) > V(C)` gap. Build B7. (relates to INV-C / frontier-tool-synthesis).

9. **Tiered-intelligence not aligned to VSM organs.** `model-tiering.ts` tiers by cost/risk,
   not by cognitive organ; VSM says frontier→S4/S5, cheap→S1–S3 `[S8]`. Re-key tiering to
   the organ map in §5.

---

## 9. Sources

| Key | Type | URL |
|---|---|---|
| S1 | search | https://www.businessballs.com/strategy-innovation/viable-system-model-stafford-beer/ |
| S2 | search | https://www.techtarget.com/whatis/definition/What-is-autonomic-computing (MAPE-K, IBM/Kephart-Chess) |
| S3 | search | https://www.gary-klein.com/rpd  · https://en.wikipedia.org/wiki/Recognition-primed_decision |
| S4 | search | https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model |
| S5 | fetched | https://oodaloop.com/the-ooda-loop-explained-the-real-story-about-the-ultimate-model-for-decision-making-in-competitive-environments/ |
| S6 | search | https://en.wikipedia.org/wiki/Variety_(cybernetics) (Ashby's Law) · S6 control: https://en.wikipedia.org/wiki/Feed_forward_(control) + ScienceDirect cybernetics overview |
| S7 | fetched/search | https://www.businessballs.com/strategy-innovation/viable-system-model-stafford-beer/ · https://en.wikipedia.org/wiki/Viable_system_model (algedonic, recursion, 3*, 3-4 homeostat, variety attenuation/amplification) |
| S8 | fetched | https://medium.com/@magorelkin/stafford-beers-viable-system-model-for-building-enterprise-agentic-systems-81982d6f59c0 |
| S9 | search | https://www.shadowboxtraining.com/news/2025/06/17/a-primer-on-recognition-primed-decision-making-rpd/ |
| S10 | search | https://link.springer.com/chapter/10.1007/3-540-49057-4_1 (Georgeff et al., BDI Model of Agency) · https://www.researchgate.net/publication/2319611 (Rao & Georgeff, BDI: theory to practice) |
| S11 | search | https://arxiv.org/pdf/2309.02427 (CoALA, Sumers et al.) · https://zylos.ai/research/2026-03-12-cognitive-architectures-ai-agents-perception-to-action |
| S12 | search | https://arxiv.org/html/2603.12740v1 (ToolTree, dual-feedback MCTS) |
| S13 | search | https://arxiv.org/abs/2310.04406 (LATS) |
| S14 | search | https://en.wikipedia.org/wiki/OODA_loop (orientation schwerpunkt, IG&C, tempo) |
| S15 | search | https://www.cio.com/article/4064998/taming-ai-agents-the-autonomous-workforce-of-2026.html · https://desknero.com/future-tech/autonomous-ai-agents-2026-enterprise-trends/ |
| S16 | search | https://arxiv.org/pdf/2511.08325 (AgentPRM, process reward models for LLM agents) |

---

## 10. The one-line takeaway

Mr. Mwikila should be built, explicitly, as a **Viable System** (Beer S1–S5 + algedonic +
recursion) whose control loop is **MAPE-K**, whose decision style is **RPD/OODA**
(recognition-first, simulate, search only on failure), whose commitment layer is **BDI**,
and whose sizing law is **Ashby's requisite variety** — and whose deepest leap is that
every sub-MD is *itself* a viable mini-MD running the same loop one level down. INV-D is
already this cycle in prose; this dossier is the 50-year-old control theory that makes it
rigorous, the code that already implements two-thirds of it, and the nine gaps that close
the rest.
