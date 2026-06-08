# Frontier Autonomy: Beyond Binary Gating

**Author:** Research subagent (frontier autonomy survey)
**Date:** 2026-06-08
**Audience:** Borjie brain-layer architects (Mr. Mwikila + 12-agent kernel + junior agents)
**Scope:** Decision-theoretic, reversibility-aware, confidence/risk-adaptive, pre-authorized,
counterfactually self-checking, and dynamically re-gated autonomy — the models that make an
autonomous mining/real-estate estate brain *both* safer *and* more autonomous than the naive
"gated-until-the-user-flips-it-to-auto, then spawn tabs" switch.

---

## 0. The brief, and why it is a strawman

The naive model Borjie has today (and the one most agent products ship) is a **per-flow binary
switch**: every workflow/tool is either "gated" (ask the human before every action) or "auto"
(act without asking), and the only product surface is spawning a tab/notification when the agent
does something. This is a **one-dimensional, static, content-blind** control. It is wrong on three
axes simultaneously:

1. **It ignores the action.** A `SELECT` query and an irreversible `wire $400k of royalty to a
   counterparty` get the same treatment under one switch. The switch is set per *flow*, not per
   *act*, so it must be set to the most-dangerous-act level — which means a flow with one
   irreversible step gates *all* its cheap, reversible steps. Maximum friction, minimum autonomy.
2. **It ignores confidence.** The agent gates the same whether it is 99% sure or 51% sure. A
   calibrated agent that knows it is uncertain should ask *more*; one that is well-calibrated and
   confident on a reversible act should ask *less*. The switch can't express this.
3. **It is static.** Once "auto" is flipped, it stays auto even when the situation shifts
   (market regime change, a new counterparty, the agent leaving its training distribution, a
   kill-switch-adjacent context). The switch has no concept of "re-gate because the world changed."

The frontier replaces the switch with a **continuous, multi-factor, learned, revocable policy**:
autonomy as a *function* of `f(calibrated_confidence, consequence, reversibility, mandate,
situation)` evaluated **per action**, with a standing human-signed mandate setting the envelope,
counterfactual self-checks as an internal gate, and dynamic promotion/demotion of trust. Every
section below cites the actual frontier work and states precisely how it transcends the switch.

The punchline, proven repeatedly below: **decoupling autonomy from a single dial makes the system
simultaneously safer (the irreversible/high-blast/low-confidence tail is always gated, even inside
an "auto" flow) and more autonomous (the vast reversible/high-confidence body of work never
interrupts the human).** Friction and risk are no longer the same dial.

---

## 1. Value-of-Information: decision-theoretic "ask vs. act"

**The frontier idea.** Don't ask "is this flow gated?" Ask, *per decision point*: "Is the
**expected utility gain** from interrupting the human greater than the **cognitive cost** of the
interruption?" Interrupt **iff** VoI(question) > cost(interruption). This is classic Bayesian
decision theory (value of information) finally operationalized for human-agent communication.

- **Value of Information: A Framework for Human-Agent Communication (2026).** Formalizes ask-vs-act
  as: agents "solicit information when the expected value of resolving uncertainty exceeds the cost
  of interrupting the human." It dynamically weighs expected utility gain against user cognitive
  cost, and **matches or beats every manually-tuned baseline** across 20-Questions, medical
  diagnosis, flight booking, and e-commerce. URL: https://arxiv.org/pdf/2601.06407 (FETCHED)
- **Asking Before Acting: Gather Information in Embodied Decision Making with LLMs (2023).** The
  seminal embodied result: an LLM agent that *gathers information before acting* under uncertainty
  reduces catastrophic acting-blind failures vs. acting immediately. URL:
  https://arxiv.org/pdf/2305.15695 (search-summarized; PDF did not parse — partially UNVERIFIED)
- **Decision-Centric Design for LLM Systems (2026).** Introduces an explicit **decision layer**
  that governs *when to act, when to acquire information, and when to revise* — within-task
  control, not just prompting. URL: https://arxiv.org/pdf/2604.00414 (search-summarized — UNVERIFIED)
- **BED-LLM: Bayesian Experimental Design for information gathering (2025).** Picks the *single
  most informative* question to ask, i.e. maximizes expected information gain per interruption.
  URL: https://arxiv.org/pdf/2508.21184 (search-summarized — UNVERIFIED)

**Beyond the brief.** The switch interrupts on a *flow* label; VoI interrupts on a *computed
expected value* per decision. This means Borjie's junior agents can ask the owner *exactly the
questions worth asking* (high VoI: "this offtake counterparty has no KYC history — confirm
identity?") and silently proceed on the rest. The brief's switch can only choose "ask about
everything in this flow" or "ask about nothing" — it has no notion of *which question is worth the
owner's attention*. VoI turns "should I spawn a tab?" into a utility calculation, not a flag.

---

## 2. Reversibility-based autonomy: act freely on the reversible, gate the irreversible

**The frontier idea.** Gating should key on **reversibility and blast radius**, not on a flow
label. Read-only and cheaply-reversible acts run freely; irreversible/high-blast acts gate. And
crucially, you can **manufacture reversibility** — interpose a staging layer that converts an
irreversible commit into a reversible draft, shrinking the set of things that *need* gating.

- **Autonomy and Agency in Agentic AI: Architectural Tactics for Regulated Contexts (2026).**
  Defines a **five-level agency scale by reversibility**: read-only (L3) → "external writes with
  low rollback cost" (L4) → "external writes with costly undo" (L5). Its key tactic, **Write
  Staging**, "interposes a draft or pending layer between an agent action and its authoritative
  commit," explicitly **converting an L5 (irreversible) action into an L4 (reversible) one** until
  promotion. Also defines **Tool Fencing** that works "independent of the model's behaviour" — the
  *tool* rejects the act before any external effect, so safety doesn't depend on the model
  behaving. URL: https://arxiv.org/html/2605.12105v1 (FETCHED)
- **AI Agent Systems: Architectures, Applications, and Evaluation (2026).** States the governing
  principle directly: *"a large-blast-radius reversible action (restarting all pods) is still
  higher risk than a small-blast-radius irreversible action (deleting a single test resource)"* —
  i.e. **reversibility × blast-radius is a 2-D risk surface**, not one axis. Introduces the
  **Irreversibility Budget**: "a quantified limit on cumulative irreversible consequences before
  mandatory human re-authorization," and least-privilege defaults (read-only unless the op is
  "narrow and reversible"). URL: https://arxiv.org/html/2601.01743v1 (search-summarized — UNVERIFIED)
- **When to Ask for Help: Proactive Interventions in Autonomous RL (2022).** The RL roots:
  agents learn to **detect irreversible states** ("a robot arm has pushed an object off the
  table") and **proactively request help** *before* entering them — better sample- and
  intervention-efficiency than constant monitoring. Irreversibility is the trigger, not a flag.
  URL: https://arxiv.org/abs/2210.10765 (FETCHED via abstract page)

**Beyond the brief.** The switch can only gate a whole flow. Reversibility-based autonomy gates the
*one irreversible step* and lets the other twenty reversible steps fly — and **Write Staging
shrinks even that one** by making the commit reversible (draft royalty payment → owner promotes →
ledger post). For Borjie specifically: every money-path write through `LedgerService.post()` is L5;
staging it as a *pending* ledger entry that the owner promotes turns the single most dangerous act
into a reviewable L4 draft. The **Irreversibility Budget** gives Mr. Mwikila a principled "you've
spent your irreversible-action allowance for this session, re-authorize" — something a binary
switch cannot express at all. This is *strictly more autonomous* (reversible body runs free) AND
*strictly safer* (irreversible tail always gated, with a hard cumulative cap).

---

## 3. Confidence × consequence × reversibility-adaptive delegation

**The frontier idea.** Autonomy is a **continuous function** of *calibrated* confidence,
consequence, and reversibility — not a threshold on one variable. And the confidence input must be
**calibrated** (stated confidence = empirical accuracy), because raw LLM confidence is
systematically overconfident.

- **AURA: An Agent Autonomy Risk Assessment Framework (2025).** Computes a normalized risk score
  γ_norm ∈ [0,100] aggregating weighted risk across dimensions, then maps to action:
  **0–30 → auto-approve · 30–60 → graded mitigations · 60–100 → escalate to human.** This is the
  literal "autonomy as a function of risk score," not a switch. URL:
  https://arxiv.org/html/2510.15739 (FETCHED)
- **Learning Conformal Abstention Policies for Adaptive Risk Management (CAP, 2025).** Combines RL
  with **conformal prediction** to give *statistical coverage guarantees* on the
  predict/predict-set/**abstain** decision. Improves hallucination detection +22.19% and cuts
  calibration error **70–85%**. This is the rigorous machinery for "abstain and defer to a human
  when uncertainty exceeds a user-defined risk tolerance" — with a *guarantee*, not a vibe. URL:
  https://arxiv.org/html/2502.06884v1 (search-summarized — UNVERIFIED)
- **Agentic Confidence Calibration (2026).** Directly targets the failure mode that makes naive
  confidence-gating dangerous: agents are "convincingly wrong." Calibration (confidence matches
  accuracy) and discrimination (confidence separates right from wrong) are **independent
  properties** — you need both before confidence can drive delegation. URL:
  https://arxiv.org/pdf/2601.15778 (search-summarized — UNVERIFIED)
- **Overconfidence in LLM-as-a-Judge (2025).** Documents systematic overconfidence and a
  confidence-driven correction — evidence that you cannot trust raw self-reported probabilities as
  the gating signal. URL: https://arxiv.org/html/2508.06225v2 (search-summarized — UNVERIFIED)
- **Galileo / Illumination Works — Adaptive HITL (industry, 2025).** Reports the counterintuitive
  UX result: users of **risk-contingent autonomy** agents *"reported greater perceived control...
  despite technically having less direct oversight."* Adaptive gating *feels* safer to the human
  too. URL: https://galileo.ai/blog/human-in-the-loop-agent-oversight (search-summarized — UNVERIFIED)

**Beyond the brief.** The switch is a 1-bit gate on a flow. This is a **3-input continuous control
with a statistical guarantee**: `autonomy = g(calibrated_confidence, consequence, reversibility)`.
Borjie's `policy-gate.ts` already has consequence tiers (sovereign/kill_switch/four_eye); the
frontier move is to (a) **calibrate** each junior agent's confidence via conformal prediction so
"I'm 90% sure" is *true* 90% of the time, and (b) make the gate a *surface* over all three axes so a
high-confidence-calibrated-reversible act runs auto even in a "gated" flow, while a
low-confidence-irreversible-high-consequence act gates even in an "auto" flow. The switch can't
distinguish these; the function does.

---

## 4. Predictive pre-authorization & standing "trust contracts"/mandates

**The frontier idea.** Replace *per-operation* human approval with a **once-signed mandate** that
declares the agent's identity, boundaries, escalation triggers, and temporal validity. The agent
then acts autonomously *within the envelope* and only escalates on genuinely novel/boundary cases.
The human's job shifts from "approve every action" to "define the policy once, revoke instantly."

- **AITH: A Post-Quantum Continuous Delegation Protocol (2026).** The flagship. *"A human signs a
  Delegation Certificate once, specifying the AI agent's identity, boundaries, escalation triggers,
  and temporal validity."* A deterministic Boundary Engine runs 6 checks (validity, level,
  constraints, rate limits, **anomaly vs. behavioral baseline**, escalation) at **0.21 μs / 4.7M
  ops/sec**. Escalation triggers are typed: **threshold** (approaching a limit), **novelty**
  (unseen operation), **composition** (a *sequence* that collectively exceeds policy even if each
  step is fine). Revocation propagates to all systems **in <1 second**. Three-tier hash-chained
  audit (op decisions / human counter-signatures / execution records). URL:
  https://arxiv.org/html/2604.07695v1 (FETCHED)
- **Before the Tool Call: Deterministic Pre-Action Authorization (Open Agent Passport, 2026).**
  Synchronously intercepts *every* tool call before execution, evaluates against declarative policy
  (spend limits, merchant allowlists, jurisdiction), returns **ALLOW / DENY / ESCALATE** with a
  signed receipt — *"Same inputs, same decision. No sampling, no temperature."* Empirically: social
  engineering hit **74.6% success under permissive policy but 0% across 879 attempts under
  restrictive policy** — i.e. the *policy* overrides the *model's* judgment when scoped. Median 53ms,
  p99 <77ms. URL: https://arxiv.org/html/2603.20953v1 (FETCHED)
- **Intelligent AI Delegation (2026).** For *"routine low-stakes tasks (low criticality, high
  reversibility), agents can be granted default standing permissions"* derived from verifiable
  attributes (org membership, certifications, reputation score); high-stakes domains stay
  risk-adaptive and HITL-gated. URL: https://arxiv.org/html/2602.11865v1 (search-summarized — UNVERIFIED)
- **Secure Autonomous Agent Payments: Pre-signed Intent Mandates (2025).** Users *"pre-authorize a
  specific task/transaction by signing a structured intent mandate ahead of time"*; a contract
  verifies the signature and that details *do not exceed constraints* before proceeding. URL:
  https://arxiv.org/html/2511.15712v1 (search-summarized — UNVERIFIED)

**Beyond the brief.** The switch is a stateless on/off the user toggles in the UI. A **mandate** is a
**cryptographically-signed, revocable, time-bounded, auditable policy object** with typed escalation
triggers and *composition* awareness (catches "20 small wires that sum to a large unauthorized
transfer" — the switch sees 20 individually-allowed acts). For Borjie this *is* the productized form
of `four_eye`/`policy_rollout`: the owner signs "Mr. Mwikila may settle offtake contracts up to TZS X
with KYC-verified counterparties in jurisdiction TZ for the next 30 days; escalate on novelty,
threshold, or composition; revoke globally in <1s." That is a **trust contract**, not a tab.

---

## 5. Counterfactual self-checking: "what if I'm wrong?" as a gate

**The frontier idea.** Before committing, the agent generates a **counterfactual critique of its own
reasoning** — actively hypothesizing how it could be wrong and what the downside would be — and uses
that as an *internal* gate that either proceeds or triggers reconsideration/escalation. This is
distinct from (and stronger than) summarizing past failures.

- **Counterfactual Self-Questioning for Stable Policy Optimization (2026).** The model "generates
  alternative perspectives that challenge its current output," and the critique "actively
  influences whether the model proceeds with or revises its response" — an **internal validation
  gate**. Beats historical-failure review because it is *proactive* (hypothesizes failures in the
  moment), has *broader coverage* (explores untried paths), and is *integrated* into the decision
  loop rather than appended after. URL: https://arxiv.org/pdf/2601.00885 (FETCHED)
- **Human-Robot Red Teaming for Safety-Aware Reasoning (2025).** Bakes adversarial "how could this
  go wrong?" reasoning into the agent's planning so it red-teams *its own plan* before acting. URL:
  https://arxiv.org/pdf/2508.01129 (search-summarized — UNVERIFIED)
- **Agentic AI for Commercial Insurance Underwriting with Adversarial Self-Critique (2026).** A
  production-shaped domain (underwriting) where an adversarial self-critic challenges the agent's
  decision before commit — directly analogous to gating an irreversible financial decision. URL:
  https://arxiv.org/pdf/2602.13213 (search-summarized — UNVERIFIED)
- **Risks of AI Scientists: Prioritizing Safeguarding Over Autonomy (2024).** Argues for
  self-checking safeguards as a *precondition* of autonomy in high-consequence domains. URL:
  https://arxiv.org/pdf/2402.04247 (search-summarized — UNVERIFIED)

**Beyond the brief.** The switch never asks "what's the downside if I'm wrong?" — it just executes
whatever the flow is set to. Counterfactual self-checking makes the *agent itself* compute the
downside and **gate on it**: if the counterfactual ("if this metallurgy recovery estimate is wrong,
the owner over-commits TZS X to a plant upgrade") is severe and the act is irreversible, the agent
escalates *even when the flow is set to auto*. This is the perfect partner to Borjie's
**evidence-required** rule (every junior cites ≥1 `evidence_id`): the counterfactual check is "what
if my evidence is wrong?", and the Auditor Agent already rejects empty evidence chains. Wire the
counterfactual downside into the gate and you get a self-gating agent that escalates on *its own
recognized uncertainty about consequence*, not on a static label.

---

## 6. Earned / graduated trust with statistical promotion

**The frontier idea.** Autonomy is **not granted up front — it is earned** through demonstrated
reliability, and can be **demoted** when reliability drops. Trust is a *measured, dynamic* quantity,
and the agent's autonomy level is promoted/demoted as a function of its track record.

- **Levels of Autonomy for AI Agents (working paper, 2025).** The canonical ladder:
  **L1 Operator → L2 Collaborator → L3 Consultant → L4 Approver → L5 Observer** (user role
  shifts from director to emergency-stop-only). Crucially **autonomy is decoupled from capability**
  — "a deliberate design decision," so a powerful model can be pinned low and a simple one run high
  in a narrow domain. Explicitly rejects binary: *"more autonomy does not simply mean a better
  agent."* URL: https://arxiv.org/html/2506.12469v1 (FETCHED)
- **Anthropic — Measuring AI Agent Autonomy in Practice (2025).** Real deployment data showing
  trust is **earned over time**: ~20% of *new* Claude Code users enable full auto-approve vs. **>40%
  of experienced** users — "a steady accumulation of trust." And the safety insight: experienced
  users *"auto-approve more frequently but interrupt more often"* (5%→9% of turns) — they grant more
  autonomy *while maintaining active monitoring*. Anthropic warns that prescriptive
  approve-every-action mandates "create friction without necessarily producing safety benefits."
  Also: Claude "asks for clarification more than twice as often as humans interrupt it" — the agent
  is its own first gate. URL: https://www.anthropic.com/news/measuring-agent-autonomy (FETCHED)
- **Trust-Aware Assistance Seeking in Human-Supervised Autonomy (2024) / Trust-Preserved Shared
  Autonomy via Bayesian Relational Event Modeling (2023).** The HRI tradition: a *measured* trust
  state drives how much help the robot seeks and how much autonomy it takes, "seamlessly adjusting
  its autonomy level" to optimize team performance. URLs: https://arxiv.org/html/2410.20496 ,
  https://arxiv.org/pdf/2311.02009 (search-summarized — UNVERIFIED)

**Beyond the brief.** The switch is *granted*, not *earned* — the user flips it and it stays flipped
regardless of the agent's track record. Graduated/statistical trust means each Borjie junior agent
*climbs* the L1→L5 ladder per task-class as it accrues a verified success record (e.g. the
FX-treasury agent earns L4 on hedge recommendations after N audited-correct calls), and is
**auto-demoted** when its calibrated accuracy on that task-class drops. Anthropic's data is the
empirical proof this is how trust *actually* forms in production — smoothly, with continued
monitoring — and the switch models none of it. Promotion can be made *statistical* (promote only when
the lower confidence bound on success rate clears the threshold), giving the owner a defensible,
auditable "why does Mr. Mwikila now settle offtakes autonomously?" answer.

---

## 7. Dynamic re-gating when the situation shifts

**The frontier idea.** Autonomy granted is **not autonomy forever**. When the situation changes —
distribution shift, novel counterparty, market regime change, anomaly vs. baseline, approaching a
kill-switch-adjacent context — the system **demotes autonomy and re-gates automatically**, then
re-promotes when conditions normalize.

- **AITH (again) — anomaly & composition escalation.** Its Boundary Engine re-gates on **anomaly
  detection vs. a behavioral baseline** and on **composition** (a sequence that collectively
  breaches policy) — i.e. it re-gates when *behavior drifts*, not just when a static rule fires.
  URL: https://arxiv.org/html/2604.07695v1 (FETCHED)
- **Formulating Dynamic Agents' Operational State via Situation Awareness Assessment.** Proposes a
  Situation-Awareness module that places the agent into one of four operational states —
  **proceed / halt / block / terminate** — recomputed from current performance/context. That is
  literal dynamic re-gating. URL:
  https://link.springer.com/chapter/10.1007/978-3-319-11218-3_49 (search-summarized — UNVERIFIED)
- **A Layered Adjustable Autonomy Approach for Dynamic Autonomy Distribution.** Distributes
  autonomy across layers and *redistributes* it as conditions change — the architecture for
  sliding the autonomy level at runtime. URL: ResearchGate publication 279124245 (search-summarized
  — UNVERIFIED)
- **Entropy Alone is Insufficient for Safe Selective Prediction in LLMs (2026).** A caution for the
  re-gating *signal*: a single uncertainty proxy (entropy) is not enough to decide when to abstain —
  re-gating must fuse multiple signals. URL: https://arxiv.org/pdf/2603.21172 (search-summarized —
  UNVERIFIED)

**Beyond the brief.** The switch, once set to auto, is *blind to the world changing*. Dynamic
re-gating means Borjie's "auto" is *conditional and live*: if the offtake counterparty is new
(novelty), if the TZS/USD rate gaps past a threshold (regime shift / the 27-Mar USD-cliff context),
if the junior agent's reasoning trace looks anomalous vs. its baseline, or if the act drifts toward a
HIGH-risk policy prefix (sovereign/kill_switch) — the brain **auto-demotes to "approver" and
re-gates that act**, transparently, then re-promotes when normal. This is the mechanism that keeps
"earned trust" honest: trust is *contextual*, and the context is re-evaluated every action. The
switch cannot revoke itself; the policy can.

---

## 8. Synthesis — the unified frontier control for Mr. Mwikila

The seven threads compose into **one** control object, evaluated **per action**, that subsumes and
dominates the binary switch:

```
decision(action, agent, context) =
  mandate_check(action)                       # §4 standing trust contract: in-envelope? typed escalation?
    └─ if out-of-envelope → ESCALATE (signed)
  risk = f(                                   # §3 continuous, per-action
        calibrated_confidence(agent, action), #     §3 conformal-calibrated, not raw
        consequence(action),                  #     §3/§2 blast radius
        reversibility(action))                #     §2 read/low-undo/costly-undo (after Write-Staging)
  counterfactual = "if I am wrong, downside?" # §5 self-check gate on the wrong-case downside
  voi = ExpectedUtilityGain(ask) - CogCost    # §1 only interrupt the owner when it's worth it
  autonomy_level = trust_ladder(agent, task)  # §6 EARNED L1..L5, statistically promoted/demoted
  if situation_shift(context): demote()       # §7 distribution shift / novelty / anomaly → re-gate
  → ALLOW (auto) | STAGE (reversible draft) | ESCALATE (ask, with the highest-VoI question)
```

This is **safer than the switch** because the irreversible / high-blast / low-calibrated-confidence /
out-of-mandate / situation-shifted / high-counterfactual-downside tail is *always* gated — even
inside an "auto" flow, and even after trust is earned. It is **more autonomous than the switch**
because the enormous body of reversible, high-confidence, in-mandate, stable-situation work runs
*without interruption*, Write-Staging *manufactures* reversibility to shrink the gated set further,
and the owner is interrupted only with the *single most valuable question*. **Friction and risk
become independent dials** — the switch's fatal flaw is that they are one dial.

For Borjie concretely, this maps onto existing invariants rather than fighting them:
`policy-gate.ts` consequence tiers (§3 consequence), `LedgerService.post()` as the L5 act to be
Write-Staged (§2), `four_eye`/`policy_rollout` as productized mandates (§4), the evidence-chain +
Auditor as the substrate for counterfactual self-checks (§5), and the hash-chained AI audit trail as
the home for AITH-style three-tier responsibility logging (§4/§6). The brief's "spawn a tab" becomes
the *rarest* event — it fires only when VoI says the owner's attention is genuinely worth more than
the friction.

---

## Source ledger

**Fetched & verified (primary, content extracted):**
- Value of Information framework — https://arxiv.org/pdf/2601.06407
- Architectural Tactics for Autonomy in Regulated Contexts (Write Staging, L3–L5 reversibility) — https://arxiv.org/html/2605.12105v1
- When to Ask for Help: Proactive Interventions in Autonomous RL (irreversibility trigger) — https://arxiv.org/abs/2210.10765
- AURA: Agent Autonomy Risk Assessment (γ_norm 0–30/30–60/60–100) — https://arxiv.org/html/2510.15739
- AITH: Post-Quantum Continuous Delegation (Delegation Certificate, typed escalation, <1s revoke) — https://arxiv.org/html/2604.07695v1
- Before the Tool Call: Deterministic Pre-Action Authorization / Open Agent Passport (ALLOW/DENY/ESCALATE) — https://arxiv.org/html/2603.20953v1
- Counterfactual Self-Questioning for Stable Policy Optimization (self-critique gate) — https://arxiv.org/pdf/2601.00885
- Levels of Autonomy for AI Agents (L1 Operator → L5 Observer; autonomy ≠ capability) — https://arxiv.org/html/2506.12469v1
- Anthropic — Measuring AI Agent Autonomy in Practice (earned trust, 20%→40% auto-approve) — https://www.anthropic.com/news/measuring-agent-autonomy

**Search-summarized (credible, not individually fetched — treat as UNVERIFIED until opened):**
- Asking Before Acting (embodied info-gathering) — https://arxiv.org/pdf/2305.15695 (PDF parse failed)
- Decision-Centric Design for LLM Systems — https://arxiv.org/pdf/2604.00414
- BED-LLM (Bayesian Experimental Design) — https://arxiv.org/pdf/2508.21184
- AI Agent Systems: Architectures, Applications, Evaluation (Irreversibility Budget; blast×reversibility) — https://arxiv.org/html/2601.01743v1
- Learning Conformal Abstention Policies (CAP) — https://arxiv.org/html/2502.06884v1
- Agentic Confidence Calibration — https://arxiv.org/pdf/2601.15778
- Overconfidence in LLM-as-a-Judge — https://arxiv.org/html/2508.06225v2
- Galileo — Adaptive HITL oversight — https://galileo.ai/blog/human-in-the-loop-agent-oversight
- Intelligent AI Delegation (standing permissions for low-criticality/high-reversibility) — https://arxiv.org/html/2602.11865v1
- Secure Autonomous Agent Payments: Pre-signed Intent Mandates — https://arxiv.org/html/2511.15712v1
- Human-Robot Red Teaming for Safety-Aware Reasoning — https://arxiv.org/pdf/2508.01129
- Agentic AI for Insurance Underwriting w/ Adversarial Self-Critique — https://arxiv.org/pdf/2602.13213
- Risks of AI Scientists: Safeguarding over Autonomy — https://arxiv.org/pdf/2402.04247
- Trust-Aware Assistance Seeking in Human-Supervised Autonomy — https://arxiv.org/html/2410.20496
- Trust-Preserved Shared Autonomy (Bayesian Relational Event Modeling) — https://arxiv.org/pdf/2311.02009
- Formulating Dynamic Agents' Operational State via Situation Awareness — https://link.springer.com/chapter/10.1007/978-3-319-11218-3_49
- Entropy Alone is Insufficient for Safe Selective Prediction — https://arxiv.org/pdf/2603.21172
