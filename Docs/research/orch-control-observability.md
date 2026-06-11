# Orchestration Control · Observability · IP-Safety — SOTA dossier (June 2026)

**Lane:** `orchestration-control-observability-ip-safety` — governing, steering, and
observing the orchestration **without leaking IP**.
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Scope:** agent-orchestration observability (OTel GenAI semconv, traces/spans over a
multi-agent run, AgentOps/Langfuse/Arize) · human-in-the-loop control + interrupt/steer
mid-orchestration · guardrails/policy at the orchestration layer (the meta-rail OUTSIDE
the agent loop) · runaway-loop + cost governance (budgets, circuit-breakers) ·
failure-handling/compensation across an orchestration · **the two-plane split: observe/
debug everything internally while exposing ZERO of it to any client.**
**Anchoring invariants:** INV-H/D (background cognition is IP — show STATUS + OUTPUTS,
never internals), INV-H/D hardened/ABSOLUTE (never an IP leak in any frame/log/error),
INV-J (lossless total capture + complete observability), INV-G (uncapped capability,
only *dynamic governance* bounds: budgets, rate-limits, rails), INV-C (infinite
self-extending nervous system), the meta-rail (`inviolable.ts`).
**Method:** read the existing architecture + `ip-leak-audit.md` + `ORCHESTRATION_SPEC.md`
+ the observability package, then heavy current (June-2026) web research. Every external
finding cites a real, dated source; every finding carries a **beyond-today** leap.

> **The one-sentence thesis of this lane.** The entire 2026 agent-observability stack —
> OpenTelemetry's brand-new *GenAI agent-span* semconv, Langfuse/Arize/AgentOps, the
> control-plane gateways — is built to make agent internals **maximally visible**. That
> visibility is precisely the IP that INV-H/D forbids ever reaching a client. So Borjie's
> winning move is **not** to adopt one of these tools wholesale; it is to run the full
> internal trace plane (so *we* see everything) behind a **structural egress boundary** —
> a typed status-only client contract + a redacting collector tier — so the **same span
> that names `gen_ai.agent.name` and `gen_ai.system_instructions` internally is never the
> span a client can read.** Two planes, one capture, zero leak.

---

## 0. The collision at the heart of this lane (why it is not a solved problem)

The 2026 standard for "see what your agents are doing" is the OpenTelemetry **GenAI
agent-span semantic conventions** — promoted out of experimental in the GenAI SIG and now
emitted natively by LangChain, CrewAI, AutoGen/AG2, and supported by Datadog/Honeycomb/
New Relic `[S1][S2]`. Its required/recommended attributes are, verbatim from the spec
`[S3]`:

- `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.agent.description`
- `gen_ai.operation.name` ∈ {`create_agent`, `invoke_agent`, `invoke_workflow`, `execute_tool`}
- `gen_ai.provider.name` (`openai` | `anthropic` | `aws.bedrock` …)
- `gen_ai.workflow.name` (the **multi-agent orchestration** span)
- `gen_ai.tool.definitions`, `gen_ai.system_instructions`
- `gen_ai.input.messages`, `gen_ai.output.messages` (opt-in content capture)
- `gen_ai.request.model`, `gen_ai.response.finish_reasons`, token usage.

**Read that list against `ip-leak-audit.md`.** Every single attribute the GenAI semconv
asks you to emit is on the forbidden list: `gen_ai.provider.name`/`gen_ai.request.model`
= L1/L3 (model brand), `gen_ai.agent.name` = L2/L6 (junior + persona names), the
`invoke_workflow`→`invoke_agent` span *tree* = L2 (the handoff graph), `gen_ai.tool.*` =
L2 (tool names), `gen_ai.system_instructions`/`gen_ai.input.messages` = L4 (CoT/prompts).
**The industry-standard "good observability" *is* the moat leak.** This is the structural
tension no off-the-shelf tool resolves for us — they all assume the operator and the
tenant are the same trust boundary. For Borjie they are not.

**Confirmed in our own tree (not theoretical):** `packages/observability/src/tracing/
tracer.ts` initialises the OTel `NodeSDK` with `getNodeAutoInstrumentations()` and an
`OTLPTraceExporter`, with **no GenAI-content redaction** beyond a single `<email:redacted>`
token. And `packages/observability/src/decision-trace/otel-bridge.ts` *attaches the
finalised DecisionTrace to the active span* as `decision.branch` / `decision.chosen` /
`decision.output` span events — i.e. **the kernel's branch-and-select reasoning is already
written onto OTel spans** that flow to whatever OTLP endpoint is configured. Today that is
an internal endpoint; the gap is that **nothing structurally guarantees it stays internal**
and never crosses to a client-readable plane.

So the lane's job has three parts, in priority order:
1. **The egress boundary** — make "client sees status+output+evidence only" a *compile-time*
   property, not a per-path reviewer judgement (the central IP-egress guard INV-H/D ABSOLUTE
   already mandates; `ip-leak-audit.md` enumerates the concrete leaks to close).
2. **The internal trace plane** — adopt OTel GenAI semconv *fully* on the internal side so
   we (Borjie ops) get SOTA multi-agent debugging, with redaction at the collector so even
   *our* trace store separates debug-grade from audit-grade.
3. **The control plane** — the meta-rail: budgets, circuit-breakers, interrupt/steer,
   saga-compensation, kill-switch — enforced *outside* the agent loop so the agent (and a
   prompt-injected or self-improving agent) can never reason around it.

---

## 1. Observability — the internal trace plane (full GenAI semconv, redacted at the edge)

### 1.1 What the SOTA stack actually offers (and where it stops)

- **OTel GenAI agent-spans (the spec of record).** Span types: `create_agent`,
  `invoke_agent` (CLIENT for remote, INTERNAL for in-process — our juniors are INTERNAL),
  `invoke_workflow` (the multi-agent orchestrator span), `execute_tool`. `gen_ai.conversation.id`
  correlates a whole turn/session; child spans give the full reasoning chain `[S3][S1]`.
  This is the right *internal* spine: it maps cleanly onto our turn → modality-arbiter →
  sub-MD fan-out → tool-calls tree.
- **Langfuse** — most explicit data model (traces / observations{generation,span,event} /
  sessions / scores), self-hostable on Postgres+ClickHouse, framework-agnostic via OTel,
  **agent-graph view** for LangGraph-style flows `[S4]`. The self-host + OTel-ingest +
  graph-view combination is the closest fit to "our internal plane, on our infra."
- **Arize Phoenix** — OpenInference OTel conventions, ML-grade evals/drift/embedding
  analysis, span-tree-first UX `[S4]`. Strong for the eval/quality side (pairs with our
  Auditor + loop-quality-gates).
- **AgentOps** — 400+ models, **time-travel debugging / session replay**, multi-agent
  workflow visualisation `[S4]`. Replay is the killer feature for debugging a swarm run.
- **Where they all stop:** they assume the trace consumer is trusted. None of them ship a
  *tenant-vs-operator* trust split. Vendor guidance is "redact PII, restrict raw-trace
  access, separate debug from audit traces" `[S8]` — necessary but it stops at PII; it
  does not treat **agent mechanics themselves** (model/agent/tool/handoff names) as the
  protected asset. That extra step is ours to add.

### 1.2 The redaction tier is real and standardised — we just point it at *mechanics*, not just PII

The 2026-mature pattern is **redact in the pipeline, before the trace leaves your env**:
- **OTel Collector redaction/transform processors** centralise privacy controls at the
  collector — one enforcement point for GDPR/PCI/HIPAA — and the corrective pattern is to
  *redact at the structured-logging layer before the trace reaches the backend*, emitting
  a `redacted-fields` list as a span attribute so downstream knows what was masked `[S6][S8]`.
- **Content-capture is an explicit on/off switch:** `OTEL_INSTRUMENTATION_GENAI_CAPTURE_
  MESSAGE_CONTENT=false` keeps token counts + operation metadata but never logs the prompt/
  response bodies `[S9]`. That env flag is the difference between "we have CoT in our trace
  store" and "we don't."
- **Two-collector / tail-sampling architecture:** layer one does `loadbalancingexporter`
  (routing_key: traceID so all spans of a trace land together), layer two does
  `tail_sampling` + redaction; separating the layers gives failure isolation `[S10]`.

**Beyond-today (lane leap #1 — the two-plane collector with a mechanics-aware redactor).**
Run **one** OTel capture, **two** export pipelines off the same collector tier:
- **Audit/ops plane (internal, Borjie-only):** full GenAI semconv — `gen_ai.agent.name`,
  `gen_ai.system_instructions`, `decision.branch/chosen` events, model/provider, the whole
  handoff tree. Goes to a self-hosted Langfuse/Phoenix on *our* infra, RLS-walled, behind
  the platform-admin (`SUPER_ADMIN`/`ADMIN`) boundary that `decision-log.hono.ts` already
  enforces. This is INV-J "complete observability" satisfied *for us*.
- **Tenant plane (the only thing a client can ever touch):** a *derived, status-only*
  projection produced by a **mechanics-redaction processor** that is the trace-layer twin
  of the chat-layer IP-egress guard. It is **allow-list, not deny-list**: a span is emitted
  to the tenant plane only if it matches a `StatusSpan` shape (`phase`, `progress`, `eta`,
  `verified:boolean`, `contenders:number`, `evidenceCount`) — every `gen_ai.*`,
  `decision.*`, `tool.*`, `handoff.*`, provider/model attribute is structurally absent
  because the projection schema has no field for them. Fail-closed: an unknown attribute
  drops the span from the tenant plane rather than passing it through. This makes
  "the client trace plane carries zero mechanics" a property of the *projection type*, not
  of a redaction regex that a new attribute can slip past — the same
  "zero-mixing-by-construction" discipline the localization plan uses for EN/SW, applied to
  observability.

> **Why this is the right shape for INV-H/D.** `ip-leak-audit.md` already proves the leaks
> live in the *envelope*, not the prompt. The two-plane collector generalises that finding:
> the envelope is just the tenant-plane projection of the internal trace. Build the
> projection as a typed `StatusSpan` union and the leak class is closed by construction,
> across SSE *and* any future trace/export surface, not one route at a time.

### 1.3 Concrete internal-plane build (maps onto our existing code)

- We already have `tracing/tracer.ts` (OTel NodeSDK), `tracing/langfuse-adapter.ts`,
  `decision-trace/otel-bridge.ts`, `pii-redactor.ts`. The internal plane is ~80% wired.
  The missing 20% is: (a) emit the **GenAI agent-span semconv** names on the kernel spans
  (rename our ad-hoc `decision.*` to also carry `gen_ai.operation.name=invoke_agent/
  invoke_workflow/execute_tool` so any OTel-native viewer renders our swarm correctly);
  (b) gate content-capture behind the env flag so prompt bodies only appear on the
  audit plane; (c) add the mechanics-redaction processor + the `StatusSpan` projection for
  the tenant plane.
- **`gen_ai.conversation.id` = our turn/thread id** is the join key that lets a Borjie
  operator pull the *entire* swarm trace for a turn (every sub-MD, tool, handoff, judge
  decision) in one Langfuse/Phoenix session view — INV-J total-recall observability, for us.

---

## 2. The control plane / meta-rail — policy enforced OUTSIDE the agent loop

### 2.1 The frontier consensus: governance is *deployed infrastructure*, not agent instructions

This is the single most important SOTA pattern for our meta-rail invariant, and it is now
explicit doctrine:

- **OpenAI's agentic-governance cookbook** `[S11]`: policies live in a **separate versioned
  repo** (`pe-policies`, JSON, git-versioned), installed as a package; the agent is wrapped
  by a `GuardrailAgent` so guardrails execute **before and after** the LLM reasoning and
  *the agent cannot bypass them because they are enforced by the client wrapper, not the
  agent's own logic.* Three-stage enforcement: pre-flight → input guardrails → agent LLM →
  output guardrails. "A malicious agent cannot disable PII detection because it's enforced
  by the wrapping, not by the agent's logic." **This is exactly our meta-rail thesis** —
  the agent can grow capability but can never touch its own gate/audit/test machinery
  (`inviolable.ts:482`).
- **OpenAI Agents SDK guardrails** `[S5]`: input guardrails run on the *first* agent,
  output guardrails on the *final* agent — and crucially, **tool guardrails wrap *every*
  tool call** (authz, schema-validation, rate-limit, cost-meter inside), giving the most
  comprehensive coverage in a swarm because they fire regardless of which agent calls. Maps
  directly to SEC-G1 (wire `createToolUseValidator` before *every* dispatch) — the tool
  boundary is the universal chokepoint.
- **NeMo Guardrails** `[S7]`: programmable rails at input/output/dialog/retrieval/execution
  stages, run as a **proxy microservice** — i.e. *out of process*, which is the strongest
  form of "outside the agent loop."
- **Agent-gateway / MCP-gateway control planes** `[S12]`: `agentgateway` (HTTP/gRPC/MCP/
  A2A/LLM in one proxy with centralised policy + federation), Tyk/MuleSoft Omni/Bifrost
  (11µs overhead @ 5k rps) — every agent→tool call passes through a governed proxy URL with
  authn, policy, rate-limit, audit, and **runaway rate-limiting** at the gateway. This is
  the network-layer embodiment of "one chokepoint."
- **OPA (Open Policy Agent)** `[S?OPA]`: general-purpose policy engine, decisions logged
  with input + policy-version + outcome for fine-grained audit — the policy-as-code engine
  that backs the separate-repo pattern, with built-in decision-log audit trails.

**Beyond-today (lane leap #2 — the meta-rail as an out-of-process actuator proxy with a
hash-chained decision log).** RSS-16 already calls for `kernel/autonomy-controller/` that
wraps policy-gate + inviolable and is *immutable to the agent* (the DGM invariant). The
frontier leap is to make that controller **out-of-process** like NeMo/agentgateway: every
*external actuator* call (LedgerService.post, licence filing, deletion, external comms,
body-change syscall EA-04) routes through a **single governed actuator proxy** that (a)
evaluates the policy bundle (OPA-style, versioned, agent-unreachable), (b) enforces the
budget/rate/circuit-breaker, (c) writes a hash-chained decision-log entry *before* the side
effect, and (d) can *refuse* even if the agent's own loop was compromised. Because it is a
separate process with its own identity, a prompt-injected or self-modified kernel
**physically cannot** call the actuator except through the proxy — the meta-rail stops being
a function the agent calls and becomes a boundary the agent lives inside. This is the
"capability beneath autonomy" layer (`ORCHESTRATION_SPEC.md` enforcement seam): AUTO
promotion widens *policy* only; the proxy still enforces the granted capability set, so the
LedgerService money-path + RLS hard rules hold no matter how smart the agent gets.

### 2.2 The regulatory floor this control plane must meet (and exceed)

- **EU AI Act Art. 14** `[S13]`: high-risk systems must let a human **interrupt via a "stop"
  button or similar that brings the system to a halt in a *safe state*** — real-time, not
  "turn off the server." Humans must be able to **monitor, interpret, and override**. Our
  kill-switch is the stop button; the saga-compensation (§4) is what makes the halt land in
  a *safe* (consistent) state rather than a half-applied one.
- **NIST AI RMF / AI-Agent Standards Initiative (CAISI, Feb 2026; Agent Interoperability
  Profile Q4-2026)** `[S14]`: names the exact risk our control plane exists to kill — *"an
  agentic system can initiate a cascade of irreversible actions in external systems before
  any human observes it is behaving incorrectly; the temporal gap between initiation and
  observation is a fundamental new risk dimension."* And: governance built on human-paced
  review cycles cannot manage autonomous behaviour — **runtime control is required, not
  process control.** This is the strongest external justification for our prepare→ask→
  execute pattern (INV-F) and for circuit-breakers being *runtime*, not policy-doc.

**Beyond-today (lane leap #3 — close the temporal gap with a reversibility-typed actuator
+ a "pause horizon").** Make the temporal-gap risk a *typed* property: every actuator port
declares `reversibility ∈ {reversible | compensable | irreversible}` and `blastRadius`. The
control plane enforces that no `irreversible` action executes without a satisfied HITL gate
(INV-F), and that a *sequence* of compensable actions cannot exceed a per-flow
irreversibility budget (AUT-05) before re-confirmation. The leap: a **pause horizon** — the
controller computes, before launching a flow, the *latest point at which a human could still
halt-to-safe-state*, and forces the HITL checkpoint *at* that horizon, not after. The
human's stop button is thus always positioned *before* the cascade becomes irreversible —
turning Art. 14's "stop button" from a hope into a scheduled, computed control point.

---

## 3. Human-in-the-loop: interrupt + steer *mid-orchestration*

### 3.1 SOTA primitives

- **LangGraph `interrupt()` + `Command` (v1.2, 11 May 2026)** `[S15][S16]`: a node calls
  `interrupt(payload)`, the graph **persists its full state via the checkpoint layer** and
  waits *indefinitely*; resume by re-invoking with `Command(resume=value)` keyed by
  `thread_id`, which becomes the return value of the `interrupt()` call. v1.2 reframes an
  agent run as a **durable graph execution** (not a Python function call), fixing
  interrupt/streaming/resume semantics. This is the canonical "pause-to-checkpoint,
  resume-via-Command" pattern our EXEC-hitl gap names.
- **`interrupt_on` policy map** (`ORCHESTRATION_SPEC.md` already references it): read=AUTO,
  write/execute=gate — a per-tool-class interrupt policy rather than per-action prompting.
  Backed by Anthropic's own telemetry (per-action prompting → ~93% rubber-stamp; gate-by-
  risk-class cut prompts 84%) — over-prompting *destroys* oversight, so the HITL design must
  gate by **risk class**, not by every step.
- **Four human-interaction patterns** (web-agent research, Feb 2026) `[S17]`: *hands-off
  supervision · hands-on oversight · collaborative task-solving · full user takeover* — and
  models trained to *predict when a human will intervene* improved intervention-prediction
  61–63%. Plus `@user`/`@ai` mode-switching for seamless control transfer. This is the
  research backing for INV-F's "you do it / I'll do it" handoff being a *first-class mode*,
  not an exception path.

### 3.2 How this lands in Borjie (mid-orchestration steer without leaking IP)

- **Durable interrupt = our durable-execution requirement (INV-G).** A long flow (months-
  long royalty ladder, 60-day renewal) must be able to pause at an HITL gate, persist, and
  resume after a human acts days later — exactly LangGraph durable-graph semantics, which is
  why INV-G names a Temporal/DBOS-class substrate. The interrupt payload that reaches the
  owner is a **status+proposal** object (the prepared package, INV-F step 1), *never* the
  graph state / node names / tool args. The internal checkpoint (full graph state) lives on
  the audit plane; the client sees the proposal.
- **Steer = a Command on the tenant plane that the kernel maps to internal control.** "Take
  the wheel" / "refine this" / "stop" are the only verbs the client emits; the kernel
  translates them into `Command(resume=…)` / re-plan / kill-switch internally. The client
  never sees that there *is* a graph to resume — it sees "Working… → here's the proposal →
  [Approve][Refine][I'll do it]".

**Beyond-today (lane leap #4 — an intervention-prediction-driven, IP-safe steering rail).**
Combine the four-patterns research with our calibration: the controller **predicts** which
steps the owner is likely to want to steer (from the owner's own intervention history in the
Generative-Agents memory stream) and *proactively* surfaces a checkpoint *before* those
steps — moving HITL from "interrupt when a rule fires" to "offer the wheel exactly where
this owner tends to want it." Crucially the prediction model runs on the **internal plane**
(it reads the full trace); the owner only ever sees a well-timed "shall I proceed?" — so the
steering feels like a perceptive human assistant, and the model/feature internals that
produced the timing never cross the boundary.

---

## 4. Runaway-loop + cost governance (budgets, circuit-breakers)

### 4.1 The failure mode is now a documented, expensive reality

- A **$47,000 LangChain infinite loop** (budget controls would have killed it at $10); a
  **$12,000 single runaway session** before anyone noticed `[S18]`. Agents resend the *whole*
  history each tool call, so cost compounds — by step 20 a single late-loop step can be
  $0.15+ `[S18]`. Agents burn **~50× more tokens than chat** `[S18]`.
- **Standard safeguards (2026):** hard `max_iterations` cap; cumulative **per-request budget
  kill** (e.g. >$1.00 → terminate); **circuit-breakers** with exact-repeat caching, jitter
  detection, per-tool call limits, error-rate breaking; **semantic dedup** — if the new plan
  is ≥95% cosine-similar to the previous failed plan, **stop** `[S18][S?dedup]`.

### 4.2 How this maps to Borjie (and where INV-G reshapes it)

- We have `packages/llm-budget-governor` + per-package budgets; EXEC-budget says TPM+cost
  ceilings aren't yet enforced *across* the orchestrator + fan-out. The fix is a **single
  budget envelope per turn** that the modality-arbiter sets from the effort-scaling rule
  (1 agent / 3-10 tool calls for facts; 2-4 sub-MDs for comparisons; 10+ only for deep
  research) and that every sub-MD inherits and decrements — the OpenAI-Agents-SDK
  `budget envelope` field our `SubMdSpawn` contract already carries.
- **INV-G reshapes the cap.** A hardcoded `max_iterations=5` is exactly the "arbitrary
  capability cap = bug" INV-G forbids. The cap must be **dynamic governance**: the loop runs
  as long as it is *making verified progress* (loop-quality-gates improving, semantic-entropy
  falling, budget not exhausted) and is killed only by a **safety tripwire** (no-progress /
  plan-repeat / budget / rising error / anomaly) — never by a magic number. This is the
  "keep anti-wedge SAFETY timeouts; dynamicise capability LIMITS" rule made concrete.

**Beyond-today (lane leap #5 — a progress-conditioned circuit-breaker, not an iteration
counter).** Replace `max_iterations` with a **value-of-continuation** governor: each loop
turn the controller estimates marginal progress (Δ groundedness, Δ goal-satisfaction,
semantic-entropy trend) against marginal spend, and trips when *expected value of the next
step < its cost* OR a repeat/anomaly tripwire fires. Pair it with the SagaLLM semantic-dedup
("plan ≥95% similar to a prior failed plan → halt") and a **shared cross-replica budget
ledger** (Redis token-bucket, since RSS-08 shows our limiters are process-local and over-
count at N replicas). The result: an *uncapped* loop (INV-G) that nonetheless cannot run
away, because it is bounded by **economics + progress + safety**, not by a constant. The
client sees only "still working… (longer than usual)" status — never the budget, the
iteration count, or that there is a loop at all (closes `ip-leak-audit.md` L7).

---

## 5. Failure-handling + compensation across an orchestration

### 5.1 SOTA: sagas + independent validators for multi-agent LLM systems

- **Saga pattern (orchestrated)** `[S20]`: a workflow = (T₁…Tₙ) each paired with a
  compensating transaction (C₁…Cₙ); on failure at Tⱼ, the coordinator runs Cⱼ₋₁…C₁ **in
  reverse** so the system lands in "fully committed OR coherent rollback," never partial.
- **SagaLLM** (arXiv 2503.11951, current) `[S19]` — the multi-agent-LLM-specific version,
  and the single best-matched paper for our money/licence path:
  - **Three-dimensional state**: Application state (domain entities, checkpoints), Operation
    state (execution logs, **reasoning traces**, compensation metadata), Dependency state
    (constraint graph + satisfaction evidence).
  - **Independent validation agents** (not LLM self-verification, which is blocked by Gödel
    incompleteness): a `GlobalValidationAgent` does syntactic/semantic checks *before commit*
    and cross-agent dependency validation — **this is our mandatory Auditor Agent**, and
    SagaLLM is the citation that says self-verification is *insufficient by construction*.
  - **Dependency-graph rollback**: model inter-op deps as a directed graph; on failure
    traverse it to compute the **minimal affected operation set** and compensate only those —
    not a blunt full rollback.
  - **Persistent context** survives token-limit recall drops: roll back to a saved state,
    reconsolidate old + new constraints, replan.
- **Temporal / durable execution** `[S20a]`: sagas as long-running workflows with automatic
  retries, timeout/versioning, exactly-once, written in normal code — the substrate for
  hours/days-long flows with side effects needing compensation. This is the INV-G durable
  substrate.
- **Reliability patterns (2026 playbook)** `[S21]`: checkpoint after each node (state in the
  store, not memory — zero loss on crash = INV-J); **idempotency keys on every external
  call**; five error classes each with a distinct response (execution→circuit-breaker+retry;
  semantic→validation+fallback; state→verify+checkpoint; timeout→adaptive-timeout+partial-
  result; replan threshold after N step-failures); plan-versioning + rollback to an earlier
  plan; HTN-style **plan-repair** (preserve executed prefix, repair not replan).

### 5.2 How this lands in Borjie

- **EXEC-saga / EXEC-hitl** are the open gaps. The money path is sacred (LedgerService.post,
  double-entry immutable) — so compensation **must be semantic** (a reversing ledger posting
  through `LedgerService.post`), never a destructive rollback that breaks the append-only
  invariant. SagaLLM's "Application state = booking confirmations / Operation state =
  compensation metadata" maps to "ledger entries / reversing entries + saga log."
- **The dependency-graph rollback is the right rigour for an estate flow:** onboard-a-site
  or process-a-royalty has parallel independent steps (licence-validity ∥ tax-status ∥
  permit-check). On a late failure we compensate only the *affected* sub-tree, not the whole
  flow — minimal blast radius, which is also what the reversibility-typed actuator (§2.2
  leap) wants.
- **The independent validator = our Auditor**, already mandatory (evidence-required, rejects
  empty chains). SagaLLM elevates it from "good practice" to "the only sound design" and adds
  the *pre-commit* and *cross-agent dependency* checks our Auditor should also run.

**Beyond-today (lane leap #6 — a typed, hash-chained Saga log that doubles as the audit
plane and never surfaces to the client).** Unify three things we are building separately: the
saga's Operation-state log, the AI audit chain (hash-chained, append-only), and the internal
OTel trace. Make the **saga step + its compensation + its validator verdict a single typed,
hash-chained event** on the audit plane. Benefits: (a) compensation is *replayable and
provable* (we can show a regulator the exact reverse-posting that undid a mis-filed royalty);
(b) it satisfies INV-J losslessly; (c) because it lives on the audit plane behind the
platform-admin boundary, the client only ever sees the *outcome* ("filing reversed; corrected
draft ready") — the compensation mechanics, the dependency graph, the validator reasoning all
stay internal IP. The saga log becomes the operator's god-view and the client's nothing-view
of the *same* event — the two-plane principle applied to failure handling.

---

## 6. Synthesis — the unified control-observability-IP architecture (one picture)

```
                    ┌──────────────────────── INTERNAL PLANE (Borjie ops only) ───────────────────────┐
  inbound turn ─►   │  Modality-Arbiter ─► swarm/loop/workflow ─► tool-calls                            │
                    │        │ emits OTel GenAI semconv: gen_ai.agent.name / system_instructions /      │
                    │        │ tool.definitions / decision.branch|chosen / provider/model               │
                    │        ▼                                                                           │
                    │  [OUT-OF-PROCESS META-RAIL / ACTUATOR PROXY]  ◄── policy-as-code bundle (OPA-style,│
                    │   • reversibility-typed gate (rev/comp/irrev) + pause-horizon HITL                │ agent-
                    │   • progress-conditioned circuit-breaker + shared budget ledger                   │ unreachable)
                    │   • saga executor + compensation + independent validator (Auditor)                │
                    │   • kill-switch (Art.14 stop→safe-state), fail-closed                             │
                    │        │ every step → hash-chained Saga/Audit event                               │
                    │        ▼                                                                           │
                    │  OTel Collector tier (loadbalancing → tail_sampling)                              │
                    │        ├─► AUDIT/OPS export ─► self-hosted Langfuse/Phoenix (full mechanics)       │
                    │        │      content-capture ON only here; replay/time-travel debug; RLS-walled  │
                    └────────┼──────────────────────────────────────────────────────────────────────────┘
                             │  MECHANICS-REDACTION PROCESSOR  (allow-list StatusSpan projection, fail-closed)
                    ┌────────▼──────────────────────── TENANT PLANE (the only client-reachable surface) ──┐
                    │  StatusSpan{phase,progress,eta} · Output(text/artifact/proposal) ·                   │
                    │  Evidence(evidence_id, verified:bool, contenders:N, auditLogId)                      │
                    │  Steer verbs in: [Approve][Refine][I'll do it][Stop]                                 │
                    │  ZERO of: model/provider, agent/junior/persona names, tool names, handoff graph,     │
                    │  CoT, prompts, budgets, iteration counts, branch/chosen reasoning                    │
                    └──────────────────────────────────────────────────────────────────────────────────────┘
```

**The three structural guarantees** (each a compile-time property, not a reviewer's care):
1. **Two planes, one capture.** Full GenAI-semconv internally; the tenant plane is a *typed
   allow-list projection* (`StatusSpan | Output | Evidence`) with no field for mechanics —
   so a new attribute/agent/tool cannot leak by omission. (Closes the whole L1–L8 class in
   `ip-leak-audit.md` at the boundary, not per route.)
2. **Meta-rail outside the loop.** Policy/budget/circuit-breaker/saga/kill-switch enforced by
   an out-of-process actuator proxy with an agent-unreachable policy bundle — a self-improving
   or injected agent cannot reason around it (DGM invariant, `inviolable.ts`).
3. **Stop lands safe.** Art.14 stop-button + saga compensation + reversibility-typed actuator
   + pause-horizon = the agent can be halted *before* irreversible cascade, into a *consistent*
   state, and the halt is replayable/provable on the audit plane — never narrated to the client.

---

## Sources

- **[S1]** Greptime — *How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools* (2026-05-09): https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions
- **[S2]** Uptrace — *OpenTelemetry for AI Systems: LLM and Agent Observability (2026)*: https://uptrace.dev/blog/opentelemetry-ai-systems
- **[S3]** OpenTelemetry — *Semantic Conventions for GenAI agent and framework spans* (spec of record): https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- **[S4]** Digital Applied — *Agent Observability: LangSmith, Langfuse, Arize 2026*: https://www.digitalapplied.com/blog/agent-observability-platforms-langsmith-langfuse-arize-2026 ; Laminar — *Top 6 Agent Observability Platforms (2026)*: https://laminar.sh/article/2026-04-23-top-6-agent-observability-platforms
- **[S5]** OpenAI Agents SDK — *Guardrails*: https://openai.github.io/openai-agents-python/guardrails/
- **[S6]** Dash0 — *Mastering the OpenTelemetry Redaction Processor*: https://www.dash0.com/guides/opentelemetry-redaction-processor ; BetterStack — *Redacting Sensitive Data with the OpenTelemetry Collector*: https://betterstack.com/community/guides/observability/redacting-sensitive-data-opentelemetry/
- **[S7]** NVIDIA NeMo Guardrails: https://github.com/NVIDIA-NeMo/Guardrails ; aimultiple — *Top AI Guardrails (NeMo)*: https://aimultiple.com/ai-guardrails
- **[S8]** Digital Applied — *Agent Observability Anti-Patterns: Trace Quality Mistakes (2026)*: https://www.digitalapplied.com/blog/agent-observability-anti-patterns-trace-quality-mistakes-2026 ; Groundcover — *AI Agent Observability Guide*: https://www.groundcover.com/learn/observability/ai-agent-observability
- **[S9]** MintMCP — *OpenTelemetry for AI Agents: Implementing Observability in MCP Workflows* (content-capture env flag): https://www.mintmcp.com/blog/opentelemetry-ai-agents
- **[S10]** OpenTelemetry — *tailsamplingprocessor* (two-layer / loadbalancing routing_key): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md ; ControlTheory — *Tail-Based Sampling with the OTel Collector*: https://www.controltheory.com/resources/tail-sampling-with-the-otel-collector/
- **[S11]** OpenAI Cookbook — *Building Governed AI Agents: A Practical Guide to Agentic Scaffolding* (policy-as-code, GuardrailAgent wrapper, ZDR custom TraceProcessor): https://developers.openai.com/cookbook/examples/partners/agentic_governance_guide/agentic_governance_cookbook
- **[S12]** Solo.io — *Designing agentgateway*: https://www.solo.io/blog/designing-agentgateway-a-unified-high-performance-gateway-for-ai-and-api-traffic ; Tyk — *MCP Gateway: The Control Plane for Enterprise AI Agents*: https://tyk.io/learning-center/mcp-gateway-architecture-technical-guide/ ; agentgateway: https://agentgateway.dev/
- **[S13]** EU AI Act — *Article 14: Human Oversight* (stop button / halt to safe state / monitor-interpret-override): https://artificialintelligenceact.eu/article/14/
- **[S14]** NIST — *AI Risk Management Framework* + AI-Agent Standards Initiative (CAISI, temporal-gap-of-irreversible-actions): https://www.nist.gov/itl/ai-risk-management-framework ; CSA Labs — *Agentic NIST AI RMF Profile v1*: https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/
- **[S15]** LangChain Docs — *Interrupts (LangGraph)*: https://docs.langchain.com/oss/python/langgraph/interrupts
- **[S16]** LangChain — *Making it easier to build human-in-the-loop agents with interrupt*: https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt
- **[S17]** arXiv 2602.17588 — *Modeling Distinct Human Interaction in Web Agents* (four interaction patterns; intervention-prediction): https://arxiv.org/html/2602.17588 ; SagesAI — *Human Intervention: A Critical Safeguard in AI Agent Systems*: https://sagesai.github.io/en/blog/agent-takeover/
- **[S18]** Medium (Msatfi) — *Reproducing the Multi-Agent Loop That Cost Someone $47K*: https://medium.com/@mohamedmsatfi1/i-spent-0-20-reproducing-the-multi-agent-loop-that-cost-someone-47k-7f57c51f3c06 ; LeanOps — *AI Agents Burn 50x More Tokens Than Chats*: https://leanopstech.com/blog/agentic-ai-cost-runaway-token-budget-2026/ ; RelayPlane — *Agent Runaway Costs: LLM Budget Limits*: https://relayplane.com/blog/agent-runaway-costs-2026
- **[S19]** arXiv 2503.11951 — *SagaLLM: Context Management, Validation, and Transaction Guarantees for Multi-Agent LLM Planning*: https://arxiv.org/html/2503.11951v3
- **[S20]** Conduktor — *Saga Pattern for Distributed Transactions*: https://www.conduktor.io/glossary/saga-pattern-for-distributed-transactions ; **[S20a]** Temporal — *Mastering Saga Patterns for Distributed Transactions*: https://temporal.io/blog/mastering-saga-patterns-for-distributed-transactions-in-microservices ; AI Workflow Lab — *Durable Agent Pipelines with LangGraph and Temporal*: https://aiworkflowlab.dev/article/ai-workflow-orchestration-in-production-building-durable-agent-pipelines-with-langgraph-and-temporal
- **[S21]** PromptEngineering.org — *Agents At Work: The 2026 Playbook for Reliable Agentic Workflows*: https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/ ; Zylos — *AI Agent Workflow Checkpointing and Resumability*: https://zylos.ai/research/2026-03-04-ai-agent-workflow-checkpointing-resumability/ ; Zylos — *Graceful Degradation Patterns in AI Agent Systems*: https://zylos.ai/research/2026-02-20-graceful-degradation-ai-agent-systems/
- **[S-OPA]** Open Policy Agent (policy-as-code + decision-log audit): https://www.openpolicyagent.org/ ; OneUptime — *Policy-as-Code for Observability with OPA*: https://oneuptime.com/blog/post/2026-02-06-policy-as-code-observability-opa/view
- **[S-dedup]** OneUptime — *Configure the Redaction Processor in the OpenTelemetry Collector*: https://oneuptime.com/blog/post/2026-02-06-redaction-processor-opentelemetry-collector/view ; Galileo — *8 Best AI Agent Guardrails Solutions in 2026*: https://galileo.ai/blog/best-ai-agent-guardrails-solutions
- **Internal (codebase, read-only):** `Docs/research/ip-leak-audit.md` ; `Docs/research/ORCHESTRATION_SPEC.md` ; `Docs/research/MASTER_GAP_REGISTER.md` (INV-H/D, INV-J, INV-G, RSS-16, EXEC-saga/hitl/budget, AUT-05) ; `packages/observability/src/tracing/tracer.ts` ; `packages/observability/src/decision-trace/otel-bridge.ts` ; `packages/central-intelligence/src/kernel/{inviolable.ts,killswitch.ts,policy-gate.ts,autonomy/}` ; `packages/llm-budget-governor`.
