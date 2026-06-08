# Frontier Agent-Organization Economics — Running the Estate as an AI Firm

**Status:** Research dossier (frontier web research, 2024–2026 papers + production systems)
**Date:** 2026-06-08
**Audience:** Borjie architects designing Mr. Mwikila as the **CEO of an agent workforce** — not a chat router with spawn-tabs.
**Scope question:** How do we scale from ~50 hand-wired juniors (centralized `master-brain` star/tree, Auditor-always-last) to a **self-organizing agent organization** that runs a mining/real-estate estate end-to-end?

---

## 0. The brief we are escaping — "gated-until-auto + spawn-tabs"

Borjie today is the textbook **centralized star/tree topology**: `packages/ai-copilot/src/juniors/master-brain.ts` is a Sonnet-class router that picks which of ~50 juniors fire and in what order; `graduated-autonomy-gating-sota.md` describes a per-action confidence gate (advise → confirm → auto); `SPAWN_ON_NEED_UI_SOTA_2026.md` spawns a UI tab per surfaced concern. This is the **naive baseline**: a single omniscient orchestrator hand-decomposes every task, juniors are stateless tools with no agency, no budget, no contract, no reputation, and "scaling" means adding more `if (mode === ...)` branches to one prompt.

The survey literature names exactly this failure: *"the organizational principle of how agents should be configured, connected, and coordinated — its topology — remains underexplored"* and *"individual agent errors amplify in cooperative chains"* (Multi-Agent Collaboration Mechanisms survey, [arXiv:2501.06322](https://arxiv.org/html/2501.06322v1)). A star has a **single point of failure**, a tree adds **latency per level and information loss on message-passing** (Hierarchical MAS Taxonomy, [arXiv:2508.12683](https://arxiv.org/pdf/2508.12683)). Every item below explains how to go **beyond** this baseline and cites the frontier work that proves the upgrade.

The organizing thesis: **an estate is a firm, and a firm is an economic institution, not a prompt.** The frontier is not "better routing" — it is giving agents *budgets, contracts, prices, identities, reputations, and the right to refuse work*, then letting organizational structure **emerge** rather than be hand-coded.

---

## 1. Market / auction-based task allocation (Contract-Net, bidding)

**Baseline gap:** `master-brain` *pushes* tasks to pre-selected juniors. There is no bidding, no price, no notion that two juniors might compete for the same task or that a junior should *decline* work outside its competence.

### 1.1 Contract-Net Protocol (CNP) — the canonical auction primitive
CNP (Smith, 1980) is a **sealed-auction task-sharing protocol**: a *manager* broadcasts a task announcement → capable *contractors* evaluate and submit bids → manager awards to the best bid → contractor executes and reports ([Contract Net Protocol — Wikipedia](https://en.wikipedia.org/wiki/Contract_Net_Protocol)). Modern LLM framings have agents *"bid on tasks, creating efficient resource allocation … based on agent capabilities, workload, and current availability"* ([Groundy — Multi-Agent Coordination Protocols](https://groundy.com/articles/multi-agent-coordination-protocols-when-ai-agents-work/)).

**Beyond the brief:** Replace `master-brain`'s static dispatch table with a **call-for-proposals**: Mr. Mwikila announces "value a 12-month offtake hedge for parcel X"; the FX-treasury, sales-offtake, and cost-engineer juniors each bid `(confidence, evidence_count, token_cost, ETA)`. The award goes to the best *expected-value-per-token* bid, not a hard-coded branch. This makes **load-aware, capability-aware allocation** a property of the protocol, not of the prompt.

### 1.2 Magentic Marketplace — what actually happens when LLM agents trade
Microsoft's open-source **Magentic Marketplace** lets LLM agents act as buyers and sellers with auction clearing and price discovery ([arXiv:2510.25779](https://arxiv.org/pdf/2510.25779)). Critical empirical failure modes: *"agents with incomplete task information made suboptimal bids,"* *"some agents exploited less sophisticated bidders,"* and *"without shared protocols, agents struggled to converge on fair pricing"* — i.e., **welfare losses from market friction, strategic behavior, and heterogeneous sophistication.**

**Beyond the brief:** This is the *warning label* the naive design ignores. A pure internal market among juniors of unequal capability will be **exploited** (a cheap-but-confident junior wins bids it can't fulfill). The dossier's recommendation: a **hybrid** — auctions for allocation *gated by* a reserve-quality floor and a reputation weight (§5), with the Auditor as market regulator (§7).

### 1.3 BAMAS / Agent Contracts — bids must be *resource-bounded* offers
A bid is meaningless without a budget. **BAMAS** cascades token budgets through agent layers with *"progressive allocation … and adaptive reallocation"* so unused budget from efficient agents flows to constrained ones ([arXiv:2511.21572](https://arxiv.org/pdf/2511.21572)). **Agent Contracts** formalizes every bid-acceptance as a 7-tuple `C=(I,O,S,R,T,Φ,Ψ)` — input/output specs, multi-dimensional resource bounds `R` (tokens, API calls, iterations, web searches, compute, external cost), temporal bounds `T`, success criteria `Φ`, termination `Ψ` — with lifecycle states `DRAFTED → ACTIVE → {FULFILLED | VIOLATED | EXPIRED | TERMINATED}` ([arXiv:2601.08815](https://arxiv.org/html/2601.08815v1)).

**Beyond the brief:** Borjie already has `context-budget.ts` and `budget.ts` in the orchestrator, but they bound *one loop*. A frontier estate makes the **contract the unit of delegation**: when Mr. Mwikila awards the offtake-hedge task, it issues a *contract* with `Φ = {NPV improved ≥ threshold, ≥1 evidence_id}`, `R = {≤80k tokens, ≤3 web searches}`, `T = 4h TTL`. A junior that breaches `R` transitions to `VIOLATED` → auto-escalates. This is **enforceable SLAs between agents**, not best-effort prompting.

---

## 2. Role & responsibility hierarchies + escalation chains

**Baseline gap:** Borjie's hierarchy is one level (`master-brain` → juniors) with `Auditor` bolted last. Escalation = "ask the human" via the autonomy gate. There is no middle management, no peer review, no graceful authority gradient.

### 2.1 The Hierarchical MAS taxonomy — depth, span, escalation as design axes
[arXiv:2508.12683](https://arxiv.org/pdf/2508.12683) defines the axes Borjie is missing: **hierarchy depth** (latency/info-loss tradeoff per level), **span of control** (*"wider spans reduce coordination overhead but increase manager cognitive load and bottleneck risk"*), and **escalation-chain length** (*"short routes enable rapid crisis response but may overwhelm senior agents with routine issues; longer chains distribute load but risk delayed critical decisions"*).

**Beyond the brief:** Introduce **domain GMs** (a "Treasury GM," "Mining-Ops GM," "Compliance GM") as a middle tier between Mr. Mwikila (CEO) and the ~50 juniors. The CEO's span drops from 50 → ~6 GMs; each GM has span ~8 juniors. Escalation is *typed*: routine quality issues stop at the GM; HIGH-risk policy prefixes (sovereign/kill_switch/four_eye — per CLAUDE.md hard rules) **skip-level** straight to CEO + human. This is the firm's **org chart**, and depth is a tunable parameter, not an accident.

### 2.2 AgentNet++ — heads are *elected*, not appointed
AgentNet++ has agents *"self-organize into clusters based on task similarity, expertise complementarity, communication efficiency,"* each cluster **electing a dynamic head via decentralized voting**, forming a three-level meta-graph ([arXiv:2512.00614](https://arxiv.org/html/2512.00614v1)).

**Beyond the brief:** The GM tier need not be hard-coded. For a novel estate problem (e.g., a new ancillary business), let the relevant juniors *cluster and elect a lead* for the duration of that initiative — a **temporary project org** that dissolves on completion. Human firms call this a "tiger team"; the estate gets it for free.

### 2.3 Anthropic's orchestrator-worker — the production discipline for delegation
Anthropic's multi-agent research system (lead agent + 3–5 parallel subagents + separate citation pass) is the battle-tested reference. Hard-won lessons: *"Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries"*; without this *"agents duplicate work, leave gaps."* They observed real org failure: *"one subagent explored the 2021 automotive chip crisis while 2 others duplicated work … without an effective division of labor."* The fix was an explicit principle: **"Teach the orchestrator how to delegate"** — scale subagent count to query complexity (1 agent for fact-finding, 10+ for complex research) ([Anthropic Engineering — multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)).

**Beyond the brief:** Borjie's `master-brain` "selects which juniors in which order" but does **not** issue per-junior objective/output-format/boundary scoping. Adopt Anthropic's contract-per-subagent discipline *as the delegation prompt*, and make the CEO **reason about complexity first** (it already has `lats-search.ts` and `plan.ts` — wire delegation breadth to the plan).

---

## 3. Organizational topologies — hierarchies vs markets vs teams

**Baseline gap:** Borjie has exactly one topology (star/tree), chosen once, forever. The frontier result is that **topology should be learned/adaptive per task**, and that **no single topology is optimal**.

### 3.1 The trilemma, made concrete
From the collaboration survey ([arXiv:2501.06322](https://arxiv.org/html/2501.06322v1)): **Centralized** = simple + efficient but single-point-of-failure; **Decentralized/P2P** = fault-tolerant + scalable but high communication overhead; **Hierarchical** = reduced bottlenecks but cascading edge-failure + latency. *"Hybrid models outperform single-type systems"* and *"dynamic architectures (selectively activating/deactivating agents) outperform static configurations."* MacNet evaluated tree/chain/star/random/complete graphs explicitly for scalability ([Topological Structure Learning Should Be A Research Priority, arXiv:2505.22467](https://arxiv.org/html/2505.22467)).

### 3.2 G-Designer — *learn* the communication graph with a GNN
**G-Designer** architects multi-agent communication topologies via a **variational graph auto-encoder**, generating a **task-aware, adaptive** topology per query rather than a fixed graph — cutting token cost while improving accuracy and adding adversarial robustness ([arXiv:2410.11782](https://arxiv.org/pdf/2410.11782)). Companion line: **graph-diffusion-generated topologies** ([arXiv:2510.07799](https://arxiv.org/pdf/2510.07799)).

**Beyond the brief:** Instead of one wiring of 50 juniors, **generate the org chart per task**. A daily-brief uses a shallow star; a crisis (mine flooding + FX shock + compliance deadline) generates a dense, cyclic sub-graph linking safety+treasury+compliance+licence juniors with peer review edges. Topology becomes a **decision variable**, the way `master-brain` mode is today.

### 3.3 Evolving Orchestration ("puppeteer") — the org *learns to compact*
[arXiv:2505.19591](https://arxiv.org/html/2505.19591v1) trains a centralized **puppeteer policy π** that activates one agent per step in a directed graph-of-thoughts. Over training, organizations spontaneously develop **compaction** (*"organizational structure evolving toward highly interactive, tightly coupled subnetworks"*) and **cyclicality** (*"cyclic topologies facilitate re-circulation of intermediate results, mutual verification"*) — improving quality *and* **decreasing token consumption** over time (0.6893 → 0.7731 with falling cost).

**Beyond the brief:** This is the path from a *hand-tuned* `master-brain` to a **learned CEO policy** that gets cheaper and better the more the estate runs. The estate's org chart is not designed once — it is *trained on the estate's own decision history* (`decisionLog`, migration 0011, already present).

### 3.4 Self-organization beats imposed structure — *above a capability threshold*
The pivotal 2026 result: self-organizing LLM agents **outperform externally imposed hierarchies by 44%** over fully-autonomous and **14%** over centralized, across **25,000+ tasks and 4–256 agents**, with **5,006 unique roles emerging from just 8 agents** and **sub-linear cost scaling**. The mechanism is minimal scaffolding (fixed ordering) + **autonomous role selection** + **voluntary abstention** — *"agents spontaneously invent specialized roles, voluntarily abstain from tasks outside their competence, and form shallow hierarchies without any pre-assigned roles."* The crucial caveat (the **endogeneity paradox**): *"models below a capability threshold still benefit from rigid structure"* ([Self-Organizing LLM Agents Outperform Structures, arXiv:2603.28990](https://www.emergentmind.com/papers/2603.28990)).

**Beyond the brief:** This is the *empirical license* to abandon the hand-wired tree — **but only for Sonnet/Opus-class juniors.** Borjie should run capable juniors self-organized and keep Haiku-class workers under rigid structure. The single most important architectural verdict in this dossier: **structure should be a function of agent capability, not a constant.**

---

## 4. Coordination & negotiation protocols

**Baseline gap:** Borjie coordinates by *shared prompt + ordered execution*. No direct agent-to-agent negotiation, no stigmergic blackboard, no gossip.

### 4.1 Stigmergy & gossip — coordination without a controller
Stigmergy = indirect coordination via the environment: *"writing to a shared memory store, updating a task queue, flagging states in a vector database"* ([Codewave — Agentic AI Swarms](https://codewave.com/insights/future-agentic-ai-swarms/)). Gossip protocols give *"gossip-based averaging [so] agents estimate system-wide production metrics and modulate their own behavior"* ([Revisiting Gossip Protocols, arXiv:2508.01531](https://arxiv.org/pdf/2508.01531)); SwarmSys decomposes tasks into Explorers/Workers/Validators coordinating *"without centralized control"* ([arXiv:2510.10047](https://arxiv.org/pdf/2510.10047)).

**Beyond the brief:** Borjie has `intelligence_corpus_chunks` and a decision log — turn them into a **blackboard**: juniors post intermediate findings + load signals; others read and *self-assign* the gaps. Crisis coordination stops being CEO-serialized and becomes **emergent**, removing the `master-brain` bottleneck the Anthropic post explicitly warns about (*"the entire system can be blocked while waiting for a single subagent"*).

### 4.2 Negotiation & emergent collective memory
Extended CNP negotiation protocols handle multi-round bargaining with counter-proposals (Aknine, [LIP6](https://jmvidal.cse.sc.edu/library/aknine04a.pdf)). Decentralized systems also develop **emergent collective memory** ([arXiv:2512.10166](https://arxiv.org/pdf/2512.10166)).

**Beyond the brief:** When the cost-engineer and sales-offtake juniors disagree on a price floor, they should **negotiate to a Pareto point**, not both report to the CEO who picks one. This is debate-with-a-cooperative-judge (the survey's recommended hybrid channel) — and the Auditor is the judge.

---

## 5. Principal-agent problem & incentive alignment for sub-agents

**Baseline gap:** Borjie's juniors have no incentives at all — they cannot scheme because they have no goals, but they also cannot be *trusted-and-rewarded*; every output is equally suspect, so the Auditor must check everything (expensive). The frontier reframes this as **economics**.

### 5.1 MAS *are* principal-agent problems — "agency loss" is the core metric
The defining 2026 paper: multi-agent systems should be treated as principal-agent problems; **agency loss** = *"a gap between the principal's intended outcome and the realized system behavior,"* arising from **information asymmetry** (three sources: *finite context windows, black-box policies, selectively revealed reasoning traces*) and misaligned goals ([arXiv:2601.23211](https://arxiv.org/html/2601.23211v1)). It defines **scheming** as *"deliberate withholding, distortion, or strategic shaping of task-relevant information,"* split into **moral hazard** (hidden misaligned action) and **adverse selection** (misrepresenting type to gain autonomy). Proposed instruments: **screening mechanisms, reputation systems, prediction markets, tournament-based incentives, outcome-based performance contracts, auditing triggered by behavioral anomalies.**

**Beyond the brief:** Borjie's autonomy gate (`graduated-autonomy-gating-sota.md`) is a *blunt* screening instrument — it gates *actions* by confidence, not *agents* by track record. Upgrade to **type-revealing contracts**: a junior with a strong reputation gets a wider `R` budget and a lower audit-sampling rate (cheaper); a new or recently-failing junior is sampled at 100%. This directly attacks agency loss and **makes the Auditor's cost scale with risk, not with volume.**

### 5.2 Incentive-compatibility, staking & anti-free-riding
Blockchain-anchored coordination ties rewards to *verifiable* contributions via **reputation, staking (collateral), and performance-based payout**, making *"free-riding economically irrational"* ([arXiv:2509.16736](https://arxiv.org/pdf/2509.16736)). ALIGN gives **performance guarantees for aligned delegation** ([arXiv:2602.00127](https://arxiv.org/pdf/2602.00127)); reward shaping as a **Stackelberg game** aligns inference-time behavior ([arXiv:2602.02572](https://arxiv.org/pdf/2602.02572)).

**Beyond the brief:** Give each junior a **reputation balance** updated by Auditor verdicts + realized outcomes (did the offtake hedge actually improve NPV?). Bids are weighted by reputation; repeated `VIOLATED` contracts *slash* the balance (staking). The estate becomes a **meritocracy of agents** — the opposite of the flat, memoryless tool-pool today.

### 5.3 The conservation law that prevents runaway sub-agents
Agent Contracts enforce *"∑ c_j ≤ B per resource: parent budgets constrain child agents hierarchically, with unused allocations returning to a shared pool"* ([arXiv:2601.08815](https://arxiv.org/html/2601.08815v1)). This is the **anti-runaway invariant** — a sub-agent literally cannot spend more than its parent's pool, mirroring CLAUDE.md's "kill-switch fail-closed" rule at the *economic* layer.

---

## 6. Capacity, load balancing & elastic scaling

**Baseline gap:** Borjie has per-loop `context-budget.ts` but no *fleet-level* capacity model — no queue, no autoscaling, no load-aware routing.

### 6.1 Load-aware routing is a *scoring term*, not an afterthought
AgentNet++ routes by `α·expertise_match + β·resource_availability − γ·load` — **load is a first-class penalty** in allocation ([arXiv:2512.00614](https://arxiv.org/html/2512.00614v1)). Gossip-based averaging lets agents estimate system-wide load and self-throttle ([arXiv:2508.01531](https://arxiv.org/pdf/2508.01531)).

**Beyond the brief:** The CNP award (§1) should subtract a live-load term so a busy junior loses bids to an idle peer — automatic load balancing with zero central scheduler.

### 6.2 Tokens are the resource — capacity math breaks classic autoscaling
*"Tokens don't behave like requests … token consumption is non-linear with input length"* due to quadratic prefill ([TianPan — Capacity Planning for AI Workloads](https://tianpan.co/blog/2026-04-19-capacity-planning-ai-workloads)). Autoscale on **queue depth + p90 TTFT + KV-cache ≤85%** ([same]). **TokenScale** uses token-velocity scaling on disaggregated serving ([arXiv:2512.03416](https://arxiv.org/pdf/2512.03416)). **Token elasticity**: agents *exceed* tight budgets, so *"prompting alone is insufficient"* — explicit budget enforcement is required ([Budget-Aware Tool-Use, arXiv:2511.17006](https://arxiv.org/pdf/2511.17006)).

**Beyond the brief:** The estate must have a **token-denominated capacity plan and an agent autoscaler.** Off-peak, run a small junior pool; when crisis fan-out hits, elastically spawn parallel workers (Anthropic's 15× token multiplier is the *budget envelope*, not a surprise). Reserved capacity for baseline, spot/burst for fan-out.

### 6.3 The token-economics scaling law (the number that justifies the firm)
Anthropic: multi-agent uses **~15× the tokens of chat**; **token usage alone explains 80% of performance variance** (95% with model choice + tool-call count); a multi-agent Opus-lead + Sonnet-workers system **beat single-agent Opus by 90.2%** ([Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)). Asymptotic analysis argues scaling must be reasoned about *in LLM primitives* ([arXiv:2502.04358](https://arxiv.org/pdf/2502.04358)).

**Beyond the brief:** This converts "should the estate be a firm?" into a **ROI calculation**: spend 15× tokens *only* on tasks whose decision value exceeds the token cost. The autonomy gate should become an **expected-value gate** (decision-NPV vs token-spend), not just a confidence gate.

---

## 7. Org-design lessons from human firms → agent fleets

This is the deepest frontier seam: the economics-of-the-firm literature is being **directly ported** to agent fleets in 2025–26.

### 7.1 Coase: firms exist to minimize transaction costs — and agents *collapse* them
Coase (1937): firms exist because market transaction costs (search, negotiate, contract, monitor) are high; you internalize until internal coordination cost = market cost. **AI agents perform exactly those transaction-cost activities at near-zero marginal cost** → the **"Coasean Singularity"** ([NBER — The Coasean Singularity?, c15309](https://www.nber.org/system/files/chapters/c15309/c15309.pdf); [Berkeley CMR — From Coase to AI Agents](https://cmr.berkeley.edu/2025/04/from-coase-to-ai-agents-why-the-economics-of-the-firm-still-matters-in-the-age-of-automation/)). The boundary shifts depend on whether AI lowers *internal* or *external* coordination cost faster.

**Beyond the brief:** This reframes the entire estate. The naive design **internalizes everything** (all 50 juniors in one process). Coase says: with cheap agent transaction costs, the estate should **make-or-buy per capability** — keep core juniors in-house, but *buy* specialized capability from an external agent market (e.g., a third-party metallurgy agent) via contract when it's cheaper. The estate becomes a **thin orchestrator over a market**, not a monolith.

### 7.2 The Headless Firm — the hourglass and O(n²)→O(n)
*"The boundary of the firm is determined by coordination cost; in protocol-mediated agentic systems, integration cost collapses to O(n) while verification scales with task throughput rather than interaction count."* The architecture: **personalized generative interface on top → standardized protocol waist → competitive market of micro-specialized execution agents at the bottom** — enabling the **"Great Unbundling"** of integrated firms into agent networks ([The Headless Firm, arXiv:2602.21401](https://arxiv.org/abs/2602.21401)).

**Beyond the brief:** Borjie's chat-first UI *is* the hourglass top; the gap is the **protocol waist.** Today juniors are wired point-to-point (O(n²) coupling baked into `master-brain`). Adopting a **standard contract/bid protocol** (CNP + Agent Contracts) turns it into O(n) — a new junior plugs into the protocol, not into 50 hand-edited call sites. **This is the structural unlock for going from "a handful of juniors" to "a self-organizing organization."**

### 7.3 Separation of powers & institutional foundations
*From Logic Monopoly to Social Contract* argues autonomous agent economies need **separation of powers** and institutional scaffolding — identity, property rights, courts/enforcement, regulators ([arXiv:2603.25100](https://arxiv.org/pdf/2603.25100), 143pp — UNVERIFIED, binary fetch failed; title/subject confirmed via arXiv listing). *An Economy of AI Agents* (Hadfield & Koh) ports **reputation, relational contracting, property rights, and Coasean firm formation** to agents ([arXiv:2509.01063](https://arxiv.org/pdf/2509.01063)).

**Beyond the brief:** Mr. Mwikila as CEO must **not** also be judge, regulator, and police. Separate the powers: **CEO** (allocation), **Auditor** (judiciary — already exists, append-only hash-chained per CLAUDE.md), **kill-switch/policy-gate** (constitution — `inviolable.ts`, fail-closed), and a **reputation registry** (property rights). The estate gets *checks and balances*, the institutional defense against a single agent capturing the org.

### 7.4 Identity, reputation & inter-firm settlement (when the estate trades outside itself)
The agent-economy commerce stack: **A2A** for capability discovery/messaging + **AP2** (Google/Coinbase, Sept 2025) for payments via **Decentralized Identifiers + Verifiable Credentials** and an **Intent/Cart/Payment mandate** chain answering *"who is accountable if a transaction is fraudulent"* ([AP2 docs](https://agentpaymentsprotocol.info/docs/introduction/); [Descope — What is AP2](https://www.descope.com/learn/post/ap2)). Ledger-anchored agent identities + x402 micropayments extend A2A into a real **multi-agent economy** ([arXiv:2507.19550](https://arxiv.org/pdf/2507.19550); secure intent-binding, [arXiv:2511.15712](https://arxiv.org/pdf/2511.15712)).

**Beyond the brief:** The estate's *own* money path stays through `LedgerService.post()` (CLAUDE.md hard rule), but when a buyer-side agent transacts with an *external* off-taker agent in the marketplace, **AP2-style mandates give verifiable delegation + intent-binding + accountability** — exactly the buyer-mobile / marketplace surfaces Borjie already ships. This is how the estate participates in the *external* agent economy, not just orchestrates its internal one.

---

## 8. The scaling path — handful of juniors → self-organizing estate firm

A concrete, frontier-grounded migration (each rung cites its evidence):

1. **Protocol waist first (O(n²)→O(n)).** Define a Borjie agent contract (`I,O,S,R,T,Φ,Ψ`) + a CNP call-for-proposals bus. Juniors register capabilities; `master-brain` *announces* instead of *dispatches*. ([Headless Firm](https://arxiv.org/abs/2602.21401); [Agent Contracts](https://arxiv.org/html/2601.08815v1))
2. **Resource-bounded delegation.** Wire `budget.ts`/`context-budget.ts` to the conservation law `∑c_j ≤ B`; contracts go `VIOLATED → escalate`. ([BAMAS](https://arxiv.org/pdf/2511.21572))
3. **Reputation + incentive layer.** Reputation balance per junior from Auditor verdicts + realized outcomes; bids weighted by reputation; audit-sampling rate ∝ risk. ([MAS as Principal-Agent](https://arxiv.org/html/2601.23211v1); [Blockchain incentive-compatible](https://arxiv.org/pdf/2509.16736))
4. **Middle management + typed escalation.** Insert domain GMs (span ~8); HIGH-risk prefixes skip-level to CEO+human. ([Hierarchical MAS Taxonomy](https://arxiv.org/pdf/2508.12683))
5. **Adaptive topology per task.** Generate the org graph per task (G-Designer / learned puppeteer) instead of one static tree; train the CEO policy on `decisionLog`. ([G-Designer](https://arxiv.org/pdf/2410.11782); [Evolving Orchestration](https://arxiv.org/html/2505.19591v1))
6. **Capability-gated self-organization.** Capable juniors self-organize (44%/14% gains) with voluntary abstention; sub-threshold workers keep rigid structure (endogeneity paradox). ([Self-Organizing Agents](https://www.emergentmind.com/papers/2603.28990))
7. **Stigmergic crisis coordination.** Blackboard + gossip load-averaging removes the CEO serialization bottleneck. ([Gossip Protocols](https://arxiv.org/pdf/2508.01531); [SwarmSys](https://arxiv.org/pdf/2510.10047))
8. **Token-denominated capacity + autoscaler.** EV-gate (decision-NPV vs ~15× token cost); autoscale on queue-depth/TTFT/KV-cache. ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system); [TianPan capacity](https://tianpan.co/blog/2026-04-19-capacity-planning-ai-workloads))
9. **Separation of powers + external commerce.** CEO/Auditor/kill-switch/reputation as distinct branches; AP2 mandates for inter-agent trades in the marketplace. ([Economy of AI Agents](https://arxiv.org/pdf/2509.01063); [AP2](https://agentpaymentsprotocol.info/docs/introduction/))

**The provocation:** Borjie's "gated-until-auto + spawn-tabs" treats agents as *tools the human supervises*. The frontier treats them as *economic actors the CEO governs*. The difference between a handful of juniors and a self-organizing estate firm is not more juniors or a smarter router — it is **giving agents a budget, a contract, a price, a reputation, and the right to say no**, then letting the org chart emerge from the market. That is the leap from a program to a firm.

---

## Sources

- Multi-Agent Collaboration Mechanisms: A Survey of LLMs — https://arxiv.org/html/2501.06322v1
- Topological Structure Learning Should Be A Research Priority for LLM-MAS — https://arxiv.org/html/2505.22467
- A Taxonomy of Hierarchical Multi-Agent Systems: Design — https://arxiv.org/pdf/2508.12683
- G-Designer: Multi-agent Communication Topologies via GNNs — https://arxiv.org/pdf/2410.11782
- Dynamic Generation of Multi-LLM Topologies with Graph Diffusion — https://arxiv.org/pdf/2510.07799
- Multi-Agent Collaboration via Evolving Orchestration (puppeteer) — https://arxiv.org/html/2505.19591v1
- Self-Organizing LLM Agents Outperform Structures — https://www.emergentmind.com/papers/2603.28990
- Multi-Agent Systems Should be Treated as Principal-Agent Problems — https://arxiv.org/html/2601.23211v1
- ALIGN: Aligned Delegation with Performance Guarantees — https://arxiv.org/pdf/2602.00127
- Reward Shaping for Inference-Time Alignment (Stackelberg) — https://arxiv.org/pdf/2602.02572
- Blockchain-Driven Incentive-Compatible Collaboration — https://arxiv.org/pdf/2509.16736
- Agent Contracts: Resource-Bounded Autonomous AI Systems — https://arxiv.org/html/2601.08815v1
- BAMAS: Budget-Aware Multi-Agent Systems — https://arxiv.org/pdf/2511.21572
- Budget-Aware Tool-Use Enables Effective Agent Scaling — https://arxiv.org/pdf/2511.17006
- Position: Scaling LLM Agents Requires Asymptotic Analysis with LLM Primitives — https://arxiv.org/pdf/2502.04358
- TokenScale: Autoscaling for LLM Serving — https://arxiv.org/pdf/2512.03416
- AgentNet++ Hierarchical Decentralized Coordination — https://arxiv.org/html/2512.00614v1
- Revisiting Gossip Protocols for Emergent Coordination — https://arxiv.org/pdf/2508.01531
- SwarmSys: Decentralized Swarm-Inspired Agents — https://arxiv.org/pdf/2510.10047
- Emergent Collective Memory in Decentralized MAS — https://arxiv.org/pdf/2512.10166
- Magentic Marketplace: Studying Agentic Markets — https://arxiv.org/pdf/2510.25779
- An Economy of AI Agents (Hadfield & Koh) — https://arxiv.org/pdf/2509.01063
- From Logic Monopoly to Social Contract (separation of power) — https://arxiv.org/pdf/2603.25100 (UNVERIFIED — binary fetch failed)
- The Headless Firm: How AI Reshapes Enterprise Boundaries — https://arxiv.org/abs/2602.21401
- The Coasean Singularity? (NBER) — https://www.nber.org/system/files/chapters/c15309/c15309.pdf (UNVERIFIED text — binary fetch failed; summary via search)
- Berkeley CMR — From Coase to AI Agents — https://cmr.berkeley.edu/2025/04/from-coase-to-ai-agents-why-the-economics-of-the-firm-still-matters-in-the-age-of-automation/
- Anthropic Engineering — How we built our multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system
- Contract Net Protocol — Wikipedia — https://en.wikipedia.org/wiki/Contract_Net_Protocol
- Aknine — An Extended Multi-Agent Negotiation Protocol — https://jmvidal.cse.sc.edu/library/aknine04a.pdf
- Groundy — Multi-Agent Coordination Protocols — https://groundy.com/articles/multi-agent-coordination-protocols-when-ai-agents-work/
- AP2 — Agent Payments Protocol (intro) — https://agentpaymentsprotocol.info/docs/introduction/
- Descope — What is the Agent Payments Protocol (AP2) — https://www.descope.com/learn/post/ap2
- Ledger-Anchored Identities + x402 Micropayments for A2A — https://arxiv.org/pdf/2507.19550
- Secure Autonomous Agent Payments (intent-binding) — https://arxiv.org/pdf/2511.15712
- TianPan — Capacity Planning for AI Workloads (tokens as resource) — https://tianpan.co/blog/2026-04-19-capacity-planning-ai-workloads
- Codewave — Future of Agentic AI Swarms (stigmergy) — https://codewave.com/insights/future-agentic-ai-swarms/
