# THE SOTA WIRING FRONTIER — the maximal, buildable, governed wiring vision

**Document:** `Docs/research/THE_SOTA_WIRING_FRONTIER.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** deep-reasoning synthesis — no code, no commit. The single maximal
wiring vision, distilled from the five frontier-research dossiers and reconciled
with the already-chosen connective architecture.
**Bar:** SOTA, best-in-the-world, fiduciary-grade. Every item REAL + governed —
never sovereign; money / licence / deletion stay HITL; budget + fail-safe +
egress/input guards always hold.
**Owner directive:** *"THINK ABOUT WIRING WAYS WE DON'T EVEN KNOW WE CAN DO —
deep research, expand to 1000000%, FULL SOTA."*

**Synthesizes (all read in full):**
- `wiring-model-orchestration.md` — MoA, cascades, learned routers, test-time
  compute, DSPy/GEPA-compiled routing, bandit portfolios, the "compiled council."
- `wiring-connective-substrate.md` — blackboard global-workspace, stigmergic
  pressure-fields, A2A/MCP/AG-UI/A2UI protocol rim, dynamic-topology arbitration,
  durable-exec backbone, supervision trees, Linda tuple-space generative coordination.
- `wiring-self-autonomic.md` — L1/L2/L3 self-wiring (BaRP bandit / GEPA reflective
  / ADAS-DGM constructive), MAPE-K self-{config,heal,optimize,protect}, the
  invariant-floored fitness contract.
- `wiring-control-plane-closedloop.md` — feature-flags/progressive delivery,
  canary/A-B of *wiring configs*, ParetoBandit + MALBO Pareto-optimization,
  OBSERVE→RECOMMEND→APPLY→OBSERVE, policy-as-code gate, value-weighted compute.
- `wiring-exotic-frontier.md` — market/economic coordination, holonic/fractal
  org-brain, active-inference EstateMind, world-models-as-substrate, swarm
  stigmergy, neuro-symbolic governance, knowledge-graph-as-nervous-system,
  biological physiology (hormone bus, immune system, causal routing).

**Reconciled with (the already-chosen architecture this vision extends, not replaces):**
`THE_ORCHESTRATION_ARCHITECTURE.md` (the OK-1..OK-8 keystones, Wave 0–6) and
`MASTER_WIRING_CLOSURE_PLAN.md` (the 43-gap closure, Wave 1–10). **Those two docs
are the awakening — turning the dark organs ON. This doc is the expansion past the
awakening — turning the awakened organism into one that wires, tunes,
prices, and grounds itself.** Wave 0 below *is* the control plane + closure waves
now being built; every later wave assumes the lights are on.

---

## 0. The thesis, in one paragraph

Borjie has, almost by accident, built every *primitive* the 2026 frontier of agent
wiring now says is SOTA — a hash-chained CRDT blackboard that the literature
independently converged on (CodeCRDT, bMAS) as the right coordination spine; a
CoALA kernel with test-time-compute allocation, debate, semantic cache, and a
DSPy/MIPROv2 port; a brain-llm-router with cost-cascade, judge-loop, hedging,
eval-drift logging and a dynamic model registry; a just-launched admin control
plane (core LLM + ordered fallbacks + ensemble {first-wins/vote/judge/debate} +
per-use-case routing + AI-suggest); a cost-weighted budget governor with tiers and
auto-downgrade; a resident, leader-elected, propose-only EstateMind Slow Loop; an
agent-platform with A2A/MCP/webhooks/idempotency; an unwired Inngest durable-exec
backbone; the typed, bi-temporal Canonical Mining Graph; and the inviolable
governance moat (policy-gate, RLS, kill-switch, IP-egress + input-containment
guards, append-only audit chain). **The frontier is not "build these" — it is
"wire them into one self-wiring, self-tuning, market- and holonic-coordinated,
world-model-grounded organism whose every rewire is a governed proposal on the
audit chain and whose authority can never cross the inviolable floor."** This doc
is that vision: maximally ambitious, but every wave is a thing we can actually
build on the named substrate, and every wave inherits the same governance floor.

---

## 1. PILLARS — the maximal wiring vision

Eight pillars. Each is a structural commitment that multiple dossiers converge on,
mapped onto a real Borjie organ, and bounded by the governance floor (§5).

### Pillar 1 — The blackboard CRDT is the ONE global workspace; everything is a knowledge source on it
There is one spine: `@borjie/blackboard-sota`'s hash-chained CRDT slot bus. Juniors,
kernel stages, EstateMind drives, owner edits, external A2A partners, and UI
surfaces are all *knowledge sources* reading/writing the same observation log
(unify `stage-event-bus` + `SLOT_DELTA`). Coordination is observation-driven
(CodeCRDT/bMAS), not point-to-point — `pickNext` arbitrates only contested regions.
This is `THE_ORCHESTRATION_ARCHITECTURE`'s Principle 1 made the substrate of every
later pillar. *Reconciles: connective §1, exotic §8/§7; OK-3.*

### Pillar 2 — Models are orchestrated as one learned MoA-cascade-council, compiled and bandit-explored
The static, hand-wired model graph becomes a living one: a cache-fronted,
learned-router-gated, bandit-explored, evidence-fused **council** — `brain-llm-router`
+ kernel `debate`/`ttc-allocator`/`semantic-cache` welded into the "compiled council"
(model-orchestration §11). Cheap-first cascade with self-consistency-as-gate;
Symbolic-MoE recruits only relevant juniors as proposers on blackboard slots; a
cross-family agent-as-a-judge with stability-stopping verifies evidence; GEPA
compiles the prompts *and the routing graph* nightly. *Reconciles: model-orchestration
all; self-autonomic L1/L2; OK-1/OK-2.*

### Pillar 3 — The control plane is a closed-loop Pareto-optimizer over the wiring itself
The admin control plane stops being a dashboard humans poke and becomes a resident
optimizer that closes OBSERVE→RECOMMEND→APPLY→OBSERVE: `eval-drift-logger` emits a
4-vector reward (quality, cost, latency, value-at-risk); a ParetoBandit tunes fast
knobs and a MALBO Bayesian-opt tunes slow knobs; every candidate config passes a
policy-as-code gate, is canaried/shadowed on a tenant slice, and auto-promotes only
on a statistically-proven Pareto-win — every promotion an append-only audit row.
The platform A/B-tests *how the brain thinks* the way a growth team A/B-tests a
button. *Reconciles: control-plane all; self-autonomic L1/L2; OK-1/OK-8.*

### Pillar 4 — The system re-wires its own topology within governance, never sovereign
Self-wiring runs at three timescales (self-autonomic L1/L2/L3): L1 reflexive
(per-request bandit routing among pre-approved arms), L2 reflective (nightly GEPA
re-tune of standing prompts/topology/routing in EstateMind's orient stage), L3
constructive (an ADAS/DGM meta-agent *proposes* new juniors/edges, HITL forever).
The connection set itself is first-class RLS-governed DATA; every edge mutation is
a reversible `bodyChange` through the ONE meta-rail chokepoint. A Topology Arbiter
(promoted modality-arbiter) selects swarm/hierarchy/pipeline/market per task from
the DAG features and *learns* the best shape per use-case from the audit chain.
*Reconciles: connective §5, self-autonomic L1/L2/L3, exotic §2; OK-1/OK-4/OK-7.*

### Pillar 5 — Coordination is market-cleared for the expensive work, stigmergic for the ambient tail
Two coordination tiers over the same board. **Market (§exotic-1):** when EstateMind
emits a goal, the orchestrator opens an `auction` region; juniors bid
`{token_cost, confidence, evidence_count, EFE}`; a stateless scorer clears against
the budget governor's remaining tier balance; the cleared winner still passes the
policy-gate (HIGH-risk prefixes can never be "bought"). **Stigmergy (§exotic-5,
§connective-2):** EstateMind's MOTIVATE drives publish as scalar *pressure-field*
LWW sub-registers; idle juniors continuously reduce pressure by local gradient with
temporal-decay re-opening stale decisions — 4×–32× coordination win at O(1)
messaging. The market clears the strategic; stigmergy self-heals the long tail.
*Reconciles: exotic §1/§5, connective §2; budget-governor as currency.*

### Pillar 6 — The estate is a recursive holarchy with one loop at every scale
Estate ⊃ Subsidiary ⊃ Mine ⊃ Pit ⊃ Worker, and MD ⊃ juniors ⊃ power-tools, are the
*same* holon contract — `perceive()/propose()/decide()/account()` — running the same
`EstateMind.tick()` at every level with its own budget sub-allocation and policy-gate
scope (exotic §2; ROMA recursion in the orchestration arch §3.3). Subsidiary
onboarding and succession become zero-code: a new subsidiary is a new holon that
inherits the contract, the rail, and the tier. Holons split under load and merge
when idle — a living, load-balancing fractal org chart. *Reconciles: exotic §2,
orchestration §3.3 (ROMA/VSM).*

### Pillar 7 — The Canonical Mining Graph is the world-model substrate and the live nervous system
Juniors read/write the typed graph instead of passing lossy NL — a junior's output
is a typed, bi-temporally-stamped, evidence-bearing graph write the next junior
reads (exotic §4/§7). The graph is the shared world-model the brain can *roll
forward* (imagine 3 steps: "suspend Pit 3 → reallocation → cashflow → covenant
breach?") and broadcast the *imagined trajectory* as the proposal. Reasoning,
memory, audit, and situational-model collapse into queries over one fabric;
community-detection surfaces latent risks; an anomaly at a Pit propagates an
activation wave up the edges, pre-warming the juniors on the blast path. *Reconciles:
exotic §4/§7, neuro-symbolic §6.*

### Pillar 8 — Physiology binds it all: active-inference objective, hormone bus, immune system, neuro-symbolic conscience
The single objective is **Expected Free Energy minimization** — EstateMind scores
proposals by epistemic value (uncertainty reduction) + pragmatic value (drive
alignment), deriving the evidence-required rule rather than enforcing it
(exotic §3). A small set of estate-wide scalar **hormones** (`risk`, `cost-pressure`,
`regulator-deadline`, `owner-urgency`) live in reserved CRDT slots and re-tune
market bids, EFE precision, pheromone decay, and policy-gate tightness with one
broadcast (exotic §8). The **immune system** = the shipped containment guards
(innate) + a co-evolving detector population (adaptive). The **neuro-symbolic
conscience** = the policy-gate grounding every neural plan against the graph
*before* it acts (R-CCAM, exotic §6). The whole organism is observed in full
internally and leaks only a typed `StatusSpan|Output|Evidence` projection to any
client. *Reconciles: exotic §3/§6/§8, orchestration §5 (two-plane).*

---

## 2. MAPPING — every discovery onto the EXACT Borjie substrate component

Grouped by substrate. Each row: **HAVE** (in-code today) · **ADD** (the thin new
piece) · **SEAM** (where it attaches). Severity vocabulary (OK-1..OK-8) is shared
with the orchestration arch so this expansion threads its keystones.

### 2.1 Blackboard-sota (the spine / global workspace)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| Observation-driven coordination (CodeCRDT) | slots, `SLOT_DELTA`, control-shell, hash-chain | unify `stage-event-bus`+`SLOT_DELTA` into ONE log; juniors loop `observe→if highest activation, act→write` | OK-3 `control-shell-wiring.ts`; `pickNext` on region deltas |
| Stigmergic pressure-fields + decay (2601.08129) | LWW registers, `wallClockMs`, tombstones, decaying activation | a `pressure` LWW sub-register per slot/region from real estate metrics; decay re-opens stale "solved" | EstateMind MOTIVATE publishes drives as pressure; juniors reduce by gradient |
| Linda generative coordination | `crossref-detector` (cosine), regions | associative/semantic `rd`/`in` by content pattern; `eval`-spawn = PROPOSE generalised | `crossref-detector` is already a semantic superset of Linda `rd` |
| Global Workspace + hormone bus (2604.08206) | CRDT slots, effort/precision | reserved scalar "hormone" slots broadcast to every organ | one number re-tunes market/EFE/stigmergy/policy at once |
| Dependency-tracked semantic-cache invalidation | slot version-vectors | key each cached answer to the version-vectors it read; auto-invalidate on slot update | kernel `semantic-cache` ↔ blackboard slot deltas |
| MoA-on-a-blackboard | named slots, durable slot repo (mig 0319) | proposers write drafts to named slots; aggregator reads them | makes MoA rounds durable, inspectable, resumable |

### 2.2 brain-llm-router (the LLM-as-soul layer)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| Learned difficulty router (RouteLLM/MixLLM) | static task-ladder + overrides; kernel `embedder` | `learned-router/` difficulty head on the existing embedder; also predict evidence-availability | feeds `ttc-allocator.ambiguityScore` + cascade gate |
| Self-consistency-as-cascade-gate | `cost-cascade` + `consistency.majorityVote` | plug `majorityVote` consistency score in as the cascade `evalFn`; learn per-task threshold from drift data | `cost-cascade/cascade-runner.ts` evalFn slot |
| Bandit portfolio + reverse-auction (MetaLLM/ParetoBandit) | `dynamic-registry`, `cost-meter`, `routing-overrides` | `bandit-selector/`: LinUCB/Thompson arms = registry models, reward = drift pass-rate − cost; overrides/min-tier are hard constraints | zero-touch model onboarding; cohort-warm-started |
| GEPA-compiled routing graph (2507.19457) | `dspy-compile` (MIPROv2 port, no instruction synthesis) | add instruction-proposer; run GEPA in `brain-evolution-worker` over drift traces; compile prompts AND the routing graph | delivered via control-plane AI-suggest (HITL) |
| Cross-family evidence-grounded judge (Agent-as-a-Judge) | `judge-loop`, `cross-provider-auditor` | force judge family ≠ generator; verify each `evidence_id` supports its claim; KS-test/Beta-Binomial debate stopping | breaks confabulation consensus; numeric self-consistency before ledger |
| Speculative/edge cascade + KV-share | `vllm-adapter`, `ollama-adapter` | enable vLLM speculative decoding on the self-hosted bottom rung; SemShareKV on the shared `tenant_id=NULL` corpus | on-soil free+fast cascade step; cross-tenant KV-share safe by construction |
| Causal routing (2505.16037) | audit-chain observational history | regret-minimisation de-biased for chosen-path-only observation | a causal layer under the bandit |

### 2.3 Admin control plane (the closed loop)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| OBSERVE→RECOMMEND→APPLY→OBSERVE | eval-drift-logger, Control-Tower, overrides, governor, audit | `@borjie/wiring-optimizer` (ParetoBandit fast + MALBO slow), propose-only | hosted in EstateMind as a "wiring" drive |
| Reward vector | `{confidence,cost,latency,fallbackDepth,cascadeSteps,wasHedged}` | append `valueAtRisk` + `delayedOutcome` (immutable add) | from policy-gate risk-tier + owner-accept/ledger-confirm |
| Policy-as-code gate (OPA/Cedar) | policy-gate, `inviolable.ts`, `LOCKED_CATEGORIES`, four-eye | one `assertWiringCandidateAllowed(candidate)` chokepoint | mandatory gate on optimizer output |
| Canary/shadow of a *config* (Argo Rollouts) | the units to canary; eval-drift to analyze | Config-Rollout primitive: shadow + canary + AnalysisRun-over-drift + doubly-robust/anytime-valid promotion | writes the 3 existing APPLY backends; HIGH-impact → four-eye |
| Flag-as-config eval context (OpenFeature) | `platform-feature-flags.schema`, autonomy-settings | typed eval-context (tenant tier/jurisdiction/locale/risk-class) + %/ring rollout | enables targeted canary; edge-evaluable |
| Topology arbiter as ensemble dial generalised | control plane {first-wins/vote/judge/debate} | generalise model-ensemble dial to *agent topologies*; budget-governor prices each | the control plane becomes the Topology Arbiter for free |

### 2.4 llm-budget-governor (the currency / Lagrangian dual)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| Value-weighted compute (2604.14853) | tier caps, auto-downgrade, cost metering | value→compute-budget curve (MALBO slow knob) replacing flat `effort` | governor becomes a global compute allocator |
| Budget governor as reward channel | cost-weighted metering | expose per-turn cost/quality outcome as the bandit reward | closes the L1 loop |
| Market currency | tier balances | remaining tier balance clears the §exotic-1 auction; bids re-price up under pressure | graceful economic degradation |
| Free-energy budget (exotic §3) | tiers | couple EFE to spend — pay to think only where surprise-reduction justifies tokens | thermodynamically efficient estate |

### 2.5 EstateMind Slow Loop (the conductor / MAPE-K Analyze+Plan)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| GEPA reflective optimizer (self-autonomic L2) | perceive→orient→motivate→propose, leader-elected | graft GEPA into the ORIENT stage; nightly Pareto-front over junior prompts + routing; shadow-eval then propose | reads audit-chain as the trace; proposes via meta-rail |
| Active-inference EFE scoring (exotic §3) | MOTIVATE computes unsatisfied drives; decaying activation | score each proposal by EFE (epistemic + pragmatic) instead of ad-hoc salience | effort module = precision control |
| EstateMind → actuator bridge | propose-only nudge sink | SECOND sink: goal above `confidence×(1−reversibility)` bar → `OrchestratorRequest` into the arbiter spine | OK-4; rails intact |
| Proactive cache warming / world-model dreaming | idle ticks | spend deliberate TTC offline on standing drives; pre-compute futures; warm shared cache | answers land in ms when the real event arrives |
| Wiring drive (control-plane B1) | the propose loop | a "wiring" motivation drive proposes routing configs alongside estate actions | one mind tunes the estate AND itself |

### 2.6 agent-platform (the protocol rim)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| AG-UI/A2UI on the board (connective §4) | `SLOT_DELTA`, chat-first dynamic tabs | map `SLOT_DELTA`→AG-UI `STATE_DELTA` whose payload is an A2UI widget | one write coordinates AND renders; human edit = inbound AG-UI = a slot write |
| A2A agent-card competence vectors | `a2a/`, `agent-card`, control-shell competence | advertise junior competence over A2A; one competence model, two surfaces | buyer's procurement agent talks A2A to sales-offtake junior |
| Supervision tree (connective §3) | EstateMind leader-elected heartbeat (OneForOne in disguise) | OTP restart strategies (OneForOne/RestForOne/OneForAll); let-it-crash stateless juniors | hash-chain replays a respawned junior to last good board state |
| Market-maker convergence certificate | judge-loop | trader-can't-shift-claim certificate as a new evidence type | stronger than single-pass confidence |

### 2.7 durable-execution (the long-horizon backbone)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| Durable runner ON (orchestration OK-6) | Inngest executor built, unwired; workflow-engine | instantiate `createDurableRunner`; `DURABLE_EXEC_ENABLED=true`; DBOS-style PG saga journal | the journal IS the hash-chained audit |
| Two-tier memory (connective §6) | decaying CRDT slots (now) | promote risk-crossing regions to durable runs; each step writes back a slot | board mirrors durable truth; crash resumes exactly |
| Idempotency unification | webhook at-least-once + idempotency keys | durable step idempotency key = slot version-vector entry | one dedupe model spans transport/workflow/CRDT |
| Replay/counterfactual harness | deterministic durable runs + hash-chain | replay past decisions against a new model/policy ("what-if the new FX rule?") | eval/training signal for learned topology; causal counterfactual audit |
| Durable nightly self-optimization (self-autonomic L2) | Inngest | the GEPA/bandit re-tune as a resumable, idempotent, at-least-once workflow | self-improvement inherits platform durability |

### 2.8 Canonical Mining Graph (the world-model / nervous system)
| Discovery | HAVE | ADD | SEAM |
|---|---|---|---|
| Plan-not-percept world-model (2508.02912) | `mining-graph.ts`, bi-temporal KG, graph-rag-router | juniors write typed graph edges, not NL; broadcast compressed *intended mutations* to slots before committing | the blackboard is the plan layer over the world-model |
| Imagined trajectory / digital twin | typed, causal-capable graph | roll graph forward N steps under a candidate decision; broadcast consequences | owner decisions arrive pre-simulated |
| Neuro-symbolic R-CCAM (exotic §6) | policy-gate, inviolable, RLS, typed graph (SHACL-like) | ground every neural plan against the graph before acting; reject illegal multi-step plans statically | "file royalty for Mine X (not in graph)" is unrepresentable |
| Graph-as-signal-propagation | edges, community detection | anomaly at a node propagates an activation wave up edges; community-detection surfaces latent risk clusters | pre-warm juniors on the blast path; feed communities as Slow-Loop drives |
| Compile mining law into the graph | TZ Mining Act, royalty schedules in corpus | SHACL-style graph constraints so juniors reason *inside* the law | illegal advice is unrepresentable, not merely flagged |

---

## 3. TOP "WE-DID-NOT-KNOW-WE-COULD-DO-THIS" — the highest-leverage unknown-unknowns

Twelve concrete, named capabilities. Each is real on the named substrate and
inside the governance floor.

1. **Compile the routing GRAPH with GEPA, not just prompts.** Treat the whole
   orchestration config (router thresholds + cascade gates + ensemble mode + judge
   policy + TTC budgets per task) as a DSPy program and let GEPA re-optimise *the
   graph structure* nightly against the (quality×cost) Pareto metric, delivered to
   the control plane as an AI-suggest. The brain stops being hand-wired and becomes
   compiled + continuously re-optimised. *(model-orch §9; self-autonomic L2.)*

2. **Per-tenant, per-jurisdiction compiled routing graphs.** GEPA compiles a
   *separate* Pareto-optimal routing graph per tenant cohort from each cohort's own
   drift data — a TZ artisanal tenant and a NG mid-tier holding get orchestration
   that specialises to their query distribution, evidence corpus, and cost
   sensitivity. Nobody compiles per-tenant routing graphs. *(model-orch §9.)*

3. **The platform A/B-tests its own intelligence wiring like a growth team A/B-tests
   a button.** Canary a new ensemble policy on 5% of turns (or shadow it on
   high-stakes turns with responses discarded), auto-promote on a doubly-robust,
   anytime-valid Pareto-win, auto-rollback on the 5pp regression rule — the
   "feature" under test is *how the brain thinks*. No 2026 vendor ships canary-a-
   wiring-config. *(control-plane U1/B3.)*

4. **A new model is evaluated *into production* by the system itself.** Drop an
   endpoint into the registry; the bandit's new-endpoint-absorption trials it on a
   safe shadow slice, the AnalysisRun proves or rejects it, it promotes with a full
   audit trail and zero human routing decision. Geometric forgetting re-discovers
   the Pareto frontier within hours of any Anthropic re-price or new tier.
   *(control-plane U4/B2; model-orch §10.)*

5. **The Canonical Mining Graph as the live wiring fabric agents read/write.**
   Juniors hand off typed, bi-temporally-stamped graph writes instead of lossy NL,
   collapsing coordination + memory + audit into one queryable fabric where every
   answer is a citable path and consistency is structural, not hoped-for. The single
   biggest reliability hole in multi-agent LLM systems (lossy NL hand-offs)
   disappears. *(exotic §4/§7.)*

6. **Active-inference EstateMind that minimizes estate surprise.** Replace ad-hoc
   salience with Expected-Free-Energy scoring so the Slow Loop *seeks out its own
   blind spots* — it surfaces the unwatched licence precisely because that is where
   surprise is highest — and expose the estate's *total free energy* as a single
   owner-facing "estate stress" gauge that rises when reality diverges from the
   brain's model. An early-warning organ for unknown-unknowns, derived for free.
   *(exotic §3.)*

7. **An internal compute market where juniors bid for tasks under the budget.** The
   budget governor (currency) meets the juniors (bidders): EstateMind goals open an
   auction region; juniors bid `{token_cost, confidence, evidence_count, EFE}`; the
   scorer clears against the remaining tier balance, so under cost pressure bids
   re-price up and only the highest-value mining work clears — Borjie degrades
   *gracefully and economically*, not by stopping or overspending. *(exotic §1.)*

8. **A prediction market over the estate's own futures.** Juniors stake budget
   tokens on outcomes ("ore grade at Pit 7 > 4 g/t", "buyer Z accepts at price P");
   the market price *is* the calibrated forecast; settled outcomes feed the
   cognitive-reinforcement audit-chain so well-calibrated juniors accumulate bidding
   power. A self-pricing forecast organ with zero new model training. *(exotic §1.)*

9. **Temporal-decay as a built-in staleness immune system.** Apply `e^(−λt)` decay
   to a region's "solved" confidence so the board *automatically* re-opens a stale
   decision (a 3-week-old forecast, an expired price quote) and re-attracts a junior
   — no cron, no human, no reminder. The estate never silently runs on stale
   intelligence because the substrate forgets on a half-life. *(connective §2.)*

10. **One hormone broadcast re-tunes the whole organism.** A single scalar in a
    reserved CRDT slot — `risk`, `cost-pressure`, `regulator-deadline`,
    `owner-urgency` — simultaneously raises every market bid, lowers EFE precision,
    shortens pheromone decay, and tightens the policy-gate, exactly as a body shifts
    from rest to fight-or-flight. The cheapest, highest-leverage wiring in the entire
    program; pairs with **homeostatic set-points** (cash buffer, compliance-coverage
    %, ESG score) the estate defends automatically. *(exotic §8.)*

11. **The estate replays its own history against a corrected policy (time-travel /
    counterfactual audit).** Because durable runs are deterministic and the board is
    hash-chained, re-run any past decision sequence against a new model or rule
    ("what would the estate have done under the new FX cliff?") — giving regulator-
    grade what-if, the eval signal for learned topology, and a counterfactual audit
    that proves *why* a decision was right, not just that it followed the rules.
    *(connective §6; exotic §8.)*

12. **The control plane runs closed-loop FinOps on intelligence.** A global daily
    compute budget paced across the day (ParetoBandit budget pacing) lets Borjie
    promise an owner a *fixed monthly intelligence spend* and self-ration to hit it
    while protecting the highest-value turns first — and prove "we spent $0.003 on
    your date lookup and $0.40 on your tailings-dam decision, here's the math" — a
    defensible cost-to-value story no flat-rate competitor can tell, and every
    config change a regulator-grade compliance artifact. *(control-plane U3/U5/U6.)*

**Honorable mention (cheap, high-novelty):** bilingual debate as correctness *and*
localization QA (run one proposer EN, one SW; disagreement localises a translation
bug — uniquely possible because Borjie is hard-bilingual; model-orch §8); the
pheromone field rendered as a live "where the brain is paying attention" heat-map on
owner-web (exotic §5); shared-corpus cross-tenant KV-sharing that is safe *because*
the shared prefix is by-definition non-tenant data (model-orch §4).

---

## 4. EXPANSION WAVES — dependency-ordered, buildable, leverage × buildability

Wave 0 is the awakening already in flight (the control plane + the 43-gap closure +
the OK-1..OK-8 keystones). Every later wave assumes Wave 0 landed: the arbiter is
ON, durability is ON behind the floor+firewall, the meta-rail is bound, `pickNext`
runs, EstateMind actuates, the Hands have a reversibility-typed saga port. Each wave
states what it is, what it builds on, its SOTA basis (dossier cited), effort
(S/M/L), and the governance invariant it must preserve.

> **Ordering principle:** leverage × buildability. The early waves reuse organs that
> are already built-but-dark (highest buildability) and immediately bend the cost
> and quality curves (highest leverage). The exotic-frontier waves come later
> because they compound *on top of* the closed loop and the live spine.

---

### WAVE 0 — THE AWAKENING (the control plane + closure, already in flight)
**What.** Bind the OK-1..OK-8 keystones from `THE_ORCHESTRATION_ARCHITECTURE.md` /
`MASTER_WIRING_CLOSURE_PLAN.md`: floor+firewall (egress projection + out-of-process
rail), durable-exec ON with a supervisor, body-change meta-rail bound, Topology
Arbiter flipped to the default consequential path, loop-runner adapter real,
`pickNext` live, EstateMind→arbiter actuator bridge, reversibility-typed actuator
saga. Un-stub the admin models control plane.
**Builds on.** Nothing — this is the precondition for everything below.
**SOTA basis.** orchestration arch Wave 0–4; closure plan Waves 1–9.
**Effort.** L (already scoped + in progress).
**Governance invariant.** The whole expansion is shippable *only because* internals
never leak (two-plane), the governor is agent-unreachable (out-of-process rail), and
every body-change passes the one chokepoint. **This wave establishes the floor every
later wave inherits.**

---

### WAVE 1 — CACHE-FRONTED + PREFIX-CACHED HOT PATH (immediate $ win, near-zero risk)
**What.** Prompt-prefix caching at the adapter (mark persona+toolspec+shared-corpus
as a cache breakpoint); semantic-cache as orchestrator step-0 with per-task
similarity floors; tenant-scoped cache keys (shared-corpus answers cross-tenant,
tenant answers never); dependency-tracked invalidation keyed to blackboard slot
version-vectors.
**Builds on.** Wave 0 spine (slot version-vectors); kernel `semantic-cache` (built,
not in the hot path).
**SOTA basis.** model-orchestration §7 (semantic + prefix + KV caching; SemShareKV).
**Effort.** S (adapter flags + move an existing module into the hot path).
**Governance invariant.** RLS — never serve tenant A's cached answer to tenant B;
cache hit still records a $0 metered call on the audit chain.

---

### WAVE 2 — SELF-CONSISTENCY-GATED CASCADE + LEARNED DIFFICULTY ROUTER
**What.** Plug `majorityVote` consistency as the `cost-cascade` evalFn
(disagreement → escalate); learn per-task escalation thresholds from drift history;
add a `learned-router/` difficulty head on the existing embedder that also predicts
evidence-availability; feed it into the `ttc-allocator` ambiguity signal. Un-stubs
the control plane: AI-suggest recommends a routing config from observed Pareto data.
**Builds on.** Wave 1 cache (step-0 before routing); `cost-cascade`,
`consistency.majorityVote`, kernel `embedder`, `eval-drift-logger` (the training
set, already logging).
**SOTA basis.** model-orchestration §2/§3/§8 (cascades, learned routers,
self-consistency); self-autonomic L1.
**Effort.** M.
**Governance invariant.** Min-tier policy + `LOCKED_CATEGORIES` are hard floors the
router can never route below; HIGH-risk prefixes hit literal policy, no generalisation.

---

### WAVE 3 — THE CLOSED-LOOP PARETO-OPTIMIZER (the control-plane keystone)
**What.** `@borjie/wiring-optimizer` (ParetoBandit fast knobs + MALBO Bayesian-opt
slow knobs), propose-only, hosted as an EstateMind "wiring" drive; append
`valueAtRisk`+`delayedOutcome` to the reward event; `assertWiringCandidateAllowed()`
policy-as-code chokepoint; Config-Rollout primitive (shadow + canary + AnalysisRun-
over-drift + doubly-robust/anytime-valid promotion) writing the 3 existing APPLY
backends; OpenFeature typed eval-context on the flags. The platform A/B-tests its
own wiring; new models self-onboard.
**Builds on.** Wave 2 (the router/cascade are the optimizer's action space); Wave 0
durable-exec (the nightly slow-knob run is a resumable workflow); eval-drift-logger,
Control-Tower, overrides, governor, audit chain.
**SOTA basis.** control-plane §1–§7 (ParetoBandit, MALBO, OBSERVE→…→OBSERVE, policy-
as-code, OPE promotion); self-autonomic L1/L2.
**Effort.** L.
**Governance invariant.** Optimizer is propose-only; every candidate passes the
policy gate (cannot touch locked categories, raise a tenant above tier ceiling,
disable a kill-switch, breach jurisdiction/locale); HIGH-impact promotion → four-eye
Control-Tower row; every promotion an append-only hash-chained audit row with the
canary verdict + CI + reward delta.

---

### WAVE 4 — GEPA-COMPILED ROUTING GRAPH + EVIDENCE-FUSED COUNCIL
**What.** Upgrade the `dspy-compile` MIPROv2 port with an instruction-proposer; run
GEPA in `brain-evolution-worker` nightly over drift traces to compile prompts *and*
the routing graph, per-tenant-cohort; deliver as a control-plane AI-suggest. Promote
debate to a Symbolic-MoE: recruit only relevant juniors as proposers on blackboard
slots, a cross-family agent-as-a-judge verifies each `evidence_id` with KS-test/
Beta-Binomial stopping, the aggregator emits the intersection-validated evidence
union (evidence-fused MoA).
**Builds on.** Wave 3 (the optimizer's delivery channel + reward); kernel `debate`/
`default-voices`, `cross-provider-auditor`, `dspy-compile`, `brain-evolution-worker`.
**SOTA basis.** model-orchestration §1/§6/§9 (Symbolic-MoE, Agent-as-a-Judge, GEPA);
self-autonomic L2.
**Effort.** L.
**Governance invariant.** GEPA fitness is invariant-floored — a candidate that ever
bypasses the ledger, double-filters RLS, emits an empty evidence chain, mixes EN/SW,
or touches a HIGH-risk prefix scores −∞ and is never archived (closes misevolution by
construction); compilation is deploy-time + HITL-approved, never live mutation;
Auditor rejects unsupported evidence chains.

---

### WAVE 5 — VALUE-WEIGHTED COMPUTE + BANDIT PORTFOLIO + REVERSE-AUCTION
**What.** Replace the flat `effort` tier with a value→compute-budget curve so the
governor becomes a global compute allocator (Lagrangian dual) that spends opus+debate
+verifier on a licence/safety/money turn and haiku-single-shot on a date lookup,
under one global daily budget; portfolio bandit model selection with reverse-auction
over providers (Anthropic/OpenAI/Google/self-hosted bid per query on the live price/
availability signals); cohort-shared bandit posteriors (warm start). Speculative
decoding on the self-hosted edge rung; SemShareKV on the shared corpus.
**Builds on.** Wave 3 (the bandit + reward live); budget-governor tiers, `cost-meter`,
`dynamic-registry`, `vllm-adapter`/`ollama-adapter`.
**SOTA basis.** control-plane §1.6 + B4 (value-weighted compute); model-orchestration
§10/§4/§5 (bandit portfolio, reverse-auction, speculative/edge, portfolio TTC).
**Effort.** M.
**Governance invariant.** Budget-aware + fail-safe: under budget exhaustion the
allocator protects highest-value turns and degrades the rest; the bandit never
explores below min-tier for a HIGH-risk prefix; data-sovereignty — the on-soil edge
rung keeps TZ data on-soil; honest three-state billing preserved.

---

### WAVE 6 — STIGMERGIC PRESSURE-FIELD COORDINATION + LET-IT-CRASH SUPERVISION
**What.** Publish EstateMind MOTIVATE drives as scalar `pressure` LWW sub-registers
(overdue royalty, unsold lot, open incident, expiring licence, unhedged FX, unfilled
opening); idle juniors continuously reduce pressure by local competence-gradient with
temporal-decay re-opening stale "solved" regions (4×–32× coordination win, O(1)
messaging). Formalise the kernel as an OTP supervision tree (OneForOne/RestForOne/
OneForAll); make juniors stateless, disposable, let-it-crash (the board+hash-chain is
the source of truth, so a respawned junior re-reads and continues).
**Builds on.** Wave 0 spine (`pickNext` live); blackboard LWW registers, decaying
activation, tombstones, EstateMind leader-elected heartbeat.
**SOTA basis.** connective §2 (pressure-fields + temporal decay) + §3.1 (supervision
trees); exotic §5 (stigmergy).
**Effort.** M.
**Governance invariant.** Stigmergy handles ONLY the low-risk ambient tail; HIGH-risk
prefixes stay orchestrated through the durable workflow with four-eye (risk tier IS
the choreography/orchestration switch); decay never re-opens a *committed money/
licence* fact, only a *decision/forecast*; every pressure write is hash-chained.

---

### WAVE 7 — WORLD-MODEL GRAPH SUBSTRATE + NEURO-SYMBOLIC CONSCIENCE
**What.** Wire juniors to read/write the Canonical Mining Graph as typed, bi-
temporally-stamped, evidence-bearing edges instead of NL hand-offs; broadcast
compressed *intended graph mutations* to slots before committing (plan-not-percept);
make the policy-gate a neuro-symbolic R-CCAM checkpoint that grounds every neural plan
against the graph before acting and statically rejects illegal multi-step plans;
compile mining law (TZ Mining Act, royalty schedules) into SHACL-style graph
constraints. Stand up the imagined-trajectory digital twin (roll the graph forward N
steps under a candidate decision, broadcast consequences).
**Builds on.** Wave 0 spine + Wave 6 board; `mining-graph.ts`, bi-temporal KG,
`graph-rag-router`, policy-gate, `inviolable.ts`, RLS.
**SOTA basis.** exotic §4 (world-models) + §6 (neuro-symbolic) + §7 (graph-as-
nervous-system).
**Effort.** L.
**Governance invariant.** Illegal advice is unrepresentable (grounded against the
graph by construction, not flagged after); every graph write carries an `evidence_id`
(evidence-required rule derived); RLS tenant scope is a property on every path; the
twin runs in a sandbox and never touches production state.

---

### WAVE 8 — MARKET-CLEARED COORDINATION + PREDICTION MARKET
**What.** Add an `auction` blackboard region: EstateMind goals open an auction;
juniors bid `{token_cost, confidence, evidence_count, EFE}`; a stateless scorer (in
`blackboard-sota/control`) clears against the budget governor's remaining tier
balance; `cost-cascade` is the price oracle, `judge-loop` the market-maker convergence
test (a trader-can't-shift certificate = a new evidence type). Layer a prediction
market: juniors stake budget tokens on estate futures, the price is the calibrated
forecast, settled outcomes adjust bidding power via the cognitive-reinforcement chain.
**Builds on.** Wave 5 (value-weighted budget = the currency); Wave 6 board; Wave 3
reward/audit; the 12 juniors + power-tools (bidders).
**SOTA basis.** exotic §1 (market-based coordination, market-maker, prediction market).
**Effort.** M.
**Governance invariant.** The cleared winner still passes the policy-gate — HIGH-risk
prefixes can NEVER be bought; budget-aware (bids re-price up under pressure, graceful
economic degradation); every clear + settlement is hash-chained.

---

### WAVE 9 — HOLONIC RECURSION + ELASTIC ORG-FRACTAL
**What.** Define the one recursive holon contract (`perceive/propose/decide/account`)
so `EstateMind.tick()` runs the same loop at every level (Estate→Subsidiary→Mine→Pit),
each with its own budget sub-allocation and policy-gate scope (fused with ROMA
Atomizer/Planner/Executor/Aggregator from the orchestration arch); make the holarchy
elastic (split a holon under blackboard load, merge when idle); run counterfactual
shadow-holons in a sandbox. Subsidiary onboarding + succession become zero-code.
**Builds on.** Wave 7 (the world-model the holon perceives); Wave 0 ROMA recursion +
durable saga; EstateMind, blackboard regions-within-regions, budget tier sub-allocation.
**SOTA basis.** exotic §2 (holonic/PROSA); orchestration arch §3.3 (ROMA/VSM recursion).
**Effort.** L.
**Governance invariant.** No child holon can widen its own mandate — the parent's
inviolable governor is inherited downward; each holon's policy-gate scope is RLS-
bounded; a counterfactual holon never touches production state.

---

### WAVE 10 — ACTIVE-INFERENCE OBJECTIVE + PHYSIOLOGY (hormone bus, immune, causal)
**What.** Replace EstateMind's ad-hoc salience with Expected-Free-Energy scoring
(epistemic + pragmatic), coupled to a free-energy budget; expose total free energy as
an "estate stress" gauge. Add the hormone bus (reserved scalar CRDT slots re-tuning
market/EFE/stigmergy/policy with one broadcast) + homeostatic set-points the estate
defends. Add adaptive immunity (a co-evolving detector population over the shipped
innate guards) and a causal-routing layer (regret-minimisation from the audit-chain's
de-biased observational history) + counterfactual audit organ.
**Builds on.** Waves 6–9 (the things the hormones modulate: market bids, pressure
decay, EFE precision, policy tightness); EstateMind, decaying activation, containment
guards, brain-llm-router, durable replay.
**SOTA basis.** exotic §3 (active inference) + §8 (GWT hormone bus, immune, causal).
**Effort.** L.
**Governance invariant.** The hormone bus can only *modulate within* the floor —
raising `risk` tightens the policy-gate, never loosens it; the immune system
quarantines anomalous/un-evidenced memory writes (Zombie-Agent defence) before
reingest via the input-containment guard; causal routing's authority is bounded to
tier-allowed arms; the estate stress gauge is a status projection, not a mechanics leak.

---

### WAVE 11 — L3 CONSTRUCTIVE SELF-WIRING (the ceiling, HITL forever)
**What.** An ADAS/DGM-style meta-agent that *proposes* new juniors and new
connection-graph edges from the audit-chain archive of what actually worked in this
estate, validated by the system's own debate/judge ensemble as the empirical peer-
review, with the Auditor as veto; the connection set as first-class RLS-governed DATA
with a G-Designer online topology-optimizer proposing each edge as a reversible
`bodyChange`, sparsity-pruning dead edges, and pruning adversarial-traffic edges. The
brain rewires itself as the estate changes — every rewire court-grade auditable.
**Builds on.** EVERYTHING — Wave 0 meta-rail (the one actuator), Wave 3 closed loop
(the fitness signal), Wave 4 GEPA (the search algorithm), Wave 7 graph (the search
space), Wave 9 holarchy (where new organs slot in), Wave 10 immune system (defence).
**SOTA basis.** self-autonomic L3 (ADAS, DGM, misevolution defence); orchestration
arch Wave 5 (connection-as-DATA + online topology-optimizer + DMoE agent hiring).
**Effort.** L (and deliberately last).
**Governance invariant.** L3 is HITL behind the meta-rail FOREVER. Invariant-floored
fitness (any violation = −∞, never archived); one actuator (the meta-rail); append-
only lineage (every proposal + disposition hash-chained, reversible); shadow-then-
propose (no delta ships without shadow-eval against replayed held-out turns); sovereign
/kill_switch/four_eye/policy_rollout prefixes never subject to any learned
generalization. The offense is safe *only because* the defense is one system with it.

---

## 5. GOVERNANCE FLOOR — the non-negotiables every wave inherits

Restated once, binding on Wave 0 through Wave 11. No wave relaxes any of these; the
entire expansion is shippable *only because* this floor holds by construction.

1. **Sovereign rails are HITL forever.** Money path goes through
   `LedgerService.post()`; licence filing/suspension and deletion are HITL; HIGH-risk
   policy prefixes (sovereign / kill_switch / four_eye / policy_rollout) hit literal
   policy rules with no reason-resolver generalisation and can never be bought,
   routed-cheaper, learned-around, or self-modified. L1 may *select* among pre-
   approved arms; L2/L3 may only *propose*; the meta-rail is the one actuator.

2. **Budget-aware, fail-safe to a safe default.** Every wave operates inside the
   `llm-budget-governor` envelope; under budget pressure the system protects highest-
   value turns and degrades the rest gracefully (never stops, never overspends);
   honest three-state billing is preserved; the kill-switch fails closed — never
   caught-and-ignored; a crash resumes from the durable journal, never re-runs an
   effect.

3. **Egress + input guards always hold.** Two planes, one capture: full OTel GenAI
   trace internally, a typed `StatusSpan | Output | Evidence` allow-list projection to
   any client — never model/agent/tool names, arbiter rationale, prompts, budgets, or
   chain-of-thought; the IP-egress guard is fail-closed (redact-when-uncertain) and
   covers artifact frames + Live re-query, not just text. The input-containment guard
   scans before reingest (Zombie-Agent / prompt-injection defence); the meta-rail and
   policy-gate run out-of-process, agent-unreachable even under a compromised kernel.

4. **Audited, reversible, evidence-required.** Every rewire, reward, Pareto candidate,
   promotion, market clear, body-change, and actuator effect is an append-only hash-
   chained audit row written *before* the effect — fully reconstructable, replayable,
   and reversible (default-on kill-switches per capability; draft→shadow→canary→live→
   archived with auto-rollback). Every junior recommendation cites ≥1 `evidence_id`;
   the Auditor rejects empty *and* unsupported evidence chains.

5. **No IP leak, multi-tenant by construction.** RLS is force-enabled and is the same
   boundary as coordination sharding; tenant tuning, caches, bandit posteriors, and
   compiled graphs never cross the tenant boundary (shared-corpus `tenant_id=NULL`
   answers are the only cross-tenant artifacts, safe by definition); KE/UG/NG
   jurisdiction + locale rails bound each tenant's optimizer independently; EN/SW
   absolutism is a fitness floor (a candidate that mixes locales scores −∞);
   multi-currency via `formatCurrency`, never hard-coded.

6. **Never sovereign — the offense exists only because the defense does.** Self-
   wiring, self-tuning, market clearing, holonic recursion, and constructive self-
   construction are bounded by `inviolable.ts`; the fitness function's floor IS the
   inviolable core, so the system *cannot misevolve toward a violation* — not by
   hope, by construction. Every loop's authority is leader-elected and tier-bounded;
   each loop can only propose changes one tier up. **Borjie re-wires itself within
   governance, never past it.**

---

## 6. One-line verdict

We already own every organelle the 2026 frontier requires — the CRDT blackboard, the
compiled-council router, the closed-loop control plane, the budget governor, the
active-inference Slow Loop, the A2A/AG-UI rim, the durable backbone, the typed mining
graph, and the inviolable moat. The maximal vision is not to build new organs but to
**wire them into one self-wiring, self-tuning, market- and holonic-coordinated,
world-model-grounded organism that prices its own intelligence, forgets on a half-
life, seeks out its own blind spots, A/B-tests how it thinks, and re-wires itself
overnight — every rewire a governed, reversible, hash-chained proposal that can never
cross the sovereign floor.** Wave 0 turns the lights on; Waves 1–11 turn the awakened
organism into the frontier past the frontier. An awakening, then an evolution — never
a sovereign.
