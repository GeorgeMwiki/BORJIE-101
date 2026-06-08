# Orchestration Wiring Protocols & Shared State — the CONNECTIVE fabric

**Document:** `Docs/research/orch-wiring-protocols.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Lane:** `wiring-protocols-and-shared-state` — how organs/agents WIRE together so the
connection set is **unbounded + dynamic (INV-C)** yet **governed (rails + meta-rail)**.
**Status:** research dossier — no code, no commit. SOTA survey of June-2026 agent
communication protocols + shared-state-vs-message-passing coordination, mapped onto
Borjie's existing substrate, with a "beyond-today" leap per finding.
**Bar:** SOTA, best-in-the-world, fiduciary-grade. We cannot be less than SOTA.

> **Sibling invariant.** Everything below is the **same brain** in Borjie (mining-estate)
> and BossNyumba (real-estate). The wiring fabric is built once, domain-agnostic; only the
> ontology pack and the deterministic domain engines differ. "Mine" reads "or property".

---

## 0. Thesis in one paragraph

The organs already exist. What this lane owns is the **connective tissue** — the protocols
and the shared-state spine through which organs and agents address, discover, message,
co-edit, and hand off to each other. The 2026 frontier has converged on a clean **layered
protocol stack** — **MCP (agent↔tool, vertical)**, **A2A (agent↔agent, horizontal)**,
**AG-UI (agent↔user)**, with **AGNTCY/OASF + ANP** as the discovery/identity substrate and
**AP2** as the value rail — *and simultaneously* on a second, deeper realization: that the
strongest multi-agent coordination is **not message-passing at all** but **shared-state
(blackboard / stigmergy / CRDT)**, where agents coordinate by reading and writing a common
problem-state rather than by addressing each other. Borjie already holds the rare, correct
half of this: a **CRDT named-slot bus** (`packages/blackboard-sota`), a **Hayes-Roth control
shell** (`pickNext` metalevel scheduler), a **knowledge-source registry**, a **handoff
primitive**, A2A agent-cards + task-lifecycle + `.well-known` server, and an MCP external
client. The job is to (a) **unify** these two coordination modalities into one fabric, (b)
make the **connection set itself first-class data** so the brain can add an organ↔organ or
agent↔agent edge **at runtime through the meta-rail** (INV-C), and (c) keep every edge
**governed, reversible, hash-chained, and IP-sealed** (INV-H/D — orchestration internals
never leak to any client). The frontier leap is a **self-wiring nervous system**: the brain
proposes a new connection as a reversible `bodyChange` data-patch, an empirical-fitness gate
keeps it only if it earns its keep, and the topology redraws itself — a **G-Designer-style
learned, task-adaptive agent graph** running behind our own rails.

---

## 1. The 2026 protocol stack — what the world standardized on

The "protocol war" of 2025 resolved in 2026 into a **complementary layered stack**, not a
single winner. The reference architecture across Google, Microsoft, AWS, Salesforce, SAP and
ServiceNow is now **"MCP for vertical tool integration, A2A for horizontal agent
coordination"** ([Zylos, 2026-03-26](https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence)).

| Layer | Protocol | Owns | Discovery / identity | 2026 status |
|---|---|---|---|---|
| **Tool (vertical)** | **MCP** (Model Context Protocol) | agent→capability (tools, resources, prompts) | MCP Registry (18k+ servers), `server/discover` | LF-governed; **2026-07-28 RC**: stateless core, Extensions framework, Tasks, **MCP Apps**, auth hardening, 12-mo deprecation policy |
| **Agent (horizontal)** | **A2A** (Agent2Agent) | agent→agent task delegation | **Agent Cards** at `/.well-known/agent.json` (RFC 8615), JWS-signed | **v1.0**, Linux Foundation, 150+ orgs, prod at MS/AWS/Salesforce/SAP/ServiceNow; **AP2** ships as formal extension |
| **Agent (REST-native alt)** | **ACP** (Agent Communication Protocol) | agent→agent over plain HTTP verbs + OpenAPI | OASF descriptions | alternative to A2A; pairs with OASF |
| **User (front-end)** | **AG-UI** | agent→user event stream + shared UI state | n/a (transport-level) | ~16 event types; AWS Bedrock AgentCore + MS Agent Framework added support Mar-2026 |
| **Network / discovery** | **AGNTCY** (Internet of Agents) + **ANP** | directory, identity, messaging, observability | **OASF** (OCI-based agent schema) + **SLIM** secure low-latency messaging; ANP = W3C DIDs | AGNTCY → Linux Foundation, 65+ cos (Cisco/Dell/Google/Oracle/Red Hat); ANP "not yet ecosystem-ready" |
| **Value (payments)** | **AP2** (Agent Payments Protocol) | agent→agent/merchant payment mandates | three signed **W3C Verifiable Credentials** (Intent / Cart / Payment mandates) | v0.2 (Apr-2026), donated to FIDO Alliance |

**Key distinctions to hold onto.**
- **MCP is vertical** ("agent-to-capability, not agent-to-agent"); **A2A is horizontal**.
  They compose: an A2A remote agent internally uses MCP to reach its tools.
- **A2A's model is client→remote-task→artifact**: a client agent locates a remote agent via
  its Agent Card, sends a task, the remote executes and streams status + returns **artifacts**.
- **Discovery is the contested seam.** Agent Cards at `.well-known` (RFC 8615) are the de-facto
  pull mechanism; centralized registries (MCP Registry, AGNTCY Agent Directory) vs distributed
  search (Agent Name Service, prototyping) remain unsettled. **A Q3-2026 MCP/A2A joint spec
  effort** is the next formal convergence step.
- **MCP's 2026-07-28 RC is a structural reset**: it drops the `initialize` handshake and
  `Mcp-Session-Id`, making the core **stateless** ("any MCP request can land on any server
  instance"), moves client metadata into `_meta`, adds **`server/discover`** so a crawler can
  learn a server's capabilities *without connecting*, and ships **Extensions** (reverse-DNS IDs,
  independently versioned) so new capabilities (MCP Apps server-rendered UI, Tasks long-running
  work, AP2 payments) stabilize as opt-in extensions before entering core.

**Borjie already holds the protocol primitives.** The repo carries A2A
(`packages/agent-platform/src/a2a/`: `agent-card.ts`, `agent-card-signer.ts`,
`task-lifecycle.ts`, `well-known-server.ts`) and an MCP **external** client
(`mcp-external-client/`: stdio/http/sse transports, OAuth token manager, audit-chain link).
This is the *external* federation surface. The lane's work is the *internal* fabric — and the
discipline that the internal fabric is **never exposed** through these external surfaces
(INV-H/D: a buyer agent that speaks A2A to us must see only declared capabilities, never our
12-agent kernel, junior swarm, blackboard regions, or meta-rail).

---

## 2. The deeper finding — shared-state coordination BEATS message-passing

The most important 2026 research result for this lane is that **implicit coordination through
shared state outperforms explicit message-passing / hierarchical control** for LLM agent teams.

- **LLM-based Multi-Agent Blackboard System** ([arXiv 2510.01285](https://arxiv.org/pdf/2510.01285),
  Feb-2026) revives the 1980s blackboard architecture as a *new* communication paradigm for LLM
  agents: a **shared blackboard** (problem-state), a **control component** that picks which agent
  acts next given the current state, and agents as **specialized knowledge sources** that read
  context and write intermediate solutions. It **decouples** agents, enables **asynchronous,
  non-sequential** participation with **no predefined hierarchy**, and lets agents build
  incrementally on prior work. *(This is, verbatim, the Hayes-Roth blackboard — and Borjie
  already implements its control shell.)*
- Blackboard designs **prevent critical information loss in long conversational context** and
  make the loop **more deterministic** — each agent reads/writes designated fields rather than
  relying on implicit conversational memory. Studies show **13%–57% end-to-end task-success
  improvement** over RAG-based alternatives
  ([Developers Digest, 2026](https://www.developersdigest.tech/blog/how-to-coordinate-multiple-ai-agents)).
- **Stigmergic Blackboard Protocol (SBP)** ([dev.to](https://dev.to/naveentvelu/introducing-sbp-multi-agent-coordination-via-digital-pheromones-2j4e))
  and **Emergent Coordination via Pressure Fields and Temporal Decay**
  ([arXiv 2601.08129](https://arxiv.org/pdf/2601.08129)) push further: agents leave **decaying
  digital "pheromone" signals** on the shared board instead of A telling B what to do —
  coordination *emerges* from environment modification, ant-colony style, **without
  coordinators, planners, or message-passing**.
- **Emergent Coordination in Multi-Agent Language Models** ([arXiv 2510.05174](https://arxiv.org/abs/2510.05174))
  proves with **partial information decomposition of time-delayed mutual information** that real
  coordination (not spurious temporal coupling) emerges when agents get **persona-linked
  differentiation + perspective-taking** — "effective performance requires both alignment on
  shared objectives and complementary contributions." This is the information-theoretic license
  for our blackboard regions + typed knowledge sources.
- **CodeCRDT** ([arXiv 2510.18893](https://arxiv.org/pdf/2510.18893)) supplies the missing
  rigor: **observation-driven coordination with formal CRDT convergence guarantees under
  concurrent writes by stochastic LLM agents** — exactly the safety proof Borjie's LWW slot
  register already encodes (commutative/associative/idempotent merge over an at-least-once
  transport).

The lineage is explicit and old-is-new: **Linda tuple-spaces** (coordination via shared
associative memory) → **blackboard** (shared problem-solving state) → **stigmergy** (virtual
pheromones) — all now the 2026 reference for *decentralized, environment-mediated* multi-agent
coordination, displacing hierarchical orchestration. The AI-agent-mesh guides confirm
**"blackboard"** is now a first-class topology alongside mesh/hub-spoke/hierarchical
([AppScale, 2026](https://appscale.blog/en/blog/ai-agent-mesh-architecture-multi-agent-coordination-2026)).

**Borjie is already on the right side of this.** `packages/blackboard-sota` is a faithful
Hayes-Roth blackboard: **regions** (problem contexts: `incident-investigation`,
`royalty-filing-prep`, `buyer-deal-room`, `shift-planning`, `regulator-correspondence`,
`deep-research-session`, `dashboard-composition`), a **knowledge-source registry**, a
**`pickNext` control shell** (`scoreActivation` over measured competence + recency, ties broken
by `ks.id` — deterministic metalevel scheduling), a **CRDT named-slot bus** (LWW register +
version-vector lattice join, pure/total-ordered merge), a **handoff** primitive (re-project the
same live slot onto the surface the human is now looking at), a **hash-chained post audit**, and
a **cross-ref detector** (embedding-based). The connective gap is wiring these into the
**runtime** as the *primary* coordination substrate for the junior swarm — not just a
cross-surface UI state bus.

---

## 3. The two coordination modalities — and why we need BOTH

| | **Shared-state (blackboard / tuple-space / CRDT)** | **Message-passing (A2A task delegation / event bus)** |
|---|---|---|
| **How** | agents read/write a common state object; control shell picks next actor | agent addresses agent with a task; remote returns artifact |
| **Coupling** | loose; no addressing; async, non-sequential | explicit; addressed; request/response or streaming |
| **Strength** | emergent coordination, no info loss, deterministic loop, +13–57% task success | clear delegation contracts, cross-org federation, durable choreography |
| **2026 vehicle** | Borjie `blackboard-sota`; SBP; CodeCRDT | A2A (LF), event-driven (Kafka/NATS JetStream) |
| **Borjie role** | **internal swarm** coordination (juniors + organs around a region) | **federation edge** (external agents) + **durable choreography** of long-running loops |

The SOTA architecture **uses both, layered**: shared-state for the *internal* swarm working a
region (cheap, emergent, loss-free), message-passing/event-driven for *cross-boundary*
delegation and *durable* multi-step choreography. Confluent's four canonical event-driven
multi-agent patterns — **orchestrator-worker, hierarchical, blackboard, market-based** — all
"transform into event-driven distributed systems" over a durable backbone
([Confluent, 2026](https://www.confluent.io/blog/event-driven-multi-agent-systems/)), with
**NATS JetStream / Kafka providing the durable, replayable, ordered event log** that lets
autonomous agents coordinate safely at high throughput, using **Event Sourcing, CQRS,
Event-Carried State Transfer, and Choreography**.

**Borjie mapping.** We already have the durable backbone shape: the `event_outbox` +
total-capture spine (the FABRIC's `DETECT → REGISTER → LADDER → ROUTE → ACT → CONFIRM` loop),
the `stage-event-bus` (typed ordered turn lifecycle: `intent → megaprompt → plan → step → outcome
→ learning`), and the `realtime-adapter` (Supabase channel, at-least-once). The lane's job is to
**name these as one wiring fabric** with three explicit transports:
1. **Shared-state transport** — the CRDT slot bus + blackboard regions (internal swarm).
2. **Message/task transport** — A2A internally (organ→organ task), externally (federation).
3. **Event transport** — the durable outbox/stage-bus (choreography + audit + learning).

---

## 4. Durable execution — the choreography must survive crashes

Long-running agent loops (the FABRIC's drive-to-closure, the saga executor, the EstateMind Slow
Loop) demand **durable execution**: the 2026 maturity is **Temporal / Restate / DBOS**, which
"guarantee code runs to completion, automatically resume after crashes, retry failures, and
maintain exactly-once semantics" by recording **every step as an immutable event history**
([Dev Note, 2026-04](https://devstarsj.github.io/2026/04/03/durable-execution-temporal-restate-dbos-distributed-workflows-2026/)).
The decisive pattern for agents: **deterministic workflow code orchestrating non-deterministic
activities** — "LLM calls, tool uses, API requests are non-deterministic and belong in
*activities* whose results are **journaled on first execution and never re-run on replay**; the
sequencing/control-flow belongs in the *workflow*." DBOS is notable: **zero new infrastructure —
just Postgres** — which fits Borjie's RLS-Postgres invariant exactly (the journal can be a
tenant-scoped, hash-chained table).

**Borjie mapping.** Each `flow_id` is already "a durable workflow that survives restart"
(MASTER_ARCHITECTURE §1.2/§1.4). The lane should make the **saga executor + EstateMind tick**
journal each actuator step (idempotency-keyed `(tenant, plan_id, step_index)`) into a
Postgres-backed, hash-chained event history, so the workflow replays deterministically and the
non-deterministic LLM/actuator activity is journaled-once — exactly-once *effect* over
at-least-once delivery, with our money/licence/deletion HITL gates as the irreversible-step
barrier.

---

## 5. How the connection set stays UNBOUNDED + DYNAMIC yet GOVERNED (INV-C)

The owner invariant: **no cap on nodes/connections; the nervous system dynamically forms and
reforms its own wiring.** The 2026 research that operationalizes this is **learned, task-adaptive
agent topology**:

- **GPTSwarm** ([arXiv 2402.16823](https://arxiv.org/html/2402.16823v3)) models agents as an
  **optimizable computational graph** and uses RL to **co-optimize node prompts AND edge
  connectivity** — the connection set is a *learned variable*, not a hand-drawn diagram.
- **G-Designer** ([arXiv 2410.11782](https://arxiv.org/html/2410.11782v1)) generates a
  **task-adaptive communication topology per query** via a **variational graph auto-encoder**:
  encode each agent (LLM base, role, tools) + a **task virtual node** → sketch a fully-connected
  edge-probability graph → **refine with sparsity regularization** to prune unnecessary edges →
  optimize by policy gradient on task outcome. Results: **near-SOTA quality at 23.7% of DyLAN's
  token cost**, and — critically for fiduciary safety — **adversarial robustness**: it "detects
  malicious inputs and **prunes the corresponding edges**," holding accuracy under prompt-injection
  attacks where fixed topologies drop 6.2%.
- **MASS** showed prompt-search and topology-search are **mutually reinforcing**; **MetaGen**
  ([arXiv 2601.19290](https://arxiv.org/pdf/2601.19290)) and **SkillGraph**
  ([arXiv 2604.17503](https://arxiv.org/html/2604.17503v1)) evolve **roles AND topologies**;
  **AgentNet** ([arXiv 2504.00587](https://arxiv.org/pdf/2504.00587)) does **decentralized
  evolutionary coordination** with no central graph at all.

**The synthesis for Borjie.** Make the **connection itself a first-class, typed, versioned,
RLS-governed DATA row** — exactly like the body-change architecture already treats surfaces,
flows, tool-defs, org-edges, and schema rows. An edge `(organA → organB)` or `(agentA → agentB)`
or `(KS → region)` is a `connection` row with: endpoints, channel/transport (shared-state |
A2A-task | event), capability contract, reversibility class, trust tier, and an empirical-fitness
score over 7/28/91-day windows. The brain **proposes a new edge** as a reversible `bodyChange`
through the **one governed chokepoint** (`packages/mutation-authority/body-change-syscall.ts` →
`authorizeBodyChange`: meta-rail `check` → autonomy `decide` → `composeWithRail`, **fail-closed**
`denyClosed`). The **self-pruning reflex** (`draft → shadow → canary → live → deprecated →
archived`, auto-rollback on burn-rate/NOI/SLO regression) keeps the edge only if it beats the
incumbent. The graph is **unbounded** (rows, not enum) and **dynamic** (the brain adds/prunes
edges every cycle), yet **every edge is gated, reversible, hash-chained, and inside the
firewall** — INV-C and the meta-rail satisfied *by construction*, not by code review.

---

## 6. IP-leak discipline (INV-H/D) — the wiring is INTERNAL, the capability is EXTERNAL

The protocols above are **bidirectional**: we both *speak* them outward (federate with buyer
agents, regulators, banks via A2A/MCP) and *use their shape* inward. The ABSOLUTE rule
(INV-H/D): **orchestration internals never reach any client.** The actuator-port precedent is
the model — an external party sees the **capability** (`mining.renew_licence`) and never whether
a portal-robot or a REST call fired. The same seal applies to wiring:

- An external A2A **Agent Card** we publish at `.well-known` advertises **declared capabilities
  only** — never the blackboard regions, the 12-agent kernel, the junior swarm, the control
  shell, the meta-rail, or the connection graph.
- Inbound A2A tasks land on a **capability façade** that translates to an internal region/KS
  activation; the remote sees task status + artifact, nothing of the internal topology.
- AG-UI's event stream to the owner's chat surfaces **visible-work at a calibrated resolution**
  (plan cards, evidence chips) — it is the *sanctioned* window into the work, and even it must
  not leak raw orchestration internals (no raw region dumps, no KS competence tables, no edge
  weights) beyond what the visible-work layer deliberately exposes.
- AP2 mandates (Intent/Cart/Payment VCs) ride **on top of** `LedgerService.post()` — the money
  invariant is satisfied by the existing rail; AP2 is the *external* mandate envelope, the ledger
  is the *internal* truth.

---

## 7. AG-UI vs Borjie's bidirectional shared-state FACE (INV-H)

AG-UI standardizes the **agent↔user** edge with ~16 events across five categories:
**Lifecycle** (`RUN_STARTED`, `STEP_STARTED`, `STEP_FINISHED`, `RUN_FINISHED`, `RUN_ERROR`),
**Text Message** (`TEXT_MESSAGE_START/CONTENT/END`), **Tool Call** (`TOOL_CALL_START/ARGS/END`,
`TOOL_RESULT`), **State Management** (`STATE_SNAPSHOT`, `STATE_DELTA`), and **Special**
(`INTERRUPT`, `CUSTOM`, `RAW`). State sync is **snapshot-plus-delta**; human-in-the-loop is
**`INTERRUPT`** (pause for approval — "a safety valve for sensitive actions"); shared state is
**read-only & read-write with streamed event-sourced diffs and conflict resolution**.

**This is precisely Borjie's "Layer-3 bidirectional shared state" FACE** (THE_CHAT_SURFACE) —
"two views of one state": owner drags a slider → `STATE_DELTA` → MD sees it → same chart updates
→ "pin to cockpit" graduates a tab. **The convergence opportunity is real and concrete**: our
SSE contract should **emit AG-UI-compatible events** (the `tool_call`/`reasoning`/`state_delta`
events the gap register already wants), so the FACE speaks a standard the front-end ecosystem
understands — *while the deltas underneath are CRDT slot writes* (our convergence + handoff is
stronger than AG-UI's "conflict resolution" hand-wave because LWW+version-vector is provably
convergent, per CodeCRDT). We get **standard event shape on the wire, CRDT correctness
underneath**. The `INTERRUPT` event maps 1:1 to our proposal-gate / four-eye HITL.

---

## 8. Borjie wiring fabric — the target shape

```
                         ┌──────────── META-RAIL (one chokepoint) ────────────┐
                         │  authorizeBodyChange: metaRail.check → autonomy     │
   the brain proposes →  │  .decide → composeWithRail → fail-closed denyClosed │  ← every NEW
   a new connection      │  connection is a reversible, hash-chained bodyChange│     organ↔organ /
                         └──────────────────────┬─────────────────────────────┘     agent↔agent edge
                                                │  (draft→shadow→canary→live→archived; fitness gate)
                                                ▼
  ┌────────────────── THE CONNECTION GRAPH (first-class DATA, unbounded, RLS-governed) ───────────────────┐
  │  rows: (endpointA, endpointB, transport, capability-contract, reversibility, trust-tier, fitness)     │
  └───────┬───────────────────────────────┬────────────────────────────────┬──────────────────────────────┘
          │ transport: SHARED-STATE        │ transport: MESSAGE/TASK         │ transport: EVENT (durable)
          ▼                                ▼                                 ▼
  ┌─────────────────────┐         ┌──────────────────────┐         ┌──────────────────────────┐
  │ blackboard-sota     │         │  A2A internal         │         │  outbox + stage-event-bus │
  │ • regions (problem  │         │  (organ→organ task,   │         │  • Event Sourcing/CQRS    │
  │   contexts)         │         │   capability façade)  │         │  • durable replay         │
  │ • KS registry       │  ◄────► │  A2A external          │  ◄────► │  • saga journal (DBOS-    │
  │ • control-shell     │         │  (.well-known card,   │         │    style, Postgres+hash)  │
  │   pickNext          │         │   federation, sealed) │         │  • learning sink          │
  │ • CRDT slot bus     │         │  + MCP external client │         └──────────────────────────┘
  │ • handoff           │         │  + AP2 on Ledger.post │
  │ • hash-chain audit  │         └──────────────────────┘
  └─────────────────────┘
          ▲                                                          ▲
          │  AG-UI-compatible SSE (STATE_SNAPSHOT/DELTA, TOOL_CALL_*, INTERRUPT) — IP-sealed
          └──────────────────────── FACE (owner chat, two-views-of-one-state) ──────────────┘
                ════ INVIOLABLE FLOOR: money/licence/deletion HITL · LedgerService.post() ════
                ════ FIREWALL: external sees declared CAPABILITY only — never internal wiring ════
```

---

## 9. Beyond-today leaps (one per finding)

1. **Self-wiring nervous system (the headline leap).** Today even GPTSwarm/G-Designer learn a
   topology *offline* or *per-query* in a research harness. Borjie's leap: a **standing
   topology-optimizer organ** that runs G-Designer-style edge inference **online, continuously**,
   over the *live* connection graph — proposing each new organ↔organ / agent↔agent edge as a
   reversible `bodyChange`, sparsity-pruning dead edges, and **pruning edges that carry
   adversarial/prompt-injected traffic** (G-Designer's robustness mechanism) — all behind our
   meta-rail and fitness gate. The brain literally rewires itself as the estate changes, and
   every rewire is court-grade auditable.

2. **Stigmergic decay on the blackboard.** Add SBP-style **decaying pheromone signals** to
   blackboard regions: a KS that touches a region leaves a typed, time-decaying trace
   (urgency/confidence/contention). The control shell's `pickNext` reads the pheromone field as a
   coordination prior — emergent, coordinator-free swarm behavior over the existing CRDT slots,
   with **temporal decay** ([arXiv 2601.08129](https://arxiv.org/pdf/2601.08129)) preventing
   stale signals from misdirecting the swarm.

3. **AG-UI-on-CRDT.** Emit the standard AG-UI event vocabulary on our SSE contract, but back
   `STATE_DELTA` with **provably-convergent CRDT slot writes + version vectors** (CodeCRDT-grade
   guarantees) instead of AG-UI's unspecified "conflict resolution." Standard wire, stronger
   correctness, free handoff across chat→tab→mobile.

4. **MCP-stateless internal mesh.** Adopt the **2026-07-28 MCP stateless core + `server/discover`**
   shape for *internal* organ capability discovery, so the brain can enumerate what an organ can
   do **without a session handshake** — any internal tool call lands on any worker instance,
   matching our horizontal-scale invariant, and new organs self-describe via `server/discover`
   the moment they're constructed.

5. **OASF-described, self-registering organs.** When the CONSTRUCTION layer builds a new organ,
   it **auto-publishes an OASF/Agent-Card description** into an *internal* directory (never the
   external `.well-known`), so discovery is uniform whether the counterpart is a junior, an organ,
   or an external A2A agent — the **Internet-of-Agents shape, sealed inside the firewall**.

6. **DBOS-style Postgres saga journal as the durable spine.** Make every long-running loop
   (FABRIC closure, saga, EstateMind tick) a **deterministically-replayable workflow** journaled
   into a tenant-scoped, hash-chained Postgres table — **zero new infrastructure**, exactly-once
   effect, and the journal *is* the audit chain. No Temporal cluster to run; the RLS-Postgres
   invariant becomes the durability substrate.

7. **AP2 mandates as the value-edge envelope.** When the brain wires a payment edge to an
   external counterpart, wrap it in **AP2's three signed VCs (Intent/Cart/Payment mandates,
   W3C VCs → FIDO Alliance)** *on top of* `LedgerService.post()` — cryptographic, non-repudiable
   agentic-commerce proof the external world can verify, with our ledger as the internal truth and
   money-HITL as the irreversible barrier.

---

## 10. Our gaps vs this lane's SOTA (precise)

1. **Two coordination modalities exist but aren't unified into one runtime fabric.** The
   blackboard (`blackboard-sota`) and the message/event transports (A2A, outbox, stage-event-bus)
   are separate packages; there is **no single "wiring fabric" seam** that the junior swarm
   coordinates through. The blackboard is currently framed mostly as a **cross-surface UI state
   bus**, not the **primary internal-swarm coordination substrate** the 2026 research validates.

2. **The connection set is not yet first-class DATA.** Edges (organ↔organ, agent↔agent, KS↔region)
   are not modeled as versioned, RLS-governed, fitness-scored `connection` rows proposed through
   the body-change syscall. Without this, INV-C ("unbounded + dynamic, governed") is asserted but
   not *constructed* — the topology can't redraw itself through the meta-rail.

3. **No online topology-optimizer organ.** Nothing implements GPTSwarm/G-Designer-style learned,
   task-adaptive edge inference (or its adversarial edge-pruning). Connections are hand-wired in
   composition, not learned and self-pruned.

4. **AG-UI convergence not adopted.** Our SSE contract does not yet emit the standard AG-UI event
   vocabulary (`STATE_SNAPSHOT`/`STATE_DELTA`/`TOOL_CALL_*`/`INTERRUPT`); the gap register already
   flags the missing `tool_call`/`reasoning`/`state_delta` events — this is the concrete, low-risk
   convergence win, with our CRDT bus as the stronger backing.

5. **A2A is the external-federation edge only; no internal-A2A organ↔organ transport** and no
   capability-façade discipline proven to **seal internal wiring** from inbound A2A tasks (INV-H/D
   risk surface).

6. **MCP external client only; no stateless-core internal capability discovery** (`server/discover`)
   for self-describing, just-constructed organs.

7. **Durable-execution journaling is implied (per-`flow_id`) but not a DBOS-style replayable,
   hash-chained Postgres saga journal** with journaled-once activities — the exactly-once-effect
   proof for long-running loops is architectural intent, not a verified seam.

8. **Stigmergic / pheromone-decay coordination absent.** The control shell scores competence +
   recency but has no decaying-signal coordination field for emergent, coordinator-free swarm
   behavior.
