# VISION CODE AUDIT — where we can / cannot self-construct the org today

**Lane:** `borjie-bn-code-audit`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** code-audit subagent (repo READ-ONLY pass over Borjie; BN parity reasoned from the shared-spine knowledge)
**Scope:** Map EXACTLY where Borjie can and cannot self-construct the organization today, against the owner vision of a **self-constructing organizational brain** (synthesize the org data-model, surfaces, org-graph, task-routing, and a proactive org-design loop DYNAMICALLY — nothing hardcoded/mock — creating anything missing through a `bodyChange` meta-rail + user approval; UI changes reasoned-need-only, proposal-gated, chat-refinable, reversible). One PRESENT / PARTIAL / ABSENT verdict per pillar, with file-line evidence, plus BossNyumba parity.

> Method: re-read CLAUDE.md, MEMORY.md, the three vision dossiers (`vision-dynamic-schema.md`, `vision-generative-surfaces.md`, `vision-org-graph-twin.md`), the `MASTER_GAP_REGISTER.md` UI/Modality invariant + EA/AUT/KI/MEM rows, then grepped the actual substrate: `packages/database` (core_entity family migration 0306 + repository), `portal-genui` + `dynamic-sections` + `mutation-authority`, the `modality-arbiter` + `body-change-syscall`, `system-graph` + `org-graph` + `knowledge-graph`/`graph-rag-router`, `ai-copilot/src/juniors`, and the gateway composition root. The audit distinguishes **built** (code exists) from **wired** (reached by a live request/cron path) — the gap is almost always the second, not the first.

---

## 0. Headline

The owner vision decomposes into **5 pillars**. The substrate for all five is **built to frontier quality in package source**, but the self-constructing *loop* is **not closed** for any of them — every pillar is gated on either an unwired composition seam or a missing induction/derivation pass:

| # | Pillar | Verdict | One-line |
|---|--------|---------|----------|
| 1 | Schema synthesis (data-model) | **PARTIAL** | The 4-plane meta-schema ships in migration 0306 (core_entity + type catalog + field catalog, RLS-safe) and the repository has a manual `tenant_schema_extensions` writer — but ZERO induction loop proposes types/fields from evidence; built-in catalog is 17 **real-estate** types. |
| 2 | Surface synthesis & surface-graph | **PARTIAL** | Single-surface synthesis is PRESENT and proposal-gated end-to-end (portal-genui → modality-arbiter → proposal-sink → owner tray, reversible). A surface-**GRAPH** (typed nodes/edges, navigable, coherent under migration) is ABSENT. |
| 3 | Org-graph / digital twin | **PARTIAL→ABSENT** | `org-graph`, `system-graph`, `knowledge-graph` packages exist; but `deriveSystemGraph` is invoked only in tests, the org-graph projector emits **property-domain** edges and is not run as a worker, the KG ontology is real-estate, and there is no simulatable twin. |
| 4 | Skill / capacity routing (task assignment) | **PARTIAL** | ~27 mining juniors are statically registered + routed by `lens-router`/`executor-registry`; the modality-arbiter can route to a learned `skill`/`workflow` — but skill *capture/synthesis* never compiles a new skill, and capacity/load-aware assignment is absent. |
| 5 | Proactive org-design loop | **ABSENT** | `self-extension.ts` (detectRecurringGap → proposeNewSubMd → compileAndDeploySubMd) has ZERO callers; evolution workers lack Dockerfiles/k8s; no twin proposes org redesigns. |

**The one keystone that unblocks 1, 2, 4, 5 simultaneously:** the body-change meta-rail is *structurally* wired into the modality-arbiter but its port is a **fail-closed stub** — `buildBodyChangePort()` always denies, so every capability-growth path (register skill, spawn tab, register workflow, propose schema/type) falls back to `chat`. Binding the real `@borjie/mutation-authority.authorizeBodyChange` at that seam is the single highest-leverage change.

---

## 1. PILLAR — Schema synthesis (the data-model the org induces, not a fixed schema) — **PARTIAL**

### What is PRESENT (storage + governance plane)
The 4-plane meta-schema the vision requires is real and RLS-safe in `packages/database/src/migrations/0306_create_core_entity_family.sql`:
- `core_entity` (L80-95): polymorphic root with `entity_type text NOT NULL`, `custom_fields jsonb DEFAULT '{}'`, a **GIN index on `custom_fields` jsonb_path_ops** (L134), `vector(1536)` embedding (L118), PostGIS geog, FORCE RLS on `app.current_tenant_id` (L411-442). This is the SOTA "JSONB + config-table" pattern (`vision-dynamic-schema.md` §1.4) exactly.
- `entity_type_definition` (L186-221): the **type catalog**, with a `core_entity_type_check` trigger (L226-245) enforcing "instances must reference a declared type" — the §2 type-catalog plane.
- `tenant_schema_extensions` (L251-279): the **per-tenant field catalog as data**, with the `tenant_id IS NULL OR tenant_id = guc` platform-shared RLS carve-out (L444-474) so built-ins stay global while tenant fields isolate.
- A **manual writer exists**: `packages/database/src/repositories/core-entity.repository.ts:366` inserts `tenantSchemaExtensions` rows, and `:595-600` reads the type catalog. So an explicit API call CAN add a custom field today.

### What is ABSENT (the synthesis loop)
- **No induction loop writes these catalogs from evidence.** Grep for `induceSchema/AutoSchemaKG/proposeEntityType` → nothing. The only writers are the repository's CRUD methods, driven by explicit human API calls — nothing turns tenant evidence (corpus, uploads, chat) into a *proposed* new `entity_type_definition` row. The brain cannot model something the founder never anticipated (`vision-dynamic-schema.md` §3; gap MEM-06).
- **The built-in catalog is wrong-domain.** `entity_type_definition` seeds 17 **real-estate** built-ins — `LAND_PARCEL`, `BUILDING`, `SUB_UNIT`, `HOTEL`, `PLOT`, `BARELAND` (0306 L203-220) — in a mining product. No mining type backbone (licence/deposit/assay/royalty/shipment/buyer). This is the data-plane twin of gap KI-10.
- **No body-change gate on the data model.** Schema mutation is not routed through the meta-rail; bi-temporal (`knowledge-graph/src/temporal/bi-temporal.ts`) + PROV-O (`provenance/prov-o.ts`) are built but unwired (gap MEM-07), so a type change would overwrite, not invalidate-with-timestamp.

**Verdict: PARTIAL** — ~70% (the storage + RLS + manual-write planes are done); the missing 30% is the induction loop + body-change gating + a mining seed ontology.

---

## 2. PILLAR — Surface synthesis & the surface-GRAPH — **PARTIAL (single-surface PRESENT; graph ABSENT)**

### What is PRESENT (single-surface, fully proposal-gated)
This is the strongest pillar. The full single-surface loop is wired and obeys the UI/Modality Invariant by construction:
- `packages/portal-genui/` synthesizes ONE surface from intent: `engine.ts`, `intent/detector.ts`, `generator/generator.ts`, `patch/apply.ts`, `persistence/drizzle-tab-repo.ts`. Its document type is `PortalTab` (`types.ts:18-25`) — one tab (sections/fields/widgets).
- `packages/genui/` is the A2UI-style typed component catalog (the security boundary; unknown kind → `UnknownKindCard`).
- The **modality-arbiter** (`packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts`) classifies a turn into one of 7 closed modalities (chat|tab|document|media|action|skill|workflow), fail-closed to `chat`, and is **wired** into `services/api-gateway/src/composition/brain-kernel-wiring.ts:1005-1025` behind the `BORJIE_MODALITY_ARBITER` canary; the main-loop lifts to `run_modality` (`main-loop.ts:774`).
- The **proposal-sink** (`services/api-gateway/src/composition/modality-capability/proposal-sink.ts`) implements the invariant precisely: persists an OPEN `tab_proposals_inbox` row with `accepted_at = NULL` so the surface mutates **only on owner accept** (L11-13), `reversible: true` + Open/Undo for `posture:'auto'` (L100-103), **evidence-required** rejection of empty-evidence proposals (L81-92), single-language reason copy (L108-109). No UI mutates without approval — exactly the `MASTER_GAP_REGISTER.md` §314 invariant.

### What is ABSENT (the graph above one surface)
- **No surface-graph node/edge model.** Grep `surface_graph/SurfaceNode/SurfaceEdge/query_surface_graph` → nothing. portal-genui emits a *single* `PortalTab`; there is no persisted typed graph of surfaces with `drill_down`/`hand_off`/`derives_from` edges, no graph synthesiser deriving nodes/edges from `(schema + org-graph + role + intent)` (`vision-generative-surfaces.md` §3.1).
- **No Cambria-style lens layer** — coherence under schema change is regenerate-and-hope; a column rename silently breaks a persisted artifact (`vision-generative-surfaces.md` §3.2, finding 4).
- `dynamic-sections` (adaptive layout) and `tab-need-detector` (intent scorer) are **rule-based**, not the learned VoI intent-graph the vision targets (gap EA-09).
- The body-change commit stage for surfaces is the same **stubbed** port as pillar 1 (see §6): a `tab` modality that "grows capability" routes through `bodyChangePort` (`modality-arbiter.ts:330-359`) which currently always denies.

**Verdict: PARTIAL** — single-surface synthesis is PRESENT and invariant-compliant (frontier parity with C1/A2UI); the surface-**graph** + lens-coherence layer is ABSENT.

---

## 3. PILLAR — Org-graph / digital twin (the org as a live model) — **PARTIAL→ABSENT**

### What is PRESENT (packages, unwired)
- `packages/system-graph/` (`derive.ts`, `query.ts`, `health.ts`, `builder.ts`): the body self-model substrate. The bridge `bodySchemaReaderFromGraph` exists (`central-intelligence/src/kernel/introspection/body-schema-reader.ts:69`) and the kernel has an optional `bodySchemaReader` dep (`kernel.ts:290`).
- `packages/org-graph/` (`projector.ts`, `traverse.ts`): a typed edge projector + traversal port.
- `packages/knowledge-graph/` (`graphrag/`, `temporal/bi-temporal.ts`, `provenance/prov-o.ts`, `ontology/`) and a parallel `packages/graph-rag-router/`.
- `packages/org-scope/`: org-unit hierarchy, scope/visibility, scoped-MD factory — a real org *hierarchy* substrate.

### What is ABSENT / BROKEN (the live model)
- **The body self-model is never derived.** `deriveSystemGraph` (`services/consolidation-worker/src/tasks/system-graph-derivation.ts:276`) is invoked **only in its `.test.ts`** — no cron, no `listChanged` trigger in `consolidation-worker/src/index.ts`. So the live brain reads a static module inventory via `renderSelfAwarenessBlock(deps.bodySchemaReader)` (`kernel.ts:1233,2245`) with `bodySchemaReader` unbound. Gap EA-01 [CONFIRMED].
- **The org-graph projector is property-domain and not run.** `org-graph/src/projector.ts:1-24` projects edges from `lease.activated → leased_to (Unit→Person)`, `unit.assigned_manager`, `invoice.created → invoiced_for` — real-estate vocabulary in a mining product, and the only consumer is a single read-side type import in `executive-brief.composition.ts` (no live projector worker writing `org_graph_edges`).
- **KG ontology is real-estate.** `knowledge-graph/src/ontology/` exports only `real-estate.ts`; no `miningOntology` (gap KI-10). Two parallel graph stacks, no graph-of-record (gap KI-11/KI-graphrag).
- **No digital twin.** There is no causal/agent-based simulation layer, no process-mining pass over `event_outbox`/`audit_events`, no simulate-before-redesign gate (`vision-org-graph-twin.md` §3 steps 3-5; gap RSS-17 at org scale).

**Verdict: PARTIAL→ABSENT** — the graph *packages* exist (PARTIAL), but no live, typed, mining-domain org graph is derived/projected and no twin exists (the model the MD must reason over is ABSENT in runtime).

---

## 4. PILLAR — Skill / capacity routing (task assignment & specialization) — **PARTIAL**

### What is PRESENT
- **Domain specialization (static):** ~27 mining juniors are statically registered in `packages/ai-copilot/src/juniors/executor-registry.ts:16-57` (geology, licence, metallurgy, mine-planner, lab-assay, fx-treasury, compliance, safety, sales-offtake, …) and routed by `lens-router.ts` (invisible persona lenses) + `executor.ts` + `master-brain.ts` (dispatch plan). Each junior is evidence-required + Auditor-gated.
- **Learned-skill routing path:** the modality-arbiter Tier-1 can match a `skill` (only `active && human_reviewed`, `modality-arbiter.ts:208-213`) or `workflow` via pgvector descriptors and lift to `run_skill`/`run_modality` — the head exists for learned capability to land on.
- **Org-scope authority:** `packages/org-scope/src/scope/` (authority-checker, delegation-policy, resolve-user-scope) gives per-user scope for *who may act*.

### What is ABSENT
- **No skill synthesis / capture compile.** The Voyager capture loop has no runtime caller (gap AUT-03/COG-08); `synthesize_tool`/ToolMaker does not exist (gap EA-06). So the "skill" modality can route to a learned skill, but nothing ever *creates* one — the registry is a fixed catalog, not a growing library.
- **No capacity/load-aware assignment.** Routing is by domain match (lens/embedding), not by worker capacity, queue depth, or skill-graph specialization. There is no task-router that balances load or assigns to the best-suited *and available* sub-MD/manager (the org-graph `skill`/`ownership` edges that would feed this are not populated — pillar 3).
- The 3 deep dark agents (`structural-civil-agent`, `machinery-advisory-agent`, `esg-disclosure-agent`) are built but not in the barrel/router/registry (gap DM-01) — present in the working tree (`git status` shows them untracked) but unrouted.

**Verdict: PARTIAL** — domain specialization + a learned-skill routing head are PRESENT; skill *growth* and capacity-aware assignment are ABSENT.

---

## 5. PILLAR — Proactive org-design loop (the org redesigns itself) — **ABSENT**

### What exists (dormant)
- `packages/central-intelligence/src/kernel/orchestrator/self-extension.ts` exports `detectRecurringGap → proposeNewSubMd → compileAndDeploySubMd` (the self-extension keystone).
- Four evolution workers exist as services: `brain-evolution-worker`, `junior-evolution-worker`, `doc-evolution-worker`, `ui-evolution-worker`.

### Why it is ABSENT in runtime
- **`self-extension.ts` has ZERO callers** outside its own index — no worker, no cron invokes `detectRecurringGap`/`proposeNewSubMd`/`runSelfExtension` (grep across `services` → nothing). Gap AUT-02.
- **Workers are not deployed:** `doc-evolution-worker` and `ui-evolution-worker` have **no Dockerfile**; no k8s CronJob references any evolution worker or self-extension (grep `k8s`/`infrastructure` → nothing). Gap AUT-12.
- **No twin-driven redesign.** Because pillar 3's twin is absent, nothing detects a recurring org gap, simulates a redesign, and proposes it through the meta-rail. The proactive org-design loop (`vision-org-graph-twin.md` §3 step 5, B-1/B-2) does not run.

**Verdict: ABSENT** — the code exists in package/service form but is invoked by nothing and deployed nowhere.

---

## 6. The keystone — the body-change meta-rail is wired-but-inert

The single fact that makes pillars 1, 2, 4, 5 all stall at "PARTIAL/ABSENT" rather than "PRESENT":

- The **syscall is built correctly**: `packages/mutation-authority/src/body-change/body-change-syscall.ts` composes meta-rail + controller + rail, fail-closed, additive, meta-rail-binding (the ONE chokepoint, MD_AS_BODY architecture).
- It is **structurally reachable**: the modality-arbiter calls `deps.bodyChangePort.authorizeBodyChange(...)` for any capability-growing modality (`modality-arbiter.ts:332-359`), and `brain-kernel-wiring.ts:1013` passes `bodyChangePort: buildBodyChangePort()`.
- But **the port is a fail-closed stub**: `services/api-gateway/src/composition/orchestrator-bindings.ts:1098-1109` — `buildBodyChangePort()` *always* returns `{ authorized: false, reason: 'body-change syscall not wired at this seam' }`. The real `@borjie/mutation-authority.authorizeBodyChange` is **not bound**. So every skill/tab/workflow/schema growth denies and falls back to `chat`.

This is gap EA-04/AUT-01 in its current, more-advanced form: it is no longer "wired into NO composition root" (it is now reachable from `brain-kernel-wiring`), but the seam terminates in a deny-stub. The closure is small and high-leverage: build `composition/body-change-wiring.ts` binding the real meta-rail + controller + `composeWithRail`, and replace the stub. That one change lets the surface-graph commit, schema proposals, and skill registration actually persist — under approval, reversibly.

---

## 7. BossNyumba parity (reasoned from the shared spine — BN repo not opened)

Per MEMORY + the vision dossiers, BN is the **same brain/capability/wiring/intelligence**; the ONLY difference is the domain layer (real-estate-deep vs mining-deep). The audit's implications for parity:

- **Pillars 1-3 substrate is 100% shared-substrate.** The induction engine, surface-graph synthesiser, lens layer, org-graph/twin engine, bi-temporal+PROV-O fact model, and the `bodyChange` meta-rail are domain-agnostic by construction (they read *whatever* schema/ontology they're pointed at). Built once in Borjie, BN inherits them; only the **seed ontology pack** + deterministic domain engines differ (mining JORC/royalty/assay vs RE RICS/IVS/rent-roll). So the SAME 5 verdicts above apply to BN's spine.
- **Ironic parity advantage today:** Borjie's `entity_type_definition` built-ins, its `org-graph` projector edges, and its KG ontology are ALL still **real-estate** (0306 L203-220; `org-graph/projector.ts`; `knowledge-graph/ontology/real-estate.ts`). That residue is *wrong for Borjie* but is *exactly the seed pack BN needs* — it should be lifted into a shared `realEstateOntology` pack for BN and replaced in Borjie by a `miningOntology` pack (gap KI-10), proving the single-induction-engine / two-ontology-packs thesis.
- **BN is BEHIND on the body layer.** Gap EA-10: BN has actuators but ZERO body-model layer (no system-graph/blackboard/mutation-authority). So even once Borjie binds the meta-rail (the §6 keystone), BN still needs that whole organ ported before any of pillars 1/2/4/5 can self-construct there. The parity action is: build the org-graph-twin + meta-rail to a clean domain-agnostic seam in Borjie, then port the engine + ship a real-estate ontology pack to BN.

---

## 8. Closure map (what turns each PARTIAL/ABSENT into PRESENT)

| Pillar | Verdict | Smallest change to advance | Register IDs |
|---|---|---|---|
| 1 Schema synthesis | PARTIAL | EDC induction loop writing `entity_type_definition`/`tenant_schema_extensions` as proposals + mining seed ontology + route catalog writes through meta-rail | MEM-06, KI-10, EA-04 |
| 2 Surface-graph | PARTIAL | Surface-graph node/edge model + graph synthesiser + Cambria lens layer between portal-genui and mutation-authority | EA-09, (vision-generative-surfaces §3) |
| 3 Org-graph/twin | PARTIAL→ABSENT | Schedule `deriveSystemGraph` as cron+listChanged; re-domain org-graph projector to mining; author `miningOntology`; process-mine `event_outbox`; add twin sim layer | EA-01, KI-10, KI-11, RSS-17 |
| 4 Skill routing | PARTIAL | Wire Voyager capture-loop → compileSkill → human-gate → `skill_registry`; add capacity-aware task router over org-graph skill/ownership edges | AUT-03, EA-06, DM-01 |
| 5 Org-design loop | ABSENT | Bind `self-extension` into a scheduled worker; Dockerfiles+k8s for the 4 evolution workers; twin-proposes-redesign through meta-rail | AUT-02, AUT-12 |
| KEYSTONE | wired-but-inert | Replace `buildBodyChangePort()` deny-stub with real `authorizeBodyChange` binding (`composition/body-change-wiring.ts`) | EA-04 / AUT-01 |
