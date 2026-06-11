# MASTER GAP MAP — one consolidated, deduped gap register across ALL pillars

**Document:** `MASTER_GAP_MAP.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** GAP CARTOGRAPHER — single consolidation pass over the 8 code-audit dossiers
(`vision-code-audit`, `kernel-persona-and-code-audit`, `hands-code-audit`, `chat-code-audit`,
`data-foundation-code-audit`, `fabric-code-audit`, `frontier-admin-data-boundary`,
`frontier-unknown-unknowns`) + the 7 stream-synthesis docs
(`SELF_ORGANIZING_ORG_BRAIN_VISION` + `ORG_BRAIN_GAP_REGISTER_AND_ROADMAP`,
`OPERATIONAL_CLOSED_LOOP_FABRIC`, `ORG_BRAIN_FRONTIER_SYNTHESIS`, `MD_COGNITIVE_KERNEL_ARCHITECTURE`,
`THE_HANDS_ACTUATOR_SERVICE_ARCHITECTURE`, `THE_CHAT_SURFACE_ARCHITECTURE`,
`THE_DATA_FOUNDATION_ARCHITECTURE`) + `MASTER_GAP_REGISTER.md` (132 IDs).
**Status:** map only — no code, no commit. One row per gap, deduped across dossiers.

> **THE RECURRING THESIS (every stream says it):** we already HAVE the organs — CoALA with
> zero empty cognitive slots, transport primitives, near-SOTA generative UI, the full
> analytics/causal/anomaly package set, a production money rail, a durable notification rail,
> the saga *schema*, the body-change syscall, the modality arbiter. **What is missing is the
> CONNECTIVE ARCHITECTURE** — the seams between the organs. This is an **AWAKENING (wiring)**,
> not a from-scratch build. The dominant gap class below is **WIRE** (have-the-organ), not
> **BUILD** (build-new).

> **Sibling invariant (load-bearing).** Borjie (mining) and BossNyumba/BN (real-estate) are the
> SAME brain / capability / wiring / intelligence; only the **domain layer** differs (a swappable
> ontology pack + deterministic domain engines). Every substrate gap below is **build-once /
> mirror-twice**. The "BN parity" column states the per-gap delta. The ironic dividend: Borjie's
> *current* real-estate residue (0306 built-ins, org-graph projector edges, KG ontology, KES/rent
> actuators) is **wrong for Borjie but exactly the seed pack BN needs**.

---

## How to read this map

- **Gtype** — gap class: **WIRE** = "we have the organ, just connect the seam" · **BUILD** = "build-new code/organ" · **DOMAIN** = "re-domain property→mining residue (BN inherits the residue as its seed)".
- **Status** — `PRESENT` (built + reached by a live request/cron path) · `PARTIAL` (substrate built, loop/wiring missing) · `ABSENT` (no live code).
- **Sev** — `BLOCKER` (structurally blocks / leaks / lies / blocks a pillar) · `HIGH` · `MED`.
- **DEMO?** — ★ marks a **BLOCKER for the first wow living-outcome demo** (the §4 self-wiring Tuesday in `SELF_ORGANIZING_ORG_BRAIN_VISION.md`, and the colleague-narrates-then-DOES outcome).
- **BN** — `same` (identical shared-spine gap) · `inherits` (BN gets the fix for free) · `BN-fit` (the wired residue is actually BN's domain) · `BN-behind` (BN lacks the organ entirely).

The KEYSTONE row (`K-0`) is listed first because it gates four of the eight pillars.

---

## 0. Header — totals, the one keystone, the demo critical path

**Consolidated gap rows: 96** (after de-duplicating cross-dossier overlaps; each maps to one-or-more `MASTER_GAP_REGISTER` IDs).

| Sev | Count |
|---|---|
| BLOCKER | 27 |
| HIGH | 41 |
| MED | 28 |

**Gap-class split (proves the thesis):** WIRE ≈ 58 · BUILD ≈ 27 · DOMAIN ≈ 11. **~60% of all gaps are "have-the-organ-just-wire-it."**

**THE ONE KEYSTONE — `K-0` (body-change meta-rail deny-stub).** `buildBodyChangePort()`
(`orchestrator-bindings.ts:1098-1104`) always returns `{authorized:false}`, so every
capability-growth path (schema/surface/skill/workflow/sub-MD/tool) falls back to `chat`. The
syscall is built and *reachable* from the arbiter — the seam terminates in a deny-stub. Binding
the real `@borjie/mutation-authority.authorizeBodyChange` (one new `composition/body-change-wiring.ts`)
is the **single highest-leverage change in the entire program** — it un-stalls Mind/Construction/
Lenses/Hands self-extension simultaneously.

**THE ONE INVARIANT (never violated by any lane):** the offense moat (self-improvement,
self-writing memory, self-construction, AUTO) is safe ONLY because of the defense moat — they are
ONE system. Money / licence / deletion stay dual-control HITL forever; the agent can grow
capability but can **never** touch its own gate/audit/test machinery, and — critically — **can
never optimize the classifier that ROUTES to the gate downward** (`inviolable.ts:482`; UU-14).

**Demo critical path (strict dependency order — the 12 ★ rows):**
```
K-0  meta-rail bind ──► nothing commits without this
 ├─ MIND-1 honesty unblock (confidence=1 stamp) ──► colleague can't lie or it isn't a colleague
 ├─ CON-1 mining ontology pack + bi-temporal ──► the nouns the demo creates exist
 ├─ LENS-3 / MIND-2 system-graph derived + org-graph re-domained ──► the model re-derives
 ├─ CON-2 EDC induction loop ──► licence type proposes itself (demo step 2)
 ├─ LENS-1 surface-graph + Cambria lens ──► licence_console proposes itself (step 3)
 ├─ MIND-3 deep-think default + ORIENT situation-schema ──► veteran thinks before it speaks
 ├─ CON-3 digital twin + CON-4 Dispatch Kernel ──► COO proposes an organ, work routes (4,5)
 ├─ CON-5 self-extension cron + empirical-fitness gate ──► org-chart redraws, sub-MD→canary (4)
 ├─ HANDS-1 saga runner + HANDS-2 TZ money-out ──► the MD actually DOES the royalty filing (INV-F)
 └─ FACE-1 visible-work SSE + FACE-2 inline approve/handoff ──► the operator watches + approves it
```

---

## 1. PILLAR — MIND (the resident veteran cognitive kernel; INV-D think AND act)

> Source: `kernel-persona-and-code-audit`, `MD_COGNITIVE_KERNEL_ARCHITECTURE`. Headline: a real
> continuous wake-loop exists (15-min, cluster-locked, real detectors, executes to action) but it
> is a **shallow ~3-trigger reflex arc**; the DEEP brain (deliberate search, situation-orientation,
> honest confidence, learning, self-creation) is built mostly as request-path code that is
> flag-gated / default-off / orphaned / unscheduled. **No resident `EstateMind.tick()` Slow-Loop**,
> no persistent Current Situational Model, no Motivational-Subsystem standing-drives.

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| MIND-1 | WIRE | PARTIAL | **Overconfidence by construction** — brain hard-stamps `confidence=1`/gates=pass on EVERY orchestrator answer; persona cannot honestly hedge | `kernel.ts:3602-3614/3708-3723 translateOrchestratorResponse`; conformal/uncertainty exist but off-path (RSS-22/COG-03) | BLOCKER | ★ | same |
| MIND-2 | WIRE | ABSENT | **No resident EstateMind Slow-Loop / Current Situational Model** — world-model is forecast-on-demand, ORIENT step absent; cognition lives in request `think()` not a standing per-tenant durable mind | `grep EstateMind/SituationalModel/residentMind = 0`; world-model per-call (`state-vectors.ts`); no `awareness/` dir | BLOCKER | ★ | same |
| MIND-3 | WIRE | PARTIAL | **Default turn bypasses the disciplined kernel** — single-shot router answer; `kernel.think()` flag-gated; LATS/ToT/debate/world-model never run a real consequential turn | `chat-orchestrator.ts:207-230`; `main-loop.ts` zero search refs; `brain-kernel-wiring.ts:420-428` arbiter DEFAULT-OFF (COG-01/02/06) | BLOCKER | ★ | same |
| MIND-4 | BUILD | ABSENT | **ORIENT missing** — no situation-type recognizer / expert-schema-playbook classifier; "what kind of situation is this, what does a veteran do?" never asked | no `awareness/` dir; `supervisor/types.ts` zero consumers; lens classifier picks voice not schema (COG-15) | HIGH | ★ | same |
| MIND-5 | WIRE | ABSENT | **LEARN+REPEAT dead on the live loop** — no replay→eval→update; metacognition (recursive-HOT/defection/abductive/autobiography) orphaned from kernel | `main-loop.ts` grep: no reflexion/replay/learning-loop; `metacognition/*` unconsumed (COG-04/AUT-06) | HIGH | — | same |
| MIND-6 | WIRE | PARTIAL | **No forced simulate-before-act pre-commit** — world-model/critics exist but no `preCommit` lookahead gate before an AUTO action touches reality | world-model + PRM + constitutional-critic built; no `preCommit` in orchestrator (RSS-17) | BLOCKER | — | same |
| MIND-7 | WIRE | PARTIAL | **Autonomy-cap kernel hook unwired** + confidence/reversibility-blind; `maxMutationsPerDay`/irreversibility-budget never enforced | `autonomy-governance/index.ts:17`; `cap-evaluator.ts:78` cost/mutation only; gateway grep=0 (AUT-05/RSS-18) | HIGH | — | same |
| MIND-8 | WIRE | PARTIAL | **Safety probes (defection/alignment-faking/SAE) nightly-only**, not inline/fail-closed on AUTO actions | probes exist; `kernel/orchestrator` grep=0 (RSS-20) | HIGH | — | same |
| MIND-9 | WIRE | PARTIAL | **Real confidence scorer not in loop** — heuristic `min()` of regex; conformal ACI calibrator has ZERO live consumers | `confidence.ts:29-93`; `conformal-confidence-gate.ts:10-14` (COG-03) | HIGH | — | same |
| MIND-10 | WIRE | PARTIAL | **EXECUTE-to-CLOSURE not guaranteed** — executor bails on first failure; no plan-repair/replanner; business-loop closure (royalty actually paid) not confirmed/reopened | `executor.ts` header; `main-loop.ts:632-637` retries only; outcome-reconciliation-worker not joined to wake-loop (COG-13) | HIGH | — | same |
| MIND-11 | WIRE | PARTIAL | **No earned/graduated autonomy** (N-clean-runs→suggest-AUTO, tripwire auto-demote); posture set manually | grep cleanRun/tripwire/earnedAuto=0 (AUT-04) | MED | — | same |
| MIND-12 | BUILD | ABSENT | **No standing-drives / Motivational Subsystem** — nothing surfaces loops/needs/opportunities unprompted on a schedule; proactive SIGNAL cadence wired IDLE (no source) | `proactive-wiring.ts:290-348` signal cadence no `orchestrator`/`signalSource` (EA-07) | HIGH | — | same |
| MIND-13 | WIRE | PARTIAL | **Internal debate dark on production brain** (only in executive-brief one-shot); modality arbiter LOOP/AGENT variants unreachable on a normal turn | `runDebate`/`deps.debate` exist, wiring grep=0 on sovereign (COG-06/COG-07) | MED | — | same |
| MIND-14 | WIRE | PARTIAL | **No unified colleague INBOX over notify/question/review** — proactive_nudge/tab_proposals_inbox exist but delivery is a tab-suggester drain, not "MD did X / asks Y / needs sign-off Z" | `proactive-wiring.ts:36-39`; inbox UX absent | MED | — | inherits |

---

## 2. PILLAR — CONSTRUCTION (self-construction: schema · surface-graph · twin · self-extension)

> Source: `vision-code-audit`, `ORG_BRAIN_GAP_REGISTER_AND_ROADMAP`, `SELF_ORGANIZING_ORG_BRAIN_VISION`.
> Headline: the 4-plane meta-schema, single-surface synthesis, and graph PACKAGES are built to
> frontier quality — but the self-constructing LOOP is not closed for any pillar; every one is
> gated on the K-0 deny-stub plus a missing induction/derivation/sim pass. Keystones: the single
> `bodyChange` syscall + construction-as-reversible-data-patch + empirical-fitness gating.

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| **K-0** | WIRE | ABSENT | **KEYSTONE — body-change port is a fail-closed deny-stub**; real `authorizeBodyChange` never bound → every capability-growth path falls back to `chat` | `orchestrator-bindings.ts:1098-1104`; arbiter reaches it `modality-arbiter.ts:332/341`; `brain-kernel-wiring.ts:1013` (EA-04/AUT-01) | BLOCKER | ★ | inherits |
| CON-1 | DOMAIN | ABSENT | **Built-in entity catalog is wrong-domain** — 0306 seeds 17 real-estate types (LAND_PARCEL/BUILDING/HOTEL/PLOT…) in a mining product; no licence/deposit/assay/royalty/shipment/buyer backbone; no `miningOntology` | `0306_create_core_entity_family.sql:204-214`; `knowledge-graph/src/ontology/` only `real-estate.ts` (KI-10) | BLOCKER | ★ | BN-fit |
| CON-2 | BUILD | ABSENT | **No EDC schema-induction loop** (Extract→Define→Canonicalize) — nothing turns evidence into a proposed `entity_type_definition`/field; only human-CRUD writers | `grep induceSchema/AutoSchemaKG/proposeEntityType = 0`; repo CRUD only (MEM-06) | BLOCKER | ★ | inherits |
| CON-3 | BUILD | ABSENT | **No simulatable digital twin** — no causal/ABM sim, no process-mining over `event_outbox`, no "org git" branch-on-history, no simulate-before-redesign gate | no sim layer; no process-mining pass (RSS-17 at org scale) | BLOCKER | ★ | inherits |
| CON-4 | BUILD | ABSENT | **No Dispatch Kernel** (capacity/load-aware task routing) — `workforce-orchestrator` derives risk-tier/cadence only; no Hungarian/CP-SAT/auction/MARL person↔task match, no fairness ledger | `workforce-orchestrator/*` grep `Hungarian/CP-SAT/auction/QMIX/fairness=0` (skill-capacity-routing lane) | BLOCKER | ★ | inherits |
| CON-5 | WIRE | ABSENT | **Proactive org-design loop ABSENT** — `self-extension.ts` (detectRecurringGap→proposeNewSubMd→compile) has ZERO callers; twin-driven redesign never runs | `self-extension.ts:1-33` no `services/` caller (AUT-02) | BLOCKER | ★ | same |
| CON-6 | BUILD | ABSENT | **No surface-GRAPH node/edge model** — portal-genui emits a single `PortalTab`; no typed graph of surfaces with drill_down/hand_off/derives_from edges, no graph synthesiser | `grep surface_graph/SurfaceNode/SurfaceEdge=0`; `portal-genui/types.ts:18-22` (EA-09) | BLOCKER | ★ | inherits |
| CON-7 | BUILD | ABSENT | **No Cambria-style lens layer** — coherence under schema change is regenerate-and-hope; a column rename silently breaks every persisted artifact | `grep cambria/schema-lens=0` (vision-generative-surfaces §3.2) | HIGH | ★ | inherits |
| CON-8 | WIRE | PARTIAL | **Bi-temporal + PROV-O built but unwired** — ingest/catalog writes overwrite instead of invalidate-with-timestamp (kills append-only + time-travel) | `knowledge-graph/temporal/bi-temporal.ts` + `provenance/prov-o.ts` exist, no caller (MEM-07) | HIGH | ★ | inherits |
| CON-9 | WIRE | ABSENT | **Body self-model never derived** — `deriveSystemGraph` invoked only in `.test.ts`; live brain reads static 27-module inventory not the 180+-node graph; `bodySchemaReader` unbound | `system-graph-derivation.ts:276` single caller; `brain-kernel-wiring.ts` no bodySchemaReader (EA-01) | BLOCKER | ★ | BN-behind |
| CON-10 | DOMAIN | ABSENT | **Org-graph projector is property-domain + not run** — projects lease/unit/invoice edges; no live worker writes `org_graph_edges` | `org-graph/src/projector.ts:7-13` (KI-10/KI-11) | BLOCKER | ★ | BN-fit |
| CON-11 | WIRE | ABSENT | **Evolution workers not deployed** — doc/ui-evolution-worker have NO Dockerfile; no k8s CronJob references any evolution worker or self-extension or sleep-pass | `services/{doc,ui}-evolution-worker` no Dockerfile (AUT-12) | HIGH | — | same |
| CON-12 | WIRE | PARTIAL | **Empirical-fitness gate not chained** — shadow→canary→burn-rate-rollback + DGM fitness substrate exists but body-change executor promotes nothing through it | `ui-evolution-worker` promotes nothing through syscall (EA-12/AUT-15) | HIGH | — | inherits |
| CON-13 | WIRE | ABSENT | **Runtime tool synthesis (synthesize_tool/ToolMaker) does not exist** — power-tools has no `synthesize-tool.ts`; `voyager-library` 0 src files | `power-tools/` no synth file (EA-06) | HIGH | — | inherits |
| CON-14 | WIRE | ABSENT | **Voyager skill capture-compile has no caller** — experience→skill never compiles; registry is a fixed catalog, not a growing library | `capture-loop.ts:109` self-ref only; `compileSkill` no caller (AUT-03/COG-08) | HIGH | — | inherits |
| CON-15 | BUILD | ABSENT | **No pgroll promotion lane** — cannot graduate a hot JSONB type → typed column/table reversibly; no shadow-namespace blast-radius sim | `grep pgroll/dynamicDDL/alterTableAdd=0` (vision-dynamic-schema §2/4) | MED | — | inherits |
| CON-16 | BUILD | ABSENT | **No validator co-evolution** — a synthesized type doesn't ship with SHACL+JSON-Schema+check-trigger ripple | no OntoRipple (vision-dynamic-schema §1.5) | MED | — | inherits |
| CON-17 | WIRE | PARTIAL | **KG ingest heuristic substring `mentions`** — no LLM entity/relation extraction (AutoSchemaKG) at ingest | `ingest.ts:476-495`; `grower.ts:13` "heuristic-only" (MEM-06) | MED | — | inherits |
| CON-18 | WIRE | ABSENT | **No twin-driven predictive org-design** — no forward-roll of estate capacity to pre-draft organs under gate before the bottleneck | depends on CON-3 twin (AUT-02/vision-proactive §6) | MED | — | inherits |
| CON-19 | WIRE | PARTIAL | **No ADAS Meta-MD / DGM open-ended archive** — self-extension composes a persona-spec, not code; promotion is greedy single-best, no lineage/Pareto archive | no code-space junior rep / archive (AUT-09/AUT-10) | MED | — | inherits |

---

## 3. PILLAR — FABRIC (the operational closed-loop nervous system; INV-J no-drop)

> Source: `fabric-code-audit`, `OPERATIONAL_CLOSED_LOOP_FABRIC`. Headline: organs strong (durable
> outbox, dispatch log, atomic SKIP-LOCKED, backoff+DLQ, real channel providers, cluster
> leader-election, hash-chain), spine present — **the gaps are at the JOINTS** of
> detect→schedule→ladder→route→act→escalate→close→audit→learn, not the organs.

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| FAB-1 | WIRE | ABSENT | **Confirm-delivery closure is OPEN** — `onDeliveryStatus` publishes to bus but NEVER UPDATEs `notification_dispatch_log.delivery_status`; the loop knows "sent" not "delivered/read" | `index.ts:2164-2180` (publish only); no `SET delivery_status` subscriber | HIGH | — | same |
| FAB-2 | BUILD | ABSENT | **No durable reminder LADDER primitive** — cert/licence ladders hard-coded in bespoke crons into different sinks; royalty/invoice/equipment/safety/shift/KYC have no ladder | `ica-cert-expiry-cron.ts:32 [30,14,3]`; `licence-renewal-watcher.ts:10 [90..1]` (cockpit-only) | HIGH | — | same |
| FAB-3 | WIRE | PARTIAL | **Two parallel reminder rails** (`reminders` vs `notification_dispatch_log`) don't share a recipient model or idempotency | separate tables/workers (fabric §3) | MED | — | same |
| FAB-4 | BUILD | ABSENT | **Escalate-on-inaction is policy-less** — nothing watches "ladder exhausted, no response → escalate the `mining_escalations` chain"; stall detector scans goals not reminders | `mining-escalations.schema.ts:34` exists; no reader (fabric §7) | HIGH | — | same |
| FAB-5 | WIRE | PARTIAL | **`preferredChannel` honored for address, not channel SELECTION**; no cross-channel fallback ladder (push→SMS→WhatsApp→call) | `reminders-dispatch.worker.ts:413`; announcement-fanout ignores prefs | MED | — | same |
| FAB-6 | WIRE | PARTIAL | **ACT lanes not triggered by the reminder fabric** — a fired cert/licence reminder notifies but doesn't auto-draft-and-assign a remediation task | `executive-brief-action-runner.ts` + dispatch-router exist, not joined to crons | MED | — | same |
| FAB-7 | BUILD | ABSENT | **LEARN/self-tune the ladder per recipient ABSENT** — no organ adapts cadence/channel/quiet-hours from response/read latency | `grep selfTune/tuneLadder/adaptCadence=0` (fabric §11) | MED | — | same |
| FAB-8 | BUILD | PARTIAL | **DETECT is hand-coded per event-class** — no uniform "consequential event" registry; royalty/invoice/equipment/safety/shift/KYC have no detector | `grep` no generic detector (fabric §1) | MED | — | same |
| FAB-9 | WIRE | PARTIAL | **Default-OFF cron leader election** (`CRON_LEADER_ELECTION` default off) → every replica fires until flipped (50× cost/dup) | `cluster-lock.ts`; `index.ts:680` (RSS-06) | BLOCKER | — | same |

---

## 4. PILLAR — LENSES (surfaces are semantic LENSES over the org-graph; INV-B)

> Source: `ORG_BRAIN_FRONTIER_SYNTHESIS` (unified-surfaces fold), `vision-code-audit`. Headline:
> we hold the rare half (`core_entity` polymorphic org-graph row-store = KG-OLAP substrate;
> portal-genui = intent→view) — the delta is the **lens definition + roll-up/drill-down operators +
> self-re-categorization + plane-typing + warm expansion**. (LENS-1/2/3 overlap CON-6..10 by
> design — folded here as the lens-engine view; rows kept distinct where the closure differs.)

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| LENS-1 | BUILD | ABSENT | **No `LensDefinition` + KG-OLAP roll-up/drill-down operator kernel** over `core_entity` — surfaces are static one-tabs, not auto-expanding/contracting semantic lenses (5 ops→10 ops→sub-views) | `grep LensDefinition/rollup operators=0`; portal-genui single PortalTab (GAP-LENS-1..3) | BLOCKER | ★ | inherits |
| LENS-2 | BUILD | ABSENT | **No metric==lens fusion + `Σ operation-cells ≡ estate-cell` reconciliation gate** — analytics semantic layer not the mandatory analysis path, not fused with the surface engine | `analytics/src/semantic/` exists but not fused (GAP-LENS, INV-I) | HIGH | — | inherits |
| LENS-3 | WIRE | ABSENT | **No self-re-categorizer** — categorization is static, not re-derived as the org grows; no auto-contract of a lens to the org's shape | static categorization (GAP-LENS-3) | HIGH | ★ | inherits |
| LENS-4 | BUILD | ABSENT | **No plane-typed lens** (`control`|`data`) — INV-A enforced by review not by a typed guarantee; a control-plane lens can touch a tenant business table | no plane type in lens def (frontier-unified §3.6) | HIGH | — | inherits |
| LENS-5 | BUILD | ABSENT | **No headless multi-consumer guarantee + context-graph back-link** — a lens can't serve report/deck/export/mobile from one definition; no read-write decision-trace back-link | (GAP-LENS-6/7) | MED | — | inherits |
| LENS-6 | WIRE | PARTIAL | **Learned VoI intent scorer absent** — `tab-need-detector`/`dynamic-sections` rule-based, not learned expected-utility/cognitive-cost | `scoring-matrix.ts` rule-based (EA-09) | MED | — | inherits |
| LENS-7 | BUILD | ABSENT | **No predictive warm-expansion** — lenses don't pre-stage the likely-next drill-down | (GAP-LENS-8) | MED | — | inherits |

---

## 5. PILLAR — ADMIN/OWNER FIREWALL (INV-A control-plane vs data-plane wall)

> Source: `frontier-admin-data-boundary`. Headline: the CORRECT SOTA aggregate-query lens (`/ask` +
> DP-budget) is already built — but **four leaks cross the wall** and **the break-glass spine the
> invariant mandates does not exist anywhere in the repo.**

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| FIRE-1 | BUILD | ABSENT | **No break-glass spine** — `operator_access_grants` (justification-coded, deny-by-default, time-boxed, single-tenant) absent; impersonation route 404s; INV-A mandates it | `grep break-glass/jit/operator-access=0`; `TenantImpersonateTab` disabled (V5, systemic) | BLOCKER | — | same |
| FIRE-2 | WIRE | PARTIAL | **`/decision-trace` uses `SUPABASE_SERVICE_ROLE_KEY` to RLS-bypass + read tenant decision content** for any `?tenant=`, no break-glass gate; service-role key in a public Next.js app | `decision-trace/page.tsx:73-100` (V2) | BLOCKER | — | same |
| FIRE-3 | DOMAIN | PARTIAL | **`/warehouse` renders tenant ore-stockpile business data** (tonnage/grade/custody/custodian IDs) in the internal console | `StaffNav.tsx:77`; `WarehouseClient.tsx`; `warehouse.router.ts:112` authMiddleware-only (V1) | HIGH | — | BN-fit |
| FIRE-4 | WIRE | PARTIAL | **`support-tickets`/`daily-brief-overview` cross from metadata into tenant business CONTENT** (free-text escalation/alert bodies) via RLS-bypass | `internal/support-tickets.hono.ts`; `daily-brief-overview.hono.ts` (V3) | MED | — | same |
| FIRE-5 | WIRE | PARTIAL | **`/data-privacy` RTBF executes tenant-PII deletion from internal console** without tenant-visible consent framing / break-glass audit | `DataPrivacyClient.tsx` (V4) | MED | — | same |
| FIRE-6 | BUILD | ABSENT | **No per-tenant BYOK/CMK + attested-enclave firewall** (rungs 4-5) — operator reads plaintext not ciphertext; INV-A is policy not cryptography | `selectEncryptionPort` seam exists, not per-tenant-keyed (§4) | MED | — | inherits |

---

## 6. PILLAR — HANDS (actual-work service via reversibility-typed actuators; INV-F)

> Source: `hands-code-audit`, `THE_HANDS_ACTUATOR_SERVICE_ARCHITECTURE`. Headline: primitives strong
> (production M-Pesa B2C ledger-before-transfer + `NEEDS_REVERSAL`; durable notification rail;
> complete saga *schema*) — **the generic multi-step action-execution fabric is ABSENT at runtime**
> (saga schema has NO runner), wired tools are property-bound, TZ e-gov + e-sign are built-or-ported
> but UNWIRED. Keystones: reversibility-typed Actuator PORT + portal-driver for no-API rails.

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| HANDS-1 | BUILD | ABSENT | **No saga RUNNER** — `action_plans/action_steps` (DRAFT→…→COMPENSATED, COMPENSATE/FILE_GEPG/SEND_* kinds) is a complete schema with ZERO executor; no closed-loop multi-step arm exists | `action-runtime.schema.ts` 0225-0228; grep non-schema/test refs=0 (E1, EXEC-saga/RSS-01) | BLOCKER | ★ | same |
| HANDS-2 | BUILD | PARTIAL | **TZ money-out actuators not wired for launch** — M-Pesa is KES not TZS; no Tigo Pesa / Airtel Money; mock default disburses nothing | `mpesa-provider.ts:100` KES; no TZ providers (A1) | BLOCKER | ★ | BN-fit |
| HANDS-3 | DOMAIN | PARTIAL | **Wired action tools bound to property nouns** — leases/units/arrears/rent.reminder/listing(rent); only `royalty.send-reminder` maps to mining | `agency/action-tools/real-adapters.ts`; `agency-port-bindings.ts` (E3) | HIGH | — | BN-fit |
| HANDS-4 | WIRE | PARTIAL | **GePG real but unwired** — `gepg-real.ts` (control numbers) exported, no gateway importer / `FILE_GEPG` step handler | `connectors/adapters/gepg-real.ts`; `index.ts:150` barrel-only (D1) | HIGH | — | inherits |
| HANDS-5 | WIRE | PARTIAL | **E-signature unwired + duplicated** — real DocuSign/Dropbox-Sign/Adobe adapters in two parallel stacks; ZERO gateway call site; request never issued | `document-ai/e-signature/*` + `document-studio/esign/*`; grep gateway=0 (C) | HIGH | — | same |
| HANDS-6 | BUILD | ABSENT | **TZ-mining e-gov actuators ABSENT** — no TRA VFD/filing, no Tume-ya-Madini/IDRAS royalty+licence submission, no BRELA/NEMC adapter (KRA wired is Kenya-rental) | only `tra-filing-assistant` prompt scaffold; `kra-erits` wired but wrong-domain (D2) | HIGH | — | BN-fit |
| HANDS-7 | BUILD | ABSENT | **No uniform reversibility-typed Actuator PORT** — no `packages/actuators` declaring reversibility/dryRun/preview/confirm/compensate above the adapters; arbiter has no ACTUATE verb | no `packages/actuators` (THE_HANDS §1.2) | HIGH | — | inherits |
| HANDS-8 | WIRE | PARTIAL | **Durable execution mock-default** — Temporal returns `createMockTemporalClient` by default; Inngest opt-in, no worker deployed → no path runs durably in prod | `temporal-dispatcher-wiring.ts:120`; `inngest-executor.ts:23` (E5/RSS-23) | HIGH | — | same |
| HANDS-9 | WIRE | PARTIAL | **Four-eye approval router in-memory** — pending dual-control approvals lost on restart (SOC2 CC7.2) | `workflow-engine-wiring.ts:223 createInMemoryApprovalRouter` (RSS-21) | HIGH | — | same |
| HANDS-10 | BUILD | ABSENT | **Native WhatsApp Cloud send ABSENT** — connectors/whatsapp is receive-only; outbound only via Twilio BSP; no portal-driver actuator wrapper for no-API rails | `connectors/whatsapp/` no `sendMessage` (B2); no portal-driver actuator (THE_HANDS §1.4) | MED | — | inherits |
| HANDS-11 | BUILD | ABSENT | **No portable Trust Receipt / completion certificate** — no per-act `{intent, authority-grant, evidence, approver, actuator response, reversal handle}` bound into one audit entry | hash-chain present; Trust Receipt GAP-HANDS-4 | MED | — | inherits |

---

## 7. PILLAR — FACE (chat-first but NOT simple — SOTA conversational workspace; INV-H)

> Source: `chat-code-audit`, `THE_CHAT_SURFACE_ARCHITECTURE`. Headline: the MAIN workspace
> (`HomeChatTeach`+OwnerOS) is well past a text box — strong on inline genUI, surface-spawn, voice
> client. Gap concentrated in **visible-work trace, inline vision, inline take-the-wheel/approval,
> surfaced memory, and the bidirectional shared-state "two views of one state" frontier gap.**

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| FACE-1 | WIRE | PARTIAL | **No live reasoning/tool-execution trace in the primary surface** — only badges+citations; SSE emits no `tool_call`/`reasoning`/`plan`; real tool log wired only into legacy `HomeChat` | `brain-teach.hono.ts:31-37` no tool_call event; `ToolCallSidebar` only in `HomeChat.tsx:248-253` | BLOCKER | ★ | same |
| FACE-2 | WIRE | PARTIAL | **Inline take-the-wheel/approval split out of chat** — prepare→ask→handoff + approval inbox live on separate pages (`/mwikila/inbox`,`/delegation`); not inline | `HandoffCard.tsx` exists; delegation on separate pages | HIGH | ★ | inherits |
| FACE-3 | BUILD | ABSENT | **No bidirectional shared state** ("two views of one state") — discrete `onAction` + separate REST commit, no `STATE_SNAPSHOT`/`STATE_DELTA` channel; widget can't `callTool`/`updateContext` | no AG-UI state channel (THE_CHAT Layer 3, "biggest gap") | HIGH | — | inherits |
| FACE-4 | BUILD | ABSENT | **Inline vision/multimodal ABSENT** — only doc intake; no inline image/camera turn (photo of a licence/pit reasoned over inline) | `OwnerOSChatPanel.tsx:123-167` doc-only | HIGH | — | inherits |
| FACE-5 | WIRE | PARTIAL | **Memory under-surfaced + lost on reload** — `HomeChatTeach` client-local state, no thread hydration; brain memory real but not shown ("what I remember about you") | `HomeChatTeach.tsx:418-420` no hydration | MED | — | inherits |
| FACE-6 | WIRE | PARTIAL | **Hero CTA points at the LEANER surface** — dashboard "Ask Borjie" → `/ask` (leaner `AskBorjieSurface`), not the rich `HomeChatTeach`; chat is a section not full-bleed home | `dashboard/page.tsx:62`; `/ask` mounts leaner surface | MED | ★ | inherits |
| FACE-7 | WIRE | PARTIAL | **Spawn-primitive duplication** — owner-web rolled its own banner/proposal tray; shared `chat-ui` `NeedSpawnBanner`/`ChatArtifactStream` exist but have ZERO app consumers | `chat-ui/*` unused by apps | MED | — | same |
| FACE-8 | WIRE | PARTIAL | **Mobile chat a tier simpler** — workforce/buyer mobile are the largest parity delta vs owner-web rich surface | `apps/*/src/chat/HomeChat.tsx` | MED | — | inherits |

---

## 8. PILLAR — DATA-FOUNDATION (PhD analytics+viz INV-I · lossless capture/recall INV-J)

> Source: `data-foundation-code-audit`, `THE_DATA_FOUNDATION_ARCHITECTURE`. Headline: the analytical
> LIBRARIES are far richer than the gap-register premise assumed (full descriptive/causal/anomaly/
> recommendations + Vega-Lite-v6). **The gap is WIRING + AUTOMATION, not capability**; and the
> "capture everything durably" half of INV-J is honoured **only for the money path.**

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| DATA-1 | WIRE | ABSENT | **`emitDomainEvent()` seam ABSENT — capture is money-only** — no licence/assay/KYC/bid/tonnage/doc/turn/sensor/FX/UI mutation emits a domain event; the single largest INV-J gap | producers grep = payments/close/payouts only (SPEC_outbox-producer-dualwrite, G2) | BLOCKER | — | same |
| DATA-2 | WIRE | ABSENT | **Causal-inference engine DARK** — full Granger/back-door/DiD/counterfactual package, 0 gateway imports, no brain tool/route; MD can't answer "did X *cause* Y?" | `causal-inference/` pkg; grep services=package.json only | HIGH | — | BN-behind |
| DATA-3 | WIRE | ABSENT | **Anomaly-detection DARK** — full z/MAD/iForest/LOF/OC-SVM/AE + ADWIN/KSWIN package, no brain tool/route; proactive-intel re-implements 3 detectors | `anomaly-detection/` pkg; grep services=package.json only | HIGH | — | BN-behind |
| DATA-4 | WIRE | ABSENT | **Auto-insight (standing-drives) NOT wired** — `proactive-intel` full loop built, 0 gateway importers; no "standing-drive" construct; 4/7 detectors + notifier deferred | `grep @borjie/proactive-intel services=empty`; `grep standingDrive=0` | HIGH | — | same |
| DATA-5 | WIRE | PARTIAL | **No generic `data.describe`/cohort brain tool** — 30+ stats primitives reachable only via one hard-coded site-performance tool | `brain-tools/data-analysis-tools.ts` (1 tool) | MED | — | inherits |
| DATA-6 | WIRE | PARTIAL | **No inline-chart turn-path** — `ai-chart-author` exists + prompt instructs inline charts, but no SSE/turn path runs it on live tenant data → streamed Vega (INV-B live lens unproven) | `analytics/ai-chart-author/author.ts`; `md-agentic.hono.ts` emits no chart UiParts | MED | — | inherits |
| DATA-7 | WIRE | PARTIAL | **No Statistical-Rigor Guard** — bootstrap CI exists in one tool; no global Simpson/BH-Bonferroni/pre-registration/name-strip guard, no "every number carries a CI/significance flag" | `data-analysis-tools.ts` only | MED | — | inherits |
| DATA-8 | WIRE | PARTIAL | **Retention runner UNWIRED** — `retention-runner`/`rtbf-orchestrator` built, scheduled in NO cron; archive-first policy-capable, not operationally enforced | `grep retention-runner services=empty` (DP retention) | HIGH | — | BN-behind |
| DATA-9 | WIRE | PARTIAL | **Situational model not resident** — world-model forecast-on-demand (linear extrapolator), belief-engine UNWIRED, no blind-spot/uncertainty loop; depends on DATA-1 event fabric | `world-model/index.ts` header; `grep belief-engine services=empty` | HIGH | — | inherits |
| DATA-10 | WIRE | ABSENT | **No cross-store total-recall API** — recall is per-store; no "reconstruct the entire situation for thread X across thread-log + memory + domain events"; GraphRAG-over-thread unwired | graph-rag-router orphan (KI-graphrag) | MED | — | inherits |
| DATA-11 | DOMAIN | PARTIAL | **world-model `state-vectors.ts` type surface still real-estate** (`PropertyState`/`avgRentMajor`) — cosmetic LITFIN residual | `state-vectors.ts:13-29` | MED | — | BN-fit |

---

## 9. UNKNOWN-UNKNOWNS lane — the seam between the construction engine and the defense moat

> Source: `frontier-unknown-unknowns`. The meta-finding: the corpus's inviolable invariants
> (EN/SW purity, evidence-trust, reversibility, RLS/permission, accessibility, coherence,
> auditability) are specified for HAND-BUILT + TEXT artifacts and are **silently NOT carried onto
> the artifacts the brain GENERATES.** The rails exist; they don't extend to the things the brain
> makes. **The single highest-leverage lane is a Generated-Artifact Conformance Gate (UU-15)** —
> one judge in the synthesise→propose loop enforcing the full invariant set on every constructed
> organ. All UU rows are **domain-agnostic shared Borjie⇄BN substrate (build-once / mirror-twice).**

| ID | GType | Status | One-line | File evidence | Sev | DEMO | BN |
|---|---|---|---|---|---|---|---|
| UU-15 | BUILD | ABSENT | **No Generated-Artifact Conformance Gate** (the seam-sealer that subsumes UU-2/4/5/7/10/11/14) — generated organs enter the world OUTSIDE the rails governing hand-built ones | the seam is unsealed across portal-genui/genui/induction (frontier §15) | BLOCKER | ★ | same |
| UU-2 | WIRE | ABSENT | **No EN/SW purity gate on SYNTHESIZED surfaces** — `dynamic-language-rewriter` applied to chat, ZERO hits in portal-genui/genui; a generated surface can emit mixed "Royalty/Mrabaha" — violates the ABSOLUTE toggle | grep rewriter in portal-genui/genui=0 | HIGH | ★ | same |
| UU-10 | BUILD | ABSENT | **Induction-TRUST gate absent** — "evidence-required" is a presence-check, not a trust-check; evidence-poisoning can induce a plausible-but-wrong org structure/schema; injection detector guards tool-results not the induction corpus | `proposal-sink.ts:81-92` presence only; induction loop unbuilt | HIGH | — | same |
| UU-5 | BUILD | ABSENT | **Synthesized fields born UNCLASSIFIED** — a brain-minted field/type has no PII/residency/ACL class; encryption/masking is a no-op on it; classification not part of the schema body-change proposal | `tenant_schema_extensions` (0306) no pii/residency/acl; no runtime DDL classifier | HIGH | — | same |
| UU-14 | WIRE | ABSENT | **Gate-routing CLASSIFIER is editable + unprotected** — the brain can't edit the gate, but self-improvement (GEPA/AFlow) can optimize the classifier that ROUTES to it downward → starve the gate it's forbidden to edit | `inviolable.ts`/`policy-gate.ts` protected; arbiter/risk-scorer/lens-router optimizable; AUT-08 targets their prompts | HIGH | — | same |
| UU-7 | BUILD | ABSENT | **Lens-coherence missing for persisted artifacts** — Cambria lens (CON-7) is surface-only; reports/decks/exports/mobile-offline caches that bound to the old shape break on a column rename | `report-engine/data-source.ts` binds field names directly | MED-HIGH | — | inherits |
| UU-3 | BUILD | ABSENT | **Concurrent multi-user edit = lost-update by construction** — `portal_tabs`/proposals are whole-JSON upserts, no `row_version`/If-Match CAS; CRDT substrate exists but only wired to blackboard slots | `drizzle-tab-repo.ts` unconditional upsert; `yjs-doc`/`slot-crdt` unwired to surfaces | HIGH | — | same |
| UU-11 | BUILD | ABSENT | **Reversal of a schema/org body-change with a data-migration tail is unspecified** — pgroll gives reversible DDL not reversible business semantics once humans acted on the new shape | `mutation-authority/execution` surface/code-oriented; no backfill-reversal/reconciliation | HIGH | — | inherits |
| UU-6 | BUILD | ABSENT | **DR of a tenant-SYNTHESIZED world unproven** — backup-restore drill validates base schema, not that promoted tables/catalog/surfaces/KG round-trip COHERENTLY | `backup-restore-drill.yml` no synthesized-world coherence assertion | HIGH | — | same |
| UU-4 | BUILD | ABSENT | **No a11y budget at synthesis time** — a brain-composed surface can emit unlabelled buttons / sub-AA contrast / no keyboard path; no WCAG judge over the composed `layout_spec` | grep `wcag/axe-core/a11y audit` in genui/portal-genui=0 | MED-HIGH | — | inherits |
| UU-8 | BUILD | ABSENT | **No legibility/provenance inspector for self-constructed schema+UI** — can't debug why the brain built a given organ; audit answers "what was decided" not "why does this tenant's organ look like this" | `prov-o.ts` unwired (MEM-07); no constructed-world inspector | MED-HIGH | — | inherits |
| UU-9 | BUILD | ABSENT | **No autonomy posture-composition algebra** — two managers can set contradictory postures on interacting flows (deadlock / gate-leak); no most-restrictive-over-dependency-closure resolver | autonomy keyed tenant_id only; no posture lattice resolver | MED-HIGH | — | same |
| UU-13 | BUILD | ABSENT | **No construction-budget governor** — token budget exists, but no cap on proposals/day, no dedup across in-flight induced proposals, no approval-queue back-pressure (proposal sprawl trains owners to reflex-dismiss) | `llm-budget-postgres-wiring.ts` token-only; no proposal-rate governor | MED | — | same |
| UU-1 | BUILD | ABSENT | **No cold-start synthesis protocol** — every synthesis lane is evidence-driven; on a brand-new tenant all sources are empty AND wrong-domain (17 RE built-ins); no interview-to-ontology / synthetic-warm-start; day-0 cockpit reads empty | `seed.ts` seeds demo tenants not a generative bootstrap; built-ins RE | HIGH | — | same |
| UU-12 | BUILD | ABSENT | **Generative surfaces × offline mobile collide** — generated surfaces assume connectivity; no cache/degrade-gracefully/reconcile contract for a synthesized surface or offline proposal-accept (the pit/2G reality) | `LitFinOfflineBanner` for fixed flows only; no portal-genui offline path | MED-HIGH | — | inherits |

---

## 10. CAP-AUDIT lane — INV-G (hunt hardcoded CAPABILITY caps to dynamicize; keep anti-wedge SAFETY timeouts)

> INV-G: capability is UNCAPPED (duration via durable execution, size via schema synthesis,
> reasoning via decompose-into-swarms). The ONLY bounds are DYNAMIC GOVERNANCE (cost/budget,
> actuator rate-limits, the rails, anti-wedge safety timeouts). **A hardcoded magic-number that
> limits CAPABILITY (not safety) is a bug → dynamicize. A safety timeout/rate-limit/HITL-rail is
> a KEEP.** Distinction column: **DYNAMICIZE** = capability cap to replace with reasoned governance
> · **KEEP** = anti-wedge safety control to preserve.

| ID | Distinction | Item | Evidence | Action |
|---|---|---|---|---|
| CAP-1 | DYNAMICIZE | **Static `BRAIN_MODULES` (27 vs 180+)** caps the body self-model the MD can reason over | live brain reads static inventory; `system-graph-derivation` unwired (CON-9/EA-01) | Derive the real graph (CON-9); the node count is data, not a constant |
| CAP-2 | DYNAMICIZE | **Hard-coded reminder ladders** `[30,14,3]`/`[90..1]` cap cadence to a magic number per recipient | `ica-cert-expiry-cron.ts:32`; `licence-renewal-watcher.ts:10` (FAB-2/FAB-7) | Replace with per-recipient learned cadence + a ladder primitive |
| CAP-3 | DYNAMICIZE | **Closed modality set / closed recipe set / closed junior catalog** — registry is fixed, not growing | modality arbiter 7-closed; `document-templates` 11-recipe; juniors static (CON-13/14, DOC-06) | Tool/skill/recipe synthesis through the meta-rail (INV-C) makes the set grow |
| CAP-4 | DYNAMICIZE | **`requireSynthesis`/MoA + sub-MD fan-out flat-list (no DAG)** caps reasoning to a single call / undurable list | `kernel.ts:1230-1292`; `brain-dispatch.hono.ts:256` (EXEC-synth/EXEC-dag) | Decompose into junior swarms + DAG levels + streaming + memory (window is an impl detail) |
| CAP-5 | DYNAMICIZE | **Currency hard-bound KES** in the money rail caps the jurisdictions the MD can pay in | `mpesa-provider.ts:100` (HANDS-2) | Per-tenant currency config; add TZ/Tigo/Airtel providers |
| CAP-6 | DYNAMICIZE | **HPA ceiling mismatch (helm 50 vs base 20)** caps horizontal scale below intent | `values.yaml:141` vs `api-gateway-hpa.yaml:12` (RSS-24) | Reconcile + KEDA RPS/queue scalers |
| CAP-7 | KEEP | **72h `action_plans` expiry / `budget_micros`** — anti-wedge bound on a runaway saga | `action-runtime.schema.ts` | Keep — but make the value owner/brain-configurable per context, not a constant |
| CAP-8 | KEEP | **`MAX_ATTEMPTS=5` backoff + DLQ; dispatcher retry caps** — anti-wedge on a retry storm | `dispatcher-worker.ts:112` | Keep as a safety governor (it stops a wedge, not a capability) |
| CAP-9 | KEEP | **Token/cost budget governor (TPM+cost ceilings)** — anti-wedge on retry-loop spend | `llm-budget-governor` (EXEC-budget) | Keep + ADD the construction-budget governor (UU-13) as its parallel |
| CAP-10 | KEEP | **Kill-switch fail-closed / four-eye / sovereign HITL / autonomy timeouts** — the inviolable rails | `inviolable.ts`, `policy-gate.ts`, `killswitch.ts` | Keep absolutely; money/licence/deletion HITL forever; **fix RSS-19 fail-OPEN-on-misconfig bug** (a safety control currently mis-defaulting open) |

> **CAP-AUDIT verdict:** the caps that bite are mostly *incidental constants* (static module list,
> magic ladders, closed registries, KES, HPA mismatch) — each is dissolved by a gap already in this
> map (CON-9, FAB-2/7, CON-13/14, HANDS-2, RSS-24). The genuine safety governors (expiry, retry-cap,
> token budget, the rails) are KEEPs — and one of them (kill-switch fail-OPEN, RSS-19) is itself a
> BUG where a SAFETY control mis-defaults to permissive and must be hardened, not dynamicized.

---

## 11. The demo BLOCKERS — the first wow living-outcome demo

The "org wires itself on the fly under the operator's thumb, and the MD actually DOES the work"
demo (`SELF_ORGANIZING_ORG_BRAIN_VISION.md` §4 + INV-F service outcome) requires, in dependency
order, exactly these ★ rows:

| Order | Blocker | What it unlocks in the demo |
|---|---|---|
| 1 | **K-0** bind the meta-rail | nothing commits without it (gates Construction/Lenses/Hands self-extension) |
| 2 | **MIND-1** honesty unblock (kill `confidence=1`) | the colleague can hedge — without it it's a confident liar, not a veteran |
| 3 | **CON-1** mining ontology pack + **CON-8** bi-temporal | the nouns the demo creates exist + time-travel close (step 6) |
| 4 | **CON-9 / CON-10** system-graph derived + org-graph re-domained | the model re-derives (step 3) |
| 5 | **CON-2** EDC induction loop | the `special_mining_licence` type proposes itself (step 2) |
| 6 | **CON-6 / CON-7** surface-graph + Cambria lens / **LENS-1** lens engine | the `licence_console` surface proposes itself, chat-refinable (step 3) |
| 7 | **MIND-3 / MIND-2** deep-think default + resident situational model | the veteran thinks before it speaks |
| 8 | **CON-3 / CON-4** twin + Dispatch Kernel | the COO proposes a royalty-reconciliation organ; work routes free-now/fair (steps 4,5) |
| 9 | **CON-5** self-extension cron + **CON-12** empirical-fitness gate | org-chart redraws; sub-MD compiled, sandbox-tested, shadow→canary→live (step 4) |
| 10 | **HANDS-1 / HANDS-2** saga runner + TZ money-out | the MD actually files-and-pays the royalty end-to-end (INV-F — DO not suggest) |
| 11 | **FACE-1 / FACE-2 / FACE-6** visible-work trace + inline approve/handoff + hero CTA | the operator watches the work, approves inline, on the rich surface |
| 12 | **UU-15** Generated-Artifact Conformance Gate | every organ the demo creates is EN/SW-pure, classified, evidence-trusted, reversible, a11y-correct |

**Non-demo-but-must-precede-AUTO-at-scale (Wave-A safety floor, not on the demo path but gating any
real-tenant launch):** `RSS-03` RLS pinning cross-tenant leak · `RSS-10` prod SPOF · `DP-02`
corpus no-WITH-CHECK poisoning · `SEC-G1` security-guard dark · `FIRE-1/FIRE-2` break-glass + service-role
leak · `MEM-01/02` memory durability (already landed) · `DATA-1` non-money capture · `FAB-9` cron leader
election. These don't light up the demo but a self-improving brain is only safe-at-scale once they hold.

---

## 12. BossNyumba parity — the one-paragraph summary

Every substrate gap above lands in the **shared, domain-agnostic** layer, so BN inherits the fix by
pointing the engine at the real-estate ontology pack — **no second architecture.** Three parity
shapes recur in the BN column: **`same`/`inherits`** (the vast majority — shared-spine gaps fixed
once), **`BN-fit`** (Borjie's property residue — 0306 RE built-ins, org-graph projector edges,
KES/rent actuators, the wired property action tools — is *wrong for Borjie but exactly BN's seed
pack*; lift it into a `realEstateOntology` pack for BN and replace in Borjie), and **`BN-behind`**
(BN lacks the organ entirely — the body-model layer per EA-10: no system-graph/blackboard/
mutation-authority; the full RE junior set unbuilt per DM-12; and the analytics depth —
causal/anomaly/data-protection packages — that is a **Borjie-only asset** BN must port back). Net:
the cognitive *cycle*, the chat spine, the fabric, and the data capture spine are at structural
parity (same gaps); BN is **behind on embodiment and domain depth**, and **ahead on actuator
domain-fit** (the wired KES/rent/lease tools are literally its domain). Build Waves to a clean
domain-agnostic seam in Borjie, then port the engine + ship the RE pack to BN.

---

## 13. Source ledger

- **Code-audit dossiers (8):** `vision-code-audit.md`, `kernel-persona-and-code-audit.md`,
  `hands-code-audit.md`, `chat-code-audit.md`, `data-foundation-code-audit.md`,
  `fabric-code-audit.md`, `frontier-admin-data-boundary.md`, `frontier-unknown-unknowns.md`.
- **Stream-synthesis docs (7):** `SELF_ORGANIZING_ORG_BRAIN_VISION.md` +
  `ORG_BRAIN_GAP_REGISTER_AND_ROADMAP.md` (self-construction), `OPERATIONAL_CLOSED_LOOP_FABRIC.md`
  (fabric), `ORG_BRAIN_FRONTIER_SYNTHESIS.md` (lenses + firewall + tool-synthesis + UU),
  `MD_COGNITIVE_KERNEL_ARCHITECTURE.md` (Mind), `THE_HANDS_ACTUATOR_SERVICE_ARCHITECTURE.md`
  (Hands), `THE_CHAT_SURFACE_ARCHITECTURE.md` (Face), `THE_DATA_FOUNDATION_ARCHITECTURE.md` (Data).
- **The 132-ID register:** `MASTER_GAP_REGISTER.md` — every row above cross-references its KI/MEM/
  COG/AUT/EA/RSS/DM/SEC/DP/MG/DOC/UU/GAP-LENS IDs and the 10 owner invariants (INV-A..INV-J).
