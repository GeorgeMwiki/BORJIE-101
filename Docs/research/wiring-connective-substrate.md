# Wiring the Connective Substrate — 2026 SOTA Frontier Dossier

**Lane:** `agent-connective-substrate-frontier`
**Date:** 2026-06-09
**Author:** Mr. Mwikila research lane (Borjie brain layer)
**Scope:** the 2026 state-of-the-art of the CONNECTIVE SUBSTRATE — the layer
that wires many agents/organs into one coherent system — and how to make
Borjie's existing substrate (CRDT blackboard, central-intelligence kernel,
admin control plane, llm-budget-governor, EstateMind Slow Loop, agent-platform,
durable-execution) the universal coordination spine.

> Owner directive: *"Think about wiring ways we don't even know we can do —
> deep online research, expand to 1000000%, full SOTA."* Every finding below
> carries a **BEYOND-TODAY leap**, a **Borjie amplification**, and a
> **we-did-not-know-we-could-do-this** item.

---

## 0. The substrate we already own (the starting line)

Before surveying the frontier, the honest baseline — what the connective
spine ALREADY is in this repo:

- **`@borjie/blackboard-sota`** — the classic Erman/Hayes-Roth blackboard
  modernised: `regions`, `knowledge sources`, an opportunistic `control shell`
  + `activation-policy` (freshness-scored knowledge-source picking),
  `crossref-detector` (cosine-similarity cross-reference detection),
  token-budgeted `summary-generator` + rolling-summary cron, a per-region
  `hash-chain` audit. **On top of that** the **cross-surface state bus**:
  named CRDT slots (LWW register + version vector, total-order tie-break:
  `clock → wallClockMs → writerId`), a durable SQL slot repository
  (migration 0319, `blackboard_slots`), a `slot-store` emitting `SLOT_DELTA`,
  and a `handoff` service to re-project live state onto another surface/device.
  Source: `packages/blackboard-sota/src/` (notably `slots/slot-crdt.ts`,
  `slots/slot-store.ts`, `control/control-shell.ts`).
- **`central-intelligence` kernel** — CoALA cognitive arch; orchestrator with
  `main-loop`, `tool-dispatcher`, `lats-search` (tree search), `planner-dispatcher`,
  `decision`, `honest-confidence`, `stage-event-bus`, `checkpoint`.
  Source: `packages/central-intelligence/src/kernel/orchestrator/`.
- **EstateMind Slow Loop** — resident, leader-elected, propose-only cognitive
  cycle PERCEIVE→ORIENT→MOTIVATE→PROPOSE→FORGET; the situational model IS the
  durable state between ticks; idempotent + never-throws.
  Source: `packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts`.
- **`agent-platform`** — A2A auth + agent-card (`a2a/`), webhook-delivery,
  idempotency, correlation-id, error-codes, junior-contract, junior-spawner,
  mcp-external-client, planning. Source: `packages/agent-platform/src/`.
- **Durable execution** — `packages/workflow-engine` (definitions, runs,
  deltas, commit, approval, review, autonomy, audit) plus an Inngest executor
  in `packages/central-intelligence/src/durable/` (inngest-client,
  inngest-executor, functions) — **currently the weakest-wired backbone**.
- **Admin control plane** — core LLM + ordered fallbacks + ensemble
  {first-wins/vote/judge/debate} + per-use-case routing + AI-suggest.
- **`@borjie/llm-budget-governor`** — cost-weighted token budget + tiers.
- **IP-egress + input-containment guards** (BP-1..BP-5, shipped).

**The thesis of this dossier:** Borjie has, almost by accident, built the
exact substrate the 2026 literature now says is SOTA for agent coordination
— a **CRDT blackboard as an observation-driven coordination spine**. The
frontier is no longer "should we use a blackboard"; it is *how to make the
blackboard the universal, self-optimising, durable coordination spine* —
adding stigmergic pressure-fields, dynamic-topology arbitration, a clean
protocol stack on its rim, durable-execution as its long-horizon memory, and
self-evolving topology learned from its own audit chain.

---

## 1. Blackboard / shared-memory coordination at scale

### 1.1 The frontier has converged ON the blackboard (and named our exact choice)

The most important 2026 result for Borjie: **CodeCRDT** (arXiv 2510.18893,
"Observation-Driven Coordination for Multi-Agent LLM Code Generation") shows
LLM agents coordinating through a **shared CRDT blackboard** instead of
messaging — agents independently OBSERVE state deltas and react, exactly the
`SLOT_DELTA` event we already emit. It explicitly fuses four lineages:
Hearsay-II blackboards, **Linda tuple spaces**, CRDTs, and stigmergy. The
named failure modes are precisely the ones our control-shell must police:
redundant overlapping effort, convergence uncertainty, observation lag on
stale snapshots, merge overhead.

Independently, the **LLM-Based Multi-Agent Blackboard System (bMAS)**
(OpenReview `egTQgf89Lm`) and the **bMAS** paradigm show a blackboard + a
**dynamic meta-control unit** driving SOTA on collaborative reasoning — i.e.
the blackboard wins when paired with an *opportunistic controller that picks
who acts next*. We already have that: `control/control-shell.ts` +
`activation-policy.ts`. The literature just validated it.

> **BEYOND-TODAY leap.** Promote the blackboard from a *state bus* to an
> *observation-driven coordination spine*: every junior agent's loop becomes
> `observe(slot-deltas) → if my activation score is highest for an open region,
> act → write back`. No central dispatcher needed for the common case — the
> control-shell only arbitrates contested regions. This is the CodeCRDT model
> running on the slot-store we already shipped.

> **Borjie amplification.** Our slot CRDT already proves commutativity/
> associativity/idempotence and a TOTAL LWW order — the convergence guarantee
> CodeCRDT says ad-hoc blackboards lack. Our per-region hash-chain gives us
> something CodeCRDT does NOT have: a tamper-evident, replayable record of the
> *coordination itself*, which the Auditor Agent can verify and which becomes
> training data for §6 self-evolution.

> **We-did-not-know-we-could-do-this.** Run the entire 12-organ kernel as
> *one* blackboard problem: the orchestrator's `stage-event-bus` and the
> blackboard's `SLOT_DELTA` are the same primitive viewed twice. Collapse them
> so the kernel's internal stages and the cross-surface juniors share ONE
> observation log — then a buyer-mobile UI surface, a Slow-Loop drive, and a
> metallurgy junior are all just knowledge sources on the same board.

### 1.2 Make it scale: regions as the shard key, summaries as the floor

The scaling literature (Silo-Bench, arXiv 2603.01045, "evaluating distributed
coordination in multi-agent LLM systems") warns that a single shared board is
a contention point. Our design already pre-empts this — **regions** are the
natural shard, and the rolling-summary cron is the **context floor** that
keeps a hot region's token cost bounded.

> **BEYOND-TODAY leap.** Add a **region-affinity router**: hash
> `(tenantId, regionKind)` to a board partition so concurrent juniors on
> unrelated regions never contend, while the version-vector merge still lets a
> cross-region cross-reference reconcile lazily. The summary becomes the
> *only* thing a cold reader loads — O(1) attention cost regardless of region
> history depth.

> **Borjie amplification.** `region-manager.ts` already has region lifecycle
> (open/active/closed). Bind the partition key to the existing
> `tenant_id`-scoped RLS so coordination sharding and tenant isolation are the
> *same* boundary — zero new isolation surface.

---

## 2. Stigmergic / environment-mediated coordination (the biggest unlock)

### 2.1 Pressure fields + temporal decay — a 4×–32× coordination win

The standout 2026 paper for Borjie is **"Emergent Coordination in Multi-Agent
Systems via Pressure Fields and Temporal Decay"** (arXiv 2601.08129v3). Agents
do NOT message each other. Each region of a shared artifact carries a scalar
**"badness"/pressure** ϕᵢ computed from measurable quality metrics (conflicts,
gaps, unscheduled items). Agents observe LOCAL pressure and propose patches
that reduce it. **Temporal decay** (`f^(t+1) = f^t · e^(−λ_f)`) keeps fitness/
confidence from prematurely freezing a region as "solved", forcing continuous
re-evaluation and escape from local minima. Formalised as a **potential game**
(pressure = potential function) with proven convergence in
`~P₀/(δ_min − (n−1)ε)` ticks and **O(1) coordination overhead — no inter-agent
messaging at all.**

The empirical numbers are decisive (meeting-room scheduling, 1,350 trials):

| Coordination style | Solve rate |
|---|---|
| **Pressure-field stigmergy** | **48.5%** |
| Conversation-based (AutoGen) | 11.1% |
| Hierarchical control | 1.5% |

Cohen's h > 1.16, p < 0.001. Stigmergy beats conversation ~4× and beats
hierarchy ~32×. And the paper's own "how to implement" section says: **a CRDT
blackboard is the natural substrate** — represent regions as CRDT maps, store
pressure as LWW registers, implement decay via operation timestamps, validate
patches on a local CRDT clone before merging, and use tombstones with decay as
inhibition/cooldown. **That is a description of the package we already shipped.**

Two reinforcing 2026 works: **SBP — Stigmergic Blackboard Protocol** (digital
pheromones for agent coordination without rigid orchestration) and
**Ledger-State Stigmergy** (arXiv 2604.03997) which grounds indirect
coordination in append-only ledger state — our hash-chained board *is* a
ledger.

> **BEYOND-TODAY leap — the "Estate Pressure Field".** Add a `pressure` LWW
> sub-register to every slot/region: a scalar derived from real estate metrics
> — overdue royalty, unsold mineral lot, an open safety incident, an expiring
> licence, an unhedged FX exposure, an unfilled job opening. Juniors don't get
> *assigned* work; they CONTINUOUSLY reduce pressure where their competence
> (already in `control-shell`'s competence lookup) gives them the steepest
> local gradient. The estate self-heals toward low total pressure with **zero
> orchestration messages**. EstateMind's MOTIVATE step already computes
> "unsatisfied drives" — that IS the pressure field; we just need to publish it
> as a board signal instead of keeping it internal.

> **Borjie amplification.** We have every ingredient the paper requires and
> ad-hoc systems lack: LWW registers (`slot-crdt.ts`), timestamps for decay
> (`wallClockMs`), validate-before-merge (run on an in-memory slot clone, then
> `mergeSlot`), and tombstones-as-inhibition (`deleteSlot` already produces a
> decaying tombstone). The 48.5%-vs-1.5% result is a *direct argument* for
> keeping HITL gating (hierarchy) ONLY on sovereign/money/licence paths and
> letting everything else self-coordinate stigmergically — which is exactly the
> Slow-Loop's propose-only/never-sovereign contract.

> **We-did-not-know-we-could-do-this.** **Temporal decay as a built-in
> staleness immune system.** Apply `e^(−λt)` decay to a region's "solved"
> confidence so the board AUTOMATICALLY re-opens a stale decision (a forecast
> made 3 weeks ago, a price quote past its validity) and re-attracts a junior —
> no cron, no human, no reminder. The estate never silently runs on stale
> intelligence because the substrate forgets on a half-life. This is a wiring
> we genuinely did not know the CRDT board could give us for free.

---

## 3. Event-driven / actor-model / supervisor-tree / choreography-vs-orchestration

### 3.1 Supervisor trees (Erlang/OTP) for organ fault-isolation

2026 work (Zylos "Supervisor Trees and Fault Tolerance Patterns for AI Agent
Systems"; LangChain "Parallelized LLM Agent Actor Trees"; Akka actor model for
agentic AI; "Bastion = Erlang/OTP for Rust") establishes that the **actor model
+ supervision tree** is the SOTA fault-isolation pattern: each agent is an actor
with private state, communicating asynchronously; a supervisor monitors workers
and restarts them on crash with `OneForOne` / `OneForAll` / `RestForOne`
strategies; failure impact is *scoped to a sub-tree*, never the whole system.
Notably **AutoGen** itself moved to the actor model with an event bus rather
than shared memory.

Borjie's EstateMind already has a **leader-elected heartbeat supervisor** that
isolates per-tenant tick failures (`cycle()` isolates each tenant; `tick()`
never throws, degrades with `degradedReason`). That is a `OneForOne` supervisor
over tenant-actors in all but name.

> **BEYOND-TODAY leap.** Formalise the kernel as an explicit **supervision
> tree**: root supervisor → per-tenant EstateMind actor → per-region junior
> actors. Encode the three OTP restart strategies as policy: a junior crash =
> `OneForOne` (restart just that junior); a board-corruption =
> `RestForOne` (restart the region + everything downstream of it); a kernel
> bootstrap failure = `OneForAll`. The hash-chain lets a restarted actor
> *replay* to the last good board state — supervised AND deterministic.

> **Borjie amplification.** Combine the actor model's fault-isolation with the
> blackboard's shared observation: actors don't message (avoiding AutoGen's
> conversation-coordination weakness, §2.1) — they only read/write the board.
> Supervisor handles *liveness*; blackboard handles *coordination*. This is the
> best-of-both that neither pure-actor (AutoGen) nor pure-blackboard systems get.

> **We-did-not-know-we-could-do-this.** **A "let-it-crash" junior contract.**
> Because the board + hash-chain is the source of truth, a junior agent can be
> made *stateless and disposable*: on any internal error it simply crashes and
> the supervisor respawns it, which re-reads the board and continues. No
> defensive try/catch sprawl inside juniors — Erlang's core insight applied to
> LLM agents. This radically simplifies `packages/ai-copilot/src/juniors/*`.

### 3.2 Choreography vs orchestration — Borjie should be BOTH, partitioned by risk

The 2026 consensus: **orchestration** (central brain, command-driven) for
complex, stateful, mission-critical workflows where one-place change + clear
failure attribution matter; **choreography** (event-driven, decentralized) for
high-throughput, loosely-coupled, genuinely-parallel streams that are more
resilient to individual failure. *Most large systems use both.*

> **BEYOND-TODAY leap — risk-partitioned coordination.** Wire Borjie so the
> **HIGH-risk policy prefixes** (`sovereign`/`kill_switch`/`four_eye`/
> `policy_rollout`, per CLAUDE.md hard rules) are ALWAYS **orchestrated**
> through the durable workflow-engine with explicit four-eye approval and a
> single auditable controller; everything else **choreographs** stigmergically
> on the board. The risk tier *is* the choreography/orchestration switch.

> **Borjie amplification.** This maps 1:1 onto our existing money-path
> (`LedgerService.post()` orchestrated, never choreographed) and the
> propose-only Slow Loop (choreographed proposals, orchestrated execution gate).
> We don't invent a new axis; we name the one we already enforce.

---

## 4. The 2026 agent PROTOCOL stack as the wiring (the rim of the board)

The stack stabilised in 2026 into clean layers (AgentLux, MindStudio, Zylos,
Adam Silva, TURION, DigitalApplied surveys):

| Layer | Protocol | Job | Borjie binding |
|---|---|---|---|
| Agent ↔ tools/data | **MCP** (Anthropic, de-facto std) | vertical tool integration | `agent-platform/src/mcp-external-client` |
| Agent ↔ agent | **A2A** (Google) | horizontal agent coordination | `agent-platform/src/a2a` + `agent-card` |
| Agent ↔ user | **AG-UI** (CopilotKit) | bi-dir runtime stream: messages, tool calls, **state updates**, UI surface events | owner-web / mobile chat surfaces |
| What the user touches | **A2UI** (Google) | generative-UI widget spec | portal-genui / dynamic tabs |
| Payments | **AP2 / x402** | agent-initiated payment | payments-ledger boundary |

The critical detail for us: **AG-UI is an event-based protocol whose stream
literally includes "state updates"** — and A2UI rides inside AG-UI as the
widget spec. Our `SLOT_DELTA` event and the chat-first dynamic-tab spawn are an
*unstandardised AG-UI*. Standardising on the AG-UI event shape makes our board
speak the lingua franca every 2026 frontend/agent framework now consumes.

> **BEYOND-TODAY leap — the board emits AG-UI; A2UI is its render.** Define a
> single mapping: a `SLOT_DELTA` on a `decision`/`document`/`task` slot →
> emit an AG-UI `STATE_DELTA` event whose payload is an A2UI widget descriptor.
> Now the SAME slot write that coordinates juniors ALSO renders the live tab on
> owner-web and both mobile apps, over a protocol any external agent can also
> drive. The cross-surface bus and the protocol rim become one thing.

> **Borjie amplification.** A2A is *already* in `agent-platform`. Wire it so an
> A2A "agent card" advertises a junior's competence vector — the SAME
> competence the `control-shell` uses for activation scoring. One competence
> model, exposed two ways: internally to the board's control shell, externally
> over A2A for federated estates / partner agents (a buyer's procurement agent
> talking A2A to our sales-offtake junior).

> **We-did-not-know-we-could-do-this.** Because AG-UI carries *bi-directional*
> state, a human edit on owner-web becomes an AG-UI inbound event → a board slot
> write → a `SLOT_DELTA` other juniors observe. **The human becomes just
> another knowledge source on the blackboard, indistinguishable from an agent at
> the substrate layer.** Human-in-the-loop stops being a special path and
> becomes a participant in the same stigmergic field — the cleanest HITL wiring
> possible.

---

## 5. Dynamic topology arbitration (swarm vs hierarchy vs pipeline vs market per task)

This is the richest 2026 research vein, and Borjie has none of it yet.

- **GPTSwarm** (arXiv 2402.16823, "Language Agents as Optimizable Graphs"):
  agents = graphs of operation-nodes; edges = communication channels;
  RL-based **edge optimization** prunes/refines the comm graph; **node
  optimization** refines prompts. The graph can be *emergent*, not
  human-designed.
- **DynaSwarm** (arXiv 2507.23261): a **portfolio** of graph structures + A2C
  (advantage actor-critic) discovery of effective sparse subgraphs + a
  LoRA-tuned **per-instance graph selector** (the SAME LLM scores candidate
  topologies and picks the best one for THIS query). Key insight: *different
  queries need different topologies.*
- **AMAS** (arXiv 2510.01617): adaptively DETERMINE the communication topology
  per task. **GTD / Graph-Diffusion** (arXiv 2510.07799): generate comm
  topologies with graph diffusion models. **Graph-GRPO** (arXiv 2603.02701):
  stabilise topology learning with group-relative policy optimization.
- **DyLAN** (Dynamic LLM-Agent Network): topology emerges at runtime from agent
  responses, not predetermined.
- **"From Static Templates to Dynamic Runtime Graphs"** (arXiv 2603.22386):
  the survey that names this whole shift.

> **BEYOND-TODAY leap — a Topology Arbiter organ.** Add an organ that, per task,
> SELECTS the coordination shape: **swarm** (stigmergic board, §2) for
> exploration/parallel reduction of pressure; **hierarchy** (supervisor tree,
> §3.1) for risk-gated money/licence/sovereign chains; **pipeline** (durable
> workflow, §6) for long-horizon deterministic sagas; **market** (auction over
> competence-priced bids) for scarce-resource allocation (which junior gets the
> expensive model budget from the llm-budget-governor). The arbiter is a
> DynaSwarm-style per-instance selector: a small LLM scores candidate topologies
> and the admin control-plane's routing config bounds the choice.

> **Borjie amplification.** Borjie's **admin control plane** (ensemble
> {first-wins/vote/judge/debate} + per-use-case routing + AI-suggest) is
> ALREADY a topology selector for *model ensembles* — it just hasn't been
> generalised to *agent topologies*. Generalise the same {first-wins / vote /
> judge / debate} dial from "how do N models agree" to "how do N juniors
> coordinate": vote → blackboard with majority pressure; debate → A2A
> structured-debate edges; judge → supervisor with a critic node. **The control
> plane becomes the topology arbiter for free.** The llm-budget-governor prices
> each topology (debate is N× more expensive than first-wins) so the arbiter
> optimises *capability per token*, exactly DynaSwarm's "latency comparable"
> constraint.

> **We-did-not-know-we-could-do-this.** **Per-tenant, per-task-type LEARNED
> topology.** Log which topology the arbiter chose and the realised outcome
> (from the hash-chain audit) and let the AI-suggest mechanism in the admin
> plane *learn the best topology per use-case per tenant* — a metallurgy
> assay task converges on "debate", a royalty-reconciliation on "pipeline", a
> marketplace-matching on "market". The org chart of the agents is no longer
> designed; it is *discovered from outcomes*, GPTSwarm-style, but grounded in
> our own audit trail.

---

## 6. Durable execution as the long-horizon backbone

The 2026 durable-execution market (Temporal, Restate, Inngest, DBOS, Hatchet)
converged on one primitive: **a function that resumes exactly where it left off
after a crash**, with exactly-once semantics on external/tool calls. The 2026
selection guidance is sharp:

- **Temporal** — mature, proven at scale, dedicated cluster, state held at
  arm's length behind a service boundary.
- **DBOS** — Postgres-native durability; workflow state in the SAME
  transactional boundary as business data; minimum ops footprint; **but** breaks
  first on Postgres contention (every step is ≥1 write; hot fan-out hammers one
  cluster).
- **Restate** — elegant, simpler to operate; best for **per-session stateful
  agents where exactly-once on tool calls is non-negotiable**.
- **Inngest** — best for **event-driven pipelines firing on webhooks/queue
  messages** (which is exactly our webhook-delivery + at-least-once consumer model).

Borjie already chose **Inngest** (`central-intelligence/src/durable/inngest-*`)
and has a `workflow-engine` package — but the dossier's own audit flags it as
"currently unwired" and "the weakest backbone."

> **BEYOND-TODAY leap — durable execution IS the board's long-term memory.**
> The blackboard is great for the *now* (live coordination, decaying pressure);
> durable execution is great for the *long-horizon* (a 90-day royalty cycle, a
> multi-week mineral-shipment saga, a licence renewal that spans quarters). Wire
> them as a two-tier memory: short-horizon coordination lives as decaying CRDT
> slots; when a region's work crosses a durability threshold (sovereign action,
> money movement, multi-day saga) it is **promoted into a durable Inngest/
> workflow-engine run** whose every step writes back a slot, so the board always
> mirrors the durable truth and a crash resumes exactly.

> **Borjie amplification.** The Inngest event-driven model is a perfect fit for
> our **at-least-once webhook + idempotency-key** invariant (CLAUDE.md). The
> durable step's idempotency key = the board slot's version-vector entry — so a
> redelivered webhook and a replayed workflow step DEDUPE on the SAME key. One
> idempotency model spans transport, workflow, and CRDT. For the money path,
> consider **Restate's exactly-once tool-call** semantics specifically around
> `LedgerService.post()` so a retried payment step can NEVER double-post — a
> stronger guarantee than at-least-once + app-level idempotency alone.

> **We-did-not-know-we-could-do-this.** **Replay the estate.** Because durable
> runs are deterministic and the board is hash-chained, we can REPLAY any past
> decision sequence against a NEW model or a corrected policy ("what would the
> estate have done with the new FX rule?") — durable execution gives
> time-travel debugging and counterfactual what-if over real history, which
> becomes the eval/training signal for §5's learned topology. The backbone we
> thought was just for reliability becomes the substrate for self-improvement.

---

## 7. Beyond Magentic / AutoGen / LangGraph / CrewAI

The 2026 framework consensus is anticlimactic and clarifying: **the framework
is not the moat.** Production teams converged on a **hybrid** — LangGraph as the
orchestration backbone (explicit graph + checkpointing) with CrewAI crews or
direct LLM calls inside individual nodes for deterministic steps; layers kept
clean (orchestration ≠ integration/MCP ≠ model/BYOM). Magentic-One's lasting
contribution is its **orchestrator + task-ledger + progress-ledger** pattern
(a controller maintaining a running ledger of facts/plan/progress and
re-planning on stall) — which is *exactly* a blackboard with a control shell.
The repeated lesson: *"the gap between a good and bad agent system is almost
never the framework — it's the eval pipeline, observability, and failure-
recovery logic."*

> **BEYOND-TODAY leap.** Borjie should NOT adopt a framework; it should
> **subsume their patterns onto its own board**: Magentic's task/progress
> ledger = our hash-chained region + summaries; LangGraph's checkpointed graph =
> our `checkpoint.ts` + durable workflow; CrewAI's role-crews = our juniors with
> competence vectors; AG2's GroupChat-selector = our control-shell's
> activation-policy "who speaks next". Every winning pattern is already an organ
> we own — wire them as ONE board, not four imported runtimes.

> **Borjie amplification.** The "real moat is eval + observability + recovery"
> verdict plays straight to Borjie's strengths: the **hash-chain audit** (eval +
> replay data), the **OTel-first bootstrap** (observability), and the
> **supervisor + durable resume** (recovery). The substrate's differentiators
> ARE the three things the field says actually matter.

> **We-did-not-know-we-could-do-this.** Expose the board as a **LangGraph/AG-UI-
> compatible backend** so external best-of-breed frontends and partner agents
> can drive Borjie without us importing their runtime — interop *outbound*
> without coupling *inbound*. Borjie becomes a coordination *substrate other
> people's agents plug into*, not just a closed system.

---

## 8. Tuple spaces / Linda — the generative-coordination ancestor, modernised

2026 brought a genuine **Linda revival** ("Coordination and Communication
Foundations for Agentic AI"; "Coordination Languages: Back to the Future with
Linda"). Linda's tuple space — a shared associative memory with `out`/`in`/`rd`/
`eval` and **generative communication** (tuples persist independently of
producer and consumer; you read by *associative pattern match*, not by address)
— is recognised as the durable foundation under modern agentic coordination.
The key Linda property our LWW slot store lacks: **associative `rd`/`in` by
content pattern** (read any tuple matching a template), and `eval` (spawn a
process that resolves into a tuple).

> **BEYOND-TODAY leap — give the board Linda primitives.** Add associative
> reads: a junior says `rd({kind: 'mineral_lot', status: 'unsold', grade: '>2g/t'})`
> and the board returns matching slots — coordination by *content pattern*, not
> by slot-id. Add `eval`: writing a "goal tuple" SPAWNS the junior that resolves
> it (this is exactly EstateMind's PROPOSE step generalised). This turns the
> board from a key-value bus into a true generative coordination medium.

> **Borjie amplification.** Our `crossref-detector` (cosine-similarity over slot
> embeddings) is already a *semantic* superset of Linda's exact-match `rd` —
> we can do associative reads by *meaning*, not just by template. So Borjie can
> ship "Linda + embeddings": pattern-match the board by semantic similarity,
> which 1980s Linda could never do.

> **We-did-not-know-we-could-do-this.** **Decoupled-in-time coordination:** a
> tuple written today by a forecast junior can be consumed weeks later by a
> royalty junior that didn't exist when it was written — producer and consumer
> never co-exist. Combined with §2's decay, the board becomes a *living
> medium* where intelligence persists, decays, and is re-discovered by
> agents that arrive later. This is the deepest "we didn't know we could" — the
> substrate coordinates across TIME, not just across agents.

---

## 9. Synthesis — the one-paragraph wiring vision

Make `@borjie/blackboard-sota` the **universal coordination spine**: a
hash-chained CRDT board carrying named slots AND scalar **pressure fields with
temporal decay** (§2), observed by **let-it-crash juniors under a supervision
tree** (§3.1), coordinating **stigmergically** for low-risk work and
**orchestrated through durable workflows** for risk-gated work (§3.2, §6), with
a **Topology Arbiter** (driven by the admin control plane + budget governor)
choosing swarm/hierarchy/pipeline/market per task and *learning* the best shape
from the audit chain (§5), all exposed on its rim through the **MCP/A2A/AG-UI/
A2UI** protocol stack so humans, internal organs, and external agents are
indistinguishable participants (§4), with **Linda-style associative+semantic
reads and `eval`-spawn** turning it into a generative medium that coordinates
across time (§8). Borjie already owns ~70% of this. The frontier work is
*wiring*, not building.

---

## 10. Prioritised wiring backlog (substrate lane)

| # | Wire | Effort | Leverage | Pulls from |
|---|---|---|---|---|
| W1 | Publish EstateMind drives as **pressure-field LWW sub-registers**; juniors reduce pressure by local gradient | M | **Very High** (4×–32× coordination, §2) | §2.1 |
| W2 | Unify `stage-event-bus` + `SLOT_DELTA` into ONE observation log; juniors become observation-driven | M | Very High (§1.1) | §1.1 |
| W3 | **Topology Arbiter** organ; generalise admin-plane {first-wins/vote/judge/debate} from models→agent topologies; budget-governor prices each | L | High (§5) | §5 |
| W4 | Map `SLOT_DELTA` → **AG-UI `STATE_DELTA`** + A2UI widget; one write coordinates AND renders | M | High (§4) | §4 |
| W5 | Formalise kernel as **supervision tree** with OTP restart strategies; let-it-crash junior contract | M | High (§3.1) | §3.1 |
| W6 | Promote risk-gated regions into **durable Inngest/workflow-engine runs** (board mirrors durable truth); Restate exactly-once around `LedgerService.post()` | L | High (§6) | §6 |
| W7 | **Temporal-decay re-open**: decay "solved" confidence so stale decisions auto-re-attract a junior | S | High — staleness immune system (§2) | §2.1 |
| W8 | **Linda primitives** on the board: associative/semantic `rd`/`in` via crossref-detector; `eval`-spawn via PROPOSE | M | Medium-High (§8) | §8 |
| W9 | Expose competence vectors over **A2A agent-card** (one competence model, two surfaces) | S | Medium (§4) | §4 |
| W10 | **Replay/counterfactual** harness over durable runs + hash-chain → eval signal for W3's learned topology | M | Compounding (§6) | §6 |

---

## Sources (real, June-2026)

- CodeCRDT — Observation-Driven Coordination for Multi-Agent LLM Code Generation: https://arxiv.org/pdf/2510.18893
- Emergent Coordination via Pressure Fields and Temporal Decay (v3, Jan 2026): https://arxiv.org/html/2601.08129v3
- Ledger-State Stigmergy — Formal Framework for Indirect Coordination (Apr 2026): https://arxiv.org/html/2604.03997
- SBP — Stigmergic Blackboard Protocol (digital pheromones): https://dev.to/naveentvelu/introducing-sbp-multi-agent-coordination-via-digital-pheromones-2j4e
- LLM-Based Multi-Agent Blackboard System (bMAS): https://openreview.net/pdf?id=egTQgf89Lm
- Silo-Bench — Evaluating Distributed Coordination in Multi-Agent LLM Systems: https://arxiv.org/pdf/2603.01045
- GPTSwarm — Language Agents as Optimizable Graphs: https://arxiv.org/html/2402.16823v3
- DynaSwarm — Dynamically Graph Structure Selection for LLM-based Multi-Agent Systems: https://arxiv.org/abs/2507.23261
- AMAS — Adaptively Determining Communication Topology: https://arxiv.org/pdf/2510.01617
- GTD — Dynamic Generation of Multi-LLM Comm Topologies with Graph Diffusion: https://arxiv.org/html/2510.07799v1
- Graph-GRPO — Stabilizing Multi-Agent Topology Learning via GRPO: https://arxiv.org/html/2603.02701
- From Static Templates to Dynamic Runtime Graphs — Survey of Workflow Optimization: https://arxiv.org/html/2603.22386v1
- MetaGen — Self-Evolving Roles and Topologies for Multi-Agent LLM Reasoning: https://arxiv.org/abs/2601.19290
- Learning to Evolve (TPGO) — Self-Improving MAS via Textual Parameter Graph Optimization: https://arxiv.org/abs/2604.20714
- Evolutionary Generation of Multi-Agent Systems (EvoMAS): https://arxiv.org/pdf/2602.06511
- A Comprehensive Survey of Self-Evolving AI Agents: https://arxiv.org/pdf/2508.07407
- Supervisor Trees and Fault Tolerance Patterns for AI Agent Systems (Zylos, Mar 2026): https://zylos.ai/research/2026-03-16-supervisor-trees-fault-tolerance-ai-agent-systems
- Unleashing AI Collaboration with Parallelized LLM Agent Actor Trees (LangChain): https://www.langchain.com/blog/unleashing-the-power-of-ai-collaboration-with-parallelized-llm-agent-actor-trees
- The Akka Actor Model — Foundation for Concurrent AI Agents: https://pradeepl.com/blog/agentic-ai/akka-actor-model-agentic-ai/
- Agent Protocol Stack 2026 — MCP, A2A, x402 (AgentLux): https://agentlux.ai/blog/the-agent-protocol-stack-in-2026-mcp-a2a-and-x402-explained-2
- Six Agent Protocols Every AI Builder Needs to Know in 2026 (MindStudio): https://www.mindstudio.ai/blog/six-agent-protocols-ai-builders-2026
- Agent Interoperability Protocols 2026 — MCP, A2A, ACP, Convergence (Zylos): https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence
- Agent Protocol Stack — MCP, A2A, UCP, AP2, A2UI, AG-UI (Adam Silva Consulting): https://www.adamsilvaconsulting.com/insights/agent-protocol-stack-from-data-to-ui
- AG-UI Protocol (CopilotKit): https://www.copilotkit.ai/ag-ui
- AG-UI and A2UI Explained — How the Emerging Agentic Stack Fits Together (CopilotKit): https://www.copilotkit.ai/blog/ag-ui-and-a2ui-explained-how-the-emerging-agentic-stack-fits-together
- AG-UI Overview — Agent User Interaction Protocol: https://docs.ag-ui.com/
- DBOS vs Temporal — Choosing Durable Execution in 2026: https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution
- AI Agent Workflow Orchestration — Temporal, Inngest, Restate on GPU Cloud (2026): https://www.spheron.network/blog/ai-agent-workflow-orchestration-temporal-inngest-restate-gpu-cloud/
- Durable Execution — How Temporal, Restate, DBOS Rethink Distributed State (Apr 2026): https://devstarsj.github.io/2026/04/03/durable-execution-temporal-restate-dbos-distributed-workflows-2026/
- Inngest vs Temporal (Akka.io): https://akka.io/blog/inngest-vs-temporal
- Saga Pattern — Choreography vs Orchestration (Apr 2026, InterviewNoodle): https://interviewnoodle.com/choreography-vs-orchestration-two-approaches-to-the-saga-pattern-8c320a5bc127
- Multi-Agent Orchestration Patterns — Supervisor/Swarm/Pipeline/Router (Lushbinary): https://lushbinary.com/blog/multi-agent-orchestration-patterns-supervisor-swarm-pipeline-router-guide/
- LangGraph vs CrewAI vs AutoGen — 2026 Orchestration Guide (DEV): https://dev.to/pockit_tools/langgraph-vs-crewai-vs-autogen-the-complete-multi-agent-ai-orchestration-guide-for-2026-2d63
- Linda (coordination language) — Wikipedia: https://en.wikipedia.org/wiki/Linda_(coordination_language)
- Coordination and Communication Foundations for Agentic AI (Extended Abstract): https://www.researchgate.net/publication/400550819_Coordination_and_Communication_Foundations_for_Agentic_AI_Extended_Abstract
- DyLAN — Dynamic LLM-Agent Network: https://www.emergentmind.com/topics/dynamic-llm-agent-network-dylan
