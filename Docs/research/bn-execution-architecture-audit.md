# BossNyumba Execution-Layer Audit (`bn-execution-audit`)

**Repo audited:** `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`
**Date:** 2026-06-08
**Scope:** How the product ACTUALLY executes its AI superpowers — the execution layer (swarm / parallel fan-out / durable workflow / sequential / orphan / blocked), NOT the domain knowledge.
**Method:** Evidence-based file reads. Every claim below cites `file:line`.

---

## TL;DR verdict

The product has **two divergent brain stacks** plus a constellation of orchestration packages. The honest execution reality:

1. **Two brains, not one.** The user-facing chat actually runs through the **ai-copilot `Orchestrator`** (a deterministic, *sequential* persona state machine) on `/brain/turn` and `/ai/chat`. A *second*, more advanced **central-intelligence `Kernel`** (33-step pipeline + Claude-Code-style main-loop) runs on the `/*/jarvis` routes — but the owner's primary advisor chat pages bypass it.
2. **Sequential, not swarm.** The "12-agent kernel" is a **single-flow sequential pipeline**; debate is *intentionally serial* (Proposer→Critic→Synthesizer); VP→sub-MD dispatch runs sub-MDs in a `for` loop one-at-a-time; juniors run one per `execute()` call. There is no dependency-ordered parallel fan-out on any user path.
3. **One real parallel path exists but is dark.** The multi-LLM mixture-of-agents synthesizer (`Promise.all` fan-out) is real — but its wiring factory is **never called** and `requireSynthesis` is **never set** by any route. Dead for users.
4. **Fake streaming on the primary surface.** `/ai/chat` and `/brain/turn` "stream" by awaiting the *entire* turn then chunking the finished text. Real token streaming exists only on `/*/jarvis/stream` (kernel `thinkStream`), which the owner advisor pages don't use.
5. **Not durable by default.** Long-running execution (sub-agent spawns, scheduled wakes, monitors) defaults to an **in-memory `setInterval` supervisor** that explicitly "loses it" on restart. The durable Inngest path is code-complete but dormant (`DURABLE_EXEC_ENABLED` defaults false + needs a deployed worker).
6. **A dead-ended superpower.** `/md-agentic/subagents/dispatch` persists "agent team" runs at status `pending` and tells the user "results aggregate once an executor completes them" — **no executor ever completes them.** Aggregation returns 409 unavailable forever.
7. **Orphans.** `long-horizon-agent` (durable mission engine) is wired only to a stub UI with empty data; `self-codegen` and `action-runtime` have zero consumers; the `agentStack`/`litfinAgentStack` bundles are composed but read by no route.

---

## Execution map — how a real user request flows

### Path A — the PRIMARY chat path (customer / owner / manager / staff)

```
Browser/mobile chat
  → apps/customer-app /api/brain/turn  (proxy)  OR  owner-portal OwnerAdvisor.tsx → /api/v1/ai/chat (SSE)
    → services/api-gateway/src/routes/brain.hono.ts  POST /turn         (non-stream)
       or routes/ai-chat.hono.ts  POST /ai/chat       (SSE wrapper over streamTurn)
      → @bossnyumba/ai-copilot  Orchestrator.handleTurn()   [orchestrator/orchestrator.ts]
         1. classifyInitialTurn() — DETERMINISTIC intent router (no LLM)         :270-288
         2. resolvePersona() + estate-mode overlay                              :359-390
         3. executePersona() — tool-use loop (≤5 iters), AdvisorExecutor        :392-593
            · executor LLM (Sonnet/Haiku/Opus by persona tier) + optional Opus advisor
            · tool calls dispatched SEQUENTIALLY in a for-loop                  :548-588
         4. PROPOSED_ACTION → ReviewService gate (held if risk≥floor)           :740-794
         5. HANDOFF_TO → RECURSE into target persona (depth-bounded 3)          :674-738
      → auditChatResponse() evidence gate                                       brain.hono.ts:340
```

This is a **sequential persona state machine** — the file's own header says so: *"deterministic state machine routing turns through personae. It does NOT use an LLM for routing"* (`orchestrator.ts:1-7`). Personas chain via **recursion on handoff**, never in parallel.

### Path B — the JARVIS path (kernel; `/customer|owner|manager|admin|platform/jarvis`)

```
POST /*/jarvis/think  (or /stream)   [routes/jarvis-router-factory.ts:330, :425]
  → sov.kernel.think(req)                                          :362
    → @bossnyumba/central-intelligence  Kernel.think()  [kernel/kernel.ts:538]
       · 33 sequential trace steps (grep traceStep = 33)
       · step 7 = SINGLE sensor call by default (one LLM)          kernel.ts:296-307
       · optional debate detour (serial Proposer→Critic→Synth)     kernel.ts:1154
       · LIVE-by-default main-loop when ANTHROPIC_API_KEY present   brain-kernel-wiring.ts:616, service-registry.ts:2693
          while(budget && !plan.complete){ router.call → dispatch → checkpoint }   main-loop.ts:1-37
          · spawn_sub_md = FIRE-AND-FORGET child turn (not awaited back)  registry-dispatcher.ts:290-414
```

Real token streaming on `/stream` via `kernel.thinkStream` → SSE `for await` (`jarvis-router-factory.ts:484`). But owner advisor pages stream from `/ai/chat` (Path A), not here.

---

## Findings

### BN-EXE-01 — The 12-agent kernel runs SEQUENTIALLY, not as a parallel swarm/debate `[HIGH]`
- **Area:** `packages/central-intelligence/src/kernel/kernel.ts:538` (`think`), `:296-320`
- **Evidence:** `think()` is a single linear pipeline of 33 `traceStep(...)` stages. Step 7 is a *single* sensor (one LLM) by default. The kernel header for the synthesizer port (`kernel.ts:317-318`) states the contrast explicitly: *"synthesis runs N providers ONCE in parallel and merges; debate runs N voices × R rounds **sequentially**."* The three-agent debate (`debate/three-agent-debate.ts:21-23`) documents *"Why strict serial order? … No parallel calls — concurrent execution would race the LLM stream."*
- **Verdict:** SEQUENTIAL-ONLY
- **Fix:** This is partly intentional (debate must be serial). But the marketed "12 agents deliberating" is, on the user path, one LLM call + optional serial debate. If a parallel persona panel is desired, add a `Promise.allSettled` fan-out of independent critic personas before synthesis — the synthesizer (BN-EXE-04) is the right primitive but is not wired.

### BN-EXE-02 — Two divergent brain stacks; primary chat uses the weaker, sequential one `[HIGH]`
- **Area:** `services/api-gateway/src/routes/brain.hono.ts:327-373` vs `routes/jarvis-router-factory.ts:362`; consumers: `apps/owner-portal/src/pages/OwnerAdvisor.tsx:49` + `ManagerChat.tsx:62` → `/api/v1/ai/chat`
- **Evidence:** `/brain/turn` and `/ai/chat` route into the ai-copilot `Orchestrator` (sequential state machine). The advanced kernel (main-loop, tool-search, hook-chain, debate, durable actuators) lives behind `/*/jarvis`. The owner's actual production advisor surfaces call `/ai/chat` (`OwnerAdvisor.tsx:49`), i.e. the *Orchestrator*, not the kernel. The two stacks have separate thread stores, separate persona systems, separate audit gates.
- **Verdict:** PARALLEL-WIRED (two parallel implementations of the same superpower; user gets the lesser one)
- **Fix:** Pick one canonical brain. Either route `/ai/chat` and `/brain/turn` into `kernel.thinkStream`, or formally deprecate the kernel `/jarvis` stack. Maintaining both doubles the policy/audit/streaming surface and guarantees behavioural drift.

### BN-EXE-03 — Streaming on the primary surface is FAKE (full turn computed, then chunked) `[HIGH]`
- **Area:** `packages/ai-copilot/src/orchestrator/orchestrator.ts:1067-1147` (`streamTurn`); consumed by `services/api-gateway/src/routes/ai-chat.hono.ts:288-303`
- **Evidence:** `streamTurn` does `const result = await orchestrator.handleTurn(req)` (`:1096`) — the **entire** turn (all LLM calls, all tool loops, all handoffs) completes first — then it slices `turn.responseText` into 24-char deltas with a 12ms artificial delay (`:1141-1147`). Tool-call/tool-result chips are emitted *after the fact* from the completed accumulator, not as they happen. The header admits it: *"we await the real turn, then emit coarse delta events (chunked from the final response text)"* (`:983-993`). The user waits for the whole answer, then watches a typewriter replay.
- **Verdict:** STUB (streaming illusion)
- **Fix:** Real streaming requires threading the Anthropic SSE stream through `AdvisorExecutor`/`executePersona`. The kernel already does this (`kernel.thinkStream` + sensor `callStream`, `kernel.ts:2058`); the cheapest fix is BN-EXE-02 (route the primary surface to the kernel stream).

### BN-EXE-04 — Real parallel multi-LLM fan-out exists but is NEVER wired and NEVER triggered `[HIGH]`
- **Area:** `packages/ai-copilot/src/providers/multi-llm-synthesizer.ts:169-170` (`Promise.all` fan-out); wiring `services/api-gateway/src/composition/multi-llm-synthesizer-wiring.ts:202`
- **Evidence:** The synthesizer is a genuine Mixture-of-Agents: *"Fan out the user prompt to N proposers in parallel"* (`:13`), `await Promise.all(proposerOutcomes)` (`:170`). BUT: (a) `createMultiLLMSynthesizerWiring(` is **never called** anywhere outside its own definition (grep finds only comments + the `export function`); (b) `service-registry.ts`'s `createBrainKernelWiring({...})` call never passes a `synthesizer` dep; (c) the kernel only fans out when `req.requireSynthesis === true` (`kernel.ts:1138-1140`), and `requireSynthesis` is **set by no route** — the jarvis `ThinkSchema` (`jarvis-router-factory.ts:313-318`) has no such field and the `req` built at `:335-344` omits it.
- **Verdict:** ORPHAN (the only true parallel-fan-out primitive is dead code on the user path)
- **Fix:** Call `createMultiLLMSynthesizerWiring(...)` in `service-registry.ts`, thread its result into `createBrainKernelWiring({ synthesizer })`, and set `requireSynthesis` on high-stakes turns in `jarvis-router-factory.ts` (e.g. `requireSynthesis: body.stakes === 'critical'`).

### BN-EXE-05 — `/md-agentic/subagents/dispatch` is a dead-ended superpower (no executor) `[BLOCKER]`
- **Area:** `services/api-gateway/src/routes/md-agentic.hono.ts:257-334` (dispatch) + `:336-372` (aggregate)
- **Evidence:** Dispatch persists team runs at `status: 'pending'` and returns the literal message *"Runs persisted at status 'pending'; results aggregate once an executor completes them."* (`:325-327`). The route header confirms *"honest-degrade: persists 'pending' runs"* and aggregation *"NEVER fabricates results"* returning 409 unavailable (`:17-19, :29-33`). A repo-wide grep for any code that transitions `md_subagent_runs` from `pending` → `completed`/`running` finds **nothing** (only unrelated `status:'completed'` writes in HR/payments/missions). The owner can dispatch a "team" and poll aggregate forever; it never completes.
- **Verdict:** BLOCKED
- **Fix:** Either (a) wire an executor (a worker that reads `pending` md_subagent_runs, runs each member brief through the kernel/agent loop, writes results, flips status), or (b) hide the dispatch UI behind a feature flag until the executor ships. Shipping a "dispatch a team" button that can never complete is the worst of the options.

### BN-EXE-06 — Sub-MD / VP dispatch (the genuine multi-agent path) runs sub-agents SEQUENTIALLY `[MED]`
- **Area:** `services/api-gateway/src/routes/brain-dispatch.hono.ts:272-323` (`runSubMdChain`), mounted `index.ts:1149`
- **Evidence:** `/brain/dispatch` is real and mounted: a VP `orchestrate()`s an instruction into a plan of line-worker spawns, then each spawn's 4-stage pipeline (observe→map→redesign→automate) runs in a plain `for (const spawn of plan.spawns)` loop (`:272`), each fully `await`-ed before the next (`:303-306`). No `Promise.all`. Also: the `observe` stage *"yields an empty in-scope window"* because no event-bus port is wired (`:298-302`) — the sub-MDs reason over empty observation graphs.
- **Verdict:** SEQUENTIAL-ONLY (and partially blind)
- **Fix:** Replace the serial loop with `Promise.allSettled(plan.spawns.map(runOne))` (sub-MDs are independent → safe to parallelise), and wire a real event-bus port so `observe` returns actual tenant events instead of an empty window.

### BN-EXE-07 — Sub-agent spawns are fire-and-forget; results never rejoin the parent (no gather) `[MED]`
- **Area:** `packages/central-intelligence/src/kernel/orchestrator/adapters/registry-dispatcher.ts:290-414` (`dispatchSpawnSubMd`)
- **Evidence:** The header states *"ALWAYS returns spawn_ack so the parent's loop keeps going (fire-and-forget)"* (`:294-296`). The child is launched via `spawner.spawn(...)` and the dispatcher immediately returns `spawn_ack` (`:413`); the child's output is **not** awaited into the parent's transcript/reasoning. The concurrency semaphore releases on admission, not on child completion (`:396-406`). So this is task offloading, not a coordinated swarm where a planner gathers sub-agent results to synthesize an answer.
- **Verdict:** SEQUENTIAL-ONLY (the parent turn does not consume child results within the turn)
- **Fix:** For a true map-reduce swarm, add a `gather` Decision variant (or a blocking `spawn_and_await`) that collects child results back into the parent's context before the final `respond_to_owner`. Today the parent answers without ever seeing what its children produced.

### BN-EXE-08 — Long-running execution is NOT durable by default (in-memory, lost on restart) `[HIGH]`
- **Area:** `packages/central-intelligence/src/durable/in-process-wake-scheduler.ts:30, :214-217, :434`; wiring `services/api-gateway/src/composition/service-registry.ts:2405, :2520-2541, :2626-2628`
- **Evidence:** The PRIMARY actuator for `schedule_wake`/`monitor` is the in-process supervisor, which stores state in `new Map()` (`:214-215`) driven by `setInterval` (`:434`), and documents *"a restart in the wait window loses it. That is the truthful mode."* (`:30`). The durable Inngest path is gated on `DURABLE_EXEC_ENABLED === 'true'` which **defaults false** (`service-registry.ts:2405`), and even when enabled the in-process Inngest runtime's `step.sleepUntil` *"resolves immediately … no control plane to park the function … needs a deployed Inngest worker"* (`:2623-2628`). So scheduled wakes, monitors, and spawned children do not survive a process restart in the default deployment.
- **Verdict:** BLOCKED (durability claim unmet by default)
- **Fix:** Either deploy an Inngest worker and set `DURABLE_EXEC_ENABLED=true` (the code path is complete), or back the wake/monitor state with a Postgres table + a multi-replica-safe poller (the outcome-reconciliation-worker at `workers/outcome-reconciliation-worker.ts:108` already shows the advisory-lock pattern to copy).

### BN-EXE-09 — `long-horizon-agent` (durable mission engine) is an ORPHAN — wired only to a stub UI `[MED]`
- **Area:** package `packages/long-horizon-agent/src/step-dispatcher.ts`; only consumer `apps/owner-portal/src/pages/missions/MissionsPage.tsx`
- **Evidence:** The package has a real step-dispatcher, drift-detector, and outcome-writer (mission `planning→active→completed` transitions, `step-dispatcher.ts:104`). Its sole non-test, non-dist consumer is `MissionsPage.tsx`, which uses `useMissionsStub()` returning `{ data: [], isLoading: false }` (`MissionsPage.tsx:32`) with TODOs to wire `useMissions`/`useMission`/`applyCheckpoint`. There is **no missions backend route** (no `services/**/missions*.ts`). The mission engine has no user-reachable entry point.
- **Verdict:** ORPHAN
- **Fix:** Add a `/missions` Hono route that drives `long-horizon-agent`'s step-dispatcher, and replace `useMissionsStub` with real data hooks. Until then it is built capability with zero reach.

### BN-EXE-10 — `self-codegen` and `action-runtime` have ZERO consumers `[LOW]`
- **Area:** packages `packages/self-codegen/`, `packages/action-runtime/`
- **Evidence:** Repo-wide grep for `@bossnyumba/self-codegen` / `self-codegen` across `services apps packages` (excluding the package itself + dist + tests) returns **nothing**. Same for `@bossnyumba/action-runtime`.
- **Verdict:** ORPHAN
- **Fix:** Wire or delete. Dead packages inflate the dependency graph (knip should be flagging these) and the "self-improving codegen" capability claim.

### BN-EXE-11 — `agentStack` / `litfinAgentStack` bundles composed but read by no route `[LOW]`
- **Area:** `services/api-gateway/src/composition/service-registry.ts:1507, :1513, :2266, :2272` (composed); consumers: none
- **Evidence:** Both bundles are constructed into the services bag (`createAgentStackBundle(...)`, `createLitfinAgentStackBundle()`), but grep for `services.agentStack` / `services.litfinAgentStack` across `routes/` + `index.ts` finds **no reader**. The CI `agent` (in-tree loop) is read by exactly one route (`routes/intelligence.hono.ts:104`), and the `/ask` advisor route uses the separate `role-aware-advisor` (`routes/ask/ask.hono.ts:117-118`), not the agent stacks.
- **Verdict:** ORPHAN (composed-but-unwired)
- **Fix:** Remove the bundles from the services bag or mount a route that uses them. Composing them on every boot pays the construction cost for capability nothing can invoke.

### BN-EXE-12 — Juniors / task-agents dispatch one-at-a-time, not as a dependency-ordered swarm `[MED]`
- **Area:** `packages/ai-copilot/src/task-agents/executor.ts:105-247`; route `services/api-gateway/src/routes/task-agents.hono.ts:169`
- **Evidence:** `TaskAgentExecutor.execute()` runs exactly ONE agent per call (`:108` looks up a single agent by id, `:224` runs it). The header describes the supervisor as *"a cron supervisor iterating the whole registry"* (`:15`) — sequential iteration. The route invokes a single `executor.execute({...})` (`task-agents.hono.ts:169`). There is no scheduler that builds a dependency DAG of juniors and fans them out.
- **Verdict:** SEQUENTIAL-ONLY
- **Fix:** If "junior swarm" is a product claim, add a junior-orchestrator that resolves inter-junior dependencies and runs independent juniors via `Promise.allSettled`. Today juniors are isolated single-shot agents.

---

## What IS real and correctly wired (for balance)

- **`workflow-engine`** — wired to `/workflow` routes (`routes/workflow/index.ts`, `composition/workflow-engine-wiring.ts`). A real definitions/runs/approval/audit state machine. `[WIRED]`
- **`module-orchestrator`** — wired to `/modules` (`routes/modules.hono.ts`) + owner/manager UIs. `[WIRED]`
- **`closed-loop`** outcome reconciliation — real 6h-tick worker with Postgres advisory lock for multi-replica safety (`workers/outcome-reconciliation-worker.ts:108`). `[WIRED]`
- **`proactive-triggers-worker`** — real hourly `setInterval` sweep with idempotency cache (`services/proactive-triggers-worker/src/index.ts:57-100`). `[WIRED]`
- **`brain-dispatch` VP→sub-MD** — real, mounted, honest-degrading multi-agent dispatch (just serial — see BN-EXE-06). `[SEQUENTIAL-ONLY]`
- **Kernel `thinkStream`** — genuine token streaming via sensor `callStream` on `/*/jarvis/stream` (`jarvis-router-factory.ts:484`, `kernel.ts:2058`). `[SWARM-WIRED for streaming; just not used by the owner advisor surface]`
- **Multi-LLM synthesizer** — genuine `Promise.all` parallel fan-out logic (`multi-llm-synthesizer.ts:170`) — correct, just unwired (BN-EXE-04).

---

## Blocked flows (cannot complete end-to-end for a user)

1. **Agent-team dispatch** — `POST /md-agentic/subagents/dispatch` → poll `GET /md-agentic/subagents/:id/aggregate` → forever `pending` / 409 unavailable (no executor). [BN-EXE-05]
2. **Long-horizon missions** — owner-portal `/missions` renders, but `useMissionsStub` returns `[]` and there is no missions backend; create/track a mission is impossible. [BN-EXE-09]
3. **Deep-reasoning / multi-model synthesis** — no route sets `requireSynthesis` and the synthesizer wiring is never called; the parallel MoA path is unreachable. [BN-EXE-04]
4. **Durable scheduled wake / monitor across restart** — a `schedule_wake` or `monitor` armed before a process restart is silently lost by default (in-memory supervisor); the "wake me when X happens" superpower does not survive a redeploy. [BN-EXE-08]

---

## Severity rollup

| Severity | Findings |
|---|---|
| BLOCKER | BN-EXE-05, BN-EXE-08 |
| HIGH | BN-EXE-01, BN-EXE-02, BN-EXE-03, BN-EXE-04 |
| MED | BN-EXE-06, BN-EXE-07, BN-EXE-09, BN-EXE-12 |
| LOW | BN-EXE-10, BN-EXE-11 |

## Highest-leverage fixes (ordered)

1. **Unblock or hide the agent-team dispatch** (BN-EXE-05) — ship the executor worker or feature-flag it off.
2. **Make durability real** (BN-EXE-08) — deploy Inngest + flip `DURABLE_EXEC_ENABLED`, or Postgres-back the wake/monitor state.
3. **Converge the two brains and the streaming surface** (BN-EXE-02 + BN-EXE-03) — route `/ai/chat` to the kernel stream; kill the fake `streamTurn`.
4. **Turn on the one real parallel path** (BN-EXE-04) — wire the synthesizer + set `requireSynthesis` on high-stakes turns.
5. **Parallelise the independent sub-agents** (BN-EXE-06, BN-EXE-12) — `Promise.allSettled` where there is no data dependency.
