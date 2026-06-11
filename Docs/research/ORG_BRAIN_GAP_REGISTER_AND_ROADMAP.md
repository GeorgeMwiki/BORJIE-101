# ORG-BRAIN GAP REGISTER & FULL-CODE BUILD ROADMAP

**Document:** `ORG_BRAIN_GAP_REGISTER_AND_ROADMAP.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** synthesis pass over the 8 vision dossiers + `SELF_ORGANIZING_ORG_BRAIN_VISION.md` + `vision-code-audit.md`, with every load-bearing code claim re-verified READ-ONLY against live source (file:line below).
**Audience:** Borjie owner + brain/kernel/spine engineers; BossNyumba parity team.
**Status:** prioritized, file-level gap register + a dependency-ordered, full-code build roadmap. **Nothing here is a permanent spec — every item is a buildable lane** (real wired code, flag-default-safe). The same waves apply to BossNyumba in its repo (same engine, swapped ontology pack).

> **Sibling invariant (load-bearing).** Borjie (mining-estate OS) and BossNyumba (real-estate OS) are the **same brain, same capability layer, same wiring, same intelligence**. The only difference is the **domain layer** — a swappable ontology pack (entity/edge classes + SHACL shapes) + deterministic domain engines. Every organ below is built **once**, domain-agnostic, in Borjie, and inherited by BN by pointing it at the other ontology pack. Wherever a row says "mining," read "or real-estate."

> **Governing contract on every row (the UI/Modality Invariant, `MASTER_GAP_REGISTER.md` §314, restated).** Every construction — schema row, surface, edge, skill, sub-MD, workflow — is a **proposal** through the ONE body-change meta-rail: **reasoned-need-only · approval-gated · chat-refinable · reversible · hash-chain audited**. The offense (self-construction) is safe **only because** of the defense (`inviolable.ts`, policy-gate, RLS+`WITH CHECK`, append-only audit, kill-switch fail-closed). They are one system; money/licence/deletion stay dual-control HITL forever; the agent grows capability but can never touch its own gate/audit/test machinery.

---

## 0. How to read this document

The owner vision decomposes into **6 pillars** (5 capability pillars + 1 cross-cutting meta-rail). Section 1 is the **gap register**: one PRESENT / PARTIAL / ABSENT verdict per pillar-component, each row carrying **file:line evidence** (verified this pass), the **smallest buildable closure lane**, the cross-referenced `MASTER_GAP_REGISTER.md` IDs, and a **BLOCKER?** flag for the wow self-wiring demo. Section 2 is the **roadmap**: 8 dependency-ordered waves, each a coherent set of real wired code shipped flag-default-safe. Section 3 maps every wave to the BN parity action. Section 4 is the demo-blocker critical path.

**Legend** — Verdict: `PRESENT` (built + reached by a live request/cron path) · `PARTIAL` (substrate built, loop/wiring missing) · `ABSENT` (no live code). **BLOCKER** = required for the §4 wow self-wiring demo (the org constructing itself live on the Tuesday narrative in `SELF_ORGANIZING_ORG_BRAIN_VISION.md` §4).

**Verification note.** Every "Evidence" cell was re-checked against the working tree this pass. Where the audit dossier and live code agree it is unmarked; the keystone deny-stub, the 17 real-estate built-ins, the empty induction grep, the single-caller `deriveSystemGraph`, the real-estate org-graph projector edges, the ontology-folder contents, the absent surface-graph/Cambria greps, the solver-less workforce-orchestrator, and the two missing evolution-worker Dockerfiles are all **[VERIFIED 2026-06-08]**.

---

## 1. THE GAP REGISTER (PRESENT / PARTIAL / ABSENT per pillar, with evidence)

### KEYSTONE — Body-change meta-rail (Pillar 6, cross-cutting) — **PARTIAL (wired-but-inert)**

The single fact that holds pillars 1, 2, 4, 5 at PARTIAL/ABSENT. The syscall is built and structurally reachable, but its port is a fail-closed **deny-stub**, so every capability-growth path falls back to `chat`.

| ID | Component | Verdict | Evidence (file:line, [VERIFIED]) | Closure lane (buildable) | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| K-1 | Body-change syscall built | PRESENT | `packages/mutation-authority/src/body-change/body-change-syscall.ts` + `audited-body-change.ts` exist; compose meta-rail + controller + rail, fail-closed, additive | — (already built) | EA-04 | — |
| K-2 | Syscall reachable from arbiter | PRESENT | `modality-arbiter.ts:332` `if (growsCapability && deps.bodyChangePort)` → `:341 authorizeBodyChange(...)`; `brain-kernel-wiring.ts:1013 bodyChangePort: buildBodyChangePort()` | — (already reachable) | EA-04 | — |
| **K-3** | **Port is a deny-stub** | **ABSENT** | `orchestrator-bindings.ts:1098-1104` `buildBodyChangePort()` returns `{ authorized:false, reason:'body-change syscall not wired at this seam (${req.kind})' }` — the real `@borjie/mutation-authority.authorizeBodyChange` is **never bound** | Build `composition/body-change-wiring.ts`: bind real `authorizeBodyChange` (meta-rail + controller + `composeWithRail`); replace the stub in `brain-kernel-wiring.ts:1013`. **The single highest-leverage change** — lets surface/schema/skill/org commits actually persist, under approval, reversibly. | EA-04 / AUT-01 | **YES** |

---

### PILLAR 1 — Schema synthesis (the data-model the org *induces*) — **PARTIAL (~70% substrate, loop ABSENT)**

| ID | Component | Verdict | Evidence (file:line, [VERIFIED]) | Closure lane | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| P1-1 | 4-plane meta-schema storage | PRESENT | `packages/database/src/migrations/0306_create_core_entity_family.sql`: `core_entity` (entity_type text, custom_fields jsonb, GIN jsonb_path_ops, vector(1536), PostGIS, FORCE RLS); `entity_type_definition` type catalog (L186) + check-trigger (L226); `tenant_schema_extensions` field catalog (RLS `tenant_id IS NULL OR = guc`) | — (already built) | — | — |
| P1-2 | Manual field-catalog writer | PRESENT | `packages/database/src/repositories/core-entity.repository.ts` inserts `tenantSchemaExtensions`; reads type catalog | — (already built) | — | — |
| **P1-3** | **EDC induction loop (Extract→Define→Canonicalize)** | **ABSENT** | grep `induceSchema/AutoSchemaKG/proposeEntityType/edc` over `packages/` + `services/` → **0 hits [VERIFIED]**. Only writers are CRUD driven by explicit human API calls | Build an EDC induction pass (AutoSchemaKG/Graphiti pattern): ingest evidence → schema-free extract entity/relation/**event** triples → Define (LLM dedup + vector similarity vs catalog) → Canonicalize (align or propose new) → KARMA-style auditor (evidence-required) → emit a versioned **data contract** as a `bodyChange` proposal | MEM-06 | **YES** |
| **P1-4** | **Built-in catalog is wrong-domain** | **ABSENT** (mining) | `0306` L204-214 seeds `LAND_PARCEL/BUILDING/SUB_UNIT/WAREHOUSE/GODOWN/HOTEL/PLOT/BARELAND/MACHINERY` — **real-estate built-ins in a mining product [VERIFIED]**; no licence/deposit/assay/royalty/shipment/buyer backbone | Author a `miningOntology` seed pack (entity/event types + SHACL shapes); lift the 17 RE built-ins into a `realEstateOntology` pack for BN. Two packs, one induction engine | KI-10 | **YES** |
| P1-5 | Bi-temporal + PROV-O wiring | PARTIAL | `packages/knowledge-graph/src/temporal/bi-temporal.ts` + `provenance/prov-o.ts` **built but unwired [VERIFIED]** — ingest writes neither, so a type change would overwrite | Wire bi-temporal `(t_valid,t_invalid)` + PROV-O onto every catalog write (Graphiti invalidate-with-timestamp, never delete) | MEM-07 | — |
| P1-6 | pgroll promotion lane | ABSENT | no pgroll usage in repo | Add a pgroll-style promotion lane: graduate a hot JSONB type → typed column/table reversibly; free counterfactual schema simulation in a shadow namespace (blast-radius before approve) | (vision-dynamic-schema §2/§4) | — |
| P1-7 | Validator co-evolution (SHACL/JSON-Schema ripple) | ABSENT | no OntoRipple-style ripple | A synthesized type ships **with** its validators; an ontology edit ripples declaratively into SHACL + JSON-Schema + check-triggers | (vision-dynamic-schema §1.5) | — |

---

### PILLAR 2 — Surface-graph synthesis (screens as *projections* of the model) — **PARTIAL (single-surface PRESENT; graph ABSENT)**

| ID | Component | Verdict | Evidence (file:line, [VERIFIED]) | Closure lane | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| P2-1 | Single-surface synthesis, proposal-gated | PRESENT | `packages/portal-genui/` (engine/intent/generator/patch/persistence); `packages/genui/catalog.ts` A2UI-style allowlist (UnknownKindCard fail-closed); `modality-arbiter.ts` 7-modality classify behind `BORJIE_MODALITY_ARBITER`; `proposal-sink.ts` persists OPEN `tab_proposals_inbox` (accepted_at NULL), evidence-required, Open/Undo, single-language — **the §314 invariant by construction** | — (already built, frontier parity with C1/A2UI) | — | — |
| P2-2 | Surface is a single `PortalTab` | PRESENT (limited) | `portal-genui/src/types.ts:18-22` document = ONE tab (sections/fields) — no graph above it | — (the limit, not a bug) | — | — |
| **P2-3** | **Surface-GRAPH node/edge model** | **ABSENT** | grep `surface_graph/SurfaceNode/SurfaceEdge/query_surface_graph` → **0 hits [VERIFIED]** | Persisted typed graph: **nodes = surfaces** `{kind, data_binding, role_lens, layout_spec, provenance}`; **edges = `drill_down/hand_off/derives_from/shares_context`** discovered from FKs + org-graph routing (the entangler idea) | EA-09 | **YES** |
| P2-4 | Graph synthesiser (schema+role+intent → surface) | ABSENT | no projector from `(schema slice + role) → surface spec` | Build the graph synthesiser between `portal-genui` (synthesises nodes) and `mutation-authority` (commits edits); `role_lens` compiled from RLS so a surface can't project a column a role can't read | EA-09 | — |
| **P2-5** | **Cambria-style lens layer (coherence under migration)** | **ABSENT** | grep `cambria/schema-lens` → **0 hits [VERIFIED]**; coherence today is regenerate-and-hope; a column rename silently breaks a persisted artifact | Persisted `layout_spec`s bind to a **read schema**; live DB is the **write schema**; a migration registers a lens (rename/add-default/wrap/hoist) → rebinding on demand; a truly destructive change triggers a proposal with a visual diff | EA-09 / (vision-generative-surfaces §3.2) | — |
| P2-6 | Latent-Navigation stable-promise invariant | PARTIAL | proposal-sink gives reversible + single-language; no "where am I / why / how-out" anchors per surface kind | Stable anchors per surface kind; every adaptive reorder explainable + reversible | (vision-generative-surfaces §3.4) | — |
| P2-7 | Learned VoI intent scorer | PARTIAL | `packages/tab-need-detector/scoring-matrix.ts` + `dynamic-sections` are **rule-based** | Replace rule scorer with learned VoI/expected-utility (UI-JEPA intent embeddings + MARLUI-style RL) | EA-09 | — |

---

### PILLAR 3 — Org knowledge-graph + digital twin (the model the brain reasons over) — **PARTIAL→ABSENT (packages exist, no live model, no twin)**

| ID | Component | Verdict | Evidence (file:line, [VERIFIED]) | Closure lane | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| P3-1 | Graph packages exist | PRESENT (unwired) | `packages/system-graph/` (derive/query/health/builder); `packages/org-graph/` (projector/traverse); `packages/knowledge-graph/` (graphrag/temporal/provenance/ontology); parallel `packages/graph-rag-router/`; `packages/org-scope/` hierarchy | — (substrate present) | — | — |
| **P3-2** | **Body self-model never derived** | **ABSENT** (runtime) | `deriveSystemGraph` invoked **only** in `services/consolidation-worker/src/tasks/system-graph-derivation.ts` + its `.test.ts` — **no cron / no `listChanged` caller in `services/` [VERIFIED]**. Live brain reads a static module inventory; `bodySchemaReader` unbound | Schedule `deriveSystemGraph` as a leader-elected cron + `listChanged` trigger; persist the real 180+-node system-graph; bind `bodySchemaReader`; expose `query_body_schema`/`body_blast_radius` as live brain tools | EA-01 | **YES** |
| **P3-3** | **Org-graph projector is property-domain + not run** | **ABSENT** (mining) | `packages/org-graph/src/projector.ts:7-13` projects `lease.activated → leased_to`, `unit.assigned_manager → managed_by`, `invoice.created → invoiced_for` — **real-estate vocabulary [VERIFIED]**; no live worker writing `org_graph_edges` | Re-domain the projector to mining edges (licence→covers→mineral, deposit→assayed_by, royalty→filed_for); run it as a worker writing `org_graph_edges` | KI-10 / KI-11 | **YES** |
| P3-4 | KG ontology is real-estate; two parallel stacks | ABSENT (mining) | `packages/knowledge-graph/src/ontology/` contains only `index.ts` + `real-estate.ts` — **no `miningOntology` [VERIFIED]**; `knowledge-graph` + `graph-rag-router` are two stacks, no graph-of-record | Resolve to ONE graph of record; author `miningOntology` (shared with P1-4 pack); fuse body-graph + org-graph into one query plane | KI-10 / KI-11 | — |
| P3-5 | Process-mining over event_outbox | ABSENT | no process-mining pass over `event_outbox`/`audit_events` | Mine the org's *actual* flows (BPMN-shaped) with cycle-time / error-rate / four-eye-load metrics; attach as `flow` nodes | RSS-17 (org scale) | — |
| **P3-6** | **Simulatable digital twin** | **ABSENT** | no causal/ABM sim layer; no simulate-before-redesign gate | Causal/agent-based sim over the graph: given a proposed change, run what-if (LLM-ABM + structural causal model) → predicted delta sheet (cycle-time, error-rate, four-eye load, cost) **before** acting. "Org git": branch the twin on replayed history; approve=merge, reject=discard | RSS-17 | **YES** (for the COO proposal in the demo) |

---

### PILLAR 4 — Skill / capacity / task-routing (right node, free-now, fair) — **PARTIAL (specialization + learned head PRESENT; growth + capacity ABSENT)**

| ID | Component | Verdict | Evidence (file:line, [VERIFIED]) | Closure lane | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| P4-1 | Static domain specialization | PRESENT | `packages/ai-copilot/src/juniors/executor-registry.ts` (~47 register/agent refs [VERIFIED]); routed by `lens-router.ts` + `executor.ts` + `master-brain.ts`; evidence-required + Auditor-gated | — (already built) | — | — |
| P4-2 | Learned-skill routing head | PRESENT | `modality-arbiter.ts:208-213` Tier-1 matches a `skill` (only `active && human_reviewed`) or `workflow` via pgvector descriptors → `run_skill`/`run_modality` | — (head exists for learned capability to land on) | — | — |
| **P4-3** | **Skill synthesis / capture-compile** | **ABSENT** | Voyager capture loop has no runtime caller; `synthesize_tool`/ToolMaker does not exist; registry is a fixed catalog | Wire Voyager capture → compileSkill → human-gate → `skill_registry` (through the meta-rail) so the library *grows* | AUT-03 / EA-06 | — |
| **P4-4** | **Capacity/load-aware dispatch (Dispatch Kernel)** | **ABSENT** | `packages/workforce-orchestrator/` has `plan-assignment.ts`, `skill-inferrer.ts`, etc. but grep `Hungarian/CP-SAT/auction/QMIX/fairness/loadBalance` → **0 hits [VERIFIED]**; `planAssignment()` derives risk-tier/cadence only, not the person↔task match | Build one **Dispatch Kernel**: eligibility filter (hard: skills/certs/licence/jurisdiction/kill-switch) → cost/utility score (skill-fit × capacity × proximity × SLA-slack × fairness penalty) → solver tier (Hungarian / CP-SAT / auction / MARL by latency budget) → confidence+handoff → disruption listener (incremental re-solve) → fairness ledger. Reads the org-graph skill/ownership/capacity edges (Pillar 3) | skill-capacity-task-routing lane | **YES** |
| P4-5 | 3 deep dark agents unrouted | ABSENT (routing) | `structural-civil-agent`, `machinery-advisory-agent`, `esg-disclosure-agent` present in working tree (`git status` untracked) but not in barrel/router/registry | Add to barrel + router + registry; evidence-required + Auditor-gated | DM-01 | — |

---

### PILLAR 5 — Proactive org-design loop (the org redesigns *itself*) — **ABSENT (code exists, invoked by nothing, deployed nowhere)**

| ID | Component | Verdict | Evidence (file:line, [VERIFIED]) | Closure lane | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| **P5-1** | **`self-extension` has zero callers** | **ABSENT** (runtime) | `packages/central-intelligence/src/kernel/orchestrator/self-extension.ts` exports `detectRecurringGap → proposeNewSubMd → compileAndDeploySubMd`; grep over `services/` → **no caller; only its own package index + `.test.ts` + `dist/` [VERIFIED]** | Bind `self-extension` into a scheduled worker; twin (P3-6) detects a recurring gap → simulates → proposes through the meta-rail | AUT-02 | **YES** |
| **P5-2** | **Evolution workers not deployed** | **ABSENT** (deploy) | `services/doc-evolution-worker` + `services/ui-evolution-worker` have **NO Dockerfile [VERIFIED]** (brain/junior workers do); no k8s CronJob references any evolution worker or self-extension | Add Dockerfiles + k8s CronJobs (leader-elected single-replica) for all 4 evolution workers + the sleep-pass | AUT-12 | partial (deploy is demo-adjacent) |
| P5-3 | Twin-driven redesign proposal | ABSENT | depends on P3-6 twin | The proactive loop scores *organizational* fitness ("which decisions have no owning organ? which flow has no measurement?"); when reasoned need crosses threshold → reversible `bodyChange` proposal; org-chart redraws | AUT-02 / vision-agent-orgs §3.1 | **YES** |
| P5-4 | Empirical-fitness gate (draft→shadow→canary→live) | PARTIAL | shadow/canary/burn-rate-rollback primitives exist (EA-12/AUT-15) but not chained to the body-change executor | Every self-built organ enters `draft→shadow→canary→live`, kept only if it beats the incumbent on real outcomes (7/28/91-day adoption/completion/error/approver-acceptance), burn-rate/NOI/SLO auto-rollback to archived parent | AUT-15 / EA-12 | — |
| P5-5 | Predictive org-design (pre-build under gate) | ABSENT | no forward-roll of estate capacity | Twin rolls the estate forward ("by Q3 I'll need a metal-accounting junior + a 3rd KYC reviewer") and pre-drafts organs under gate before the bottleneck — ProActor reference-ready window applied to org capacity | AUT-02 / vision-proactive §6 | — |

---

### CROSS-CUTTING — Proactive/ambient spine, durable execution, network effects (the §5/§B amplifiers)

| ID | Component | Verdict | Evidence | Closure lane | Register IDs | BLOCKER? |
|---|---|---|---|---|---|---|
| X-1 | Modality arbiter LOOP variant | PARTIAL | arbiter ships ANSWER/SKILL/WORKFLOW/AGENT; the **LOOP** variant (= ambient agency) is the head everything proactive lands on | Add the LOOP modality + executor | COG-07 / AUT-14 | — |
| X-2 | Ambient sensor plane | ABSENT | `ambient-listener` STT-only; `proactive-triggers-worker` subscribes to no estate event stream | Event subscriber over `event_outbox` + regulator feed (KI-16/17) — the SENSE half of the loop | EA-07 / KI-16/17 | — |
| X-3 | Conformal interruption budget | ABSENT | `conformal-calibration-online` (COG-03) built; not bound to the interruption decision | Bind ProActor PT/FTR to COG-03; surface a proposal only when calibrated VoI > measured per-owner annoyance cost; threshold learned per-owner from accept/dismiss/undo telemetry | COG-03 / EA-09 | — |
| X-4 | Sleep-time precompute / nightly pass | PARTIAL | `sleep-pass-orchestrator` exists; counterfactual rollouts + pre-staged proposals not wired; leader-election needed | Nightly leader-elected cron: sleep-time compute pre-answers likely morning questions; world-model rollouts pre-stage gated proposals | AUT-06 / RSS-06 | — |
| X-5 | Durable execution substrate | ABSENT | no Temporal-class journal-replay for bodyChange/sagas | Stand the operating loop on durable execution so a half-built organ / interrupted saga resumes at step 48; `bodyChange` becomes durable + compensatable | EXEC-saga / vision-agentic-erp L5 | — |
| X-6 | DP cross-tenant benchmark | ABSENT | `dp-federation` + `privacy-router` ship; accountant closed-form only (DP-07); value-layer unbuilt | DP-gated cross-tenant benchmark (percentile insights, no raw-data sharing); finish subsampled-RDP accountant | DP-07 / DP-02 | — |
| X-7 | AP2-mapped autonomous negotiation | ABSENT | marketplace/bids/KYC/offtake juniors exist; no negotiation organ / elasticity engine / mandate layer | Map AP2 Intent→Cart→Payment mandates onto the hash-chained audit + policy-gate; settle via `LedgerService.post`; defend with indirect-injection detector | (vision-proactive §4) | — |
| X-8 | Self-rewriting compliance checks | ABSENT | regulator-feed sensor (KI-16/17) dark | Diff regulation vs corpus → propose an amendment to compliance rules (four-eye) → on approval replay against the estate to surface newly non-compliant positions | KI-16 / KI-17 | — |

---

## 2. THE BUILD ROADMAP — dependency-ordered waves (each = real wired code, flag-default-safe)

Each wave ships behind a default-off env flag, with the wiring tests the UI/Modality Invariant mandates: (a) no UI change without approval, (b) low-need turn proposes nothing, (c) chat refinement re-synthesizes, (d) auto-flow spawns ambiently but reversibly, (e) a routed money/licence action still hits the policy-gate. Waves are ordered so each produces the substrate the next reads.

### WAVE 0 — Bind the keystone meta-rail *(unblocks pillars 1, 2, 4, 5)* — **DEMO BLOCKER**
Replace the `buildBodyChangePort()` deny-stub (`orchestrator-bindings.ts:1098`) with a real `composition/body-change-wiring.ts` binding `@borjie/mutation-authority.authorizeBodyChange` (meta-rail + controller + `composeWithRail`); swap it in at `brain-kernel-wiring.ts:1013`. Flag `BORJIE_BODY_CHANGE_RAIL`. **Closes K-3.** After this, every pillar's commit stage can actually persist — under approval, reversibly. *Smallest change, largest leverage.*

### WAVE 1 — Mining ontology seed + bi-temporal fact model *(the domain fork, built as data)* — **DEMO BLOCKER**
Author the `miningOntology` seed pack (entity/event types + SHACL shapes: licence/deposit/assay/royalty/shipment/buyer/jurisdiction) and lift the 17 real-estate built-ins (`0306` L204-214) into a shared `realEstateOntology` pack for BN. Wire bi-temporal `(t_valid,t_invalid)` + PROV-O onto catalog/graph writes (invalidate-with-timestamp, never delete). Flag `BORJIE_MINING_ONTOLOGY`. **Closes P1-4, P1-5, P3-4 (ontology half).** *This is the physical proof of the single-engine / two-packs thesis.*

### WAVE 2 — Self-deriving body/system-graph + re-domained org-graph projector *(proprioception goes live)* — **DEMO BLOCKER**
Schedule `deriveSystemGraph` as a leader-elected cron + `listChanged` trigger; persist the real 180+-node system-graph; bind `bodySchemaReader`; expose `query_body_schema`/`body_blast_radius` as live brain tools. Re-domain `org-graph/src/projector.ts` from `lease.activated → leased_to` to mining edges and run it as a worker writing `org_graph_edges`. Resolve `knowledge-graph` + `graph-rag-router` into ONE graph of record; fuse body-graph + org-graph into one query plane. Flag `BORJIE_SYSTEM_GRAPH_DERIVE`. **Closes P3-2, P3-3, P3-4 (stacks half), reconciles the static-inventory drift (EA-01).**

### WAVE 3 — EDC schema-induction loop + pgroll promotion lane *(the model authors itself)* — **DEMO BLOCKER**
Build the EDC induction pass (Extract→Define→Canonicalize, AutoSchemaKG/Graphiti): evidence → schema-free triples → LLM dedup vs catalog + vector similarity → align-or-propose → KARMA auditor (evidence-required) → versioned **data contract** as a `bodyChange` proposal (rides Wave 0). Add a pgroll-style promotion lane (graduate a hot JSONB type → typed table reversibly; shadow-namespace blast-radius before approve) and OntoRipple validator co-evolution (SHACL + JSON-Schema + check-trigger ripple). Flag `BORJIE_SCHEMA_INDUCTION`. **Closes P1-3, P1-6, P1-7.** *Demo step 2 (a new licence type proposes itself) lights up here.*

### WAVE 4 — Surface-graph layer + Cambria lenses *(screens propose themselves, stay coherent)* — **DEMO BLOCKER**
Plug a persisted surface-GRAPH (typed nodes/edges, `role_lens` compiled from RLS) and a graph synthesiser between `portal-genui` and `mutation-authority`; discover edges from FKs (Wave 1 ontology) + org-graph routing (Wave 2). Add a Cambria-style lens layer (read-schema vs write-schema; migration registers a lens; destructive change → proposal with visual diff) so a column rename never silently breaks a surface. Enforce the Latent-Navigation stable-promise invariant. Flag `BORJIE_SURFACE_GRAPH`. **Closes P2-3, P2-4, P2-5, P2-6.** *Demo step 3 (a `licence_console` surface proposes itself, chat-refinable) lights up here.*

### WAVE 5 — Digital twin (causal/ABM sim) + process-mining + Dispatch Kernel *(simulate before reorg; route the work)* — **DEMO BLOCKER (twin + kernel)**
Process-mine `event_outbox`/`audit_events` into BPMN-shaped `flow` nodes with cycle-time/error/four-eye metrics. Build the simulatable twin (LLM-ABM + structural causal model + "org git" branch-on-replayed-history → predicted delta sheet + blast-radius). Build the **Dispatch Kernel** (eligibility → cost → solver-tier Hungarian/CP-SAT/auction/MARL → handoff → disruption listener → fairness ledger) over the org-graph skill/ownership/capacity edges; wire the 3 dark agents into the router. Flags `BORJIE_ORG_TWIN`, `BORJIE_DISPATCH_KERNEL`. **Closes P3-5, P3-6, P4-4, P4-5.** *Demo steps 4 (twin predicts a gap, COO proposes an organ) + 5 (work routes free-now/fair) light up here.*

### WAVE 6 — Proactive org-design loop on durable execution + empirical-fitness gate *(the loop closes)* — **DEMO BLOCKER (loop)**
Bind `self-extension` into a scheduled worker driven by the Wave-5 twin (detect recurring gap → simulate → propose through the meta-rail → org-chart redraws). Stand the loop on durable execution so a `bodyChange` is resumable/compensatable. Chain the `draft→shadow→canary→live` empirical-fitness gate with burn-rate/NOI/SLO auto-rollback to the archived parent. Ship Dockerfiles + leader-elected k8s CronJobs for all 4 evolution workers + sleep-pass. Add predictive org-design (pre-build organs under gate). Flags `BORJIE_ORG_DESIGN_LOOP`, `BORJIE_EVOLUTION_WORKERS`. **Closes P5-1, P5-2, P5-3, P5-4, P5-5.** *Demo step 4's "new sub-MD compiled, sandbox-smoke-tested, enters shadow→canary→live" completes here.*

### WAVE 7 — Proactive/ambient amplifiers + network-effect moats *(compounding leaps, shipped last)*
Add the LOOP modality + executor (X-1); ambient sensor plane over `event_outbox` + regulator feed (X-2); conformal interruption budget bound to COG-03 (X-3); sleep-time precompute + counterfactual nightly rollouts (X-4); self-healing business loop (SRE loop over estate economic state); self-rewriting compliance checks (X-8); then the network-effect/revenue moats that compound on everything above — DP cross-tenant benchmark (X-6) and AP2-mapped autonomous negotiation (X-7). Flags per organ, all default-off. **Closes X-1..X-8.** *These make the §4 "08:00 — the estate has already done the thinking" opening real and turn the moat from defensible to compounding.*

---

## 3. BossNyumba parity — same waves, swapped pack

Every wave above lands in the **shared, domain-agnostic** layer. BN inherits the engine by pointing it at the other ontology pack — **no second architecture**.

| Wave | Shared organ (built once in Borjie) | The ONLY BN fork |
|---|---|---|
| 0 | body-change meta-rail binding | nothing — identical |
| 1 | EDC catalogs + bi-temporal/PROV-O fact model | seed pack: `realEstateOntology` (RICS/IVS/rent-roll/WALT) + regulatory schema-guided constraints |
| 2 | `deriveSystemGraph` cron + org-graph-of-record | projector edges: lease/valuation/works-order vocab (BN's *current* RE edges are the seed) |
| 3 | EDC induction loop + pgroll + OntoRipple | the seed ontology it grows from |
| 4 | surface-graph synthesiser + Cambria lens | the data-model it projects |
| 5 | twin (causal/ABM) + process-mining + Dispatch Kernel | eligibility/cost fn (RE field team + viewing/maintenance) + role/dept catalogue |
| 6 | org-design loop + durable exec + empirical-fitness gate | role-ontology pack fed to capability-matching |
| 7 | ambient spine + DP benchmark + AP2 negotiation | RE sensors (lease expiry, arrears, DSCR) + RE cohort benchmarks |

**The ironic parity dividend (today):** Borjie's `0306` built-ins, its `org-graph` projector edges, and its KG ontology are **all still real-estate** — wrong for Borjie, but *exactly the seed pack BN needs*. Wave 1 + Wave 2 physically prove the single-engine / two-packs thesis by lifting that residue into the BN pack and replacing it in Borjie with the mining pack. **BN is behind on the body layer (EA-10: actuators but zero system-graph/blackboard/mutation-authority)** — so the parity action is: build Waves 0–6 to a clean domain-agnostic seam in Borjie, then port the engine + ship the real-estate pack to BN.

---

## 4. The DEMO-BLOCKER critical path (the wow self-wiring story, `SELF_ORGANIZING_ORG_BRAIN_VISION.md` §4)

The "org wires itself on the fly under the operator's thumb" demo requires, in strict dependency order:

```
WAVE 0  (K-3)   bind meta-rail ───────────────► nothing commits without this
   │
WAVE 1  (P1-4/5, P3-4)  mining ontology + bi-temporal ─► the nouns the demo creates exist
   │
WAVE 2  (P3-2/3)  body+org graph derived/projected ───► the model re-derives (demo step 3)
   │
WAVE 3  (P1-3)  EDC induction ────────────────────────► licence type proposes itself (step 2)
   │
WAVE 4  (P2-3/4/5)  surface-graph + lenses ───────────► licence_console proposes itself (step 3)
   │
WAVE 5  (P3-6, P4-4)  twin + Dispatch Kernel ─────────► COO proposes an organ + work routes (4,5)
   │
WAVE 6  (P5-1/3)  org-design loop closes ─────────────► org-chart redraws, sub-MD enters canary (4)
```

**The 11 demo-blocker rows:** `K-3` (keystone) · `P1-3` · `P1-4` · `P2-3` · `P3-2` · `P3-3` · `P3-6` · `P4-4` · `P5-1` · `P5-3` (+ `P1-5` bi-temporal for the "time-travel" close in step 6). Everything in Wave 7 makes the demo *open* better (the 08:00 pre-staged-proposals coffee) but is not required for the core self-wiring proof. The flagship genUI surface the demo lands on is **the living, reasoned, proposal-gated, reversible org-chart itself** — the visible proof that Mr. Mwikila is a self-constructing organizational brain, not a chatbot with tools.

---

## 5. Source ledger

- `Docs/research/SELF_ORGANIZING_ORG_BRAIN_VISION.md` — the coherent-whole north-star (5 pillars + meta-rail + the wow story).
- `Docs/research/vision-code-audit.md` — the READ-ONLY PRESENT/PARTIAL/ABSENT audit this register is verified against.
- `Docs/research/vision-agentic-erp.md` · `vision-dynamic-schema.md` · `vision-generative-surfaces.md` · `vision-agent-orgs.md` · `vision-task-routing.md` · `vision-org-graph-twin.md` · `vision-proactive-frontier.md` — the 8 dossiers.
- `Docs/research/MASTER_GAP_REGISTER.md` — the 132-gap register + the UI/Modality Invariant (§314) that binds every wiring pass; all `Register IDs` above cross-reference it.
- **Live code verified this pass (READ-ONLY, 2026-06-08):** `orchestrator-bindings.ts:1098-1104`, `brain-kernel-wiring.ts:1013`, `modality-arbiter.ts:332/341`, `0306_create_core_entity_family.sql:204-214`, `org-graph/src/projector.ts:7-13`, `knowledge-graph/src/ontology/{index,real-estate}.ts`, `portal-genui/src/types.ts:18-22`, `workforce-orchestrator/src/*`, `services/{doc,ui}-evolution-worker` (no Dockerfile), `system-graph-derivation.ts` (single caller), `self-extension.ts` (no `services/` caller).
