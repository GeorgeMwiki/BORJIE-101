# DESIGN SPEC — Modality Arbiter (the Wave-B keystone)

**Lane:** `modality-arbiter-keystone`
**Gap IDs:** `COG-07 / AUT-14` (MASTER_GAP_REGISTER §B.3, the single keystone row), with hard cross-references to `EA-04/AUT-01` (body-change syscall), `AUT-03/COG-08` (skill-capture), `AUT-07` (workflow search), `ORCH-flowprefs`/`AUT-05` (per-flow autonomy).
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Status:** design only — NO code in this PR.

---

## 0. Why this is the keystone

The MASTER_GAP_REGISTER calls this out verbatim (line 66): *"the modality arbiter is the single head everything else lands on. Until it ships, captured skills (B), discovered workflows (D), and the loop-runner have nowhere to land."*

Today a brain turn can only reach **two** of the seven possible output modalities. The orchestration audit (`Docs/research/borjie-orchestration-layer-audit.md` §1a–1f, §F1) proves it by source-trace:

- `packages/central-intelligence/src/kernel/orchestrator/decision.ts:135-160` — the `Decision` union has exactly six variants: `respond_to_owner | tool_call | spawn_sub_md | schedule_wake | monitor | final`. There is **no** skill / workflow / loop / document / media variant.
- `main-loop.ts:716-720` — the loop asks `await deps.router.call({ system, tools, messages })` and the *model* returns the Decision. `grep "workflow|skill|isLoop|loopKind|recipe"` over `main-loop.ts` → **zero matches** (re-verified this session).
- `packages/loop-runner/src/index.ts` — the five-layer `runLoop` is real + tested but its ONLY importer is `packages/database/src/schemas/index.ts` (a schema-registration comment). No runtime caller. **ORPHAN.**
- `packages/ai-copilot/src/workflows/workflow-registry.ts:44-188` — 10 hand-written `WorkflowDefinition`s selected only by `getWorkflow(id)`; there is no `identifyWorkflow`/`suggestWorkflow` (`grep` → none). The brain cannot say "this turn IS the arrears-recovery workflow."
- `packages/skill-library/src/skill-capture/capture-loop.ts` + `voyager-library/library.ts:retrieveSkills` — capture + retrieval exist, but no turn path invokes a *learned skill* as a modality.

So `tool_call` and `spawn_sub_md` are the only reachable execution modalities. The arbiter is the missing 7-way head.

---

## 1. The seven modalities (the closed output set)

The arbiter, on each consequential turn, classifies the request into exactly one of seven **output modalities**, then routes:

| # | Modality | Routes to | Reversibility class | Rail posture |
|---|----------|-----------|--------------------|--------------|
| 1 | `chat` | `respond_to_owner` (existing) | reversible | none — pure text |
| 2 | `tab` | spawn/foreground a dynamic GenUI tab (`portal_tabs` row → blackboard slot) | staged (draft tab until owner pins) | body-change syscall (`EA-04`) |
| 3 | `document` | `document-templates.composeDoc` → render-worker (DOC lane) | staged (draft artifact, WORM-sealed) | none for draft; e-sign is `severe` |
| 4 | `media` | `media-generation` dispatcher (`createMediaDispatcher().generate`) | staged (draft artifact + C2PA) | NSFW/deepfake gate before publish |
| 5 | `action` | `tool_call` / `spawn_sub_md` (existing) | per-tool risk tier | full policy-gate + 9-hook chain |
| 6 | `skill` | invoke a learned skill from `skill_registry` (Voyager) | inherits the skill's templated tool risk | skill must be `human_reviewed=true` |
| 7 | `workflow` (incl. `loop`) | start a registered/authored workflow OR a standing loop via `loop-runner` | per-workflow; loop is `audit`-banded | per-flow autonomy posture (`flow_autonomy_prefs`) + `loop-quality-gates` |

**Design rule (closed-set discipline):** the arbiter NEVER invents a modality. The seven are a `const` union; an unrecognised classifier output **fails closed to `chat`** (the always-safe, zero-side-effect modality) and records a telemetry reason. This mirrors the existing fail-closed default in `tool-dispatcher.ts:214-222`.

---

## 2. Where it sits in the think-pipeline

The arbiter is a **pre-dispatch stage inside the orchestrator main-loop**, NOT a replacement for `router.call`. Two-layer design (frontier 3-tier cascade — see SOTA §7):

```
main-loop.ts think() tick:
  … assembleSystem() …
  decision = await deps.router.call({ system, tools, messages })   // L716 (unchanged)
  ┌──────────────────────────────────────────────────────────────┐
  │ NEW: const arb = await deps.modalityArbiter.classify({         │  ← INSERTED HERE
  │        req, decision, plan, postureInputs })                   │   (between L720 and L722)
  │  if (arb.modality !== 'chat' && arb.modality !== 'action')     │
  │     decision = liftToModalityDecision(decision, arb)           │
  └──────────────────────────────────────────────────────────────┘
  // existing permission-mode + 9-hook gating runs on the (possibly lifted) decision
  result = await dispatch(decision, deps)                          // L976 (unchanged)
```

**Why between `router.call` and the gates, not before:** the LLM router still does the heavy semantic lifting (it already emits `tool_call` with a concrete tool + args). The arbiter is a cheap **post-classifier** that decides whether that intent is better served by a higher-order modality. Putting it AFTER `router.call` means:
- it reuses the model's already-computed intent (no second expensive LLM pass on the cheap path);
- the new modalities still flow through the **same** permission-mode + 9-hook + risk-tier-ceiling gates (`main-loop.ts:725-903`) — no rail is bypassed;
- the existing `tool_call`/`respond_to_owner` paths are untouched when `modality ∈ {action, chat}` (default fast path, zero added latency for the 80% case).

**Cascade (latency budget):**
- **Tier 0 — rule short-circuit (sub-ms, no I/O):** if the router already emitted `tool_call`/`spawn_sub_md` AND no learned skill/workflow covers it → keep as `action`. If text-only AND request is a pure question → `chat`. Covers the majority; never touches an embedder or LLM.
- **Tier 1 — embedding nearest-neighbour (single pgvector query):** embed the turn intent once; cosine-match against (a) `skill_registry.description_embedding` (1536-dim, `<=>`), (b) workflow trigger embeddings, (c) tab/doc/media recipe descriptors. If top match ≥ τ (default 0.85, the SOTA hybrid threshold) → that modality wins. Reuses the SAME embedder the kernel already resolves (`brain-kernel-wiring.ts:581 resolveEmbedder`).
- **Tier 2 — LLM tie-break (only when 0 < topScore < τ):** a single cheap Haiku call returns one of the seven labels + a one-line reason. Bounded by the existing `llm-budget-governor`.

This is the exact 3-tier "rule → semantic → LLM" cascade that is 2026 SOTA for routing (see §7), and it keeps the median turn on Tier 0/1.

---

## 3. Reading autonomy / flow posture + rails (the AUT-14 half)

The arbiter is **autonomy-aware**: the chosen modality is only *proposed*; whether it auto-executes vs gates is decided by the existing continuous autonomy layer. The arbiter assembles the inputs and calls it — it does NOT re-implement gating.

**Inputs the arbiter gathers (all already exist):**

- **Per-flow posture** — read `flow_autonomy_prefs` (migration `0308_flow_autonomy_prefs.sql`, already shipped) keyed on `(tenant_id, flow_id)`: `posture`, `risk_ceiling`, `amount_threshold`. For a `workflow`/`loop` modality, `flow_id` is the workflow id; for ad-hoc modalities it is a synthetic per-tenant default row. This is the `DelegationMandate` ceiling.
- **Calibrated confidence** — `decideAutonomyInput.calibratedConfidence` from `@borjie/autonomy-governance` (`packages/autonomy-governance/src/decision/types.ts:149`), derived via `calibratedConfidenceFromConformal`. The arbiter's own Tier-1 cosine score is NOT the autonomy confidence — it only selects the modality; the autonomy confidence comes from the kernel `ConfidenceVector` (`kernel.ts:35`).
- **Consequence × reversibility** — each modality carries a static `consequenceTier`/`reversibility` (table §1) which the arbiter passes to `decideAutonomy(...)`. `media`/`document` drafts are `staged`; `tab` is `staged`; `skill`/`workflow`/`action` inherit the underlying tool tiers (money/licence/deletion = `severe`).
- **Situation flags** — `SituationFlags` (`types.ts:124`): novel counterparty, FX regime shift, drift-toward-sovereign, off-hours, defection-probe hit, `irreversibilityBudgetExhausted`. These can only **escalate**.

**The rail composition invariant (non-negotiable, copied from `autonomy-governance/decision/types.ts:30-38`):** the arbiter's autonomy verdict is ADDITIVE and may only ESCALATE. It calls `composeWithRail(...)` (`packages/autonomy-governance/src/decision/compose-with-rail.ts`) so that:
- if the policy-gate / `inviolable.ts` / a HIGH-risk literal prefix (sovereign / kill_switch / four_eye / policy_rollout) GATES, the modality is gated regardless of confidence — **rail-gate always wins**;
- the arbiter may turn a rail-ALLOWED modality INTO a gate, NEVER a rail-GATED one into auto.

**The meta-rail (the AGI-safety invariant, MASTER_GAP_REGISTER line 68 + `inviolable.ts:482`):** the arbiter can select `skill`/`workflow`/`tab` modalities that GROW capability, but any modality that would mutate the body (modalities 2/6/7 when they register/persist a new capability) MUST route its persistence through the unified body-change syscall (`@borjie/mutation-authority` `authorizeBodyChange`, gap `EA-04`). The arbiter never writes a `skill_registry`/`portal_tabs`/`workflow` row directly — it emits an intent the body-change executor authorizes. Money / licence / deletion stay dual-control HITL forever; the arbiter has no path to relax that.

---

## 4. How skill-capture / workflow-discovery outputs become selectable modalities

This is the "nowhere to land" problem the keystone solves. Both producers already emit rows; the arbiter's Tier-1 retrieval is the consumer that makes them *selectable*.

**Skill (modality 6):**
- Producer: `packages/skill-library/src/skill-capture/capture-loop.ts` → `SkillCaptureResult.captured=true` writes a `CodeSkill` with `human_reviewed=false` into `skill_registry` (table `packages/database/src/schemas/skill-registry.schema.ts:66`, `description_embedding VECTOR(1536)`, `status ∈ active|retired|shadow`).
- Selectable when: `status='active' AND human_reviewed=true`. The arbiter's Tier-1 query is `SELECT … FROM skill_registry WHERE tenant_id IS NULL OR tenant_id = :guc AND status='active' AND human_reviewed=true ORDER BY description_embedding <=> :intentVec LIMIT 5`. (RLS already FORCE-enabled on the table; the `tenant_id IS NULL` global-skill read path matches the existing corpus pattern.)
- Routed to: a new `run_skill` dispatch that re-plays the skill's `tool_call_template` through the SAME 9-hook chain. A learned skill is just a parameterised tool sequence; each underlying step is risk-tiered as today.

**Workflow / loop (modality 7):**
- Producer (existing catalog): `workflow-registry.ts` `WORKFLOWS` + `workflow-engine`'s `BUILT_IN_WORKFLOW_DEFINITIONS`.
- Producer (discovered, gap `AUT-07`): `packages/dynamic-recipe-authoring` `recipeAuthor` writes a new flow def (human-gated via body-change syscall). The arbiter consumes whatever is registered — it does not care whether the flow was hand-written or AFlow-discovered.
- Selectable when: the flow def has a non-empty trigger description that can be embedded. **Migration deliverable (§6):** add a `trigger_embedding` column + a `flow_modality_index` so the arbiter can nearest-neighbour flows the same way it does skills. Until a flow is embedded it is selectable only by explicit id (current behaviour preserved).
- Routed to: for a multi-step bounded flow → the workflow-engine; for a *standing/recurring* flow (`LoopKind ∈ reactive|tab_tick|deep_research|autonomous_24_7|recipe_lifecycle`, `loop-runner/src/types.ts:26`) → `runLoop(...)` from the orphan `@borjie/loop-runner`, wired here for the first time.

**The wiring that lights up the orphan:** the arbiter's `workflow` branch, when `arb.loopKind` is set, calls `deps.loopRunner.runLoop(input, loopDeps)`. `loopDeps` binds the five layer fns (sensors/policy/tools/quality/learning) to the SAME ports the kernel already has (policy → policy-gate; tools → tool registry; quality → `@borjie/loop-quality-gates`; learning → the stage-event-bus learning seam). This is the single seam that makes `loop-runner`, `work-cycle`, and `tab-as-loop` reachable from a turn.

---

## 5. The exact wiring seam in `services/api-gateway`

The arbiter is constructed in `buildOrchestratorComposeBlock` and threaded into the orchestrator deps block — the SAME function that already builds `router`, `dispatcher`, `memoryTool`, and the 9 hook ports.

**File:** `services/api-gateway/src/composition/brain-kernel-wiring.ts`, function `buildOrchestratorComposeBlock` (`:853-996`).

1. **Construct the arbiter** alongside the dispatcher (after `:960`):
   ```
   const modalityArbiter = orchestrator.createModalityArbiter({
     embedder,                              // the SAME resolveEmbedder(envSource) at :581
     skillRetriever:   buildSkillRetriever(args.db),        // SELECT … skill_registry <=> (RLS)
     flowRetriever:    buildFlowRetriever(args.db),         // SELECT … workflow trigger_embedding
     recipeDescriptors: buildModalityDescriptors(),         // tab/doc/media recipe vectors
     llmTieBreak:      args.anthropicMessagesClient,        // Tier-2 Haiku, budget-guarded
     autonomyDecider:  args.bindings.deps.decideAutonomy,   // @borjie/autonomy-governance
     flowPosturePort:  buildFlowPosturePort(args.db),       // reads flow_autonomy_prefs (0308)
     bodyChangePort:   args.bindings.deps.bodyChangeAuthority, // EA-04 mutation-authority
     loopRunner:       createLoopRunnerAdapter(args.db, args.toolRegistry), // wires the orphan
     logger,
   });
   ```
2. **Add `modalityArbiter` to the returned orchestrator block** (`:963-995`) as a new optional dep, exactly like `memoryTool`/`dispatcher` are returned today. Leave it OPTIONAL so the package compiles and tests that omit it still run (the main-loop treats an absent arbiter as "always `action`/`chat`" — i.e. exactly today's behaviour).
3. **Flag-gate the rollout** with the SAME lever pattern already documented at `:988-994`: read `BORJIE_MODALITY_ARBITER` from `envSource`; DEFAULT-OFF until a monitored canary flips it (mirrors `BORJIE_ORCHESTRATOR_MAINLOOP`). When off, the arbiter is not even constructed → zero added latency.

**Dispatch side** — `packages/central-intelligence/src/kernel/orchestrator/tool-dispatcher.ts` `createToolDispatcher`: extend the `dispatch()` switch (`:193-223`) to handle the new Decision kinds (`run_skill`, `run_modality` for tab/doc/media/workflow/loop) by delegating to injected handlers (`config.skillHandler`, `config.modalityHandler`), each defaulting to a structured ack-breadcrumb when unwired (same pattern as the existing `spawnHandler` fallback at `:180-186`). The real handlers are bound in `buildOrchestratorComposeBlock` next to `createSubMdSpawnHandler` (`:919`).

---

## 6. Files to change (file-level)

**New files (package — central-intelligence):**
- `packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts` — the arbiter: `createModalityArbiter(deps)` → `{ classify(input): Promise<ModalityVerdict> }`; the 3-tier cascade; the `Modality` const union + zod schema; `liftToModalityDecision(decision, verdict)`. Target <400 lines; extract the cascade tiers into helpers if it grows.
- `packages/central-intelligence/src/kernel/orchestrator/modality-arbiter-types.ts` — `Modality`, `ModalityVerdict`, `ModalityArbiterDeps`, `SkillRetrieverPort`, `FlowRetrieverPort`, `FlowPosturePort`, `LoopRunnerPort`, `BodyChangePort`. All `readonly` (immutability rule).
- `packages/central-intelligence/src/kernel/orchestrator/__tests__/modality-arbiter.test.ts` — see §8.

**Edited files (package — central-intelligence):**
- `packages/central-intelligence/src/kernel/orchestrator/decision.ts` — add two variants to the `Decision` union (`:135-160`): `{ kind: 'run_skill'; skillId; params }` and `{ kind: 'run_modality'; modality: 'tab'|'document'|'media'|'workflow'|'loop'; payload }`; add matching `DispatchResult` variants (`skill_ack`/`modality_ack`). Update the doc-comment header (`:1-23`) from "Six" to "Eight" variants.
- `packages/central-intelligence/src/kernel/orchestrator/main-loop.ts` — insert the arbiter call between `:720` and `:722`; add `modalityArbiter?` + `loopRunner?` to `OrchestratorDeps` (`:256-302`); thread the autonomy verdict into the existing permission-mode branch so a `gate` verdict becomes an `ask-approval` return (reuse the existing four-eye `ask-owner` path).
- `packages/central-intelligence/src/kernel/orchestrator/tool-dispatcher.ts` — extend `dispatch()` switch (`:193-223`) + add `skillHandler?`/`modalityHandler?` to `ToolDispatcherConfig` (`:34-66`).
- `packages/central-intelligence/src/kernel/orchestrator/index.ts` — export `createModalityArbiter`, types, and the new Decision variants.
- `packages/central-intelligence/src/kernel/orchestrator/anthropic-router.ts` — no behavioural change required (the arbiter post-classifies the router's existing output); optionally advertise modality affordances in the system preamble so the router emits richer `tool_call`s. Document only.

**Edited files (api-gateway):**
- `services/api-gateway/src/composition/brain-kernel-wiring.ts` — construct + thread the arbiter in `buildOrchestratorComposeBlock` (`:853-996`); add the `BORJIE_MODALITY_ARBITER` flag read.
- `services/api-gateway/src/composition/orchestrator-bindings.ts` — add `buildSkillRetriever`, `buildFlowRetriever`, `buildFlowPosturePort`, `createLoopRunnerAdapter`, `buildModalityDescriptors` (Drizzle-backed ports, RLS via `app.current_tenant_id` GUC; in-memory stubs for degraded boot — same dual pattern as the existing hook ports).
- `services/api-gateway/src/composition/sovereign.ts` — mirror the optional-orchestrator thread at `:901` so the alternate compose path also passes the arbiter.

**New migration:**
- `packages/database/src/migrations/0313_workflow_trigger_embedding.sql` (next free number — 0312 is taken by the MEM lane). Adds `trigger_embedding VECTOR(1536)` + a `workflow_registry` companion table IF flows are not already a table (today they are a static array — this migration introduces the persisted, embeddable flow catalog the arbiter retrieves over). FORCE RLS, `tenant_id` column + policy bound to `app.current_tenant_id` GUC (read allows `tenant_id IS NULL` global flows + tenant rows; write `WITH CHECK tenant_id = current GUC`), append-only, immutable once shipped. Includes the `vector_cosine_ops` ivfflat index for `<=>`.

**No money-path, no schema mutation of `skill_registry`** (it already has `description_embedding`); the arbiter only READS it.

---

## 7. SOTA grounding (2026)

The cascade + confidence-gated routing is current frontier practice, not invention:

- **3-tier routing cascade (rule → semantic → LLM)** is the documented 2026 pattern: a fast keyword/rule filter for obvious cases, a semantic (embedding nearest-neighbour) router next, and an LLM only as the low-confidence "catch-all" — with a hybrid confidence threshold (~0.85) below which it falls back to the LLM. This is exactly the Tier-0/1/2 design in §2. ([meganova 3-tier cascade](https://blog.meganova.ai/the-3-tier-routing-cascade-rule-based-semantic-llm/), [FutureAGI semantic router](https://futureagi.com/glossary/semantic-router/), [vLLM Semantic Router](https://vllm-semantic-router.com/))
- **Semantic routing pre-encodes example utterances per intent and routes by nearest-neighbour in embedding space** rather than asking an LLM to classify at runtime — the basis for embedding the skill/flow/recipe descriptors once and matching by cosine. ([NVIDIA LLM Router blueprint](https://build.nvidia.com/nvidia/llm-router), [workload-router-pool vision paper, arXiv 2603.21354](https://arxiv.org/pdf/2603.21354))
- **Skill routing at library scale is a named 2026 problem:** skill-selection accuracy degrades past a critical library size, so real systems need a retrieval step over a skill pool — validating the Tier-1 nearest-neighbour over `skill_registry` rather than stuffing all skills into the prompt. ([SkillRouter, arXiv 2603.22455](https://arxiv.org/pdf/2603.22455); [SkillOrchestra, arXiv 2602.19672](https://arxiv.org/pdf/2602.19672); [Agent Skills architecture survey, arXiv 2602.12430](https://arxiv.org/html/2602.12430v3))
- **Voyager procedural memory** — verified routines stored as runnable code, indexed by NL description, composed on the fly — is the model Borjie's `skill_registry` + capture-loop already implement; the arbiter is the missing selector that closes the loop. ([Voyager, arXiv 2305.16291](https://arxiv.org/html/2305.16291); [procedural-memory survey Mem^p, arXiv 2508.06433](https://arxiv.org/html/2508.06433v2))
- **Uncertainty-aware, confidence-gated autonomy** (maintain calibrated confidence, gate execution on it) is flagged as the distinctive 2026 challenge — matching the `composeWithRail` + conformal-calibrated `decideAutonomy` posture this spec routes through. ([memory-for-autonomous-agents survey, arXiv 2603.07670](https://arxiv.org/html/2603.07670v1))

---

## 8. Test plan (TDD, ≥80% on the new package code)

**Unit — `modality-arbiter.test.ts` (pure, deterministic stubs for embedder + retrievers + LLM):**
1. Tier-0 short-circuit: a pure question → `chat`; an already-emitted `tool_call` with no matching skill/flow → `action`. No embedder call (assert the stub embedder is NOT invoked).
2. Tier-1 skill hit: intent embedding cosine ≥ τ against a stubbed `skill_registry` row → `skill` with that `skillId`.
3. Tier-1 flow hit: matches a workflow trigger vector → `workflow`; a `LoopKind` trigger → `workflow` with `loopKind` set.
4. Tier-2 tie-break: 0 < topScore < τ → exactly one LLM call; its label is honoured; assert budget-bounded (one call only).
5. **Fail-closed:** classifier returns an unknown label → `chat` + telemetry reason (assert no side-effect handler fired).
6. **Autonomy escalation only:** a rail-GATED action with high confidence stays GATED (`composeWithRail` invariant); a rail-ALLOWED `media` draft with a `defectionProbeHit` flag escalates to `gate` (never `auto`).
7. **Meta-rail:** a `skill`/`tab` modality that would persist a new capability routes through the `bodyChangePort` (assert the port is called; assert the arbiter never writes the row directly).
8. **EN/SW purity:** Tier-2 LLM prompt + any arbiter-emitted reason text respects the single-language `languageDirective` — assert no EN/SW mixing in emitted strings (reuse the existing locale fixtures).

**Integration — extend `main-loop.test.ts`:**
9. With a wired arbiter dep, a turn whose router emits a tool_call BUT matches a learned skill produces a `run_skill` Decision that flows through the 9-hook chain (assert PII-scrub + denylist + four-eye hooks still fire).
10. Arbiter absent (dep undefined) → behaviour byte-identical to today (regression guard for the default-off path).

**Integration — api-gateway (`brain-kernel-wiring`):**
11. `BORJIE_MODALITY_ARBITER=off` → arbiter not constructed; turn latency + output identical to baseline.
12. Flag on → a `workflow` modality with a `LoopKind` actually invokes `runLoop` (assert the previously-orphan `@borjie/loop-runner` is reached) and persists a `loop_runs` audit-hash row under RLS.

**Migration CI:** `0313` must pass `migration-apply-check.yml` (fresh PG17 + pgvector lex-order apply) and `migration-safety-check.yml` (the new NOT NULL column ships `DEFAULT NULL`, no backfill hazard).

---

## 9. Reversibility & rollout

- **Default-OFF behind `BORJIE_MODALITY_ARBITER`** (mirrors `BORJIE_ORCHESTRATOR_MAINLOOP`). With the flag off the arbiter is not constructed and the main-loop falls through to today's `action`/`chat`-only behaviour — a single env flip is the kill-switch.
- **Additive Decision variants:** adding `run_skill`/`run_modality` to the union does not change the existing six; all current exhaustive `switch`es keep compiling because the dispatcher + main-loop fall closed on unknown kinds (existing pattern). Old callers that never receive the new kinds are unaffected.
- **Canary path:** flip the flag for one internal tenant first; watch the stage-event-bus telemetry (`STAGE_NAMES`) for `modality` distribution + the autonomy `gatedBy` reasons; the `loop-quality-gates` short-circuit and `composeWithRail` escalate-only invariant bound the blast radius.
- **Migration 0313 is forward-only + immutable** per the hard rule; its `down/` companion drops only the new column/table it created. No edit to any shipped numbered file.
- **No rail weakened:** every new modality flows through the SAME permission-mode + 9-hook + risk-tier-ceiling + `composeWithRail` gates; money/licence/deletion remain dual-control HITL; the meta-rail (`inviolable.ts:482`) is untouched.
