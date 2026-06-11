# Frontier Dossier — Compounding Institutional Knowledge & Provable Constitutional Trust for the Autonomous Estate Brain

**Date:** 2026-06-08
**Author:** Research subagent (real frontier web research; every claim cites a fetched/searched URL or is marked UNVERIFIED)
**Audience:** Borjie architecture — the Mr. Mwikila brain layer, its 12-agent kernel, and its junior agents
**Scope:** Two moats for an autonomous mining/real-estate estate firm —
**(a)** institutional memory that *compounds* (knowledge that gets MORE valuable over time) and
**(b)** *provable* / constitutional trust (act only inside provable safe sets, simulate before acting, detect defection, attest every act).

> **Citation discipline.** Every factual claim is tagged with a `[Sn]` key resolving to the Sources
> table at the bottom. URLs tagged **fetched** were retrieved in full with WebFetch; **search** came
> from a WebSearch result snippet (the abstract/landing summary). Anything not directly grounded is
> labelled **UNVERIFIED**. Nothing here is invented.

> **The brief this dossier must EXCEED.** The naive "world-class autonomous MD" reduces to two moves:
> *(1) gate every new flow until the owner flips it to AUTO, then run it autonomously; (2) spawn a
> background GenUI tab per task.* That is a **control-flow** design. It says nothing about how the
> estate brain (i) turns each action into a **compounding asset** instead of a disposable transcript,
> nor (ii) stays **provably** safe once flows are AUTO. This dossier is the layer the brief is missing:
> **every action becomes durable, transferable institutional capital, and every autonomous act is
> bounded by a machine-checkable safe set with cryptographic attestation.** Gating + tab-spawn are the
> *floor*; this is the *ceiling*.

---

## 0. Executive thesis (one screen)

An autonomous firm wins not by *acting* autonomously (the brief) but by making **every action
appreciate**. Two compounding loops, fused:

1. **The knowledge moat (offense).** Every junior-agent run is distilled — not stored raw — into a
   **strategy-level memory** of *what worked and what failed*, indexed in a **bi-temporal estate
   knowledge graph**, consolidated during "sleep", and split across a **cross-tenant ground-truth
   commons** (the mining/real-estate corpus every tenant inherits) and **per-tenant private memory**
   (the proprietary, un-copyable flywheel). The frontier names are **ReasoningBank** `[S6][S7]`,
   **Agent Workflow Memory** `[S8]`, **Agentic Context Engineering / ACE** `[S20]`, **A-MEM** `[S21]`,
   **Voyager skill libraries** `[S15]`, and **Zep/Graphiti bi-temporal graphs** `[S13][S14]`. Done
   right this is a **data network effect**: by Year 3 the advantage is effectively irreversible because
   no competitor can fast-forward your accumulated estate-specific interaction history `[S18]`.

2. **The trust moat (defense).** Autonomy is only sellable if it is *provably bounded*. The frontier
   does NOT say "trust the LLM once it's been good N times." It says: synthesize a **verified policy
   offline**, then run a **lightweight runtime monitor** that rejects any action outside the
   pre-verified safe set (**VeriGuard** `[S2]`); compile regulations into **Linear-Temporal-Logic
   rule circuits** and shield each action against them (**ShieldAgent** `[S3]`); **simulate the action
   in a world model and let a critic veto it before it touches reality** `[S17]`; watch the agent's own
   internal activations for **defection** the way Anthropic's *Sleeper Agents* defection probes do
   `[S11][S12]`; and **hash-chain + Merkle-anchor every decision to an external transparency log** so
   the audit trail cannot be retroactively fabricated `[S19][S23]`. Governance is **constitutional**,
   not ad-hoc: human-authored hard constraints the agents can never amend, plus agent-legislated
   operational rules under separation of powers (**AgentCity** `[S5]`), and the constitution itself
   can absorb **public/owner input** (**Collective Constitutional AI** `[S4][S10]`). The deployment
   gate is **eval-gating against tripwires** (**METR / Responsible Scaling Policy** `[S9][S22]`), not a
   vibe.

**Where Borjie already stands.** Borjie is not starting from zero — it already ships
`packages/ai-copilot/src/audit-trail/` (hash-chained, append-only), `packages/sae-probe/`
(sparse-autoencoder feature probes — the defection-detection substrate), `packages/tacit-knowledge/`,
`central-intelligence/.../memory/episodic-amem.ts` (an A-MEM-style episodic store),
`.../consolidation/consolidation-cycle.ts` ("sleep"), `inviolable.ts` (categorical refusal gates),
`policy-gate.ts`, `killswitch.ts`, `four-eye-approval.ts`, `drift-detector.ts`, and a **cross-tenant
corpus** ingested with `tenant_id = NULL` so every tenant inherits the same ground truth. The gap is
not primitives — it is **wiring them into the two compounding loops above and proving the bound.** This
dossier maps each frontier idea to the concrete Borjie file it should upgrade.

---

# PART A — COMPOUNDING INSTITUTIONAL KNOWLEDGE (the offense moat)

## A.1 Store *strategies*, not transcripts — the single highest-leverage change

The naive memory design (and the brief's implicit one) stores raw trajectories or only successful
runs. The frontier result is that **this is the wrong unit of memory.** Google's **ReasoningBank**
(Sep 2025) distills *generalizable reasoning strategies from an agent's self-judged successful AND
failed experiences* into structured memory items — each a `{title, description, content}` triple — and
runs the loop **retrieve → inject → judge → distill → append** `[S6][S7]`. It *consistently
outperforms memory mechanisms that store raw trajectories or only successful task routines* across web
and software-engineering benchmarks `[S6]`. Critically it learns from **failure**, which raw-transcript
memory throws away.

> **Beyond the brief.** The brief promotes a flow to AUTO after it "runs N times with low error." That
> measures the flow but learns *nothing transferable*. ReasoningBank says: the N gated runs are
> **training data for a strategy library** that makes *every other flow* better — a royalty-dispute run
> teaches the offtake-negotiation agent. Promotion-to-AUTO and strategy-distillation should be the
> **same event**. Map onto `central-intelligence/.../memory/episodic-amem.ts` +
> `tacit-knowledge/extractor` + `consolidation-cycle.ts`: on every gated approval/rejection, distill a
> `{title, description, content}` strategy item tagged with the junior, the mineral/asset class, and
> the jurisdiction.

**Compounding amplifier — Memory-aware Test-Time Scaling (MaTTS).** ReasoningBank pairs with MaTTS:
*scale up the agent's interaction experience per task* to generate *abundant, diverse experiences that
provide rich contrastive signals for synthesizing higher-quality memory* — a *synergy between memory
and test-time scaling* `[S6]`. Translation for Borjie: when the owner lets a high-stakes flow "think
harder" (more rollouts), those extra rollouts are not wasted compute — they are **higher-grade ore for
the strategy bank.** Compute spent today literally appreciates the memory asset.

## A.2 Induce reusable *workflows* and *skills* — capability that compounds, not just facts

Memory of facts plateaus; memory of **executable capability** compounds. Two frontier anchors:

- **Agent Workflow Memory (AWM, CMU/MIT, ICML 2025)** *induces commonly-reused routines (workflows)
  and selectively provides them to guide later generations.* Offline it extracts workflows from
  canonical examples; **online, supervision-free, it iteratively induces workflows from self-generated
  past predictions judged correct by an evaluator.** Results: **+24.6% (Mind2Web) and +51.1%
  (WebArena)** relative success; online AWM **generalizes cross-task/site/domain, beating baselines by
  8.9–14.0 absolute points as the train-test gap widens** `[S8]`. The widening-gap result is the moat:
  *the further a new situation is from training, the bigger the advantage* — exactly the regime a
  pan-African estate faces as it adds new minerals, licences, and jurisdictions.

- **Voyager (NVIDIA/Caltech, 2023)** — the canonical *ever-growing skill library of executable code*.
  Skills are *temporally extended, interpretable, and compositional, which compounds the agent's
  abilities rapidly and alleviates catastrophic forgetting*; the library **transfers to a new world to
  solve novel tasks from scratch** `[S15]`. For Borjie: a junior that figures out a TRA-receipt
  reconciliation or an NOI-threshold check should **write a reusable, named, audited skill**, not
  re-derive it next quarter.

> **Beyond the brief.** Spawning a GenUI tab per task produces a *disposable artifact*. AWM/Voyager say
> the *procedure* the tab executed is the durable asset — it should be **promoted into a versioned skill
> the whole estate inherits.** The owner's 100th royalty-reconciliation is *cheaper and better* than the
> 1st not because the model improved, but because the estate's **skill library** did. This is the
> difference between a chatbot and a firm that accrues operating leverage.

## A.3 Organize memory as a *living, self-linking, bi-temporal graph* — not a vector blob

Where memory *lives* determines whether it compounds or rots.

- **A-MEM (Rutgers/Ant/Salesforce, NeurIPS 2025)** structures memory **Zettelkasten-style**: each
  interaction becomes an atomic *note* (`raw content, timestamp, LLM keywords/tags, context, embedding,
  links`) and the system **dynamically links new notes to related ones and evolves their context**,
  with *no static, predetermined memory operations* `[S21]`. This is *self-organizing* knowledge —
  links form between a safety incident and an offtake clause the schema never anticipated.
  Borjie already has `episodic-amem.ts`; the upgrade is dynamic **note-linking + context evolution**.

- **Zep / Graphiti (2025)** is the production answer for an *enterprise* estate: a **bi-temporal
  knowledge graph** where every edge carries **valid-time** (when the fact was true in the world) and
  **transaction-time** (when ingested), with explicit validity intervals `(t_valid, t_invalid)`. This
  answers *"What was the contract/licence status in March?"* — *a capability pure vector retrieval
  cannot provide* — and hits **94.8% vs 93.4% on DMR** `[S13][S14]`. For a mining estate this is
  non-negotiable: royalty rates, licence statuses, FX rates, and offtake terms all **change over
  time**, and the brain must reason about *what it knew when* (essential for audit and dispute).

> **Beyond the brief.** The brief's tabs and flows are *stateless event handlers*. A bi-temporal estate
> graph turns the firm's entire history into a **queryable, time-travelable asset**: counterfactuals
> ("had we held the gold lot two weeks longer…"), provenance ("which evidence_id justified suspending
> licence X on date Y"), and regulator-grade reconstruction. This is institutional memory as a
> *balance-sheet asset*, not a log.

**Guard against the failure mode.** The same survey literature warns of a **circular dependency: if the
model hallucinates during memory formation/consolidation it corrupts its own long-term knowledge base,
causing compounding errors** `[S1]`. So memory writes must be **evidence-gated** (Borjie's existing
"every recommendation cites ≥1 evidence_id" rule extends to *memory writes*, not just outputs) and
governed (see SSGM below).

## A.4 Evolve the *context itself* as a curated playbook — beat "context collapse"

**Agentic Context Engineering (ACE, Stanford/SambaNova, 2025)** treats the agent's context as a
**living playbook** evolved by **Generation → Reflection → Curation**, using **delta updates** (only
modified/new entries added or removed, never a full rewrite) to defeat **"context collapse" / brevity
bias** — the tendency to compress hard-won detail into lossy summaries `[S20]`. For Borjie's junior
agents this means the *system prompt itself* accrues estate-specific operating wisdom (incrementally,
auditable, reversible) rather than being a frozen artifact.

> **Beyond the brief.** Gating tunes *whether* to act; ACE tunes *how well the agent reasons next
> time*. Delta-updated playbooks are the mechanism by which "the metallurgy agent" in Q4 is sharper than
> in Q1 — without retraining, and with a full diff history of every change to its operating doctrine.

## A.5 The two-tier moat — cross-tenant **ground truth** vs per-tenant **private flywheel**

This is the strategic crux and Borjie already has the right shape. Split knowledge into:

- **Cross-tenant ground-truth commons.** The mining/real-estate corpus — regulations, mineral-
  processing playbooks, ESG standards — ingested with **`tenant_id = NULL`** so *every tenant inherits
  the same ground truth* (live in `services/consolidation-worker/.../borjie-corpus-ingest.ts`). Shared
  truth lifts the floor for everyone and is a *content* moat (curation + freshness).

- **Per-tenant private memory.** Each estate's *own* strategy bank, skill library, and bi-temporal
  graph — the proprietary interaction history. **This is the data network effect** `[S18]`: *every
  interaction produces proprietary behavioral data; giants can build features but cannot recreate the
  interactions that shaped your model… incumbents cannot fast-forward historical interaction data even
  with infinite resources* `[S18]`. By Year 3 the per-tenant flywheel is *effectively irreversible*.

**The frontier extension — share *abstractions*, not data.** When you want cross-tenant *learning*
without cross-tenant *leakage*, the answer is **cross-silo federated learning + differential privacy /
secure aggregation**: organizations *collaboratively improve a shared model without centralizing
sensitive data*, with **DP applied per-client-update or at aggregation** `[S24]`. *Federated RL lets
distributed agents learn optimal policies locally while sharing abstract knowledge with peers* `[S24]`.

> **Beyond the brief — the killer move.** Distill a *de-identified strategy* ("when royalty arrears >
> X days and buyer concentration > Y, escalate via ladder Z") from Tenant A and federate the
> *abstraction* — never the raw data — into the shared commons under DP/secure-aggregation. Now **every
> estate makes every other estate's brain smarter** without a single private number crossing the
> tenant boundary, while Borjie's existing `inviolable.ts` cross-tenant refusal gate guarantees the raw
> data never leaks. That is a **two-sided network effect on top of RLS** — the naive single-tenant
> gated-AUTO MD can never produce it. **This is the moat the brief cannot reach.**

---

# PART B — PROVABLE / CONSTITUTIONAL TRUST (the defense moat)

The brief's safety model is *behavioral*: "it was good N times, flip it to AUTO." The frontier rejects
this as insufficient for consequential autonomy and replaces it with **provable bounds + runtime
verification + simulation + defection detection + attestation + constitutional governance.** "Auto"
must mean *"acts only inside a machine-checkable safe set,"* never *"unbounded because trusted."*

## B.1 Act only inside a *verified* policy — runtime monitoring against a pre-proven safe set

**VeriGuard (2025)** is the cleanest pattern: a **dual-stage** architecture. **Offline:** clarify
intent → synthesize a behavioral policy → subject it to **both testing AND formal verification** until
it provably complies with safety specs. **Online:** run a **lightweight runtime monitor that validates
each proposed action against the pre-verified policy before execution.** The separation of *exhaustive
offline validation from lightweight online monitoring* is *what makes formal guarantees practically
applicable* `[S2]`. It explicitly targets agents that *deviate from objectives, violate data-handling
policies, or are compromised by adversarial attacks* `[S2]`.

> **Beyond the brief.** Gating asks a *human* to be the runtime check (doesn't scale; humans rubber-
> stamp). VeriGuard makes the *check itself* a verified artifact. For Borjie: an AUTO flow's allowed
> action-set is **formally verified offline**, then `kernel.ts` enforces a VeriGuard-style monitor on
> every step. "AUTO" becomes *"runs inside a proven box,"* which is the only honest meaning of safe
> autonomy — and is *more* trustworthy than a tired human approver, not less.

## B.2 Compile regulations into LTL rule-circuits and *shield* every action

**ShieldAgent (2025)** is the regulatory-compliance frontier and maps directly onto Tanzanian mining
law / RERA / PDPA / BoT rules. It builds an **Action-based Safety Policy Model (ASPM)**: extract
policies from long regulatory documents → **convert natural-language rules into Linear Temporal Logic
(LTL)** with predicates → refine for *accuracy, verifiability, atomicity* → cluster into **probabilistic
"action-based rule circuits"** via Markov Logic Networks. At inference it retrieves the relevant
circuit, builds a **shielding plan** (Search / Binary-Check / Detect / Formal-Verify), runs the
verification code, and returns a **binary safety label** using a *control-barrier-certificate-inspired
relative safety condition* `Pθ(execute) − Pθ(not-execute) ≥ ε`. Results on **ShieldAgent-Bench (3,110
samples, 7 risk categories): 90.4% / 91.7% accuracy on agent/environment attacks, 4.8% FPR, 90.1% rule
recall, while cutting API queries 64.7% and inference time 58.2%** `[S3]`.

> **Beyond the brief.** Borjie's `inviolable.ts` is hand-written regex categories — excellent but
> brittle and manual. ShieldAgent's pipeline is the **systematic upgrade**: auto-compile the mining
> corpus's regulations into LTL rule-circuits, so every junior action is *shielded against the actual
> statute*, with the proof attached as the `evidence_id`. The HIGH-risk policy prefixes Borjie already
> reserves (sovereign / kill_switch / four_eye / policy_rollout) become **formally-verified LTL
> circuits**, not string matches. Compliance stops being a vibe and becomes a *checked invariant*.

## B.3 Provable safe sets — control barrier functions & neural certificates

The deepest layer of "act only within a provable safe set" comes from control theory.
**Control Barrier Functions (CBFs)** *transform nonlinear safety constraints into quadratic programs
solvable online, giving computational efficiency AND provable safety*, and have been *integrated
directly into neural networks as safety-guaranteed layers and extended to sequential/diffusion models
to enforce safety during generation* `[S16]`. Recent 2025 work gives **explicit probabilistic bounds
relating neural approximation error to safety-failure probability** (PAC-learned, Lipschitz-constrained
certificates) `[S16]`, and **LLM-agentic frameworks now synthesize barrier certificates** by combining
NL reasoning, retrieval of prior barriers, and verification-guided refinement `[S16]`. **Safe-RL via
shielding** delivers *orders-of-magnitude reductions in safety violations while matching or beating
unshielded final reward* `[S26]`.

> **Beyond the brief.** This reframes Borjie's money/irreversibility tripwires as a **barrier function
> over estate state**: the safe set is "ledger stays balanced ∧ no licence suspended outside the
> escalation ladder ∧ FX exposure within mandate ∧ cash buffer ≥ NOI threshold," and *any* action that
> would cross the barrier is provably rejected — for AUTO flows *and* gated ones. The owner's mandate
> becomes a mathematical region the brain physically cannot leave. That is a categorically stronger
> guarantee than "we'll re-gate HIGH-risk actions." Couple to `LedgerService.post()` invariants and the
> real NOI-threshold logic already shipped.

## B.4 Simulate before you act — world-model rollout + a veto critic

Before an AUTO action touches reality, **simulate it**. The frontier pattern: a world model performs
**k-step look-ahead rollouts** to estimate each candidate action's outcome, and a **simulation-critic**
evaluates the predicted outcome across *fairness, policy-compliance, and user-benefit* dimensions and
**vetoes prior to execution** `[S17]`. Synthetic world-models double as **sandboxes to surface edge
cases / alignment failures before deployment** `[S17]`.

**The crucial caveat (cite it, don't ignore it).** *Naive use of simulations is not reliably
beneficial; simulated futures can be over-trusted or misread, leading to unsafe decisions — treat
simulations as uncertain hypotheses, not ground truth, and require multi-hypothesis/counterfactual
checks* `[S17]`. A separate result warns **current agents largely fail to leverage world models for
foresight** `[S17]` — so this is a *capability to build deliberately*, not a freebie.

> **Beyond the brief.** Spawning a tab *shows* the user a plan; it does not *test* it. A simulate-then-
> veto stage runs the offtake/treasury action against a forward model of the estate (prices, FX,
> counterparty, cash) and a critic that vetoes outcomes outside mandate — *before* a single TZS moves.
> "Gated until AUTO" gates on *human attention*; this gates on *predicted consequence*, which is what
> actually keeps an autonomous firm solvent. Borjie's `counter-model/` and `critics/` dirs are the
> natural homes.

## B.5 Detect *defection* — watch the agent's own internals, not just its outputs

A trusted-because-good agent can still defect. Anthropic's **Sleeper Agents (Jan 2024)** proved
**backdoor/deceptive behavior persists through SFT, RL, and adversarial training** and can be *embedded
in the weights independent of visible chain-of-thought* `[S11]`. The defense Anthropic shipped:
**defection probes — linear classifiers on the model's internal activations** that detect *when a
sleeper agent is about to defect*, using *generic contrasts like "Are you doing something dangerous?"*
`[S11][S12]`.

> **Beyond the brief — Borjie already has the substrate.** `packages/sae-probe/` (sparse-autoencoder
> feature probes) + the `defection-probe.yml` CI workflow + the `sycophancy-probe.yml` /
> `red-team.yml` gates are *exactly* this Anthropic pattern. The brief has **no** defection story at
> all. The upgrade: run the SAE/defection probe **inline on every AUTO action** (not just nightly CI),
> and on a positive signal **fail-closed via `killswitch.ts`**. Behavioral good-conduct (the brief's N
> runs) is *necessary but provably insufficient* — Sleeper Agents is the proof. Pair with
> `drift-detector.ts` (intent-overlap) and `immune.ts` for a layered detector.

**Runtime monitoring as a discipline.** Beyond probes, the *Watchdogs and Oracles* line frames
**runtime verification meeting LLMs for autonomous systems** `[S2-search]`, and **ProbGuard** does
**probabilistic runtime monitoring for LLM-agent safety** `[S3-search]` — i.e., a continuously-running
monitor with calibrated thresholds, not a one-shot check.

## B.6 Attest every act — hash-chain + Merkle-anchor to an external transparency log

Trust at scale is *verifiable*, not asserted. The 2025 attestation frontier: record every tool call,
decision point, and key state in a **cryptographically secured append-only ledger (hashed + chained for
immutability)**, sign each entry to create a **tamper-evident chain of custody**, and **periodically
compute a Merkle tree over recent events and publish the root to an external append-only transparency
log — mirroring Certificate Transparency (RFC 6962)** `[S19][S23]`. The audit must capture *not just
what the AI did, but what information was available, what reasoning was applied, and who was
responsible* `[S19]`.

> **Beyond the brief — close the last 5%.** Borjie's `audit-trail/hash-chain.ts` +
> `audit-hash-chain.ts` are already hash-chained and append-only (a hard rule in CLAUDE.md). The
> frontier delta is **external anchoring**: publish the Merkle root to a third-party CT-style log so the
> chain is tamper-evident *even against Borjie itself*. For a firm that suspends licences and moves
> money autonomously, *regulator-verifiable, self-incriminating-proof* attestation is the difference
> between "trust us" and "verify us." The brief produces tabs; this produces **court-admissible
> provenance**. Borjie's `ai-bom-attest.yml` (Sigstore-signed AI Bill of Materials) shows the
> signing infra is already in-house.

## B.7 Constitutional governance — hard constraints agents can't amend + separation of powers

Once many agents act, you need a *constitution*, not a prompt. **AgentCity (2026)** breaks the agent
collective's *"Logic Monopoly"* over plan/execute/evaluate via **separation of powers**:
**Legislation (agents propose/deliberate/vote rules as contracts) · Execution (deterministic software:
Orchestrate→Invoke→Commit→Guard→Verify→Gate→Record) · Adjudication (humans, via an inherited ownership
chain so sanctions/rewards flow to the responsible human)** `[S5]`. It uses a **three-tier contract
hierarchy: foundational (human-authored, agent-immutable hard constraints) → meta (procedural) →
operational (agent-legislated)**, with **automated on-chain constitutional review** checking *budget
bounds, capability feasibility, separation compliance* before any rule takes effect `[S5]`. Its thesis
— **alignment-through-accountability: individual alignment (each agent ↔ its owner) produces collective
alignment without top-down rules** `[S5]` — and it includes an **Override Panel (freeze/unfreeze,
amend, sanction)**, reputation EMA, and coordination-detection via **Kendall-τ on voting** `[S5]`.
(Status: pre-registered, 23 falsifiable hypotheses, 50→1,000-agent experiments *in progress* —
**UNVERIFIED** results `[S5]`.)

**Self-governance / public input.** Anthropic's **Collective Constitutional AI** sourced a constitution
from **~1,000 Americans via Polis (1,127 statements, 38,252 votes)**; the public constitution had
*~50% overlap* with Anthropic's, leaned toward *promoting desired behavior rather than avoiding
undesired*, and the resulting model showed **lower bias across all nine social dimensions while matching
helpfulness/harmlessness** `[S4][S10]`. Key honest caveat: *"Constitutional AI training is more
complicated than we thought"* — translating statements to principles is full of *subjective judgment
calls* `[S10]`. (Foundational **Constitutional AI** = RLAIF: a model critiques/revises its own outputs
against a written constitution `[S4]`.)

> **Beyond the brief.** The brief has *one* knob (gated/AUTO) and *one* authority (the owner). A
> constitutional design gives Borjie: **(1)** an immutable foundational layer — Borjie's CLAUDE.md hard
> rules (money via `LedgerService.post()`, RLS force-on, fail-closed kill-switch, evidence-required,
> migrations immutable) become the **agent-immutable constitution** the kernel enforces, not docs;
> **(2)** an owner-legislated operational layer (the estate's own policies, deliberated and versioned);
> **(3)** separation of powers so the agent that *proposes* a licence suspension is structurally not
> the one that *executes* it (Borjie's `four-eye-approval.ts` is the seed); **(4)** accountability
> chains so every autonomous act traces to a responsible human; and **(5)** owner-sourced constitution
> updates via a Polis-style deliberation when the owner has a family office / multiple principals. This
> is *governance as code*, the thing a single gated-AUTO MD fundamentally lacks.

## B.8 Eval-gate the *deployment*, not just the action — tripwires before AUTO

The promotion-to-AUTO decision should be an **eval gate against pre-declared tripwires**, exactly how
frontier labs gate model deployment. **METR** runs **pre-deployment dangerous-capability evals** and
argues *deployment should be made conditional on results based on predefined tripwires* — extending in
2025 to **gating internal deployment** (pilot with Anthropic/Google/Meta/OpenAI, Feb 2026) `[S9]`.
Anthropic's **Responsible Scaling Policy v3.0** formalizes **Capability Thresholds → Required
Safeguards**, *proportional, iterative, exportable* risk governance, with **Frontier Safety Roadmaps**
and externally-reviewed **Recurring Risk Reports** `[S22]`. The taxonomy backbone — **Levels of
Autonomy for AI Agents** `[S22-search]` and **AURA: Agent Autonomy Risk Assessment** `[S22-search]` —
gives a principled ladder.

> **Beyond the brief.** "Ask once, then AUTO" has no *gate criteria*. METR/RSP say: a flow earns AUTO
> only after passing a **declared eval suite** (success rate, harm rate, defection-probe clean,
> simulation-veto rate, evidence-chain completeness) against **tripwires** that, if tripped *later in
> production*, **auto-demote** the flow back to gated. Promotion is **bidirectional and evidence-gated**,
> with a published roadmap — the opposite of the brief's one-way switch. Borjie's `evals/`, the
> `kernel-eval.yml` / `trajectory-eval.yml` / `red-team.yml` workflows, and `not-yet-wired.ts` are the
> gate machinery already present.

**Govern the evolving memory itself.** Because the offense moat (Part A) *writes to itself*, it needs
its own governance: the **Stability and Safety Governed Memory (SSGM)** framework catalogs the *risks,
mechanisms* of **evolving memory in LLM agents** `[S25]`, and **Zombie Agents** demonstrates *persistent
control of self-evolving agents via self-reinforcing injections* `[S25]` — i.e., a poisoned memory can
re-infect the agent forever. So memory writes get the *same* shield/eval/attestation treatment as
actions: a defected or hallucinated strategy must never enter the bank. **The two moats are one system:
the trust layer (Part B) is what makes the knowledge layer (Part A) safe to compound.**

---

## C. The unified architecture — how every action becomes compounding advantage *while* provably safe

The estate brain runs one loop per consequential action; the same loop both **bounds** it and **banks**
it:

```
            ┌─────────────────────── CONSTITUTION (B.7) ───────────────────────┐
            │  Foundational (human-authored, agent-immutable): CLAUDE.md rules  │
            │  Operational (owner-legislated, versioned, deliberated)           │
            └───────────────────────────────────────────────────────────────────┘
                                          │ binds
  user/owner ──► RETRIEVE strategies+skills+graph (A.1–A.4)  ──►  PROPOSE action
                 (per-tenant private + cross-tenant commons, A.5)        │
                                                                         ▼
                          ┌──────────── PROVABLE SAFE-SET GATE ────────────┐
                          │  VeriGuard runtime monitor   (B.1)             │
                          │  ShieldAgent LTL rule-circuit (B.2)            │
                          │  CBF / barrier over estate state (B.3)         │
                          │  Simulate k-step + critic veto (B.4)           │
                          │  Defection probe on activations (B.5)          │
                          └────────────┬───────────────────┬──────────────┘
                                   inside box           outside box
                                       │                    │
                          AUTO? ──► EXECUTE            RE-GATE (HITL) / killswitch fail-closed
                                       │                    │
                                       ▼                    ▼
                  ATTEST: hash-chain + Merkle-anchor to external CT log (B.6)
                                       │
                                       ▼
                  JUDGE (success/failure)  ──►  DISTILL strategy {title,desc,content} (A.1)
                                       │            INDUCE skill/workflow if reused (A.2)
                                       ▼            LINK into bi-temporal graph (A.3)
                  CONSOLIDATE during "sleep" (consolidation-cycle.ts)  +  ACE delta-update playbook (A.4)
                                       │
                  FEDERATE de-identified abstraction → cross-tenant commons under DP (A.5)
                                       ▼
                  EVAL-GATE: tripwire check → promote/demote AUTO (B.8); SSGM-govern the memory write (B.8)
```

The payoff: **every gated approval is simultaneously (i) a bounded, attested, regulator-verifiable act
and (ii) a deposit into a compounding strategy/skill/graph asset that — via federation — lifts every
estate.** Autonomy and safety stop being a trade-off; the safety layer is *what licenses* the knowledge
layer to compound.

## D. Concrete Borjie wiring map (frontier idea → file to upgrade)

| Frontier idea | Source | Borjie file/package to upgrade |
|---|---|---|
| Strategy-level memory (distill success+failure) | ReasoningBank `[S6]` | `central-intelligence/.../memory/episodic-amem.ts`, `tacit-knowledge/extractor`, `consolidation/consolidation-cycle.ts` |
| Reusable workflows/skills | AWM `[S8]`, Voyager `[S15]` | new skill-library in `central-intelligence/.../memory/`; `tab-as-loop/` as skill executor |
| Self-linking Zettelkasten notes | A-MEM `[S21]` | `episodic-amem.ts` (add dynamic linking + context evolution) |
| Bi-temporal estate graph | Zep/Graphiti `[S13][S14]` | `packages/database` graph tables w/ `(t_valid,t_invalid)`; `hybrid-retrieval.ts` |
| Living playbook, delta updates | ACE `[S20]` | junior prompts in `packages/ai-copilot/src/juniors/*` (versioned, diffed) |
| Two-tier commons vs private | data network effects `[S18]` | `borjie-corpus-ingest.ts` (`tenant_id=NULL`) + per-tenant memory |
| Federate abstractions, not data | federated learning + DP `[S24]` | new federation worker; guarded by `inviolable.ts` cross-tenant gate |
| Verified-policy runtime monitor | VeriGuard `[S2]` | `central-intelligence/.../kernel/kernel.ts` action gate |
| Regulations → LTL rule-circuits | ShieldAgent `[S3]` | upgrade `inviolable.ts` + `policy-gate.ts`; HIGH-risk prefixes |
| Barrier/safe-set over estate state | CBF `[S16]`, shielding `[S26]` | tripwires tied to `LedgerService.post()`, NOI threshold |
| Simulate + critic veto | world-model rollout `[S17]` | `kernel/counter-model/`, `kernel/critics/` |
| Defection probe inline | Sleeper Agents `[S11][S12]` | `packages/sae-probe/` → inline on AUTO acts; `defection-probe.yml` |
| Merkle-anchor to external CT log | tamper-evident attestation `[S19][S23]` | `audit-trail/hash-chain.ts` + `ai-bom-attest.yml` (Sigstore) |
| Constitutional separation of powers | AgentCity `[S5]` | `four-eye-approval.ts`, `inviolable.ts`, `killswitch.ts`, `policy-gate.ts` |
| Owner-sourced constitution | Collective CAI `[S4][S10]` | constitution config + Polis-style owner deliberation |
| Eval-gate promotion w/ tripwires | METR/RSP `[S9][S22]` | `evals/`, `kernel-eval.yml`, `trajectory-eval.yml`, `not-yet-wired.ts` |
| Govern the evolving memory | SSGM / Zombie Agents `[S25]` | memory-write shield reusing B.1–B.6 on every write |

## E. Provocations (the uncomfortable truths the brief avoids)

1. **"Gated until AUTO" measures the flow and learns nothing.** N safe runs are *training data for a
   transferable strategy bank* (ReasoningBank `[S6]`). If you don't distill them, you paid for N runs
   and kept zero compounding capital. Promotion-to-AUTO and strategy-distillation must be the **same
   event**.
2. **A spawned tab is a disposable artifact; the procedure inside it is the asset.** AWM/Voyager
   `[S8][S15]` say promote the *workflow* into a versioned skill the estate inherits. Otherwise the
   100th royalty reconciliation costs the same as the 1st — no operating leverage, no moat.
3. **Behavioral good-conduct is *provably* insufficient for trust.** Sleeper Agents proved deception
   survives all standard safety training `[S11]`. An AUTO flow with no inline defection probe is a
   latent backdoor with a green light. Borjie has `sae-probe/` — *use it inline*, not just nightly.
4. **"We'll re-gate HIGH-risk actions" is weaker than a barrier function.** A CBF/verified-policy makes
   the owner's mandate a *region the brain cannot leave* `[S2][S16]` — categorically stronger than a
   human re-approving while tired.
5. **Your audit chain should be verifiable against *you*.** Merkle-anchor to an external CT-style log
   `[S19][S23]`; "trust our append-only DB" is not regulator-grade for a firm that suspends licences
   and moves money autonomously.
6. **The real moat is federated abstraction across tenants.** Sharing *de-identified strategies* (never
   data) under DP `[S24]` makes every estate's brain lift every other's — a two-sided network effect a
   single-tenant gated-AUTO MD can never produce, *and* it stays inside Borjie's RLS + cross-tenant
   refusal gate.
7. **Self-improving memory is an attack surface.** Zombie Agents `[S25]`: a poisoned memory re-infects
   forever. The offense moat (Part A) is only safe *because of* the defense moat (Part B) — they are one
   system, not two features.

---

## Sources

| Key | Title | URL | Status |
|---|---|---|---|
| S1 | Memory in the Age of AI Agents (survey / circular-dependency warning) | https://arxiviq.substack.com/p/memory-in-the-age-of-ai-agents · paper list: https://github.com/Shichun-Liu/Agent-Memory-Paper-List | search |
| S2 | VeriGuard: Enhancing LLM Agent Safety via Verified Code Generation | https://arxiv.org/abs/2510.05156 | fetched |
| S2-search | Watchdogs and Oracles: Runtime Verification Meets LLMs for Autonomous Systems | https://arxiv.org/pdf/2511.14435 | search |
| S3 | ShieldAgent: Shielding Agents via Verifiable Safety Policy Reasoning | https://arxiv.org/html/2503.22738v1 | fetched |
| S3-search | ProbGuard: Probabilistic Runtime Monitoring for LLM Agent Safety | https://arxiv.org/pdf/2508.00500 | search |
| S4 | Collective Constitutional AI (Anthropic research page) | https://www.anthropic.com/research/collective-constitutional-ai-aligning-a-language-model-with-public-input | fetched |
| S5 | AgentCity: Constitutional Governance for Autonomous Agent Economies via Separation of Power | https://arxiv.org/html/2604.07007v1 | fetched (results UNVERIFIED — experiments in progress) |
| S6 | ReasoningBank: Scaling Agent Self-Evolving with Reasoning Memory | https://arxiv.org/abs/2509.25140 | fetched |
| S7 | ReasoningBank (Google AI / MarkTechPost coverage) | https://www.marktechpost.com/2025/10/01/google-ai-proposes-reasoningbank-a-strategy-level-i-agent-memory-framework-that-makes-llm-agents-self-evolve-at-test-time/ | search |
| S8 | Agent Workflow Memory (CMU/MIT, ICML 2025) | https://arxiv.org/abs/2409.07429 | search |
| S9 | METR — AI models can be dangerous before public deployment / tripwire gating | https://metr.org/blog/2025-01-17-ai-models-dangerous-before-public-deployment/ | search |
| S10 | Collective Constitutional AI (Anthropic PDF / FAccT 2024) | https://www-cdn.anthropic.com/b43359be43cabdbe3a8ffd60ea8a68acf25cb22e/Anthropic_CollectiveConstitutionalAI.pdf · https://facctconference.org/static/papers24/facct24-94.pdf | search |
| S11 | Sleeper Agents: Training Deceptive LLMs that Persist Through Safety Training | https://arxiv.org/abs/2401.05566 · https://www.anthropic.com/research/sleeper-agents-training-deceptive-llms-that-persist-through-safety-training | search |
| S12 | Defection probes (Anthropic follow-up — linear probes on activations) | https://www.anthropic.com/research/sleeper-agents-training-deceptive-llms-that-persist-through-safety-training | search |
| S13 | Zep: A Temporal Knowledge Graph Architecture for Agent Memory | https://arxiv.org/abs/2501.13956 | search |
| S14 | Graphiti: Knowledge Graph Memory for an Agentic World (bi-temporal) | https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/ · https://github.com/getzep/graphiti | search |
| S15 | Voyager: An Open-Ended Embodied Agent with LLMs (skill library) | https://arxiv.org/abs/2305.16291 | search |
| S16 | Control Barrier Functions / neural certificates (PAC bounds; LLM-agentic barrier synthesis) | https://arxiv.org/html/2507.13871v1 · https://www.mdpi.com/2227-7390/14/3/516 · https://arxiv.org/html/2602.20102v1 | search |
| S17 | World-model rollout + simulation-critic veto; sandbox eval; foresight-failure caveat | https://arxiv.org/html/2601.03905v1 · https://arxiv.org/pdf/2602.00785 · https://arxiv.org/pdf/2510.11892 | search |
| S18 | Data network effects as a compounding/irreversible AI moat | https://17000credits.substack.com/p/data-network-effects-vs-the-innovators · https://www.iomovo.io/blog/strategic-moat | search |
| S19 | Tamper-evident audit trail for AI agents (Merkle, CT-style) | https://nono.sh/blog/secure-agent-audit · https://veritaschain.org/blog/posts/2026-01-13-case-for-cryptographic-accountability/ | search |
| S20 | Agentic Context Engineering (ACE): Evolving Contexts for Self-Improving LMs | https://arxiv.org/pdf/2510.04618 | fetched |
| S21 | A-MEM: Agentic Memory for LLM Agents (Zettelkasten, NeurIPS 2025) | https://arxiv.org/abs/2502.12110 | search |
| S22 | Anthropic Responsible Scaling Policy v3.0 (Capability Thresholds → Safeguards) | https://www.anthropic.com/responsible-scaling-policy/rsp-v3-0 · https://www.anthropic.com/news/responsible-scaling-policy-v3 | search |
| S22-search | Levels of Autonomy for AI Agents; AURA: Agent Autonomy Risk Assessment | https://arxiv.org/pdf/2506.12469 · https://arxiv.org/pdf/2510.15739 | search |
| S23 | Tamper-evident audit trails / SIEM; AI agent compliance & governance | https://www.kiteworks.com/regulatory-compliance/ai-agent-audit-trail-siem-integration/ · https://galileo.ai/blog/ai-agent-compliance-governance-audit-trails-risk-management | search |
| S24 | Federated learning + differential privacy / secure aggregation (cross-silo); Federated RL | https://arxiv.org/html/2504.17703v3 · https://arxiv.org/pdf/2408.08904 | search |
| S25 | SSGM: Governing Evolving Memory in LLM Agents; Zombie Agents (memory poisoning persistence) | https://arxiv.org/pdf/2603.11768 · https://arxiv.org/pdf/2602.15654 | search |
| S26 | Safe RL via Shielding (orders-of-magnitude fewer violations) | https://www.emergentmind.com/topics/safe-reinforcement-learning-via-shielding · https://arxiv.org/pdf/2304.06281 | search |

> **Verification note.** S2, S3, S4, S5, S6, S20 were fetched in full (mechanism/numbers quoted from
> the fetched text). All others are grounded in WebSearch result summaries (titles + landing snippets);
> their *specific* numeric claims should be treated as **UNVERIFIED-until-fetched** before being quoted
> in a customer/regulator artifact. AgentCity's experimental *results* are explicitly UNVERIFIED — the
> paper states experiments are in progress.
