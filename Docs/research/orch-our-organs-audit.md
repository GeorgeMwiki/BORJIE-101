# Orchestration-for-Our-Organs — TODAY vs SOTA Audit

**Lane:** orchestration-for-our-organs (REPO READ-ONLY)
**Date:** 2026-06-09
**Author:** subagent audit (read/grep/glob, minimal web)
**Scope:** How does the Mind orchestrate the modality-arbiter + juniors + workflow-engine + loop-runner + actuators + blackboard TODAY, and what is the gap to SOTA? Both repos (Borjie + BossNyumba) parity.

---

## 0. TL;DR verdict

Borjie has **two parallel orchestration spines that do not yet meet**, plus a third (blackboard) that is **architecturally present but has no runtime caller**.

1. **The DEFAULT live spine is a single-shot Supervisor.** Every consequential turn flows through `chat-orchestrator.ts` → `master-brain.ts` (one Opus call emits a `dispatch_plan`) → `executor.ts` runs the juniors **sequentially** (`parallel: false`), Auditor last. This is a classic **orchestrator-worker / supervisor** topology, but it is **single-pass, not durable, not recursive, and not blackboard-coordinated**.
2. **The disciplined spine (the orchestrator main-loop + modality-arbiter) is built but FLAG-GATED OFF and partially stubbed.** `main-loop.ts` (the Claude-Code-grade while-loop) is behind `BORJIE_ORCHESTRATOR_MAINLOOP` (default off). The **modality-arbiter** — the 7-way head that makes SKILL/WORKFLOW/LOOP/AGENT reachable — is real (`modality-arbiter.ts`), correctly inserted into the loop (`main-loop.ts:751`), correctly composed (`brain-kernel-wiring.ts:1005`), but gated behind `BORJIE_MODALITY_ARBITER` (default off) AND its LOOP executor is a **stub** (`createLoopRunnerAdapter` returns a breadcrumb id — `orchestrator-bindings.ts:1117-1126`).
3. **The blackboard control-shell `pickNext` — the "natural scheduler" — has NO runtime caller.** `createControlShell` / `pickNext` exist (`control-shell.ts`) with full activation-policy scoring, but `grep` across `services/`, `apps/`, and non-blackboard packages finds **zero callers outside `__tests__`/`__fixtures__`/`dist`**. The blackboard is a library, not a live coordination spine. (Confirms gap EA-05 in MASTER_GAP_REGISTER.)
4. **The resident EstateMind Slow Loop IS wired into a live, leader-elected heartbeat** (`estate-mind-wiring.ts` + `index.ts:3173`), but it is `PERCEIVE→ORIENT→MOTIVATE→PROPOSE` only — it surfaces proposals through the gated nudge sink; it **does not dispatch** the arbiter/juniors/workflow. It is the autonomous *sensor*, not yet the autonomous *actuator*.

**Net:** the organs exist; the **conductor that joins them into ONE durable, dynamic, recursive, blackboard-coordinated graph does not run by default.** Today's production orchestration is a one-shot supervisor with sequential juniors. Everything richer (modality routing, loops, durable workflow, the blackboard scheduler) is built-but-dark.

---

## 1. The orchestration topology TODAY (what actually runs on a turn)

### 1a. Default live path — single-shot Supervisor (orchestrator-worker)
```
chat-orchestrator.ts:209  createDefaultMasterBrainAgent()
                    :210  masterBrain.processInput()   → ONE Opus call → dispatch_plan[]
                    :256  executeJuniors({ ..., parallel: false })   ← SEQUENTIAL
executor.ts:260-263  for (const step of dispatchPlan) { await executeOne(step) }
master-brain.ts:232  Auditor force-appended last
```
- **Topology:** Supervisor (Mr. Mwikila routes to domain juniors). This is the right *shape* and matches the ORCHESTRATION_SPEC §3 "Supervisor by default."
- **Coordination:** none between juniors. `master-brain.ts:104` emits a `parallel_group` field in the dispatch plan, **but the executor ignores it** — `executor.ts:255` only honors a boolean `parallel` toggle, and production passes `parallel: false`. So even the plan's declared parallelism is discarded.
- **Recursion:** none. Juniors are leaf calls (`agent.processInput`); they cannot themselves dispatch sub-teams on this path.
- **Memory between juniors:** none. Each junior gets a freshly *synthesized* input (`synthesizer.ts`, a Haiku call) from the chat message; there is no shared working memory / blackboard the juniors read and write.

### 1b. The disciplined path — orchestrator main-loop (FLAG-GATED)
`main-loop.ts` is a real ReAct while-loop (`while budget.remaining() && !plan.isComplete()`): toolSearch → memory recall → compaction → `router.call` → **modality-arbiter** → permission-mode → 9-hook PreToolUse → `dispatch` → PostToolUse → checkpoint → `plan.advance`. It has budget, plan-tree, checkpoint/session store, hook-chain, and stage-event-bus. **But** it is opt-in at composition (`brain-kernel-wiring.ts:739`, `BORJIE_ORCHESTRATOR_MAINLOOP` default off) and the live `/brain/turn` uses the legacy kernel as a *pre-flight gate* only (MASTER_GAP_REGISTER COG-01). So the rich loop does not generate the answer on consequential surfaces today.

### 1c. The modality-arbiter — the 7-way head (built, gated, partially stubbed)
`modality-arbiter.ts` post-classifies the router's `Decision` into `chat|tab|document|media|action|skill|workflow(+loop)` via a 3-tier cascade (rule → pgvector → cheap LLM), fail-closed to `chat`. It is:
- **Correctly inserted** AFTER `router.call`, BEFORE the rails (`main-loop.ts:751-783`) — no rail bypassed.
- **Correctly composed** with real skill/flow/posture retrievers + autonomy decider + body-change port (`brain-kernel-wiring.ts:1005-1025`).
- **Lift is real** for skill/tab/document/media/workflow (`modality-arbiter.ts:433` `liftToModalityDecision`).
- **Dispatcher handlers wired** for document/media (→ engine + PROPOSAL via portal-genui, `brain-kernel-wiring.ts:1078`) — this half is genuinely live when the flag is on.
- **BUT the LOOP/WORKFLOW executor is a stub:** the `loop` and `workflow` branches call `loopRunner.runLoop` (`brain-kernel-wiring.ts:1066`), and `createLoopRunnerAdapter` returns `{ loopRunId: 'loop_…' }` **without ever invoking the real `@borjie/loop-runner`** (`orchestrator-bindings.ts:1117-1126`, docstring admits "Not bound at this seam yet … real five-layer runLoop binding lands in a follow-up"). So `modality=loop/workflow` is a no-op breadcrumb.

### 1d. The AGENT/SWARM path — runSubagentTeam (real, but on a separate route)
`md-subagent-executor.ts:103 runSubagentTeam` is a **genuine parallel fan-out**: race-safe `claimPendingTeamMembers` (UPDATE…RETURNING), `Promise.allSettled` over members, evidence-required, honest-degrade to `failed`. The child sub-MD runs through `sub-md-spawn-handler.ts runChild` → `orchestrator.think` with tier transitivity. **This is the strongest organ.** But it is reached via the `md-agentic` route, NOT from the arbiter's `spawn_sub_md` decision on a normal chat turn — the arbiter maps `spawn_sub_md` → `action` (no lift, `modality-arbiter.ts:166`) and the dispatcher only acks the spawn unless a `spawnHandler` is injected. So the swarm exists but is not the default decomposition path for an owner question.

### 1e. The resident EstateMind — Slow Loop (live, sensor-only)
`estate-mind.ts tick()`: PERCEIVE (fold observations into the durable situational model) → ORIENT (salience snapshot) → MOTIVATE (standing drives → goals) → PROPOSE (gated nudge sink) → FORGET. Wired live via `estate-mind-wiring.ts createEstateMindSupervisor` + `index.ts:3173` (leader-elected, `BORJIE_ESTATE_MIND` default off, durable over `situational_model_entities` migration 0317). **It proposes; it does not orchestrate.** There is no path from a motivated goal → arbiter → junior/workflow dispatch. The resident Mind cannot yet *act* on its own conclusions; it can only nudge a human.

---

## 2. SOTA property scorecard

For each property: **PRESENT | PARTIAL | ABSENT** + file:line + the gap.

| # | SOTA property | Verdict | Evidence (file:line) | Gap |
|---|---------------|---------|----------------------|-----|
| 1 | **Topology-fit** (supervisor for routing, swarm for fan-out, handoff for conversational, loop for open-ended; pick per problem-class) | **PARTIAL** | Supervisor: `chat-orchestrator.ts:209-256`. Swarm: `md-subagent-executor.ts:103`. Handoff: `blackboard-sota/src/handoff/handoff.ts` (lib only). Loop: stubbed `orchestrator-bindings.ts:1117`. | Only the supervisor runs by default; swarm is on a side route; handoff/loop are dark. No per-problem-class topology selection (AFlow/MASS, addendum §"AFlow/MASS topology search"). The arbiter classifies the *modality* but never picks the *team topology*. |
| 2 | **Durable** (survives restart, resumable, checkpointed) | **PARTIAL** | Workflow-engine state machine persists every transition + hash-chained audit (`workflow-engine/src/runs/engine.ts:272-300`, `index.ts` barrel). Main-loop has `SessionStore.checkpoint` (`main-loop.ts:29`). EstateMind state is durable (`situational_model_entities`, 0317). | The DEFAULT chat-orchestrator path is **fully ephemeral** — a single in-process pass with no checkpoint; a crash mid-dispatch loses the turn. The durable workflow-engine is NOT the path a normal owner question takes. No saga/compensation executor wired to the money/licence actuators (the reversibility-typed actuator port + saga executor named in the prompt are spec, not running). |
| 3 | **Dynamic** (graph forms/reforms at runtime; nodes/connections uncapped — INV-C) | **PARTIAL** | `self-extension.ts` (detect gap → propose new sub-MD → four-eye → compile/register) gives an *unbounded catalogue*. Arbiter retrieves skills/flows by embedding at runtime (`modality-arbiter.ts:198-220`). | Self-extension exists but is not driven by a live recurring-gap detector on the default path. The orchestration **graph itself is static** — master-brain picks from a hard-coded `JUNIOR_NAMES` list (`master-brain.ts:64-94`); it cannot rewire the master-brain→juniors→synthesizer→Auditor graph per problem (AFlow/MASS, MASTER_GAP_REGISTER AUT-09). INV-C "infinite self-extending nervous system" is a catalogue-growth story, not yet a topology-growth story. |
| 4 | **Recursive** (a node can decompose into a sub-team; arbitrary depth) | **PARTIAL** | `sub-md-spawn-handler.ts runChild` → `orchestrator.think` with tier transitivity (true recursion). Tool-dispatcher acks `spawn_sub_md` and folds child result back (`tool-dispatcher.ts:181-213`). | Recursion is real ONLY on the md-agentic route / main-loop path. The default chat-orchestrator juniors are leaf calls — they cannot spawn sub-teams. So in production, the brain is **two levels deep at most** (master → junior), never recursive. |
| 5 | **Cost-aware** (effort scaling, model-class per node, budget conservation ∑c≤B) | **PARTIAL** | `Budget` primitives (`orchestrator/budget.ts`, `main-loop.ts:45`). Stakes-aware planner (`planner-dispatcher.ts:107` ToT vs LATS). Per-member token clamp (`md-subagent-executor.ts:221-225`). | Budget lives only inside the flag-gated main-loop. The default path has **no token/cost ceiling across the fan-out** (MASTER_GAP_REGISTER EXEC-budget). No Contract-Net reserve-quality bidding (addendum §Contract-Net). No "1 agent for facts, 2-4 for comparison, 10+ for research" effort-scaling rule enforced (ORCHESTRATION_SPEC §1) — master-brain picks juniors by judgment, not by a cost-bounded effort ladder. |
| 6 | **Blackboard-coordinated** (shared CRDT working memory; control-shell `pickNext` natural scheduler; handoff slots) | **ABSENT (at runtime)** | `control-shell.ts:74 createControlShell` / `pickNext` is a complete metalevel scheduler (priority × freshness × competence, dormant floor). Slots CRDT (`slots/slot-crdt.ts`), handoff (`handoff/handoff.ts`), regions/posts all exist. | **No runtime caller of `pickNext`** — grep finds it only in tests/fixtures/dist and `cognitive-wiring.ts` imports `blackboard-sota` for the *situational-model store*, not the scheduler. The juniors do NOT read/write a shared blackboard; they pass results back to the synthesizer directly. The "natural scheduler" is NOT wired. No app subscribes to slot deltas (EA-05, BLOCKER). The blackboard-as-shared-state-spine (owner directive INV-H §522-542) is unbuilt. |
| 7 | **Rail-governed** (money/licence/deletion HITL; meta-rail on capability growth; policy-gate/four-eye/kill-switch) | **PRESENT** | 9-hook PreToolUse chain incl. four-eye, permission, cost-circuit, sandbox-divert (`orchestrator/index.ts:232-268`). Arbiter is escalate-only + body-change meta-rail (`modality-arbiter.ts:316-388`). Workflow-engine reads flow posture to skip/block approval (`workflow-engine/src/runs/engine.ts:120`, `autonomy/flow-autonomy-port.ts`). | This is the strongest dimension — the rails are real and the arbiter cannot relax them. Residual: rails are enforced inside the *flag-gated* loop; the default chat-orchestrator path leans on the legacy kernel's gating, and per-decision VoI / 2-D reversibility×blast-radius gating is still flat 5-tier (addendum §1-2). Forced simulate-before-act pre-commit is ABSENT (RSS-17). |
| 8 | **IP-safe** (orchestration internals never exposed to any client — INV-H/D ABSOLUTE) | **PRESENT** | Juniors stream as typed `junior_call` SSE *events* with intents, not internal prompts (`chat-orchestrator.ts:235`). System prompt carries an "IP-protection / security-boundary terminal layer" (`main-loop.ts:91-101` personaSystemPrompt). No raw decision-trace shipped to apps. | Holds. One watch-item: the modality `run_modality`/`spawn_ack` breadcrumbs and `decision-trace` must stay platform-metadata-only (FIRE-2 already converted /decision-trace off service-role). No structural leak found in the orchestration seam. |

**Score:** PRESENT 2 (rail-governed, IP-safe) · PARTIAL 5 · ABSENT 1 (blackboard-coordinated at runtime).

---

## 3. How the resident EstateMind WOULD dispatch (and the missing wire)

Today EstateMind is `PERCEIVE→ORIENT→MOTIVATE→PROPOSE` (`estate-mind.ts:53-132`). The structurally-correct SOTA shape is **two coupled loops**:
- **Slow loop (resident):** EstateMind ticks, computes the salience snapshot (Global-Workspace broadcast = most-salient entity), evaluates standing drives → goals. ✅ built + live.
- **Fast loop (reactive):** an owner message OR a high-urgency motivated goal becomes an `OrchestratorRequest` → main-loop → **modality-arbiter classifies** → SKILL/WORKFLOW/LOOP/AGENT → executor. ❌ the goal→request bridge does not exist.

The one missing wire: `EstateMind.PROPOSE` currently only calls `proposalSink.propose` (a nudge). To become an autonomous actuator it needs a second sink that, for goals above a confidence×reversibility bar, emits an `OrchestratorRequest` into the arbiter-fronted main-loop (still gated by the rails — money/licence/deletion stay HITL). That is the join between the resident Mind and the action spine. **The blackboard `pickNext` is the natural scheduler for THIS** — motivated goals + inbound events become posts in a region; `pickNext` picks the highest priority×freshness×competence knowledge-source (junior/workflow) to activate. It is built (`control-shell.ts`) and would slot in here, but nothing calls it.

---

## 4. Both-repos parity (Borjie ↔ BossNyumba)

Same brain/orchestration substrate, domain layer differs (confirmed: BN at `…/Cursor Projects/BOSSNYUMBA101`).

| Organ | Borjie | BossNyumba | Parity note |
|-------|--------|------------|-------------|
| orchestrator main-loop | present (`orchestrator/`) | present (`packages/central-intelligence/src/kernel/orchestrator/` — has `adapters/`, `batch-api.ts`, `decision.ts`, `hook-chain.ts`, `hooks/`) | Shared spine. BN has an `adapters/` dir Borjie's orchestrator lacks at top level — worth a diff. |
| modality-arbiter | present, gated, loop-stub | **NOT FOUND** in BN orchestrator listing | Borjie is AHEAD on the 7-way head. BN must port the arbiter (MASTER_GAP_REGISTER frames arbiter as THE keystone for both). |
| blackboard-sota | present (lib, no runtime caller) | **NOT in BN `packages/`** (only ai-copilot, central-intelligence, workflow-engine surfaced) | Borjie ahead; EA-10 (BLOCKER) flags "BossNyumba has actuators but ZERO body-model layer — port system-graph/blackboard/body-change syscall to BN." |
| loop-runner | package present, adapter stubbed | not surfaced | Neither repo has a live loop executor. |
| workflow-engine | present (durable, hash-chained, flow-autonomy) | present | Likely close to parity; verify flow_autonomy_prefs ported. |
| EstateMind resident loop | built + live (leader-elected) | not surfaced | Borjie ahead; this is a recent Borjie build (tasks #25-29). |

**Parity verdict:** Borjie is the lead repo for the new organs (arbiter, blackboard, EstateMind). The shared work is identical: **wire the arbiter into the default path, give the loop-runner a real adapter, call `pickNext`, bridge EstateMind goals → arbiter.** Doing it once in the shared `central-intelligence` package serves both; the blackboard + body-model port to BN (EA-10) is the explicit cross-repo debt.

---

## 5. The five wires that turn the conductor on (priority order)

1. **Promote the arbiter-fronted main-loop to the DEFAULT consequential path** (COG-01) — demote the single-shot master-brain to the fast lane. Flip `BORJIE_ORCHESTRATOR_MAINLOOP` + `BORJIE_MODALITY_ARBITER` after the loop adapter is real. *Highest leverage; the spec's "missing piece is a head, not a heart."*
2. **Give `createLoopRunnerAdapter` a real body** (`orchestrator-bindings.ts:1117`) — bind `@borjie/loop-runner.runLoop` with the loop-quality-gates so `modality=loop/workflow` stops being a breadcrumb.
3. **Wire the blackboard `pickNext` as the live scheduler** (EA-05/EA-07) — post motivated goals + inbound estate events into regions; let `control-shell.pickNext` choose the knowledge-source; juniors read/write shared slots instead of point-to-point. Subscribe apps to slot deltas.
4. **Bridge EstateMind goals → arbiter** — second sink in `estate-mind.ts:91` that, above a confidence×reversibility bar, emits an `OrchestratorRequest` (rails intact). Turns the resident Mind from sensor into actuator.
5. **Honor parallel_group + add cost-bounded effort scaling** (`executor.ts:255`, EXEC-budget) — make juniors fan out per the plan's declared groups under a ∑c≤B token budget; reserve Opus for the hard node (Contract-Net / AFlow direction).

Then the durable-saga actuator port + forced simulate-before-act pre-commit (RSS-17) are the next-tier upgrades from ORCHESTRATION_FRONTIER_ADDENDUM.

---

## 6. Sources (repo paths)
- `packages/central-intelligence/src/kernel/orchestrator/{index,main-loop,modality-arbiter,modality-arbiter-types,tool-dispatcher,decision,planner-dispatcher,budget,plan}.ts`
- `packages/ai-copilot/src/juniors/{master-brain,executor,executor-registry,synthesizer,index}.ts`
- `packages/blackboard-sota/src/{control/control-shell,control/activation-policy,handoff/handoff,slots/slot-crdt,types,index}.ts`
- `packages/workflow-engine/src/{index,runs/engine,autonomy/flow-autonomy-port}.ts`
- `packages/loop-runner/src/{index,runner/loop-runner,types}.ts`
- `packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts`; `…/situational-model/*`; `…/motivation/*`
- `services/api-gateway/src/composition/{brain-kernel-wiring,orchestrator-bindings,estate-mind-wiring,md-subagent-executor,sub-md-spawn-handler,cognitive-wiring}.ts`
- `services/api-gateway/src/routes/mining/chat-orchestrator.ts`; `services/api-gateway/src/index.ts`
- `Docs/research/{ORCHESTRATION_SPEC,ORCHESTRATION_FRONTIER_ADDENDUM,MASTER_GAP_REGISTER}.md`
- BossNyumba: `…/Cursor Projects/BOSSNYUMBA101/packages/central-intelligence/src/kernel/orchestrator/`
