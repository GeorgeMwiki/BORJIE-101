# VISION DOSSIER — Skill / Capacity / Task-Routing

**Lane:** `skill-capacity-task-routing` — the "right person/agent, best-placed,
free-now" engine.
**Date:** 2026-06-08
**Author:** vision-research subagent (deep current-web survey, June 2026)
**Status:** research dossier — no code, no commit.
**Sibling parity note:** Borjie (mining-estate OS) and BossNyumba (real-estate
OS) share ONE brain/capability/wiring layer; only the domain layer differs.
Everything in this dossier is domain-agnostic and lands in the SHARED layer —
the only fork is the *cost/eligibility function* (mining crew + ticket of work
vs. real-estate field team + viewing/maintenance/inspection).

---

## 0. The question this lane answers

When a unit of work appears — a haul cycle, a pit-wall inspection, a royalty
filing, a buyer-KYC review, a property viewing, a tenant maintenance ticket, a
junior-agent subtask — *who* (which human or which agent) should do it,
*where-placed* are they, are they *free now*, and is the whole estate's load
*fair and optimal*? And when reality breaks the plan (a no-show, a breakdown, a
licence freeze, an SLA-window slip), how does the assignment *self-heal in
seconds* without a human re-drawing the board?

This is the classical **assignment problem** wearing five new 2026 hats:
skill-matching, capacity/availability-awareness, fairness, human↔agent handoff,
and online disruption recovery. The vision: not a one-shot solve but a
**continuous, self-optimizing dispatch loop over the whole estate**.

---

## 1. State of the art (June 2026) — what exists today

### 1.1 The solver substrate is mature and free
- **Google OR-Tools CP-SAT** is the production-grade constraint solver for
  assignment + rostering: binary `x[worker,task]` decision vars, coverage
  constraints, skill-level matching, rest periods, labour-law limits, preference
  maximization. Reported real-world envelope: ~150 employees × 30 days × 50
  shift types solves in 2–5 min; 300+ employees in 10–30 min with a time cap.
  CP-SAT is the right default for *batch* rostering and *minute-scale* re-solves.
  ([OR-Tools employee scheduling](https://developers.google.com/optimization/scheduling/employee_scheduling),
  [CP-SAT solver](https://developers.google.com/optimization/cp/cp_solver),
  [CP-SAT Primer](https://d-krupke.github.io/cpsat-primer/04_modelling.html),
  [CP-SAT rostering guide](https://mbrenndoerfer.com/writing/cp-sat-rostering-constraint-programming-workforce-scheduling))
- **Timefold Solver** (the OptaPlanner successor) is the mature open engine for
  *fairness-as-a-constraint*: it ships `ConstraintCollectors.loadBalance()`,
  scores unfairness as **squared deviation from the mean** `Σ(xᵢ − x̄)²/n`, and
  recommends `HardSoftBigDecimalScore` for precision over large datasets. This is
  the cleanest off-the-shelf way to make "fair load-balancing" a first-class
  soft constraint, not an afterthought.
  ([Timefold load balancing & fairness](https://timefold.ai/blog/load-balancing-and-fairness))

### 1.2 The assignment algorithm zoo, and when each wins
- **Hungarian (Kuhn-Munkres)** — optimal one-to-one cost-minimizing match,
  minimal messaging (gather costs, broadcast assignment), but cost blows up as
  task volume escalates; a distributed variant exists for multi-robot teams.
  ([Distributed Hungarian](https://arxiv.org/pdf/1805.08712),
  [centralized-vs-distributed UAV eval, Jul 2025](https://www.mdpi.com/2504-446X/9/8/530))
- **Auction / market-based (MRTA)** — each candidate computes its own bid from
  an internal cost function over capability + constraints (distance, urgency,
  intensity); naturally distributed, fault-tolerant, but exchanges many messages
  per task (bids/replies/notifications). Two-stage auctions optimize total cost
  *and* enforce fair workload while minimizing message size.
  ([Optimal market-based MRTA via strategic pricing](https://www.roboticsproceedings.org/rss09/p33.pdf),
  [market-mechanism MRTA](https://ieeexplore.ieee.org/document/7784017/),
  [heterogeneous MRTA in dynamic scenarios, 2024](https://arxiv.org/html/2411.02062v3))
- **Practical takeaway:** Hungarian for small/dense optimal matches, CP-SAT for
  rich-constraint batch rostering, auction for distributed/heterogeneous/online
  fleets where a central solve is too slow or too brittle.

### 1.3 Fairness has graduated from "nice-to-have" to a modeled objective
- Fairness is now embedded *inside* the optimization: penalize deviation between
  actual and expected workload; bound the spread via variance, range, coefficient
  of variation, or equity indices; or solve bi-objective (efficiency vs. equity).
  Recent work uses **piecewise-linear approximation** to make the fairness term
  tractable, and **convex dispersion-control** model families.
  ([Workload-fairness via PWL, 2026](https://www.mdpi.com/2076-3417/16/4/1747),
  [convex fairness via dispersion control, 2025](https://arxiv.org/html/2510.23791),
  [equitable mTSP rethink](https://arxiv.org/pdf/2404.08157),
  [robust workload balancing under uncertain service time](https://arxiv.org/pdf/2103.04166))

### 1.4 Real-time dispatch under disruption — the RL frontier
- A 2015–2025 systematic review covers **129 studies** on (D)RL for vehicle
  routing; consensus: classical methods lack real-time adaptability, DRL excels
  in dynamic settings but is data-hungry, unstable, and hard to scale; hybrids
  win — **GNN+DRL**, plus online/meta-learning to close the sim-to-real gap.
  ([RL-for-DVRP review + GNN-DRL-G](https://www.mdpi.com/2305-6290/8/4/96),
  [RL for dynamic routing with stochastic request/travel times, 2025](https://www.sciencedirect.com/science/article/pii/S0968090X25003912))
- **Mining-specific, real:** an open-pit **QMIX (MARL) + Gaussian-Mixture-Model
  clustering** truck-dispatch framework — centralized training / decentralized
  execution, GMM compresses the state into 3 operational modes (empty return,
  loaded transit, load/unload dwell), **3.68 ms inference for a 10-truck fleet**,
  beats auction/adaptive-routing/DQN/greedy on completion + wait time, ~92%
  utilization. Haulage is up to 70% of mining cost, so this is the highest-value
  dispatch surface in the domain.
  ([QMIX-GMM open-pit truck scheduling, Nature Sci.Rep. 2025](https://www.nature.com/articles/s41598-025-16347-0),
  [DRL real-time truck dispatch](https://www.sciencedirect.com/science/article/abs/pii/S0305054824002879),
  [curriculum-RL truck dispatch, 2025](https://arxiv.org/pdf/2502.20845))
- **Disruption recovery as its own discipline:** set-partitioning + greedy
  re-assignment for berth/crane recovery after a subset of ops complete; online
  scheduling under bounded machine failures — the formal backbone for "a no-show
  / a breakdown" handling.
  ([online scheduling under bounded failures, 2025](https://link.springer.com/chapter/10.1007/978-3-032-15579-5_7),
  [real-time berth/crane disruption recovery](https://www.semanticscholar.org/paper/746e0cb75afd5ac93d8f4cbbbc7d9a2d368f630d))

### 1.5 Field-service dispatch is the commercial proving ground
- 2026 field-service engines already do skill-based routing as **hard filters**
  (certifications, languages, tooling, clearance/safety credentials) + a
  **weighted candidate score** over skills, travel time, SLA window, equipment,
  current route — auto-assign above a confidence threshold, else present ranked
  options. Reported gains: 20–30% utilization lift, up to 50% travel-time cut,
  first-time-fix improvements. Mining FMS analogue: Caterpillar **MineStar** and
  Modular **DISPATCH** (LP + best-path + dynamic programming, in-cab guidance).
  ([field-service scheduling optimization, May 2026](https://pctechmag.com/2026/05/field-service-scheduling-optimization-for-efficient-technician-routing-and-resource-allocation/),
  [AI dispatching 2026](https://www.teambridge.com/blog/ai-dispatching-2026-manual-scheduling-boards-done),
  [best AI dispatch software 2026](https://locus.sh/blogs/best-ai-dispatch-software/),
  [Komatsu DISPATCH FMS](https://www.komatsu.com/en-us/case-studies/dispatch-fleet-management-system-helps-mine-optimize-its-haulage))

### 1.6 The same problem for *agents*, not just humans
- 2026 multi-agent orchestration converges on **capability-aware routing**:
  route each task to the agent whose demonstrated competency matches it, rather
  than to a fixed "best model." **AdaptOrch** (arXiv 2602.16873) frames this as
  the answer to *LLM performance convergence* — when models flatten in baseline
  ability, task-adaptive routing to specialized agents is what creates the edge.
  Production reality: orchestrator-worker is ~70% of deployments; practical team
  size is 3–4 agents before coordination overhead bites; centralized multi-agent
  carries ~285% token overhead vs ~58% for independent — so routing must be
  **sparse and asynchronous**.
  ([AdaptOrch, 2026](https://arxiv.org/pdf/2602.16873),
  [multi-agent coordination 2026](https://sesamedisk.com/multi-agent-llm-coordination-2026/),
  [multi-agent patterns 2026](https://decodethefuture.org/en/multi-agent-systems-explained/))

### 1.7 Human↔agent handoff is now a measured, regulated discipline
- Escalation triggers, ranked: low confidence (39%), explicit user request (28%),
  sentiment drop (17%), regulated topic (16%). Common bands: hedge below 0.85
  confidence, escalate below 0.70; target 10–15% escalation (median observed
  22%). **Confidence is mis-calibrated across models** (GPT overconfident, Claude
  cautious) — so escalation must be **multi-signal**, not a single number. The EU
  AI Act mandates qualified human oversight for high-risk systems, most
  obligations live from **2 Aug 2026** — handoff is a compliance surface, not
  just UX.
  ([agent handoff patterns 2026](https://www.buildmvpfast.com/blog/agent-handoff-patterns-ai-human-escalation-confidence-threshold-2026),
  [HITL in agentic workflows, AWS, 2026](https://nxgcloud.com/2026/03/12/mastering-human-in-the-loop-hitl-patterns-in-aws-agentic-ai-workflows/),
  [HITL oversight, Galileo](https://galileo.ai/blog/human-in-the-loop-agent-oversight))

---

## 2. The synthesis — a reference architecture for THIS lane

A single **Dispatch Kernel** that is one routing brain for humans AND agents:

1. **Eligibility filter (hard).** Skills/certs/clearance/safety credentials,
   licence/jurisdiction validity, kill-switch/policy gates → candidate set. (The
   one mining/RE fork lives here: which credentials, which jurisdiction rules.)
2. **Cost/utility score (soft, weighted).** Skill-fit × capacity-headroom ×
   proximity/route × SLA-window slack × **fairness penalty** (Timefold
   squared-deviation) × cost. Tunable per estate.
3. **Solver tier (pick by latency budget).** Hungarian for small optimal
   one-to-one; **CP-SAT** for rich-constraint batch rosters; **auction** for
   distributed/online fleets; **MARL (QMIX-style)** for high-frequency physical
   dispatch (haul cycles) where ms-latency and disruption-resilience dominate.
4. **Confidence + handoff.** Auto-assign above threshold; below it, surface
   ranked options to the human (multi-signal, never a lone confidence number);
   log every escalation for the EU-AI-Act oversight trail.
5. **Disruption listener (online).** No-show / breakdown / freeze / SLA-slip →
   incremental re-solve (set-partitioning + greedy warm-start, not a cold
   re-plan) in seconds, not a board redraw.
6. **Fairness ledger.** Track cumulative load per worker/agent across the cycle
   so today's fairness penalty sees yesterday's burden.

---

## 3. Where Borjie / BossNyumba stand today (grounded gap)

Borjie already ships `packages/workforce-orchestrator` (`assign-task.ts`,
`plan-assignment.ts`, `skill-inferrer.ts`, `followup-scheduler.ts`, ~2,100 LOC)
plus a live `services/api-gateway/src/routes/mining/assignment-planner.hono.ts`
route, a `mining_tasks` schema with `assigned_to_user_id` (NULL = manager queue),
and a `routing_rules` schema for junior-chain routing. **But `planAssignment()`
only derives risk-tier / cadence / follow-up — it does NOT solve the actual
person↔task match.** There is no Hungarian/CP-SAT/auction, no capacity or
free-now signal, no fairness objective, no online disruption re-solve. Assignment
is a manual manager queue with a rules table. This is exactly the
`skill-capacity-task-routing` lane in `MASTER_GAP_REGISTER.md` — built scaffolding,
no optimizer underneath. The Dispatch Kernel above is the shared closure; both
estates inherit it, forking only the eligibility/cost function.

---

## 4. Sources (all real, June-2026-current)

See inline links above. Primary anchors: OR-Tools CP-SAT, Timefold fairness,
distributed Hungarian + market-based MRTA (RSS / IEEE / 2025 UAV eval),
RL-for-DVRP review + 2025 stochastic-time RL, QMIX-GMM mining truck dispatch
(Nature Sci.Rep. 2025), AdaptOrch (arXiv 2026), 2026 field-service & agent-handoff
practitioner sources, EU AI Act human-oversight timeline.
