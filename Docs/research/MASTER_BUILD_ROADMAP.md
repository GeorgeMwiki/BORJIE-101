# MASTER BUILD ROADMAP — the awakening sequence that turns the organs into one living organism

**Document:** `MASTER_BUILD_ROADMAP.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** master-roadmapper synthesis over `MASTER_ARCHITECTURE.md` (the one organism, 8 body systems, 8 keystones K-1…K-8), `MASTER_GAP_MAP.md` (96 deduped gaps, the demo critical path), and `MASTER_GAP_REGISTER.md` (132 IDs with file evidence + closure lanes + INV-A…INV-J).
**Status:** the dependency-ordered, FULL-CODE build plan — every wave is real wired code, nothing left as a spec. No code in this doc, no commit; this is the sequence the implementation waves follow.
**Bar:** SOTA, fiduciary-grade, MIT/PhD. Launch jurisdiction Tanzania (then KE/UG/NG).

> **THE THESIS THIS ROADMAP EXECUTES.** We already HAVE the organs — the resident-mind slots (CoALA, zero empty), the body-change meta-rail package, the modality arbiter, the actuator transport + money rail, the durable outbox + hash-chain, the two-plane memory substrate, the analytics/causal/anomaly packages, the generative-UI catalog, the org-graph row-store, the skill library. **What is missing is the CONNECTIVE ARCHITECTURE.** This roadmap is therefore an **AWAKENING (wiring), not a from-scratch build**: ~60% of all gaps are WIRE (have-the-organ-just-connect-the-seam), ~28% BUILD, ~12% DOMAIN. Each wave below cites the *we-have-it-just-wire-it* package by path.

> **SEQUENCING PRINCIPLE — MIND-FIRST.** The spine everything hangs off is the **resident `EstateMind` heartbeat + persistent Current Situational Model + standing-drives** (K-3, INV-D). It is built first because every other organ reads the situational model it maintains and runs on the heartbeat it provides: proactivity needs the Slow Loop; warm chat needs the Fast Loop reading the model; the standing-drives seed the analytical question-tree, the proactive surfacing, and the org-design loop. But the Mind cannot be honest, cannot persist what it builds, and cannot capture what it learns until three substrate keystones hold under it — so **Wave 0 lays the floor + the honesty unblock + the capture spine + the meta-rail bind FIRST**, then Wave 1 lights the Mind, then the keystone joints (Hands port, shared-state, metric==lens, the one bodyChange syscall), then the organs, then breadth.

> **SIBLING INVARIANT (load-bearing).** Borjie (mining-estate OS) and BossNyumba/BN (real-estate OS) are the SAME brain, capability, wiring, intelligence — only the **domain layer** differs (a swappable ontology pack + deterministic domain engines). **This exact roadmap runs in the BN repo with the domain layer swapped**: every wave below lands in the shared, domain-agnostic spine; BN inherits each fix by pointing the engine at `realEstateOntology` instead of `miningOntology`. The per-wave BN delta is stated in each wave's *BN parity* line. Build the connective architecture once in Borjie; both estates awaken from the same machine.

---

## How to read this roadmap

- **Waves are dependency-ordered.** A later wave never depends on an earlier wave's un-built organ. Within a wave, lanes are mostly parallelizable.
- Each wave specifies: **Goal · Organs/files to build-or-wire (with the have-it-just-wire-it package) · Invariants honored · Flag-default-safe behavior · Verification + rails proof · BLOCKER-for-first-living-outcome?**
- **Gap IDs** (`K-0`, `MIND-1`, `CON-2`, `RSS-01`, `EA-04`, `UU-15`, …) cross-reference `MASTER_GAP_REGISTER.md` / `MASTER_GAP_MAP.md` so every wave resolves to buildable rows.
- **★** marks an organ on the **first-living-outcome critical path** (the royalty cycle demo, §FINALE).
- **Flag-default-safe** is a hard rule (INV-G's safety floor): every new organ ships behind a flag that defaults to the SAFE posture (propose-not-apply, gated-not-auto, shadow-not-live, HITL-on-irreversible). Autonomy is *earned*, never default.

---

## WAVE 0 — THE FLOOR + THE FOUR SUBSTRATE KEYSTONES (nothing is honest, persistent, captured, or self-extending without this)

**Why first:** the Mind cannot be a veteran (it lies — `confidence=1`), cannot persist what it builds (the meta-rail is a deny-stub), cannot capture what it learns (capture is money-only), and cannot run safely at scale (RLS leak, SPOF, cron fan-out, no meta-rail controller) until this wave holds. This is K-7 (honesty) + K-5 (capture) + K-8 (floor) + K-1 (meta-rail bind) + the Wave-A safety floor. **This is the single highest-leverage wave in the program.**

### 0.1 — The honesty unblock (K-7) ★ BLOCKER
- **Goal:** the persona can honestly hedge; calibrated metacognition becomes possible.
- **Build/wire:** stop the hard-stamp `confidence=1`/`gates=pass` in `translateOrchestratorResponse` (`kernel.ts:3602-3614/3708-3723`); run the **real confidence scorer + policy-gate + drift + uncertainty** before translation; pass through **conformal abstention** (`conformal-calibration-online/aci.ts`, today ZERO live consumers). *We have it:* `confidence.ts`, `conformal-confidence-gate.ts`, `uncertainty-policy.ts` — all off-path, just wire them in. (`MIND-1`/`RSS-22`/`COG-03`/`COG-09`)
- **Invariants:** INV-D (a veteran says "not sure"); the K-7 precondition for ALL downstream metacognition.
- **Flag-default-safe:** abstention defaults ON for consequential surfaces; low-confidence → hedge, never fabricate.
- **Verify + rails:** unit test asserts a low-evidence turn returns `confidence<1` + a hedged fragment; conformal miscoverage assertion; no path can re-stamp `confidence=1`.
- **BN parity:** `same` — shared kernel.

### 0.2 — The durable total-capture spine (K-5) ★
- **Goal:** the outbox becomes the single estate-wide capture chokepoint, not money-only — the foundation the situational model, bi-temporal KG, lineage, the fabric DETECT plane, and durable execution all read.
- **Build/wire:** (a) port BN `DurableEventPublisher` (`enqueueToOutbox(events,tx)` co-commit) + Drizzle `IOutboxRepository` against `event_outbox`; swap the in-memory publisher at `payments-ledger/server.ts:316` (`RSS-01`). (b) Build the `emitDomainEvent()` seam so **every** consequential write (licence/assay/KYC/bid/tonnage/doc/turn/sensor/FX/UI), not just payments, co-commits an immutable `EstateEvent` (`DATA-1`). (c) CDC/WAL relay removes the in-process drop window; idempotent inbox dedups.
- **Invariants:** INV-J (lossless total capture); INV-G (durable horizon).
- **Flag-default-safe:** dual-write is additive (append a row); no read path changes; capture failure is logged, never silently dropped.
- **Verify + rails:** integration test asserts a licence renewal + an assay write each land an `EstateEvent` in the same tx; crash-mid-commit test proves no-drop; idempotent-inbox dedup test.
- **BN parity:** `same`.

### 0.3 — The inviolable floor hardened + the autonomy-controller meta-rail (K-8) ★
- **Goal:** the immune membrane that makes ALL later offense shippable — money/licence/deletion HITL forever, the gate the agent can never edit.
- **Build/wire:** (a) build `kernel/autonomy-controller/` (the Shield: trigger→check→enforce OUTSIDE the agent loop), wrapping policy-gate + `inviolable.ts`, immutable to the agent (`RSS-16`). (b) Fix the kill-switch **fail-OPEN-on-misconfig** bug — `parseLevel` must fail-closed (`halt`) for HIGH-risk, require an explicit `live` token; replace property reason codes with mining (`RSS-19`). (c) Close the RLS poisoning hole: split the global corpus policy into `corpus_read` (SELECT USING) + `corpus_write` (INSERT/UPDATE **WITH CHECK** `tenant_id=GUC`) (`DP-02`). (d) Protect the gate-routing classifier: self-improvement may sharpen recall, never lower the floor (`UU-14`, `inviolable.ts:482`).
- **Invariants:** INV-E (archive-first deletion HITL), the meta-rail ceiling, the inviolable floor — none ever relaxed by a later wave.
- **Flag-default-safe:** kill-switch fail-CLOSED by construction; WITH CHECK rejects cross-tenant writes by default.
- **Verify + rails:** a cross-tenant corpus write is rejected; a HIGH-risk action with a misconfigured kill-switch HALTS (not proceeds); the agent cannot mutate `inviolable.ts` machinery.
- **BN parity:** `same` — identical, the firewall does not fork.

### 0.4 — The body-change meta-rail BIND (K-1 / K-0) ★ THE KEYSTONE, BLOCKER
- **Goal:** the single highest-leverage weld — capability-growth commits actually persist, under approval, reversibly.
- **Build/wire:** replace the fail-closed **deny-stub** `buildBodyChangePort()` (`orchestrator-bindings.ts:1098-1104`, always `{authorized:false}`) by binding the real `@borjie/mutation-authority.authorizeBodyChange` in a new `composition/body-change-wiring.ts`; route portal-genui persist, dynamic-sections reorder, capability draft→live, and self-extension through this ONE syscall (`K-0`/`EA-04`/`AUT-01`). *We have it:* the syscall is built and reachable from the arbiter; only the seam terminates in a stub.
- **Invariants:** INV-C (self-extension), INV-E (reversible by construction), the meta-rail ceiling — every construction is a gated, reversible, hash-chained proposal.
- **Flag-default-safe:** every body-change defaults to **propose-and-approve** (never self-apply); auto only for a flow the owner explicitly set to auto, always reversible.
- **Verify + rails:** a surface/schema/skill commit persists ONLY after approval and is reversible; the UI-invariant tests (no UI change without approval; low-need turn proposes nothing; chat-refinement re-synthesizes; auto-flow spawns reversibly; a money/licence action still hits the policy-gate).
- **BN parity:** `inherits` — same syscall, BN gets it free; BN's own body-model layer is ported in Wave 6 (EA-10).

### 0.5 — The Wave-A safety floor (stateless, no-leak, no-SPOF, leader-elected)
- **Goal:** make AUTO-at-scale ever safe; remove every "the system leaks / lies / SPOFs" class.
- **Build/wire:** RLS reserved-connection pinning → `SET LOCAL` per op via `withTenantContext`, `prepare:false` (`RSS-03`); prod overlay → `k8s/ha/` (PG standby + Redis Sentinel) (`RSS-10`); port BN `cluster-lock.ts` `withClusterLock()` over ~26 crons (`RSS-06`); shared Redis for SSE bus / rate-limiters / token-blocklist / onboarding store (`RSS-05/08/09`, `SEC-G3`); harden JWT `iss`/`aud` (`SEC-G2`); wire `agent-security-guard` tool-use-validator before every dispatch (`SEC-G1`); make memory-v2 + cognitive-memory durable (Drizzle stores; `MEM-01/02`).
- **Invariants:** INV-A (no cross-tenant leak), the rails hold under HPA.
- **Flag-default-safe:** leader election default ON in prod; `prepare:false` default; durable store the only prod path (hard 503 when db missing).
- **Verify + rails:** cross-tenant leak test passes; single-replica-failure test (no SPOF); cron fires once cluster-wide; memory survives restart.
- **BN parity:** `same`.

**Wave 0 BLOCKER verdict:** ALL of 0.1–0.4 are BLOCKERs for the first living outcome. 0.5 is the safe-at-scale floor (must precede any real-tenant AUTO, not the demo path itself).

---

## WAVE 1 — THE RESIDENT MIND (K-3) — light the heartbeat, the situational model, the standing-drives ★ BLOCKER

**Why here:** this is the SPINE. Once the floor holds (Wave 0), the one structural deficiency — *triggered-not-resident cognition* — is fixed. Everything downstream reads the situational model this wave maintains and runs on the heartbeat it provides.

### 1.1 — The resident `EstateMind` Slow/Fast two-loop ★ BLOCKER
- **Goal:** a per-tenant, durable, recursively-viable mind running two concurrent loops over one shared state.
- **Build/wire:** build `central-intelligence/kernel/awareness/` (the dir does not exist today). **Slow Loop `EstateMind.tick()`**: `PERCEIVE→ORIENT→ORGANIZE→CREATE→EXECUTE-to-closure→LEARN` on a perpetual heartbeat (each `flow_id` a durable workflow surviving restart). **Fast Loop `think(req)`**: a chat turn READS the live situational model (never recomputes cold) → recognition-primed, instant, warm, honestly-calibrated answer. *We have it:* the world-model (`world-model/index.ts`, per-call today), the wake-loop (`main-loop.ts`, cluster-locked, real detectors) — promote to resident. (`MIND-2`/`COG-15`/`DATA-9`)
- **Invariants:** INV-D (think AND act, continuous in the backend), INV-J (the model is read first, never lost).
- **Flag-default-safe:** the Slow Loop runs in shadow first (observes + writes the model, does not auto-act) until earned-autonomy promotes a flow.
- **Verify + rails:** the model persists across a gateway restart; a Fast-Loop turn reads it (no cold recompute); a Slow-Loop tick survives a restart mid-flow.

### 1.2 — The persistent Current Situational Model ★ BLOCKER
- **Goal:** a durable per-tenant standing state read first on every consequential turn.
- **Build/wire:** a per-entity activation field (recency×freq + spreading), an open-loop registry, standing-concern status, and a **Global-Workspace single broadcast** ("the one thing I'd worry about as your MD right now"). Build the six-facet `SituationalSelfModel` (happened/doing/todo/future/blind-spots/caveats) (`COG-15`/`ORCH-situation`). Fed by the K-5 capture spine (Wave 0.2). *We have it:* `belief-engine` (unwired), `supervisor/types.ts` (zero consumers).
- **Invariants:** INV-J (complete situational awareness, nothing lost), INV-D (ORIENT reads it).
- **Flag-default-safe:** the model is read-state; it informs but does not auto-act.
- **Verify + rails:** the model reconstructs from the event log on cold start; the single broadcast is populated; blind-spots are flagged for grounding.

### 1.3 — The standing-drives / Motivational Subsystem ★
- **Goal:** the MD formulates its OWN goals — the loops nobody asked about.
- **Build/wire:** a durable, learnable registry of maintenance/interest goals (cash never breaks, the licence never lapses, grade never silently drifts, margin protected, workforce safe), via a **GDA discrepancy organ**; these seed the analytical question-tree, the proactive surfacing, and the org-design loop. Wire the proactive SIGNAL cadence to this source (today IDLE — `proactive-wiring.ts:290-348` has no `signalSource`) (`MIND-12`/`EA-07`/`DATA-4`). *We have it:* `proactive-intel` (full loop, 0 importers).
- **Invariants:** INV-I (insights surface unprompted), INV-D (PERCEIVE identifies loops before anyone asks).
- **Flag-default-safe:** drives SURFACE proposals (ambient inbox), never auto-execute a consequential action.
- **Verify + rails:** a standing drive fires on a real signal (e.g. licence T-90) and lands an ambient proposal, not an action.

### 1.4 — ORIENT: recognition-primed situation-typing ★ BLOCKER
- **Goal:** generality is structural — recognised→playbook (the 80%), novel→search+distil (the 20%).
- **Build/wire:** a typed `SituationPrototype` library (rows authored from the corpus, never `switch` statements); **Klein RPD** + Case-Based retrieval; no-match → drop to deliberate search and **flag the resolution for distillation** into a new prototype (the library grows itself) (`MIND-4`). *We have it:* `supervisor/types.ts` (unused), the lens classifier (picks voice, not schema — extend it).
- **Invariants:** INV-D (orient like a veteran, general across any situation).
- **Flag-default-safe:** unknown situations route to deliberate search + a hedged answer, never a confident guess.
- **Verify + rails:** a known situation runs the primed playbook; a novel one drops to search and registers a new prototype.

### 1.5 — Promote the disciplined kernel to the default consequential turn ★ BLOCKER
- **Goal:** the veteran thinks before it speaks.
- **Build/wire:** promote `kernel.think()` (LATS/ToT/debate/world-model) to the **default answer generator on consequential surfaces**; demote the single-shot router to the fast-path; thread persona + junior dispatch inside the kernel as tools (`MIND-3`/`COG-01`/`COG-02`/`COG-06`). Add the forced **simulate-before-act pre-commit** (world-model + MCTS/PRM + constitutional-critic veto) before any AUTO action touches reality (`MIND-6`/`RSS-17`). *We have it:* `lats-search.ts`, `search-planner.ts`, `runDebate`, the world-model, the PRM, the constitutional-critic — all built, off-path.
- **Invariants:** INV-D (deliberate where it matters), the pre-commit gate (never surprise).
- **Flag-default-safe:** deep-think defaults ON for the hard band; the pre-commit gate is mandatory before AUTO.
- **Verify + rails:** a high-stakes turn runs real search (not single-shot); an AUTO action runs a dry-run pre-commit and a critic veto can block it.

**Wave 1 BLOCKER verdict:** 1.1, 1.2, 1.4, 1.5 are BLOCKERs (the demo's "veteran thinks before it speaks"). 1.3 is the proactive engine that NOTICES the royalty cycle.

---

## WAVE 2 — THE KEYSTONE JOINTS (the modality arbiter, the actuator port, shared-state, metric==lens)

**Why here:** these are the welds that, once the Mind is resident, give it places to land its decisions, hands to act, a face to show the work bidirectionally, and a lens to render truth. Each is a K-2/K-4-class keystone.

### 2.1 — The modality arbiter ON (K-2) ★ BLOCKER
- **Goal:** the 7-way head everything lands on — until it ships, everything collapses to one `tool_call`.
- **Build/wire:** build `kernel/orchestrator/modality-arbiter.ts` (MiniLM router + LLM cascade) emitting `ANSWER / SKILL / WORKFLOW / LOOP / AGENT / ACTUATE / run_modality` BEFORE `router.call`; add the 7th `run_modality` Decision variant; wire the orphan `loop-runner` as the LOOP executor (= ambient agency); the `ACTUATE` verb = the Hands' entry; `run_modality: ANALYZE` = the data-scientist's entry (`COG-07`/`AUT-14`). *We have it:* the Decision ADT is 7-variant-ready; the loop-runner exists, orphaned.
- **Invariants:** INV-C (captured skills/discovered workflows have somewhere to land), INV-H (the visible-work layer shows which modality ran).
- **Flag-default-safe:** the arbiter defaults to ANSWER for low-need turns; SKILL/WORKFLOW/AGENT/ACTUATE require the body-change/policy gates as appropriate.
- **Verify + rails:** a skill turn routes to SKILL, a multi-step turn to WORKFLOW, an actuation to ACTUATE → policy-gate; a plain chat proposes nothing.
- **BN parity:** `same`.

### 2.2 — The reversibility-typed actuator PORT + saga executor (K-4) ★ BLOCKER
- **Goal:** the Hands — rails fall out of the type system; multi-step real-world work resumes from a gated step.
- **Build/wire:** (a) build `packages/actuators` — the uniform PORT declaring `reversibility ∈ {reversible|compensable|irreversible}` + `idempotencyKey` + `dryRun/preview` + `confirm` + `compensate` in the TYPE, above the adapters; the autonomy gate then enforces `irreversible ⇒ HITL four-eye` **mechanically** (`HANDS-7`). (b) build the durable **saga RUNNER** over the orphan `action_plans/action_steps` schema (`action-runtime.schema.ts` 0225-0228, ZERO executor today) — walk steps via the port, run compensations in reverse, resume from a gated step on approval; generalize the gold-standard `disbursement-reconciliation.job` from money to all actuators (`HANDS-1`/`EXEC-saga`). (c) make four-eye approval durable (`createDrizzleApprovalRouter`, today in-memory — `RSS-21`); make durable execution real (Inngest/Temporal worker deployed, not mock-default — `RSS-23`/`HANDS-8`).
- **Invariants:** INV-F (DO-not-suggest; sensitive = prepare→ask→execute-or-handoff; PAYMENTS confirm THROUGH `LedgerService.post()`), INV-G (durable horizon, resume at step 48), INV-E (compensate = reversible undo).
- **Flag-default-safe:** every actuator is `dryRun`-first; irreversible defaults to HITL; the saga pauses at a gated step and never auto-proceeds.
- **Verify + rails:** a 3-step saga dry-runs, pauses at the money step, executes only the previewed package on approval, captures the receipt, and compensates on a forced mid-saga failure; a restart resumes from the gated step.
- **BN parity:** `inherits` the port + runner; the per-category adapter binding forks (mining-licence→cadastre vs property-transaction).

### 2.3 — The bidirectional shared-state spine (the Face's "two views of one state")
- **Goal:** one shared session-state doc → two coupled projections (chat + warm lenses); the blackboard as the shared-state spine.
- **Build/wire:** wire `packages/blackboard-sota` (slots/handoff/control/posts/regions) as the ONE shared-state spine: build `blackboard.hono.ts` (post/read slot, handoff) + a `SlotDelta` broadcaster on the realtime topic; owner-web + both mobiles subscribe via `use-slot`; add the `STATE_SNAPSHOT`/`STATE_DELTA` AG-UI channel so a slider-drag emits a delta the MD sees and the same chart updates (`EA-05`/`FACE-3`). *We have it:* `blackboard-sota` + `chat-ui/blackboard` built, reaching no surface.
- **Invariants:** INV-H (Layer-3 bidirectional), INV-B (a lens graduates to a tab with zero refetch), INV-J (the blackboard IS the resident situational state's projection).
- **Flag-default-safe:** state-deltas are proposals on consequential slots; a money/licence slot edit still hits the policy-gate.
- **Verify + rails:** a slider-drag updates the same chart bidirectionally; "pin to cockpit" graduates a lens with zero refetch; a consequential delta is gated.
- **BN parity:** `same` substrate; `BN-behind` (BN lacks the blackboard entirely — ported in Wave 6).

### 2.4 — metric == lens fusion + the Faithfulness Gate
- **Goal:** every analytical answer IS an interactive inline lens; the agent literally cannot compute an ungoverned number, and the chart cannot lie.
- **Build/wire:** fuse the analytics semantic layer with the surface engine; add the `Σ operation-cells ≡ estate-cell` reconciliation gate (`LENS-2`); wire the inline-chart turn-path (`ai-chart-author` → SSE → streamed Vega on live tenant data — `DATA-6`); extend the Auditor (rejects empty evidence chains) to **reject non-attributing charts** (axis honesty, no area-for-quantity, every mark attributes to an `evidence_id`); add the **Statistical-Rigor Guard** (Simpson/BH/pre-registration/name-strip → pass or ABSTAIN — `DATA-7`). *We have it:* `analytics/src/semantic/`, `ai-chart-author`, the full descriptive/causal/anomaly packages (`DATA-2/3` dark).
- **Invariants:** INV-I (PhD analytics that abstains), INV-B (metric==lens, roll-up/drill-down are one definition at two points).
- **Flag-default-safe:** an analysis with a Simpson reversal or failed significance ABSTAINS with a caveat, never narrates confident nonsense.
- **Verify + rails:** a query returns an interactive lens, not a number; a chart that mis-attributes is rejected by the Faithfulness Gate; a spurious finding abstains.
- **BN parity:** `inherits`; the dimension binding forks ("royalty exposure by mine" ⇄ "rent-arrears exposure by building").

**Wave 2 BLOCKER verdict:** 2.1 and 2.2 are BLOCKERs (the MD must route to ACTUATE and run the royalty saga). 2.3 and 2.4 make the work visible and the analytics truthful.

---

## WAVE 3 — THE CONSTRUCTION ORGANS (the body builds its own organs as reversible data-patches) ★ BLOCKER

**Why here:** with the meta-rail bound (Wave 0.4), the arbiter ON (2.1), and the Mind resident (Wave 1), the CREATE phase can now fire on impasse and the organism extends its own body — through the ONE governed chokepoint, as reversible data.

### 3.1 — The mining ontology pack + bi-temporal/PROV-O ★ BLOCKER
- **Goal:** the nouns the demo creates exist, and time-travel works.
- **Build/wire:** author the `miningOntology` seed pack (licence/deposit/assay/royalty/shipment/buyer/jurisdiction — `0306` ships 17 real-estate built-ins today; `knowledge-graph/src/ontology/` only has `real-estate.ts`); swap it into the live KG (`ported-domain-wiring.ts:49,107`) (`CON-1`/`KI-10`). Wire bi-temporal (`temporal/bi-temporal.ts`) + PROV-O (`provenance/prov-o.ts`) into ingest so facts **invalidate-with-timestamp**, never overwrite (`CON-8`/`MEM-07`). *We have it:* both modules built, no caller; the RE residue is exactly BN's seed pack.
- **Invariants:** INV-J (supersede≠delete → time-travel "what did we believe on date D?"), evidence-required (fields born classified).
- **Flag-default-safe:** the pack is additive; the old version is never destroyed (instant rollback).
- **Verify + rails:** a `special_mining_licence` entity exists; a "what did we believe on date D?" query time-travels; a superseded fact is retained.
- **BN parity:** `BN-fit` — lift the RE residue into `realEstateOntology` for BN.

### 3.2 — The EDC schema-induction loop ★ BLOCKER
- **Goal:** a new licence type proposes itself from evidence (demo step 2).
- **Build/wire:** build the EDC loop (Extract→Define→Canonicalize, AutoSchemaKG/Graphiti) that induces entity/event/relation types from evidence and emits a **versioned data contract** as a `bodyChange` proposal; pgroll-promote a hot JSONB type to a typed table reversibly; fields **born classified** (PII/residency/ACL) and pass an **induction-TRUST gate** (`CON-2`/`MEM-06`/`CON-15`/`UU-5`/`UU-10`). *We have it:* nothing induces today (CRUD-only); the meta-rail (Wave 0.4) is the commit path.
- **Invariants:** INV-C (self-extension), INV-A (born-classified), the meta-rail (every induction is a gated proposal), induction-trust (evidence-poisoning can't induce a wrong schema).
- **Flag-default-safe:** induced types are proposals (draft), promoted only on approval, reversibly.
- **Verify + rails:** evidence induces a proposed `entity_type_definition`; a poisoned-evidence induction is rejected by the trust gate; promotion is reversible.
- **BN parity:** `inherits`.

### 3.3 — The body self-model + org-graph re-derived ★ BLOCKER
- **Goal:** the model re-derives live (demo step 3).
- **Build/wire:** register `deriveSystemGraph` as a cron + listChanged trigger (today invoked only in `.test.ts`); persist the graph; wire `createBodySchemaReader` as `deps.bodySchemaReader` so the live brain reads the 180+-node graph, not the static 27-module `BRAIN_MODULES` (`CON-9`/`EA-01`/`CAP-1`). Re-domain + run the org-graph projector (`org-graph/src/projector.ts:7-13` projects lease/unit/invoice today; no live worker writes `org_graph_edges`) (`CON-10`). Expose `query_body_schema`/`body_blast_radius` as brain tools (`EA-02`). *We have it:* `system-graph-derivation.ts` (test-only caller), the projector (property edges).
- **Invariants:** INV-C (the node count is data, not a constant), proprioception (org-and-self in one query plane).
- **Flag-default-safe:** derivation is read-state; blast-radius is computed before any body-change.
- **Verify + rails:** the live brain reasons over the derived graph; `body_blast_radius` returns the impact set before a change.
- **BN parity:** `BN-behind` (port the body-model layer in Wave 6); the projector residue is `BN-fit`.

### 3.4 — The surface-LENS engine + Cambria lens ★ BLOCKER
- **Goal:** the `licence_console` surface proposes itself, chat-refinable (demo step 3).
- **Build/wire:** build the persisted, typed **surface-GRAPH** (nodes=surfaces; edges=`drill_down/hand_off/derives_from/shares_context` discovered from FKs) + the graph synthesiser (today portal-genui emits a single `PortalTab`) (`CON-6`/`EA-09`). Build the `LensDefinition` + KG-OLAP roll-up/drill-down operator kernel over `core_entity` (`LENS-1`) and the self-re-categorizer (`LENS-3`). Build the **Cambria lens** layer so a column rename rebinds persisted surfaces (propose-with-visual-diff on a destructive change) (`CON-7`/`UU-7`). Plane-type lenses `control|data` (`LENS-4`, INV-A by construction). *We have it:* the `core_entity` polymorphic row-store (the rare KG-OLAP half), portal-genui (intent→view).
- **Invariants:** INV-B (surfaces are semantic lenses, auto-expand/contract), INV-A (a control-plane lens can't touch a tenant business table, by type), the meta-rail (a proposed surface is gated).
- **Flag-default-safe:** a proposed surface surfaces as an ambient proposal (Open/Undo); mutates only on approval; chat refines and re-synthesizes.
- **Verify + rails:** the licence_console surface proposes itself; a chat refinement re-synthesizes it; a column rename rebinds (or proposes a visual diff); a control-plane lens touching a business table is rejected.
- **BN parity:** `inherits`.

### 3.5 — The simulatable digital twin + the Dispatch Kernel ★ BLOCKER
- **Goal:** the COO proposes a royalty-reconciliation organ, and work routes free-now/fair (demo steps 4,5).
- **Build/wire:** build the **digital twin** — causal/ABM sim + process-mining over `event_outbox` + "org git" (branch on replayed history → predicted delta sheet + blast-radius BEFORE acting) (`CON-3`/`CON-18`). Build the **Dispatch Kernel** — capacity/load-aware task routing (Hungarian/CP-SAT/auction/MARL person↔task match + a fairness ledger), replacing the risk-tier-only `workforce-orchestrator` (`CON-4`). *We have it:* the event_outbox (now estate-wide post Wave 0.2), the causal package (`DATA-2`, dark).
- **Invariants:** INV-D (simulate before redesign), INV-G (uncapped scale), fairness (no person is overloaded).
- **Flag-default-safe:** the twin runs in simulation; dispatch proposals are gated until earned-autonomy.
- **Verify + rails:** the twin predicts a delta sheet + blast-radius on a replayed branch; the dispatch kernel routes a task to a free, fair assignee.
- **BN parity:** `inherits`.

### 3.6 — The proactive org-design loop + empirical-fitness gate ★ BLOCKER
- **Goal:** the org-chart redraws; a sub-MD enters shadow→canary→live (demo step 4).
- **Build/wire:** wire the proactive org-design loop (`self-extension.ts` — `detectRecurringGap→proposeNewSubMd→compile`, ZERO callers today) into a scheduled worker driven by the twin (`CON-5`/`AUT-02`). Chain the **empirical-fitness gate** (`draft→shadow→canary→live→deprecated→archived`, kept only if it beats the incumbent on real outcomes over 7/28/91-day windows, with burn-rate/NOI/SLO auto-rollback to the archived parent) into the body-change executor (`CON-12`/`EA-12`/`AUT-15`). Deploy the evolution workers (Dockerfiles + k8s CronJobs — none today) (`CON-11`/`AUT-12`). *We have it:* `self-extension.ts`, the DGM-fitness substrate, the shadow/canary/auto-rollback machinery — all built, un-chained.
- **Invariants:** INV-E (archive-first, deletion HITL), INV-C (the org grows itself), the empirical-fitness Darwin-Gödel gate (only organs that earn their keep survive).
- **Flag-default-safe:** a new sub-MD enters SHADOW (observes, does not act) → canary (small slice) → live only on sustained fitness; auto-rollback on burn-rate breach.
- **Verify + rails:** a recurring gap proposes a sub-MD; it is sandbox-tested (isolated-vm), enters shadow, and is auto-rolled-back if it underperforms; deletion of the parent requires HITL.
- **BN parity:** `same` (self-extension) / `inherits` (fitness gate).

### 3.7 — The Generated-Artifact Conformance Gate (K-6) ★ BLOCKER
- **Goal:** every organ the demo creates is EN/SW-pure, PII/residency-classified, evidence-TRUSTED (not just present), reversal-declared, and WCAG-correct.
- **Build/wire:** build the **Conformance Gate** — one judge in the synthesise→propose loop that carries the FULL invariant set onto every constructed organ (the seam the corpus was blind to: the inviolable invariants are enforced on hand-built/text artifacts but silently un-enforced on what the brain GENERATES). It subsumes the EN/SW purity gate on synthesized surfaces (`UU-2`), born-classified fields (`UU-5`), the induction-trust gate (`UU-10`), the a11y budget at synthesis time (`UU-4`), lens-coherence for persisted artifacts (`UU-7`), and the prove-safe gate for synthesized tools (`UU-15`, subsuming UU-2/4/5/7/10/11/14). *We have it:* `dynamic-language-rewriter` (applied to chat, ZERO hits in portal-genui/genui — extend it).
- **Invariants:** ALL — EN/SW purity (the ABSOLUTE toggle), evidence-trust, reversibility, RLS/PII, a11y, coherence, auditability — carried onto generated organs.
- **Flag-default-safe:** the gate is mandatory and fail-closed on any constructed organ; a non-conformant organ cannot be promoted.
- **Verify + rails:** a synthesized surface emitting mixed EN/SW is rejected; an unclassified PII field is rejected; a sub-AA-contrast widget is rejected; an empty-evidence organ is rejected.
- **BN parity:** `same` — the seam-sealer does not fork.

**Wave 3 BLOCKER verdict:** ALL of 3.1–3.7 are BLOCKERs (the self-wiring half of the demo — the org wires itself on the fly, gated, under the operator's thumb).

---

## WAVE 4 — THE HANDS LAST-MILE + THE FABRIC + THE FACE (the MD actually DOES the work, drives it to closure, and shows it) ★ BLOCKER

**Why here:** with the actuator port + saga (Wave 2.2) as the chassis, this wave binds the real-world rails, the closed-loop nervous system, and the visible-work surface — so the royalty cycle runs end-to-end.

### 4.1 — TZ money-out + e-gov + e-sign actuators ★ BLOCKER
- **Goal:** the MD actually files-and-pays the royalty (INV-F DO-not-suggest).
- **Build/wire:** wire TZ money-out (M-Pesa-TZS / Tigo Pesa / Airtel Money — `mpesa-provider.ts:100` is KES today, mock default disburses nothing) (`HANDS-2`/`CAP-5`); wire GePG (`gepg-real.ts` exported, no importer / `FILE_GEPG` handler) (`HANDS-4`); build TZ-mining e-gov actuators (TRA VFD/filing, Tume-ya-Madini/IDRAS royalty+licence submission, BRELA/NEMC) (`HANDS-6`); wire e-signature (real DocuSign/Dropbox-Sign/Adobe adapters, ZERO gateway call site today) (`HANDS-5`); add the portal-driver for no-API rails (BRELA/Tume-ya-Madini lack clean APIs — the brain sees only the capability) (`HANDS-10`); bind the completion certificate / Trust Receipt into the audit chain (`HANDS-11`). Re-domain the wired property action tools to mining nouns (`HANDS-3`).
- **Invariants:** INV-F (prepare→ask→execute-or-handoff; the MD tracks to closure even on handoff), the money rail (confirm THROUGH `LedgerService.post()`), the rails (irreversible HITL four-eye).
- **Flag-default-safe:** money-out is mock-default until the provider key is provisioned + the flow is granted; every disbursement is dryRun→preview→approve→confirm.
- **Verify + rails:** a royalty filing is prepared autonomously, the MD asks "execute or will you?", on approval pays via M-Pesa-TZS through the ledger, captures the receipt, and the completion certificate binds into the hash chain; on handoff the MD still tracks to closure.
- **BN parity:** `BN-fit` (the wired KES/rent residue is BN's domain); the port is shared.

### 4.2 — The closed-loop fabric joints (drive to confirmed closure)
- **Goal:** every consequential event becomes a complete, uniform, durable loop closed from the source of truth.
- **Build/wire:** close the joints (the organs are strong; the gaps are at the seams): confirm-delivery closure (`onDeliveryStatus` publishes but never UPDATEs `notification_dispatch_log.delivery_status` — `FAB-1`); the durable reminder LADDER primitive replacing hard-coded `[30,14,3]`/`[90..1]` crons (`FAB-2`/`CAP-2`); escalate-on-inaction up the live org/rota graph (`mining_escalations` schema exists, no reader — `FAB-4`); cross-channel fallback ladder push→SMS→WhatsApp→call (`FAB-5`); the ACT lane (a fired reminder auto-drafts-and-assigns a remediation, not a nag — `FAB-6`); LEARN/self-tune the ladder per recipient (`FAB-7`); the uniform "consequential event" DETECT registry (`FAB-8`). Closure is **Perceptual-Control-Theory semantic completion** — confirmed from the source-of-truth row (ledger posting / licence row), never a message read; recovery is strictly leveled L1 retry→L2 patch→L3 replan (`MIND-10`/`COG-13`).
- **Invariants:** INV-J (no-drop), INV-D (EXECUTE-to-closure, never stop at "proposes"), the closure invariant (controlled perception matches reference).
- **Flag-default-safe:** the ACT lane drafts (does not auto-send a consequential action); escalation is policy-gated.
- **Verify + rails:** a royalty obligation registers a loop, fires a ladder, escalates on inaction, drafts a remediation, and confirms closure from the ledger row (not a read); recovery re-plans rather than abandons.
- **BN parity:** `same`.

### 4.3 — The Face: visible-work SSE + inline approve/handoff + hero CTA ★ BLOCKER
- **Goal:** the operator watches the work and approves it inline on the rich surface.
- **Build/wire:** add live `reasoning`/`tool_call`/`plan` SSE events to the primary surface (`brain-teach.hono.ts:31-37` emits none; the real tool log is wired only into legacy `HomeChat`) (`FACE-1`); bring inline take-the-wheel/approval into chat (prepare→ask→handoff + approval inbox live on separate pages today) (`FACE-2`); point the hero CTA at the rich `HomeChatTeach` (dashboard "Ask Borjie" → leaner `/ask` today) (`FACE-6`); the visible-work layer (plan card typed by risk + money-path; MD-junior activity rail; three-depth reasoning fold; per-claim evidence chips with an amber "unverified" state); the unified colleague INBOX over notify/question/review (`MIND-14`); adopt the **Visual OS render discipline** in genui (default to the richest output; prose is the fallback) + wire the shared `chat-ui` spawn primitives (`NeedSpawnBanner`/`ChatArtifactStream`, ZERO app consumers — `FACE-7`). *We have it:* `HomeChatTeach`+OwnerOS (past a text box), the `ToolCallSidebar`, the `HandoffCard`.
- **Invariants:** INV-H (chat-first but NOT simple; transparency=trust), INV-B (inline lenses), the UI invariant (reasoned-need, proposal-gated, reversible, chat-refinable).
- **Flag-default-safe:** the inline approval is the only path to a consequential execute; reasoning/tool_call events are read-only.
- **Verify + rails:** the operator sees the reasoning fold + tool_call rail live; approves the royalty filing inline; a low-need turn proposes no UI change.
- **BN parity:** `inherits`; mobile parity is the largest delta (`FACE-8`).

**Wave 4 BLOCKER verdict:** 4.1 and 4.3 are BLOCKERs (the MD DOES the work + the operator watches/approves it). 4.2 drives it to confirmed closure.

---

## WAVE 5 — DOMAIN DEPTH + MEDIA/DOC LAST-MILE (the MD is an expert, and produces real bytes)

**Why here:** with the spine, hands, and construction live, breadth comes next — the deep domain juniors and the real-artifact last-mile. Not on the demo critical path, but required for a credible expert and real deliverables.

### 5.1 — Wire the 3 dark deep agents + replicate the deterministic-engine pattern
- **Goal:** depth across the full 24-domain mining map.
- **Build/wire:** wire `structural-civil-agent`, `machinery-advisory-agent`, `esg-disclosure-agent` (in the working tree, absent from barrel/`JUNIOR_NAMES`/`executor-registry`/router-prompt) (`DM-01`); build the missing deterministic engines + LLM-narration + Auditor-gate per domain: CRIRSCO/JORC resource classifier (`DM-02`), NPV/cutoff/Lerchs-Grossmann LOM (`DM-03`), metal-accounting/AMIRA-P754 (`DM-04`), family-office/succession consuming the orphan `succession-plans.schema.ts` (`DM-05`), closure/IAS-37/water-balance (`DM-06`), valuation/insurance/refining/trading/holdco (`DM-07..11`/`DM-16`).
- **Invariants:** evidence-required (every junior recommendation cites ≥1 `evidence_id`), the Auditor gate (rejects empty evidence chains), EN/SW purity.
- **Flag-default-safe:** new juniors are advisory by default; consequential actions route through the actuator port + rails.
- **Verify + rails:** each wired junior answers a domain query with evidence; the Auditor rejects an empty-evidence response.
- **BN parity:** `DM-12/13/14/15` — replicate the pattern for the RE junior set (BN-behind; build per the 19-domain map).

### 5.2 — Media generation last-mile (real bytes)
- **Goal:** zero-real-bytes → real frames, stored, classified, watermarked.
- **Build/wire:** async job lifecycle submit→poll→download + real provider downloads (adapters fabricate UTF-8 bytes today — `MG-01`); MediaStorage port + Drizzle persistence to `media_artifacts` (schema exists, never written — `MG-02`); fix the dead brain/genui contract (`createMediaDispatcher` not exported → always 1×1 PNG — `MG-03`); add flagship models (Veo 3.1, Nano-Banana) + Sora-2 sunset migration (`MG-04`); safety scanners on a fetchable URL (`MG-05`); real C2PA COSE/X.509 JUMBF + SynthID (`MG-06`).
- **Invariants:** provenance (C2PA/SynthID), safety (NSFW/deepfake gate before publish), the meta-rail (media is a gated artifact flowing into a dynamically-composed surface, not a fixed "media tab").
- **Flag-default-safe:** generation requires approval-tier UX; moderation gates before publish.
- **Verify + rails:** a `BORJIE_LIVE_MODE` test asserts non-zero bytes + a verifiable C2PA manifest (`MG-09`).
- **BN parity:** `inherits`.

### 5.3 — Document generation last-mile (real binary)
- **Goal:** markdown-only → real binary docs, e-signed, WORM-stored.
- **Build/wire:** the binary-render worker draining `document_render_jobs` (queued forever today — `DOC-01`) via `renderer-factory-v2`/`document-studio` (Carbone+Typst+Puppeteer); mount `dynamic-recipe-authoring` (the "infinite types" engine, unwired — `DOC-02`); wire one composer of record (`report-engine.renderReport`/`document-templates.composeDoc`, ZERO call sites — `DOC-03`); restore the stripped doc deps (`DOC-04`); bind real e-sign + OCR + eIDAS (`DOC-05`); call the quality-guarantor `processOutput` on the live binary path (`DOC-07`).
- **Invariants:** the citation-gate + reconciliation, WORM + storage, e-sign on the irreversible step (HITL).
- **Flag-default-safe:** e-sign is prepare→ask→execute; the render path is additive.
- **Verify + rails:** a contract renders to a real PDF, passes the quality-guarantor, and is e-signed via the actuator port.
- **BN parity:** `inherits`.

**Wave 5 BLOCKER verdict:** NOT on the first-living-outcome critical path (the royalty cycle needs the filing actuator from Wave 4.1, not the full media/doc breadth). Required for the credible-expert + real-deliverable bar.

---

## WAVE 6 — SELF-IMPROVEMENT + BN EMBODIMENT + THE EVAL HARNESS (gets better every night; both estates awaken)

**Why last:** self-improvement is only safe once the floor, the meta-rail, the empirical-fitness gate, and the capture spine all hold (Waves 0–4). The evaluator IS the product — it defines "done" for every wave above. And BN's embodiment port closes the sibling loop.

### 6.1 — The replay→eval→update nightly loop
- **Goal:** the brain gets better every night while the mine sleeps.
- **Build/wire:** the replay buffer table (fed by decisionLog/Auditor) + machine-checkable estate-decision fitness (ledger-balanced, licence-row-correct, evidence non-empty, budget, EN/SW purity, calibration) + the nightly replay pass in the sleep-pass (`AUT-06`); the Voyager skill-capture loop (experience→skill, no caller today — `AUT-03`/`COG-08`); runtime tool synthesis `synthesize_tool`/ToolMaker gated by the body-change syscall + prove-safe gate (`CON-13`/`EA-06`); prompt/pipeline optimization (GEPA over the replay buffer using Auditor verdicts as the gradient, gate swaps via the body-change `prompt-edit` — `AUT-08`); workflow search (AFlow/MCTS — `AUT-07`); earned/graduated autonomy (N-clean-runs→suggest-AUTO, tripwire auto-demote — `AUT-04`/`MIND-11`); deploy the self-improvement workers (`AUT-12`); the construction-budget governor (proposal-rate cap, dedup, back-pressure — `UU-13`). *We have it:* the metacognition modules, the DGM archive substrate, the GEPA optimizer (no live caller), all orphaned.
- **Invariants:** the offense moat safe ONLY because of the defense moat; the agent can sharpen recall but **never lower the floor** (`UU-14`); deletion HITL.
- **Flag-default-safe:** all optimization is shadow→canary→live behind the empirical-fitness gate; auto-rollback on regression.
- **Verify + rails:** a nightly replay improves a junior's prompt only if it beats the incumbent on the fitness suite; a regression auto-rolls-back; the classifier cannot be optimized downward.
- **BN parity:** `inherits`.

### 6.2 — BN embodiment port (close the sibling loop)
- **Goal:** both estates awaken from the same machine.
- **Build/wire:** port `system-graph`, the body-change syscall, `checkBodyChangeInviolable`, and `blackboard-sota` to BN (BN has actuators but ZERO body-model layer — `EA-10`); lift the Borjie RE residue into a `realEstateOntology` pack (the 0306 built-ins, the projector edges, the KES/rent actuators — wrong for Borjie, exactly BN's seed pack); build the RE junior set per the 19-domain map (`DM-12..15`); port the Borjie-only analytics depth (causal/anomaly/data-protection) BN lacks (`BN-behind`).
- **Invariants:** same architecture, swapped ontology pack — no second architecture.
- **Flag-default-safe:** identical posture; the firewall does not fork.
- **Verify + rails:** BN runs the same self-wiring demo with the RE pack swapped in.

### 6.3 — The eight-axis eval harness (the definition of "done")
- **Goal:** the standing regression suite that closes the loop on every wave.
- **Build/wire:** wire the eight-axis harness as a standing regression: depth across full breadth · target autonomy per task-class · novel within-domain generalization · long reliable horizons · grounded multi-step competence · calibrated metacognition that ACTS · robust+abstaining behavior · no continual-learning regression. A domain-AGI claim is earned only when all eight hold simultaneously.
- **Invariants:** all — the harness asserts every invariant holds under change.
- **Verify + rails:** CI gates merges on the eight-axis suite; a regression on any axis blocks.
- **BN parity:** `same` harness, both packs.

**Wave 6 BLOCKER verdict:** NOT on the first-living-outcome critical path (the demo is a single living loop, not the nightly self-improvement). Required for "gets better every night" + BN parity + the earned "done."

---

## THE FIRST LIVING OUTCOME — the royalty cycle, end-to-end, behind one chat ★

**The demo that proves the awakening:** the organism notices a royalty obligation nobody asked about, thinks before it speaks, builds the organ it lacks under the operator's thumb, prepares and pays the filing, reconciles and closes the loop, and learns — every datum captured, shown live in the chat workspace. This is the `SELF_ORGANIZING_ORG_BRAIN_VISION` §4 self-wiring Tuesday fused with the INV-F DO-not-suggest service outcome.

```
 1. NOTICE   — a standing-drive (Wave 1.3) on the resident situational model (1.2) detects, via the
               estate-wide capture spine (0.2), that a special-mining-licence royalty is due in 14 days
               and the current org has no organ that reconciles tonnage→assay→royalty. [Mind heartbeat]
 2. ORIENT   — the Mind recognises the situation-type (RPD, 1.4); no matching prototype → drops to
               deliberate search (kernel.think, 1.5); honestly calibrated, NOT confidence=1 (0.1).
 3. BUILD    — CREATE fires on impasse: the EDC loop (3.2) induces the `royalty_reconciliation` type;
               the surface-LENS engine (3.4) proposes a `licence_console` surface; the org-design loop
               (3.6) proposes a sub-MD; ALL land through the ONE bodyChange syscall (0.4) as reversible
               data, pass the Conformance Gate (3.7, EN/SW-pure, classified, evidence-trusted, a11y),
               and surface as a GATED proposal the operator approves inline. The sub-MD enters SHADOW.
 4. DRAFT+   — the new organ computes the royalty (metric==lens, 2.4 — the number IS an interactive
    COMPUTE   lens, governed, abstaining if the data is thin); the twin (3.5) simulates the close; the
               Dispatch Kernel (3.5) routes the prep work free-now/fair.
 5. PREPARE  — the Hands (2.2) assemble the COMPLETE ready-to-execute GePG/TRA filing + M-Pesa-TZS
               disbursement package via the reversibility-typed actuator port; dryRun→preview.
 6. ASK      — INV-F prepare→ask: "Royalty filing prepared and ready — TZS X to GePG control number Y.
               Shall I execute, or will you?" Shown inline (Face, 4.3) with the plan card, reasoning
               fold, junior rail, and per-claim evidence chips.
 7. EXECUTE  — operator approves inline → the saga (2.2) confirms THROUGH LedgerService.post() (money
    or HANDOFF rail), files via the TZ e-gov actuator (4.1), captures the receipt; OR the operator takes the
               wheel and the MD STILL tracks to closure.
 8. RECONCILE— the fabric (4.2) confirms closure from the SOURCE-OF-TRUTH row (ledger posting + licence
               row), never a message read; the completion certificate binds every receipt into the
               hash-chained audit (4.1).
 9. CLOSE    — the loop closes; the situational model (1.2) is warmer; the open-loop registry clears.
10. LEARN    — overnight (Wave 6.1, when shipped): the resolution distils into a new RPD prototype (1.4)
               so the impasse never recurs; the sub-MD is kept only if it beats the incumbent on real
               outcomes (empirical-fitness gate, 3.6), else auto-rolled-back to the archived parent.
 ── every datum (turn, induction, proposal, approval, receipt, ledger posting) captured losslessly via
    the outbox co-commit (0.2); the whole trip shown live in the bidirectional chat workspace. ──
```

**Critical-path waves for the first living outcome:** Wave 0 (0.1 honesty, 0.2 capture, 0.3 floor, 0.4 meta-rail) → Wave 1 (1.1/1.2/1.4/1.5 the Mind, 1.3 the drive that notices) → Wave 2 (2.1 arbiter, 2.2 Hands port + saga) → Wave 3 (3.1–3.7 the construction organs + conformance) → Wave 4 (4.1 TZ filing actuator, 4.3 visible-work + inline approve). Waves 5–6 (breadth, media/doc, self-improvement, BN port) deepen the organism but are NOT required to light the first loop.

**The SAME demo runs in BossNyumba** with the domain layer swapped: the royalty cycle becomes the rent-arrears/lease-renewal cycle, `miningOntology`→`realEstateOntology`, the TZ-mining e-gov actuator→the property-transaction actuator — same Mind, same Hands, same Face, same fabric, same capture spine, same rails. Build the connective architecture once in Borjie; both estates awaken from the same machine.

---

## ONE-LINE VERDICT

This roadmap is an **awakening, not a from-scratch build**: six dependency-ordered waves weld the keystones onto the organs we already have — first the floor + honesty + capture + the meta-rail bind (Wave 0), then the resident Mind that everything hangs off (Wave 1), then the keystone joints (arbiter, Hands port, shared-state, metric==lens — Wave 2), then the self-constructing organs + the conformance seam (Wave 3), then the real-world hands + fabric + face (Wave 4), then domain depth + real artifacts (Wave 5), then nightly self-improvement + BN embodiment + the eval harness that defines "done" (Wave 6) — every wave real wired code, flag-default-safe, on the immovable inviolable floor, identical for Borjie and BossNyumba. Weld these and the estate stops being a chatbot with tools and becomes a self-constructing organizational brain: a resident veteran MD that senses the whole estate on its own heartbeat, builds the organs it lacks as reversible data-patches, drives every loop to confirmed closure, acts in the real world through reversibility-typed hands, never forgets a datum, shows its work in a bidirectional workspace, and gets better every night while the mine sleeps.
