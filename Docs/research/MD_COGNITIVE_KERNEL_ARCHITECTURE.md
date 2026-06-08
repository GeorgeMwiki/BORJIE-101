# The MD Cognitive Kernel — Unified Architecture & Build Roadmap

**Document:** `MD_COGNITIVE_KERNEL_ARCHITECTURE.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Status:** synthesis dossier — no code, no commit. The single architecture register for INV-D.
**Synthesizes (read these for the SOTA grounding behind every claim here):**
- `kernel-cognitive-architectures.md` — Soar/ACT-R/LIDA/CLARION → CoALA; the resident-mind gap.
- `kernel-proactive-perception.md` — Endsley/Rosen/Friston/Itti-Baldi/Ansoff → the Estate Radar.
- `kernel-management-cybernetics.md` — Beer VSM + MAPE-K + Klein RPD + Ashby → veteran structure, recursion.
- `kernel-planning-execution.md` — GDA + HTN + DAG/durable + Saga → the Closure Engine.
- `kernel-metacognition-expertise.md` — Nelson-Narens + Mirror/MGV/Triage + conformal → the Competence Tensor.
- `kernel-persona-and-code-audit.md` — one-chat front; stage-by-stage PRESENT|PARTIAL|ABSENT code map.
- `MASTER_GAP_REGISTER.md` (INV-A…INV-G; INV-D is the anchor) + `SELF_ORGANIZING_ORG_BRAIN_VISION.md` + `OPERATIONAL_CLOSED_LOOP_FABRIC.md`.

**Anchor invariant — INV-D (owner directive, 2026-06-08).** The MD (Mr. Mwikila) runs a
**CONTINUOUS, STRUCTURED cognitive cycle in the BACKEND**, modelled on a veteran domain-MD,
**GENERAL across any situation (never hardcoded per scenario)**:

> **PERCEIVE → ORIENT → ORGANIZE → CREATE → EXECUTE-TO-CLOSURE → LEARN+REPEAT**

It is the **meta-controller**: self-construction (INV-C), the closed-loop fabric, the semantic
lenses (INV-B), and tool-synthesis all hang off it. The user **only chats** the persona as if a
real veteran MD sits behind a laptop. **THINK *and* ACT** (INV-D sharpened) — a kernel that thinks
but cannot act is a failure. Rails immovable: **money / licence / deletion stay HITL** forever.
**Same kernel for Borjie (mining) and BossNyumba (real-estate)** — only the domain ontology pack +
deterministic engines differ.

---

## 0. Thesis in one paragraph

A veteran MD does not "answer prompts." She runs a **resident mind**: senses always on, a library
of recognised situation-types, a habit of decomposing by consequence, the reflex to build the
missing tool, the discipline to drive every loop to confirmed closure, and the metacognition to
know the edge of her own competence — then she sleeps, reflects, and repeats. Sixty years of
cognitive science (Soar/ACT-R/LIDA/CLARION → CoALA), fifty years of management cybernetics (Beer's
Viable System Model + IBM's MAPE-K), the naturalistic-decision canon (Klein's RPD, Boyd's OODA),
goal-driven autonomy + HTN + durable execution, and the 2026 metacognition frontier (Mirror, MGV,
Triage, conformal abstention) **all independently describe the same machine** — and INV-D is that
machine in prose. **By CoALA's own classifier, Borjie's kernel already has zero empty cognitive
slots**: working/episodic/semantic/procedural memory, retrieve/reason/learn/ground actions, and a
propose→evaluate→select→execute cycle are all present, with an unusually strong metacognitive
subsystem and real (if dark) self-extension. **The single structural deficiency is the trigger
model**: the cycle fires *per HTTP request* (`think(req)`) and *per cron tick* (`wake-loop`, 15-min,
~3 hardcoded triggers), where INV-D and every SOTA source demand a **resident, continuously-cycling
estate-MD mind** that holds a *standing situational model* between turns and runs its own cycle
whether or not the owner is typing. This dossier names that resident mind — **the `EstateMind`
kernel** — maps each of its eight organs to a named module on our `central-intelligence` base, shows
how it makes dynamism general (situation-types + playbooks, not hardcoded flows), structures it as a
recursive VSM/MAPE-K loop, and gives a dependency-ordered, flag-default-safe full-code roadmap to
build it. Defense is immovable throughout: the offense (resident autonomy) is safe *only because* of
the inviolable rails below it and the body-change meta-rail above it; they are one system, never
separable.

---

## 1. The convergence — why six lanes describe one kernel

Each research lane approached the MD from a different discipline and arrived at the same shape. The
power of this dossier is that the mappings **agree**:

| INV-D stage | Cognitive arch (LANE 1) | Perception (LANE 2) | Cybernetics (LANE 3) | Planning/exec (LANE 4) | Metacognition (LANE 5) |
|---|---|---|---|---|---|
| **PERCEIVE** | LIDA *Understanding* + sensory codelets; CLARION *MS* drives | Endsley L1 + Friston surprise; the **Estate Radar** | VSM **Monitor** (feeds all levels) | GDA expectations over event streams | Nelson-Narens **monitoring** flow |
| **ORIENT** | RPD prototype recall; ACT-R activation; Soar elaboration | Endsley L2 comprehension (CEP fuses cues) | VSM **S4 intelligence** + S3\* audit; Klein **RPD** | HTN situation-type → method | RPD + CBR + Cynefin; the **competence tensor** read |
| **ORGANIZE** | CoALA *Propose→Evaluate→Select* | VoI / interruptibility gate | VSM **S3 control** + S2 coord; Ashby ranking | DAG schedule; consequence × reversibility | prospective **Triage** (feasibility/cost/select/sequence) |
| **CREATE** | Soar impasse→subgoal→**chunk** | requisite-variety detector (sensor-variety gap) | Ashby **requisite variety** → INV-C is mandatory | HTN learned-method capture | metacognitive *planning* (pick the gap, pick the mechanism) |
| **EXECUTE-TO-CLOSURE** | LIDA action selection; CoALA grounding | Endsley L3 projection → act before breach | VSM **S1 operations**; OODA tempo; feedforward | GDA semantic completion; **Closure Engine**; Saga | grounded **critic-in-the-loop** council + correction budget |
| **LEARN+REPEAT** | LIDA learning-from-broadcast; **sleep-time compute** | weak-signal amplification tracking | S3↔S4 homeostat update; Knowledge | ReasoningBank distillation; durable resume | **intrinsic metacognitive learning** (plan→act→evaluate→rollback) |
| **(meta) regulate** | CLARION **MCS** | prediction-error bus | the **3–4 homeostat**; algedonic channel | declared-budget enforcement | the **CONTROL gate** (Mirror's external scaffold) |

**The single most important external result across all lanes (Mirror, arXiv 2604.19809):**
metacognition must be **EXTERNAL ARCHITECTURE, not a prompt** — giving a model its own calibration
score changes nothing (p > 0.05), but an *architectural control loop* cuts the confident-failure
rate by **76%** (0.600 → 0.143). **INV-D's structured backend loop IS that external scaffold.** This
is the strategic license for the entire build: we win not by hoping the LLM introspects better, but
by making the *architecture* hold the self-knowledge and act on it — the LLM's only job is to
narrate, ground, and grow it.

---

## 2. The resident mind — the `EstateMind` kernel (concrete, always-on, durable)

### 2.1 The structural diagnosis (what's wrong today, in one sentence)

> The cognitive cycle is **triggered, not resident.** `think(req)` fires per HTTP request;
> `wake-loop.ts` is explicitly *"single-pass … callers schedule it (cron, queue worker)."* There is
> **no long-lived per-tenant mind** that runs PERCEIVE→…→LEARN on its own heartbeat and holds state
> between ticks. `grep` for `EstateMind | SituationalModel | residentMind` over the kernel returns
> **empty** — the organ does not exist. The DEEP cognition (LATS, debate, world-model, reflexion,
> modality arbiter, learning loop) lives on the request path and is mostly NOT invoked by the
> continuous loop. The continuous loop and the deep brain are two engines that do not yet meet.

### 2.2 The target — two concurrent loops, one mind

The 2026 production consensus (DPT-Agent two-loop, CLARION dual-level, sleep-time compute) is a
**Fast Loop** concurrent with a **Slow Loop**, sharing memory, arbitrated by a metacognitive
controller:

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  EstateMind (per tenant) — a resident, durable, recursively-viable mind                  │
│                                                                                          │
│   ┌──────────────── SLOW LOOP (estate-facing, perpetual heartbeat) ────────────────┐    │
│   │  EstateMind.tick():  PERCEIVE → ORIENT → ORGANIZE → CREATE → EXECUTE → LEARN     │    │
│   │  • WRITES the standing SituationalModel every tick (decays + spreads activation) │    │
│   │  • runs the GDA discrepancy organ → formulates its OWN goals (loops nobody asked)│    │
│   │  • drives open loops toward CONFIRMED closure (the Closure Engine + fabric)      │    │
│   │  • durable: each flow_id is a Temporal/Inngest workflow → survives restart       │    │
│   └─────────────────────────────────────▲───────────────────────────────────────────┘    │
│                       shared state       │  reads/writes                                  │
│   ┌─────────────────── SituationalModel (LIDA "overnight buffer") ─────────────────┐     │
│   │  per-entity activation field · open-loop registry · standing-concern status ·  │     │
│   │  Global-Workspace single broadcast = "the one thing I'd worry about right now"  │     │
│   └─────────────────────────────────────▲───────────────────────────────────────────┘     │
│                       reads (never recomputes cold)                                       │
│   ┌──────────────── FAST LOOP (owner-facing, sub-second `think(req)`) ───────────────┐    │
│   │  chat turn → reads the live SituationalModel → recognition-primed answer/action  │    │
│   │  the persona; one SSE contract; the owner experiences instant, warm, sure replies│    │
│   └───────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│   MCS (CLARION metacognitive subsystem) arbitrates compute between loops · CONTROL gate  │
│   ════════════════ INVIOLABLE FLOOR: money/licence/deletion HITL · LedgerService.post() ═│
│   ════════════════ META-RAIL CEILING: every body-change is a gated proposal (INV-C/E) ══│
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The owner experiences **instant chat**; the estate experiences a **tireless resident MD**. This is
the literal realization of INV-D's "continuous … in the BACKEND … the user ONLY chats."

### 2.3 The eight organs of `EstateMind` → named modules on our base

This is the spine of the build. Each organ is mapped to (a) the SOTA name, (b) the existing
`central-intelligence` module(s) it builds on, and (c) the *new* surface it needs. **No CoALA slot
is empty; the work is wiring + grounding + making the loop resident, not greenfield.**

| # | Organ (new name) | INV-D stage | SOTA name | Builds on (exists) | New surface |
|---|---|---|---|---|---|
| 1 | **EstateMind loop runner** | (all) | LIDA continuous cycle; two-loop fast/slow | `agency/initiative/wake-loop.ts` (single-pass), `orchestrator/main-loop.ts` (`think`) | resident `EstateMind.tick()` standing per-tenant durable workflow; Fast/Slow split |
| 2 | **SituationalModel** | PERCEIVE/ORIENT substrate | LIDA Current Situational Model; ACT-R activation field; ambient "overnight buffer" | `world-model/state-vectors.ts`, `regime-detector.ts` (per-call) | persistent, decaying per-tenant model; per-entity activation (recency×freq + spreading); open-loop registry; GWT single broadcast |
| 3 | **Estate Radar** | PERCEIVE | Endsley L1–L3; Friston surprise; Itti-Baldi Bayesian salience; CEP comprehension; Ansoff weak-signal | `packages/proactive-intel/*` (7 detectors, 3 dark + 3 opp dark), `kernel/sensors/`, `agency/initiative/real-detectors.ts` | prediction-error bus; Bayesian-surprise salience; BOCPD/CUSUM changepoints; CEP danger-shapes; horizon-scan lane; event-stream subscriber (`event_outbox`) |
| 4 | **Recognition engine (ORIENT)** | ORIENT | Klein RPD; ACT-R chunk; Cynefin; CBR | `persona/` schemas, `vp-personas/`, `fast-path-router` (IG&C), `world-model/regime-detector.ts` (market only) | typed `SituationPrototype` library {cues, goals, expectancies, primed action, sim-checks}; nearest-schema + nearest-case retrieve; no-match → drop to LATS + flag distillation |
| 5 | **Organizer / Triage (ORGANIZE)** | ORGANIZE | CoALA Propose→Eval→Select; prospective Triage; HRL options; VSM S3 | `orchestrator/plan.ts`, `lats-search.ts`, `risk-tier.ts`, `policy-gate.ts`, `four-eye-approval.ts`, `sub-mds/`, `modality-arbiter` (carries reversibility×consequence) | goal-level consequence×reversibility scorer; feasibility/cost/select/sequence primitives; **declare-then-honour** budget; DAG `dependsOn` edges; effort-scaled delegation |
| 6 | **Creator (CREATE / INV-C)** | CREATE | Soar impasse→chunk; Ashby requisite variety; HTN learned-method | `orchestrator/self-extension.ts` (no caller), `modality-arbiter` (default-off), `skill-library/`, `power-tools/`, `tool-spec/` | **mid-cycle impasse trigger** (not daily cron); variety-gap (`V(D)>V(C)`) trigger; learned-method capture; body-change meta-rail on every synth |
| 7 | **Closure Engine (EXECUTE)** | EXECUTE-TO-CLOSURE | GDA semantic completion; DAG+durable; Saga; grounded critic council; PCT closure | `agency/executor/`, `agency/action-tools/`, `agency/goals/goal-tracker.ts`, `stall-detector.ts`, durable substrate (Temporal/Inngest, opt-in), the operational fabric | per-goal **verifier** (effect asserted vs ledger/licence/world); L1 retry→L2 patch→L3 replan; Saga compensation on irreversible; durable resume; decorrelated multi-critic council + correction budget |
| 8 | **Learner + Competence Tensor (LEARN)** | LEARN+REPEAT + meta | sleep-time compute; ReasoningBank; intrinsic metacognitive learning; Nelson-Narens; conformal | `reflexion/`+`sleep/`, `continuous-grading.ts`, `prompt-evolution/`, `consolidation/`, `memory/` (memory-v2 Drizzle), `conformal-calibration-online/aci.ts` (zero live consumers) | competence tensor [domain×junior×task→(meta-d′/d′, coverage, CFR, maturity)]; per-domain conformal bank; intrinsic learn loop (plan→act→evaluate→rollback); inter-turn sleep-compute; ReasoningBank sink |
| — | **MCS + CONTROL gate** (governs all) | meta | CLARION MCS; System-1/2 meta-controller; Mirror external scaffold; the 3–4 homeostat; algedonic channel | `metacognition/`, `introspection/`, `self-awareness.ts`, `uncertainty-policy.ts`, `ttc-allocator.ts`, `model-tiering.ts`, `fast-path-router.ts`, `inviolable.ts`, `policy-gate.ts` | cross-loop compute arbiter; the **3–4 homeostat** organ (S5 engaged only on break); unified **algedonic spine**; CFR-SLO consumer |

---

## 3. How dynamism stays GENERAL (situation-types + playbooks, not hardcoded flows)

INV-D's hardest demand is **"GENERAL across any situation (never hardcoded per scenario)."** The
mechanism that delivers it is **Recognition-Primed Decision (Klein) over a typed, learnable
prototype library**, fused with Case-Based Reasoning — the formal antidote to both "blank-slate
think every turn" *and* "one bespoke `if`-branch per scenario."

**The ORIENT engine (organ #4) is the generality engine:**

1. **PERCEIVE emits cue-vectors** (organ #3), not headlines: cost-anomaly + cashflow-dip +
   offtake-slip fuse into one Endsley-L2 *Comprehension* object ("margin pincer"), scored by
   Bayesian surprise against the SituationalModel's expectation.
2. **ORIENT does nearest-prototype + nearest-case retrieval** over a `SituationPrototype` store —
   each prototype is data: `{situation-signature, cues-to-watch, typical-playbook, failure-modes,
   who-to-delegate-to, evidence-required, reversibility-class}`. A *recognised* situation runs the
   veteran's primed playbook (cheap, fast — the 80%). The playbooks are **rows authored from the
   corpus** (§7's corpus→playbook compiler), never `switch` statements in code.
3. **When NO prototype matches above threshold**, that mismatch is itself a *metacognitive signal*:
   "novel situation, Cynefin-complex" → drop to deliberate search (LATS/debate, the 20%) → **and
   flag the resolution for distillation into a new prototype** (Soar chunking; HTN learned-method
   capture). The library *grows itself*; tomorrow's identical situation is recognised, not searched.
4. **The same machinery is domain-agnostic.** Prototypes/playbooks/cases are an **ontology pack**:
   Borjie loads mining schemas (JORC/CRIRSCO, royalty, assay, offtake), BossNyumba loads real-estate
   schemas (RICS/IVS, rent-roll, WALT, cap-rate). The *kernel* never changes — only the loaded
   prototype rows + deterministic engines do.

This is why generality is **structural, not aspirational**: a new situation-type is a new *row* (a
prototype the corpus compiler emits or the owner teaches), the recognition step is one
vector-similarity retrieve, and novelty automatically routes to deep reasoning + self-distillation.
There is no scenario the kernel cannot *attempt* — recognised → playbook; novel → search + learn the
new playbook. Ashby's Law makes this non-optional: a fixed flow catalog can never match an unbounded
estate's variety, so the catalog must **self-extend** (organ #6 / INV-C).

---

## 4. Veteran-grade & recursive — the VSM / MAPE-K structuring

INV-D's six phases are **MAPE-K** (Monitor→Analyze→Plan→Execute over shared Knowledge) with a CREATE
phase bolted on; the organizational frame that makes it veteran-grade is **Beer's Viable System
Model** (S1–S5 + algedonic channel + recursion). The kernel should be **explicitly** a Viable System
whose loop is MAPE-K, whose decision style is RPD/OODA (recognition-first, search-on-failure), whose
commitment layer is BDI, and whose sizing law is Ashby's requisite variety.

| VSM organ | Role | INV-D / EstateMind binding | Code today |
|---|---|---|---|
| **System 5 — Policy/Identity** | mandate, ethos, rails; *rarely intervenes* | `inviolable.ts`, `policy-gate.ts` high-risk-literal, persona mandate; the immovable floor/ceiling | strong |
| **System 4 — Intelligence** | model the future, scan environment (feedforward) | Estate Radar projection (L3) + `world-model/regime-detector` + forecasting; ORIENT | partial |
| **System 3 — Control** | allocate today's resources, gate, autonomy posture (feedback) | Organizer/Triage (organ #5) + `autonomy/` + `executor` policy | partial→strong |
| **System 3\*** — Audit | inspect past performance | `continuous-grading`, audit chain, reflexion retrieve | strong |
| **System 2 — Coordination** | de-conflict, dispatch | `tool-dispatcher`, `planner-dispatcher`, modality arbiter | strong |
| **System 1 — Operations** | the *doing* — juniors + sub-MDs | `agency/executor/`, `sub-mds/*`, ~50 juniors in `ai-copilot` | strong |
| **Algedonic channel** | pain/pleasure that *bypasses* hierarchy → S5 | `stall-detector`, `wake-triggers`, kill-switch, four-eye (disjoint today) | partial — **no unified spine** |

**Three veteran-grade structural moves the dossiers converge on:**

1. **The 3–4 homeostat as a first-class organ.** S4 (regime/forecast — tomorrow, outside) and S3
   (capacity/commitments — today, inside) are in permanent tension; **S5 (the owner) is engaged
   ONLY when that balance breaks.** This is Beer's "if the 3–4 homeostat works, S5 has little to
   do" — the *principled* replacement for today's ad-hoc per-feature escalation and the cure for
   owner-fatigue. A `Homeostat34` module emits a single scalar balance signal; the owner is bothered
   on break, not on a fixed approval-tier table.
2. **A unified algedonic spine.** One pain/pleasure channel any node at any recursion level can
   fire, that *bypasses* the report hierarchy and lands on S5 after a timeout, with *pleasure*
   signals (a deal closed, a forecast beaten) reinforcing the prototype that produced them. Fold
   `stall-detector` + `wake-triggers` + kill-switch + four-eye into this spine. The difference
   between a smoke detector (push-on-pain, guaranteed escalation) and a quarterly report (pull).
3. **Recursive sub-MDs — the flagship leap (and the *only* variety-viable architecture at scale).**
   Beer: *every viable system contains viable systems all the way down.* Our `sub-mds/*` pipeline
   `OBSERVE → MAP → REDESIGN → AUTOMATE` **already is MAPE-K** scoped to a reversible task-contract,
   with `recordOutcome(actual, predicted)` as the Knowledge write-back — so **each sub-MD is already
   a viable mini-MD at recursion level −1; it just isn't framed or wired as one.** The leap: give the
   registry a `parentMd` edge, a per-node S5 identity, and a per-node algedonic threshold. The estate
   becomes a *fractal of MDs*: estate-MD (S5 = owner mandate) → site-MD (a Geita pit is its own
   viable system) → function-MD (the royalty-chaser is viable over its slice). Variety is handled
   locally at each level; only the residual escalates up the algedonic line. Ashby's Law proves this
   is the *only* architecture that can regulate an estate's unbounded variety — flat agent swarms
   cannot, because they have no S5 identity per level. **No shipped product runs a recursively-viable
   org-brain.** Tiered intelligence aligns to organs: frontier models for S4/S5 strategic reasoning,
   cheap local models for S1–S3 routine ops (re-key `model-tiering.ts` to the organ map).

**RPD/OODA + BDI as the decision discipline.** A **recognition gate in front of LATS** makes the
common case veteran-fast and cheap, reserving 4×–15× token tree-search for genuine novelty — with a
measured `recognition-rate` KPI (% of turns resolved by schema-match vs tree-search) as a direct
proxy for "how veteran the MD has become," which *rises over the estate's life as the playbook
library compounds.* **BDI intention-commitment** gives goals a commitment state so the MD doesn't
re-decide everything each turn — an intention drops only on explicit reconsideration triggers
(achieved / impossible / superseded by S5) — yielding stable multi-day pursuit of an objective
through hundreds of unrelated chat turns (the behavioural signature of a real MD vs a stateless
assistant).

---

## 5. Identifying loops the user has no idea about → driving them to closure

This is INV-D's signature capability and the hardest bar (PROBE's best end-to-end agent proactivity
is **40%** — frontier models still *struggle* here). It is **two pipelines wired into one organ**.

### 5.1 The perception → attention → goal pipeline (find the unseen loop)

> Perception is **not a feed — it is a control problem.** A veteran holds a small set of **standing
> concerns** (cash never breaks, the licence never lapses, no counterparty quietly rots, grade never
> silently drifts, margin is protected, the workforce is safe, treasury is hedged) and continuously
> asks of every signal: *"does this move me toward or away from a concern, by how much, and how
> surprising is it?"*

The pipeline (Estate Radar, organ #3 → SituationalModel, organ #2 → GDA, organ #7):

1. **Standing-Concerns Registry (BDI maintenance/interest goals)** in memory-v2 — durable,
   *learnable* (the MD adds "watch buyer X's parent company" after a near-miss). A goal-monitor
   evaluates every event against it.
2. **Surprise-driven attention (Friston + Itti-Baldi).** Every detector reports `surprise` =
   `KL(posterior ‖ prior)` against the SituationalModel's expectation — one **prediction-error bus**,
   one currency. This ranks the *non-obvious* above the loud-but-boring (replaces today's literal
   `ratio > 1.5` thresholds). BOCPD/CUSUM changepoints catch slow regime shifts (a silent grade
   drift) invisible to point thresholds.
3. **Comprehension (Endsley L2 / CEP).** A pattern engine over the event stream fires when a
   *sequence across domains* forms a veteran "danger shape" (`vendor_delivery_late ×3` THEN
   `invoice_dispute` THEN `credit_rating_drop` within 30d → "supplier failing") — the loop the owner
   never saw forming.
4. **Projection (Endsley L3 / Rosen anticipation).** Each concern carries a near-future trajectory +
   **lead-time-to-act** ("at this trend the licence renewal collides with the rains and the FX
   window; act in the next 10 days") — feed-forward, not breach-alert.
5. **GDA goal formulation.** A *discrepancy* (expected ≠ observed against a standing concern) →
   **the MD formulates its OWN goal** keyed by `flow_id`. This is the formal organ behind "identify
   loops the user has not asked about." Goals rank by **consequence × reversibility** (the
   goal-motivation-weight idea fused with our 2-D reversibility×blast-radius).
6. **VoI × interruptibility gate.** `surface_now = (value_of_acting_early − cost_of_interruption_now)
   > 0` — trivial-but-true goes to the daily digest; a cash-cliff in 7 days interrupts immediately.
   Learnable from owner accept/dismiss feedback (ProactiveBench's False-Detection/Non-Response
   contract) so it is *never annoying, never silent on a cliff.* The Global-Workspace single
   broadcast — "the one thing I'd worry about as your MD right now" — *is* the morning brief.

### 5.2 Driving to confirmed closure (bind the operational fabric)

The other half is **never stopping at "proposes"** (the 2026 bar: "proposes" is now table-stakes
*failure*). The **Closure Engine** (organ #7) binds the `OPERATIONAL_CLOSED_LOOP_FABRIC`:

```
DETECT (outbox) → REGISTER loop → SCHEDULE durable ladder → FIRE once (idempotent, audit-chained)
  → ROUTE on preferred channel (+ fallback, receipts) → ACT (junior drafts remediation, not nags)
  → ESCALATE up the org/rota chain (policy is data) → FOLLOW-THROUGH a tracked task
  → CONFIRM closure from SOURCE OF TRUTH (ledger posting / licence row), never from a message read
  → AUDIT every step (hash-chained, at-least-once) → LEARN (self-tune ladder/channel per recipient)
```

The closure invariant comes from **Perceptual Control Theory + GDA semantic completion**: a goal is
`complete` **iff the controlled perception matches its reference** — the royalty is *filed*, the
receipt is *in the ledger*, the licence row *reflects it* — verified by a per-goal **grounded
verifier** that re-queries real state (not "I proposed a royalty filing"). Recovery is **strictly
leveled (Graph Harness): L1 bounded retry → L2 local patch → L3 full replan** — never ad-hoc LLM
retry, never abandon-on-first-failure (a veteran re-routes). Every replan mints a *new immutable plan
version* into the hash-chained audit. **Durable execution** (Temporal/Inngest, already vendored)
makes a multi-day drive **resume exactly where it stalled** after any crash/rollout — the BDI
intention *re-commits itself*; the intention ledger *is* the journal.

**The rail through all of it (INV-D + INV-F + INV-G):** the Closure Engine grows *capability to
drive loops to confirmed closure*, but **money / licence / deletion are never auto-closed** — they
reach a **gated HITL checkpoint** or are **Saga-compensated** (run-to-completion or
compensate-as-if-never-happened via `LedgerService.post`), never bypassed. Autonomous where
reversible + granted; gated otherwise; durable so horizon is uncapped — but the rails are the moat.

---

## 6. Persona-simplicity — all backend, the user just chats

The product invariant: the user **only ever chats** one persona; behind that single thread the
12-agent kernel, ~50 juniors, the Auditor gate, memory-v2, the proactive loop, and the resident
`EstateMind` run with **no knobs.** This is structurally sound today in three ways (verified):

1. **No user-selected mode.** Persona lens(es) are classified *internally* from the message
   (`classifyLenses`); the owner never picks a CEO mode or a persona; portal→persona is O(1).
2. **Rails enforced backend, not exposed.** The 9-hook chain, four-eye, kill-switch, modality
   arbiter all run *inside* `think()` — surfaced only as an occasional "I need your sign-off on X,"
   never a settings page. The **Session → Governor → Executor** separation (the chat layer emits
   *intents only*, with no bypass channel to the executor) already matches the SOTA security-cognition
   bar — formalize it as a typed `IntentFirewall` invariant, don't re-architect it.
3. **One SSE contract.** A single typed event union streams text + (optional) citation panel; the
   junior fan-out + evidence-id union + conformal wrap are server-side.

**The four presentation gaps that separate "a chatbot that sometimes does things" from "a colleague
quietly running the estate and reporting back"** (all backend-presentation, no new cognition):
- **(i) A unified colleague inbox** over the three SOTA HITL touchpoints — **notify / question /
  review** ("MD did X" / "MD asks Y" / "MD needs sign-off on Z"). We have the backend half
  (`proactive_nudge` rows, `tab_proposals_inbox`, cockpit `tab.proposed`) but delivery is a
  tab-suggester drain, not a first-class inbox.
- **(ii) An activity/timeline panel** so the deep cognition can *show its work* like a colleague
  narrating ("searching 3 databases…", the plan step-list with checkmarks) — the `stage-event-bus`
  data exists (intent→megaprompt→plan→step→outcome) but is an OTel/learning seam, not yet projected.
- **(iii) Honest binary confidence.** SOTA: "confident / not sure" beats "73%" for decision speed —
  but the brain **hard-stamps `confidence = 1`** on every orchestrator answer
  (`translateOrchestratorResponse`), so the persona currently *cannot honestly hedge* (this is
  overconfidence by construction — RSS-22, a BLOCKER-class defect; it is the *exact* Mirror
  pathology). **Fix: run the real confidence scorer + policy-gate + conformal abstention BEFORE
  translation.**
- **(iv) Earned/graduated autonomy.** SOTA escalates approve-each → auto-execute over N clean
  approvals; ours is set manually (no AUT-04 ramp).

**The one-chat front is the simplicity contract; the resident mind is the depth behind it.** They
are complementary: the Fast Loop reads the Slow Loop's situational model, so chat is instant *and*
warm *and* honestly calibrated.

---

## 7. Metacognition + self-calibrated expertise on the whole mandate

A veteran is defined by two things an answer-model lacks: **metacognition** (a meta-level that
*watches* the object-level, knows the edge of its own competence, and converts that into action —
proceed / verify / abstain / ask / delegate / escalate / build-a-tool) and **compiled domain
expertise** (recognition-primed schemas distilled from corpus + tacit cases, so it recognises the
situation-type instead of re-deriving it). The decisive directive (§1, Mirror): **make the
*architecture* hold the self-knowledge, not the prompt.**

### 7.1 The CONTROL gate (Nelson-Narens MONITOR→CONTROL, made architectural)

Per turn (the same loop as MGV / OODA): **MONITOR** computes calibrated confidence via a three-layer
stack — semantic entropy + self-consistency + the relevant **per-domain conformal τ** (one online ACI
state per domain-schema; compositional tasks take the *min* coverage across touched domains) — then
**CONTROL** *changes control flow*: if uncertainty > τ → abstain / ask / escalate / defer-to-bigger-
model; if a HIGH-risk prefix (money/licence/deletion) → HITL always. **Confidence-TRIGGERED
intervention** (MGV): spend extra compute only where monitoring flags risk, made
**value-of-information-aware** (a veteran does not re-think a $50 decision and a $5M licence call with
equal effort). Today's blockers: `confidence.ts` is a regex `min()` that never gates; the brain
stamps `confidence = 1`; the conformal ACI machine has **zero live consumers**; recursive-HOT mixes a
hedge into the *prompt* (the worthless self-report). The fix is wiring, not greenfield.

### 7.2 The Competence Tensor (the MD's self-model of its own expertise)

The singular metacognition artefact: **one tensor `[domain × junior × task-class → (meta-d′/d′,
conformal-coverage, confident-failure-rate, schema-maturity)]`**, (a) **READ** at ORIENT/MONITOR to
decide recognition-vs-search and proceed-vs-abstain-vs-delegate, (b) **WRITTEN** at LEARN from
grounded outcomes (EMA boundary-learning, MetaCogAgent), and (c) the **objective function** of the
nightly self-improvement loop. Delegation routes on *learned composite confidence*
(`c = λ·c_verbalized + (1−λ)·c_profile`), with a verbalized-vs-historical *conflict detector* as a
conservatism trigger. A per-tenant per-domain **confident-failure-rate SLO** — the one number Mirror
proves actually moves safety — feeds the autonomy controller (a domain whose CFR exceeds threshold is
auto-demoted to gated and preferentially trained).

### 7.3 Grounded critic-in-the-loop (the EXECUTE-TO-CLOSURE gate)

*Intrinsic* self-correction is fragile ("the model that generated the wrong answer shares that exact
blind spot when evaluating itself"). The gains live in **grounded** correction — the verify step
re-queries the *ledger / licence rows / corpus*, not just re-prompts. A **decorrelated multi-critic
council** (proposer / solver / grounded-verifier / constitutional-critic) with a **correction budget
(~3 rounds) then HITL** is Reflexion + PRM + debate fused into one closure gate; the council's
*disagreement* is itself a calibration signal.

### 7.4 Compiling the corpus into expertise (breadth on the whole mandate, structured)

A veteran is not a search engine over a manual; the manual is *compiled in*. The **corpus → playbook
compiler** (a nightly standing org) ingests each mandate domain and emits the §3 triple: (a) a typed
**schema** (the ORIENT vocabulary), (b) explicit **deterministic rules/thresholds** (GOFAI-style,
human-validated — "if grade < cutoff then sub-economic"), and (c) a **recognition classifier**. The
deterministic rules become the spine of the domain juniors (**deterministic-engine + LLM-narration +
Auditor-gate** — correctness from rules, a veteran's *voice* from the LLM, evidence-grounding from
the Auditor; the LLM never *invents* the rule). **Tacit veteran knowledge** (the part no corpus
contains — "she'd push back here," "this counterparty always slips on settlement") is distilled into
governed, versioned skills from three sources under skill-governance gates: owner corrections
(COLLEAGUE.SKILL patches), verified successful trajectories (Voyager capture), and the MD's own
near-misses. A **domain-maturity ladder** (NONE → SHALLOW → DEEP → VETERAN per domain) makes
self-knowledge legible and is the *deliberate growth target* of the nightly loop. **The intrinsic
metacognitive learning loop** (the LEARN step): (1) recompute the competence tensor; (2) *plan what
to learn* — rank blind-spots by `consequence × frequency × (1 − coverage)`, pick the mechanism per
gap (ingest / distil-schema / synthesize-tool / GEPA-optimise-prompt / spawn-sub-MD); (3) *evaluate*
— replay held-out cases, confirm coverage rose, else **roll back** (DGM archive). The alignment
invariant: the agent may grow capability, but the meta-rail (`inviolable.ts`) is immutable to it —
money/licence/deletion stay HITL forever.

---

## 8. CREATE invoked mid-cycle (tool/organ synthesis, INV-C)

Ashby's Law makes CREATE **mandatory, not optional**: the estate generates effectively unbounded
variety (licences × minerals × people × markets × regs × equipment × weather), and a *fixed* tool
catalog can never match it (`V(controller) ≥ V(disturbance)`). So tool-synthesis is **requisite
variety**, and it must fire **mid-cycle, on impasse — not on a daily cron.**

- **The Soar trigger (immediacy).** The moment the cycle *cannot decide* — no matching tool, an
  ambiguous evaluation, a repeated stall — the orchestrator raises an **impasse** and calls
  `self-extension.ts` **in-loop**, then **chunks** the resolution into the skill-library so the
  identical impasse never recurs. This closes the gap between Soar's mid-cycle immediacy and our
  batch detection (`detectRecurringGap` runs as a daily job today; `proposeNewSubMd` →
  `compileAndDeploySubMd` has **no scheduler caller** — built but dark).
- **The Ashby trigger (variety law).** A measured **requisite-variety gap** (`V(D) > V(C)` — a
  coverage map of estate-failure-modes vs the sensor/tool repertoire) is the *formal* control-law
  trigger to synthesize a new detector / tool / sub-MD — turning tool-creation from a heuristic into
  a closed cybernetic loop that *provably keeps requisite variety as the estate grows.*
- **The HTN trigger (planning gap).** When no method matches a situation-type, the LLM decomposes it
  (ChatHTN-sound), and the decomposition is **captured (human-gated) as a new learned method** — the
  playbook library grows; LLM queries drop ~75% on the next instance.
- **The gate (always).** Every synthesis flows through the **body-change meta-rail** (INV-C/INV-E):
  reasoned-need · proposal-gated · chat-refinable · reversible · hash-chain audited; organs flow
  `draft → shadow → canary → live → deprecated → archived`; **deletion is HITL, never autonomous,
  archive-first.** The modality arbiter is the 7-way head (SKILL/WORKFLOW/LOOP/…) synthesis lands on
  — currently DEFAULT-OFF (`BORJIE_MODALITY_ARBITER` canary), so turning it on (safely) is a Wave
  milestone, not a rewrite.

CREATE is therefore woven through the cycle, not a separate phase: ORIENT's no-match flags a missing
prototype; ORGANIZE's missing-tool flags a missing organ; the impasse fires synthesis *now*; LEARN
captures the resolution as a reusable method/skill. The mind extends its own body to meet the
mandate — within the immovable rails.

---

## 9. Same kernel for Borjie + BossNyumba

The kernel is **built once, domain-agnostic, in Borjie, and inherited by BossNyumba** by pointing it
at the other **ontology pack** (entity/edge classes + SHACL shapes) plus the **deterministic domain
engines** (mining: JORC/CRIRSCO, royalty, assay, offtake; real-estate: RICS/IVS, rent-roll, WALT,
cap-rate). Every organ in §2.3 is domain-free: the `EstateMind` loop, the SituationalModel, the
Estate Radar's surprise bus + CEP engine, the RPD prototype library, the Triage organizer, the
Closure Engine + fabric, the Competence Tensor, the MCS + CONTROL gate, the recursive VSM. **Wherever
this dossier says "mining," read "or real-estate."**

The INV-D verdict is therefore **structurally identical** across both products (same spine, same
gaps), with two BN-specific deltas from the code audit: BN is **behind on embodiment** (it has
actuators but no body-model / system-graph / mutation-authority — EA-10, so its body-change rail for
CREATE is weaker) and **far behind on domain depth** (its real-estate junior set is essentially
unbuilt — DM-12, so its EXECUTE-TO-CLOSURE has fewer organs to delegate to). The kernel build below
serves both; BN parity is then a matter of (1) loading the real-estate ontology pack, (2) building
BN's body-model layer, and (3) manufacturing BN's domain juniors via the same corpus→playbook factory.

---

## 10. Build roadmap — dependency-ordered waves (flag-default-safe)

**Build discipline.** Every wave ships behind a **default-OFF flag**, in **shadow → canary → live**
order; nothing changes a default turn until proven; the **inviolable floor** (money/licence/deletion
HITL, `LedgerService.post`) and the **body-change meta-rail ceiling** are wired *first* and are never
relaxed by any later wave. Predictions APPEND to rule-based decisions; migrations are immutable;
EN/SW purity is absolute. Map each wave to existing register rows (COG/AUT/EA/MEM/RSS/EXEC/KI) and
build on the existing `central-intelligence` base — **wiring + grounding, not greenfield.**

> **🚧 BLOCKER (must land before Waves 2+ have honest behaviour):** remove overconfidence-by-
> construction — stop hard-stamping `confidence = 1` / `gates = pass` in
> `translateOrchestratorResponse`; run the real confidence scorer + policy-gate + conformal
> abstention BEFORE translation (RSS-22, COG-03). Until this lands, *no* metacognitive wave can gate
> honestly, and the persona cannot say "not sure."

### Wave 0 — Foundations & honesty (turn-the-lights-on; unblockers)
*Flag-gated; makes the resident mind *possible* and the persona *honest*.*
1. **W0.1 — Honesty unblock (BLOCKER).** Real `ConfidenceVector` scorer (claim-extraction + NLI for
   groundedness; turn on the re-roll for stakes ≥ high) → feed `conformal-calibration-online/aci.ts`
   → consume calibrated τ in `uncertainty-policy`; remove the `confidence = 1` stamp. (COG-03,
   COG-10, RSS-22). **Blocker for all metacognition.**
2. **W0.2 — Register the dark detectors.** Wire the 4 remaining anomaly + 3 opportunity detectors in
   `proactive-intel/detector-registry.ts` (one import each — the cheapest high-leverage win). Schedule
   the regulator-feed adapter (KI-16/17). *No new cognition; the radar can finally see opportunities.*
3. **W0.3 — Durable substrate live.** Deploy the Inngest/Temporal worker (already vendored, opt-in,
   dark); swap `createInMemoryPlanStore` for a Drizzle journal store (RSS-23, G6/G7). *Prerequisite
   for any resumable resident loop.*
4. **W0.4 — Rails/meta-rail audit + IntentFirewall type.** Confirm the inviolable floor + body-change
   ceiling are wired and tested; formalize Session→Governor→Executor as a typed `IntentFirewall`
   invariant. *Defense-first; everything below leans on it.*

### Wave 1 — The standing situational model (the #1 missing organ)
*Flag-gated read-path; nothing acts on it yet.*
1. **W1.1 — `SituationalModel` object** (organ #2): persistent, decaying per-tenant model extending
   `world-model/state-vectors.ts`; per-entity ACT-R activation field (recency×freq + spreading);
   open-loop registry; the Global-Workspace single broadcast. (COG-15).
2. **W1.2 — Estate Radar comprehension + surprise** (organ #3): prediction-error bus
   (Friston/Itti-Baldi salience replacing fixed thresholds); BOCPD/CUSUM changepoints per key series;
   CEP danger-shape engine (Endsley L2); event-stream subscriber on `event_outbox` (EA-07). Writes
   *Comprehension* + *Projection* (L3, lead-time-to-act) objects into the SituationalModel.
3. **W1.3 — Standing-Concerns Registry** (BDI maintenance/interest goals) in memory-v2 + goal-monitor
   (PASK-grounded; learnable after a near-miss).

### Wave 2 — ORIENT: recognition engine (the generality engine)
*Flag-gated; Fast Loop reads it, falls back to today's path on no-match.*
1. **W2.1 — Typed `SituationPrototype` library** (organ #4): {cues, goals, expectancies, primed
   action, sim-checks, reversibility-class}; nearest-schema + nearest-case (CBR) retrieve; Cynefin
   classify. (COG-15, the single biggest cognitive gap).
2. **W2.2 — Recognition gate in front of LATS** (RPD-first): recognised → primed playbook;
   no-match → LATS/debate + flag for distillation; measure `recognition-rate` KPI.
3. **W2.3 — Per-domain conformal bank + competence tensor v1** (organ #8 read-path): one ACI state
   per domain-schema; tensor read at ORIENT/MONITOR. (COG-03 leap, §7.2).

### Wave 3 — The resident `EstateMind` loop (Fast/Slow split — the structural fix)
*The keystone. Flag-gated per tenant; canary on internal tenants first.*
1. **W3.1 — `EstateMind.tick()` Slow Loop** (organ #1): promote the cycle out of `think(req)`/cron
   into a long-lived per-tenant durable workflow that runs PERCEIVE→ORIENT→…→LEARN on a heartbeat,
   holding the SituationalModel between ticks; the MCS arbitrates compute between loops.
2. **W3.2 — Fast Loop reads the resident model:** `think(req)` reads the live SituationalModel
   instead of recomputing cold; warm, instant, calibrated chat.
3. **W3.3 — GDA discrepancy organ → self-formulated goals** (organ #7 front): expected ≠ observed →
   the MD's *own* `flow_id` goal; rank by consequence × reversibility; the loop the owner never saw.
4. **W3.4 — Inter-turn sleep-time compute:** run reflexion/consolidation in idle gaps (pre-stage open
   loops, fold the day into the model); reflection as a coherence SLO (degradation alarm).

### Wave 4 — ORGANIZE + EXECUTE-TO-CLOSURE (the Closure Engine + fabric)
*Flag-gated; reversible loops auto-drive, irreversible reach gated checkpoint / Saga.*
1. **W4.1 — Goal-level consequence×reversibility scorer + prospective Triage** (organ #5):
   feasibility/cost/select/sequence; **declare-then-honour** budget enforced at the meta-rail.
   (COG-12, AUT-05).
2. **W4.2 — Immutable-plan DAG scheduler:** `dependsOn`/`all_of`/`any_of` edges; real parallel sub-MD
   dispatch; **L1 retry → L2 patch → L3 replan** as the *only* recovery path; effort-scaled
   delegation. (EXEC-dag, COG-13, G4/G5/G10).
3. **W4.3 — Grounded per-goal verifier + multi-critic council** (organ #7 closure gate): effect
   asserted vs ledger/licence/world (PCT closure); decorrelated council + correction budget then HITL.
   (COG-12, AUT-06, §7.3).
4. **W4.4 — Bind the operational closed-loop fabric:** `loop_registry` + durable ladder + channel
   router + escalate-on-inaction + closure-from-source-of-truth + Saga compensation on irreversible.
   (OPERATIONAL_CLOSED_LOOP_FABRIC; EXEC-saga, RSS-01).

### Wave 5 — CREATE mid-cycle (INV-C, requisite variety)
*Flag-gated; modality arbiter canary-on; every synthesis is a gated proposal.*
1. **W5.1 — Mid-cycle impasse → in-loop self-extension + chunk** (organ #6): raise an impasse the
   instant a decision can't be made; call `self-extension.ts` in-loop; chunk into skill-library.
   (AUT-02 — give self-extension a caller).
2. **W5.2 — Variety-gap trigger:** measured `V(D) > V(C)` coverage map drives detector/tool/sub-MD
   synthesis (B7); HTN learned-method capture (online-HTN, COG-14).
3. **W5.3 — Modality arbiter ON (canary):** route SKILL/WORKFLOW/LOOP modalities; organ lifecycle
   draft→shadow→canary→live; deletion HITL archive-first (INV-E). (COG-07/AUT-14).

### Wave 6 — Recursive VSM + veteran structure (the flagship leap)
*Flag-gated; each level inherits the rails.*
1. **W6.1 — Recursive sub-MDs:** add `parentMd` edge + per-node S5 identity + per-node algedonic
   threshold; promote `sub-mds/*` from task-contracts to recursion-level VSM nodes. (B1).
2. **W6.2 — The 3–4 homeostat organ:** `Homeostat34` holds S4-future vs S3-present → single balance
   scalar; **owner (S5) engaged only on break** (B2; cures owner-fatigue).
3. **W6.3 — Unified algedonic spine:** fold stall-detector + wake-triggers + kill-switch + four-eye
   into one push-on-pain channel; pleasure signals reinforce the prototype that produced them. (B3).
4. **W6.4 — Re-key tiered intelligence to VSM organs** (frontier→S4/S5, cheap→S1–S3); BDI
   intention-commitment discipline (B5).

### Wave 7 — LEARN: intrinsic self-improvement + compiled expertise
*Flag-gated nightly loops; every body-change gated; rollback on regression.*
1. **W7.1 — Competence tensor write-path + CFR SLO:** EMA boundary-learning from grounded outcomes;
   per-domain confident-failure-rate SLO → autonomy controller + curriculum. (§7.2; RSS-16, AUT-11).
2. **W7.2 — Corpus → playbook compiler:** nightly emit {schema, deterministic rules, recognition
   classifier} per domain; deterministic-engine + LLM-narration + Auditor-gate; human-validated rules.
   (KI-10 miningOntology; §7.4).
3. **W7.3 — Tacit-skill apprentice→master pipeline:** distil owner corrections (COLLEAGUE.SKILL),
   verified trajectories (Voyager, AUT-03), and near-misses into governed versioned skills; domain-
   maturity ladder. (AUT-03/04).
4. **W7.4 — Intrinsic metacognitive learning loop:** plan-what-to-learn → act (ingest/distil/
   synthesize/optimise/spawn) → evaluate (coverage rose?) → rollback (DGM archive); ReasoningBank
   sink; route LATS reflections. (AUT-06, COG-16, §2.7).

### Wave 8 — Persona-front polish (presentation-of-autonomy)
*No new cognition; makes the resident mind *feel* like a colleague.*
1. **W8.1 — Unified colleague inbox** over notify / question / review.
2. **W8.2 — Activity/timeline panel** projecting `stage-event-bus` (show-its-work).
3. **W8.3 — Honest binary confidence in chat** (depends on W0.1).
4. **W8.4 — Earned/graduated-autonomy ramp** (AUT-04).

**Dependency spine (the critical path):**
`W0.1 honesty + W0.3 durable + W0.4 rails` → `W1 SituationalModel` → `W2 ORIENT recognition` →
**`W3 EstateMind resident loop`** (the keystone) → `W4 Closure Engine` → `W5 CREATE mid-cycle` →
`W6 recursive VSM` → `W7 LEARN/expertise` → `W8 persona polish`. Waves 1–2 can proceed in parallel
once W0 lands; W3 requires W0+W1+W2; W4–W7 each require W3; W8 requires W0.1 (and reads everything).

---

## 11. The one-line takeaway

By CoALA's own classifier Borjie's kernel is **already a complete cognitive architecture** with an
unusually strong metacognitive subsystem and real self-extension — ahead of most 2026 agent harnesses
on stage coverage. The one thing standing between it and the world-class bar is the **trigger model**:
graduate from a per-request / per-cron cognitive *chain* into a **resident, continuously-cycling,
recursively-viable estate-MD mind** — `EstateMind` — built explicitly as **a Viable System (Beer
S1–S5 + algedonic + recursion) whose loop is MAPE-K, whose decision style is RPD/OODA (recognition-
first, search-on-failure), whose commitment is BDI, whose perception is a surprise-driven Endsley
radar, whose closure is a GDA + durable + Saga + grounded-critic engine, whose self-knowledge is an
outcome-learned competence tensor, and whose body extends itself by requisite variety** — all behind
one chat, all on the immovable rails, identical for Borjie and BossNyumba. INV-D wrote this cycle in
prose; this dossier is the architecture, the code we already have, and the dependency-ordered,
flag-default-safe roadmap to build it.
