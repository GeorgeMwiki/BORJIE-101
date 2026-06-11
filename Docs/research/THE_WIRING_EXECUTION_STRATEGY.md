# THE WIRING EXECUTION STRATEGY — the never-fail execution doctrine for the awakening

**Document:** `Docs/research/THE_WIRING_EXECUTION_STRATEGY.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** the EXECUTION DOCTRINE — no code, no commit. The single operating manual the AI-agent fleet runs the closure by. Synthesizes the five exec dossiers onto the 10-wave closure plan.
**Bar:** SOTA, fiduciary-grade, **0 gaps, zero-bug, never-fail, deployment-ready.** Owner directive: "WIRING STATE OF THE ART — the BEST plan/strategy/approach SO WE NEVER FAIL AT IT."

**Inputs fused here (the WHAT + the five HOWs):**
- `MASTER_WIRING_CLOSURE_PLAN.md` — the WHAT: 7 principles, 43 gaps, 8 blockers, 10 disjoint waves, the parallelism map.
- `exec-safe-change-methodology.md` — the seven-step ritual for changing a live paying system (strangler / branch-by-abstraction / expand-contract / parallel-run / characterization / ports&adapters / idempotent-reversible).
- `exec-progressive-rollout.md` — the guarded-rollout control loop (boot-dark → shadow → canary-1-tenant → ring → wave; metric-gated; auto-revert).
- `exec-money-path-safety.md` — the crash-safe orchestration layer above `LedgerService.post()` (idempotency membrane, outbox+inbox, reversibility-typed saga, DB-constraint + attestation, fail-closed breakers, out-of-process rail).
- `exec-orchestration-done-criteria.md` — the program-management + machine done-proof layer (DAG scheduler, path-ownership lock, invariant gate, adversarial fleet, the Wiring Completeness Gate).

> **One-sentence thesis.** We are not "turning on 43 dark organs" — we are *strangling each stub with a real adapter behind its existing port*, *expand-contract every schema change*, *shadow/dry-run every actuating organ until its match-rate proves it*, *canary every flip on one tenant behind a metric gate that auto-reverts faster than a paying tenant notices*, *adversarially re-verify every fix against fresh HEAD*, and *machine-prove done* via a gate whose green ⇔ zero dark ports — so the money path never leaves `LedgerService.post()`, sovereign stays HITL, no IP leaks, and the binary literally cannot boot with a dark port.

---

## PART 1 — THE DOCTRINE (the 10 non-negotiable execution rules)

These ten rules are binding on every agent, every wave, every commit. A change that violates any rule does not merge. They are ordered; earlier rules constrain later ones.

### RULE 1 — Every wiring change is EXPAND-CONTRACT + FLAG-GATED + VERIFIED-THEN-FLIP. Never big-bang.

No awakening flips a default for all tenants in one step. Every change is the parallel-change three-phase: **expand** (stand the real adapter / add the nullable-defaulted column *beside* the old, both coexist behind the stable port), **migrate** (route a *slice* to the new path, dual-run, prove the match-rate), **contract** (delete the stub + temporary flag on a green trunk). The system is releasable after **every** phase. The flag default is OFF for release-type organs; the code merges dark; the *release* is the runtime flip, independently reversible without a redeploy.
- *Source:* safe-change P3 (expand/contract), P1 (strangler), progressive-rollout 1.1 (deploy≠release).
- *Forbidden:* flipping `BORJIE_MODALITY_ARBITER` / `BORJIE_BODY_CHANGE` / `DURABLE_EXEC_ENABLED` to default-ON for all tenants in one commit. The flag registry rejects a release-flag 0→100% transition by construction.

### RULE 2 — Swap the ADAPTER at the composition root; NEVER edit the caller. The diff is a leaf swap.

Every awakening is "change which concrete adapter the composition root injects into the existing port." The port is the contract; the consumer is untouched; the proven in-repo template is `buildSemanticCachePort` / `buildIntentVerifierPort` at `sovereign.ts:631`. If the port does not yet exist, add the *port type first* (no impl), then both old and new live behind it (branch-by-abstraction). A route handler that grows a deep-path import into a package is a rule violation — the dependency-cruiser orphan baseline (≤16) catches it.
- *Source:* safe-change P6 (ports/adapters/composition root), P2 (branch-by-abstraction), closure Principle 6.
- *Effect:* the change surface is one auditable location; rollback is the inverse one-line selection; the modular-monolith import discipline cannot regress.

### RULE 3 — Every dark capability is SHADOWED, then CANARIED on a tenant slice, with AUTO-ROLLBACK on SLO breach.

No organ touches a paying turn on its first flip. It runs the guarded-rollout loop: **boot-dark** (flag off, boot-smoke passes, every seam fail-safe-off) → **shadow / dry-run** (the real path computes its decision, the safe default is served, zero external effect, match-rate measured vs incumbent) → **canary 1 internal tenant** (reversible effects only, `RolloutGuard` queries the SLI set over a window + min-contexts) → **ring: pilot cohort** → **wave: 50%→100%, STRICT enforcement last**. Any SLI breach at any stage auto-reverts: set flag to previous slice (ultimately OFF) + roll pods; for actuating organs additionally trip `BORJIE_AI_KILL_SWITCH` + cross-portal fanout; write the hash-chained rollback decision-log entry FIRST. Gate on **success-rate AND latency AND cost (budget governor) AND quality (LLM-judge on shadowed traffic)** — never one metric.
- *Source:* progressive-rollout Parts 1.3/1.4/2, safe-change P4 (parallel-run/dark-launch), Part II (staged autonomy).
- *Borjie-floor SLIs are instant-abort (highest precedence):* empty evidence-chain, audit-chain hash-break, cross-tenant leak. A flip that would violate an inviolable auto-reverts mechanically — `CLAUDE.md` is enforced by the guard, not by review.

### RULE 4 — Every port ships with a BOUND-ADAPTER test AND an UNBOUND-FAIL-SAFE test.

A port is not done when the real adapter works. It is done when the real adapter works AND the seam fails *safe* when its flag is off (cache→miss, verifier→permit, composer→fast-path, organ→dark, ledger→refuse-closed). Both tests are mandatory because rollback correctness depends on the off-path being safe, not just the on-path being correct. The OneUptime branch-by-abstraction rule applies: *run the same test suite against both implementations before migration is considered complete.*
- *Source:* safe-change P2/P6, progressive-rollout Part 2 property 2, money-path Part 7 (fail-closed around the ledger, fail-safe degradation on reads).
- *The asymmetry is law:* fail-safe means **fail-OPEN** for read/enrichment seams (degrade to incumbent) and **fail-CLOSED** for the ledger and every sovereign rail (refuse the money action; never "move money without posting").

### RULE 5 — The money path goes through OUTBOX + SAGA + IDEMPOTENCY, or it does not ship.

Any change that touches money/licence/deletion must, by type and by construction: (a) enter through the `Idempotency-Key` gateway membrane (header required, body-hash-pinned, 409 on reuse-with-different-body); (b) co-commit its outbox event inside the effect transaction and dedup on the inbox `message_id`; (c) execute as a `PortAction[]` saga where `reversibility / idempotencyKey / dryRun / confirm / compensate` live *in the type*, so `irreversible ⇒ requiresApproval ⇒ four-eye` is uncompilable to bypass; (d) checkpoint co-committed with each DB-bound step's effect (DBOS invariant) so a crash resumes exactly-once; (e) pass the DB-layer balanced/no-negative constraint and survive the continuous signed attestation. A money flow not on this substrate is not mergeable.
- *Source:* money-path Parts 1–8, closure Principle 3.
- *Non-negotiable:* the ledger leg is always `LedgerService.post()`; external steps re-drive under the same idempotency key (the provider dedups); irreversible steps gate to four-eye and resume from the gated step on APPROVE.

### RULE 6 — PER-FINDING RE-VERIFY against current HEAD BEFORE fixing. A finding may already be stale.

Before an agent implements a fix, it re-derives the *evidence of the gap* against current `HEAD`: re-grep the dark marker, re-confirm the port is unbound, re-confirm the route is unmounted. If the evidence is gone (a sibling wave already closed it), the agent **dismisses** the finding — it does NOT produce a spurious diff, which would itself be a collision and regression risk. The world moves under the agent; a fix verified against a stale HEAD is a defect.
- *Source:* orchestration Part 2.4, Part 4 (generation-verification against fresh state).

### RULE 7 — CLEAN-TREE + EXPLICIT-PATH commits. Never edit a file two waves touch concurrently. One variable per slice.

One wave = one branch = one worktree; no two agents in the same wave's branch concurrently. A branch's diff may touch only files in its wave's owned glob set (`wave-ownership.json`) plus any currently-held shared lease. The three known hotspots — `services/api-gateway/src/composition/sovereign.ts`, `composition/brain-tools/index.ts`, `services/api-gateway/src/index.ts` mount block — are **serialized-shared**: exactly one wave holds the write-lease at a time; others rebase after. A write to an unowned/un-leased path is a HARD CI reject. And never combine variables in one slice: **migration lands and bakes → adapter flips → arbiter routes**, never bundled, so root cause stays possible.
- *Source:* orchestration Part 2.2 (path-ownership lock), safe-change Part III ("never combine variables in one slice"), commit-granularity = one verified finding.

### RULE 8 — CHARACTERIZE before you touch. Golden-master the current stub/null/deny contract FIRST.

Before modifying any stub, null-wire, deny-stub, or destructive path, pin its *current* behavior as a golden master: the exact status code, audit-row shape, four-eye envelope, egress projection shape, error envelope the system already depends on (`NotYetWiredError` shape, the `BORJIE_BODY_CHANGE`-off deny payload, the `ON CONFLICT DO UPDATE` row state). The real adapter must reproduce the depended-on *contract*; divergence is a bug, not a feature. Mask volatile fields (timestamps, hash digests, model nondeterminism). Host these in `eval-orchestrator-scenarios.yml` / `kernel-eval.yml` / `trajectory-eval.yml`.
- *Source:* safe-change P5 (characterization/golden-master).
- *Effect:* the no-IP-leak, audit-chain-append-only, and sovereign-HITL invariants cannot be silently regressed because their current shape is frozen before the change.

### RULE 9 — ADVERSARIAL-VERIFY every wave before commit. The verifier is INDEPENDENT of the generator.

Per finding, three roles, never one: **Generator** implements + runs touched-package typecheck/tests + commits an explicit-path diff. **Verifier** (different prompt/model, does NOT read the generator's reasoning) runs the **reachability proof** — a real request hits the brain tool / the route returns a non-stub body / the SSE event renders; if it cannot *reach* the organ, the fix is not done regardless of green typecheck. **Adversary** runs the **flag-ON adversarial assertion** (with the wiring flag ON, the prohibited money/licence/deletion/body-change/egress action must STILL be denied or HITL'd) + the path-ownership check (did the diff touch an unowned file?). Only a fix surviving all three enters the merge queue. This defeats documented LLM self-review leniency bias and correlated blind spots.
- *Source:* orchestration Part 4 (roles, adversarial verify), Part 3.2 (flag-ON adversarial), money-path (four-eye-by-type).

### RULE 10 — STEP-7 CONTRACT is mandatory: delete the stub + temporary flag on a green trunk. Only kill-switches are permanent.

An awakening is not complete until the old stub and the temporary release flag are deleted, after ≥1 release cycle at 100% with no divergence. A stale flag is two untested code paths; flag-debt is the dual-path ambiguity that produced the 43-gap situation in the first place. A CI gate fails on a *release* flag at 100% in prod for >30 days without code cleanup. The ONLY permanent flags are kill-switches (fail-closed ops controls) and security-floor flags (default-on).
- *Source:* safe-change Part III rule 2 + Part V #5, progressive-rollout 1.2 (flag hygiene closes the loop).

---

## PART 2 — THE PER-WAVE SAFETY PROFILE

For each of the 10 closure waves: its specific risk, the exact rail (flag + rollout mechanism + verification gate + rollback trigger). The rollout mechanism is chosen by **reversibility**: the less reversible the effect, the smaller the first slice and the more it leans shadow/dry-run-first.

### WAVE 1 — THE CONDUCTOR (OK-1, OK-2, OK-3, OK-7 blockers + OK-4) ★ first, alone
- **Risk:** flipping the arbiter + body-change rail changes the default `/ask` topology and enables capability growth; the loop-runner can blow the token budget; this is the most-coupled region (`brain-kernel-wiring.ts`, `orchestrator-bindings.ts`, `sovereign.ts`, `main-loop.ts`, new `control-shell-wiring.ts`).
- **Flags:** `BORJIE_MODALITY_ARBITER`, `BORJIE_BODY_CHANGE` (release, default-OFF); loop-runner behind the arbiter branch.
- **Mechanism:** SHADOW-first for arbiter (log topology decision, serve fall-closed default) and control-shell (`pickNext` computes, does not dispatch); loop-runner canaries budget-envelope-gated; body-change proposes-without-commit first (surface-persist edge before schema-synthesis); EstateMind-actuate (OK-4) is the graduated-trust four-ring sequence — emit `OrchestratorRequest` IN ADDITION TO the nudge, actuate edge last, sovereign HITL forever.
- **Verification gate:** shadow match-rate ≥0.999 vs the safe default; cost/latency deltas within thresholds (+40% p99 / +5% refusal abort); every mutation routes through `authorizeBodyChange`; WCG sub-assertions B/E/F green for OK-1/2/3/7/4.
- **Rollback trigger:** match-rate dip, cost spike past the budget envelope, any Borjie-floor SLI (empty-evidence / audit-break / cross-tenant-leak) → revert flag to previous slice + per-request override + AI-kill-switch fanout for the actuate edge.
- **Sequencing:** merges ALONE through the queue (Rank 0). Everything else waits on it.

### WAVE 2 — DURABILITY + ACTUATOR SAGA (OK-5, OK-6 blockers)
- **Risk:** the durable runner + saga executor become the default money/agency backbone; OK-5 is part build-gap (no `*saga*` file exists; compensation is out-of-scope in `durable-runner.ts`).
- **Flags:** `DURABLE_EXEC_ENABLED` (NEEDS-PREREQ — flip only after the executor binding exists).
- **Mechanism:** **dry-run the saga (`dryRun:true`) at 100%** first — walk `PortAction[]`, run zero external effect, compare intended actions to the rule-based decision; prove crash-resume parity vs the legacy sync executor; then 1 tenant; enable irreversible steps LAST (four-eye type-enforced). Build on the DBOS invariant (checkpoint co-committed with each DB-bound step's effect).
- **Verification gate:** forced mid-saga crash resumes with the books balanced; per-step idempotency keys (`parentKey:stepName`); compensations run in reverse on failure; `dryRun` `PortAction[]` matches rule-based decision; the new saga-compensation test + four-eye-gated-resume test green.
- **Rollback trigger:** any double-post / lost-step / unbalanced attestation → fail-closed (refuse the money action), revert `DURABLE_EXEC_ENABLED`.
- **Sequencing:** durable-runner instantiation + saga journal are parallel to Wave 1; the *dispatcher binding* into `brain-kernel-wiring.ts` STACKS on Wave 1 (lands after it merges).

### WAVE 3 — DARK BACKEND ANALYTICS ORGANS (anomaly / causal / belief / reflexion-sleep / runDebate / scientific-discovery)
- **Risk:** real compute added to the proactive tick + nightly sleep; a slow causal job can stall a turn; the sidecar is an infra deploy.
- **Flags:** one env flag + budget envelope per port; `runDebate` via `?includeDebate=true` per-request canary handle.
- **Mechanism:** each port behind the `buildSemanticCachePort` template; SHADOW on the proactive tick (compute, do not surface) → canary → on.
- **Verification gate:** reachability test (a request hits the brain tool); budget envelope holds (no turn stall); `kernel-eval` / `eval-orchestrator-scenarios` green; debate trace streams through the Wave-5 egress projection.
- **Rollback trigger:** turn latency past +40%, cost past budget → disable the port flag.
- **Sequencing:** the `sovereign.ts:631` port block + `brain-tools/index.ts` registrations are a SHARED-LEASE on Wave-1 files — land after Wave 1 releases the lease.

### WAVE 4 — DARK DATA-LIFECYCLE + KG-TEMPORAL (prov-o/bi-temporal KG · retention/rtbf · CRDT portal_tabs)
- **Risk:** rewrites the hottest KG ingest path (invalidate+insert = two writes vs one upsert); the RTBF de-dup is a DELETION path (INV-E, HITL forever); concurrent surface edits lose updates.
- **Flags:** a cutover flag on the KG temporal path; CAS column behind expand-contract.
- **Mechanism:** **expand-contract** — add valid-time/`invalidatedAt` columns (a NEW forward migration; they already exist in `temporal-entity-graph.schema.ts`) → dual-path the upsert (overwrite for old readers AND invalidate+insert for new) behind a flag → drop the destructive overwrite once `/kg/{id}/history` and all readers use valid-time. portal_tabs: add a real `row_version` column → CAS on it → remove the unguarded `save()`.
- **Verification gate:** invalidate+insert benched vs single upsert; `/history?as-of=` reads valid-time; backfill clean (`migration-safety-check.yml` — nullable/defaulted first); concurrent-write test returns conflict not lost-update; **product sign-off before deleting EITHER RTBF implementation.**
- **Rollback trigger:** ingest latency regression past threshold; any backfill NULL hazard.
- **Sequencing:** fully disjoint (own files); parallel to all.

### WAVE 5 — THE TWO MEMBRANES (OK-8a egress projection · OK-8b out-of-process rail)
- **Risk:** OK-8b is the heaviest structural change (process boundary + IPC) and sits ACROSS the money/licence/deletion path; OK-8a gates whether artifact frames can leak mechanic fields.
- **Flags:** `BORJIE_EGRESS_FILTER` is a **FLOOR flag — default-ON, fail-closed** (do NOT canary a security floor; ship it on, canary the thing it protects).
- **Mechanism:** OK-8a — wrap `projectArtifactToUiPart` + any Live re-query callback with the typed `StatusSpan/Output/Evidence` allow-list before serialization. OK-8b — phase it: first route gate calls through a single in-process chokepoint module, then lift that module out-of-process (sidecar/subprocess); every external actuator call writes the hash-chained decision-log entry FIRST, then permits the effect; unreachable from the agent loop even under prompt injection.
- **Verification gate:** egress allow-list rejects agent/tool names, arbiter rationale, CoT on EVERY client emission point; the rail writes decision-before-effect; kill-switch denies new money/actuator calls fleet-wide fail-closed.
- **Rollback trigger:** any cross-tenant emission or IP-leak in the projection (instant-abort SLI).
- **Sequencing:** OK-8a (egress) must be GREEN before Wave 8 (frontend artifacts) is enabled for any PAYING tenant. This is the IP-leak ordering rail.

### WAVE 6 — UNMOUNTED ROUTERS + NULL-WIRED EXECUTORS (consolidationRunner BLOCKER · jurisdiction · modules · parity-rejudge)
- **Risk:** the modules router needs a NEW forward migration + store (heaviest item; possibly should be DELETED if module-spawning is not a launch capability); the jurisdiction router is on the admin four-eye path.
- **Flags:** none for the null-wire fix (forward the existing `createConsolidationWorkerAdapter`); RBAC + four-eye for jurisdiction.
- **Mechanism:** ports/adapters for consolidationRunner (golden-master the `NotYetWiredError` contract → real run returns a durable result); strangler-mount the routers behind RBAC; modules = expand (migration first, or delete on product decision).
- **Verification gate:** four-eye PROPOSE→APPROVE integration test green BEFORE the jurisdiction router mounts; route⇄manifest parity (assertion C); product sign-off on modules wire-vs-delete.
- **Rollback trigger:** any four-eye bypass; any unmounted-route parity failure.
- **Sequencing:** SHARED-LEASE on `services/api-gateway/src/index.ts` mount block; coordinate with Wave 1 only if both touch `index.ts` imports.

### WAVE 7 — DARK CONNECTORS + E-SIGNATURE (GePG · e-sign)
- **Risk:** both write to external regulators / signature providers (irreversible filings); the e-sig de-dup deletes a real package stack.
- **Flags:** behind the actuator saga; irreversible = four-eye by type.
- **Mechanism:** branch-by-abstraction (pick ONE e-sig adapter — recommend `document-studio` Dropbox-Sign — delete the duplicate `document-ai` stack after confirming no other consumer); `FILE_GEPG` / `SEND_SIGNATURE_REQUEST` step handlers execute via the Wave-2 reversibility-typed saga with an action-audit trail; `SIGN_COMPLETE` webhook receiver marks the step COMPLETED.
- **Verification gate:** external filings execute via the W2 saga (irreversible ⇒ four-eye ⇒ requires `confirm` token); de-dup confirmed no other consumer; webhook receiver is idempotent.
- **Rollback trigger:** any filing without a four-eye token; any double-send under retry.
- **Sequencing:** STACKS on Wave 2 (the step handlers bind into the saga executor).

### WAVE 8 — THE FRONTEND SEAM + ARTIFACT-RENDER (one SSE seam, then artifact pages)
- **Risk:** the only surface a paying user *sees*; artifact HTML wired before its egress membrane is a live IP-leak.
- **Flags:** standard release-flag canary per surface.
- **Mechanism:** add `modality-proposal`/`document`/`artifact` events to the ONE `tab-sse-parser.ts` seam + a resolver hook; mount the orphan `ArtifactRenderer.tsx`; all HTML DOMPurify-wrapped.
- **Verification gate:** the SSE event renders (reachability proof E); artifact HTML passes the Wave-5 OK-8a egress projection.
- **Rollback trigger:** any mechanic-field leak in an artifact frame; render regression.
- **Sequencing:** enabled for a PAYING tenant ONLY after Wave 5 (OK-8a) is green. Frontend-LAST.

### WAVE 9 — THE REMAINING ADMIN/OWNER SURFACES (thin pages over mounted routes)
- **Risk:** low — thin CRUD over already-mounted, already-tested routes; the only gates are RBAC (SUPER_ADMIN for persona-registry) and four-eye (md-agentic high-stakes commits).
- **Flags:** standard release-flag canary per surface; ship read-first.
- **Mechanism:** new pages only; respect the Wave-2 durable saga for commit/trigger semantics.
- **Verification gate:** RBAC enforced; four-eye on md-agentic high-stakes; reachability proof per page.
- **Rollback trigger:** any RBAC bypass.
- **Sequencing:** parallel to Wave 8 (different page files) and all backend waves.

### WAVE 10 — THE SOTA BUILD-GAP UPGRADES (topology selection · cost-penalized orchestrator · render-decision arbiter · connection-as-DATA · ROMA · artifact-engine)
- **Risk:** genuine build-then-wire; each carries real new code; the connection-graph optimizer mutates the body.
- **Flags:** each behind a flag; topology-optimizer proposes each edge mutation as a reversible `bodyChange` through the Wave-1 meta-rail chokepoint (no private back door).
- **Mechanism:** **shadow-eval + LLM-judge** for the cost-penalized model routing + topology selection — shadow the new RouteLLM/topology decision, replay through `trajectory-eval`, promote only on quality-non-regression AND cost/latency win; ROMA nodes are durable checkpoints (depends on Wave 2); artifact-engine Live binding re-queries through the Wave-5 egress guard.
- **Verification gate:** LLM-judge non-regression on shadowed traffic; `trajectory-eval` / `lats-search-eval` green; each edge mutation beats the incumbent on 7/28/91-day outcomes.
- **Rollback trigger:** quality regression in the LLM-judge; cost/latency loss.
- **Sequencing:** LAST. STACKS on {Wave 1, Wave 2, Wave 5}.

---

## PART 3 — THE GATE STACK (ordered CI/verification gates a wave must pass to merge)

A wave branch must clear these gates **in order**; a failure halts the train at that gate. This is the per-wave pipeline that feeds the merge queue.

1. **TYPECHECK** — touched-package `tsc` green (turbo, no stale-cache false-green; clean build). Catches nothing semantic but is the cheap floor.
2. **CONTRACT (golden-master)** — the characterization test from RULE 8: the real adapter reproduces the depended-on contract shape (status / audit-row / four-eye envelope / egress projection / error envelope), volatile fields masked. *Catches:* a silent change to a depended-on behavior.
3. **CHARACTERIZATION / SHADOW MATCH-RATE** — for an actuating/topology organ, the shadow run's match-rate vs the incumbent ≥0.999 over the window with cost/latency deltas inside thresholds. *Catches:* the new path disagreeing with the safe default before any user sees it.
4. **PROPERTY / INVARIANT** — `pnpm test:invariants` (money / RLS-FORCE / audit-chain-append / predictions-APPEND / sovereign-HITL / no-IP-leak) green, PLUS the **flag-ON adversarial assertion** for this wave's flag (the prohibited action is STILL denied/HITL'd with the flag ON). *Catches:* a flipped flag quietly loosening a rail.
5. **ADVERSARIAL (fleet)** — the independent Verifier's reachability proof + the Adversary's path-ownership check + flag-ON probe (RULE 9). *Catches:* a no-op fix that typechecks, leniency-biased self-approval, an unowned-file write.
6. **MIGRATION** — `migration-apply-check` on a fresh Postgres + `migration-safety-check` (NOT NULL backfill-hazard); expand phase adds nullable/defaulted columns only; no edit to a shipped migration. *Catches:* an immutable-migration violation, a backfill hazard.
7. **E2E-JOURNEY (reachability)** — the `@wiring:<gap-id>`-tagged test makes a REAL request that exercises the organ on a live path and asserts a non-stub effect (tool runs / route returns real body / SSE event renders). *Catches:* "wired in code, dark at runtime."
8. **CANARY-SLO** — after merge-with-flag-OFF, the `RolloutGuard` ramps the flag per-tenant; every SLI green over the window + min-contexts before promotion; auto-revert on first breach. *Catches:* a real-traffic regression a paying tenant would otherwise notice.

A wave enters the merge queue only after gates 1–7 are green on its branch. Gate 8 runs post-merge as the flag ramps and is the live sentinel (a dip halts the merge train via the DORA change-failure-rate gate).

---

## PART 4 — THE SEQUENCE (dependency-ordered execution order)

The program is a DAG encoded as `wiring-dag.json`; the merge gate reads it (Kahn topological sort with rank batching). Blockers and the money path go first with the most care and the smallest blast radius; the frontend goes last, gated behind its egress membrane.

**RANK 0 — Wave 1 ALONE (the conductor).**
The most-coupled region; the closure plan mandates "first and alone." Merge before any other branch enters the train. Blocker burn-down inside the wave: **OK-2 (loop-runner) → OK-1 (arbiter) → OK-7 (body-change) → OK-3 (control-shell)**, then OK-4 (EstateMind actuate edge, graduated-trust last).

**RANK 1 — Waves 2, 3, 4, 5, 6, 8, 9 IN PARALLEL (separate branches/worktrees).**
Disjoint file sets → the stack-aware queue interleaves them freely. Within Rank 1, risk-order the merges:
- *Money/licence/deletion blockers first, most care:* Wave 2 (durable/saga, dry-run-first) → Wave 6 (consolidationRunner null-wire + jurisdiction four-eye).
- *Membrane next (tightens, leads the frontend):* Wave 5 (OK-8a egress default-ON fail-closed; OK-8b out-of-process rail).
- *Dark organs off the default turn:* Waves 3 (analytics ports), 4 (KG temporal / data-lifecycle).
- *Frontend (lowest build-risk, gated):* Waves 8, 9.

**RANK 2 — Waves 7 and 10 STACKED on their edges.**
- Wave 7 (GePG / e-sig step handlers) STACKS on Wave 2 (binds into the saga executor).
- Wave 10 (SOTA build-gaps) STACKS on {Wave 1, Wave 2, Wave 5} — lands LAST, behind flags.

**Dependency edges the queue enforces (child refuses to merge until parent is green-in-trunk):**
- Wave 2.dispatcher-binding → after Wave 1.
- Wave 3.sovereign-port-block + brain-tools registrations → after Wave 1 (SHARED-LEASE on `sovereign.ts` / `brain-tools/index.ts`).
- Wave 6.mount-block → SHARED-LEASE on `index.ts` (coordinate with Wave 1 imports only).
- Wave 7 → after Wave 2.
- Wave 8-paying-enabled → after Wave 5 (OK-8a). **IP-leak rail.**
- Wave 10 → after {1, 2, 5}.

---

## PART 5 — DONE-CRITERIA (machine-checkable; "0 gaps, never fail" is a CI fact, not a vibe)

Done is proven by the **Wiring Completeness Gate (WCG)** — one blocking CI job (PR-to-main + nightly) whose green ⇔ zero dark ports / zero unmounted routes / zero stub-on-live-path / every invariant holds. Six assertions, all must pass:

- **A · NO-STUB-ON-LIVE-PATH** — `scripts/audit-not-yet-wired.mjs` `NOT_YET_WIRED` count == 0 (already 0); extend to `NotYetWiredError` / `LATER(wire)` call-sites reachable from a route/brain-tool/cron == 0 (today 18 markers → burn to 0); a deny-stub bound where a real port is expected (body-change rail, GePG, e-sig) → FAIL.
- **B · NO-DARK-PORT** — boot the gateway in a test harness with ALL wiring flags ON; run `assertFullyWired()`: every declared kernel port has a non-stub binding, every brain tool resolves, every EstateMind/control-shell organ has a runtime caller → any unbound/stub == FAIL. **The binary fails CLOSED — it will not boot dark.** This is the strongest single control: F4 (false done) is impossible if the process refuses to start with a dark port.
- **C · NO-UNMOUNTED-ROUTE** — enumerate every `*.hono.ts` router factory under `routes/**`; assert each is `api.route(...)`-mounted in `index.ts` AND present in `src/openapi/manifests.ts`; `delta(declared, mounted) == ∅` (catches `/modules`, `/admin/tenants/:id/jurisdiction`); exceptions are explicitly product-deferred with an owner sign-off row.
- **D · NO-ORPHAN-REGRESSION** — `depcruise` no-orphans count ≤ baseline (16); no new layer/cycle violation; `knip` no new unused-files / unlisted-deps.
- **E · REACHABILITY-PROOF** — each of the 43 gaps maps to a `@wiring:<gap-id>`-tagged test that makes a REAL request exercising the organ on a live path and asserts a non-stub effect; `coverage(gaps_with_passing_reachability_test) == 43/43`.
- **F · INVARIANT-INTACT** — `pnpm test:invariants` green (money/RLS/audit-chain/append/HITL/no-IP-leak); flag-ON adversarial assertions green (prohibited action still denied with each blocker flag ON); the four brain evals green (`kernel-eval`, `eval-orchestrator-scenarios`, `lats-search-eval`, `trajectory-eval`).

```
WCG PASSES ⇔ A ∧ B ∧ C ∧ D ∧ E ∧ F
DONE       ⇔ WCG green on main
           ∧ gaps_open == 0 on the burndown
           ∧ assertFullyWired() == pass at boot
           ∧ a hash-chained WIRING_COMPLETE attestation present in the audit chain
             (commit SHA + 43 gap-IDs each with its passing reachability-test name
              + marker/orphan/invariant counts) — tamper-evident, append-only.
```

**Live observability while the program runs:** a `wiring-coverage` dashboard (Grafana over the WCG oracle) shows `gaps_open` burndown sliced by wave/severity, a port-green matrix (one cell per kernel port / brain tool / mounted route / SSE event), the marker trend (`NotYetWiredError`/`LATER(wire)` 18→0), the orphan trend (≤16), and the Invariant-Suite pass-rate per merge as the change-failure-rate sentinel that halts the train on any dip.

**Named program artifacts the fleet creates (no code here; these are the deliverables):**
`wiring-dag.json` · `wave-ownership.json` · `.github/workflows/wiring-completeness-gate.yml` · `scripts/assert-fully-wired.mjs` + the `assertFullyWired()` boot guard · `scripts/route-manifest-parity.mjs` · extended `scripts/audit-not-yet-wired.mjs` · `pnpm test:invariants` · the `wiring-coverage` dashboard · the 43→`@wiring:<gap-id>` test-tag map · `flag_registry` (type/owner/retire-by) + the `RolloutGuard` module + the shadow harness + the kill-switch gameday.

---

## PART 6 — THE FIVE THINGS THAT WOULD MAKE US FAIL, AND THE RAIL THAT FORBIDS EACH

| If we fail, it will be because… | The rail that makes it impossible |
|---|---|
| A big-bang flag flip on the default `/ask` turn skips shadow + canary | RULE 1/3 + the flag registry rejecting a release-flag 0→100% transition |
| Two agents quietly clobber `sovereign.ts` / `brain-tools/index.ts` / `index.ts` | RULE 7 path-ownership lock + shared-lease serialization (unowned write = hard CI reject) |
| A fix lands before its dependency and silently no-ops | The topological merge gate (`wiring-dag.json`) + reachability proof E (a no-op fails E) |
| A flipped blocker flag quietly loosens a sovereign rail | Gate-4 invariant suite + the flag-ON adversarial assertion per blocker |
| The fleet's verifier rubber-stamps a fix (leniency bias) | RULE 9 independent adversarial verifier (different model, job is to find the gap still open) |
| Money double-posts / loses an event / fires irreversibly without four-eye | RULE 5: outbox+inbox co-commit, DBOS checkpoint⊆effect-tx, `irreversible⇒four-eye` type-enforced |
| We declare "0 gaps" while a dark port remains | WCG + `assertFullyWired()` boot guard — the binary won't boot dark; DONE is a hash-chained attestation |
| An artifact frame leaks agent/tool names / CoT to a paying tenant | The IP-leak ordering rail: Wave 8 enabled only after Wave 5 (OK-8a) is green |

---

## PART 7 — THE ONE-PARAGRAPH VERDICT

We never fail at the wiring because no awakening improvises: every one runs the same ritual — characterize the current contract, add the real adapter behind its existing port at the composition root, expand-contract any schema, shadow/dry-run until the match-rate proves it, canary one internal tenant behind a metric gate that auto-reverts faster than a paying tenant notices, adversarially re-verify against fresh HEAD, then contract the stub away on a green trunk. The money path is mergeable only on the outbox+inbox+reversibility-typed-saga substrate where `irreversible ⇒ four-eye` is type-enforced and a crash resumes exactly-once. The waves run in dependency order — the conductor alone first, the durability/money blockers next with the smallest blast radius, the membranes before the frontend, the build-gaps last — each gated through the eight-gate stack and merged through a path-locked, topology-aware, adversarially-verified queue. And done is not a claim: it is the Wiring Completeness Gate green on main, `gaps_open == 0`, a binary that refuses to boot with a dark port, and a hash-chained `WIRING_COMPLETE` attestation in the audit chain. That is the only definition of "0 gaps, never fail" the owner directive accepts — and it is machine-checkable, not vibes.
