# Borjie Execution-Layer Audit — How the AI Superpowers Actually Run

**Slice:** `borjie-execution-audit`
**Date:** 2026-06-08
**Scope:** The EXECUTION layer (not domain knowledge). Traces a real user
request from a surface through the brain to a result, and classifies every
execution path as SWARM / PARALLEL / durable WORKFLOW / SEQUENTIAL-only /
ORPHAN / BLOCKED / STUB.

All findings are evidence-based with `file:line` citations. Verdicts use the
fixed vocabulary in the structured schema.

---

## TL;DR verdict

Borjie has an enormous surface of execution machinery (12-agent kernel,
orchestrator main-loop, debate, LATS, sub-MDs, VP cluster, subagent teams,
swarm/crew/supervisor patterns, workflow engine, research orchestrator).
**The vast majority of it is SEQUENTIAL-only, STUB, or ORPHAN.** The one
genuinely parallel + checkpoint-capable engine (research-orchestrator) is
invoked synchronously and inline from its user route.

- **(1) Does the 12-agent kernel run agents in parallel / debate?**
  No on the live path. The DEFAULT generator is the orchestrator main-loop —
  a **single-threaded ReAct while-loop** (`main-loop.ts:644`). `debate` is a
  real module but **runs sequentially** (`debate-runner.ts:68-108`) AND is
  **not wired** into the production sovereign kernel deps. The multi-LLM
  synthesizer (the only true parallel fan-out in the kernel) is **opt-in per
  turn** (`req.requireSynthesis`) and not set by the brain turn path.

- **(2) Real workflow/orchestration engine driving multi-step superpowers,
  wired to user flows?** Partially. `workflow-engine` is wired to `/workflow`
  but is **in-memory only** (loses all runs on restart) despite a docstring
  claiming it is the "persistent" replacement. The orchestrator main-loop IS
  the live multi-step engine but is sequential and its checkpoints are
  in-memory.

- **(3) Juniors / sub-MDs dispatched as a swarm (parallel, dependency-
  ordered) or one-at-a-time?** **One-at-a-time.** `/brain/dispatch` runs the
  VP's sub-MD plan with `for (const spawn of plan.spawns)` (`brain-
  dispatch.hono.ts:256`). `spawn_sub_md` in the main-loop returns a
  breadcrumb `spawn_ack` — **no sub-MD ever executes** because no
  `spawnHandler` is wired (`tool-dispatcher.ts:151`, sovereign wiring omits
  it). `/md-agentic/subagents/dispatch` only **persists rows at status
  'pending'; there is no executor** (`md-agentic-repository.ts:246`).

- **(4) Long-running/async execution durable (survives restart, resumable)?**
  Mostly no. The brain turn, sub-MD dispatch, subagent teams, and workflow
  engine are all **in-memory / request-lifetime**. The Inngest durable
  executor exists (`durable/inngest-executor.ts`) but is **imported by
  nothing in live `src`**. research-orchestrator has a real
  `long-running-checkpoint` + budget pause, but the user-facing endpoints run
  inline and block the HTTP request.

- **(5) Partial results streamed to users during execution?** No. Both the
  persona path (`streamTurn`, `orchestrator.ts:1170`) and the orchestrator
  path (`streamViaOrchestrator`, `kernel.ts:3739`) **buffer the full answer,
  then fake-stream** it in fixed-size chunks. No live token streaming reaches
  any surface.

- **(6) Dead-ends (superpowers a user can invoke that never complete)?** Yes.
  `/md-agentic/subagents/dispatch` (never executes), `spawn_sub_md` inside any
  brain turn (acked, never runs), and durable workflow resumption (state lost
  on restart). See **blockedFlows**.

---

## Execution map — a real user chat request

```
owner-web / mobile  ──POST /api/v1/brain/turn──▶  brain.hono.ts:1675
  │  gateTurn (auth + rate + budget)                      brain.hono.ts:461
  │  resolveBrainOrchestratorRoutingEnabled() = TRUE      brain-orchestrator-turn.ts:77
  │  (DEFAULT-ON ⇒ skip separate kernelPreflight)         brain.hono.ts:1706
  │  withRecalledMemory / withCognitiveEnrichment         brain.hono.ts:1743-1752
  │  consultBrainTurnPrivacy                              brain.hono.ts:1760
  ▼
generateBrainTurnViaOrchestrator                          brain-orchestrator-turn.ts:228
  │  createThread + append user_message
  ▼
sov.kernel.think(req)                                     kernel.ts:576
  │  orchestratorRoutingEnabled && deps.orchestrator ⇒    kernel.ts:619
  │    killswitch step-0 only, then…
  ▼
runViaOrchestrator → orchestratorThink                    kernel.ts:3482 → main-loop.ts:409
  │  ── SINGLE-THREADED ReAct while-loop ──               main-loop.ts:644
  │  while (budget && !plan.complete) {
  │     toolSearch.searchRelevant(goal, 8)                main-loop.ts:646
  │     router.call({system, tools, messages})  ← ONE LLM call/tick  main-loop.ts:716
  │     PreToolUse 9-hook chain                           main-loop.ts:905
  │     dispatcher.dispatch(decision)            ← ONE tool/tick      main-loop.ts:976
  │       tool_call → registry.runTool                   tool-dispatcher.ts:79
  │       spawn_sub_md → spawn_ack BREADCRUMB (no exec)  tool-dispatcher.ts:168
  │     fold tool result back into next messages         main-loop.ts:1068
  │  }
  ▼
translateOrchestratorResponse                             kernel.ts:3556
  │  answer ⇒ confidence HARD-CODED to 1, gates all 'pass' kernel.ts:3587-3599
  │  (legacy judge/drift/policy/confidence/uncertainty NOT re-run)
  ▼
back in brain.hono.ts: auditAndEnforceJson (evidence gate) brain.hono.ts:1106
  │  SSE: slice full text into 80-char chunks (FAKE stream) brain.hono.ts:1231
  ▼
JSON/SSE response to surface
```

The **persona/master-brain fallback** path (flag OFF) runs the disciplined
14-step pipeline (`kernel.ts:683-1388+`) including the sensor router
(failover, one sensor at a time), optional debate, optional synthesizer,
judge, drift, policy, confidence, uncertainty. **But it is the fallback**,
not the default, and it too fake-streams via `streamTurn`.

---

## Detailed findings

### EX-1 — 12-agent kernel runs SEQUENTIALLY on the live path (no parallel agents)
- **Severity:** HIGH · **Verdict:** SEQUENTIAL-ONLY
- **Evidence:** The DEFAULT generator is the orchestrator main-loop, a single
  `while` loop that issues one `router.call` and one `dispatch` per tick
  (`packages/central-intelligence/src/kernel/orchestrator/main-loop.ts:644-720,
  976`). The kernel routes here whenever `deps.orchestrator` is wired and the
  flag is on (`kernel.ts:619`), which is the production default
  (`resolveOrchestratorRoutingEnabled` defaults TRUE — `kernel.ts:3362-3371`;
  sovereign wires it with `useByDefault` UNSET — `sovereign.ts:899`).
- **Fix:** If parallel cognition is a product goal, either (a) wire the
  `synthesizer` port into the sovereign kernel deps and set
  `requireSynthesis` for high-stakes turns, or (b) add a parallel reasoning
  stage to the main-loop (fan-out N drafts, then merge). Today neither runs.

### EX-2 — Internal debate is real but SEQUENTIAL and UNWIRED in production
- **Severity:** HIGH · **Verdict:** ORPHAN (built, sequential, not on user path)
- **Evidence:** `runDebate` is nested `for round { for voice { await
  sensor.call } }` — strictly serial voice turns
  (`kernel/debate/debate-runner.ts:68-108`). The kernel only invokes debate
  when `deps.debate` is supplied AND stakes ≥ high (`kernel.ts:1217-1241`),
  but the production sovereign composition root **never sets
  `mutable.debate`** (grep of `sovereign.ts` for `debate` returns nothing).
  Even if wired, it only runs on the LEGACY fallback path (the orchestrator
  default path has no debate step).
- **Fix:** Wire `deps.debate` (from `kernel/debate`) into
  `composeSovereignKernelDeps`, and decide whether debate belongs on the
  orchestrator default path (currently it cannot fire there at all).

### EX-3 — Multi-LLM synthesizer (the only true parallel fan-out) is opt-in and OFF on the chat path
- **Severity:** MED · **Verdict:** ORPHAN
- **Evidence:** Synthesizer fans out N providers once in parallel then merges
  (`kernel.ts:1292-1322`, dep jsdoc `kernel.ts:333`), but is gated on
  `req.requireSynthesis === true` (`kernel.ts:1230`). The brain turn path
  (`generateBrainTurnViaOrchestrator`) never sets `requireSynthesis`, and the
  orchestrator default path ignores it entirely. So the one genuine parallel
  LLM fan-out in the kernel is dark for normal users.
- **Fix:** Thread a stakes→`requireSynthesis` policy into
  `toOrchestratorRequest`/the legacy path, or expose it on the turn API.

### EX-4 — sub-MDs (line-workers) dispatched ONE-AT-A-TIME, synchronously, non-durably
- **Severity:** HIGH · **Verdict:** SEQUENTIAL-ONLY
- **Evidence:** `/api/v1/brain/dispatch` (owner/admin VP cluster) runs the
  VP's plan with `for (const spawn of plan.spawns)` awaiting each sub-MD's
  full 4-stage pipeline serially (`routes/brain-dispatch.hono.ts:256-329`).
  No `Promise.all`, no dependency graph, no fan-out. Runs inside the HTTP
  request (lost if the request dies). Sub-MDs run with no event-bus port so
  `observe` yields an empty window and outputs are DRAFT artifacts from empty
  inputs (`brain-dispatch.hono.ts:286-291`).
- **Fix:** Replace the serial loop with a dependency-ordered scheduler
  (topological levels → `Promise.all` per level), move execution to a durable
  worker (persist a run + per-step rows, return 202), and wire a real
  event-bus source into `observe`.

### EX-5 — `spawn_sub_md` in the main-loop NEVER executes (breadcrumb ack only)
- **Severity:** BLOCKER · **Verdict:** STUB
- **Evidence:** The dispatcher returns `spawn_ack` and only forks if a
  `spawnHandler` is injected (`kernel/orchestrator/tool-dispatcher.ts:16-20,
  146-174`). The production sovereign wiring builds the dispatcher via
  `createToolDispatcher({ registry, logger })` with **no `spawnHandler`**
  (`composition/brain-kernel-wiring.ts:881-893`; `sovereign.ts` builds the
  block the same way). So any time the brain decides to spawn a sub-agent
  mid-turn, the loop receives a fake ack, treats it as fire-and-forget, and
  continues — the sub-agent's work is never done.
- **Fix:** Wire a real `spawnHandler` that runs (or enqueues) a child
  orchestrator with the parent's permission-mode + risk-tier ceiling, and
  surface the child result back into the parent loop (or as a durable job).

### EX-6 — Subagent team dispatch persists 'pending' rows with NO executor (dead-end)
- **Severity:** BLOCKER · **Verdict:** BLOCKED
- **Evidence:** `POST /api/v1/md-agentic/subagents/dispatch`
  (`routes/md-agentic.hono.ts:268-349`) calls
  `repo.dispatchSubagentTeam(...)`, which inserts each member at status
  `'pending'` with the comment **"NO real spawn — an executor (when wired)
  flips these to completed/failed"** (`md-agentic-repository.ts:246-247`). No
  code anywhere transitions these rows (grep for `md_subagent_runs` finds only
  the schema, the dispatch insert, and the read-side aggregate). The response
  literally tells the user "results aggregate once an executor completes
  them" (`md-agentic.hono.ts:332-335`). `GET …/aggregate` therefore always
  returns zero completed.
- **Fix:** Implement + wire the executor worker (consume pending
  `md_subagent_runs`, run each member through the brain with its
  `allowedTools` + `tokenBudget`, write `result`, flip status), or return a
  503/honest-degrade instead of a misleading 201.

### EX-7 — Ported multi-agent stack (swarm/crew/supervisor/group-chat) is a pure ORPHAN
- **Severity:** MED · **Verdict:** ORPHAN
- **Evidence:** `createPortedAgentStackBundle()` bundles `agent-orchestrator`
  (swarm/crew/supervisor/group-chat/durable-execution), `agent-runtime`,
  `agentic-os`, etc. (`composition/ported-agent-stack-wiring.ts:99-110`). It
  is registered in the service registry (`service-registry.ts:1725, 2644`) but
  **never invoked** — grep for `portedAgentStack` outside the type/registration
  returns nothing. The genuine swarm runtime (`agent-orchestrator/src/multi-
  agent/swarm.ts`) is on no user path.
- **Fix:** Either route a real superpower (e.g. the subagent-team executor in
  EX-6) through `agentOrchestrator.swarm`/`crew`, or delete the bundle to stop
  signalling capability the product doesn't deliver.

### EX-8 — Orchestrator default path SKIPS the disciplined post-LLM rails (confidence/judge/drift/policy)
- **Severity:** HIGH · **Verdict:** SEQUENTIAL-ONLY
- **Evidence:** When the orchestrator returns `answer`,
  `translateOrchestratorResponse` hard-codes confidence to 1 on every axis and
  every gate to `'pass'` (`kernel.ts:3587-3599`) — the legacy steps 9-11a
  (judge + regen, drift detection, policy gate, uncertainty policy) are not
  re-run. Only the 9 PreToolUse hooks gate the turn. The route adds back only
  the evidence-chain auditor (`brain.hono.ts:1106`). Inviolable/policy/drift
  refusal text claims these rails fire "inside think()" but the orchestrator
  main-loop has no policy-gate/drift/uncertainty step (`main-loop.ts` has
  none).
- **Fix:** Run the kernel's confidence scorer + policy gate + uncertainty
  policy on the orchestrator's answer text before translation, instead of
  stamping confidence 1 / gates pass.

### EX-9 — No live token streaming — both paths buffer then fake-chunk
- **Severity:** MED · **Verdict:** SEQUENTIAL-ONLY
- **Evidence:** Persona path: `streamTurn` does `await
  orchestrator.handleTurn(req)` (full result) then yields fixed-size chunks
  with an artificial `chunkDelayMs` (`ai-copilot/src/orchestrator/
  orchestrator.ts:1144-1175`). Orchestrator path: `streamViaOrchestrator`
  awaits the full decision then yields ONE `text_delta` with the entire text
  (`kernel.ts:3732-3760`, docstring: "emits decisions, not tokens … Token-
  level streaming … is a follow-up"). The SSE route then re-slices into
  80-char chunks (`brain.hono.ts:1231`). Users wait for the whole answer
  before the first visible token, despite an SSE UX.
- **Fix:** Stream from the provider SDK (`messages.stream`) through the
  orchestrator router and forward real deltas; today the router is request/
  response only.

### EX-10 — `/workflow` engine is IN-MEMORY only despite claiming to be the durable replacement
- **Severity:** HIGH · **Verdict:** STUB
- **Evidence:** `workflow-engine-wiring.ts` docstring: replaces "the in-memory
  engine that lost every run on restart" with a "persistent" engine — but the
  actual wiring constructs `createInMemoryRunRepository`,
  `createInMemoryRunEventRepository`, `createInMemoryAuditChainRepository`,
  `createInMemoryApprovalRouter`, `createInMemoryAssignmentRepository`, etc.
  (`composition/workflow-engine-wiring.ts:51-69`), with Drizzle adapters
  marked "future" (`:14`). `/workflow` runs (`routes/workflow/index.ts:135,
  224, 254, 284`) therefore still lose ALL state on restart — the four-eyes
  approval queue, run history, and the "append-only" audit chain are volatile.
- **Fix:** Land the Drizzle-backed repositories and swap the in-memory ports
  for them; the audit-chain claim (SOC2 CC7.2) is currently false.

### EX-11 — Durable Inngest executor exists but is wired to NOTHING
- **Severity:** MED · **Verdict:** ORPHAN
- **Evidence:** `central-intelligence/src/durable/inngest-executor.ts` slices a
  task-agent run into checkpointed `step.run(...)` calls with deterministic
  idempotency, opt-in via `DURABLE_EXEC_ENABLED` (`:25-28`). But grep for live
  `src` importers of `durable/inngest` returns only `dist/*.map` artifacts —
  no source file imports it. The one real durability primitive in the kernel
  is dark.
- **Fix:** Wire the durable executor at the composition root for the
  task-agent crons (and/or the subagent-team executor from EX-6) so a crash
  mid-batch resumes from the last step instead of replaying/losing the run.

### EX-12 — research-orchestrator is the ONE real PARALLEL engine, but runs inline (blocks the request)
- **Severity:** MED · **Verdict:** PARALLEL-WIRED
- **Evidence:** `plan-runner.ts:87-99` does a real `Promise.all` fan-out when
  `parallel: true`; anticipatory-sweep sets `parallel: true` for 3 parallel
  plans (`modes/anticipatory-sweep.ts:61, 100`); there is a budget-gate
  pause/resume and a `long-running-checkpoint.ts`. It IS mounted at
  `/api/v1/research` (`api-gateway/src/index.ts:1620`). **But** the user
  endpoints `reactiveQuery` / `deepDive` are invoked with `await
  engine.reactiveQuery(...)` / `await engine.deepDive(...)` inline in the
  request handler (`routes/research/research.router.ts:142, 206`) — no 202 +
  background job — so a deep-dive blocks the HTTP connection and is not
  resumable if it drops. The parallel path is only exercised by the
  cron-driven sweep, not the user query endpoints.
- **Fix:** Make `deepDive` a 202 + durable job (it already has the checkpoint +
  pause primitives); have the user endpoint enqueue + return a runId the UI
  polls/streams. The engine is the model the rest of the system should follow.

### EX-13 — Brain-turn checkpoints + memory are in-memory (orchestrator session not durable)
- **Severity:** MED · **Verdict:** SEQUENTIAL-ONLY
- **Evidence:** The main-loop `sessionStore.resumeOrCreate` /`checkpoint`
  (`main-loop.ts:414, 1036`) is satisfied in production by the in-memory
  session store (the comment at `main-loop.ts:427-435` describes the in-memory
  SessionStore as "the default"). Working memory persists to `agent_memory`
  via the Drizzle memory tool (`sovereign.ts:827`), so cross-turn notes
  survive, but the per-turn agentic transcript/plan/budget checkpoints do not
  — a crash mid-turn loses the in-flight tool loop with no resume.
- **Fix:** Back the orchestrator `SessionStore` + `PlanStore` with Drizzle so a
  long multi-tool turn is resumable.

### EX-14 — VP→sub-MD plan has no dependency ordering or concurrency model
- **Severity:** LOW · **Verdict:** SEQUENTIAL-ONLY
- **Evidence:** `VpOrchestrationPlan.spawns` is a flat list executed in array
  order (`brain-dispatch.hono.ts:256`); the spawn shape carries no
  `dependsOn`/`level`, so even a future parallel executor has no edges to
  schedule against. Honest-degrade for unknown line-workers is correct
  (`registry.ts:11-18`) but the plan is not a DAG.
- **Fix:** Add `dependsOn` to the spawn shape so a scheduler can run
  independent sub-MDs concurrently and chain dependent ones.

---

## blockedFlows (user-invokable paths that cannot complete end-to-end)

1. **Subagent team dispatch** — `POST /api/v1/md-agentic/subagents/dispatch`
   persists members at `'pending'` and returns 201, but no executor ever runs
   them; `GET …/aggregate` always reports zero completed (EX-6).
2. **Mid-turn sub-agent spawn** — any brain turn whose plan emits
   `spawn_sub_md` gets a fake `spawn_ack`; the child agent never executes, so
   any answer that depends on the spawned sub-agent's work silently completes
   without it (EX-5).
3. **Durable workflow resumption** — a `/workflow` run (incl. its four-eyes
   approval queue + "append-only" audit chain) is lost on any api-gateway
   restart because every repository is in-memory (EX-10).
4. **VP cluster dispatch under request loss** — `/brain/dispatch` runs all
   sub-MDs inside the HTTP request with no persistence; a dropped connection
   or restart loses the entire fan-out with no resume (EX-4, EX-13).
5. **Deep-dive research under connection loss** — `/research` deep-dive runs
   inline and blocks; despite having checkpoint primitives it is not exposed
   as a resumable job, so a long run that drops is lost to the caller (EX-12).

---

## What IS real (so the picture is honest)

- The orchestrator main-loop is a genuine, working ReAct agent (tool search →
  LLM → 9-hook governance → dispatch → fold-back → re-plan) with budget,
  permission-mode, plan-mode preview, and a real tool registry +
  persona-tool catalog bridged in (`sovereign.ts:842-872`). It is the live
  generation default and it works — it is just **sequential and not durable**.
- The 9 PreToolUse/PostToolUse/Stop hooks (four-eye, PII scrub, denylist,
  rate-limit, cost-circuit, sandbox-divert, audit, ledger-seal) are real and
  wired (`sovereign.ts:874-894`).
- The evidence-chain auditor enforcement on the JSON path is real
  (`brain.hono.ts:961-1023`).
- research-orchestrator is a real Planner/Executor/Scorer/Synthesizer with
  true parallel fan-out + checkpoint + budget pause (EX-12) — the reference
  pattern the rest of the system should adopt.
- The debate, synthesizer, LATS, Inngest-durable, and swarm/crew packages are
  real implementations — they are simply not wired onto a user path.

---

## Priority remediation order

1. **EX-6 / EX-5** (BLOCKER) — wire a real executor for subagent teams +
   `spawn_sub_md`, or honest-degrade the endpoints. These are the clearest
   "user invokes a superpower that never completes" dead-ends.
2. **EX-10** (HIGH) — back the workflow engine with Drizzle; the durability +
   SOC2 audit-chain claims are currently false.
3. **EX-8** (HIGH) — stop stamping confidence 1 / gates pass on the
   orchestrator answer; re-run policy/confidence/uncertainty.
4. **EX-4 / EX-13** (HIGH) — make the VP cluster + brain-turn loop durable +
   parallel (dependency-ordered).
5. **EX-12** (MED) — convert deep-dive research to a durable 202 job (it
   already has the primitives).
6. **EX-9** (MED) — real provider token streaming.
7. **EX-2 / EX-3 / EX-7 / EX-11** (MED) — wire or remove the dark
   debate/synthesizer/swarm/durable-executor capability.
