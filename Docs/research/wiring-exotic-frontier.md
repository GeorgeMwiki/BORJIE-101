# Wiring at the Exotic Beyond-Frontier — the "we-did-not-know-we-could-do-this" lane

**Date:** 2026-06-09
**Lane:** exotic-beyond-frontier
**Author:** research subagent (Mr. Mwikila brain layer)
**Status:** dossier only — no code, no commit. Mapping the most advanced
research-edge wiring paradigms onto Borjie's existing substrate.

> Owner directive: *"THINK ABOUT WIRING WAYS WE DON'T EVEN KNOW WE CAN DO
> — deep online research, expand to 1000000%, FULL SOTA."*

This dossier surveys eight research-edge coordination paradigms and, for
each, maps the **concrete Borjie wiring** onto substrate we already have,
plus a **beyond-today leap** and a **we-did-not-know-we-could-do-this**
item. The thesis running through all eight: Borjie has accidentally built
nearly every primitive these paradigms require — the blackboard-sota CRDT
meta-substrate (named-slot LWW + version-vector cross-surface state bus),
the CoALA central-intelligence kernel, the admin control plane
(core LLM + ordered fallbacks + ensemble {first-wins / vote / judge /
debate} + per-use-case routing), `@borjie/llm-budget-governor`, the
EstateMind Slow Loop (perceive → orient → motivate → propose, leader-
elected, propose-only), the Canonical Mining Graph
(`packages/graph-database` with concrete labels Licence→Permit→Mine→Pit→
Worker, supply-chain custody, buyer network), bi-temporal knowledge-graph
memory, durable execution (`packages/central-intelligence/src/durable/`
Inngest, currently dark), IP-egress + input-containment guards, and the
agent-platform (A2A auth, webhooks, idempotency). What is missing is not
infrastructure — it is the **wiring paradigm** that turns these inert
organs into a coherent organism. That is what this lane is for.

---

## The substrate we wire INTO (verified, not assumed)

| Organ | Path (verified present) | What it already is |
|---|---|---|
| CRDT meta-substrate / state-bus | `packages/blackboard-sota/src` (slots, regions, knowledge-sources, crossref, summary, control, handoff) | Erman/Hayes-Roth blackboard + named-slot LWW + version-vector cross-surface bus, per-region hash chain |
| Cognitive kernel | `packages/central-intelligence/src/kernel` (situational-model, orchestrator/tool-dispatcher, power-tools) | CoALA architecture, zero empty slots |
| Slow Loop | EstateMind organs (situational-model + motivation + `EstateMind.tick()`, migration 0317, leader-elected heartbeat) | resident perceive→orient→motivate→propose, propose-only |
| Model routing | `packages/brain-llm-router/src` (cost-cascade, provider-fallback, judge-loop, hedged-requests, dynamic-registry, effort, task-ladder) | core LLM + ordered fallbacks + ensemble + per-use-case routing |
| Budget | `packages/llm-budget-governor/src` (budget-store, tiers) | cost-weighted token budget + tiers |
| Canonical Mining Graph | `packages/graph-database/src/domain/mining-graph.ts`; `packages/knowledge-graph` (bi-temporal); `packages/graph-rag-router` | tenant-scoped Cypher over Licence/Permit/Mine/Pit/Worker/Cert/Regulator/MineralLot/Custodian/Export/Sale/Buyer/Mineral |
| Durable execution | `packages/central-intelligence/src/durable/` (inngest-executor, inngest-client, licence-suspension-flow) | step-durable, idempotent — currently unwired |
| Containment | IP-egress guard + input-containment guard (BP-1..BP-5, shipped) | scan-before-reingest, ingress prompt-injection guard, audit sink |
| Platform | `packages/agent-platform` | A2A auth, webhooks, idempotency keys |

Everything below treats these as the cell organelles and asks: *what
nervous system, what economy, what physiology wires them into one mind?*

---

## 1. Market-based / economic agent coordination

**State of the art (June 2026).** The "5th orchestration pattern" is
now explicitly market-based task allocation: a *stateless auction engine*
scores bids from agents that each carry only their own state; agents bid
with estimated cost + confidence, descended from the Consensus-Based
Auction / Bundling Algorithms (CBAA/CBBA) that have run multi-robot task
allocation for a decade. COALESCE formalises skill-based task outsourcing
*among* a team of autonomous LLM agents with explicit economic + security
dynamics. The deepest 2026 result reframes coordination itself as a
**market**: "Market Making as a Scalable Framework for Safe and Aligned
Multi-Agent LLM Systems" replaces the adversarial *debate* judge with an
incentive-aligned **market maker** that emits probabilistic claims and a
*trader* that maximally shifts them until convergence — yielding myopic
(non-scheming) incentives, verifiable per-step reasoning, and scalable
oversight with no human adjudicator, +up to 10% accuracy on mid-scale
models. `LLM Economist` goes further: democratic turnover lets the
*institutional rule set itself* co-evolve with the economy (mechanism
design as a moving target).

**Borjie wiring (concrete).** Borjie already has the two halves of a
market that have never been introduced to each other: `@borjie/llm-budget-
governor` (the *currency* — cost-weighted token budget + tiers) and the
12 junior agents + power-tools (the *bidders*). Wire an **internal compute
market** as a new blackboard region (`region_kind = 'auction'`): when
EstateMind's Slow Loop emits a *proposal* (e.g. "royalty filing due in 3
days for Mine X"), the orchestrator opens an auction slot instead of
hard-assigning a junior. Each junior posts a *bid* = `{ estimated_token_
cost, self-confidence, evidence_count, expected_free_energy }` into the
auction region; the stateless auction scorer (a pure function, lives in
`blackboard-sota/control`) clears the market against the *budget governor's
remaining tier balance*. The brain-llm-router's `cost-cascade` becomes the
market's price oracle; the `judge-loop` becomes the market maker's
convergence test. Crucially the auction is **propose-only-compatible** —
the cleared winner still passes through the policy-gate before acting, so
HIGH-risk prefixes (sovereign / kill_switch / four_eye / policy_rollout)
can never be "bought."

**Why it is a leap.** Today task→agent assignment is a hard-coded
dispatch in `tool-dispatcher.ts`. A market makes assignment *adaptive,
cost-aware, and self-throttling*: when the budget tier is nearly spent,
bids re-price upward and only the highest-value mining work clears —
Borjie degrades *gracefully and economically* under cost pressure instead
of either stopping or overspending. The market maker variant additionally
gives the Auditor Agent a **convergence certificate** (trader could not
shift the claim further) as a new evidence type — stronger than today's
single-pass confidence.

- **Beyond-today leap.** Run a *prediction market over the estate's own
  futures*: juniors stake budget tokens on outcomes ("ore grade at Pit 7
  will exceed 4 g/t", "buyer Z will accept the offtake at price P"). The
  market price *is* the calibrated forecast; settled outcomes feed the
  cognitive-reinforcement audit-chain, so well-calibrated juniors
  accumulate budget and bad forecasters lose bidding power. The estate
  grows a **self-pricing forecast organ** with zero new model training.
- **How it amplifies Borjie.** Cost becomes a *first-class coordination
  signal*, not an afterthought — directly serving the Tanzania-launch
  reality where compute and margins are tight. It turns the budget
  governor from a brake into a steering wheel.
- **We-did-not-know-we-could-do-this.** Let *tenants* (mining owners)
  bid real platform credits for priority on shared scarce resources
  (a single regulator-filing window, a constrained geo-inference job).
  Borjie becomes a two-sided market: an internal compute economy *and*
  an external estate-services economy on the same auction substrate.

---

## 2. Holonic / fractal organisation (the estate as a holarchy)

**State of the art.** A *holon* is a self-similar whole-and-part: it is
simultaneously an autonomous atomic entity and an organisation of holons,
depending on the level of observation. Holonic Multi-Agent Systems (HMAS)
and the PROSA reference architecture (Product–Resource–Order–Staff holons)
are the canonical engineering of self-similar, recursively composable
autonomy — long proven in intelligent manufacturing, traffic control, and
adaptive holonic agent architectures (ACM TAAS). The 2026 relevance:
agentic enterprises need a structure where every unit can be *both* a
single actor and a sub-organisation without rewriting the coordination
code.

**Borjie wiring (concrete).** Borjie's domain *is already a holarchy* —
it just is not wired as one. Estate ⊃ Subsidiary ⊃ Mine ⊃ Pit ⊃ Worker;
and on the brain side, Mr. Mwikila (MD) ⊃ 12 juniors ⊃ power-tools. Wire
**one recursive holon contract**: a holon exposes the *same* interface at
every level — `perceive()` (read its blackboard region), `propose()`
(emit to parent region), `decide()` (clear its own child auction),
`account()` (report budget + evidence up). Map PROSA directly: *Resource*
holon = Mine/Pit/Machinery node in the Canonical Mining Graph; *Order*
holon = a Slow-Loop proposal / work item; *Product* holon = MineralLot
moving through the custody chain; *Staff* holon = a junior advising the
others. The blackboard regions become the holarchy's nesting structure —
a region can contain sub-regions, and `EstateMind.tick()` runs the *same*
loop at every level (the Slow Loop is already the holon loop, it just
runs at the estate level today).

**Why it is a leap.** It dissolves the artificial split between "the
brain" and "the org." A subsidiary CFO-holon runs the identical
perceive→orient→motivate→propose loop as the estate MD-holon, with its
own budget sub-allocation and its own policy-gate scope. Borjie scales to
mining *groups* (multi-subsidiary family offices, the explicit product
vision) **without new architecture** — you instantiate another holon.

- **Beyond-today leap.** Make the holarchy *elastic*: holons split when
  a region's blackboard load exceeds a threshold (a busy Mine spawns a
  Pit-level sub-holon with its own EstateMind tick) and merge when idle.
  The org chart becomes a *living, load-balancing fractal* — the estate
  literally grows and prunes management layers in response to operational
  pressure.
- **How it amplifies Borjie.** Succession and subsidiary onboarding — two
  named product pillars — become *zero-code*: a new subsidiary is a new
  holon that inherits the contract, the policy-gate, and the budget tier.
- **We-did-not-know-we-could-do-this.** Run **counterfactual holons** —
  a shadow copy of a Mine-holon fed a hypothetical ("what if we halt Pit
  3?") that ticks its Slow Loop in a sandbox against the world-model
  (§4), producing a fully-reasoned subsidiary-level answer with its own
  evidence chain, never touching production state.

---

## 3. Active inference / free-energy-principle agents

**State of the art.** Friston's interpretation that LLMs are *approximate
inference engines* (next-token prediction as free-energy minimisation over
linguistic states) has matured into deployable coordination. The
**Orchestrator** framework (arXiv 2509.05651) selects which agent acts at
each timestep by minimising **Expected Free Energy (EFE)** = epistemic
value (information gain about task-relevant state) + pragmatic value
(expected reward) — *no task-specific training*, beating fixed orderings
and learned policies as complexity rises. "Active Inference for Self-
Organizing Multi-LLM Systems" frames adaptation thermodynamically;
language-mediated active inference is proposed as a path to *inherently
safer* AGI; Markov blankets give a principled boundary for composing
specialised agents into hierarchies.

**Borjie wiring (concrete).** The EstateMind Slow Loop is *already* an
active-inference loop wearing different names: perceive (sensory sampling)
→ orient (belief update) → motivate (preferences / prior preferences) →
propose (policy selection). Wire the missing quantity: have
`EstateMind.tick()` score each candidate proposal by **EFE** rather than
ad-hoc priority. Epistemic value = how much the action *reduces
uncertainty* in the situational-model's per-entity activation (the
persistent decaying activation organ already tracks this); pragmatic
value = alignment with the standing estate drives in the motivation
subsystem. The brain-llm-router's `effort` module becomes the precision/
temperature control (active inference's precision-weighting). Markov
blankets map cleanly onto the holon boundaries (§2) and the RLS tenant
boundary — each tenant is a Markov blanket, provably isolated.

**Why it is a leap.** Today the Slow Loop proposes by heuristic salience.
EFE gives a *single principled objective* that unifies "what should I
investigate?" (curiosity) and "what should I do?" (goal-seeking) in one
number — and it is *provably coherent* (the agent acts to minimise its own
surprise, so its perception and action can never silently diverge). It
gives the brain a built-in, mathematically-grounded reason to gather
evidence *before* acting — which is exactly the evidence-required-AI-output
hard rule, now derived rather than enforced.

- **Beyond-today leap.** A **free-energy budget**: couple EFE to the
  llm-budget-governor so the estate spends compute *only* where expected
  surprise reduction justifies the token cost. The estate becomes
  thermodynamically efficient — it stops paying to think about things it
  already understands and reallocates attention to genuinely uncertain
  mining situations.
- **How it amplifies Borjie.** Proactive intelligence (the product's
  killer feature) stops being a cron of canned checks and becomes an
  agent that *seeks out its own blind spots* — it surfaces the licence
  no one is watching precisely because that is where surprise is highest.
- **We-did-not-know-we-could-do-this.** Expose the estate's *total free
  energy* as a single owner-facing "estate stress" gauge. A rising number
  means reality is diverging from the brain's model (an emerging problem
  the brain itself does not yet understand) — an early-warning organ for
  unknown-unknowns, derived for free from the architecture.

---

## 4. World-models as the coordination substrate

**State of the art.** The structural thesis of 2026: *natural language
should be the interface to multi-agent coordination, not its substrate.*
A **Shared World Model** maintains a typed representation of entities,
relations, attributes and constraints that all agents observe and modify
through controlled interfaces — because NL summaries compress information,
lose types, and make consistency unverifiable. "Communicating Plans, Not
Percepts" (arXiv 2508.02912) is the sharpest demonstration: each agent
runs a tiny *Imagined Trajectory Generation Module* (rolls its own policy
3 steps forward) and broadcasts an 8-component compressed *plan*, not raw
state — lifting partially-observable grid success from 30.8% → 99.9%
(10×10) and 12.2% → 96.5% (15×15) over learned direct communication.
Foundation world models, Gamma-World's hub-attention, and dialogue-aligned
world models round out the field.

**Borjie wiring (concrete).** Borjie has the *typed* world model already:
the **Canonical Mining Graph** (`graph-database/domain/mining-graph.ts`)
*is* the shared-world-model's entity-relation-constraint layer, and the
**bi-temporal knowledge graph** (`packages/knowledge-graph/src/temporal`)
gives it "what was true when." Wire the juniors to **read/write the graph
instead of passing NL messages**: a junior's output is not a paragraph
handed to the next junior — it is a *typed write* to a graph node/edge
(with the bi-temporal stamp + evidence_id), and the next junior *reads the
graph*. The blackboard-sota CRDT slots become the *plan layer* on top of
the world-model: juniors broadcast compressed *intended graph mutations*
(the "plan, not percept") into named slots before committing, so other
agents see where the world is heading. The graph-rag-router already exists
to query this substrate.

**Why it is a leap.** It removes the single biggest reliability hole in
multi-agent LLM systems — lossy NL hand-offs — from Borjie's brain.
Consistency becomes *verifiable* (the graph has typed constraints; an
illegal write is rejected at the substrate, not hoped-against in a prompt).
And it makes the estate's reasoning **simulatable**: because the world-
model is typed and causal-capable, the brain can roll it forward.

- **Beyond-today leap.** Stand up a **mining digital-twin world-model**
  the brain can *imagine* against: roll the graph forward 3 steps under a
  candidate decision ("suspend Pit 3 → workforce reallocation →
  production delta → cashflow delta → covenant breach?") and broadcast the
  *imagined trajectory* as the proposal. Owner decisions arrive with their
  consequences already simulated.
- **How it amplifies Borjie.** Cross-surface coherence (owner-web,
  workforce-mobile, buyer-mobile) becomes automatic: every surface reads
  the same typed world-model through the same CRDT slots — the EN/SW
  toggle, the currency render, the entity state are *one* source of truth.
- **We-did-not-know-we-could-do-this.** Let the world-model **dream
  offline** during the Slow Loop's idle ticks — sample plausible futures
  (commodity-price moves, regulator actions, equipment failures), pre-
  compute the estate's best responses, and stash them as warm cached
  proposals. When the real event lands, the owner already has a
  reasoned answer in milliseconds (sleep-consolidation, but for strategy).

---

## 5. Swarm intelligence / stigmergy at scale

**State of the art.** *Stigmergy* = coordination through the environment,
not through messages. In digital systems agents leave **digital
pheromones** — records in shared memory / a task queue / a vector store
with `{ value, time, location }` — and other agents are *attracted*
without any direct message. 2026 framing: an agent dropping a "high-
priority bug here" pheromone pulls debugging agents to that file with zero
addressing; swarms coordinate with no persistent connections and no
synchronised clocks, enabling fully *asynchronous* planning. X-SYCON and
xylem-inspired passive-gradient control show communication-*free* swarm
response in dynamic environments.

**Borjie wiring (concrete).** Borjie's blackboard-sota CRDT slots are a
*textbook stigmergic medium* — named slots with LWW + version-vector are
exactly `{ value, time, actor }` pheromones, and the per-region hash chain
gives tamper-evident trails. Wire **pheromone-typed slots**: when a junior
or sensor notices something (an expiring certification, an anomalous
royalty figure, an ore-grade outlier) it *deposits a pheromone* into the
relevant Canonical-Mining-Graph-keyed slot with a decay rate (reuse the
situational-model's existing *decaying activation* mechanic — it is
already a pheromone-evaporation function). Idle juniors *sense gradients*:
the orchestrator routes the next free junior to the strongest, freshest
pheromone region. No central dispatch, no message addressing — pure
environmental coordination layered *under* the explicit market (§1) for
the cheap, high-volume, ambient work.

**Why it is a leap.** It gives Borjie a **second coordination tier** that
costs almost nothing: the expensive market (§1) clears the big strategic
work, while stigmergy handles the long tail of ambient maintenance
(certs, small compliance nudges, data-freshness) with zero orchestration
overhead. It is naturally *robust* — remove any agent and the pheromones
persist for whoever is next; it scales to thousands of estate entities
without an O(n²) message explosion.

- **Beyond-today leap.** **Pheromone reinforcement learning**: paths that
  led to good outcomes (verified by the audit-chain) lay down stronger,
  slower-decaying trails, so the estate *learns its own operational
  playbooks as physical gradients in the blackboard* — the well-trodden
  "royalty filing" path becomes a bright pheromone highway any junior
  can follow, with no fine-tuning.
- **How it amplifies Borjie.** The estate self-organises its routine
  operations and frees the expensive brain for genuinely novel decisions
  — exactly the human-MD division of labour the product promises.
- **We-did-not-know-we-could-do-this.** Render the pheromone field as a
  live **heat-map of the estate's attention** on owner-web — the owner
  literally *sees where the brain is paying attention* and why, a brand-
  new transparency surface that falls out of the coordination mechanism
  itself.

---

## 6. Neuro-symbolic wiring (symbolic policy-gate + neural router)

**State of the art.** The 2026 enterprise consensus: regulated-industry
agents need *symbolic constraints over neural reasoning*. "Bridging
Symbolic Control and Neural Reasoning" (arXiv 2511.17673) — the
**Structured Cognitive Loop (R-CCAM:** Retrieve-Cognition-Control-Action-
Memory) with a **governance layer** doing "Soft Symbolic Control":
symbolic constraints applied to probabilistic inference while preserving
neural flexibility — reporting *zero policy violations*, *no redundant
tool calls*, and *complete decision traceability*. Ontology-constrained
neural reasoning grounds LLM output in formal domain knowledge; G-SPEC
uses graph-grounding + a SHACL policy engine to enforce topological /
resource / temporal / blast-radius constraints; NeuSymMS pairs neural fact
extraction with a CLIPS expert system.

**Borjie wiring (concrete).** Borjie is *already neuro-symbolic and
doesn't say so out loud*. The symbolic half exists:
`policy-gate.ts` + `inviolable.ts` (HIGH-risk literal policy rules, no
reason-resolver generalisation), RLS as a symbolic data-isolation
constraint, the typed Canonical Mining Graph as a SHACL-style schema, the
double-entry ledger invariant. The neural half is the brain-llm-router +
juniors. Wire them into the **R-CCAM loop explicitly**: Retrieve (graph-
rag-router + corpus) → Cognition (neural router picks model + drafts) →
**Control = policy-gate as the governance checkpoint** (every neural
proposal is *grounded* against the graph — "does this MineralLot actually
exist? is this licence actually active?" — and gated against inviolable
rules) → Action (tool-dispatcher) → Memory (bi-temporal graph + cognitive-
reinforcement audit-chain). The neural router *proposes*, the symbolic
gate *disposes* — and the audit-chain records both halves as the
traceability artefact.

**Why it is a leap.** It converts Borjie's hard rules from a *wall the
LLM occasionally bumps into* (post-hoc rejection) into a *constraint the
reasoning is grounded against by construction*. Graph-grounding kills a
whole class of hallucination ("file royalty for Mine X" where Mine X is
not in the graph is impossible to even propose). It delivers the regulated-
industry guarantee mining demands: zero policy violations with a complete
decision trace per the Auditor Agent.

- **Beyond-today leap.** Compile the *mining regulations themselves* (TZ
  Mining Act, royalty schedules, ESG disclosure rules) into the symbolic
  layer as SHACL-style graph constraints, so the neural juniors reason
  *inside the law* rather than *being checked against it after the fact* —
  illegal advice is unrepresentable, not merely flagged.
- **How it amplifies Borjie.** The evidence-required hard rule, the
  policy-gate, and RLS stop being three separate guards and become one
  unified governance layer with a single trace — simpler, stronger,
  auditable end-to-end.
- **We-did-not-know-we-could-do-this.** Run the **symbolic layer as a
  live type-checker for the neural layer's plans** *before* execution:
  the governance checkpoint statically rejects an entire multi-step plan
  (not just one tool call) if any step violates a graph constraint —
  blast-radius control for reasoning, the way a compiler rejects a
  program before it runs.

---

## 7. Graph / knowledge-graph as the live wiring fabric (the nervous system)

**State of the art.** Graph memory crossed from experimental to
**production in early 2026** — 13 agent frameworks now ship graph-memory
integrations. Zep/Graphiti are real-time *temporally-aware* knowledge-graph
engines that incrementally update entities/relations/communities without
batch recompute, tracking *what was true when and who recorded it* with
sub-50ms lookups. Surveys (MAGMA multi-graph agentic memory; "Graph-based
Agent Memory: Taxonomy") formalise knowledge-graphs, temporal graphs,
hypergraphs, and hierarchical graphs as the substrate for agent reasoning
across hierarchical planning.

**Borjie wiring (concrete).** Borjie has *all three* graph layers built
but not wired as one nervous system: the **Canonical Mining Graph**
(`graph-database`, the anatomy), the **bi-temporal knowledge graph**
(`knowledge-graph/temporal`, the memory of change), and the **graph-rag-
router** (retrieval). Wire them as the brain's **single nervous system**:
every organ writes its state *as graph edges* — a junior's recommendation
is an edge `(Junior)-[:ADVISED {evidence_id, ts}]->(Decision)`; a Slow-Loop
proposal is `(EstateMind)-[:PROPOSED]->(WorkItem)`; a ledger post is
`(Account)-[:DEBITED]->(Txn)`; a blackboard slot write is mirrored as a
graph fact. Reasoning, memory, audit-chain, and situational-model all
become *queries over one graph* rather than messages between modules. The
bi-temporal layer means the brain can ask "what did we believe about Mine
X last quarter, and why did we change our mind?" — and the answer is a
provable path.

**Why it is a leap.** It collapses Borjie's coordination, memory, and
audit into *one fabric*. Right now those are separate systems that must be
kept consistent by hand; making the graph the wiring fabric means
consistency is structural. It also makes the *entire estate explainable
by graph traversal* — every decision has a literal causal path back to its
evidence, which is the Auditor Agent's dream.

- **Beyond-today leap.** Run **community detection / GraphRAG over the
  live estate graph** to surface emergent structure no human encoded —
  hidden buyer-cartel clusters, correlated equipment-failure communities,
  workforce-certification risk pockets — and feed those communities back
  as new Slow-Loop drives. The estate *discovers its own latent risks*.
- **How it amplifies Borjie.** The owner's "ask anything" chat becomes a
  graph walk with citations: every answer is a *path*, and the EN/SW
  toggle, currency, and tenant scope are properties on the path — coherent
  by construction across all four surfaces.
- **We-did-not-know-we-could-do-this.** Treat the graph as a **signal-
  propagation medium** (graph as nervous system, literally): an anomaly
  detected at a Pit node propagates an *activation wave* along the edges
  (Pit→Mine→Licence→Regulator), pre-warming exactly the juniors on the
  blast path before the owner even asks — graph-native proactive alerting.

---

## 8. Biological metaphors actually implemented (homeostasis, hormones / global broadcast, immune system, causal routing)

**State of the art.** Three biological architectures are now concretely
implementable. (a) **Global Workspace Theory** has its first explicit LLM
implementations — "Theater of Mind" (arXiv 2604.08206) and Global
Workspace Agents partition agents into perception/memory/planning/norms/
goals modules that compute *salience scores*, compete through an
**attentional bottleneck**, and *broadcast* the winner globally; GWT
moves multi-agent coordination "from a passive data structure to an
active, event-driven discrete dynamical system." (b) **Artificial Immune
Systems** give distributed self/non-self anomaly detection with self-
learning, self-regulation, and co-evolving detector populations (second-
generation AIS emphasise *inter-cell communication*). (c) **Causal world-
model routing**: an LLM proposes actions in NL, a learned Causal World
Model simulates the latent-causal outcome and returns the next state
("Language Agents Meet Causality"), and **Causal LLM Routing** (arXiv
2505.16037) does end-to-end *regret minimisation from observational data*,
correcting treatment-selection bias in routing decisions.

**Borjie wiring (concrete).**
- **Global workspace / hormonal broadcast.** The blackboard-sota CRDT
  *is* the global workspace; the brain-llm-router's effort/precision is
  the attentional bottleneck. Wire a **global-broadcast hormone bus**: a
  small set of estate-wide scalar "hormones" (a `risk` level, a `cost-
  pressure` level, a `regulator-deadline-proximity` level, an `owner-
  urgency` level) live in reserved CRDT slots and are *broadcast to every
  organ at once*. They are not messages — they are ambient modulators:
  high `cost-pressure` raises every market bid price (§1) and lowers EFE
  precision (§3); high `risk` tightens the policy-gate and shortens
  pheromone decay (§5). One number changes the whole organism's behaviour.
- **Immune system.** The shipped containment guards (BP-1..BP-5: scan-
  before-reingest, ingress prompt-injection guard, audit sink) plus the
  IP-egress guard are *already innate immunity*. Wire **adaptive
  immunity**: a co-evolving population of lightweight *detector* checks
  that learn the estate's normal patterns (normal royalty ranges, normal
  custody-chain shapes, normal login geographies) and flag *non-self*
  anomalies as immune pheromones (§5) — self-tolerant (won't fire on
  known-good), self-learning, distributed across the graph nodes.
- **Causal routing.** The brain-llm-router gains a **causal layer**:
  route model/junior selection by *regret minimisation from the audit-
  chain's observational history* (which routing decisions actually led to
  good outcomes, de-biased for the fact that we only see chosen paths) —
  and let candidate decisions be simulated through the §4 causal world-
  model before commit.

**Why it is a leap.** These three give Borjie *physiology* — not just a
control flow but a homeostatic, self-defending, causally-reasoning
organism. The hormone bus is the cheapest, highest-leverage wiring in this
entire dossier: one broadcast scalar coherently re-tunes market, active-
inference, stigmergy, and policy *simultaneously*, which is exactly how a
real organism shifts from rest to fight-or-flight.

- **Beyond-today leap.** Full **homeostatic set-points**: the estate
  defends target ranges (cash buffer, compliance-coverage %, workforce-
  certification %, ESG score) the way a body defends temperature — any
  excursion *automatically* raises the matching hormone, which mobilises
  the market + swarm to restore the set-point, no human trigger. The
  estate becomes *self-regulating*.
- **How it amplifies Borjie.** It unifies every safety system (kill-
  switch, policy-gate, containment guards, RLS) under one immune metaphor
  with one observable health signal — and gives the owner a single
  "estate vital signs" panel (temperature = stress/free-energy §3, immune
  alerts = anomalies, hormone levels = current operating mode).
- **We-did-not-know-we-could-do-this.** A **causal counterfactual audit
  organ**: for any executed decision, the brain re-runs it through the
  causal world-model with one variable changed ("had we *not* suspended
  Pit 3…") and reports the counterfactual delta — Borjie can prove *why
  its decision was the right one*, not just that it followed the rules.
  Regret-minimised routing + counterfactual audit = an estate brain that
  measurably learns from its own history and can defend every move.

---

## Cross-cutting synthesis — the one organism

These eight are not eight features; they are **layers of one nervous
system**, and Borjie already owns the organs:

1. **Graph (§7)** is the body / nervous system — one typed, bi-temporal
   fabric every organ reads and writes.
2. **World-model (§4)** is imagination — the graph rolled forward.
3. **Active inference (§3)** is the single objective — minimise surprise
   over that world-model.
4. **Neuro-symbolic governance (§6)** is the conscience — the policy-gate
   grounds every neural plan against the graph before it acts.
5. **Market (§1)** clears the big, expensive, strategic work economically.
6. **Stigmergy (§5)** handles the cheap, ambient, high-volume long tail.
7. **Holarchy (§2)** is the recursive body plan — the same loop at every
   scale, so it grows to mining groups for free.
8. **Biological physiology (§8)** — the hormone bus, immune system, and
   causal routing — is the homeostatic glue that re-tunes all of the
   above with single broadcast scalars and defends the whole.

The lowest-cost, highest-leverage first wires (cheapest to prove, biggest
behavioural change): **the hormone/global-broadcast bus (§8)** on reserved
CRDT slots, **EFE scoring in the existing Slow Loop (§3)**, and
**juniors-read/write-the-graph-not-NL (§4/§7)**. Each reuses an organ that
already exists and ships dark — the wiring, not the building, is what's
left.

---

## Sources (real, June-2026-current)

**Market-based / economic coordination**
- The 5th Agent Orchestration Pattern: Market-Based Task Allocation — https://dev.to/slythefox/the-5th-agent-orchestration-pattern-market-based-task-allocation-db0
- From Competition to Coordination: Market Making as a Scalable Framework for Safe and Aligned Multi-Agent LLM Systems (arXiv 2511.17621) — https://arxiv.org/html/2511.17621v1
- COALESCE: Economic and Security Dynamics of Skill-Based Task Outsourcing Among Team of Autonomous LLM Agents (arXiv 2506.01900) — https://arxiv.org/pdf/2506.01900
- LLM Economist: Large Population Models and Mechanism Design in Multi-Agent Generative Simulacra (arXiv 2507.15815) — https://arxiv.org/html/2507.15815v1
- The Market Shift: Why Multi-agent LLM Coordination Matters in 2026 — https://sesamedisk.com/multi-agent-llm-coordination-2026/

**Holonic / fractal organisation**
- Holonic Multiagent Systems: A Foundation for the Organisation of Multiagent Systems — https://www.academia.edu/52978953/Holonic_Multiagent_Systems_A_Foundation_for_the_Organisation_of_Multiagent_Systems
- Reference architecture for holonic manufacturing systems: PROSA — https://www.academia.edu/8247456/Reference_architecture_for_holonic_manufacturing_systems_PROSA
- An adaptative agent architecture for holonic multi-agent systems (ACM TAAS) — https://dl.acm.org/doi/10.1145/1342171.1342173
- Holonic Organization (Umbrex framework) — https://umbrex.com/resources/frameworks/organization-frameworks/holonic-organization/

**Active inference / free-energy principle**
- Orchestrator: Active Inference for Multi-Agent Systems in Long-Horizon Tasks (arXiv 2509.05651) — https://arxiv.org/pdf/2509.05651
- Active Inference for Self-Organizing Multi-LLM Systems: A Bayesian Thermodynamic Approach to Adaptation (arXiv 2412.10425) — https://arxiv.org/html/2412.10425v1
- A Framework for Inherently Safer AGI through Language-Mediated Active Inference (arXiv 2508.05766) — https://arxiv.org/html/2508.05766v1
- Active Inference and the Free Energy Principle (Engineering Notes, Feb 2026) — https://notes.muthu.co/2026/02/active-inference-and-the-free-energy-principle-how-agents-minimize-surprise-instead-of-maximizing-reward/

**World-models as coordination substrate**
- Communicating Plans, Not Percepts: Scalable Multi-Agent Coordination with Embodied World Models (arXiv 2508.02912) — https://arxiv.org/html/2508.02912v4
- Embodied Multi-Agent Coordination by Aligning World Models Through Dialogue (arXiv 2605.12920) — https://arxiv.org/abs/2605.12920
- Foundation World Models for Agents that Learn, Verify, and Adapt Reliably (arXiv 2602.23997) — https://arxiv.org/html/2602.23997
- Gamma-World: Simplex Agent Encoding and Hub Attention for Multi-Agent World Models (Jun 2026) — https://artgor.medium.com/gamma-world-simplex-agent-encoding-and-hub-attention-for-multi-agent-world-models-6085661c24e4

**Swarm / stigmergy**
- Agent Swarms Explained: The Future of Autonomous AI Collaboration (Apr 2026) — https://aitoolsreview.co.uk/insights/agent-swarms-explained
- Multi-agent systems powered by large language models: applications in swarm intelligence (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC12135685/
- X-SYCON: Xylem-Inspired Passive Gradient Control for Communication-Free Swarm Response (arXiv 2512.00018) — https://arxiv.org/pdf/2512.00018
- Stigmergic Independent Reinforcement Learning for Multi-Agent Collaboration (arXiv 1911.12504) — https://arxiv.org/pdf/1911.12504

**Neuro-symbolic**
- Bridging Symbolic Control and Neural Reasoning in LLM Agents: Structured Cognitive Loop with a Governance Layer (arXiv 2511.17673) — https://arxiv.org/abs/2511.17673
- Ontology-Constrained Neural Reasoning in Enterprise Agentic Systems (arXiv 2604.00555) — https://arxiv.org/html/2604.00555
- NeuSymMS: A Hybrid Neuro-Symbolic Memory System for LLM Agents (arXiv 2605.17596) — https://arxiv.org/html/2605.17596v2
- Beyond Prompt Engineering: Neuro-Symbolic-Causal Architecture for Robust Multi-Objective AI Agents (arXiv 2510.23682) — https://arxiv.org/pdf/2510.23682

**Graph / knowledge-graph as fabric**
- Zep: A Temporal Knowledge Graph Architecture for Agent Memory (arXiv 2501.13956) — https://arxiv.org/html/2501.13956v1
- Graphiti: Knowledge graph memory for an agentic world (Neo4j) — https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/
- MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents (arXiv 2601.03236) — https://arxiv.org/html/2601.03236v2
- Graph-based Agent Memory: Taxonomy, Techniques, and Applications (arXiv 2602.05665) — https://arxiv.org/html/2602.05665v1
- Temporal Graph RAG: Why Time-Aware Knowledge Graphs Are Reshaping AI Memory (Feb 2026) — https://medium.com/@nitishkumarnitc/temporal-graph-rag-why-time-aware-knowledge-graphs-are-reshaping-ai-memory-04fc62dd0acd

**Biological metaphors (GWT, immune, causal)**
- Theater of Mind for LLMs: A Cognitive Architecture Based on Global Workspace Theory (arXiv 2604.08206) — https://arxiv.org/html/2604.08206v1
- A Case for AI Consciousness: Language Agents and Global Workspace Theory (arXiv 2410.11407) — https://arxiv.org/pdf/2410.11407
- Advancing Artificial Immune System-Based Anomaly Detection (Springer, 2026) — https://link.springer.com/chapter/10.1007/978-3-032-14757-8_26
- Language Agents Meet Causality — Bridging LLMs and Causal World Models (OpenReview) — https://openreview.net/forum?id=y9A2TpaGsE
- Causal LLM Routing: End-to-End Regret Minimization from Observational Data (arXiv 2505.16037) — https://arxiv.org/pdf/2505.16037

**Generative-agent societies / emergent institutions**
- AgentSociety: Large-Scale Simulation of LLM-Driven Generative Agents (arXiv 2502.08691) — https://arxiv.org/abs/2502.08691
- Static Sandboxes Are Inadequate: Open-Ended Co-Evolution in LLM Multi-Agent Simulations (arXiv 2510.13982) — https://arxiv.org/pdf/2510.13982
- Emergence of Social Norms in Generative Agent Societies (arXiv 2403.08251) — https://arxiv.org/pdf/2403.08251
