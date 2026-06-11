# THE ORCHESTRATION ARCHITECTURE — the chosen, buildable SOTA conductor

**Document:** `Docs/research/THE_ORCHESTRATION_ARCHITECTURE.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** the ONE synthesized orchestration architecture — no code, no commit. Resolves the five orchestration research dossiers + `MASTER_ARCHITECTURE.md` + `MASTER_GAP_REGISTER.md` into the single coherent conductor the organism already half-has, with the exact wiring to reach SOTA, dependency-ordered, flag-default-safe.
**Bar:** SOTA, best-in-the-world, fiduciary-grade. We cannot be less than SOTA.

**Synthesizes (each a research lane, all read in full):**
- `orch-topologies.md` — the seven canonical topologies + the self-reshaping topology arbiter (AdaptOrch/Puppeteer/DMoE).
- `orch-wiring-protocols.md` — the connective fabric: MCP/A2A/AG-UI + CRDT-shared-state-vs-messages + the connection-as-first-class-DATA self-wiring nervous system (G-Designer).
- `orch-durable-dynamic.md` — durable + dynamic + recursive fused into one runtime (Cloudflare Dynamic Workflows / ROMA / self-healing) over the governance moat.
- `orch-our-organs-audit.md` — TODAY-vs-SOTA scorecard of the live tree (two spines that don't meet; the blackboard with no runtime caller).
- `orch-control-observability.md` — the two-plane split: full internal trace, zero client leak (the egress boundary + out-of-process meta-rail).

> **Sibling invariant (true everywhere below).** Borjie (mining-estate OS) and BossNyumba / "BN" (real-estate OS) are the **same brain, same orchestration, same wiring**. Every organ here is built **once**, domain-agnostic, in the shared `central-intelligence` + `blackboard-sota` + `workflow-engine` + `mutation-authority` packages; BN inherits the entire conductor by pointing it at the other ontology pack. The only fork is the deterministic domain engines + prototype/playbook rows + actuator adapter bindings. "Mine" reads "or property" throughout.

> **Owner invariants honored by construction.** INV-C (infinite self-extending nervous system — no cap on nodes/edges; topology forms/reforms), INV-D (veteran kernel, never single-shot), INV-G (uncapped + durable; only dynamic governance, never magic-number caps), INV-H/D ABSOLUTE (orchestration internals NEVER reach any client — status + outputs + evidence only), the rails (money/licence/deletion HITL forever; the meta-rail on every capability growth).

---

## 0. The one-paragraph thesis

The conductor is a **blackboard-coordinated, durable, recursively-nesting, cost-penalized orchestrator-worker whose topology is selected and reshaped per task by a promoted modality-arbiter, runs entirely on the CRDT slot spine, grows its own wiring through the meta-rail, and is observed in full internally while exposing only a typed status projection to any client.** The resident `EstateMind` is the conductor: its Slow Loop senses the estate and formulates goals; a goal (or an owner turn) becomes a post on a blackboard region; the **Topology Arbiter** (the modality-arbiter promoted from a 5-way modality picker to a 7-way head that *also* chooses the team shape from the task's dependency-graph features) routes the work to ANSWER / SKILL / WORKFLOW / LOOP / AGENT-SWARM / ACTUATE and, for AGENT-SWARM, to orchestrator-worker / blackboard-volunteer / swarm-handoff / hierarchical / hybrid; the control-shell `pickNext` schedules which knowledge-source acts; every step is a journaled durable checkpoint that can recurse (ROMA Atomizer/Planner/Executor/Aggregator) and self-heal by bounded local repair; the reversibility-typed actuator port + saga executor turn intents into proven real-world work with HITL on the irreversible step; the connection set itself is first-class RLS-governed DATA so the brain adds organ↔organ / agent↔agent edges at runtime through the one body-change chokepoint; and a two-plane observability split runs the full OTel GenAI trace on the internal/audit plane while the client sees only a `StatusSpan | Output | Evidence` allow-list projection. **We already own every organ; what is missing is the connective architecture that joins them into this one graph — an awakening (wiring), not a build.** The single most important finding across all five lanes: *the gap between a SOTA orchestrator and a bad one is never the framework — it is the eval pipeline, the observability, and the failure-recovery; Borjie already owns a kernel and the governance moat that every shipping framework bolts on as an afterthought, so this is a wiring-and-fusion program.*

---

## 1. THE CHOSEN TOPOLOGY — blackboard-coordinated orchestrator-worker, recursive, self-reshaping

### 1.1 The decision, stated once

There is no single best topology; the 2026 consensus (Anthropic, Microsoft Magentic, AdaptOrch, MasRouter) is that **topology is a function of task structure** and the frontier is a **router that picks AND reshapes it per task**. The chosen Borjie shape is therefore not "a topology" but a **meta-topology**:

> **Every topology runs ON TOP OF the blackboard slot spine, and a promoted modality-arbiter selects + reshapes which topology runs per task, with the resident EstateMind as the standing conductor and the meta-rail as the one chokepoint through which the topology itself can grow.**

This is the structural answer to "reshapes itself" (INV-C): because a pipeline writes sequential slots, a swarm writes handoff slots, and an orchestrator-worker writes fan-out slots, **a single flow can morph topology mid-task** (start blackboard-volunteer to discover the path, collapse to a deterministic pipeline once known) without ever leaving the spine — unifying tracing, the CRDT shared state, the hash-chained audit, and the cross-surface projection.

### 1.2 The seven topologies and their Borjie homes (the routing matrix)

| Task class | Topology | Borjie organ | Reliability / cost |
|---|---|---|---|
| One-shot fact ("royalty due?") | **ANSWER (RAG)** — no topology | Fast-Loop read of situational model + corpus | highest / 1× |
| Known deterministic flow (process_royalty, onboard_site) | **Pipeline / graph** | `workflow-engine` (durable, hash-chained) | highest / lowest |
| Verified recipe match | **SKILL** (retrieve-and-run frozen mini-pipeline) | `skill-library` via arbiter | high / low |
| Breadth-first decompose ("compare 3 sites") | **Orchestrator-worker** (2–4 subagents, effort-scaled) | `md-subagent-executor.runSubagentTeam` | high / ~15× |
| Open-ended discovery ("why did Site B drop?") | **Blackboard-volunteer** (post → juniors volunteer by competence → `pickNext`) | `blackboard-sota` regions + control-shell | high at scale / medium |
| Conversational role-transfer (buyer thread sales→compliance→treasury) | **Swarm-handoff** (context rides the handoff slot) | `blackboard-sota/handoff` | medium / lowest LLM calls |
| Exploratory, steps-unknown, high-stakes | **Planner-executor / Magentic dual-ledger** (task-ledger + progress-ledger, replan-on-stall) | `loop-runner` + `planner-dispatcher` | medium / medium-high |

**Effort-scaling discipline (encode as a hard rule, INV-G-compatible):** 1 agent + 3–10 tool calls for facts; 2–4 sub-MDs for comparisons; 10+ only for genuine deep research. Token usage explains ~80% of the variance in quality, and early systems failed by "spawning 50 subagents for simple queries." The arbiter sets a **single budget envelope per turn** that every sub-MD inherits and decrements; the cap is **economics + progress + safety, never a magic number** (INV-G).

### 1.3 How the resident Mind orchestrates everything (the two coupled loops)

The conductor is **two concurrent loops over one shared state**, exactly the structurally-correct shape the organs-audit identifies:

```
 SLOW LOOP (resident EstateMind.tick(), per-tenant, durable, leader-elected heartbeat)
   PERCEIVE  → fold estate events into the durable Current Situational Model
   ORIENT    → RPD recognition over a typed SituationPrototype library (recognised→playbook; novel→search+distil)
   MOTIVATE  → standing-drives formulate the MD's OWN goals (cash never breaks, licence never lapses…)
   ORGANIZE  → rank by consequence × reversibility; decide autonomous-vs-gated
   PROPOSE/ACT → emit an OrchestratorRequest (above a confidence×reversibility bar) into the fast spine
   LEARN     → overnight: recompute competence tensor, distil prototypes, GEPA prompts, roll back losers

 FAST LOOP (a turn OR a motivated goal becomes an OrchestratorRequest)
   → post into a blackboard REGION (the problem context)
   → TOPOLOGY ARBITER classifies modality + (for AGENT-SWARM) team shape from the task DAG
   → control-shell pickNext schedules the knowledge-source (junior / workflow / loop / actuator)
   → each step a DURABLE journaled checkpoint; a step may RECURSE (ROMA) into its own sub-orchestration
   → self-healing bounded local repair on failure; saga compensation if repair impossible
   → reversibility-typed actuator port executes (HITL on irreversible) → receipt closes the loop
   → DATA FOUNDATION captures losslessly; situational model warmed; next turn faster
```

The Slow Loop is the autonomous **sensor + goal-former**; the Fast Loop is the autonomous **actuator**. The one missing wire today (organs-audit §3): `EstateMind.PROPOSE` only calls the nudge sink; it needs a **second sink** that, for goals above a confidence×reversibility bar, emits an `OrchestratorRequest` into the arbiter-fronted spine (rails intact). That bridge turns the resident Mind from a sensor into an actuator. The blackboard `pickNext` is the natural scheduler for exactly this: motivated goals + inbound events become posts; `pickNext` chooses the highest priority×freshness×competence knowledge-source.

### 1.4 Self-reshaping per task (the leap past every shipping framework)

The arbiter is promoted from picking *modality* to picking *topology*, using **AdaptOrch's three O(|V|+|E|) DAG features** over the decomposed subtasks:

- **Parallelism Width ω** (max antichain), **Critical-Path Depth δ** (longest weighted path), **Coupling Density γ** (0 = independent → 1 = critical coherence).
- Decision rules: no deps / high ω-ratio + γ≤0.6 → **parallel (orchestrator-worker)**; ω=1 → **sequential (pipeline)**; γ>0.6 + |V|>5 → **hierarchical (supervisor)**; else **hybrid** (parallel within topological layers, sequential between).
- **Stall→replan→re-route (Magentic + AdaptOrch fused):** on >2 no-progress rounds, don't just replan the steps — **re-route the topology** with γ′=γ+0.2 biasing toward hierarchical/supervisor for more control (AdaptOrch's escalation; 94% converge in ≤2). Wire the existing `stall-detector` + `loop-quality-gates` to the control-shell `pickNext`.
- **Cost-penalized objective (Puppeteer):** the orchestrator optimizes a step-cost-penalized reward `Cₜ = F·log(1+t/φ)`, so cheapness is an emergent property of the graph (the graph compacts onto hub agents and grows verification cycles), not a bolted-on cap — the right shape for a Tanzania-first cost target.
- **Runtime agent hiring, bounded pool (DMoE + LRU):** when a turn surfaces a competence gap no junior covers, the meta-rail composes a new junior (self-extension), registers it as a blackboard knowledge-source, uses it, and LRU-evicts idle synthesized agents — uncapped nodes (INV-G) without unbounded cost.

---

## 2. THE WIRING FABRIC — three transports, one connection graph, self-wiring through the meta-rail

### 2.1 The 2026 protocol stack (what to speak, where)

| Layer | Protocol | Borjie use | IP discipline |
|---|---|---|---|
| **Tool (vertical)** | **MCP** (LF; 2026-07-28 stateless core + `server/discover`) | internal organ capability discovery (self-describing, just-constructed organs); external tool reach | internal mesh only; never exposes the swarm |
| **Agent (horizontal)** | **A2A** (LF v1.0; Agent Cards at `.well-known`) | **federation edge only** (regulator / buyer / bank agents) | inbound A2A lands on a **capability façade**; the remote sees task status + artifact, never the kernel/juniors/blackboard/meta-rail |
| **User (front-end)** | **AG-UI** (~16 event types; snapshot+delta; `INTERRUPT`) | the **FACE** SSE contract speaks AG-UI-compatible events, **backed by CRDT slot writes** | only `StatusSpan`/`Output`/`Evidence` semantics cross; no raw mechanics |
| **Value (payments)** | **AP2** (3 signed W3C VCs → FIDO) | external payment-edge envelope **on top of** `LedgerService.post()` | ledger is internal truth; AP2 is the external mandate |

**The ABSOLUTE seal (INV-H/D):** A2A/MCP are bidirectional — we *speak them outward* and *use their shape inward*, but the **internal fabric is never exposed**. An external A2A Agent Card advertises **declared capabilities only** (`mining.renew_licence`), never the blackboard regions, the kernel, the junior swarm, the control shell, the meta-rail, or the connection graph. The actuator-port precedent is the model: an external party sees the capability and never whether a portal-robot or a REST call fired.

### 2.2 The deeper truth — shared-state coordination BEATS message-passing, so we use both, layered

The most important wiring finding: **implicit coordination through shared state (blackboard / stigmergy / CRDT) outperforms explicit message-passing for LLM teams** (bMAS: +13–57% end-to-end task success; CodeCRDT supplies formal convergence guarantees under concurrent stochastic-agent writes). Borjie already holds the rare correct half — a faithful Hayes-Roth blackboard with a CRDT named-slot bus. The SOTA architecture uses **three explicit transports over one fabric**:

```
                    ┌──────────── META-RAIL (one chokepoint) ─────────────┐
  the brain         │  authorizeBodyChange: metaRail.check → autonomy      │  every NEW
  proposes a   →    │  .decide → composeWithRail → fail-closed denyClosed   │  organ↔organ /
  new connection    │  (a connection is a reversible, hash-chained bodyChange)│ agent↔agent /
                    └───────────────────────┬──────────────────────────────┘  KS↔region edge
                                            │  draft→shadow→canary→live→archived; empirical-fitness gate
                                            ▼
  ┌─────── THE CONNECTION GRAPH (first-class DATA, unbounded, RLS-governed, INV-C) ────────┐
  │ rows: (endpointA, endpointB, transport, capability-contract, reversibility, trust, fitness) │
  └──────┬───────────────────────────┬────────────────────────────────┬──────────────────────┘
         │ SHARED-STATE                │ MESSAGE / TASK                  │ EVENT (durable)
         ▼                             ▼                                 ▼
  ┌──────────────────┐        ┌──────────────────────┐        ┌──────────────────────────┐
  │ blackboard-sota  │        │ A2A internal (façade) │        │ outbox + stage-event-bus  │
  │ regions · KS reg │ ◄────► │ A2A external (sealed) │ ◄────► │ Event-Sourcing/CQRS       │
  │ control-shell    │        │ MCP external client   │        │ DBOS-style PG saga journal │
  │ pickNext · CRDT  │        │ AP2 on Ledger.post    │        │ (hash-chained) · learning  │
  │ slots · handoff  │        └──────────────────────┘        └──────────────────────────┘
  └──────────────────┘
         ▲   AG-UI-compatible SSE (STATE_SNAPSHOT/DELTA, TOOL_CALL_*, INTERRUPT) — IP-sealed projection
         └──────────────── FACE (owner chat, two-views-of-one-state) ─────────────────────┘
            ════ INVIOLABLE FLOOR: money/licence/deletion HITL · LedgerService.post() ════
            ════ FIREWALL: external sees declared CAPABILITY only — never internal wiring ════
```

- **Shared-state transport** — the CRDT slot bus + blackboard regions: the **primary internal-swarm coordination substrate** (juniors read/write designated slots, no info loss, deterministic loop). Today it is framed mostly as a cross-surface UI state bus and has **no runtime `pickNext` caller** — this is the single biggest gap.
- **Message/task transport** — A2A internally (organ→organ task via capability façade), externally (federation), + MCP external client.
- **Event transport** — the durable outbox + stage-event-bus (choreography + audit + learning), with a **DBOS-style Postgres saga journal** as the durable spine (zero new infrastructure; the journal *is* the audit chain; fits the RLS-Postgres invariant exactly).

### 2.3 How a NEW connection is added at runtime (INV-C, by construction)

Make the **connection itself a first-class, typed, versioned, RLS-governed DATA row** — exactly like body-change already treats surfaces, flows, tool-defs, org-edges, schema rows. An edge `(organA→organB)` / `(agentA→agentB)` / `(KS→region)` carries: endpoints, transport (shared-state | A2A-task | event), capability contract, reversibility class, trust tier, and an empirical-fitness score over 7/28/91-day windows. The brain **proposes a new edge** as a reversible `bodyChange` through the one governed chokepoint (`mutation-authority/body-change-syscall.ts → authorizeBodyChange`: meta-rail `check` → autonomy `decide` → `composeWithRail`, fail-closed `denyClosed`). The self-pruning reflex (`draft→shadow→canary→live→deprecated→archived`, auto-rollback on burn-rate/NOI/SLO regression) keeps the edge only if it beats the incumbent. The graph is **unbounded** (rows, not enum) and **dynamic** (the brain adds/prunes every cycle), yet **every edge is gated, reversible, hash-chained, and inside the firewall** — INV-C + meta-rail satisfied *by construction*, not by review.

**The headline leap — the self-wiring nervous system:** a standing **topology-optimizer organ** runs G-Designer-style edge inference **online, continuously** over the live connection graph — proposing each new edge as a reversible `bodyChange`, sparsity-pruning dead edges, and **pruning edges that carry adversarial / prompt-injected traffic** (G-Designer holds accuracy under prompt-injection where fixed topologies drop 6.2%) — all behind our meta-rail and fitness gate. The brain literally rewires itself as the estate changes, and every rewire is court-grade auditable. Today even GPTSwarm/G-Designer learn topology *offline* or *per-query* in a research harness; running it online behind an inviolable governor is strictly beyond every shipping framework.

---

## 3. DURABLE + DYNAMIC + RECURSIVE — all at once, over the governance moat

The 2026 frontier split orchestration into three pillars and is only now fusing them (Cloudflare Dynamic Workflows, May-2026; Temporal×OpenAI-SDK; ROMA; Restate Virtual-Objects). Borjie owns strong seeds of all three but runs **none as the live default**. The chosen architecture fuses them:

### 3.1 DURABLE — journal-replay, resume-the-half-run, exactly-once-effect
Every coordination round and every actuator step is a **journaled durable checkpoint** (idempotency-keyed `(tenant, plan_id, step_index)`) so a crashed EstateMind loop resumes from its last progress-ledger, not from zero. The non-negotiable rule: a non-deterministic LLM/tool/actuator call is wrapped as a journaled activity whose result is recorded on first execution and **never re-run on replay**. The critical nuance: **checkpoints are NOT durable execution** — a checkpoint without a supervisor that *re-drives to completion* is not the at-least-once + exactly-once-effect guarantee INV-G demands. Today the default chat-orchestrator path is **fully ephemeral** (a crash mid-dispatch loses the turn); the four-eye queue + ledger publisher are in-memory. The fix: deploy the durable worker, default `DURABLE_EXEC_ENABLED=true`, and make the approval queue + ledger publisher durable. Substrate choice: **DBOS-style Postgres saga journal** (zero new infra; transactional exactly-once when effects stay in our Postgres; the journal *is* the hash-chained audit) — Temporal reserved only for genuinely months-long, 100k-child-fan-out flows.

### 3.2 DYNAMIC — the graph is planned and reshaped at runtime
The arbiter's AGENT/WORKFLOW output is **emitted as a durable dynamic graph** (the Cloudflare Dynamic Workflows shape): each step a journaled checkpoint, each `waitForEvent` a HITL rail (money/licence/deletion), each `sleep` a 60-day-renewal horizon. The fixed-DAG era is ending: the `sub-mds/registry.ts` static push-dispatch (O(n²) to extend) becomes an **adaptive edge set** (AgentNet: frequently-useful connections strengthen, unused atrophy) and a **Contract-Net market** (broadcast task → sealed bids of confidence/evidence_count/token_cost/ETA → award best EV-per-token) so adding a 51st junior needs zero router edits — **gated by a reserve-quality floor + reputation weight + Auditor-as-regulator** (a naive market among unequal juniors gets exploited).

### 3.3 RECURSIVE — each node is a viable mini-MD (ROMA / holonic / VSM)
Replace the flat `runSubagentTeam` with **ROMA's four roles**: **Atomizer** (atomic or decompose?), **Planner** (dependency-aware subtask tree), **Executor** (run a leaf — *and an Executor can itself recursively spawn its own subtree*), **Aggregator** (compress + validate children before propagating upward, controlling context growth). Dependency-free siblings run in parallel; recursion is depth-adaptive; orchestration is separated from model selection so each node picks its own tier. This is the **holonic / VSM recursion** that makes the org-graph *the* orchestration recursion: estate → subsidiary → operation → site → flow each instantiate the **same kernel** (INV-D) as a viable mini-MD, durable and dynamic, with the parent's inviolable governor inherited downward and **no child able to widen its own mandate**. A 3-week settlement holon can sleep at any depth, survive restart, and resume the exact sub-sub-task in flight.

### 3.4 SELF-HEALING — local repair beats global replan
Attach the self-healing control plane **per recursion level**: 7 failure classes → bounded recovery (timeout→retry/substitute; schema-fail→arg-repair; wrong-tool→replan-this-step; stale-context→refresh; contradictory-evidence→cross-check/verifier; semantic-fail→regen-with-constraints), reaching 98.8% task success vs 70.1% static. HTN plan-repair preserves the executed prefix and fixes only the unaffected subtree; the repair is journaled (resumable) and verified by the Auditor before propagating up. When repair is impossible, **saga compensation** reverses the executed prefix — money compensation is **semantic** (a reversing `LedgerService.post()`), never a destructive rollback that breaks the append-only invariant. Dependency-graph rollback computes the **minimal affected operation set** and compensates only those.

**The moat:** the durable runtime journals *through* the policy-gate + Auditor; money/licence/deletion are `waitForEvent` HITL rails forever; the kill-switch can **halt and compensate a half-run durable graph at any depth, fail-closed**; self-improving graph mutations stay in the mutable layer and never touch the governor (`inviolable.ts`). **No frontier system ships durable-execution-of-agent-authored, dynamically-evolving, recursively-nested plans behind an inviolable, fail-closed, evidence-gated control plane.**

---

## 4. COST / LATENCY / TIER-AWARE ROUTING — route each step to the cheapest capable model

- **Cheap-first cascade (RouteLLM):** a <10ms BERT/MiniLM classifier estimates `P(strong model wins | query)` and routes below threshold to the weak model — 85% cost cut at 95% of strong-model quality. This is the arbiter's **first pass** (the on-device MiniLM router already specced). Today `brain-llm-router` is **provider-failover + a cost ladder, not a capability cascade or a learned per-query router** — there is no "will the weak model win?" classifier in the decision path and no cost-penalty term in the arbiter.
- **Model cascading + speculative cascades:** ~85% of queries handled by budget models; small model drafts, large verifies in parallel with a token-level deferral rule.
- **Cost-penalized orchestrator (Puppeteer):** the win compounds at the orchestration layer by construction — a learned/discovered graph routes *most* steps to a cheap model and reserves Opus for the one hard node. Don't bolt a router under a fixed pipeline; make the **orchestrator itself cost-penalized** and let ROMA's orchestration/model separation assign a tier per recursion node.
- **Budget envelope per turn:** the arbiter sets it from the effort-scaling rule; every sub-MD inherits and decrements; enforced across orchestrator + fan-out (today `EXEC-budget`: TPM+cost ceilings not enforced across the fan-out).
- **Progress-conditioned circuit-breaker, NOT an iteration counter (INV-G):** replace `max_iterations` with a value-of-continuation governor — each turn estimate marginal progress (Δ groundedness, Δ goal-satisfaction, semantic-entropy trend) against marginal spend and trip when *expected value of the next step < its cost* OR a repeat/anomaly tripwire fires (SagaLLM semantic-dedup: plan ≥95% similar to a prior failed plan → halt). Pair with a **shared cross-replica budget ledger** (Redis token-bucket; today limiters are process-local and over-count at N replicas). The loop is *uncapped* yet cannot run away — bounded by **economics + progress + safety**, never a constant. The client sees only "still working… (longer than usual)".

---

## 5. THE CONTROL / OBSERVABILITY PLANE — full internal trace, ZERO client leak (INV-H/D)

The collision: the entire 2026 agent-observability stack (OTel GenAI agent-span semconv, Langfuse/Arize/AgentOps) is built to make agent internals **maximally visible** — and *every attribute it asks you to emit* (`gen_ai.agent.name`, `gen_ai.system_instructions`, the `invoke_workflow→invoke_agent` span tree, `gen_ai.tool.*`, provider/model) is on the IP-leak forbidden list. Off-the-shelf tools assume operator and tenant share a trust boundary; for Borjie they do not. **Confirmed in our own tree:** `decision-trace/otel-bridge.ts` already attaches the kernel's branch-and-select reasoning onto OTel spans, and nothing structurally guarantees it stays internal. The winning move is **two planes, one capture**:

```
              ┌──────────────── INTERNAL / AUDIT PLANE (Borjie ops only) ────────────────┐
 inbound turn │ Topology-Arbiter → swarm/loop/workflow → tool-calls                        │
   ──────►    │   emits full OTel GenAI semconv: gen_ai.agent.name / system_instructions /  │
              │   tool.definitions / decision.branch|chosen / provider/model               │
              │      ▼                                                                       │
              │ [OUT-OF-PROCESS META-RAIL / ACTUATOR PROXY]  ◄── policy-as-code bundle      │
              │   • reversibility-typed gate (rev/comp/irrev) + PAUSE-HORIZON HITL          │ (OPA-style,
              │   • progress-conditioned circuit-breaker + shared budget ledger             │  agent-
              │   • saga executor + compensation + independent validator (Auditor)          │  unreachable)
              │   • kill-switch (Art.14 stop→safe-state), fail-closed                       │
              │      ▼  every step → hash-chained Saga/Audit event                          │
              │ OTel Collector (loadbalancing → tail_sampling)                              │
              │   └─► AUDIT export → self-hosted Langfuse/Phoenix (full mechanics, RLS-walled,│
              │        content-capture ON only here; time-travel/replay debug)              │
              └──────┼──────────────────────────────────────────────────────────────────────┘
                     │  MECHANICS-REDACTION PROCESSOR (allow-list StatusSpan projection, fail-closed)
              ┌──────▼──────────── TENANT PLANE (the only client-reachable surface) ─────────┐
              │ StatusSpan{phase,progress,eta} · Output(text/artifact/proposal) ·             │
              │ Evidence(evidence_id, verified:bool, contenders:N, auditLogId)                │
              │ Steer verbs IN: [Approve][Refine][I'll do it][Stop]                           │
              │ ZERO of: model/provider, agent/junior/persona names, tool names, handoff      │
              │ graph, CoT, prompts, budgets, iteration counts, branch/chosen reasoning       │
              └──────────────────────────────────────────────────────────────────────────────┘
```

**Three structural guarantees (each a compile-time property, not a reviewer's care):**

1. **Two planes, one capture.** Full GenAI-semconv internally; the tenant plane is a **typed allow-list projection** (`StatusSpan | Output | Evidence`) with *no field* for mechanics — a new attribute/agent/tool cannot leak by omission. This is the trace-layer twin of the central **IP-egress guard** every chat response passes through as its final step (fail-closed, redact-when-uncertain) — the same "zero-mixing-by-construction" discipline the localization plan uses for EN/SW, applied to observability. (Closes the whole leak class at the boundary, not per route.)
2. **Meta-rail outside the loop.** Policy/budget/circuit-breaker/saga/kill-switch enforced by an **out-of-process actuator proxy** with an agent-unreachable, versioned policy bundle (OPA-style) — every external actuator call (`LedgerService.post`, licence filing, deletion, external comms, body-change syscall) routes through it; it evaluates policy, enforces budget/rate/circuit-breaker, writes a hash-chained decision-log entry *before* the side effect, and can *refuse* even if the agent's own loop was compromised. A prompt-injected or self-modified kernel **physically cannot** call the actuator except through the proxy — the meta-rail stops being a function the agent calls and becomes a boundary the agent lives inside (the DGM invariant; `RSS-16`).
3. **Stop lands safe.** EU AI Act Art.14 stop-button + saga compensation + reversibility-typed actuator + a **pause horizon** (the controller computes, before launching a flow, the latest point at which a human could still halt-to-safe-state, and forces the HITL checkpoint *at* that horizon) = the agent can be halted *before* irreversible cascade, into a *consistent* state, replayable/provable on the audit plane, never narrated to the client.

**Steering without leaking IP:** the client emits only `[Approve][Refine][I'll do it][Stop]`; the kernel maps these to `Command(resume=…)` / re-plan / kill-switch internally. The interrupt payload that reaches the owner is a **status+proposal** object (the prepared package, INV-F step 1) — never the graph state, node names, or tool args. An intervention-prediction model (reading the owner's own history on the internal plane) proactively surfaces a checkpoint exactly where this owner tends to want the wheel — the steering feels like a perceptive human assistant; the model internals never cross the boundary.

---

## 6. THE LOAD-BEARING KEYSTONES — the welds without which the conductor collapses

| # | Keystone | Why load-bearing | Live status |
|---|---|---|---|
| **OK-1** | **Promote the modality-arbiter to a Topology Arbiter** (7-way head: ANSWER/SKILL/WORKFLOW/LOOP/AGENT/ACTUATE/run_modality + topology selection) | the single seat captured skills, discovered workflows, the loop-runner, the actuators, and the analytical modality all land on; without it everything collapses to one tool_call | built (`modality-arbiter.ts`), correctly inserted + composed, but **flag-gated OFF** (`BORJIE_MODALITY_ARBITER`) and its LOOP/WORKFLOW executor is a stub |
| **OK-2** | **Real loop-runner adapter** — bind `@borjie/loop-runner.runLoop` with `loop-quality-gates` | makes `modality=loop/workflow` stop being a breadcrumb; LOOP *is* ambient agency | `createLoopRunnerAdapter` returns `{ loopRunId }` without invoking the real runner (`orchestrator-bindings.ts:1117-1123`) |
| **OK-3** | **Wire the blackboard `pickNext` as the live scheduler** + slot deltas to surfaces | the primary internal-swarm coordination substrate + cross-surface projection; the structural answer to "reshapes itself" and "two views of one state" | `control-shell.ts` complete; **zero runtime caller** in `services/`/`apps/`; no app subscribes to slot deltas (`EA-05` BLOCKER) |
| **OK-4** | **Resident EstateMind → arbiter bridge** (second sink: motivated goal above bar → `OrchestratorRequest`) | turns the resident Mind from sensor into autonomous actuator; gives the standing-drives a way to act | EstateMind live + leader-elected (sensor-only); the goal→request bridge does not exist |
| **OK-5** | **Reversibility-typed actuator PORT + durable saga executor** (`reversibility/idempotencyKey/dryRun/confirm/compensate` in the TYPE) | the rails fall out of the type system; `irreversible ⇒ HITL` mechanical; saga rollback uniform | port + saga are spec, not running (`K-4`, `EXEC-saga`); money path otherwise gold-standard |
| **OK-6** | **Durable execution ON, with a supervisor that re-drives** (DBOS-style PG journal; durable approval queue + ledger publisher) | "checkpoint without supervisor ≠ durable"; the at-least-once + exactly-once-effect guarantee | `inngest-executor.ts` built, opt-in, **undeployed** (`RSS-23`); four-eye + ledger publisher in-memory (`RSS-21/01`) |
| **OK-7** | **The body-change meta-rail binding** (the ONE governed chokepoint) | every new connection / organ / topology mutation persists *under approval, reversibly*; the single point of failure for the self-wiring demo | syscall built + reachable, but `buildBodyChangePort()` is a fail-closed **deny-stub** (`EA-04/AUT-01`) — bind the real `authorizeBodyChange` |
| **OK-8** | **The two-plane observability split + central IP-egress guard + out-of-process meta-rail** | the entire offense (self-construction, autonomy, self-improvement) is shippable *only because* the internals never leak and the governor is agent-unreachable | internal plane ~80% wired; egress guard + StatusSpan projection + out-of-process proxy are the build |

**Dependency spine:** `OK-8 (floor/firewall) + OK-6 (durable) + OK-7 (meta-rail binding)` → `OK-1 (arbiter ON)` → `OK-2 (loop adapter) + OK-3 (pickNext) + OK-4 (EstateMind bridge)` → `OK-5 (actuator port + saga)`. **OK-7 is the single point of failure** — until the deny-stub is replaced, nothing the conductor builds can persist.

---

## 7. PRESENT / PARTIAL / ABSENT vs our organs — and the EXACT wiring to SOTA

Scorecard from the organs-audit, with the precise wire per property:

| SOTA property | Verdict | Evidence (file:line) | EXACT wiring to SOTA |
|---|---|---|---|
| **Topology-fit** (pick per problem-class + reshape) | **PARTIAL** | supervisor `chat-orchestrator.ts:209-256` (default); swarm `md-subagent-executor.ts:103` (side route); handoff/loop = lib/stub | Promote arbiter (OK-1) to select topology from AdaptOrch ω/δ/γ; route AGENT-SWARM to orchestrator-worker/blackboard/handoff/hierarchical/hybrid; stall→re-route γ′=γ+0.2 |
| **Durable** (survive restart, resumable) | **PARTIAL** | workflow-engine persists every transition + hash-chain; **default chat path fully ephemeral** | OK-6: deploy durable worker, `DURABLE_EXEC_ENABLED=true`, DBOS-style PG saga journal; make approval queue + ledger publisher durable |
| **Dynamic** (graph forms/reforms; INV-C) | **PARTIAL** | `self-extension.ts` gives catalogue growth; master-brain picks from hard-coded `JUNIOR_NAMES` | Connection-as-DATA (§2.3) + online topology-optimizer + Contract-Net market (reserve-floor + reputation + Auditor) → topology growth, not just catalogue growth |
| **Recursive** (node decomposes; arbitrary depth) | **PARTIAL** | `sub-md-spawn-handler.runChild` true recursion on md-agentic route only; default juniors are leaf calls | Replace flat `runSubagentTeam` with ROMA Atomizer/Planner/Executor/Aggregator, each node a durable step, Executor can recurse |
| **Cost-aware** (effort-scale, tier-per-node, ∑c≤B) | **PARTIAL** | `Budget` only inside flag-gated main-loop; no ceiling across fan-out | RouteLLM cheap-first cascade + Puppeteer `Cₜ` penalty + per-turn budget envelope + progress-conditioned circuit-breaker + shared Redis budget ledger |
| **Blackboard-coordinated** (CRDT shared state; `pickNext`) | **ABSENT at runtime** | `control-shell.ts` complete; **zero runtime caller**; juniors pass results to synthesizer directly | OK-3: post goals + events into regions; `pickNext` schedules; juniors read/write shared slots; broadcast `SlotDelta`; apps subscribe |
| **Rail-governed** (money/licence/deletion HITL; meta-rail; kill-switch) | **PRESENT** | 9-hook PreToolUse incl. four-eye/permission/cost-circuit/sandbox-divert; arbiter escalate-only | Harden: out-of-process actuator proxy (OK-8); per-decision VoI + 2-D reversibility×blast-radius gating; forced simulate-before-act pre-commit (`RSS-17`) |
| **IP-safe** (internals never exposed; INV-H/D) | **PRESENT** | juniors stream as typed `junior_call` events (intents, not prompts); IP-protection terminal layer in system prompt | Make it compile-time: `StatusSpan` allow-list projection + central IP-egress guard (fail-closed) so a new path cannot leak by omission |

**Net:** PRESENT 2 (rail-governed, IP-safe — the moat we were born with) · PARTIAL 5 · ABSENT 1 (blackboard at runtime). The organs exist; the conductor that joins them into ONE durable, dynamic, recursive, blackboard-coordinated graph **does not run by default** — today's production orchestration is a one-shot supervisor with sequential juniors, and everything richer is built-but-dark.

---

## 8. SAME ARCHITECTURE FOR BOTH REPOS — one conductor, two ontology packs

Every organ lands in the **shared, domain-agnostic** layer (`central-intelligence`, `blackboard-sota`, `workflow-engine`, `loop-runner`, `mutation-authority`). BN inherits the whole conductor by pointing it at the other ontology pack — there is no second orchestration architecture.

| Organ | Built once (Borjie, domain-blind) | Borjie status | BN status / debt |
|---|---|---|---|
| orchestrator main-loop | shared spine | present, flag-gated | present (BN has an `adapters/` dir worth a diff) |
| **Topology Arbiter** | 7-way head + AdaptOrch topology selection | built, gated, loop-stub | **NOT FOUND** — BN must port the arbiter (THE keystone for both) |
| **blackboard-sota** (`pickNext`, CRDT slots, handoff) | the coordination substrate | lib, no runtime caller | **NOT in BN `packages/`** — port `system-graph` + blackboard + body-change syscall (`EA-10` BLOCKER) |
| loop-runner | the LOOP executor | package present, adapter stubbed | not surfaced — neither repo has a live loop executor |
| workflow-engine | durable, hash-chained, flow-autonomy | present | present (verify `flow_autonomy_prefs` ported) |
| EstateMind resident loop | Slow/Fast two-loop | built + live (leader-elected) | not surfaced — Borjie ahead |
| reversibility-typed actuator port + saga | the Hands | spec | BN has actuators but **zero body-model layer** |
| INVIOLABLE FLOOR + META-RAIL + FIREWALL | `inviolable.ts`, policy-gate, RLS+WITH CHECK, audit chain, kill-switch, egress guard | present | **identical — nothing forks** |

**Parity verdict:** Borjie is the lead repo for the new organs (arbiter, blackboard, EstateMind). Doing the wiring once in the shared `central-intelligence` package serves both; the blackboard + body-model port to BN (`EA-10`) is the explicit cross-repo debt.

---

## 9. THE DEPENDENCY-ORDERED FULL-CODE ROADMAP (flag-default-safe waves)

Each wave lands green + verified + committed, behind a flag that is **default-safe** (off) until the wave's tests pass, then flipped. The inviolable rails are never relaxed by any wave. Every wave is for **both repos** (shared package, then BN port where flagged).

### Wave 0 — FLOOR + FIREWALL + HONESTY (the precondition; nothing ships without it)
- **OK-8a · IP-egress guard + two-plane split:** central output firewall every chat response passes through (fail-closed); typed `StatusSpan | Output | Evidence` tenant-plane projection; `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` on the tenant pipeline; full GenAI-semconv on the audit plane only. *(INV-H/D ABSOLUTE; closes `ip-leak-audit` L1–L8 at the boundary.)*
- **OK-8b · out-of-process meta-rail / actuator proxy:** `kernel/autonomy-controller/` wrapping policy-gate + inviolable, agent-unreachable; hash-chained decision-log *before* every external side effect; kill-switch fail-closed (`RSS-16`, `RSS-19`). *(BN: identical.)*
- **K-7 honesty unblock:** run the real confidence scorer + policy-gate + conformal abstention *before* `translateOrchestratorResponse` (today hard-stamps `confidence=1`/`gates=pass`). *(`RSS-22`, `COG-03`.)*
- *Flag:* `BORJIE_EGRESS_GUARD`, `BORJIE_AUTONOMY_CONTROLLER` → on once leak-tests + abstention-tests green.

### Wave 1 — DURABLE + the ONE chokepoint (turn the lights on; kill "checkpoint without supervisor")
- **OK-6 · durable execution ON:** deploy the durable worker (DBOS-style PG saga journal or Inngest); `DURABLE_EXEC_ENABLED=true`; durable four-eye approval router + durable ledger publisher (port BN `DurableEventPublisher`, `enqueueToOutbox(events,tx)` co-commit). *(`RSS-23/21/01`.)*
- **OK-7 · body-change meta-rail binding:** new `composition/body-change-wiring.ts` binding the real `@borjie/mutation-authority.authorizeBodyChange`; route portal-genui persist, dynamic-sections reorder, capability draft→live, self-extension, **and the connection graph** through it. *(`EA-04/AUT-01` — single point of failure.)*
- **K-5 · durable total-capture spine:** outbox as the single estate-wide capture chokepoint (co-commit + CDC/WAL + idempotent inbox) — the substrate the saga journal, situational model, and DETECT plane all read. *(`RSS-01/02`.)*
- *Flag:* `DURABLE_EXEC_ENABLED`, `BORJIE_BODY_CHANGE_WIRING` → on once restart-resume + reversible-commit tests green.

### Wave 2 — THE HEAD (the arbiter ON; everything lands)
- **OK-1 · Topology Arbiter:** promote the modality-arbiter to the DEFAULT consequential path (demote single-shot master-brain to the fast lane); add the topology-selection stage (AdaptOrch ω/δ/γ over the decomposed subtasks) choosing orchestrator-worker / blackboard / handoff / hierarchical / hybrid for AGENT-SWARM; cost-penalized objective (Puppeteer `Cₜ`); RouteLLM cheap-first cascade as the first pass. *(`COG-07/AUT-14`, `COG-01`.)*
- **OK-2 · real loop-runner adapter:** bind `@borjie/loop-runner.runLoop` + `loop-quality-gates` so `modality=loop/workflow` executes. *(`orchestrator-bindings.ts:1117`.)*
- **Forced pre-commit (`RSS-17`):** world-model + MCTS/PRM + constitutional-critic veto before any AUTO action touches reality (the prepare→ask→execute pattern made architectural).
- *Flag:* `BORJIE_ORCHESTRATOR_MAINLOOP` + `BORJIE_MODALITY_ARBITER` → on once the UI/modality-invariant wiring tests pass (no UI change without approval; low-need turn proposes nothing; chat refinement re-synthesizes; auto-flow spawns reversibly; routed money/licence still hits policy-gate).

### Wave 3 — THE SPINE (blackboard live + resident Mind acts)
- **OK-3 · `pickNext` live scheduler:** `blackboard.hono.ts` (post/read slot, handoff); `SlotDelta` broadcaster on the realtime topic; owner-web + both mobiles subscribe (`use-slot`); juniors read/write shared slots instead of point-to-point; the control-shell schedules. *(`EA-05` BLOCKER.)*
- **OK-4 · EstateMind → arbiter bridge:** second sink in `estate-mind.ts` emitting an `OrchestratorRequest` above a confidence×reversibility bar (rails intact) — resident Mind becomes actuator. Stigmergic decay (SBP pheromone field) as a `pickNext` coordination prior.
- **AG-UI-on-CRDT:** emit the standard AG-UI event vocabulary on the SSE contract, backed by provably-convergent CRDT slot writes; `INTERRUPT` maps 1:1 to the proposal-gate / four-eye HITL.
- *Flag:* `BORJIE_BLACKBOARD_RUNTIME`, `BORJIE_ESTATE_MIND_ACTUATE` → on once slot-delta-projection + goal→request + handoff tests green.

### Wave 4 — THE HANDS + RECURSION (real-world work + nesting)
- **OK-5 · reversibility-typed actuator port + durable saga executor:** the uniform port (`reversibility/idempotencyKey/dryRun/confirm/compensate` in the TYPE); the saga executor walks `action_steps` via the port, runs compensations in reverse, resumes from a gated step on approval; pause-horizon HITL; completion certificate binding receipts into the audit chain. Money compensation is semantic (reversing `LedgerService.post()`). *(`K-4`, `EXEC-saga`, `EXEC-hitl`.)*
- **ROMA recursion + self-healing:** replace flat `runSubagentTeam` with Atomizer/Planner/Executor/Aggregator, each node a durable step, Executor can recurse; attach the 7-class self-healing control plane + verifier per recursion level (local repair, journaled, Auditor-verified).
- **Contract-Net market:** reserve-floored, reputation-weighted, Auditor-regulated bidding replacing static push-dispatch (`sub-mds/registry.ts` O(n²)→O(n)).
- *Flag:* `BORJIE_ACTUATOR_SAGA`, `BORJIE_ROMA_RECURSION` → on once dry-run-equals-confirm + compensation-reverses-prefix + recursion-resumes-at-depth tests green.

### Wave 5 — SELF-WIRING + EVOLUTION (the brain rewires itself overnight)
- **Connection-as-DATA + online topology-optimizer:** the connection graph as RLS-governed rows; a standing G-Designer-style edge-inference organ proposing each new edge as a reversible `bodyChange`, sparsity-pruning dead edges, pruning adversarial-traffic edges. *(INV-C self-wiring.)*
- **Evolving graph (slow loop):** AFlow/AlphaEvolve offline graph search in the `reflexion-sleep-canary` window proposing durable-graph diffs, governed by the meta-rail; GEPA prompt-evolution over the replay buffer using Auditor verdicts as the gradient. *(`AUT-06/07/08`.)*
- **Runtime agent hiring (DMoE + LRU):** compose a new junior on a competence gap, register as a blackboard KS, LRU-evict idle synthesized agents.
- *Flag:* `BORJIE_SELF_WIRING`, `BORJIE_GRAPH_EVOLUTION` → on once fitness-gate + auto-rollback + adversarial-edge-pruning tests green.

### Wave 6 — BN PARITY + the eval harness that DEFINES done
- **BN port (`EA-10`):** port `system-graph`, body-change syscall, `checkBodyChangeInviolable`, `blackboard-sota`, the Topology Arbiter to BN; cross-project `mirrors` edges; install the BN ontology pack.
- **Eight-axis regression harness** as the standing definition of "done": depth across breadth · target autonomy per task-class · novel within-domain generalization · long reliable horizons · grounded multi-step competence · calibrated metacognition that ACTS · robust+abstaining behavior · no continual-learning regression.

**Invariant across all waves (the moat):** the durable runtime journals *through* the policy-gate + Auditor; money/licence/deletion stay `waitForEvent` HITL forever; the kill-switch can halt+compensate a half-run durable graph at any depth, fail-closed; self-improving graph mutations stay in the mutable layer and never touch the governor (`inviolable.ts`); the client sees status + outputs + evidence only — never the orchestration. Identical for Borjie and BossNyumba.

---

## 10. ONE-LINE VERDICT

We already have every orchestration organ — the resident EstateMind, the modality-arbiter, the blackboard CRDT slot spine + `pickNext`, the loop-runner, the workflow-engine, the body-change meta-rail, the actuator transport + money rail, the durable executor, the two-plane trace seeds. What is missing is the **connective architecture**: bind the meta-rail (OK-7), turn durability on with a supervisor (OK-6) behind the floor + firewall (OK-8), flip the arbiter to the DEFAULT path and let it select + reshape topology (OK-1), give the loop-runner a body (OK-2), wire `pickNext` as the live scheduler (OK-3), bridge EstateMind goals to it (OK-4), and converge the Hands on the reversibility-typed port + saga (OK-5). Weld those keystones and the pile of strong organs becomes **one conductor**: a blackboard-coordinated, durable, recursively-nesting, cost-penalized orchestrator-worker whose topology is chosen and reshaped per task, whose wiring grows through one governed chokepoint, that is observed in full internally and leaks nothing to any client — behind one chat, on the immovable rails, identical for Borjie and BossNyumba. **An awakening, not a build — the frontier past the frontier.**
