# Self-Wiring & Autonomic Frontier — the system that re-wires ITSELF, safely

**Document:** `Docs/research/wiring-self-autonomic.md`
**Lane:** `self-wiring-autonomic-frontier` ("the don't-even-know-we-can-do core")
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** SOTA dossier — no code, no commit. Survey of the 2026 frontier of
systems that wire themselves, mapped onto Borjie's live substrate.
**Audience:** Borjie owner + brain/kernel/spine engineers.

> **The owner's question, stated once and answered throughout:** how does
> Borjie's **EstateMind Slow Loop + the Admin Control Plane + the blackboard-sota
> CRDT meta-substrate** become a system that **re-wires its own topology** —
> which model, which path, which agent, which surface, which data-edge — **online,
> within governance, never sovereign**? The answer is a layered control stack
> (this dossier), where every rewire is a **proposal through the body-change
> meta-rail**, every reward is **logged on the hash-chained audit**, and the
> autonomic loop's authority is **bounded by `inviolable.ts`** — the offense
> (self-wiring) is safe *only because* of the defense, and they are one system.

---

## 0. Thesis — three layers of "self-wiring", from cheap to civilizational

The 2026 literature on systems-that-wire-themselves cleanly stratifies into
**three loops operating at three timescales**, and Borjie already owns a substrate
slot for each. The frontier insight is that you do **not** ship a Gödel-machine on
day one — you ship the **fast loop** (online learned routing) first, the **medium
loop** (reflective pipeline re-optimization) second, and gate the **slow loop**
(structural self-construction) behind the meta-rail forever.

| Loop | Timescale | What it rewires | 2026 SOTA exemplar | Borjie substrate slot |
|------|-----------|-----------------|--------------------|------------------------|
| **L1 Reflexive** | per-request (ms) | which model / path / tool for *this* query | BaRP bandit routing; MaAS agentic supernet (query-dependent topology) | **Admin Control Plane** (routing/ensemble) + **brain-llm-router** + **llm-budget-governor** |
| **L2 Reflective** | per-session→nightly | the *standing* prompt/topology/agent-set (the pipeline's own parameters) | GEPA reflective evolution; AFlow; metacognitive monitor→control | **EstateMind Slow Loop** (perceive→orient→motivate→**propose**) + DSPy-style offline compile |
| **L3 Constructive** | days→weeks, HITL | the *shape*: new agent, new edge, new data-type, new surface | ADAS/DGM (meta-agent programs new agents); self-constructing org-graph | **body-change meta-rail** → `SELF_ORGANIZING_ORG_BRAIN_VISION.md` ring |

The discipline: **each loop's output is the next loop's input, and each loop can
only *propose* changes one tier up.** L1 emits reward telemetry that L2 consumes;
L2 emits topology/prompt deltas that become *proposals* L3's meta-rail adjudicates;
L3-approved constructions re-derive the model L1 routes over. This is the
**MAPE-K** control architecture (Monitor→Analyze→Plan→Execute over shared
**K**nowledge) applied to the brain's own wiring — the canonical autonomic-computing
loop, now proven realizable with LLMs as the analyzer/planner
([arXiv:2407.14402 — *Vision of Autonomic Computing: Can LLMs Make It a Reality?*](https://arxiv.org/pdf/2407.14402)).

---

## 1. L1 — Reflexive self-wiring: online LEARNED routing (the fast loop)

**The frontier:** routing is no longer a static cost/quality table — it is a
**contextual bandit learned online from partial (bandit) feedback**, tunable at
inference time without retraining.

- **BaRP — *Learning to Route LLMs from Bandit Feedback: One Policy, Many
  Trade-offs*** ([arXiv:2510.07429](https://arxiv.org/abs/2510.07429)). The key
  2026 result: train the router under the *same partial-feedback restriction as
  deployment* (you only observe the reward of the model you actually called, never
  the counterfactual), and expose a **user preference vector** so operators dial
  the quality↔cost↔latency trade-off *at test time without retraining*. This is
  exactly the Admin Control Plane's "per-use-case routing" knob — but **learned**,
  not hand-set.
- **MetaLLM / MixLLM / PILOT / MetaCogAgent** — the bandit family: MetaLLM frames
  routing as a multi-armed bandit picking the cheapest model likely to be correct;
  MixLLM uses contextual-bandit policy-gradient with domain-aware query tags and a
  meta decision-maker balancing quality/cost/latency; PILOT (LinUCB) fuses *offline
  human-preference priors* with *online binary success/failure* feedback. MetaCogAgent
  adds **calibrated self-assessment** — confidence scores that *predict* actual
  performance, escalating to the strongest agent only as difficulty rises and
  confidence drops ([arXiv:2605.17292](https://arxiv.org/html/2605.17292v1)).
- **Survey grounding:** [*Dynamic Model Routing and Cascading for Efficient LLM
  Inference: A Survey* (arXiv:2603.04445)](https://arxiv.org/html/2603.04445v2)
  and [*Latency-Quality Routing for Functionally Equivalent Tools*
  (arXiv:2605.14241)](https://arxiv.org/html/2605.14241v2) — the latter generalizes
  bandit routing from *models* to **tools** (which of N equivalent tools, by
  measured latency×quality), which maps directly onto Borjie's tool-dispatcher.

**BEYOND-TODAY leap.** Borjie's control plane already has the *arms* (core LLM +
ordered fallbacks + ensemble {first-wins/vote/judge/debate} + per-use-case
routing). The leap is to make the **selector a preference-conditioned contextual
bandit** whose reward = a blend the budget-governor already computes
(answer-accepted? evidence-cited? abstained-correctly? cost-weighted tokens?
p95 latency?). The preference vector becomes a **tenant tier setting**: a Tier-3
estate dials "max quality," a free tenant dials "cost-floor," and the *same learned
policy* serves both — BaRP's central claim.

**How it AMPLIFIES Borjie.** The `llm-budget-governor` stops being a passive meter
and becomes the **reward channel** of a closed loop: every turn's cost/quality
outcome trains the router that decides the *next* turn's spend. The ensemble modes
(vote/judge/debate) stop being a static config and become **bandit arms** the
router escalates into *only when calibrated confidence is low* (MetaCogAgent's
difficulty-aware delegation) — so debate fires on the 3% of hard mining-finance
questions, not the 97% of easy ones. Cost drops while hard-case quality rises.

**WE-DID-NOT-KNOW-WE-COULD-DO-THIS.** Because the blackboard-sota CRDT is the live
cross-surface state-bus, the router's preference vector and per-arm reward
statistics can themselves be **named CRDT slots** — meaning the learned routing
policy is *observable and steerable from chat and from the admin console in
real time*, and converges across surfaces by LWW + version-vector. The owner can
literally watch the brain *learn which model to trust for assay questions* and nudge
it, and the nudge propagates everywhere with no redeploy.

---

## 2. L2 — Reflective self-wiring: the pipeline re-optimizes its OWN parameters

**The frontier:** the agentic pipeline is a program with *optimizable parameters*
(prompts, agent-set, topology, which-tool-when), and a **reflective optimizer**
improves those parameters from execution traces — at compile time *and* online.

- **GEPA — *Reflective Prompt Evolution Can Outperform Reinforcement Learning***
  (Agrawal et al., 2025, [arXiv:2507.19457](https://arxiv.org/abs/2507.19457);
  ICLR 2026 **oral**; shipped as `dspy.GEPA` and standalone `gepa`). The decisive
  result: instead of collapsing feedback into a scalar reward, GEPA **reads the
  natural-language trace** — error messages, reasoning logs, profiling — diagnoses
  *why* a prompt failed, proposes a targeted fix, and keeps a **Pareto frontier** of
  candidates. **Outperforms MIPROv2 by 13% and GRPO by 20% with 35× fewer rollouts**,
  using as few as 10 examples ([dspy.ai/api/optimizers/GEPA](https://dspy.ai/api/optimizers/GEPA/overview/)).
  This is the single most important 2026 datapoint for Borjie: *language-level
  reflection beats gradient RL for pipeline self-improvement, at a rollout budget a
  resident loop can actually afford.*
- **MaAS — Multi-agent Architecture Search via Agentic Supernet**
  ([arXiv:2502.04180](https://arxiv.org/abs/2502.04180), ICML'25 oral). Instead of
  one frozen optimal pipeline, learn a **probabilistic continuous distribution over
  architectures** (the "agentic supernet") and **sample a query-dependent
  subnetwork** per request — **6–45% of the inference cost** of handcrafted/automated
  baselines while *beating* them. This is L1 and L2 fused: the *topology itself* is
  sampled per query, and the sampler is trained from feedback.
- **AFlow & the survey** — [*From Static Templates to Dynamic Runtime Graphs:
  A Survey of Workflow Optimization for LLM Agents* (arXiv:2603.22386)](https://arxiv.org/pdf/2603.22386)
  catalogs the move from frozen templates to **runtime-mutable graphs**, and
  [*TPGO*] threads **textual gradients through the topology** and adds a
  **self-improving meta-optimization loop that refines the optimizer itself**
  ([ADAS topic, emergentmind](https://www.emergentmind.com/topics/automated-design-of-agentic-systems-adas)).
- **Metacognitive control** — [*Language Models Are Capable of Metacognitive
  Monitoring and Control of Their Internal Activations* (arXiv:2505.13763)](https://arxiv.org/html/2505.13763v1)
  and [*Adaptive Collaboration: Metacognitive Policy Optimization with Continual
  Learning* (arXiv:2603.07972)](https://arxiv.org/html/2603.07972v1): an **upward
  monitoring flow** ("is my current path adequate?") and a **downward control flow**
  ("rewire it") — the reflective loop that, in autonomic terms, *is* MAPE-K's
  Analyze→Plan stage operating over the pipeline's own performance.

**BEYOND-TODAY leap.** The **EstateMind Slow Loop** is *already* a
perceive→orient→motivate→**propose** resident loop, leader-elected and propose-only.
The leap: graft a **GEPA-style reflective optimizer as EstateMind's "orient" stage**.
Each night EstateMind reads the day's traces from the audit chain (the *trace*
GEPA needs is already hash-chained and append-only), runs reflective evolution over
the *junior agents' standing prompts and the routing policy*, keeps a Pareto frontier
of candidate wirings, **shadow-evaluates** the top candidate against held-out replayed
turns, and **proposes** the winning delta through the body-change rail. No gradients,
no retraining, ~20–100 evals/night — affordable for a resident loop.

**How it AMPLIFIES Borjie.** This closes the loop the `MD_COGNITIVE_KERNEL` and
`SELF_ORGANIZING_ORG_BRAIN_VISION` dossiers describe but stop short of *self-tuning*.
Today the junior prompts and routing are authored and frozen between commits;
with L2 they **self-improve nightly against the estate's own outcomes**, while every
improvement is (a) evidence-grounded (GEPA reads real traces), (b) Pareto-tracked
(never a single greedy step that regresses another metric — critical for "don't
break Swahili parity while improving assay accuracy"), and (c) **proposal-gated**
(the rail, not the optimizer, commits). The MaAS supernet idea makes the ensemble
modes a *learned distribution* — the brain learns *when* a question needs 4-agent
debate vs. a single Haiku call, per use-case, from data.

**WE-DID-NOT-KNOW-WE-COULD-DO-THIS.** Because the unwired **Inngest durable-execution**
substrate (`packages/central-intelligence/durable/inngest-executor`) already exists,
the nightly reflective-optimization run can be a **durable, resumable, idempotent
workflow** — it survives restarts, checkpoints each Pareto generation, and is
**at-least-once safe** like every other Borjie webhook. The brain's *self-improvement
process itself* inherits the platform's durability and audit guarantees — the
optimizer is as crash-safe and as accountable as a ledger post.

---

## 3. L3 — Constructive self-wiring: the system designs its OWN organs (HITL)

**The frontier:** a **meta-agent programs new agents** and an evolutionary loop
keeps the ones that empirically win — the system invents *building blocks*, not just
tunes parameters.

- **ADAS — *Automated Design of Agentic Systems*** (Hu, Lu et al.,
  [arXiv:2408.08435](https://arxiv.org/abs/2408.08435), ICLR 2025;
  [ShengranHu/ADAS](https://github.com/ShengranHu/ADAS)). Three components —
  **search space** (what agents are representable), **search algorithm** (how to
  explore), **evaluation function** (the fitness). The flagship instantiation
  defines **agents as code** and has a **meta-agent program ever-better agents**,
  discovering novel building blocks automatically.
- **Darwin Gödel Machine (DGM)** (Sakana/UBC, [arXiv:2505.22954](https://arxiv.org/abs/2505.22954);
  [sakana.ai/dgm](https://sakana.ai/dgm/)). The pragmatic relaxation of Schmidhuber's
  Gödel machine: drop the *provably-beneficial* requirement (impossible in practice)
  and **empirically validate each self-modification against a benchmark**. Result:
  SWE-bench 20.0%→50.0%, Polyglot 14.2%→30.7%, **self-rediscovering** better edit
  tools, long-context management, and **peer-review/self-reflection** loops. DGM-H
  generalizes beyond coding to any computable task.
- **The non-negotiable safety frame.** Every paper flags the same hazard:
  *if the fitness function does not capture safety/robustness, the loop amplifies
  misalignment over generations.* [*Your Agent May Misevolve: Emergent Risks in
  Self-evolving LLM Agents* (arXiv:2509.26354)](https://arxiv.org/pdf/2509.26354),
  [*On Safety Risks in Experience-Driven Self-Evolving Agents* (arXiv:2604.16968)](https://arxiv.org/html/2604.16968v1),
  and [*Zombie Agents: Persistent Control via Self-Reinforcing Injections*
  (arXiv:2602.15654)](https://arxiv.org/pdf/2602.15654) — the last shows a prompt
  injection can become a *persistent, self-reinforcing* corruption of a self-evolving
  agent's memory. **This is the precise reason L3 must be HITL behind the meta-rail
  forever, and why Borjie's input-containment + IP-egress guards + audit-chain are
  load-bearing.**

**BEYOND-TODAY leap.** L3 is the formal engine for the `SELF_ORGANIZING_ORG_BRAIN_VISION`
ring's Pillar 5 ("the twin proposes ORG redesigns") and Pillar 4 ("skill/capacity
routing"). The leap: run an **ADAS-style meta-agent as a *proposal generator* for new
juniors and new wiring** — the search space is "compositions of existing tools +
junior templates + edges," the search algorithm is GEPA-style reflective evolution
over the archive, the **evaluation function is a Borjie-specific fitness** that
*bakes the invariants in*: a candidate organ scores **zero** if it ever bypasses
`LedgerService.post()`, double-filters RLS, emits an empty evidence chain, mixes
EN/SW, or touches a HIGH-risk policy prefix. **You cannot misevolve toward a violation
because the fitness floor is the inviolable core.**

**How it AMPLIFIES Borjie.** This makes the org-brain's *self-construction* (already
the north-star architecture) **measurably better over time**, not just generative —
the DGM lesson is that empirical fitness + an archive of past designs beats one-shot
generation. Borjie's archive already exists: the audit chain *is* the lineage of every
prior proposal and its outcome. The meta-agent reads it as DGM reads its design
archive, and proposes the next organ from *what actually worked in this estate*.

**WE-DID-NOT-KNOW-WE-COULD-DO-THIS.** The DGM "peer-review / self-reflection"
discovery is reproducible *for free* in Borjie: the kernel already runs a
**debate/judge ensemble** (control plane) and an **Auditor Agent** (evidence gate).
So Borjie's L3 meta-agent can use its *own existing debate machinery* as the
"empirical validator" of a proposed new wiring — the system **peer-reviews its own
self-modifications using the same organ it uses to answer questions**, with the
Auditor as the veto. No external benchmark harness required; the estate's own held-out
replayed turns are the SWE-bench.

---

## 4. Autonomic foundation — MAPE-K self-{config,heal,optimize,protect}

The control theory under all three loops is **autonomic computing** (Kephart &
Chess), now LLM-realizable:

- [*Vision of Autonomic Computing: Can LLMs Make It a Reality?* (arXiv:2407.14402)](https://arxiv.org/pdf/2407.14402)
  — LLMs as the Analyze+Plan brain of a MAPE-K loop over a live system.
- [*Self-Healing Agentic Orchestrators for Reliable Tool-Augmented LLM Systems*
  (arXiv:2606.01416)](https://arxiv.org/html/2606.01416v1) and the
  [*Self-Healing Framework for Reliable LLM Agents*](https://www.researchgate.net/publication/404712514_A_Self-Healing_Framework_for_Reliable_LLM-Based_Autonomous_Agents)
  — failure-detection → reliability-assessment → automated-recovery as an explicit
  MAPE-K instantiation; **self-healing** = detect a junior/tool failing and *rewire
  around it* (fallback arm, degraded-mode surface) without a human.
- [*Autonomic Microservice Management via Agentic AI + MAPE-K* (Springer 2026)](https://link.springer.com/chapter/10.1007/978-3-032-04403-7_11)
  and [*Resilience in Ambient Multi-Agent LLMs via Decentralized Bio-Autonomic* (AAAI)](https://ojs.aaai.org/index.php/AAAI/article/download/41065/45026)
  — the four self-* properties (config/heal/optimize/protect) as the *governing
  envelope* a fleet of agents self-manages within.

**Mapping to Borjie's four self-\* properties (all already half-built):**

| Self-* | What it does in Borjie | Substrate that makes it real |
|--------|------------------------|------------------------------|
| **Self-configuring** | L1 router picks model/path/ensemble per query; L3 proposes new edges/organs | Control Plane + body-change rail |
| **Self-healing** | detect a failing junior/tool/model and rewire to a fallback arm or degraded surface; quarantine a poisoned memory | brain-llm-router fallbacks + audit anomaly + input-containment |
| **Self-optimizing** | L2 nightly reflective re-tune of prompts/topology/routing against estate outcomes | EstateMind orient-stage + GEPA + budget-governor reward |
| **Self-protecting** | refuse to evolve toward an invariant violation; fail-closed kill-switch; reject poisoned self-reinforcement | `inviolable.ts` + policy-gate + IP-egress + kill-switch |

**BEYOND-TODAY leap.** Treat the **blackboard-sota CRDT** as the MAPE-K **Knowledge**
plane — the shared, convergent, cross-surface store the four loops read/write. The
**Monitor** is the audit chain + sensor telemetry; **Analyze/Plan** is EstateMind +
the metacognitive monitor; **Execute** is the body-change rail (the *only* actuator,
fail-closed). One MAPE-K loop, four self-* behaviours, one chokepoint.

**WE-DID-NOT-KNOW-WE-COULD-DO-THIS.** **Self-healing as a first-class autonomic
reflex.** Today a model outage is an incident; with the autonomic loop, a model/tool
degradation is *detected by reward-collapse on the bandit*, *rewired to a fallback
arm in-flight*, *logged as a self-heal event on the audit chain*, and *the EstateMind
loop proposes a permanent routing update overnight* — the system **routes around its
own damage** the way the BGP/biological-autonomic literature describes, with zero
pages to a human for the transient and one *proposal* for the durable fix.

---

## 5. The safe self-wiring contract — how L1/L2/L3 stay non-sovereign

The entire frontier (DGM, ADAS, misevolution, Zombie-Agents) converges on one
warning: **a self-modifying loop is exactly as safe as its fitness function and its
actuation gate.** Borjie's differentiator is that *both already exist and are
inviolable.* The contract that makes self-wiring shippable:

1. **One actuator.** The body-change meta-rail is the *only* path that mutates
   wiring/topology/schema/surfaces. L1 may *select* among pre-approved arms in-flight;
   L2/L3 may only *propose*. (DGM/ADAS run in a sandbox + human oversight — Borjie's
   sandbox is "propose-only + isolate-vm," its oversight is HITL on the rail.)
2. **Invariant-floored fitness.** Any candidate wiring scoring a violation of the
   CLAUDE.md hard rules (money path, RLS, evidence-required, EN/SW absolutism,
   HIGH-risk literal-policy, audit append-only) gets **fitness = −∞** and is *never*
   archived — closing the [misevolution](https://arxiv.org/pdf/2509.26354) hole by
   construction, not by hope.
3. **Append-only lineage.** Every reward, every Pareto candidate, every proposal and
   its disposition is on the hash-chained audit — so the self-improvement process is
   *fully reconstructable and reversible*, and a [Zombie-Agent](https://arxiv.org/pdf/2602.15654)
   self-reinforcing injection is detectable as an anomalous, un-evidenced memory write
   that the input-containment guard quarantines before re-ingestion (Borjie's
   BP-1/BP-5 scanning is already wired).
4. **Bounded authority, leader-elected.** EstateMind is already propose-only and
   leader-elected; L1's bandit authority is bounded to *tier-allowed arms only*;
   sovereign / kill_switch / four_eye / policy_rollout prefixes are **never** subject
   to any learned generalization (CLAUDE.md hard rule).
5. **Shadow-then-propose.** No L2/L3 delta ships without *shadow evaluation against
   replayed held-out turns* — the DGM "empirically validate before keep" discipline,
   reusing the eval harness Borjie already runs in CI (`kernel-eval`, `trajectory-eval`,
   `sycophancy-probe`, `red-team`).

---

## 6. Concrete wiring map — substrate → loop → proposed organ

| Existing Borjie substrate | Becomes (this dossier) | Loop |
|---------------------------|------------------------|------|
| Admin Control Plane (routing/ensemble/fallbacks) | **arms** of a preference-conditioned contextual bandit (BaRP) | L1 |
| `llm-budget-governor` (cost-weighted tokens, tiers) | the **reward channel** + per-tier preference vector | L1 |
| `brain-llm-router` | bandit **selector** + self-heal fallback reflex | L1 |
| blackboard-sota CRDT | MAPE-K **Knowledge** plane; router policy/reward as live named slots | L1–L3 |
| Auditor Agent + debate/judge ensemble | **empirical validator** (peer-review) of proposed wirings | L2–L3 |
| Audit chain (hash, append-only) | the **trace** GEPA reads + the **archive** ADAS/DGM evolve from | L2–L3 |
| EstateMind Slow Loop (propose-only) | host of the **GEPA reflective optimizer** (orient stage) + metacognitive monitor | L2 |
| Inngest durable-execution (unwired) | crash-safe, resumable, idempotent **nightly self-optimization workflow** | L2 |
| body-change meta-rail | the **one actuator** (Execute) for every L2/L3 rewire | L2–L3 |
| `inviolable.ts` + policy-gate + IP-egress + input-containment | the **invariant-floor fitness** + self-protect envelope | all |
| ADAS/DGM meta-agent (new) | **proposal generator** for new juniors/edges, fitness-floored, HITL | L3 |

---

## Sources

- BaRP — *Learning to Route LLMs from Bandit Feedback: One Policy, Many Trade-offs* — https://arxiv.org/abs/2510.07429
- *Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey* — https://arxiv.org/html/2603.04445v2
- *Latency-Quality Routing for Functionally Equivalent Tools in LLM Agents* — https://arxiv.org/html/2605.14241v2
- MetaCogAgent — *Metacognitive Multi-Agent LLM with Self-Aware Task Delegation* — https://arxiv.org/html/2605.17292v1
- GEPA — *Reflective Prompt Evolution Can Outperform RL* (ICLR 2026 oral) — https://arxiv.org/abs/2507.19457 · https://dspy.ai/api/optimizers/GEPA/overview/
- MaAS — *Multi-agent Architecture Search via Agentic Supernet* (ICML'25 oral) — https://arxiv.org/abs/2502.04180
- *From Static Templates to Dynamic Runtime Graphs: A Survey of Workflow Optimization for LLM Agents* — https://arxiv.org/pdf/2603.22386
- ADAS — *Automated Design of Agentic Systems* — https://arxiv.org/abs/2408.08435 · https://github.com/ShengranHu/ADAS
- Darwin Gödel Machine — https://arxiv.org/abs/2505.22954 · https://sakana.ai/dgm/
- *Your Agent May Misevolve: Emergent Risks in Self-evolving LLM Agents* — https://arxiv.org/pdf/2509.26354
- *On Safety Risks in Experience-Driven Self-Evolving Agents* — https://arxiv.org/html/2604.16968v1
- *Zombie Agents: Persistent Control of Self-Evolving LLM Agents via Self-Reinforcing Injections* — https://arxiv.org/pdf/2602.15654
- *Just-In-Time Reinforcement Learning: Continual Learning in LLM Agents Without Gradient Updates* — https://arxiv.org/html/2601.18510
- Evo-Memory — *Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory* — https://arxiv.org/html/2511.20857v1
- *The Vision of Autonomic Computing: Can LLMs Make It a Reality?* — https://arxiv.org/pdf/2407.14402
- *Self-Healing Agentic Orchestrators for Reliable Tool-Augmented LLM Systems* — https://arxiv.org/html/2606.01416v1
- *Autonomic Microservice Management via Agentic AI and MAPE-K Integration* — https://link.springer.com/chapter/10.1007/978-3-032-04403-7_11
- *Language Models Are Capable of Metacognitive Monitoring and Control of Their Internal Activations* — https://arxiv.org/html/2505.13763v1
- *Adaptive Collaboration with Humans: Metacognitive Policy Optimization with Continual Learning* — https://arxiv.org/html/2603.07972v1
- *Resilience in Ambient Multi-Agent LLMs via Decentralized Bio-Autonomic* (AAAI) — https://ojs.aaai.org/index.php/AAAI/article/download/41065/45026
