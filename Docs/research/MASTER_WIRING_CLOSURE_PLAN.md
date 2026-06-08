# MASTER WIRING CLOSURE PLAN — the awakening, dependency-ordered to zero gaps

**Document:** `Docs/research/MASTER_WIRING_CLOSURE_PLAN.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** the ONE synthesized closure plan — no code, no commit. Resolves the 43 confirmed wiring gaps (deduplicated across 6 reconnaissance lanes) onto the target SOTA connective architecture, ranked by severity, grouped into DISJOINT parallelizable waves.
**Bar:** SOTA, fiduciary-grade, **0 gaps**. Owner directive: "OUR WIRING, FULL SOTA, very important core part, 0 GAPS."
**Inputs:** `THE_ORCHESTRATION_ARCHITECTURE.md`, `THE_ARTIFACT_ENGINE_ARCHITECTURE.md`, `RENDER_DECISION_AND_THOUGHT_TREND.md`, `MASTER_ARCHITECTURE.md`, the blackboard-sota meta-substrate (EA-05), plus 43 confirmed + 24 verified-false-positive findings.

> **Definition in force.** A *wiring gap* = a real capability/organ that EXISTS in code but is NOT reachable on a live user path (orphan / dark / null-wired / unmounted / disconnected). NOT a wiring gap = something genuinely unbuilt (build gap) or already reachable via DI/registry/dynamic-import/runtime-mount/env-flag. **BLOCKER** = a dark capability on a live **paying-user** path (the default `/ask` turn, the money/licence/deletion path, or a mounted route a paying tenant can hit). Every claim below was spot-re-verified against live source on this branch.

---

## PART I — THE TARGET SOTA CONNECTIVE ARCHITECTURE (reason first, then map)

The 43 gaps are not 43 unrelated bugs. They are the *missing joints* of one body whose organs are already built to frontier quality. Before mapping a single fix, the correct first move is to state the **connective topology** every fix must conform to — otherwise we wire 43 point-to-point hacks and re-create the spaghetti. The architecture docs already chose the shape; this plan makes it the law every wave obeys.

### Principle 1 — There is ONE spine, and it is the blackboard CRDT slot bus, not point-to-point calls.

Every cross-organ message flows through the blackboard-sota slot spine (`createSlotStore` / `HandoffService` / the realtime broadcaster, already wired in `blackboard-slots-wiring.ts`). A pipeline writes sequential slots; a swarm writes handoff slots; an orchestrator-worker writes fan-out slots — **so a single flow can morph topology mid-task without leaving the spine**, unifying tracing, CRDT shared state, the hash-chained audit, and the cross-surface projection. The control-shell `pickNext` is the scheduler ON that spine. **Wiring rule:** an organ that needs to coordinate with another organ posts to a region and lets `pickNext` dispatch — it does NOT acquire a direct reference to the other organ. (Gaps OK-3, OK-1/2, EstateMind-bridge, ROMA all converge here.) Point-to-point is permitted ONLY for leaf adapter calls (a junior calling a connector), never for control flow.

### Principle 2 — Standing drives ACTUATE through the arbiter, not just notify.

The resident `EstateMind` is the conductor. Its Slow Loop senses + forms goals; a goal or an owner turn becomes a **post on a blackboard region**, the **Topology Arbiter** (the promoted modality-arbiter) routes it to ANSWER/SKILL/WORKFLOW/LOOP/AGENT-SWARM/ACTUATE, and the loop closes with a receipt. Today `EstateMind.PROPOSE` only writes a `proactive_nudge` row — sensor-only. **Wiring rule:** a motivated goal above a `confidence × (1−reversibility)` bar must emit an `OrchestratorRequest` into the arbiter-fronted spine (rails intact), not merely a nudge. This is the single wire that turns the resident Mind from a sensor into an actuator (OK-4), and it is the reason OK-1/2 (the arbiter + loop-runner) are blockers: without a live executor the actuator outlet has nowhere to land.

### Principle 3 — Durability is the substrate, not an opt-in. Effects are exactly-once by TYPE.

Every consequential step is a journaled durable checkpoint (outbox/inbox + saga journal) that survives restart and can recurse (ROMA). The actuator port carries `reversibility / idempotencyKey / dryRun / confirm / compensate` **in the type**, so at-least-once delivery × idempotent effect = exactly-once-effect, and `irreversible ⇒ requiresApproval ⇒ four-eye` falls out of the type system rather than code review. **Wiring rule:** the default chat/agency path runs ON the durable runner; `DURABLE_EXEC_ENABLED` and the unbound `createDurableRunner` are blockers because INV-G (durable, exactly-once-effect) is unmet by default (OK-5, OK-6).

### Principle 4 — There is ONE chokepoint for capability growth: the body-change meta-rail.

Surface persist, dynamic-section reorder, capability draft→live, self-extension, schema synthesis, and connection-graph mutation ALL route through `@borjie/mutation-authority.authorizeBodyChange` — one audited, reversible, hash-chained syscall. **Wiring rule:** nothing mutates the body except through this chokepoint; today it is a deny-stub behind two default-OFF flags (OK-7). Connection-as-DATA (Wave-5 self-wiring) and the topology-optimizer propose each edge mutation THROUGH this same chokepoint — they do not get a private back door.

### Principle 5 — Two planes, one membrane: full internal trace, zero client leak.

The full OTel GenAI trace runs on the internal/audit plane; any client (chat, mobile, artifact frame, Live re-query callback) sees ONLY a typed `StatusSpan | Output | Evidence` allow-list projection — never agent names, tool names, arbiter rationale, or chain-of-thought (INV-H/D). The egress guard is text-only today, so artifact frames/props bypass it (OK-8a), and the meta-rail runs in-process so a prompt-injected kernel can reach the rails (OK-8b). **Wiring rule:** EVERY new client-facing emission point (the three artifact routes, modality-artifacts, the Live binding) MUST pass through the projection boundary; every actuator call MUST pass through an out-of-process autonomy controller that writes the hash-chained decision-log entry FIRST, then permits the effect.

### Principle 6 — The composition root is where orphans become organs; barrels are the contract.

An orphan package becomes live by three things together: (a) a barrel entry (`src/index.ts`) exporting the public surface, (b) a declared dependency in the consumer's `package.json`, (c) a runtime trigger (a brain-tool registration, a kernel port binding, a cron/state-bus event, or a frontend import+render). Missing ANY one = dark. **Wiring rule:** dark backend capabilities are wired as **kernel ports** (the proven `buildSemanticCachePort` / `buildIntentVerifierPort` pattern at `sovereign.ts:631`) and surfaced as **brain tools** (registered in `brain-tools/index.ts`); dark frontends are wired as a **single SSE seam** (`tab-sse-parser.ts`) + a fetch-and-render resolver. We never reach into a package's deep path from a route handler.

### Principle 7 — Frontend↔backend joins through ONE SSE seam and ONE artifact-render contract.

`apps/owner-web/src/lib/tab-sse-parser.ts` is the single brain-SSE↔store seam. The eight mounted-but-unreached routes (document-render, modality-artifacts, artifacts/types, junior-ai, head/briefing, workflow, md-agentic, task-agents, proposals, persona-registry, admin/tenants/jurisdiction) are NOT eight independent UI projects — they share one root cause: **the brain-proposal → artifact-render seam was never connected, and the admin/owner surfaces that consume the mounted routes were never built.** **Wiring rule:** add the modality/document/artifact proposal events to the ONE SSE parser + a resolver hook that fetches the typed descriptor and routes it to `ArtifactRenderer` (the orphan presentational component) or the matching chart/table — then each remaining route gets its thin admin/owner page. One seam, then N pages.

**The plan's shape, in one sentence:** wire the spine (blackboard control-shell) and its conductor (arbiter + loop-runner + EstateMind actuator bridge) and its durability + meta-rail FIRST (the blockers, all in the orchestration code region), then the dark backend organs as kernel-ports/brain-tools, then the two membranes (egress projection + out-of-process rail), then the unmounted routers, then the ONE frontend SSE seam + its dependent pages, then the build-gap SOTA upgrades last.

---

## PART II — DEDUP, RANKING, AND THE BLOCKER SET

**Total confirmed gaps:** 43 (already deduplicated across the orphan-packages / dark-capabilities / null-wired-stubs / frontend-backend-disconnects / registered-but-unreachable / orchestration-sota-gaps lanes). The 24 verified false-positives are excluded by construction (semantic-cache/intent-verifier WIRED; insurance/cooperatives/mining barrels mounted; the HQ Temporal/NIDA/eArdhi dispatchers env-gated-not-dark; @borjie/cli a distributable; the well-known manifest server-to-server by design).

**Blocker set (8) — dark capability on a live paying-user path:** OK-1 (modality-arbiter default-OFF → loop/workflow dispatcher falls closed on the default turn), OK-2 (loop-runner is a breadcrumb stub → WORKFLOW/LOOP modality lands on an empty id), OK-3 (blackboard control-shell `pickNext` has zero runtime caller → the coordination scheduler never runs), OK-6 (durable-runner never instantiated + `DURABLE_EXEC_ENABLED` default-OFF → exactly-once-effect guarantee unmet by default), OK-7 (body-change meta-rail is a deny-stub behind two default-OFF flags → the single self-wiring chokepoint doubly dark), `notYetWiredConsolidationRunner` (the `platform.run_consolidation_tick` HQ tool throws `NotYetWiredError` on the live path). The two unmounted admin routers — **/api/v1/modules** and **/api/v1/admin/tenants/:id/jurisdiction** — are HIGH but conditional blockers (jurisdiction four-eye is a live admin path; modules needs a migration+store first, so it is dark-by-current-design).

Severity ranking used below: **BLOCKER** > **high** (dark organ, off the default turn but on a mounted/paying path) > **medium** > **low**.

---

## PART III — THE DISJOINT CLOSURE WAVES

Each wave is a set of gaps that share a code region so they can be built without colliding. The `disjointFrom` note lets waves run in PARALLEL on separate branches. Waves are ordered by dependency: Wave 1 (the spine + conductor) unblocks everything; Waves 2–9 are mutually parallel except where a dependency edge is stated.

---

### WAVE 1 — THE CONDUCTOR (orchestration blockers) ★ BLOCKER WAVE — do first, do alone

**Code region:** `services/api-gateway/src/composition/{brain-kernel-wiring,orchestrator-bindings,sovereign}.ts` + `packages/central-intelligence/src/kernel/orchestrator/main-loop.ts` + a new `control-shell-wiring.ts`. This is the single most coupled region in the repo; **everything else waits on it.**

**Gaps closed:** OK-1, OK-2, OK-3, OK-7 (4 blockers) + OK-4 (EstateMind actuator bridge, high) — they all touch the kernel composition and the dispatcher binding, so they MUST be one wave to avoid merge collisions on `brain-kernel-wiring.ts`.

| Gap | Exact fix |
|---|---|
| **OK-2 loop-runner stub** | Rewrite `createLoopRunnerAdapter` (`orchestrator-bindings.ts:1281`) to `import { runLoop } from '@borjie/loop-runner'`, inject db + tool registry + quality-signal/layer-outcome repos, call the real runLoop (transitively exercises `@borjie/loop-quality-gates` `CompositeGate`, closing the loop-runner + loop-quality-gates dark findings). Add `@borjie/loop-runner` to `services/api-gateway/package.json`. |
| **OK-1 arbiter default-OFF** | Flip `resolveModalityArbiterEnabled` (`brain-kernel-wiring.ts:429`) to default-ON for production (or set `BORJIE_MODALITY_ARBITER=on` in gateway env). The loop/workflow branch (`:1063-1072`) now flows to the real runner from OK-2. |
| **OK-7 body-change deny-stub** | Set `BORJIE_BODY_CHANGE=true`; in `buildBodyChangePort` (`orchestrator-bindings.ts:1209`) call `@borjie/mutation-authority.authorizeBodyChange` (add the dep) instead of the in-line inviolable+autonomy composition. Unblocks portal-genui persist, dynamic-section reorder, capability draft→live, self-extension, connection-graph mutations. |
| **OK-3 control-shell zero caller** | New `services/api-gateway/src/composition/control-shell-wiring.ts`: `createControlShell` bound into `main-loop.ts`; CompetenceLookupPort over `@borjie/capability-catalogue` + KSActivityClockPort; post goals/events into blackboard regions; run `pickNext` on region deltas; dispatch the `ControlActivation` to the KS dispatcher. SlotDelta already broadcasts via `blackboard-slots-wiring.ts`. |
| **OK-4 EstateMind actuator bridge** | In `estate-mind-wiring.ts` add a SECOND `proposalSink` path: when `goal.confidence × (1−reversibility)` crosses threshold, emit an `OrchestratorRequest` into the arbiter-fronted spine (via brain-orchestrator-turn / main-loop) IN ADDITION TO the `tab_event_log` nudge. |

**Risk:** flipping `BORJIE_MODALITY_ARBITER` + `BORJIE_BODY_CHANGE` on changes the default `/ask` topology and enables capability growth — both are guarded by inviolable + autonomy gates, but ship behind a canary + per-request override and watch cost/latency. The loop-runner real binding can blow token budget if the five-layer stack runs unbounded; enforce the per-turn budget envelope. This wave is **disjoint from** every other wave (no other wave edits the kernel composition or the dispatcher binding) — but every other wave's runtime *benefit* depends on it landing, so run it first and merge before the rest.

---

### WAVE 2 — DURABILITY + ACTUATOR SAGA (orchestration blockers, parallel to Wave 1 by file)

**Code region:** `services/api-gateway/src/composition/durable/durable-runner.ts`, `central-intelligence/src/index.ts` (the `DURABLE_EXEC_ENABLED` flag), a NEW saga executor + actuator port (`packages/*` + `agency-port-bindings.ts`), `inngest-client.ts`.

**Gaps closed:** OK-5 (reversibility-typed actuator port + durable saga, high), OK-6 (durable-runner never instantiated, BLOCKER).

| Gap | Exact fix |
|---|---|
| **OK-6 durable-runner unbound** | In `services/api-gateway/src/index.ts` (or new `durable-wiring.ts`) call `createDurableRunner(...)` and bind it as the agency executor backbone; set `DURABLE_EXEC_ENABLED=true`; wire `createInngestComposition` (or a DBOS-style Postgres saga journal) so checkpoints survive restart. Make the four-eye queue + ledger publisher durable via `DurableEventPublisher.enqueueToOutbox(events, tx)`. |
| **OK-5 actuator saga unbuilt+unbound** | Build a durable saga executor (Postgres saga journal) that walks `PortAction[]` via a `reversibility/idempotencyKey/dryRun/confirm/compensate`-typed actuator port, runs compensations in reverse on failure, resumes from a gated step on approval. Bind as the default ACTUATE executor in the dispatcher (`brain-kernel-wiring.ts`) and bind receipts into the hash-chained audit chain. |

**Risk:** OK-5 is partly a build gap (no `*saga*` file exists; `durable-runner.ts` lists compensation as out-of-scope) — scope it as build-the-executor + wire-it, not pure wiring. **Dependency edge:** OK-5's actuator-port binds into the same `brain-kernel-wiring.ts` dispatcher Wave 1 edits, so Wave 2's *dispatcher binding* must land AFTER Wave 1 merges (the rest of Wave 2 — durable-runner instantiation, saga journal — is fully parallel). Disjoint from Waves 3–9.

---

### WAVE 3 — DARK BACKEND ANALYTICS ORGANS (kernel-ports + brain-tools)

**Code region:** `packages/central-intelligence/src/kernel/` (new ports, the `buildSemanticCachePort` pattern), `services/api-gateway/src/composition/brain-tools/index.ts`, `sovereign.ts:631`, `packages/market-intelligence/src/{disruption-detector,sell-signals}.ts`, `packages/central-intelligence` learning loop.

**Gaps closed:** anomaly-detection DARK (high), causal-inference DARK (high), belief-engine DARK (high), reflexion nightly sleep DARK (high), runDebate dark on normal turns (medium), scientific-discovery orphan-package + sidecar (high+medium). These all become live by the SAME mechanism (port → brain-tool / kernel binding), so one wave.

| Gap | Exact fix |
|---|---|
| **anomaly-detection** | New `AnomalyDetectionPort` in `kernel/` (alongside semanticCache/intentVerifier); mining wrappers (equipmentVibrationOutlier/fuelConsumptionSpike/royaltyFilingIrregularity) registered as a brain tool in `brain-tools/index.ts`; replace the `LATER(wire)` comment in `market-intelligence/src/disruption-detector.ts:7,12` with the real import; feed anomalies into the proactive tick; bind the port in `sovereign.ts` like `buildSemanticCachePort` at `:631`. |
| **causal-inference** | New `CausalInferencePort` in `kernel/`; causal-analysis brain tool (grangerCausality/backdoor/counterfactual) in `brain-tools/index.ts`; replace `LATER(wire)` in `market-intelligence/src/sell-signals.ts:7,15`; route heavy analysis through the scientific-discovery-sidecar (DoWhy/tigramite); bind port in `sovereign.ts`. |
| **belief-engine** | In a composition root (`sovereign.ts`/`service-registry.ts`) add `import { reviseBelief } from '@borjie/belief-engine'`, build a Drizzle-backed `BeliefStorePort` over `brain_beliefs/belief_revisions/belief_review_queue`, call `buildBeliefSink(...)` (`learning-loop-port.ts:242-376`) into the kernel learning loop, bind `learning-signal-emitter`; surface `belief_review_queue` as a HITL operator inbox route. |
| **reflexion nightly sleep** | Add a reflexion-consolidation pass calling `runNightlySleep` (`nightly-sleep.ts:77`) into the EXISTING `services/sleep-pass-orchestrator` (register in `src/passes/index.ts`, nightly schedule); wire central-intelligence reflexion ports so dedupe→extract→update→prune persists learned guidelines to the reflexion buffer. (Session-end writer already live — do not touch it.) |
| **runDebate** | Bind a `DebatePort` in the MAIN kernel composition (`sovereign.ts` ~`:631`) reusing `executive-brief.composition.ts:573 buildDebate()`, so high/critical-stakes normal turns enter the debate detour; gate via env flag + `?includeDebate=true`; stream the trace over SSE (through the egress projection from Wave 5). |
| **scientific-discovery (pkg+sidecar)** | Add `packages/scientific-discovery/src/index.ts` (MISSING today — `main` points at non-existent `./dist/index.js`) re-exporting co-scientist orchestrator / causal-fusion clients / discovery-card emitter / seed-library; add `@borjie/scientific-discovery` to a consumer (`proactive-intel-worker` or central-intelligence brain composition) + a trigger (cron or state-bus event). Sidecar: add to the CD image matrix + deploy overlay (`infra/k8s/scientific-discovery-sidecar/overlays/<env>`), set `DISCOVERY_SIDECAR_URL`, wire the causal-fusion refutation/pcmciplus client into a live consumer. (If deprecated: archive package + overlay — decide product intent first.) |

**Risk:** these add real compute to the proactive tick + nightly sleep — gate each port behind an env flag + budget so a slow causal job can't stall a turn; the sidecar deploy is infra (needs the CD matrix change + ExternalSecret). The brain-tool registrations touch `brain-tools/index.ts` and `sovereign.ts` which Wave 1 also touches lightly — **dependency edge:** land the kernel-port additions AFTER Wave 1's `sovereign.ts` edits to avoid a three-way merge, or coordinate the `sovereign.ts:631` block. Disjoint from Waves 4–9.

---

### WAVE 4 — DARK DATA-LIFECYCLE + KG-TEMPORAL ORGANS

**Code region:** `services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts`, `services/api-gateway/src/routes/knowledge-graph.hono.ts`, `services/consolidation-worker/src/tasks/`, `packages/data-protection/`, `packages/portal-genui/src/persistence/drizzle-tab-repo.ts`.

**Gaps closed:** prov-o + bi-temporal time-travel DARK on KG ingest (high), retention-runner + rtbf-orchestrator UNWIRED (high), CRDT/yjs unwired — portal_tabs lost-update (medium). Distinct files from Wave 3, so fully parallel.

| Gap | Exact fix |
|---|---|
| **prov-o + bi-temporal KG** | Modify `postgres-kg-store.ts` `upsertNode/upsertEdge` (the live `ON CONFLICT ... DO UPDATE` overwrite at `:171-181`) to call the KG bi-temporal timestamp-and-invalidate path (set `invalidatedAt` on the prior row + insert a new valid-time row — the `temporal-entity-graph.schema.ts` already has the columns) instead of destructive overwrite. Bind `provenance/prov-o` as an observer on KG mutations; add `GET /kg/{entityId}/history?as-of=` to `knowledge-graph.hono.ts`. |
| **retention-runner + rtbf-orchestrator** | RESOLVE THE DUPLICATION FIRST: the live RTBF request path is served by `createDsarRtbfExecutor` from `@borjie/ai-copilot/gdpr` (`service-registry.ts:2566`). Either (a) consolidate onto it and DELETE the `@borjie/data-protection` retention-runner/rtbf-orchestrator, or (b) if the archive-first policy engine is intended, add `@borjie/data-protection` as a dep of `consolidation-worker`, create a retention-runner task in `src/tasks/` scheduled like `corpus-ingest-cron`/`ledger-attestor-cron`, route operator RTBF through the break-glass audit chain. Do NOT wire both. |
| **CRDT/portal_tabs lost-update** | Add optimistic-concurrency to `drizzle-tab-repo.ts` `save()` (`:75-97`): a real `row_version` column (distinct from `schema_version`) + `WHERE portal_tabs.version = $expected`, return conflict on mismatch — OR route surface edits through the wired blackboard-sota `slot-crdt` `mergeSlot` path / wire `@borjie/realtime-rooms` `yjs-doc` into a `/surfaces/{id}/sync` websocket. Minimum viable = the version-CAS column; CRDT merge is the SOTA upgrade. |

**Risk:** the KG temporal change rewrites the hottest ingest path — bench it (an invalidate+insert is two writes vs one upsert) and migrate-then-cutover behind a flag so existing `kg_nodes` rows backfill cleanly. The RTBF de-dup is a deletion path — get product sign-off before deleting either implementation (deletion is INV-E, HITL forever). Disjoint from all other waves (own files).

---

### WAVE 5 — THE TWO MEMBRANES (egress projection + out-of-process rail)

**Code region:** NEW `services/api-gateway/src/composition/artifact-egress-wiring.ts`, `packages/genui/src/projector.ts`, NEW out-of-process autonomy controller (sidecar/subprocess) wrapping `services/api-gateway/src/services/auto-authorize-gate/index.ts` + policy-gate + inviolable + kill-switch.

**Gaps closed:** OK-8a (IP-egress guard text-only, artifact frames bypass it, high), OK-8b (meta-rail in-process, high).

| Gap | Exact fix |
|---|---|
| **OK-8a artifact egress** | Build `artifact-egress-wiring.ts` that wraps `projectArtifactToUiPart` output (`packages/genui/src/projector.ts:64`) AND any Live re-query callback with a typed `StatusSpan/Output/Evidence` allow-list projection before serialization; bind it in the api-gateway artifact response path so artifact frames cannot emit agent names, tool names, arbiter rationale, or chain-of-thought (INV-H/D). |
| **OK-8b out-of-process rail** | Extract policy-gate + inviolable + kill-switch + rate-limits + budget into an out-of-process autonomy-controller (secure subprocess/sidecar). Every external actuator call (`LedgerService.post`, licence filing, deletion, external comms, body-change syscall) routes through it; it writes the hash-chained decision-log entry FIRST then permits the effect, and is unreachable from the agent loop even under prompt-injection. |

**Risk:** OK-8b is the heaviest structural change (process boundary + IPC) and touches the money/licence/deletion path — phase it: first make the gate calls go through a single chokepoint module in-process, then lift that module out-of-process. OK-8a is the prerequisite for safely streaming the Wave-3 debate trace and the Wave-6/8 artifact routes to clients — **dependency edge:** OK-8a should land before the frontend artifact seam (Wave 8) goes live to a paying tenant. Disjoint from Waves 3, 4, 6, 7, 9 by file.

---

### WAVE 6 — UNMOUNTED ROUTERS + NULL-WIRED EXECUTORS (gateway index + composition)

**Code region:** `services/api-gateway/src/index.ts` (the `api.route(...)` mount block), `services/api-gateway/src/composition/{service-registry,hq-tool-port-bindings,hq-tool-registry}.ts`, `services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts`, `routes/modules.hono.ts`, `parity-capability-dashboard.factory.ts`, `packages/database/src/migrations/` (one forward migration for modules).

**Gaps closed:** `notYetWiredConsolidationRunner` (BLOCKER), `/api/v1/admin/tenants/:id/jurisdiction` unmounted (high), `/api/v1/modules` unmounted (high), `parity-capability-dashboard.rejudge()` stub (medium).

| Gap | Exact fix |
|---|---|
| **consolidationRunner null-wire** | In `service-registry.ts` (~`:2722`, near `createHqToolPortBindings`): `const consolidationWorker = createConsolidationWorkerAdapter({ runner: { runForActiveTenants: (a) => runConsolidationForActiveTenants(db, anthropic, { tenantId: a.tenantId, dryRun: a.dryRun }) }, logger })`; add an optional `consolidationWorker` param to `createHqToolPortBindings` that forwards into `createHqToolRegistry({ consolidationWorker })`. `createConsolidationWorkerAdapter` already exists at `hq-tool-registry.ts:912`. Stops `platform.run_consolidation_tick` throwing `NotYetWiredError` on the live path. |
| **admin/tenants/jurisdiction** | In `index.ts` import `createAdminTenantJurisdictionRouter` near the other admin imports (~`:547-578`); construct deps matching `TenantJurisdictionRouteDeps` (`:197`) — `JurisdictionProposalStore`, `TenantJurisdictionWriter`, the existing hash-chained `AdminAuditChainWriter` (reuse `adminSuperpowersRouter`'s), `CockpitPulseEmitter`, `AdminContextResolver`, `AdminLogger`; mount `api.route('/admin/tenants', createAdminTenantJurisdictionRouter(deps))` near the adminSuperpowers mount (~`:2447`); add the four endpoints to `src/openapi/manifests.ts`; add an HTTP four-eye PROPOSE→APPROVE integration test. |
| **/api/v1/modules** | NOT a one-line mount — needs real deps deliberately removed. Sequence: (1) forward migration recreating `modules/module_specs/module_templates/module_accept_handlers` (reverse of the 0306 lane decision); (2) a Drizzle-backed `ModulesStorePort` impl under `composition/`; (3) `import { createModulesRouter }` + `api.route('/modules', createModulesRouter({ deps, resolveTenantId, resolveUserId }))` after `/mining` (~`:2010`); (4) OpenAPI manifest entry. **If Piece-B module-spawning is not a launch capability, DELETE `modules.hono.ts` instead** — confirm product intent first. |
| **parity-dashboard rejudge stub** | Mount the kernel-eval judge-runner worker in api-gateway composition; thread it into `createParityCapabilityDashboard` (`service-registry.ts:2970`) so `rejudge()` enqueues a real task (row to a rejudge queue / call the eval worker) and returns a durable task id instead of synthetic `queued:true`. |

**Risk:** the modules router requires a NEW forward migration + store — the heaviest item; if product intent is "not at launch," the correct closure is deletion, not wiring (gate on owner decision). The jurisdiction router is on the admin four-eye path — its integration test is mandatory before mount. Disjoint from the frontend waves; touches `index.ts` mount block which no other wave edits (Wave 1 edits composition, not the mount block — coordinate only if both touch `index.ts` imports).

---

### WAVE 7 — DARK CONNECTORS + E-SIGNATURE (HQ-tool + action-runtime step handlers)

**Code region:** `services/api-gateway/src/composition/{hq-tool-port-bindings,ported-platform-wiring,modality-capability}.ts`, the action-runtime executor (the `action-runtime.schema.ts` kind dispatcher), `packages/{document-ai,document-studio}/src/`.

**Gaps closed:** GePG real adapter UNWIRED (high), E-signature DARK + duplicated (high).

| Gap | Exact fix |
|---|---|
| **GePG control-number** | Add `createGepgRealAdapter` to the `@borjie/connectors` import in `hq-tool-port-bindings.ts:43-51` (currently imports only eArdhi/NIDA); bind it as an HQ tool / saga step; implement a `FILE_GEPG` step handler (the kind is already reserved in `action-runtime.schema.ts:127`) in the action-runtime executor, with an action-audit trail (filer/timestamp/filing-ref). |
| **E-signature** | Pick ONE adapter (recommend `document-studio` Dropbox-Sign), DELETE the duplicate `document-ai/src/e-signature/{docusign,adobe-sign,hellosign}` stack; in `ported-platform-wiring.ts:139` pass the real `eSignature` port to `createDocumentAI({ eSignature })` (and/or `createDocumentStudioWithCoreTypes` with the real esign adapter instead of `useStub:true`); add a `SEND_SIGNATURE_REQUEST` step handler + a `SIGN_COMPLETE` webhook receiver that marks the step COMPLETED, with an action-audit trail. |

**Risk:** both write to external regulators/signature providers — they MUST execute via the Wave-2 reversibility-typed actuator saga (irreversible filings = four-eye), so the step handlers depend on Wave 2's actuator port for the audit/compensation contract. The e-sig de-dup deletes a real package stack — confirm no other consumer first. **Dependency edge:** land after Wave 2 (the step handlers bind into the saga executor). Disjoint from Waves 3, 4, 5, 8, 9.

---

### WAVE 8 — THE FRONTEND SEAM + ARTIFACT-RENDER (one SSE seam, then the artifact pages)

**Code region:** `apps/owner-web/src/lib/tab-sse-parser.ts` (the ONE seam), `apps/owner-web/src/components/{artifacts/ArtifactRenderer,genui-tab/GenUITabHost,genui-tab/use-genui-tab}.tsx`, `packages/api-sdk/src/types.ts`. Frontend only — fully parallel to all backend waves.

**Gaps closed (share ONE root cause — the brain-proposal→artifact-render seam):** Document Render `/document-render` (high), Modality Artifacts `/modality-artifacts` (high), Artifact Types `/artifacts/types` + `/:id/render` (low). The `ArtifactRenderer.tsx` orphan component is bound here.

| Gap | Exact fix |
|---|---|
| **The shared seam (do once)** | Add `modality-proposal` / `document` / `artifact` events to `tab-sse-parser.ts`'s `TAB_SSE_EVENTS` (today only `tab_spawn/update/remove/proposal/tag_error`); add a resolver hook (mirroring `use-genui-tab.ts`) that on receipt fetches the typed descriptor and routes it to the matching renderer. The brain emit side must set the `proposalId` the resolver fetches. |
| **Document Render** | Mount the orphan `ArtifactRenderer.tsx` inside `GenUITabHost.tsx` (or a new artifact tab kind in `tab-sse-parser.ts`'s `TAB_KINDS`); fetch hook calls `GET /api/v1/document-render/jobs/:id` (typed at `api-sdk/src/types.ts:3330`) and pipes the HTML into `ArtifactRenderer`'s `bodyHtml` prop. |
| **Modality Artifacts** | On the new `modality-proposal` SSE event call `GET /api/v1/modality-artifacts/:proposalId`; route the typed descriptor (forecast→chart, document→`ArtifactRenderer`, media→media renderer). |
| **Artifact Types** | At owner-web boot call `GET /api/v1/artifacts/types` to populate a renderer registry; on proposal arrival call `GET /api/v1/artifacts/:id/render` for HTML fed into `ArtifactRenderer`. |

**Risk:** the artifact HTML must pass the Wave-5 egress projection (OK-8a) before it reaches the browser — **dependency edge:** OK-8a (Wave 5) lands before this wave is enabled for a paying tenant, else artifact frames could leak mechanic fields. All `ArtifactRenderer` HTML is DOMPurify-wrapped (hard rule). Disjoint from every backend wave (owner-web files only).

---

### WAVE 9 — THE REMAINING ADMIN/OWNER SURFACES (thin pages over mounted routes)

**Code region:** `apps/admin-web/src/app/` + `apps/owner-web/src/app/` (new pages only) + `@borjie/api-client` consumers. Pure frontend, parallel to Wave 8 (different page files) and all backend waves.

**Gaps closed:** Junior AI Factory `/junior-ai` (medium), Head Briefing `/head/briefing` (medium), Workflow Engine `/workflow` + `/flow-autonomy` (medium), MD Agentic `/md-agentic` (medium), Task Agents `/task-agents` (low), Proposals `/proposals` (low), Persona Registry `/persona-registry` (low).

| Gap | Exact fix |
|---|---|
| **Junior AI Factory** | New `apps/admin-web/src/app/internal/ai-factory/page.tsx` with `POST/GET/PUT/DELETE /api/v1/junior-ai/*` + provisioning form. Distinct from the read-only `/internal/juniors` registry view. |
| **Head Briefing** | New `apps/owner-web/src/app/(routes)/head-briefing/` importing `headBriefingService` from `@borjie/api-client` (SDK wrapper already exists, zero consumers today), `getMyBriefing()` on mount → render `BriefingDocument`. |
| **Workflow Engine** | New `apps/admin-web/src/app/workflows/` — CRUD fetches to `/api/v1/workflow` + SSE run status + a `/flow-autonomy` control surface. |
| **MD Agentic** | New `apps/owner-web/src/app/(routes)/agentic-plan/` — `POST /api/v1/md-agentic/plans`, GET the plan, `/sandbox/writes` commit/reject, gated behind four-eye for high-stakes commits. |
| **Task Agents** | New `apps/admin-web/src/app/task-agents/` listing `GET /api/v1/task-agents` + details panel. |
| **Proposals** | New `apps/admin-web/src/app/proposals/` fetching `GET /api/v1/proposals?status=pending_hitl`, posting `/approve|decline`. Distinct from the arrears-proposals hook. |
| **Persona Registry** | New SUPER_ADMIN-gated `apps/admin-web/src/app/personas/` fetching `GET /api/v1/persona-registry`, rendering persona definitions. Distinct from `/persona-drift`. |

**Risk:** low — these are thin CRUD pages over already-mounted, already-tested routes; the only real gates are RBAC (SUPER_ADMIN for persona-registry, four-eye for md-agentic high-stakes commits). MD-Agentic + Workflow surfaces should respect the Wave-2 durable saga for commit/trigger semantics but can ship read-first. Disjoint from all backend waves and from Wave 8.

---

### WAVE 10 — THE SOTA BUILD-GAP UPGRADES (last; these are build-then-wire, not pure wiring)

**Code region:** `packages/central-intelligence/src/kernel/orchestrator/` (new `artifact-arbiter.ts`, ROMA pipeline in `md-subagent-executor.ts`), `modality-arbiter.ts`, `packages/genui/` (artifact-engine), `brain-teach.hono.ts` (render-decision arbiter), a new system-graph schema + topology-optimizer.

**Gaps closed (all medium, all flagged as part build-gap):** Topology selection (ω/δ/γ) absent, Cost-penalized orchestrator (Puppeteer/RouteLLM) not applied, Render-decision arbiter (INV-L) not typed, Connection-as-DATA + topology-optimizer absent, Recursive ROMA not replacing flat `runSubagentTeam`, Artifact-engine (ArtifactSpec/scale-policy/renderTo/mint/Live) absent.

| Gap | Exact fix |
|---|---|
| **Topology selection** | New `artifact-arbiter.ts` (or extend `modality-arbiter`): O(\|V\|+\|E\|) DAG-feature extractor computing ω/δ/γ over decomposed subtasks + decision rules (high ω + γ≤0.6→orchestrator-worker; ω=1→pipeline; γ>0.6 + \|V\|>5→hierarchical; else hybrid) + stall-detector re-route with γ′=γ+0.2. Wire into the AGENT/AGENT-SWARM modality path. |
| **Cost-penalized orchestrator** | Bind a RouteLLM cheap-first classifier (on-device MiniLM) in `modality-arbiter`; wire the Puppeteer `Cₜ=F·log(1+t/φ)` penalty into the orchestrator objective; per-turn budget envelope from `tenant-budget-envelopes`; replace `max_iterations` with a VoI circuit-breaker. |
| **Render-decision arbiter** | Add a deterministic five-signal scorer (ephemerality, reference-value, trend-worthiness, teaching-intent, consequence)→INLINE\|BLACKBOARD\|TAB in `brain-teach.hono.ts` (extending the strip pipeline at `:854-877`); route the BLACKBOARD tier through the wired CRDT slot bus (`getSlotStore`, imported at `:122`). |
| **Connection-as-DATA + optimizer** | Model the connection graph as RLS-governed rows (endpoints \| transport \| capability_contract \| reversibility \| trust_tier \| fitness_score); a slow-loop topology-optimizer proposes each edge mutation as a reversible `bodyChange` via the Wave-1 meta-rail chokepoint, keeping only edges beating the incumbent on 7/28/91-day outcomes. |
| **Recursive ROMA** | Replace `md-subagent-executor.ts` `runSubagentTeam` (`:103-145`, flat fan-out) with a ROMA four-stage pipeline (Atomizer→Planner→Executor[recurses]→Aggregator), each node a durable checkpoint (depends on Wave 2). |
| **Artifact engine** | Build `artifact-spec.ts` (ONE zod union) + generalize `projector.ts` to `renderTo(spec, surface)` with `themeTokenSetId` (kill SVG hex, INV-K); `artifact-arbiter.ts` (form+surface); `scale-switch.ts` + DataTable virtualization; `conformance-gate.ts` + `mint-primitive.ts`; `live-binding.ts` (artifacts re-query the brain through the Wave-5 egress guard). |

**Risk:** these are the genuine build-then-wire items — they are listed as wiring gaps because the *integration seam* is the missing part, but each carries real new code. They depend on Wave 1 (the arbiter/spine), Wave 2 (ROMA durability + topology-optimizer reversible bodyChange), and Wave 5 (the artifact-engine Live binding through egress). Sequence them LAST and behind flags. Disjoint from Waves 3, 4, 6, 7, 9 by file.

---

## PART IV — PARALLELISM MAP (how to run the waves)

- **Wave 1** runs FIRST and ALONE (the kernel composition is the most-coupled region; everything's runtime benefit depends on it). Merge before enabling the rest.
- **Waves 2, 3, 4, 5, 6, 8, 9** can then run **in parallel on separate branches** — they touch disjoint file sets (durable/saga · kernel-ports+brain-tools · KG+data-protection+portal-genui · egress+rail · gateway-mount+composition · owner-web SSE seam · admin/owner pages).
- **Dependency edges to honor:** Wave 2's *dispatcher binding* and Wave 3's *sovereign.ts port block* land after Wave 1 merges; Wave 7 (connector/e-sig step handlers) lands after Wave 2 (actuator saga); Wave 8 (artifact frontend) enabled for paying tenants after Wave 5 (OK-8a egress); Wave 10 lands LAST (depends on 1, 2, 5).
- **Blocker burn-down order:** OK-2 → OK-1 → OK-7 → OK-3 (Wave 1), OK-6 → OK-5 (Wave 2), consolidationRunner (Wave 6) — these 7 clear the dark-on-paying-path set; the two unmounted admin routers (Wave 6) clear the conditional blockers (modules gated on product intent).

## PART V — DONE = 0 GAPS

Closure is verified, per wave, by: (1) a reachability test proving the organ executes on a live path (a request hits the brain tool / the route returns non-stub / the SSE event renders); (2) the egress/policy boundary asserted where the wave crosses a membrane; (3) the relevant CI eval (kernel-eval, eval-orchestrator-scenarios, lats-search-eval, trajectory-eval) green; (4) the `audit-not-yet-wired` workflow staying at 0 and the dependency-cruiser orphan baseline not regressing past 16. When all ten waves close, every one of the 43 confirmed organs is reachable on a live user path and the "we have the organs, we lack the joints" finding is retired.
