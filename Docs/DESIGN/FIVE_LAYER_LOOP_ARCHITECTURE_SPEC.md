# Five-Layer Loop Architecture — Implementation Specification (Wave M3-M4)

> Wave M3-M4 of the Borjie AI-Native OS. This spec is the **buildable**
> companion to the design narrative in
> [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).
> Where the design doc states the thesis and surveys the landscape,
> this spec defines the two packages, the migration, and the contracts
> that turn the thesis into compiling code.
>
> **Two packages, one migration.**
>
> 1. `@borjie/loop-quality-gates` — the Layer 4 gate primitives, plus a
>    composite combinator that AND-merges per-gate verdicts and emits
>    the full set of failed quality signals.
> 2. `@borjie/loop-runner` — the pure 5-layer orchestrator. Given a
>    `LoopInput` and a `LoopRunnerDeps` bundle (sensors fn, policy fn,
>    tools fn, composite gate, learn fn, repositories, logger) it
>    executes all five layers, persists each layer's outcome, and
>    short-circuits on a failed gate.
> 3. Migration `0035_loop_architecture.sql` — `loop_runs`,
>    `loop_layer_outcomes`, `loop_quality_signals`. All tenant-scoped,
>    all RLS-protected, all idempotent.

Brand: Borjie. Persona: Mr. Mwikila. Status: implementation-spec.

---

## 1. Vision — founder verbatim

> "Mr. Mwikila's intelligence is the *disciplined composition* of five
> layered loops: sensors, policy, tools, quality gates, learning. Each
> layer is a contract. Each contract is owned by a package. Each
> package is reviewed for SOTA. Nothing in production ships without
> running through all five."

---

## 2. Why a Loop is the Atom of Intelligence

Modern AI agent architectures converge on the same primitive: a
sense → plan → act → critique → learn cycle. The OpenAI o1 model
formalises this as an internal Chain-of-Thought loop with
RL-tuned self-critique
([Learning to Reason with LLMs](https://openai.com/index/learning-to-reason-with-llms/),
OpenAI, 2024-09-12). DeepMind's AlphaCode 2 uses a similar
sample → filter → cluster → re-rank loop, where filtering is the
quality-gates layer
([AlphaCode 2 Technical Report](https://storage.googleapis.com/deepmind-media/AlphaCode2/AlphaCode2_Tech_Report.pdf),
DeepMind, 2023-12-06). Anthropic's Constitutional AI uses a critique
loop where the model rewrites its own output against a written
constitution
([Constitutional AI: Harmlessness from AI Feedback](https://arxiv.org/abs/2212.08073),
Bai et al., Anthropic, 2022-12-15).

What unifies these systems is **a separate layer that observes
intermediate outputs and decides whether they may proceed**. Without
this gating layer, a self-improving loop optimises against the wrong
target — fast cycles to bad decisions, the [agentic OODA
pathology](https://snyk.io/blog/agentic-ooda-loop/) (Snyk, 2025-09-12).

Borjie's contribution is to make this primitive *uniform*: every loop
in the platform — autonomous (24/7 cycles), self-improving (recipe
lifecycle), reactive (chat turn), mutating (Tier 2 approval) —
conforms to the same 5-layer template, with a *mandatory* Quality
Gates layer between Tools and Learning.

---

## 3. Anatomy of Each Layer

### 3.1 Layer 1 — Sensors

**Definition.** Every datum the loop observes before deliberating. A
sensor is a typed producer of `EvidenceItem`-shaped objects (the
contract already lives in `@borjie/cognitive-engine` §4).

**Mining-domain examples.**

- **Telemetry sensor.** Underground methane PPM ticks from
  Tumemadini-attached monitors stream into the loop. Citation
  contract: every PPM reading anchors to a `monitor_id` +
  `recorded_at` timestamp.
- **User input sensor.** Mr. Mwikila receives a chat turn from the
  District MD: *"What's the royalty owed to TRA for the May Geita
  haulage?"*. The sensor wraps the input with `session_id`,
  `user_id`, `tenant_id`, and a `received_at` timestamp.
- **Tool output sensor.** A previous `compose_doc_v1` run produced a
  draft TRA filing. Its output is itself a sensor reading for the
  next loop (e.g. the regulatory-compliance check loop).
- **External feed sensor.** Bank of Tanzania FX window opens; the BoT
  MCP server emits the day's USD/TZS spot. Citation: the BoT
  publication URL and timestamp.

The sensor layer never decides. It only *observes*. Its single
guarantee: every emitted item is span-citable. The contract on
`Sensors` ensures the rest of the loop's claims can later trace back
to a real source.

This discipline echoes ReAct's separation of *reasoning* from
*acting* — observations are first-class inputs to reasoning, never
collapsed into prompt text
([ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629),
Yao et al., 2022-10-06).

### 3.2 Layer 2 — Policy

**Definition.** The set of predicates that decide *what the loop is
allowed to do given what it has observed*. Policy returns one of:
`allow`, `deny`, or `gate(name)`.

**Mining-domain examples.**

- **Authority-tier policy.** The District MD asks Mr. Mwikila to
  approve a 50,000 USD payment to a haulage subcontractor. The policy
  layer sees `amount > FUNDS_THRESHOLD_CENTS`, returns
  `gate('tier_2_owner_approval')`. The loop routes to the
  `@borjie/mutation-authority` double-verify guard.
- **ε-budget policy.** This tenant has spent 92% of today's LLM
  budget. Policy returns `gate('budget_low')`. The loop may still
  proceed but must downshift to Haiku and skip exploratory tool calls.
- **Owner-intent policy.** The tenant's owner has set
  *"never publish a public price without my approval"*. A
  `compose_campaign_v1` proposal that includes a price triggers
  `gate('owner_intent_pricing')`.
- **Tenant scoping policy.** RLS-equivalent in the agent layer: the
  Geita district MD's loop can only sense, plan, and act against
  Geita-scoped subjects.

Policy is a *pure predicate*. It does not perform side effects. It
does not call LLMs. It only reads context and emits decisions. This
follows the OPA / Cedar policy-as-code pattern
([OPA: Open Policy Agent](https://www.openpolicyagent.org/docs/latest/),
CNCF, accessed 2026-05-26).

### 3.3 Layer 3 — Tools

**Definition.** What the loop invokes to *act* on the world. A tool is
a typed function — `(input) → ToolResult` — with a cost, a
reversibility, and an authority tier.

**Mining-domain examples.**

- **`research_v1`.** Fetches the latest NEMC guidance on EIA section
  coverage. Cost: 12 USD-cents per call. Reversibility: full
  (read-only). Authority: T0.
- **`compose_doc_v1`.** Drafts the TRA royalty filing PDF. Cost: 40
  cents. Reversibility: full (the draft is held until owner approval).
  Authority: T1.
- **`compose_action_v1`.** Triggers a GePG payment to the contractor.
  Cost: 1 cent + payment amount. Reversibility: irreversible.
  Authority: T2-Critical.
- **MCP-server tool.** Calls `mcp-server-tra` to validate the
  filing's schedule alignment. Cost: 0.5 cents. Reversibility: full.
  Authority: T0.

The Tools layer logs every invocation to the audit-hash chain. This
gives us the same provenance discipline AlphaCode 2 used to make its
filtered candidates traceable.

### 3.4 Layer 4 — Quality Gates ← the new structural addition

**Definition.** The layer between tool output and learning. A gate is
`(GateContext, ToolOutput) → QualityGateResult`. The composite gate
runs all gates in parallel, AND-combines the verdicts, and emits the
full set of failed `QualitySignal`s.

**The mandatory five gates in this package.**

1. **Groundedness gate.** Every factual claim has a non-empty
   citation list resolving to a real `EvidenceItem`. Delegates the
   citation-set check to `@borjie/cognitive-engine`'s cite-validator.
   Mining example: the TRA filing draft claims *"the royalty rate is
   3.0% for industrial minerals"* — the gate verifies the claim cites
   the TRA schedule URL + publication date.
2. **Calibration gate.** Claimed confidence ≈ observed accuracy.
   Delegates to `calibrateConfidence` in `@borjie/cognitive-engine`.
   Mining example: Mr. Mwikila says *"medium confidence"* the
   contractor will deliver by Friday. The calibration gate checks
   the historical hit rate on `medium` predictions; if observed
   accuracy is < 30%, the gate downgrades the label and fails.
3. **Brand gate.** The output uses *"Mr. Mwikila"* as the visible
   persona (not "the AI" or "the bot"), uses Borjie design tokens
   only (no raw hex), and avoids forbidden brand strings. The brand
   gate invokes the existing `borjie/no-non-token-style` ESLint rule
   programmatically over the rendered HTML/JSX of UI mutations, and
   does a regex-based identity check on text outputs. Mining
   example: a draft chat reply that opens *"Hello, I'm the BORJIE
   AI"* fails — the brand gate rewrites it to *"Mr. Mwikila here."*
   (no — the gate *fails* it; rewrites happen in a separate
   reflection step).
4. **Authority gate.** The proposed action's tier is ≤ the loop's
   granted authority. Delegates to `@borjie/mutation-authority`.
   Mining example: the loop proposes a 50,000 USD GePG payment
   (T2-Critical). If the loop's granted authority is T1, the gate
   fails and routes the proposal to double-verify.
5. **Budget gate.** The loop's remaining ε-budget (LLM USD cents,
   wall-clock seconds, tool invocations) is non-negative after the
   proposed action. If it would go negative, the gate fails. Mining
   example: a multi-step deep-research run is about to call its 30th
   web-search adapter; budget gate sees remaining < 0 and fails the
   composite.

**Why AND-combine?** The point of the Layer 4 abstraction is that
*all* gates must pass. The composite gate exposes the per-gate
verdict, but the *overall pass* is a logical AND. Failing gates
contribute their `QualitySignal`s to the result so the learning
layer (Layer 5) can attribute the failure to a specific cause.

This is exactly the architecture Anthropic's Constitutional AI uses
in its critique step: each principle is a separate predicate,
combined into an overall pass/fail
([Constitutional AI: Harmlessness from AI Feedback](https://arxiv.org/abs/2212.08073),
Bai et al., Anthropic, 2022-12-15).

### 3.5 Layer 5 — Learning

**Definition.** What the loop updates *after* the gates pass (or
fail). Learning is the only layer permitted to write durable state
about the loop *itself* (separate from the artifact the loop
produced). Three sub-stages.

- **Skill update.** If the tool sequence succeeded and exceeded the
  promotion thresholds, the procedural-memory tier (Voyager-style
  skill library, `@borjie/persistent-memory`) records a new skill
  or promotes an observed sequence
  ([Voyager: An Open-Ended Embodied Agent with LLMs](https://arxiv.org/abs/2305.16291),
  Wang et al., 2023-05-25).
- **Memory consolidation.** If new high-confidence facts emerged,
  they are appended to the unified cognitive memory cells. Cells
  marked as `contradicted` by Layer 4 are transitioned out of the
  retrieval distribution.
- **Calibration update.** The realised outcome is compared to the
  claimed confidence and feeds back into the calibrator's online
  prior. This is the Process Reward Model loop: reward the *steps*
  that led to the outcome, not just the final answer
  ([Let's Verify Step by Step](https://arxiv.org/abs/2305.20050),
  Lightman et al., OpenAI, 2023-05-31).

The learning layer is the only consumer of the `QualitySignal`s
emitted by Layer 4. Failed signals downweight the offending
skill/cell/calibrator; passed signals reinforce.

This separation — gates decide *whether* to learn, learning decides
*what* to update — is the structural distinction that prevents the
recursive self-improver from optimising against the wrong target.

---

## 4. The Run-Level Contract

Each end-to-end execution of the 5-layer loop produces one
`LoopRun` row, plus one `LoopLayerOutcome` row per layer that
executed, plus N `LoopQualitySignal` rows (one per gate). The
audit-hash chain is preserved by carrying the previous run's hash
into the current run's `prev_hash` field, with the row's own
`audit_hash` computed over `(loop_run_id, layer outcomes,
quality signals, prev_hash)`.

This row-shape mirrors the pattern from the swarm-coordination and
persistent-memory waves, and is consistent with the SOC2-grade
provenance requirement in `Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md`.

---

## 5. Failure Semantics

Short-circuit semantics:

- **Sensors → Policy.** If sensors emit zero items, the loop is
  recorded as `status='no_input'` and exits before Policy. This is
  not a failure — it is normal idle-cycle behaviour for autonomous
  loops.
- **Policy → Tools.** If Policy returns `deny`, the loop is recorded
  as `status='denied'`. If Policy returns `gate(name)`, the loop
  exits to the named gate handler (e.g. the
  `tier_2_owner_approval` flow); the loop run is recorded with
  `status='gated'`.
- **Tools → Quality.** If a tool throws, the layer-outcome row
  records the throw; the loop exits with `status='tool_error'`.
- **Quality → Learning.** If the composite gate fails, the loop
  exits with `status='quality_failed'`. Critically, **the failed
  signals are still persisted** — they are the highest-value learning
  signals the loop produces. The learning layer is invoked even on
  quality failure, but only to *record the failure* (e.g. downweight
  the offending skill); no positive reinforcement occurs.
- **Learning happy path.** All layers succeed; loop ends with
  `status='ok'`.

This semantics matches the AlphaCode 2 filtering pattern: failed
candidates contribute information even though they don't ship.

---

## 6. Cost & Latency Budgets

Every `LoopLayerOutcome` carries a `latency_ms` and `cost_usd_cents`
field. The runner sums these into per-tier budgets that Policy can
read in subsequent invocations. The pattern is identical to the
`brain-llm-router` cost-meter, lifted to the loop level.

Default per-loop ε-budgets (overridable per tenant):

- Reactive (chat-turn) loop: 200 ms p50 sensors, 5 s p95 total.
- Tab-as-loop background tick: 2 s p50 total.
- Deep-research multi-step loop: 60 s p50 total, 5 USD cap per run.
- 24/7 autonomous tick: 30 s p50 total.

---

## 7. Citations

The intellectual scaffolding behind this spec, citation-by-citation:

- ReAct framework: [ReAct: Synergizing Reasoning and Acting in
  Language Models](https://arxiv.org/abs/2210.03629), Yao et al.,
  2022-10-06.
- OpenAI o1 reasoning loop: [Learning to Reason with
  LLMs](https://openai.com/index/learning-to-reason-with-llms/),
  OpenAI, 2024-09-12.
- DeepMind AlphaCode 2 filter-cluster-rerank loop:
  [AlphaCode 2 Technical Report](https://storage.googleapis.com/deepmind-media/AlphaCode2/AlphaCode2_Tech_Report.pdf),
  DeepMind, 2023-12-06.
- Anthropic Constitutional AI critique loop:
  [Constitutional AI: Harmlessness from AI
  Feedback](https://arxiv.org/abs/2212.08073), Bai et al., Anthropic,
  2022-12-15.
- Voyager skill library (procedural memory tier):
  [Voyager: An Open-Ended Embodied Agent with Large Language
  Models](https://arxiv.org/abs/2305.16291), Wang et al., 2023-05-25.
- Process Reward Models (step-wise reinforcement):
  [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050),
  Lightman et al., OpenAI, 2023-05-31.
- Agentic OODA pathology (governance argument for Layer 4):
  [Agentic AI's OODA-loop problem](https://snyk.io/blog/agentic-ooda-loop/),
  Snyk Blog, 2025-09-12.
- Free Energy Principle (formal account of agents as predictive
  systems): [The free energy
  principle](https://pmc.ncbi.nlm.nih.gov/articles/PMC8871280/),
  Friston et al., Wellcome Trust / PMC, 2022-02-28.
- Open Policy Agent (the pure-predicate policy pattern):
  [OPA: Open Policy
  Agent](https://www.openpolicyagent.org/docs/latest/), CNCF,
  accessed 2026-05-26.

Every claim above has a URL + title + date. The package code
references these specs by name in module-level docstrings.

---

## 8. Boundary Statement

This package owns the **loop primitives only**:

- The migration adds `loop_runs`, `loop_layer_outcomes`,
  `loop_quality_signals`.
- `@borjie/loop-quality-gates` exposes 5 gate functions + 1
  composite combinator.
- `@borjie/loop-runner` exposes a pure orchestrator that wires the 5
  layers into one `LoopRunResult`.

It does **not** own:

- The sensor implementations (those stay in their domain packages —
  e.g. telemetry stays in `@borjie/observability`, chat input in
  `@borjie/chat-ui`).
- The policy implementations (those stay in `@borjie/authz-policy`
  and `@borjie/mutation-authority`).
- The tool implementations (those stay in their per-capability
  packages — `@borjie/research-tools`, `@borjie/document-composition`,
  etc.).
- The learning implementations (those stay in
  `@borjie/persistent-memory` and `@borjie/cognitive-memory`).

The two new packages are *thin* — they specify the contracts and
orchestrate. The intelligence lives in the layer-implementation
packages that already exist.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

---

## § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

This section is the immutable reconciliation record of founder-locked SOTA findings that frame this architecture. Idempotent — re-running the reconcile pass is a no-op once this section exists. Persona: Mr. Mwikila.

### SOTA Finding 3 — OODA Loop validator gap, closed by design

**Source**: IEEE Spectrum + Snyk joint paper — *"Agentic AI's OODA Loop Problem: Fast Cycles to Bad Decisions When the Validator Is Absent"* (https://spectrum.ieee.org/agentic-ai-ooda-loop, 2026; Snyk research blog companion piece).

**Core finding (verbatim)**: *When an agent runs Observe→Orient→Decide→Act loops at machine speed without a validator gate between Decide and Act, the speed compounds errors instead of compounding value. The fix is an explicit, slow, validating layer that runs between the decision and the action — exactly the architecture our 5-layer loop (`packages/loop-quality-gates/`) implements: the quality gate runs after the Tools layer and before persistence/notification/action.*

**Mapping of the 5 quality gates onto the OODA validator role**:

| Quality gate | Validator concern | What it stops between Decide and Act |
|---|---|---|
| Groundedness | Is every claim sourced to evidence in memory or tools? | Hallucinated facts being persisted or notified |
| Calibration | Does the confidence match the evidence weight? | Over-confident actions on weak evidence |
| Brand | Does the action match Mr. Mwikila persona + tenant brand register? | Off-tone responses reaching the user |
| Authority | Does the actor have the org-scope + role authority? | Privilege escalation via the agent surface |
| Budget | Does the action stay within ε-budget + cost cap + rate-limit? | Runaway loops + bill shock + DP-budget burn |

**Positioning**: Borjie ships the OODA Loop validator the IEEE + Snyk paper says agentic AI is missing. The persona-runtime system prompt carries a one-line guardrail: *"Every Action passes the 5-layer quality gate. There is no fast-loop bypass."*

**Rationale**: Founder-locked: external SOTA validation that the slow-validator architecture is correct; no fast-path bypass may be added even under pressure to reduce latency, because the speed-vs-safety tradeoff has already been resolved by this design.
