# Gap Dossier — Autonomy, Agency & Self-Improvement

**Dimension:** AUTONOMY, AGENCY & SELF-IMPROVEMENT
**Date:** 2026-06-08
**Auditor:** dimension subagent (grounded read of `packages/` + `services/` of Borjie & BN, against the research specs in `Docs/research/`)
**Scoring:** current maturity **2 / 5** vs AGI target **5 / 5**.

---

## Verdict in one paragraph

Borjie has built a **world-class autonomy *spine*** and the **safety keystone** for self-modification — but it has **not built the self-improvement *loop*** that the specs call the actual product. The continuous controller (`decideAutonomy`), the monotone rail-compose (`composeWithRail`), the deterministic fail-closed meta-rail (`checkBodyChangeInviolable`), the unified body-change syscall (`authorizeBodyChange`), and the self-extension keystone (`detectRecurringGap → proposeNewSubMd → owner four-eye → compileAndDeploySubMd`) are all real, well-tested, and correct by construction. The controller is even **wired live** into chat/voice routes via `auto-authorize-gate`. **But:** the body-change syscall, the self-extension keystone, and the Voyager skill-capture loop have **zero production call sites** — they are libraries waiting for a caller. There is **no earned-graduated-autonomy engine** (N-clean-runs → suggest-AUTO with tripwire auto-demote). The `cap-evaluator` kernel hook is still un-wired (its own docstring flags it as a follow-up). **None** of the eight frontier self-improvement mechanisms the specs mandate — ADAS junior-invention, AFlow/MCTS workflow search, DSPy/GEPA/TextGrad prompt optimization, DGM lineage archive, the replay→eval→update nightly loop, the Voyager autotelic curriculum — exist anywhere in either repo. The evolution workers (`brain/junior/ui/doc-evolution-worker`) and the offline loops (`sleep-pass-orchestrator`, `meta-learning-conductor`, `intel-self-improve`) are built as packages but are **not deployed** (4 of 7 have no Dockerfile; 0 of them have a k8s manifest; the only crons are consolidation + wake-loop + ledger-verify). The net is: **the agent can be gated correctly and *could* safely redesign itself, but today it does not get better while the mine sleeps, and it cannot yet design its own better agents/workflows.**

---

## What the AGI target is (from the specs)

- **MD_AS_BODY_ARCHITECTURE.md** §selfRedesign / §governance / Implementation lanes: every body-change (UI move, surface add, capability add, prompt edit, tool-def edit, sub-MD compose, self-model edit, code patch) routes through ONE body-change syscall → `decideAutonomy` + `composeWithRail` + **meta-rail**; shadow→canary→burn-rate-auto-rollback→archive-lineage promotion (DGM empirical fitness); sandbox-before-deploy in isolated-vm; learned-intent adaptive reorder; ambient idle-time pre-render.
- **frontier-self-improving-orchestration.md** §14 (the 8-layer stack): (1) machine-checkable evaluator, (2) replay buffer + nightly reflect, (3) **DSPy/GEPA/TextGrad** prompt compilation with a Pareto frontier, (4) **AFlow** MCTS workflow search, (5) **MASS/EvoMAC** team-topology evolution, (6) **ADAS** Meta-MD invents new juniors as code, (7) **DGM+Voyager** open-ended lineage archive + autotelic curriculum, (8) governor sacrosanct.
- **ORCHESTRATION_SPEC.md** §Autonomy-gating: flow-keyed posture (DONE), **earned/trust-based promotion** (N clean runs → suggest-AUTO, Reflexion readiness signal, tripwire auto-demote — NOT DONE), `evaluateAutonomyCap` kernel hook + `maxMutationsPerDay` enforcement (NOT WIRED), modality arbiter (NOT BUILT), skill-capture half wired (NOT WIRED).
- **frontier-autonomy-beyond-gating.md** §0: beyond the binary switch — reversibility-aware, confidence-adaptive, dynamically re-gated. (Controller is built and live — this part is strong.)

---

## What is REAL and good (so the gaps below are honest)

| Capability | Evidence | State |
|---|---|---|
| Continuous per-decision controller (4-axis fuse + situation flags) | `packages/autonomy-governance/src/decision/decide-autonomy.ts:243-311` | REAL, pure, tested |
| Monotone rail compose ("rail-gate always wins", proven by construction) | `packages/autonomy-governance/src/decision/compose-with-rail.ts:128-194` | REAL |
| Controller LIVE in chat/voice/owner-action routes | `services/api-gateway/src/services/auto-authorize-gate/index.ts:279-313`; called by `routes/brain-teach.hono.ts`, `public-chat.hono.ts`, `brain-voice.hono.ts`, `owner/chat-actions.hono.ts` | WIRED |
| Meta-rail (deterministic, no-LLM, fail-closed; 5 clauses + text+structure derivation) | `packages/central-intelligence/src/kernel/inviolable.ts:482-614` | REAL, tested |
| Unified body-change syscall (meta-rail + controller + compose, defence-in-depth post-conditions, fail-closed) | `packages/mutation-authority/src/body-change/body-change-syscall.ts:173-288`; audited variant `audited-body-change.ts:78` | REAL but UNCALLED |
| Self-extension keystone (gap-detect → propose → four-eye → deploy + sovereign ledger; riskTier clamp; destructive-tool blocklist; routes through `authorizeSelfExtension`) | `packages/central-intelligence/src/kernel/orchestrator/self-extension.ts:216-709` | REAL but UNSCHEDULED |
| Flow-keyed autonomy posture (sticky `gated|auto`, fail-safe default GATED, creation-time confirm) | `packages/workflow-engine/src/autonomy/flow-autonomy-port.ts:86-89`; read in engine `runs/engine.ts:302,545`; bound in gateway `composition/workflow-engine-wiring.ts:284-305` | WIRED |
| Voyager skill-capture loop (describe→embed→store→compose, `human_reviewed:false`, audit-chained) | `packages/skill-library/src/skill-capture/capture-loop.ts:109-233` | REAL but UNCALLED |
| Reflexion self-modification power-tool (anchor-summary rewrite, four-eye gated, sovereign-ledger) | `packages/central-intelligence/src/kernel/power-tools/self-modification.ts:130-201` | REAL |
| Sleep/brain-evolution reflect pipeline (3-LLM jury, agreement→escalate) | `services/brain-evolution-worker/src/pipeline/stage-02-reflect.ts:61-117` | REAL but UNDEPLOYED |
| Promotion deciders (Δ-threshold promote/demote/rollback; junior lifecycle sweep) | `packages/meta-learning-conductor/src/decider/promotion-decider.ts:31-69`; `services/junior-evolution-worker/src/decisions/promotion.ts:38-72` | REAL but UNWIRED/UNDEPLOYED |

The spine and the safety design are genuinely SOTA-grounded. The gaps are about **wiring, scheduling, and the missing search/optimization layer** — not about a broken foundation.

---

## GAPS (every one buildable; no deferrals)

### G1 — Body-change syscall has ZERO production callers (the "ONE chokepoint" is bypassed in practice) — BLOCKER
- **Evidence:** `authorizeBodyChange` is defined in `packages/mutation-authority/src/body-change/body-change-syscall.ts:173` and re-exported at `mutation-authority/src/index.ts:136`, but a repo-wide grep finds NO call site outside the package's own files and tests. The api-gateway composition (`services/api-gateway/src/composition/`) does not import `@borjie/mutation-authority`. The actual UI/surface actuators (`portal-genui`, `genui`, `dynamic-sections`, `tab-as-loop`, `owner-os-tabs`) do not route through it.
- **Current state:** UI/surface/prompt body-changes happen (genui spawns tabs, dynamic-sections reorders) WITHOUT passing through the meta-rail+controller chokepoint. The spec's load-bearing claim ("EVERY path that reshapes the MD's own body MUST route through `authorizeBodyChange`") is violated by omission.
- **AGI target:** A single chokepoint every actuator calls before mutating the body (MD_AS_BODY §governance).
- **Closure lane:** Wire `authorizeBodyChange`/`runAuditedBodyChange` at the composition root and insert a guard call into each actuator entry (genui spec→render, dynamic-sections reorder commit, tab spawn, prompt/tool-def edit). Bind the meta-rail port to `checkBodyChangeInviolable`, controller to `decideAutonomy`, compose to `composeWithRail`. Area: `services/api-gateway/src/composition/ (new body-change-wiring.ts)` + `packages/{portal-genui,genui,dynamic-sections,owner-os-tabs}`.
- **Effort:** L

### G2 — Self-extension keystone is never scheduled or invoked (capability never actually grows) — BLOCKER
- **Evidence:** `detectRecurringGap`/`proposeNewSubMd`/`compileAndDeploySubMd` (`self-extension.ts:216,328,397`) are exported from `orchestrator/index.ts:249-251` but have NO scheduled job, cron, or worker that calls them. No k8s CronJob references self-extension; the only crons are `k8s/{consolidation-worker,wake-loop,sovereign-ledger-verify}-cron.yaml`. The spec says "Scheduled job (daily/weekly) calls `detectRecurringGap`" (`self-extension.ts:11-12`) — that job does not exist.
- **Current state:** The MD cannot detect a recurring unmet pattern and propose a new sub-MD because nothing ever runs the detector against the activity log.
- **AGI target:** Idle-time gap detection → owner-gated new-junior proposal → catalogue grows without redeploy (MD_AS_BODY §selfRedesign L3; ORCHESTRATION_FRONTIER §self-extension).
- **Closure lane:** Add a scheduled pass (reuse the api-gateway-image CronJob pattern of `wake-loop-cron.yaml`) that wires `ActivityLogPort` to the decision-trace/action-audit sinks, calls `detectRecurringGap` per tenant, and on a diagnosis runs `proposeNewSubMd` → owner four-eye inbox → `authorizeSelfExtension` → `compileAndDeploySubMd`. Area: `services/proactive-triggers-worker` (or new `services/self-extension-worker`) + `k8s/self-extension-cron.yaml`.
- **Effort:** L

### G3 — Voyager skill-capture loop has no runtime caller (the "DARK half") — HIGH
- **Evidence:** `runCaptureLoop` (`packages/skill-library/src/skill-capture/capture-loop.ts:109`) is only referenced by its own `index.ts:23`. `ORCHESTRATION_SPEC.md:16` explicitly flags "connect the DARK half of the skill-library … `compileSkill` + `autoSuggestSkill` currently no runtime caller outside tests." The post-turn/consolidation pass never calls capture.
- **Current state:** Successful verified novel trajectories are NOT captured into reusable skills; the library never grows from real work, so the modality "SKILL" can never be reached for newly-learned patterns.
- **AGI target:** On a self-verified novel success, the consolidation pass captures a parameterised, human-review-gated skill into the registry (Voyager describe→embed→store→retrieve→compose).
- **Closure lane:** In the consolidation cycle (`packages/central-intelligence/src/kernel/consolidation/consolidation-cycle.ts`) or a post-turn hook, call `runCaptureLoop` over verified trajectories; persist via a Drizzle-backed `VoyagerSkillLibrary` adapter; gate promotion on human review. Wire `skill-library` into `services/api-gateway/src/composition/`. Area: `packages/central-intelligence/src/kernel/{consolidation,skill-library}` + `packages/skill-library`.
- **Effort:** M

### G4 — No earned/graduated-autonomy engine (N-clean-runs → suggest-AUTO, tripwire auto-demote) — HIGH
- **Evidence:** Grep for `cleanRun|consecutive|suggestPromot|readyForAuto|earnedAuto|trackRecord|tripwire|autoDemote` across `packages/autonomy-governance` and `packages/workflow-engine` returns nothing (only `flow-autonomy-prefs.schema.ts` storage + `decide-autonomy.ts`'s static `capSlowdown` situation flag). The flow posture is set manually (`setPosture`) — there is no engine that watches a flow's track record and *suggests* the flip, and no tripwire that auto-demotes a live AUTO flow on rising error/anomaly. `ORCHESTRATION_SPEC.md:21,44` requires exactly this ("EARNED / trust-based promotion … After N clean runs … SUGGESTS flipping to AUTO … DEMOTION is automatic").
- **Current state:** Autonomy is granted by a manual toggle, not *earned*. There is no "graduated autonomy that the agent demonstrably earns and can lose."
- **AGI target:** A Generative-Agents-style track-record memory stream drives N-clean-runs suggest-AUTO with evidence shown, and NIST-style tripwires auto-demote on regression.
- **Closure lane:** Build a track-record aggregator (clean runs, escalations, error trend, false-escalation rate) keyed on `flow_id`; a `suggestPromotion(flow)` decider; a tripwire monitor that calls `setPosture('gated')` on threshold breach. Reuse `slo-monitor.ts`/`canary-controller.ts`/`auto-rollback.ts` patterns already in `autonomy-governance/src/slo/`. Area: `packages/autonomy-governance/src/ (new graduation/)` + `packages/cognitive-memory` + `packages/workflow-engine`.
- **Effort:** M

### G5 — `evaluateAutonomyCap` kernel hook un-wired; `maxMutationsPerDay`/irreversibility-budget never enforced at runtime — HIGH
- **Evidence:** `autonomy-governance/src/index.ts:17,28` states the "kernel-side hook that calls `evaluateAutonomyCap` before any mutate-tier" is a "follow-up". Grep finds no production caller of `evaluateAutonomyCap`/`CapEvaluator` in `services/` or `packages/central-intelligence`. The `maxMutationsPerDay` column exists (`database/src/schemas/autonomy-caps.schema.ts:41`) but only the COST dimension is live; the `irreversibilityBudgetExhausted` situation flag (`decide-autonomy.ts:167`) is never set by any counter. `ORCHESTRATION_SPEC.md:22,43` requires the cap hook to run BEFORE four-eye/sovereign and to enforce the mutation count.
- **Current state:** A tenant/sub-MD can exceed its declared daily mutation budget; the irreversibility budget that should escalate to four_eyes is a dead input.
- **AGI target:** Per-tenant/per-sub-MD caps enforced at the kernel mutate seam BEFORE four-eye; budget exhaustion escalates by construction.
- **Closure lane:** Add the kernel hook in the orchestrator's mutate path that calls `evaluateAutonomyCap` and a daily-mutation counter (Redis or `event_outbox`-derived) feeding the `irreversibilityBudgetExhausted` flag into `decideAutonomy`. Area: `packages/central-intelligence/src/kernel/orchestrator` + `packages/autonomy-governance/src/caps`.
- **Effort:** M

### G6 — No replay→eval→update nightly loop; the evaluator/fitness function is not machine-checkable end-to-end — HIGH
- **Evidence:** Grep for `replay.buffer|nightlyReplay|ReasoningBank|experience.replay` finds nothing relevant. `brain-evolution-worker` reflects (3-LLM jury) and writes memory deltas (`stage-02..04`) but does NOT re-run the current orchestrator over a buffer of decided cases, score against a fitness function, and distill wins+losses. `frontier-self-improving-orchestration.md` §14 layers 1-2 ("Evaluator first … Replay buffer + nightly reflect") and §8 ("the evaluator is the product") are the prerequisite for ALL of self-improvement and are absent.
- **Current state:** Reflection produces NL digests but no closed loop that measurably improves the orchestrator against replayed real decisions; learning from *failures* (ReasoningBank) is missing — success-only capture (G3) misses the near-miss compliance escalations the spec calls the most valuable data.
- **AGI target:** Every decided case → replay buffer; sleep-window pass re-runs the orchestrator, reflects on wins AND losses, distills into cognitive memory + skill library, scored by a machine-checkable estate-decision fitness function (ledger-balanced, licence-row-correct, evidence non-empty, budget, EN/SW purity, calibration).
- **Closure lane:** Build (1) a replay buffer table fed by `decisionLog`/Auditor verdicts; (2) a machine-checkable fitness function hardening `loop-quality-gates` + Auditor into a single scalar+text signal; (3) a nightly replay pass in `sleep-pass-orchestrator` that re-runs and distills. Area: `services/{sleep-pass-orchestrator,brain-evolution-worker}` + `packages/{loop-quality-gates,intel-self-improve,cognitive-memory}`.
- **Effort:** XL

### G7 — No workflow search (AFlow/MCTS); `dynamic-recipe-authoring` orphaned/unmounted — HIGH
- **Evidence:** No AFlow/MCTS-over-workflows implementation exists (the earlier grep hits were substring false-positives — gitLAB/lineAR/youtube). `dynamic-recipe-authoring` package exists but is NOT mounted on any api-gateway route (`ORCHESTRATION_SPEC.md:39` lane "Mount dynamic-recipe-authoring on an api-gateway route" — confirmed absent). Workflows are matched to hand-authored `WORKFLOWS` entries; the graph is never *discovered*.
- **Current state:** The MD selects among hand-built workflows; it cannot search the space of workflow compositions to find a cheaper/better flow — the cost win the spec calls "decisive for a Tanzania-first estate" is unrealized.
- **AGI target:** MCTS-compose operators + juniors into discovered, cost-optimal flows against replayed cases; human-gate promotion into `WORKFLOWS` (AFlow §4).
- **Closure lane:** Implement an AFlow-style MCTS searcher over code-represented workflows hosted in `dynamic-recipe-authoring`; evaluate against the G6 fitness function; route discovered flows to human-gated promotion via the body-change syscall (G1). Mount the package on a gateway route. Area: `packages/{dynamic-recipe-authoring,workflow-engine}` + `services/api-gateway/src/{routes,composition}`.
- **Effort:** XL

### G8 — No prompt/pipeline optimization (DSPy/MIPROv2 / GEPA / TextGrad); juniors carry never-optimized hand prompts — HIGH
- **Evidence:** No DSPy/GEPA/TextGrad implementation in either repo (substring grep false-positives only). The ~50 juniors (`packages/ai-copilot/src/juniors/*.ts`) carry hand-written prompts that are run but never compiled/optimized against the Auditor-graded outcome. `frontier-self-improving-orchestration.md` §5-7 mandate compiling the junior pool as signature-typed modules with auto-optimized instructions/exemplars and a Pareto frontier per scenario class.
- **Current state:** Prompt maintenance is a manual chore; the Auditor verdicts (evidence-chain rejections, calibration) are thrown away after gating instead of being turned into the optimization gradient.
- **AGI target:** The whole compound system is compilable — MIPROv2/GEPA re-derive best instructions+exemplars per junior against the evaluator, keep a Pareto frontier of configs per estate scenario, recompile when the corpus/regulations shift.
- **Closure lane:** Wrap juniors as signature-typed modules; build a GEPA-style reflective prompt-evolution pass over the G6 replay buffer using Auditor verdict text as the gradient; store a Pareto frontier of configs; gate config swaps through the body-change syscall (`prompt-edit` kind). Area: `packages/ai-copilot/src/juniors` + new `packages/prompt-evolution` + `services/brain-evolution-worker`.
- **Effort:** XL

### G9 — No ADAS Meta-MD (agent designs its own *new* agents as code) — HIGH
- **Evidence:** Self-extension (`self-extension.ts`) composes a new sub-MD from a *persona spec* (name, scope, tool-belt, persona) — it does NOT write a new junior *as code* against a growing archive. `frontier-self-improving-orchestration.md` §1/§14-6: "the meta-agent *writes the junior*" as a typed module, smoke-tests on replay, human-gates promotion. This is "the single biggest leap past spawn-tabs over fixed juniors" and is absent.
- **Current state:** The MD can request a new persona-shell sub-MD (config), but cannot invent genuinely new capability logic as code when no junior fits.
- **AGI target:** A guarded Meta-MD that drafts a new junior as code into an archive, smoke-tests on replayed cases, and human-gates promotion — fenced inside the existing isolated-vm sandbox, forbidden from touching the governor.
- **Closure lane:** Build a Meta-MD pass: code-space junior representation (extend the typed `executor-registry` shape), an archive store, a sandboxed smoke-test harness (isolated-vm), and human-gated promotion via body-change syscall (`code-patch`/`capability-add`). Port BN's `self-codegen` harness (`Cursor Projects/BOSSNYUMBA101/packages/self-codegen`) which already enforces plan/execute split + deny-globs + dual-human CODEOWNER review. Area: `packages/central-intelligence/src/kernel/orchestrator` + new `packages/meta-md` + reuse `agent-runtime`/`isolated-vm`.
- **Effort:** XL

### G10 — No DGM-style open-ended lineage archive (single-best, not branching) — MED
- **Evidence:** Promotion deciders (`meta-learning-conductor/src/decider/promotion-decider.ts`, `junior-evolution-worker/.../promotion.ts`) are greedy Δ-threshold promote/demote against a single current config — there is no branching archive of orchestrator/junior variants. `MD_AS_BODY §selfRedesign L3` and frontier §2 require the DGM archive-fork-validate-promote lineage so a regression doesn't poison the pool and stepping-stone variants can seed later breakthroughs.
- **Current state:** Greedy single-lineage promotion is vulnerable to the monoculture/stall the specs explicitly warn against.
- **AGI target:** A branching archive of self-improving variants, Pareto-sampled, with archive-fork-validate-promote and auto-rollback to the archived parent body.
- **Closure lane:** Add a lineage/archive table (variant config + fitness + parent edge); replace greedy promotion with Pareto sampling over the archive; wire archive-parent rollback into the existing `shadow`/`cutover-gate`/`auto-rollback` substrate. Area: `packages/meta-learning-conductor` + `packages/autonomy-governance/src/{shadow,slo}` + `packages/database` (new schema).
- **Effort:** L

### G11 — Voyager autotelic curriculum absent (training-scenarios is catalog CRUD, not learning-progress-driven self-practice) — MED
- **Evidence:** `packages/database/src/schemas/training-scenarios.schema.ts` + `services/api-gateway/src/routes/scenarios.hono.ts` provide scenario templates `generatedBy:'concept_catalog'`, admin-locked rehearsal sessions, and a `learningProgress` table — but the generation is catalog-driven, sessions are human-run, and nothing predicts *learning progress* to choose interesting/learnable scenarios, nor feeds outcomes into skill capture. `frontier-self-improving-orchestration.md` §9/§12 require an automatic curriculum (OMNI interestingness / MAGELLAN learning-progress) that proposes its own practice tasks in idle time.
- **Current state:** Practice exists as a human-driven training UI, not an autotelic loop that drills the MD's actual blind-spots before the real event.
- **AGI target:** Idle-time self-proposed practice on novel, learnable, decision-relevant synthetic scenarios, gated by an interestingness/learning-progress filter, feeding skills before the real event.
- **Closure lane:** Add a learning-progress predictor over the `learningProgress` table; a curriculum generator that proposes scenarios from blind-spots (G6 failure distribution); run them headless in the sleep window; feed verified outcomes into skill capture (G3). Area: `packages/skill-library/src/voyager-library` + `services/sleep-pass-orchestrator` + `packages/database` (scenarios).
- **Effort:** L

### G12 — Self-improvement workers are built but NOT DEPLOYED (no images, no manifests) — HIGH
- **Evidence:** `ui-evolution-worker`, `doc-evolution-worker`, `capability-measurement-worker`, `proactive-triggers-worker` have **no Dockerfile**. NONE of the seven self-improve services (`brain/junior/ui/doc-evolution-worker`, `sleep-pass-orchestrator`, `capability-measurement-worker`, `proactive-triggers-worker`, `meta-learning-conductor`, `intel-self-improve`) is referenced by any k8s manifest — the only CronJobs are `consolidation-worker`, `wake-loop`, `sovereign-ledger-verify`. `ORCHESTRATION_SPEC.md:48` flags `proactive-triggers-worker` as "library-complete but UNDEPLOYED."
- **Current state:** Even the loops that ARE built do not run in production — "gets better every night while the mine sleeps" is not happening.
- **AGI target:** The offline improvement loop runs nightly on schedule.
- **Closure lane:** Add Dockerfiles (or reuse the api-gateway-image entrypoint pattern of `consolidation-worker-cron.yaml`) + k8s CronJobs for each worker; sequence them in the sleep window. Area: `services/{ui,doc}-evolution-worker`, `services/{capability-measurement,proactive-triggers}-worker` + `k8s/`.
- **Effort:** M

### G13 — `meta-learning-conductor` and `intel-self-improve` are orphaned (not wired into the gateway) — MED
- **Evidence:** Grep for `@borjie/meta-learning-conductor` / `@borjie/intel-self-improve` in `services/api-gateway/src` returns no production import (the only hits are unrelated `blackboard-intel`/`blackboard-sota`). Both packages have full pipelines (runner, evaluator, curator, promotion-decider; wrap-as-measured, outcome-observer, trace-curator) but no composition root binds them.
- **Current state:** Two complete self-improvement packages sit dark.
- **AGI target:** Measured outcomes flow into meta-learning + intel-self-improve which feed prompt/skill/junior optimization.
- **Closure lane:** Bind both at the api-gateway composition root; route junior/intel invocations through `wrapAsMeasured`; schedule `runMetaLearning`. Area: `services/api-gateway/src/composition/ (new self-improve-wiring.ts)` + `packages/{meta-learning-conductor,intel-self-improve}`.
- **Effort:** M

### G14 — Modality arbiter not built (SKILL/WORKFLOW/LOOP/AGENT modalities unreachable; everything collapses to tool_call) — HIGH
- **Evidence:** No `modality-arbiter.ts` / `ModalityArbiter` / `run_modality` anywhere in `packages/central-intelligence/src` (grep empty). `ORCHESTRATION_SPEC.md:6,35,53` names this the "single highest-leverage build": today only the anthropic-router arbiter is live and collapses every turn to `tool_call|respond|final`, so the SKILL/WORKFLOW/LOOP modalities (and therefore captured skills and discovered workflows) are never reached.
- **Current state:** Even if skills (G3) and workflows (G7) existed and were promoted, the runtime has no head that would route a turn to them — the self-improvement output has nowhere to land.
- **AGI target:** A cheap first-pass classifier maps each turn to ANSWER/SKILL/WORKFLOW/LOOP/AGENT before the LLM router, with effort-scaling spawn rules; emits a `run_modality` Decision variant.
- **Closure lane:** Build `kernel/orchestrator/modality-arbiter.ts` (reuse the on-device MiniLM router + brain-llm-router cascade), add the 7th Decision variant, wire it before `router.call` in `main-loop.ts`; wire orphan `loop-runner` as the LOOP executor. Area: `packages/central-intelligence/src/kernel/orchestrator` + `packages/{loop-runner,loop-quality-gates}`.
- **Effort:** L

### G15 — No sandbox-before-deploy + shadow→canary→archive-rollback wiring on the body-change path — MED
- **Evidence:** The substrate exists (`autonomy-governance/src/shadow/{cutover-gate,agreement-scorer,calibration-scorer}.ts`, `slo/{auto-rollback,canary-controller}.ts`; `isolated-vm` sandbox in `agent-runtime`) but `MD_AS_BODY` Implementation lane "[XL] Wire shadow→canary→burn-rate-auto-rollback + archive-lineage to the body-change path; sandbox-before-deploy in isolated-vm" is unrealized — the body-change syscall (G1) does not invoke shadow/canary/sandbox before promoting a generated surface/skill/code.
- **Current state:** A promoted body-change would go live without the shadow→canary→burn-rate ramp the spec mandates (the VeriGuard/DGM reversibility guarantee is unenforced for self-mod output).
- **AGI target:** Every body-change: sandbox-before-deploy → shadow → canary (1→10→50→100% with eval/latency/cost/error gates) → burn-rate-SLO auto-rollback to the archived parent.
- **Closure lane:** Chain the existing shadow/canary/auto-rollback into the audited body-change executor (`mutation-authority/src/execution/executor.ts` + `rollback.ts`); run generated code in `isolated-vm` first. Area: `packages/mutation-authority/src/execution` + `packages/autonomy-governance/src/{shadow,slo}` + `services/ui-evolution-worker`.
- **Effort:** L

### G16 — Skill quarantine/decay exists but no skill *versioning/improvement* lifecycle — LOW
- **Evidence:** `CodeSkill` has `quarantined`/`consecutive_failures` (`skill-library/.../capture-loop.ts:173-185`) but no version field, no "improve an existing skill" path, no promotion from `human_reviewed:false` → live other than the capture default. The capture/improve/version/promote lifecycle the task names is only "capture (uncalled) + quarantine."
- **Current state:** Skills can be captured and quarantined but not versioned or iteratively improved.
- **AGI target:** capture → improve (GEPA over the skill's own traces) → version → promote, with lineage.
- **Closure lane:** Add a `version` + `parent_skill_id` to `CodeSkill`; a `human_reviewed` promotion path; reuse G8's reflective optimizer to improve a skill from its trace history. Area: `packages/skill-library` + `packages/database`.
- **Effort:** S

---

## Severity roll-up

- **BLOCKER (2):** G1 (body-change chokepoint bypassed), G2 (self-extension never runs).
- **HIGH (8):** G3, G4, G5, G6, G7, G8, G12, G14.
- **MED (5):** G9 (ADAS is HIGH-leverage but XL — listed HIGH), G10, G11, G13, G15.
- **LOW (1):** G16.

## Sequencing (spine-first, matching the specs)

1. **Turn the lights on:** G14 modality arbiter + G3 skill-capture caller + G12 deploy the workers (the output of self-improvement needs somewhere to land and something to run it).
2. **Make self-mod safe-by-construction at runtime:** G1 wire the body-change chokepoint + G15 shadow/canary/sandbox + G5 cap hook.
3. **Earn autonomy:** G4 graduated-autonomy engine.
4. **Compound:** G6 replay→eval→update loop (the evaluator is the product) → then G8 prompt optimization, G7 workflow search, G10 lineage archive, G11 curriculum, G2 self-extension scheduling, G13 wire the orphan packages.
5. **Design its own agents:** G9 ADAS Meta-MD (port BN `self-codegen`).

The governor stays sacrosanct throughout: the meta-rail (`inviolable.ts:482`) already forbids any self-change that edits a rail / shortens audit / raises a ceiling / fails integrity, and `composeWithRail` proves it can only escalate. Every gap above is fenced by that existing keystone — which is why the foundation is sound and the work is wiring + the missing search/optimization layer, not a rebuild.
