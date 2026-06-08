# SOTA dossier — Hierarchical planning & execution-to-closure

**Lane:** `hierarchical-planning-execution-to-closure`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** kernel-planning-execution research subagent (web-survey + repo audit)
**Frame (INV-D):** the MD runs a CONTINUOUS STRUCTURED cognitive cycle in the
backend — PERCEIVE → ORIENT → ORGANIZE → CREATE → EXECUTE-TO-CLOSURE →
LEARN+REPEAT — modelled on a veteran domain-MD. This dossier covers the
ORGANIZE + EXECUTE-TO-CLOSURE arc: **how the MD organizes its thinking around a
situation and DRIVES it to a confirmed END, never stopping at "proposes".**
Money / licence / deletion stay HITL forever; everything below grows
*capability to drive loops to closure*, never the right to bypass a rail.

The user only chats a persona. Everything in this dossier is BACKEND cognition.

---

## 0. The one-paragraph thesis

Today our kernel is a **single-ready-unit ReAct loop** (`main-loop.ts`):
a flat plan tree (`plan.ts`) whose only exit predicate is "every goal is
`complete`/`rejected`", advanced by a hard `plan.advance(...,'complete')`
*regardless of whether the goal's effect was actually achieved in the world*.
There is **no discrepancy detector** that spawns new goals when reality
diverges from expectation, **no HTN method library** that decomposes a
situation-type into a known recipe, **no plan-repair node** (failures only
retry — COG-13), **no situational self-model** (COG-15), and **no durable
journal** so a half-driven loop resumes mid-flight after a crash (RSS-23 opt-in,
no worker deployed). The frontier (June 2026) has converged on the opposite of
all five: **goal-driven autonomy** (the agent spawns its own goals from
discrepancies), **HTN×LLM** decomposition (ChatHTN), **scheduler/DAG harnesses**
with immutable plan versions + a 3-level escalation-to-replan protocol (Graph
Harness), **durable execution** as a baseline (Temporal $5B / Feb-2026; LangGraph,
Pydantic-AI, OpenAI Agents SDK all shipped it first-class), and an explicit
**definition-of-done / verifier** before a task is called complete (Anthropic's
CitationAgent; SagaLLM's validation agents). The "beyond-today" leap for Borjie
is a **goal-driven-autonomy estate brain**: a backend organ that, every cycle,
*detects discrepancies the owner has not noticed, formulates its own goals from
them, decomposes each via a mining-domain method library, drives each to a
machine-checkable definition-of-done, and resumes mid-flight after any crash* —
with money/licence/deletion compensated via Sagas and gated HITL.

---

## 1. SOTA findings — classic foundations (the load-bearing primitives)

### 1.1 Goal-Driven Autonomy (GDA) — the keystone for "spawn its own goals"

GDA is the single most relevant classic model for INV-D's "identify loops/needs
the user has no idea about." A GDA agent maintains **expectations** about how
the world *should* evolve, runs **discrepancy detection** (expected vs observed
state), **explanation** (why did it diverge), **goal formulation** (generate a
*new* goal from the explanation), and **goal management** (prioritize among
active goals). It is the formal answer to "drive to a confirmed END, never stop
at proposes": the loop does not terminate on a plan — it terminates when the
*expectation is met without discrepancy*.

- Nau/Klenk/Molineaux/Aha — **"Goal-Driven Autonomy in Planning and Acting"**
  (the canonical GDA cycle: discrepancy → explanation → goal formulation →
  goal management).
- Muñoz-Avila, Aha, Jaidee, Klenk (2010) — *Applying GDA to a team shooter
  game* (first GDA paper); Muñoz-Avila/Wilson/Aha (2015) *Guiding the Ass with
  Goal Motivation Weights* (learning motivator weights to **prioritize which
  goal to pursue next**).
- Survey: **"Human-inspired goal reasoning implementations: A survey"**
  (ScienceDirect, 2024) — taxonomy of discrepancy/explanation/formulation.
- Cox / Dannenhauer — goal reasoning + metacognitive goal monitoring (an
  agent reasons about *its own* goals, not just plans).
- Lehigh GDA project page (Muñoz-Avila): the four-phase model + expectations
  in nondeterministic environments, including changes that "occur independently
  of the agent's own actions" (exactly an estate's regulator/FX/weather shocks).

**Why it matters here:** our `plan.isComplete()` is a *structural* predicate
(all nodes terminal). GDA makes completion a *semantic* predicate (no residual
discrepancy between expected-world and observed-world). That is the difference
between "I proposed a royalty filing" and "the royalty is filed, the receipt is
in the ledger, and the licence row reflects it."

### 1.2 BDI (Bratman) — intention persistence, the antidote to thrashing

The Belief–Desire–Intention model (Bratman's philosophy of intention; the
PRS/JACK/Jadex lineage) supplies the missing **commitment strategy**. Intentions
have *stickiness*: they persist until completed, proven impossible, or
explicitly reconsidered — preventing an agent from abandoning a plan "at the
first sign of difficulty." Today our loop has zero intention persistence: each
`think()` rebuilds a plan from scratch; a half-driven multi-day goal (e.g.
"close the offtake settlement loop") has no durable *intention* it re-commits to.

- Wikipedia/BDI software model; APXML *Agent Mental States: B/D/I*; Klu glossary.
- 2025 revival: **"Integrating Machine Learning into BDI Agents: Current…"**
  (arXiv 2510.20641) and **BDIPrompting** (structured BDI prompting for proactive,
  explainable task planning, HAI 2023 / arXiv) — the bridge from classic BDI to
  LLM agents: explicit belief store + committed-intention tracking + plan
  generation from intentions. **"Architectures for Building Agentic AI"** (arXiv
  2512.09458) frames BDI as one of the reference agentic architectures for 2026.

**Leap:** a `flow_id`-keyed *durable intention ledger* — each long-horizon estate
loop is a BDI intention with a commitment strategy (single-minded until done,
open-minded on regulator shock), so the MD re-commits across days and crashes
rather than re-deriving.

### 1.3 Cybernetics — the loop is OODA + Perceptual Control Theory

INV-D's PERCEIVE→ORIENT→ORGANIZE→…→LEARN cycle IS Boyd's **OODA loop**
(Observe-Orient-Decide-Act) — and OODA's deepest reading is cybernetic:
the agent *controls its perceptions toward a reference signal* (Powers'
**Perceptual Control Theory**), not its outputs. The closure criterion in PCT is
"perceived state = reference state"; error drives action until the loop is closed.
This is the control-theoretic justification for GDA's discrepancy detector and
for "execute-to-closure": **action continues while error ≠ 0.**

- Boyd's OODA (DTIC "Control Warfare: Inside the OODA Loop"); the **Dynamic OODA
  loop** (Brehmer) amalgamating OODA with cybernetic C2.
- Powers, **Perceptual Control Theory** — closed-loop control of perception
  toward a reference; "Active Inference and HCI" (arXiv 2412.14741) is the modern
  free-energy framing of the same closed loop.
- Beer's **Viable System Model** — the recursive S1–S5 management hierarchy
  (operations → coordination → control → intelligence → policy) is the
  organizational analogue of our sub-MD/junior hierarchy and gives a principled
  recursion for "an MD that manages sub-MDs."

**Why it matters:** these supply the *invariant* the whole lane must satisfy —
**a goal is closed iff the controlled perception matches its reference**, which
is precisely the "definition of done" the execution layer must verify.

---

## 2. SOTA findings — frontier (2025–June 2026)

### 2.1 HTN × LLM — situation-type → method decomposition (ORIENT+ORGANIZE)

The frontier reconnected classic **Hierarchical Task Network** planning with LLMs
in 2025, which is exactly the missing COG-14 (no hierarchical/HTN decomposition;
we only do flat search). HTN decomposes a *compound task* into subtasks via a
**method library** of admissible reductions, terminating in primitive actions —
the formal version of "recognize the situation-type, apply the veteran's
playbook."

- **ChatHTN** (Muñoz-Avila et al., PMLR v288, 2025) — interleaves symbolic HTN
  decomposition with ChatGPT-approximated decompositions; **provably sound**
  despite LLM approximations. The template for a *mining method library* whose
  gaps are filled by an LLM but whose backbone is deterministic.
- **Online Learning of HTN Methods for integrated LLM-HTN Planning** (arXiv
  2511.12901, 2025) — when the LLM generates a decomposition, the system *learns
  a generalized method* reusable on future instances → cuts LLM queries ≈75%
  while preserving soundness. This is HTN-as-skill-capture (ties to AUT-03 /
  Voyager).
- **Towards a General Framework for HTN Modeling with LLMs** (arXiv 2511.18165);
  **Procedural Knowledge Improves Agentic LLM Workflows** (arXiv 2511.07568) —
  giving agents explicit procedural/method knowledge beats free-form ReAct.
- **R-HTN: Rebellious Online HTN Planning** (arXiv 2602.00951, 2026) — online
  HTN with safety constraints / refusal — directly relevant to HITL rails.

**Leap:** a **mining-domain method library** (`licence.renew`, `royalty.file`,
`offtake.settle`, `assay.dispute`, `closure.provision`) as first-class HTN
methods; the LLM only fills the gap when no method matches, and a *learned method*
is captured back (human-gated) — the deterministic-engine pattern the gap
register already wants for domain depth (DM rows), now applied to *planning*.

### 2.2 Scheduler/DAG harnesses — immutable plans + bounded escalation (EXECUTE)

The single most important 2026 execution paper for us:
**"From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework"**
(Graph Harness, arXiv 2604.11378). It proves our `main-loop.ts` is a
**single-ready-unit scheduler** (|ready set| ≤ 1, next node chosen
non-deterministically by LLM inference) and diagnoses its three structural
weaknesses precisely:

1. **Implicit dependencies** — task relationships live only in context, not in
   structure (our plan tree carries no `dependsOn` edges; EXEC-dag confirms).
2. **Unbounded recovery** — on failure the LLM freely decides retry strategy with
   no formal bound (our loop only retries; COG-13).
3. **Mutable execution plans** — the plan can be silently rewritten mid-run,
   destroying auditable traces.

Graph Harness's three design commitments are a direct spec for our execution
layer:
- **Immutable plan versions** — a plan cannot change mid-execution; a change
  forces a *new versioned plan* (auditable; pairs with our hash-chained audit).
- **Separated layers** — planning, execution, recovery are independent with clean
  interfaces.
- **Escalation protocol** — recovery is strictly leveled: **L1 retry (bounded) →
  L2 local patch → L3 full replan.** Plans complete only when *all nodes reach
  terminal states* (a structural definition-of-done) — and `all_of`/`any_of`
  joins give real parallelism (the EXEC-dag topological scheduler we lack).

Corroborating: **AdaptOrch** (arXiv 2602.16873) task-adaptive orchestration; the
2026 production write-ups (Zylos, AgentMarketCap, Effloow, AppScale) all converge
on DAG + durable execution as the baseline.

### 2.3 Durable execution — resume a half-driven loop mid-flight (CLOSURE survives crashes)

By June 2026 durable execution is **no longer optional infrastructure but a
baseline** (LangGraph, Pydantic-AI, OpenAI Agents SDK shipped it first-class;
Temporal raised $300M at a $5B valuation 2026-02-17, 9.1T lifetime actions,
1.86T from AI-native firms). Two mechanisms dominate:

- **Journal-based replay** (Temporal/Inngest): record each completed step; on
  crash a fresh worker replays from the start, returning cached results for
  already-journaled steps and resuming at the first un-journaled step.
- **Database checkpointing** (LangGraph): persist state after each node.
  The accepted division of labor: **LangGraph protects application-level
  failures** (bad reasoning, HITL pauses, branch errors) while **Temporal
  protects infrastructure-level failures** (crashes, partitions, preemption).
  Workflows pause/sleep for minutes→years without holding compute.

Sources: Zylos (2026-02-17, 2026-03-04), AgentMarketCap (2026-04-10), Effloow,
Vadim's blog, AppScale, Koshy/Medium ("Agent Workflows Are Rediscovering Durable
Execution"). We already vendored the substrate (`@borjie/central-intelligence/
durable/inngest-executor.ts`, `agent-orchestrator/durable-execution/durable.ts`
with `wrapAsDurable` + checkpoint journal) but **it is opt-in and no worker is
deployed** (RSS-23) — the substrate exists, the organ is dark.

### 2.4 Plan monitoring & replanning under disruption (the missing repair node)

2026 work converges on *structured* failure recovery over ad-hoc LLM retry:

- **"Why Do LLM-based Web Agents Fail? A Hierarchical Planning Perspective"**
  (arXiv 2603.14248) — splits competence into *high-level planning, low-level
  execution, replanning*; most failures are replanning failures.
- **"Conditional Multi-Stage Failure Recovery for Embodied Agents"** (arXiv
  2507.06016) — reflect on env + execution history, detect a *missing
  precondition subgoal*, and **generate the missing subgoal** (a GDA goal-
  formulation move at the execution layer).
- **"Accurate Failure Prediction … Does Not Imply Effective Failure Prevention"**
  (arXiv 2602.03338) and the execution-time-intervention finding: the
  *disruption↔recovery tradeoff* — outcomes depend less on predicting failure
  than on how the agent responds to being corrected mid-trajectory. Implication:
  a repair node must *minimally disrupt* an in-flight plan (don't nuke the whole
  tree; patch locally first — Graph Harness L2 before L3).
- **Reflexion** (Shinn et al.) and **ReasoningBank** (Google, arXiv 2509.25140,
  closed-loop retrieve→act→self-judge→distill→consolidate; robust to judge noise;
  +34.2% effectiveness, −16% steps) — verbal-reinforcement memory of *why a
  plan failed* so the next planning pass avoids the failed sub-tree. Our LATS
  already emits `reflections` but they are **unrouted** (COG-13: "LATS reflections
  unrouted") — ReasoningBank is the missing sink.

### 2.5 Decomposition, delegation & "definition of done" (orchestrator-worker)

Anthropic's **multi-agent research system** (engineering blog) is the production
reference for ORGANIZE-by-delegation with explicit closure:
- The lead agent decomposes the query and gives each subagent **an objective, an
  output format, tool/source guidance, and clear task boundaries** — "without
  detailed specifications subagents duplicate work or leave gaps."
- **Effort-scaling rules are embedded in the prompt** because "agents struggle to
  judge appropriate effort": *simple fact-find = 1 agent, 3–10 calls; comparison
  = 2–4 subagents, 10–15 calls; complex = 10+ subagents.* (Our `spawn_sub_md`
  carries the full Agent contract — model/effort/budget/isolation — but no such
  effort-scaling heuristic and synchronous-only dispatch.)
- **Closure is verified, not assumed:** the lead "decides whether more research
  is needed" and a separate **CitationAgent verifies** before delivery — a
  dedicated definition-of-done gate. Anthropic's **2026 Agentic Coding Trends
  Report** + Claude Code **Agent Teams** docs reinforce: "testable outcomes" and
  a written **rubric describing success** are *required* for delegation; the lead
  "can check in on sub-agents mid-workflow to verify they're on track."
- **SagaLLM** (VLDB 2025, arXiv 2503.11951) — multi-agent LLM planning with the
  **Saga transactional pattern**: persistent memory, automated **compensation**
  on failure, and **independent validation agents** as the closure gate. This is
  the irreversible-action answer for money/licence (run-to-completion or
  compensate-as-if-it-never-happened), aligning with our `LedgerService.post`
  invariant and the EXEC-saga gap.
- **HITL interrupt/resume**: LangGraph human-in-the-loop middleware **interrupts**
  before a consequential tool, persists graph state, and **resumes via a
  `Command`** — the mechanism for our HIGH-risk prefixes (EXEC-hitl). **ACRFence**
  (arXiv 2603.20625) warns about *semantic rollback attacks* on agent
  checkpoint-restore — relevant to making resume/compensation safe.

### 2.6 Hierarchical RL — the temporal-abstraction frame for sub-MDs

Options framework (Sutton/Precup/Singh) + **FeUdal Networks** (Vezhnevets 2017)
+ **TAG: decentralized multi-agent HRL** (arXiv 2502.15425) formalize the
manager/worker temporal abstraction our MD→sub-MD→junior hierarchy is: a
**manager sets abstract goals at coarse temporal resolution; workers execute
primitives**, with bidirectional information hiding. This is the RL-theoretic
license for "the MD organizes by ranking by consequence × reversibility and
**delegates**" — each delegated goal is a temporally-extended *option* whose
*termination condition* is its definition-of-done.

---

## 3. Our gaps — vs LATS / orchestrator / loop-runner / workflow-engine

Concrete, file-level, cross-referenced to the MASTER_GAP_REGISTER.

| # | Gap | Evidence (our code) | Register row | Frontier it violates |
|---|-----|---------------------|--------------|----------------------|
| G1 | **No discrepancy detector / goal formulation** — the loop never spawns its *own* goal from an expected≠observed gap; it only executes the user's request. | `plan.ts` goals are planner-suggested only; no `expectation`/`discrepancy`; `kernel-types.ts:171` "blind spots" is doc-only; `supervisor/` is `types.ts`-only (zero consumers) | COG-15 | GDA (§1.1), PCT closure (§1.3) |
| G2 | **`plan.advance(…,'complete')` is unconditional** — `main-loop.ts:1115-1117` marks a goal complete after dispatch *without verifying its effect in the world*. "Stops at proposes." | `main-loop.ts` advances on any non-error dispatch | COG-12, EXEC-* | Definition-of-done / verifier (§2.5), GDA semantic completion |
| G3 | **No HTN / method library** — planning is flat search (ToT/LATS) only; no situation-type → recipe decomposition. | no `methodLibrary`/`decompose`/HTN in kernel; `plan.ts` is a flat status tree | COG-14 | ChatHTN, online-HTN (§2.1) |
| G4 | **No plan-repair / replanning node** — failures only *retry* (`main-loop.ts:632` band) or fold a tool-error string back; LATS `reflections` are **emitted but unrouted**. | `lats-search.ts` returns `reflections`; no consumer re-plans from them; `main-loop.ts` has retry-only recovery | COG-13 | Graph-Harness L1→L2→L3 escalation (§2.2); conditional recovery (§2.4) |
| G5 | **No DAG / dependency edges** — sub-goal & sub-MD dispatch is a flat list; no `dependsOn`, no `all_of`/`any_of` joins, no topological level scheduler; sub-MD dispatch is **synchronous-only**. | `plan.ts` `subGoals` carry no edges; `decision.ts` `SubMdSpawn` has no `dependsOn`; EXEC-dag notes flat `brain-dispatch.hono.ts:256` | EXEC-dag | Graph Harness scheduler (§2.2); Anthropic parallel subagents (§2.5) |
| G6 | **Durable execution dark** — `wrapAsDurable`/inngest-executor exist but opt-in; **no worker deployed**; a half-driven multi-day loop is lost on restart. `loop-runner` is single-shot (one 5-layer pass), not a *standing* loop with resume. | `central-intelligence/durable/inngest-executor.ts:23` opt-in; no k8s worker; `loop-runner.ts` one pass → `ok`/error | RSS-23, AUT-12 | Durable execution baseline (§2.3) |
| G7 | **No intention persistence / commitment** — each `think()` rebuilds the plan; `PlanStore` is `createInMemoryPlanStore` by default; no `flow_id`-keyed durable intention that re-commits across turns/days. | `plan.ts:202` in-memory store; no durable PlanStore wired; no commitment strategy | (new) ORCH-flowprefs adjacency | BDI intention stickiness (§1.2) |
| G8 | **No machine-checkable definition-of-done** — `plan.isComplete()` is purely structural (all nodes terminal); no per-goal verifier asserting effect against DB/ledger/world. | `plan.ts:124-131` `complete()` = every node terminal | COG-12, AUT-06 fitness | Verifier/CitationAgent + SagaLLM validation agents (§2.5) |
| G9 | **No compensation on irreversible drive-to-closure** — when the MD drives a money/licence loop and a later step fails, there is no Saga rollback; double-entry invariant has no compensating-action path wired. | EXEC-saga "sagas + compensating actions not wired"; `loop-runner` has no compensation layer | EXEC-saga, RSS-01 | SagaLLM / Temporal Sagas (§2.5) |
| G10 | **No effort-scaling heuristic for delegation** — `spawn_sub_md` carries effort/budget fields but nothing decides *how many* sub-MDs / *how much* effort by situation consequence. | `decision.ts` `SubMdSpawn.effort/budget` present; no scaler in `main-loop.ts` | (new) under EXEC-dag | Anthropic effort-scaling rules (§2.5) |
| G11 | **Reflections/discrepancies don't feed a learning loop** — LATS reflections, judge scores, and (absent) discrepancies are not distilled into reusable planning memory. | COG-16 "reasoning signals not fed to a learning loop"; no ReasoningBank-style sink | COG-16, AUT-06 | ReasoningBank closed loop (§2.4) |
| G12 | **No goal-priority calculus (consequence × reversibility)** — INV-D's ORGANIZE step ("rank by consequence × reversibility") has no implementation; `risk-tier.ts` ranks *tools*, not *goals*. | `risk-tier.ts` is per-tool; no goal-level priority/VoI scorer | COG-15, AUT-05 (2-D reversibility×blast-radius) | GDA goal-motivation weights (§1.1); HRL option ranking (§2.6) |

**Net:** LATS gives us *search within a goal* (strong, but unwired on real turns —
COG-02); `plan.ts` gives a *visible status tree* (no edges, no DoD); `loop-runner`
gives *one disciplined 5-layer pass* (not a standing, resumable, self-spawning
loop); `workflow-engine` gives a *human maker-checker lifecycle* (open→…→committed
with hash-chain + Saga-shaped `ProposedChange`/compensation hooks — the closest
thing we have to durable closure, but it is for *human-initiated* parcel/PO edits,
not MD-spawned goals). The frontier organ that unifies them — **GDA discrepancy→
goal + HTN decompose + DAG schedule + durable resume + verified DoD + Saga
compensate** — does not exist yet.

---

## 4. Beyond-today — the goal-driven-autonomy estate brain

A standing backend organ (call it the **Closure Engine**) that turns INV-D into
running code, leaping past each finding:

1. **GDA discrepancy organ (beyond §1.1).** A continuous PERCEIVE→ORIENT pass over
   estate event streams (`event_outbox`, ledger, licence, FX, KYC, assay) that
   holds **expectations** (licence renews 60d before expiry; royalty filed within
   N days of sale; offtake cash lands T+2) and emits a **discrepancy → its own
   formulated goal** keyed by `flow_id` — *the loop the owner never noticed*.
   Goals are ranked by **consequence × reversibility** (G12), the GDA
   goal-motivation-weight idea fused with our 2-D reversibility×blast-radius
   (AUT-05). Leap: discrepancies and their goal-formulations are themselves
   **distilled into ReasoningBank** so the brain learns *which* discrepancies
   matter for *this* estate.

2. **Mining-method HTN library (beyond §2.1).** First-class deterministic methods
   (`licence.renew`, `royalty.file`, `offtake.settle`, `closure.provision`),
   LLM-filled only on gap, **ChatHTN-sound**; an unmatched situation that the LLM
   decomposes is captured (human-gated) as a *new learned method* (online-HTN) —
   the deterministic-engine pattern applied to planning, so the MD's playbook
   *grows*.

3. **Immutable-plan DAG scheduler (beyond §2.2).** Replace the single-ready-unit
   loop with a versioned DAG: `dependsOn` edges, `all_of`/`any_of` joins, real
   parallel sub-MD dispatch, and the **L1 retry → L2 local-patch → L3 replan**
   escalation as the *only* recovery path (closes G4+G5). Every replan mints a
   new immutable plan version into the hash-chained audit — auditable to closure.

4. **Durable, resumable, standing loops (beyond §2.3).** Promote each `flow_id`
   loop to a durable workflow (journal-replay via the already-vendored Inngest
   substrate + a deployed worker) so a multi-day drive-to-closure **resumes
   exactly where it stalled** after any crash/rollout — the BDI intention
   *re-commits itself* (closes G6+G7). Leap: the intention ledger *is* the journal.

5. **Verified definition-of-done + Saga compensation (beyond §2.5).** A goal is
   `complete` **only** when a per-goal verifier asserts the effect against
   ground truth (ledger balanced, licence row updated, receipt present,
   evidence non-empty, EN/SW pure) — the PCT "perceived = reference" closure
   (closes G2+G8). For irreversible money/licence steps, the drive wraps a
   **Saga**: run-to-completion or compensate-as-if-never-happened via
   `LedgerService.post`, with **independent validation agents** (SagaLLM) and
   **HITL interrupt/resume** (LangGraph `Command`) on every HIGH-risk prefix —
   so the brain can drive to closure *autonomously where reversible* and *to a
   gated checkpoint where not* (closes G9). ACRFence-hardened resume prevents
   semantic-rollback abuse.

6. **Effort-scaled delegation (beyond §2.5/§2.6).** A consequence-driven scaler
   picks sub-MD count + effort + budget per situation (Anthropic's embedded
   rules generalized to estate consequence), each delegated goal an HRL **option**
   whose *termination condition is its DoD* (closes G10).

7. **Closed learning loop (beyond §2.4).** Every drive — success or failure —
   self-judged (LLM-as-judge, judge-noise-robust) and **distilled into
   ReasoningBank**; LATS reflections finally routed there; the next planning pass
   retrieves *this estate's* prior closures to steer search (closes G11; feeds
   AUT-06 nightly replay→eval→update).

The invariant across all seven: the Closure Engine grows **capability to drive
loops to confirmed closure**, but money / licence / deletion are *never*
auto-closed — they reach a **gated checkpoint** (HITL) or are **compensated**,
never bypassed. The meta-rail (`inviolable.ts`) over the autonomy controller
stays the immovable defense moat.

---

## 5. Minimal-surface wiring order (so this lands on existing organs, not a rewrite)

1. **Discrepancy organ** as a sensor pass + `SituationalSelfModel` (COG-15) →
   spawns goals into `plan.ts` (add `expectation`/`source:'self-formulated'` to
   `PlanGoal`).
2. **Per-goal verifier** (`isGoalClosed(goal): Promise<DoDResult>`) → gate
   `plan.advance(…,'complete')` behind it (closes G2/G8 with the smallest edit).
3. **Repair node**: route `lats-search.ts` `reflections` + tool-errors into an
   L1→L2→L3 escalation branch in `main-loop.ts` (closes G4).
4. **Durable PlanStore + worker**: swap `createInMemoryPlanStore` for a Drizzle
   journal store; deploy the Inngest worker (RSS-23) (closes G6/G7).
5. **DAG edges**: add `dependsOn`/`level` to `PlanGoal` + `SubMdSpawn`; a
   topological-level scheduler (EXEC-dag) (closes G5/G10).
6. **HTN method library** in `kernel/planning/` (COG-14) consulted before LATS;
   LLM fallback + captured learned methods (closes G3).
7. **Saga layer** in `loop-runner`/`workflow-engine` for money/licence drives
   (EXEC-saga) + ReasoningBank sink (closes G9/G11).

This sequence keeps every existing rail intact and turns the flat ReAct loop into
a goal-driven, hierarchically-decomposing, durably-resumable, verified-to-closure
estate brain.
