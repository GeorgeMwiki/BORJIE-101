# Borjie Orchestration-Layer Audit — Meta-Cognition + Graduated-Autonomy

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Auditor:** evidence-based codebase audit (not from memory)
**Scope:** the *current* orchestration layer vs the SOTA meta-cognition + graduated-autonomy targets.

This dossier audits six target areas. For each finding: what exists, the file:line
evidence, a REAL / PARTIAL / MISSING / ORPHAN verdict, and the concrete gap.

Verdict key:
- **REAL** — implemented AND wired into a live runtime path.
- **PARTIAL** — implemented but incomplete, advisory-only, or only partly wired.
- **ORPHAN** — real code exists but nothing in a runtime path consumes it (dead at runtime).
- **MISSING** — the capability does not exist.

---

## Executive summary

The orchestration substrate is **broad and well-built at the unit level but
selection-thin and wiring-uneven**. The single most important architectural fact:

> **A turn does NOT explicitly decide "skill vs workflow vs agent vs loop." That
> choice is entirely delegated to the LLM router, which emits one of six closed
> `Decision` variants. There is no meta-cognitive arbiter that routes among the
> four execution modalities.**

The main-loop (`main-loop.ts`) handles `tool_call`, `spawn_sub_md`,
`schedule_wake`, `monitor`, `respond_to_owner`, `final` — but contains **zero**
references to "workflow", "skill", "loop", or "recipe" as routable modalities
(grep returned nothing). The planner-dispatcher only chooses *how* to plan
(ToT vs LATS by stakes), never *which modality* to execute.

Consequence: workflows, the loop-runner, tab-as-loop, work-cycle, and the
standalone skill-library are **not reachable from a turn**. Several are ORPHANs
(real code, registered only as DB schemas, no runtime consumer).

Autonomy gating today is **global + tier/stakes + per-tool**, NOT per-flow with a
creation-time confirmation. Proactive/follow-up reasoning is real code but the
**worker that would run it is not deployed** (no Dockerfile, no k8s manifest, no
server entrypoint calls it). Situational awareness exists as **fragments**
(goal-tracker, world-model, stall-detector) but **no unified
happened/doing/todo/future/blind-spots model**.

---

## (1) How a turn decides skill vs workflow vs agent vs loop

### 1a. The Decision ADT + main-loop (the only live arbiter)

**Evidence:**
- `packages/central-intelligence/src/kernel/orchestrator/decision.ts:135-160` — the closed
  `Decision` union: `respond_to_owner | tool_call | spawn_sub_md | schedule_wake | monitor | final`.
- `packages/central-intelligence/src/kernel/orchestrator/main-loop.ts:716-720` — the loop
  asks the LLM router `await deps.router.call({ system, tools, messages })` and the *model*
  returns the Decision. The loop never classifies modality itself.
- `main-loop.ts:725-903` — per-Decision handling is purely permission-mode + hook gating,
  then `deps.dispatcher.dispatch(toRun, ctx)` (`main-loop.ts:976`).
- grep for `workflow|skill|isLoop|loopKind|recipe` in `main-loop.ts` → **no matches**.

**Verdict: PARTIAL.** A real, Claude-Code-grade agentic while-loop exists with
tool-calling, sub-agent spawn, scheduled wake, and monitors. But "skill," "workflow,"
and "loop-as-modality" are **not first-class Decision variants** — so the only two
execution modalities a turn can actually choose are **tool_call** and **spawn_sub_md**.

**Gap:** No meta-cognitive router that says "this request is best served by a
*workflow* / a *skill recipe* / a *spawned agent team* / a *standing loop*." The model
implicitly chooses tool-vs-spawn; the other two modalities are unreachable from a turn.

### 1b. Planner dispatcher (plan *style*, not modality)

**Evidence:** `packages/central-intelligence/src/kernel/orchestrator/planner-dispatcher.ts:107-132`
— `pickPlannerForStakes` routes `low|medium → ToT`, `high|critical → LATS`. This is a
cost/quality switch over two *search planners*, not a modality selector.

**Verdict: REAL** (for what it is). **Gap:** it answers "how thoroughly to search a plan,"
never "which execution machinery to use."

### 1c. agent-orchestrator (single/multi/state-machine/durable/judge)

**Evidence:**
- `packages/agent-orchestrator/src/index.ts:39-82` — `createOrchestrator` composes
  budget + durable + judge-panel + agentMap.
- Consumers: `services/api-gateway/src/composition/ported-agent-stack-wiring.ts:50,70` and
  `agent-stack-brain-wiring.ts` — but **namespace-only exposure**
  (`ported-agent-stack-wiring.ts:99-111` returns `agentOrchestrator: AgentOrchestratorNs`
  with no concrete ports wired). The module docstring (`ported-agent-stack-wiring.ts:24-27`)
  says "Requires a brain port (per-tenant, per-request); namespace-only exposure."

**Verdict: PARTIAL / near-ORPHAN.** The package is real and imported, but exposed as a
bare namespace with no brain port bound — nothing actually *runs* its single/multi-agent
patterns in a request path.

### 1d. module-orchestrator (Piece B module lifecycle)

**Evidence:** `packages/module-orchestrator/src/index.ts:15-48` — lifecycle state machine
(DRAFT→…→ARCHIVED), spawn-from-template, spawn-from-prompt, K5-gated apply. Consumer:
`services/api-gateway/src/routes/modules.hono.ts`.

**Verdict: REAL (but a different axis).** This orchestrates *module/tab lifecycle*, not
*per-turn execution modality*. It is wired to the `modules.hono.ts` route. It does not
participate in the skill/workflow/agent/loop decision.

### 1e. tab-need-detector (Piece O)

**Evidence:** `packages/tab-need-detector/src/index.ts:1-139` — full signal-scoring +
proposal-emitter + personalization + `runCron`. Consumer search: only
`packages/chat-ui/src/components/NeedSpawnBanner.tsx` and `chat-ui/dist`.

**Verdict: PARTIAL / front-end-only.** The detector library is real and its UI banner
exists, but no **backend cron/route** drives `runCron`/`scanTenant` in a deployed worker
(no api-gateway or worker consumer found). It detects *tab* needs, not execution modality.

### 1f. loop-runner / work-cycle / tab-as-loop (the "loop" modality)

**Evidence:**
- `packages/loop-runner/src/index.ts:1-56` — the five-layer loop runner (`runLoop`,
  sensors/policy/tools/quality/learning). **Only consumer is
  `packages/database/src/schemas/index.ts:471` ("Consumed by @borjie/loop-runner")** — a
  comment + schema export. grep for `runLoop` from `@borjie/loop-runner` in
  services/apps → **none**. (The `runLoop` hits in `ai-copilot/src/workflows/workflow-engine.ts:123`
  are a *different*, private method.)
- `packages/work-cycle/src/index.ts` — only referenced by `schemas/index.ts:598`. No runtime caller.
- `packages/tab-as-loop/src/index.ts` — only referenced by `schemas/index.ts:485`. grep for
  `from '@borjie/tab-as-loop'` in services/apps → **none**.

**Verdict: ORPHAN.** loop-runner, work-cycle, and tab-as-loop are real, tested packages whose
**only references are DB-schema registrations**. Nothing at runtime instantiates a loop. The
"tab-as-loop" architecture (Piece L design) is **not wired**.

**Gap (area 1 overall):** the four-modality choice is collapsed to two (tool/spawn) at the
LLM layer; the *loop* and *workflow* modalities have no path from a turn to their runtimes.

---

## (2) Workflow identification + creation + md-agentic executor + spawn_sub_md handler

### 2a. Workflow *identification* (matching a turn to a flow)

**Evidence:**
- `packages/ai-copilot/src/workflows/workflow-registry.ts:44-188` — `WORKFLOWS` is a **static
  array of 10 hand-written definitions** (`onboard_new_site`, `process_royalty_payment`, …),
  selected only by id via `getWorkflow(id)` (`:190-192`).
- `packages/workflow-engine/src/index.ts:20-26` — the other engine uses
  `BUILT_IN_WORKFLOW_DEFINITIONS` (also a fixed catalog).
- grep `identifyWorkflow|detectWorkflow|suggestWorkflow|proposeWorkflow|createWorkflowFrom`
  across packages/services → **no matches**.

**Verdict: MISSING.** There is **no runtime logic that identifies which workflow a user's turn
implies**. A caller must already know the workflow id. The brain cannot say "this conversation
is really the arrears-recovery workflow — start it."

### 2b. Workflow *creation* (authoring a new flow at runtime)

**Evidence:** `packages/dynamic-recipe-authoring/src/author/recipe-author.ts:1-40` — a real
LLM-backed authoring orchestrator (validate envelope → prompt → LLM → validate JSON → persist).
But: grep for `recipe-authoring|recipeAuthor|authorRecipe` in api-gateway routes/composition →
**no matches**; only consumer is `schemas/index.ts:959` ("Consumed by @borjie/dynamic-recipe-authoring").

**Verdict: ORPHAN.** Dynamic recipe/workflow *authoring* exists as a package but is **not mounted
to any route or composition seam** — there is no way to invoke it in production.

### 2c. The md-agentic executor (agent-team fan-out)

**Evidence:** `services/api-gateway/src/composition/md-subagent-executor.ts:103-145` —
`runSubagentTeam` claims pending members (race-safe `claimPendingTeamMembers`), runs each through
the injected brain in parallel (`Promise.allSettled`, `:118-128`), finalizes completed/failed
honestly, and enforces evidence-required (`toMemberResult`, `:232-260`). Wired:
`services/api-gateway/src/routes/md-agentic.hono.ts:59,244` calls `runSubagentTeam(...)`, and the
route is mounted at `services/api-gateway/src/index.ts:557,2223` (`api.route('/md-agentic', mdAgenticRouter)`).

**Verdict: REAL.** This is the genuine fix to the prior dead-end where members persisted at
`pending` and never ran. It is wired end-to-end.

### 2d. The spawn_sub_md handler (mid-turn child orchestrator)

**Evidence:** `services/api-gateway/src/composition/sub-md-spawn-handler.ts:344-432` — `runChild`
spawns a **real child orchestrator turn** via `orchestrator.think(childReq, childDeps)` (`:353`),
inherits permission-mode + risk-tier ceiling (`buildChildRequest`, `:215-248`, sets
`subMdRiskTierCeiling='mutate'`), bounds recursion (`DEFAULT_MAX_SPAWN_DEPTH=2`, `:134`), and
folds the child's result back into the **parent's working memory** (`foldChildResultIntoParent`,
`:317-337`) so the parent's next `recall()` tick sees it. Wired into the production dispatcher at
`services/api-gateway/src/composition/brain-kernel-wiring.ts:919-960`
(`createSubMdSpawnHandler(...)` → `createToolDispatcher({ spawnHandler })`).

**Verdict: REAL.** The prior no-op breadcrumb ack (`tool-dispatcher.ts:180-186` fallback) is now
backed by a real child run. Plan-mode + risk-tier transitivity to the child are enforced in the
main loop (`main-loop.ts:823-903`).

**Gap (area 2 overall):** execution machinery (md-agentic team + sub-MD spawn) is REAL and wired,
but the two *cognitive* halves — **identifying** the right workflow from a turn, and **authoring**
a new one at runtime — are MISSING / ORPHAN respectively. Workflows remain a static catalog of 10.

---

## (3) Skill capture / reuse

### 3a. Kernel skill-library (Voyager retriever + compiler + affinity)

**Evidence:** `packages/central-intelligence/src/kernel/skill-library/index.ts:13-40` exports
`createSkillRetriever`, `compileSkill` + `autoSuggestSkill`, and `ToolAffinityTracker`. Consumed
by the kernel: `kernel.ts:1046-1047` retrieves learned skills into the prompt and
`kernel.ts:1144-1145` renders them as a prompt fragment; threaded via `compose.ts:293,506`.

**Verdict: PARTIAL.** Skill **reuse at prompt time** (retriever surfaces promoted skills into the
system prompt) is REAL and wired. Skill **capture** (`compileSkill` / `autoSuggestSkill` — extract
a parameterised skill from a session trace) is present in code but the audit found **no runtime
caller that compiles a skill from a finished turn** (no consolidation/worker invocation of
`compileSkill` outside the package's own tests). So skills are retrieved but the loop that *creates*
them from experience is not demonstrably wired.

**Gap:** the Voyager capture half (trace → compiled skill → human-review → promote to `skill_registry`)
is not connected to any post-turn / sleep-consolidation pass found in this audit.

### 3b. Standalone `@borjie/skill-library` package

**Evidence:** `packages/skill-library/src/index.ts:22-29` — subagent-spawn, filesystem-skills,
mcp-tool-search, voyager-library, builtin-skills. Consumer search across services/apps/packages →
**zero** (grep `@borjie/skill-library` outside its own dir returned nothing, including package.json).

**Verdict: ORPHAN.** This entire package (R1 #7/#8/#9 + R3 Voyager) is dead at runtime.

### 3c. dynamic-recipe-authoring

Covered in 2b — **ORPHAN** (authoring exists, no route).

### 3d. Learned shortcuts

**Evidence:**
- `packages/chat-ui/src/lib/learned-shortcuts/ranker.ts` + `useLearnedShortcuts.ts` +
  `LearnedShortcutsPanel.tsx` — front-end ranking/UI.
- `services/api-gateway/src/routes/me-shortcuts.hono.ts:2-7,77-81` —
  `GET /api/v1/me/shortcuts` reads `user_action_tracker` rows and returns top-N ranked shortcuts.
  The docstring (`:5-7`) notes this closed the gap where the front-end "had no gateway route."

**Verdict: REAL (read path).** Capture is the existing `user_action_tracker` table (action logging,
migration 0183 per MEMORY.md); the route ranks and serves them. This is a *usage-frequency
shortcut surfacer*, **not** a parameterised-skill capture system.

**Gap (area 3 overall):** "skill capture" exists in two disconnected forms — (a) kernel
`compileSkill` (no capture caller wired) and (b) learned-shortcuts (frequency ranking, not skills).
The standalone skill-library and recipe-authoring are ORPHANs. There is **no live loop that turns a
successful trajectory into a reusable, promoted skill**.

---

## (4) Autonomy gating today — per-flow auto/gated + creation-time confirmation?

### 4a. Risk-tier + permission-mode (the live per-turn gate)

**Evidence:**
- `main-loop.ts:725-769` — every `tool_call` resolves a `riskTier` (`deps.toolRiskTier`) and runs
  `evaluatePermissionMode(...)` → `allow | ask | deny | plan-preview`. Sub-MD spawn is treated as
  `mutate`-tier and plan-mode short-circuits to a preview (`:833-861`).
- `permission-mode.ts` — Claude-Code-parity operator switch (default / plan / acceptEdits / etc.).

**Verdict: REAL.** This is global-mode + per-tool-tier gating, applied uniformly per turn.

### 4b. Four-eye approval (sovereign/high-stakes second-signer)

**Evidence:** `packages/central-intelligence/src/kernel/four-eye-approval.ts:2-29,113-137` — gate
fires on `tier ∈ {medium, high, critical}` mutations with a policy resolver (role groups, minimum
approvers, re-auth). Listed in the brain self-awareness inventory as
`self-awareness.ts:304-308`.

**Verdict: REAL.** Trigger is **risk-tier + policy**, not per-flow.

### 4c. Tenant autonomy caps (rate/cost ceiling)

**Evidence:** `packages/database/src/schemas/autonomy-caps.schema.ts:34-72` — `tenantAutonomyCaps`
keyed on `tenant_id`: `maxMutationsPerDay`, `perToolTierCaps` (jsonb), `perSubMdCaps` (jsonb),
`slowdownAt`, `hardStopAt`. The cost-circuit hook reads `maxCostUsdCentsPerDay`
(`orchestrator-bindings.ts:403-405`).

**Verdict: REAL (tenant-wide + per-tier + per-sub-MD).** Note: `@borjie/autonomy-governance`'s own
docstring (`packages/autonomy-governance/src/index.ts:16-18`) states the kernel hook that calls
`evaluateAutonomyCap` before a mutate action "is a follow-up — out of scope," and grep confirms
`evaluateAutonomyCap` is **not** called from any kernel hook (only the cost dimension is wired via
the cost-circuit). So the *mutation-count* cap is schema+function but not enforced in the loop.

### 4d. Autonomous-department-mode policy (the closest thing to per-flow)

**Evidence:** `packages/database/src/services/autonomy-policy.service.ts:57-202` — per-tenant
`autonomy_policies` row with a master `autonomousModeEnabled` switch (`:177-178`), then a
`policy_json` with **per-action rules** (`actions[toolName] → {authorized, requiresApproval}`,
`:181-188`) and **per-stakes rules** (`stakes[low|medium|high|critical]`, `:190-197`). Action match
wins over stakes match; missing → `defaultAllowLowStakes` (`:57-73`). Wired into the agency executor:
`services/api-gateway/src/composition/sovereign.ts:504,534` (`createPgAutonomyPolicyService(db)` →
`autonomyPolicy: realAutonomyPolicy`).

**Verdict: PARTIAL.** This **is** a per-action / per-stakes auto-vs-gated preference, gated by a
**global** `autonomousModeEnabled` master switch. It is the strongest graduated-autonomy primitive
present and it is wired to the agency executor.

**Gaps (area 4 overall):**
- Gating is keyed on **toolName / stakes / tier**, **not on a flow/workflow/tab/loop identity**. There
  is no "this *workflow* runs autonomously but that *workflow* is gated" preference. (No
  `workflow_id`/`flow_id`/`tab_id` autonomy column exists — confirmed by schema grep.)
- There is **no creation-time confirmation** concept (no "when you create this flow, confirm whether
  it should run auto or gated"). grep `confirm.*creat|creation.?time.?confirm|per.?flow` → no matches.
- Autonomy is **binary master-switch + per-action overrides**, not a graduated ladder applied at the
  granularity of a *flow*. (`@borjie/openclaw-operating-model` ships L0–L5 autonomy *ladders*
  per `ported-agent-stack-wiring.ts:32-38`, but that bundle is namespace-only / pre-wired in-memory,
  not bound to real per-flow policy.)

---

## (5) Proactive / data-routing / follow-up reasoning — routed + reasoned, or just stored?

### 5a. Doc-ingest → routing (is captured data routed, not just stored?)

**Evidence:** `packages/document-analysis/src/route/index.ts` —
- `decideRouting` (`:136-213`) maps `(docType, extracted entities) → {targetModule, targetAction,
  hitlRequired}` via `ROUTING_MATRIX` (`:55-128`); confidence below
  `THRESHOLDS.AUTO_APPLY_ROUTING` is HITL-gated (`:192-209`).
- `dispatchDocumentViaUnified` (`:397-412`) bridges a document into the **same** `runDispatchPipeline`
  (`@borjie/dispatch-router`) that chat captures use, producing `ModuleUpdateProposal[]`. This unifies
  the chat and document brain↔tab loops onto one dispatcher (`:218-281` doc).

**Verdict: REAL (routing).** Captured document data is **routed** to concrete module/action proposals
(create_lease, post_receipt, archive_id, open_ticket, …), HITL-gated when confidence is low — it is
not merely stored.

### 5b. Proactive intel (anomaly/opportunity detection → recommendation)

**Evidence:** `packages/proactive-intel/src/index.ts:60-107` — `runTick`, 3 wired anomaly detectors
(cashflow-dip, royalty-arrears-spike, churn-risk), `compose` → `Recommendation` (with ag-ui approval
dialog part), and a fatigue tracker/policy. Docstring (`:11-18`) lists 4 anomaly + 3 opportunity
detectors + notification adapter as **DEFERRED**.

**Verdict: PARTIAL.** Real detection→recommendation→fatigue path, but only 3 of 7 anomaly detectors
and 0 of 3 opportunity detectors are wired; the notification adapter is deferred.

### 5c. Follow-up reasoning (deadlines, dormancy, anticipatory sweeps)

**Evidence:** `packages/user-followup/src/index.ts:54-103` — priority scorer
(impact/urgency/attention − fatigue), quiet-hours scheduler, in-app/email/WhatsApp dispatchers.
`services/proactive-triggers-worker/src/schedule/followup-cron.ts:8-9` pulls "flagged items, regulator
deadlines, dormancy sweeps," applies quiet-hours + daily-cap.

**Verdict: REAL (the reasoning), PARTIAL (the trigger source).** Follow-up *reasoning* (scoring,
fatigue, scheduling, channel resolution) is real. But its candidate **source** is "flagged items +
deadlines + dormancy sweeps" — the audit found **no path where doc-ingest routing creates follow-up
candidates**. So data is routed (5a) and follow-ups are reasoned (5c), but the two are **not joined**:
an ingested licence with an expiry date is routed to a module proposal, not turned into a scheduled
follow-up.

### 5d. The worker that runs all three — deployment status

**Evidence:** `services/proactive-triggers-worker/src/index.ts:93-207` orchestrates **three scheduled
passes** (hourly sweep, follow-up cron, intel tick). BUT:
- No `Dockerfile` and no `main.ts` entrypoint in `services/proactive-triggers-worker/` (only
  `src/`, `dist/`, `package.json`, configs).
- grep `runScheduledPasses|runFollowupCron|startProactiveWorker` from any server entry → **none**.
- The only k8s reference is `infrastructure/k8s/services/DRIFT_CLEANUP.md:32`, which **lists** the
  worker as a singleton-loop deployment that *should* exist (a drift-cleanup TODO), not a live manifest.

**Verdict: ORPHAN (operationally).** The proactive/follow-up engine is real, library-complete, and
unit-wired, but **nothing deploys or invokes it** — no container, no cron host, no server call.

**Gap (area 5 overall):** routing is real; follow-up reasoning is real; proactive detection is partial;
**but (i) the worker is undeployed and (ii) routed data does not feed the follow-up candidate stream.**
Captured data is routed to proposals, but reminder/follow-up reasoning over that same data is not
chained to it.

---

## (6) Situational awareness — happened / doing / todo / future / blind-spots?

### 6a. "Self-awareness" is capability-awareness, not situational state

**Evidence:** `packages/central-intelligence/src/kernel/self-awareness.ts:1-28` — TWO primitives:
(1) a per-turn **persona-drift gate** (`checkSelfAwareness`, `:77-132`) and (2) a **capability
inventory** injector (`renderModuleInventoryBlock` over `BRAIN_MODULES`, `:183-478`). Neither tracks
*what has happened / is in progress / is queued*.

**Verdict: MISSING (for situational state).** "Self-awareness" here = "what can I do + am I drifting,"
not "what is the state of the world and my work in it."

### 6b. Fragments that approximate the situational dimensions

- **"future":** `packages/central-intelligence/src/kernel/world-model/index.ts:1-56` — forward-simulates
  property/tenant/owner/agency state vectors (`forecastPropertyTrajectory`, …). **REAL** as a forecaster.
- **"doing / todo":** `packages/central-intelligence/src/kernel/agency/goals/goal-tracker.ts` — goal +
  step status (`pending|running|done|failed|skipped|completed`, `:40,57,93-130`). **REAL** as goal state.
- **stall / "blocked":** `packages/central-intelligence/src/kernel/agency/stall-detector.ts:1-25` — flips
  `active→stalled` after a per-goal threshold and proposes continue/block/abandon. **REAL**.
- **initiative / wake:** `packages/central-intelligence/src/kernel/agency/initiative/{wake-loop.ts,
  real-detectors.ts}` — standing detectors that wake goals. **REAL**.

### 6c. "blind-spots" as an explicit model

**Evidence:** grep `blind.?spot|blindspot|knownUnknown|gap.*awareness|uncertainty.*map` in code →
the only hits are **doc-comments** about *multi-LLM debate reducing blind spots*
(`kernel-types.ts:171`, `supervisor/types.ts:22`, `ai-copilot/.../multi-llm-synthesizer.ts:7`).

**Verdict: MISSING.** There is no first-class "blind-spots / known-unknowns" structure the brain
maintains.

**Gap (area 6 overall):** the *ingredients* of situational awareness exist as separate subsystems
(world-model = future, goal-tracker = doing/todo, stall-detector = blocked, briefing = a daily
digest at `kernel/briefing.ts:45-84`), but **no unified situational model** aggregates
happened/doing/todo/future/blind-spots into one queryable state the orchestrator reasons over each
turn. The closest synthesis is the morning `briefing` composer — a one-shot digest, not a standing
model.

---

## Findings table

| # | Area | Capability | Verdict | One-line gap |
|---|------|-----------|---------|--------------|
| F1 | Decision routing | LLM-emitted Decision ADT + agentic main-loop | PARTIAL | Only tool_call/spawn reachable; no modality arbiter |
| F2 | Decision routing | planner-dispatcher (ToT/LATS by stakes) | REAL | Chooses plan *style*, not modality |
| F3 | Decision routing | agent-orchestrator | PARTIAL | Namespace-only; no brain port bound |
| F4 | Decision routing | module-orchestrator | REAL | Module lifecycle axis, not per-turn modality |
| F5 | Decision routing | tab-need-detector | PARTIAL | Lib + UI banner; no deployed backend cron |
| F6 | Decision routing | loop-runner / work-cycle / tab-as-loop | ORPHAN | Only DB-schema refs; no runtime instantiation |
| F7 | Workflows | workflow identification from a turn | MISSING | No identify/detect/suggest logic; static catalog of 10 |
| F8 | Workflows | dynamic-recipe-authoring (creation) | ORPHAN | Real authoring pkg, mounted to no route |
| F9 | Workflows | md-agentic team executor | REAL | Wired end-to-end (route 2223) |
| F10 | Workflows | spawn_sub_md handler | REAL | Real child run + memory fold-back, wired |
| F11 | Skills | kernel skill retriever (reuse) | PARTIAL | Retrieval wired; capture (compileSkill) has no caller |
| F12 | Skills | @borjie/skill-library | ORPHAN | Zero consumers anywhere |
| F13 | Skills | learned-shortcuts | REAL | Frequency ranking, not parameterised skills |
| F14 | Autonomy | risk-tier + permission-mode + four-eye | REAL | Tier/policy-gated, uniform per turn |
| F15 | Autonomy | autonomy-policy (per-action/per-stakes) | PARTIAL | Global master switch; per-action, NOT per-flow |
| F16 | Autonomy | per-flow auto/gated + creation-time confirm | MISSING | No flow-keyed autonomy; no creation-time confirm |
| F17 | Autonomy | tenant autonomy caps (mutation count) | PARTIAL | Schema+fn exist; count cap not enforced in loop |
| F18 | Proactive | doc-ingest routing → proposals | REAL | Routed via unified dispatch-router, HITL-gated |
| F19 | Proactive | proactive-intel detectors → recs | PARTIAL | 3/7 anomaly, 0/3 opportunity, notify deferred |
| F20 | Proactive | follow-up reasoning | REAL | Scoring/fatigue/scheduling real |
| F21 | Proactive | proactive-triggers-worker deployment | ORPHAN | No Dockerfile/k8s/entrypoint invokes it |
| F22 | Proactive | routed-data → follow-up linkage | MISSING | Ingested data not turned into follow-up candidates |
| F23 | Situational | unified happened/doing/todo/future/blind-spots | MISSING | Only fragments; no aggregate model |
| F24 | Situational | world-model (future) / goal-tracker (todo) / stall-detector (blocked) | REAL | Real but disjoint subsystems |
| F25 | Situational | blind-spots model | MISSING | Only doc-comment mentions |

---

## The three highest-leverage gaps (synthesis)

1. **No modality arbiter (F1, F6, F7).** A turn cannot choose "workflow" or "loop" — those runtimes
   (loop-runner/tab-as-loop/work-cycle, the workflow registry) are unreachable from the brain. Building
   an explicit pre-dispatch router (skill | workflow | spawn | loop | direct-answer) would unlock the
   already-built loop and workflow machinery.

2. **Autonomy is not per-flow and has no creation-time confirmation (F15, F16).** The strongest
   primitive (`autonomy-policy.service.ts`) is per-tool/per-stakes under one global switch. Graduated
   autonomy at the *flow* granularity (and a "auto vs gated?" confirmation when a flow is created)
   does not exist.

3. **The proactive/follow-up brain is built but dark (F21, F22).** Real detectors + real follow-up
   reasoning, but no deployment runs them, and routed-in data never becomes a scheduled follow-up.
   Wiring a host for `proactive-triggers-worker` and chaining doc-routing → follow-up candidates would
   activate a large amount of finished code.

---

## Method note

All verdicts were derived by reading source and tracing consumers (grep for import sites across
`services/`, `apps/`, `packages/`, excluding `dist/` and `__tests__/`). "ORPHAN" specifically means the
only references found were the package's own code, its tests, its `dist/`, or a DB-schema registration
comment — i.e., no live runtime path. Line numbers are from the working tree on
`integration/parity-final` as of 2026-06-08.
