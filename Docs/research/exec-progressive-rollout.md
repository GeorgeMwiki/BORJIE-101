# EXEC DOSSIER — Progressive-Delivery / Verified-Rollout: how Borjie flips its built-but-dark organs so a failure is caught + auto-reverted before it reaches a paying tenant

**Document:** `Docs/research/exec-progressive-rollout.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Lane:** progressive-delivery-verified-rollout (the SOTA of rolling out a change so a failure is caught + auto-reverted before it hits users)
**Posture:** READ-ONLY research synthesis. No code, no commit. Companion to `MASTER_WIRING_CLOSURE_PLAN.md` (the 10 waves), `FLAG_ACTIVATION_PLAN.md` (the flip classification), and `scripts/deploy/CANARY_RUNBOOK.md` (the existing 5-step seam runbook).
**Mandate floor (non-negotiable, from `CLAUDE.md`):** money path ONLY through `LedgerService.post()`; RLS FORCE + canonical GUC; Supabase-JWT canonical; kill-switch fail-closed; webhooks at-least-once + idempotent; AI audit chain hash-chained append-only; predictions APPEND never replace; migrations immutable; sovereign (money/licence/deletion/four-eye) stays HITL; no IP leak to any client; multi-tenant isolation; deployment-ready / zero-bug bar.

> **One-sentence thesis.** Borjie already owns 80% of the verified-rollout substrate (a multi-adapter feature-flag port, a fail-closed kill-switch valve, an advisory→strict dry-run runbook, an LLM budget governor, a canary-CI pattern, blue/green CD). The gap is that this substrate is **operator-procedural and CI-only**, not **metric-gated and auto-reverting**. The SOTA move is to bind our existing flags + budget governor + OTel plane into a *guarded-rollout control loop* — default-off → shadow → canary-on-a-tenant-slice → SLO/error-budget gate → auto-rollback — and run **every** built-but-dark organ (modality-arbiter, body-change, durable-exec, EstateMind, the saga actuator) through it. We never fail at wiring because **no dark organ is ever flipped globally; it is flipped on a slice behind a metric gate that reverts it faster than a human notices.**

---

## PART 0 — WHAT WE ALREADY HAVE (the substrate to wire, verified this pass)

| Asset | Path | What it gives us | What it lacks for SOTA |
|---|---|---|---|
| **Feature-flag port (multi-adapter)** | `packages/feature-flags-adapter/src/{index,feature-flags,unleash-adapter,growthbook-adapter,db-adapter,in-memory-adapter}.ts` | One `FeatureFlagsPort` over Unleash + GrowthBook + DB + in-memory; per-tenant + cohort + sticky-bucket (`FlagContext{tenantId,userId,attributes}`); "staged rollout per tenant — no more all-or-nothing flips" (barrel comment). | No metric-gated auto-flip; rollout % is operator-set, not SLO-driven. |
| **Pilot kill-switch (3-layer precedence)** | `packages/feature-flags-adapter/src/pilot-kill-switch.ts` | `PILOT_KILL_SWITCH_OPEN` (emergency, overrides all) > DB `pilot_enabled` (per-tenant/cohort) > `PILOT_ENABLED` env (dev). Default-OFF; bilingual 503. | Manual trip only; no automatic trip on metric breach. |
| **Sovereign kill-switch valve (fail-closed)** | `services/api-gateway/src/middleware/kill-switch.middleware.ts` | 8 irreversible-op flags (eviction/payment-reversal/account-deletion/refund/data-export/monthly-close-reverse/sublease-cancel/sovereign-ledger-override); **lookup-error fails CLOSED in prod** (`:298`), audit-before-response. | This is a HALT lever (operator flips ON to stop), not a progressive-rollout lever — correct by design; keep separate. |
| **Cross-portal kill-switch fanout** | `services/api-gateway/src/composition/cross-portal-killswitch-fanout.ts` | One trip propagates across owner/admin/workforce/buyer surfaces. | Fanout is the blast-radius *containment* primitive an auto-rollback should call. |
| **Verified-then-flip runbook (advisory→strict)** | `scripts/deploy/CANARY_RUNBOOK.md` | The exact SOTA pattern already written: Step 0 lights-off boot proof → semantic-cache → intent-verifier **ADVISORY (dry-run, would-block logged, nothing blocked)** → composer → intent-verifier **STRICT**; every seam fail-safe when off; rollback = unset + roll pods, no redeploy. | Gates are human-read ("≥30 min healthy"), not machine-asserted against a metric provider. |
| **LLM budget governor** | `packages/llm-budget-governor/src/{governor,postgres-store,admin-overrides}.ts` + `loop-quality-gates/src/gates/budget-gate.ts` + `media-engine/src/cost/cost-guard.ts` | Per-tenant cost envelope + admin overrides; the natural **cost guardrail** for a canary. | Not yet bound as a *rollout abort signal* (cost spike → revert). |
| **Flip classification** | `Docs/research/FLAG_ACTIVATION_PLAN.md` | Every flag bucketed: FLIP-NOW / NEEDS-PREREQ / MUST-STAY-GATED; security floors (egress/input-guard/PII) confirmed default-ON fail-closed; sovereign `killswitch_*` confirmed never-auto-flip. | The "how to flip safely" loop (this dossier) was the missing companion. |
| **Canary CI pattern** | `.github/workflows/reflexion-sleep-canary.yml` | A `.canary.json` invariant-assert pattern (pass-by-pass, exit-1 on fail) already in CI. | Pre-merge synthetic only; not a live-traffic canary gate. |
| **Blue/green + zero-downtime CD** | `.github/workflows/cd-production.yml` (blue/green + rollback job), `k8s/helm/borjie/templates/api-gateway.deployment.yaml` (`RollingUpdate maxSurge:25% maxUnavailable:0`) | Instant-cutover infra + a rollback job already exist. | Cutover is all-or-nothing per release; no per-flag traffic weighting or analysis-driven promotion. |
| **OTel GenAI plane (two-plane membrane)** | per `MASTER_WIRING_CLOSURE_PLAN.md` Principle 5 + `egress-filter-wiring.ts` | Full internal trace + typed client projection. | The trace is the metric source a guarded rollout must query — not yet shaped into rollout SLIs. |

**The diagnosis in one line:** we have all the *valves* (flags, kill-switch, budget, blue/green) and all the *evidence* (OTel, audit chain), but no **closed loop** between evidence and valve. SOTA progressive delivery is exactly that loop. This dossier specifies it.

---

## PART 1 — FINDING SURVEY: THE 2026 SOTA OF VERIFIED ROLLOUT (cited)

### 1.1 Feature flags are the safety substrate, not a deploy trick

The decisive 2026 shift is **decoupling deploy from release**: the binary ships dark (deployed, all flags off, boot proven), then *release* is a runtime flag flip that is independently reversible without a redeploy. OpenFeature (CNCF Incubating since Nov-2023) is now the vendor-neutral standard so the flip-logic is portable across Unleash / GrowthBook / LaunchDarkly / Flagsmith / Cloudflare Flagship without code change ([OpenFeature CNCF](https://www.cncf.io/projects/openfeature/), [Cloudflare Flagship on OpenFeature, InfoQ May-2026](https://www.infoq.com/news/2026/05/cloudflare-flagship-openfeature/)). The mature taxonomy distinguishes **flag types by lifetime and risk**: *release* (short-lived, ~40-day expected life), *experiment*, *operational/ops* (longer-lived), *kill-switch* (permanent), *permission* — each with different cleanup expectations ([Unleash flag types via Flagsmith top-7 2026](https://www.flagsmith.com/blog/top-7-feature-flag-tools), [Octopus 12 Commandments](https://octopus.com/devops/feature-flags/feature-flag-best-practices/)). The hard rule on default-state: a *release* flag is **default-off, verified, then flipped on**; a *kill-switch* flag is **default-pass-through, flipped on to HALT, fail-closed on lookup error**. Conflating the two is the #1 flag anti-pattern.

**Borjie application.** Tag every Borjie flag with one of these five types in a registry (we already have `growthbook-adapter`/`unleash-adapter` which natively support flag types). The closure-plan organs (`BORJIE_MODALITY_ARBITER`, `BORJIE_BODY_CHANGE`, `DURABLE_EXEC_ENABLED`, `BORJIE_ESTATE_MIND`, the new control-shell/saga configs) are **release flags → default-off → verified → flipped**. The eight `killswitch_*` flags + `PILOT_KILL_SWITCH_OPEN` + `BORJIE_AI_KILL_SWITCH` are **kill-switch flags → fail-closed, operator-only, never auto-flipped** (already correct per `FLAG_ACTIVATION_PLAN.md` Bucket 3). The security floors (`BORJIE_EGRESS_FILTER`, `BORJIE_INPUT_CONTAINMENT`, `BORJIE_PII_EXTENDED`) are **permission/floor flags → default-on, flip-off only for incident rollback.**

**Safety rail this adds:** *No release flag can be flipped on globally.* By construction, a release-type flag must pass through the guarded-rollout loop (Part 2) — shadow → slice → gate → promote. The registry rejects a "flip release flag to 100% in one step" as an invalid transition.

### 1.2 Flag hygiene / debt is a first-class risk for a fiduciary system

Each stale flag adds **two untested code paths**; flag debt compounds faster than ordinary tech debt ([FlagShark debt guide](https://flagshark.com/blog/feature-flag-technical-debt-guide/), [DevCycle tech-debt](https://docs.devcycle.com/best-practices/tech-debt/)). The 2026 governance norm: lifecycle-default = *temporary*; ops/permanent must be *explicitly justified*; quarterly 2–4h flag audit; naming convention + owner + metadata enforced; cleanup automated into CI ([Swetrix 12 practices 2026](https://swetrix.com/blog/feature-flagging-best-practices), [LaunchDarkly reducing flag debt](https://launchdarkly.com/docs/guides/flags/technical-debt), [beefed.ai lifecycle](https://beefed.ai/en/feature-flag-governance-lifecycle-best-practices)).

**Borjie application.** `FLAG_ACTIVATION_PLAN.md` already inventories ~40+ flags but has **no expiry metadata**. Add a `flag_registry` (owner, type, created, expected-retirement, "removed when X is default-on") and a CI check (extend the existing `audit-not-yet-wired.yml` pattern) that fails when a *release* flag is older than its retirement date OR has been at 100% in prod for >30 days without code-cleanup. The `BORJIE_MODALITY_ARBITER`/`BORJIE_BODY_CHANGE` release flags get an explicit retirement: *"delete the default-off branch once the organ is verified-on for all tenants for 30 days."*

**Safety rail this adds:** the verified-rollout substrate doesn't itself become the next dark-organ liability. A flag that has done its job is removed, so the codebase never accumulates the dual-path ambiguity that produced the 43-gap situation in the first place.

### 1.3 Canary + shadow + blue-green + ring/wave — the four mechanisms, chosen by reversibility

- **Shadow / mirror (dark launch):** duplicate live traffic to the candidate; candidate output **never reaches the user**; log + compare. Cost ≈ doubles inference during eval; the standard way to *qualify a new LLM backend before flipping routing* ([TianPan LLM gradual rollout Apr-2026](https://tianpan.co/blog/2026-04-09-llm-gradual-rollout-shadow-canary-ab-testing), [CodeAnt LLM shadow A/B](https://www.codeant.ai/blogs/llm-shadow-traffic-ab-testing), [oneuptime shadow routing Jan-2026](https://oneuptime.com/blog/post/2026-01-30-shadow-routing/view)).
- **Canary:** route a controlled subset (start **1%, or 0.1% for high-stakes**) → escalate **1% → 5% → 20% → 50% → 100%**, with **consistent per-session user assignment** so a user doesn't flip mid-session ([TianPan](https://tianpan.co/blog/2026-04-09-llm-gradual-rollout-shadow-canary-ab-testing)).
- **Blue-green:** instant cutover with instant rollback; we already do this on CD-production.
- **Ring / wave targeting:** internal → pilot cohort → small tenants → all, each ring gated. This is exactly the per-tenant/cohort targeting our `feature-flags-adapter` already supports.

The selection rule: **the lower the reversibility of the effect, the smaller the first slice and the more it leans shadow-first.** A read-only enrichment can canary at 5%; an *actuating* organ (body-change, saga that calls `LedgerService.post`) must shadow-first (dry-run/`dryRun:true`) and canary at one tenant.

**Borjie application — map each built-but-dark organ to a mechanism:**

| Organ (dark) | Reversibility | Rollout mechanism | First slice |
|---|---|---|---|
| **modality-arbiter** (`BORJIE_MODALITY_ARBITER`, OK-1) | reversible (routing only) | **shadow** the new topology decision vs old (log both, serve old) → canary | shadow 100% / serve 0%, then 1 tenant |
| **loop-runner** (OK-2) | reversible (bounded by budget) | canary behind arbiter, **budget-envelope gated** | 1 internal tenant |
| **control-shell `pickNext`** (OK-3) | reversible (scheduler) | shadow-schedule (compute `pickNext`, don't dispatch) → canary | shadow then 1 tenant |
| **EstateMind actuator bridge** (OK-4) | **mixed** — propose-only is reversible, the new actuate path crosses the arbiter | **stays propose-only in shadow**; the actuate edge canaries on 1 tenant **behind HITL** | nudge-only first, actuate edge last |
| **durable-runner / saga** (`DURABLE_EXEC_ENABLED`, OK-5/6) | irreversible effects by type | **dry-run first** (`dryRun:true` walks the saga, runs no external effect), then 1 tenant, then irreversible steps last | dry-run 100% → 1 tenant |
| **body-change meta-rail** (`BORJIE_BODY_CHANGE`, OK-7) | reversible by design (`compensate`) but mutates the body | **propose-and-diff (no-commit) shadow** → canary one surface-persist edge | shadow then 1 tenant, surface-persist before schema-synthesis |
| **EstateMind Slow Loop** (`BORJIE_ESTATE_MIND`) | propose-only (per `FLAG_ACTIVATION_PLAN.md`) | ring: internal → pilot cohort | leader-elected single instance |
| **model routing (cheap-first / RouteLLM, Wave 10)** | reversible | **shadow the new routing vs old**, LLM-judge compare | shadow 100% |

**Safety rail this adds:** an actuating organ can **never** reach a paying tenant's money/licence/deletion path on its first flip — it is mechanically forced through shadow/dry-run first, where it produces *zero external effect* and is compared against the incumbent. The blast radius of a first flip is **one internal tenant**, contained by the cross-portal kill-switch fanout.

### 1.4 SLO / error-budget gates + automatic rollback — the closed loop

The 2026 control-plane SOTA is **metric-gated promotion**: the rollout queries a metric provider at each step and auto-promotes or auto-rolls-back.

- **Argo Rollouts:** `AnalysisTemplate` → `AnalysisRun` queries Prometheus/Datadog; success condition e.g. *"≥95% success rate"*; on failure the Rollout **scales down the canary and reverts traffic to stable**, automatically ([Argo Rollouts analysis docs](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/), [InfraCloud canary-with-analysis](https://www.infracloud.io/blogs/progressive-delivery-argo-rollouts-canary-analysis/)). Step-based, explicit, supports manual approval gates between stages.
- **Flagger:** metric-driven canary alongside existing Deployments; on analysis failure **routes all traffic back to primary and scales down the canary** ([Flagger vs Argo, oneuptime Mar-2026](https://oneuptime.com/blog/post/2026-03-13-flagger-vs-argo-rollouts-comparison/view), [Calmops progressive delivery](https://calmops.com/architecture/progressive-delivery-canary-argo-rollouts-flagger/)).
- **LaunchDarkly Guarded Releases (Jan-2026 sequential testing):** progressively raises traffic while monitoring chosen metrics; declares a regression when **sequential testing finds a statistically-significant negative absolute difference** (confidence interval entirely on the worse side); on regression with auto-rollback enabled it **rolls the release back before users are impacted**; each step needs a **minimum number of contexts** or it auto-rolls ([LaunchDarkly guarded rollouts](https://launchdarkly.com/docs/home/releases/guarded-rollouts), [LaunchDarkly managing guarded rollouts](https://launchdarkly.com/docs/home/releases/managing-guarded-rollouts), [SD Times](https://sdtimes.com/softwaredev/launchdarkly-launches-guarded-releases-to-improve-release-confidence-at-every-stage-of-application-rollouts/)).

**Non-negotiable best practice across all sources:** *define BOTH success-rate AND latency thresholds — error rate alone misses performance degradation* ([Calmops](https://calmops.com/architecture/progressive-delivery-canary-argo-rollouts-flagger/)).

**Borjie application.** We don't need to adopt Argo Rollouts/Flagger at the *infra* layer for the dark-organ flips (those are runtime flag flips, not new Deployments) — but we adopt the **pattern** at the *flag* layer: a `RolloutGuard` that, after each flag-rollout-step, queries our OTel/audit plane for the organ's SLIs and either promotes the flag to the next slice or trips it back to the previous (ultimately to off). For *infra*-level releases (new api-gateway image), Argo Rollouts canary-with-analysis IS the right SOTA upgrade over the current all-or-nothing blue/green. Borjie's SLI set per organ:

| SLI | Source | Default abort threshold (from sources) |
|---|---|---|
| p99 turn latency | OTel GenAI span | **+40% vs stable** ([TianPan](https://tianpan.co/blog/2026-04-09-llm-gradual-rollout-shadow-canary-ab-testing)) |
| refusal / unexpected-block rate | intent-verifier advisory log | **+5% absolute** ([TianPan](https://tianpan.co/blog/2026-04-09-llm-gradual-rollout-shadow-canary-ab-testing)) |
| cost-per-request | `llm-budget-governor` | **> tenant budget envelope** (abort) |
| success/error rate | gateway 5xx + brain error sink | **< 95% success** ([Argo](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/)) |
| evidence-chain non-empty | Auditor Agent (mandate floor) | **any empty-evidence response = instant abort** (Borjie-specific) |
| audit-chain hash continuity | hash-chained decision log | **any break = instant abort** (Borjie-specific) |
| RLS / cross-tenant leak | egress filter + RLS denials | **any cross-tenant emission = instant abort** (Borjie-specific) |

**Safety rail this adds:** the rollout cannot advance to the next slice unless **every** SLI is green *and* enough contexts were observed (LaunchDarkly's minimum-contexts rule), and it auto-reverts on the first breach. The Borjie-specific SLIs (empty-evidence, audit-break, cross-tenant leak) make the *mandate floor itself a rollout gate* — a flip that would violate an inviolable is auto-reverted, not merely alerted.

### 1.5 Shadow-eval for non-deterministic AI — the LLM-judge gate

Because LLMs are non-deterministic, you cannot qualify a new model/routing/topology with unit tests — you need **automated comparison on real traffic**: an LLM-judge scoring both candidate and incumbent on factual accuracy / tone / task-completion / format, plus token+cost diff and latency under realistic load ([CodeAnt](https://www.codeant.ai/blogs/llm-shadow-traffic-ab-testing), [TianPan](https://tianpan.co/blog/2026-04-09-llm-gradual-rollout-shadow-canary-ab-testing), [Medium canary-for-LLMs](https://medium.com/@oracle_43885/canary-deployments-for-securing-large-language-models-48393fa68efc)). Canary answers *is it stable?*; A/B answers *is it better?* — both are needed before a model/routing flip.

**Borjie application.** We already have the eval substrate: `kernel-eval.yml`, `eval-orchestrator-scenarios.yml`, `trajectory-eval.yml`, `red-team.yml`, `defection-probe.yml`, `sycophancy-probe.yml`, and the `reflexion-sleep-canary.yml` `.canary.json` pattern. The shadow path for the **modality-arbiter** and **Wave-10 cost-penalized model routing** is: shadow-compute the new topology/route, log both decisions, replay through the existing trajectory-eval + an LLM-judge, and **promote only when the new path is non-regressed on quality AND wins on cost/latency** — exactly `MASTER_WIRING_CLOSURE_PLAN.md` Part V gate (3): the relevant CI eval green.

**Safety rail this adds:** a topology/routing/model change is never flipped on quality faith — it is flipped only after an LLM-judge on real (shadowed) traffic proves non-regression, with the eval suite as the machine gate. This is the antidote to the "88% of agent pilots fail in production on governance/observability gaps, not model quality" finding ([RAIL AI agent safety 2026](https://responsibleailabs.ai/knowledge-hub/articles/ai-agent-safety-2026), [ManageEngine playbook](https://insights.manageengine.com/artificial-intelligence/agentic-ai-autonomous-it-governance-playbook/)).

### 1.6 Agentic-autonomy rollout — graduated trust + tested kill switches + HITL on irreversible

The governance consensus for *autonomous agents* specifically (not just features): **canary the autonomy, expand only after telemetry validates safety**; **kill switches must be tested regularly, not merely documented**; **human approval for irreversible or legally-binding actions**; independent supervisory agents to counter automation bias ([ManageEngine](https://insights.manageengine.com/artificial-intelligence/agentic-ai-autonomous-it-governance-playbook/), [RAIL](https://responsibleailabs.ai/knowledge-hub/articles/ai-agent-safety-2026), [CISA/NSA/Five-Eyes joint guidance 1-May-2026, via RAIL]). The AURA framework formalizes agent-autonomy risk tiers ([AURA, arXiv 2510.15739](https://arxiv.org/pdf/2510.15739)). Trust in fully-autonomous AI **dropped 43%→27%** — the market reward is *governed* autonomy, which is Borjie's exact positioning (Mr. Mwikila is HITL-gated on sovereign).

**Borjie application.** The **EstateMind actuator bridge** (OK-4) is precisely the "expand autonomy" step the literature warns about — flipping the resident Mind from sensor to actuator. Roll it out as graduated trust: (1) propose-only in prod for all tenants (already the design), (2) shadow the *actuate* edge (compute the `OrchestratorRequest` it *would* emit, log it, don't dispatch) on one tenant, (3) enable the actuate edge on one tenant **only for reversible, sub-threshold goals**, HITL-confirmed, (4) raise the `confidence × (1−reversibility)` bar per ring. The kill-switch is the existing `BORJIE_AI_KILL_SWITCH` + cross-portal fanout — and per the literature it must be **drill-tested** (add a quarterly "trip the fanout, assert all four surfaces 503 within N seconds" gameday, mirroring the existing `backup-restore-drill.yml` cadence).

**Safety rail this adds:** the most dangerous flip in the whole plan (sensor→actuator) is decomposed into four trust rings, each metric-gated, with the irreversible/sovereign tail staying HITL **forever** — and the kill-switch that stops it is regularly drilled, so it is known-good when needed, not assumed-good.

---

## PART 2 — THE BORJIE GUARDED-ROLLOUT LOOP (synthesis: how we never fail at the flip)

This is the single pattern every dark-organ flip obeys. It composes our existing valves into the closed loop the substrate lacks.

```
                ┌────────────────────────────────────────────────────────────┐
                │  flag_registry: type=release, organ=X, owner, retire-by     │
                └───────────────┬────────────────────────────────────────────┘
                                │
   STAGE 0  BOOT-DARK ──────────▼  binary deployed, flag OFF, boot-smoke PASS
                                │      (scripts/deploy/boot-smoke.ts, every seam fail-safe-off)
   STAGE 1  SHADOW / DRY-RUN ───▼  organ computes its decision/effect, output NOT served / dryRun:true
                                │      OTel logs candidate vs incumbent; LLM-judge + trajectory-eval compare
                                │      GATE: non-regressed quality, cost+latency win, ZERO external effect
   STAGE 2  CANARY 1 TENANT ────▼  flag ON for one INTERNAL tenant (FlagContext.tenantId), session-sticky
                                │      RolloutGuard queries SLIs (1.4 table) over a window + min-contexts
                                │      GATE: all SLIs green incl. Borjie-floor SLIs (evidence/audit/RLS)
   STAGE 3  RING: PILOT COHORT ─▼  flag ON for cohort (FlagContext.attributes.cohort), 1%→5%→20%
                                │      same guard; budget governor caps cost; intent-verifier ADVISORY first
   STAGE 4  WAVE: 50% → 100% ───▼  per-tenant ramp; STRICT enforcement enabled LAST (per CANARY_RUNBOOK)
                                │
   ANY BREACH at any stage ─────►  AUTO-ROLLBACK: set flag to previous slice (ultimately OFF) + roll pods;
                                   if actuating organ: trip BORJIE_AI_KILL_SWITCH + cross-portal fanout;
                                   write hash-chained rollback decision-log entry FIRST.
   FLAG RETIREMENT ────────────►  organ default-on for all tenants 30d → delete default-off branch (1.2)
```

**The seven properties that make this fail-proof for Borjie's mandate:**

1. **Deploy ≠ release.** The binary is always dark-deployable; release is a reversible runtime flip. Rollback never needs a redeploy (already true per `CANARY_RUNBOOK.md`).
2. **Shadow/dry-run before any effect.** Actuating organs (saga, body-change, EstateMind-actuate) produce **zero external effect** in Stage 1 — `dryRun:true` walks the saga, body-change proposes-without-commit, the arbiter logs-without-dispatch. The money/licence/deletion path is untouched until an organ has proven itself with no consequence.
3. **Blast radius = one internal tenant, then cohort, never global-first.** Per-tenant `FlagContext` targeting (our adapter already does this) means the first real flip touches one tenant we control. Cross-portal fanout bounds it.
4. **The mandate floor IS a rollout gate.** Empty-evidence, audit-chain break, and cross-tenant leak are *instant-abort* SLIs (1.4). A flip that would violate an inviolable auto-reverts — the guard enforces `CLAUDE.md` mechanically, not by review.
5. **Both latency AND success-rate gates** (the universal best practice), plus cost (budget governor) and quality (LLM-judge) — no single-metric blind spot.
6. **Kill-switch fail-closed + drilled.** Sovereign `killswitch_*` stay operator-only fail-closed (never auto-flipped); the *rollout* kill-path (auto-revert + AI-kill-switch + fanout) is a separate, regularly-drilled lever. The two never conflate.
7. **Flag hygiene closes the loop.** A retired flag deletes its dual path, so the verified-rollout machinery does not breed the next generation of dark organs.

---

## PART 3 — APPLYING THE LOOP TO THE CLOSURE-PLAN WAVES (the flip order)

Aligning this lane with `MASTER_WIRING_CLOSURE_PLAN.md`'s waves and `FLAG_ACTIVATION_PLAN.md`'s buckets:

- **Wave 1 (the conductor — `BORJIE_MODALITY_ARBITER`, `BORJIE_BODY_CHANGE`, loop-runner, control-shell, EstateMind-actuate):** flip in Stage order **shadow → 1 internal tenant → cohort**. The arbiter shadows (log topology, serve old); loop-runner canaries budget-gated; body-change proposes-without-commit first; EstateMind-actuate is the graduated-trust four-ring sequence (1.6). The plan's own stated risk — *"ship behind a canary + per-request override and watch cost/latency"* — IS this loop. **Per-request override** = a sticky `FlagContext.userId` override so an operator can force-old on any single turn.
- **Wave 2 (durable-exec / saga — `DURABLE_EXEC_ENABLED`, OK-5/6):** `DURABLE_EXEC_ENABLED` is NEEDS-PREREQ (`FLAG_ACTIVATION_PLAN.md` Bucket 2) — flip only after the executor binding exists, then **dry-run the saga (`dryRun:true`) at 100%**, prove crash-resume parity vs the legacy sync executor, then 1 tenant, then enable irreversible steps last (four-eye on irreversible filings is type-enforced).
- **Wave 3 (dark analytics ports):** each port behind an env flag + budget; shadow on the proactive tick (compute, don't surface) → canary → on. `runDebate` gated via `?includeDebate=true` is already a per-request canary handle.
- **Wave 5 (egress projection / out-of-process rail):** OK-8a egress must land **default-on, fail-closed** *before* Wave 8 artifacts reach a paying tenant — it is a floor flag, not a release flag (don't canary a security floor to a slice; ship it on, canary the thing it protects).
- **Wave 8/9 (frontend seams + pages):** standard release-flag canary per surface; low blast radius; the artifact HTML must pass the Wave-5 egress projection (dependency edge) before the flag goes >0% for a paying tenant.
- **Wave 10 (cost-penalized model routing, topology selection):** the **shadow-eval + LLM-judge** path (1.5) — shadow the new RouteLLM/topology decision, replay through trajectory-eval, promote only on quality-non-regression + cost/latency win.

**Blocker burn-down (from the closure plan) executed through this loop:** OK-2 → OK-1 → OK-7 → OK-3 (Wave 1, each shadow-first) → OK-6 → OK-5 (Wave 2, dry-run-first) → consolidationRunner (Wave 6, a null-wire fix, canary on the HQ tool path). Each clears a dark-on-paying-path blocker **without** a global flip.

---

## PART 4 — THE GAP TO CLOSE (what to build to make the loop real)

The substrate is 80% there; the missing 20% is the **closed loop binding**, scoped as concrete, buildable items (no code here — spec for a follow-up wave):

1. **`flag_registry` + types + expiry** — add flag-type (release/experiment/ops/kill-switch/permission), owner, retire-by, and a CI gate (extend `audit-not-yet-wired.yml`) that fails on stale release flags. *(1.2)*
2. **`RolloutGuard` module** — after each flag-slice step, query the OTel/audit/budget plane for the organ's SLIs (1.4 table), apply LaunchDarkly-style minimum-contexts + sequential-significance, and emit promote / hold / auto-revert. Binds to the existing `feature-flags-adapter` to set the next slice. *(1.4)*
3. **Shadow harness** — a `shadow:true` mode on the arbiter/saga/body-change/model-router that computes the candidate decision, logs candidate-vs-incumbent to OTel, and runs zero external effect; feeds the LLM-judge + trajectory-eval comparison. *(1.3, 1.5)*
4. **Borjie-floor SLIs as instant-abort signals** — wire empty-evidence (Auditor Agent), audit-chain hash-break, and cross-tenant-leak (egress filter) as the highest-precedence rollout-abort triggers. *(Part 2, property 4)*
5. **Auto-revert path** — on breach: set flag to previous slice + roll pods; for actuating organs additionally trip `BORJIE_AI_KILL_SWITCH` + `cross-portal-killswitch-fanout`; write the hash-chained rollback decision-log entry FIRST (Principle 5 ordering). *(1.4, 1.6)*
6. **Kill-switch gameday** — quarterly drill (mirror `backup-restore-drill.yml`) that trips the fanout and asserts all four surfaces 503 within N seconds; the literature's "test kill switches regularly" rule. *(1.6)*
7. **(Infra, optional SOTA upgrade)** — adopt **Argo Rollouts canary-with-AnalysisTemplate** for the api-gateway *image* release (replacing all-or-nothing blue/green with Prometheus-gated `1%→5%→20%→50%` + auto-abort), since the cluster is already Kustomize/Helm on K8s. *(1.4)*

---

## PART 5 — DONE = NO FLIP EVER REACHES A PAYING TENANT UNVERIFIED

Closure for this lane is proven when: (1) every *release*-type flag is registered with a type, owner, and retire-by, and the CI gate enforces it; (2) `RolloutGuard` is bound so a release flag **cannot** advance a slice without all SLIs green + min-contexts met, and auto-reverts on breach; (3) every actuating organ (saga, body-change, EstateMind-actuate, model-router) has a shadow/dry-run Stage-1 that produces zero external effect and an LLM-judge/eval comparison gate; (4) the three Borjie-floor SLIs (empty-evidence, audit-break, cross-tenant-leak) are instant-abort triggers; (5) the kill-switch fanout is drill-tested on a schedule. When all five hold, the closure-plan's blockers can be flipped **one slice at a time, behind a metric gate that reverts them faster than a paying tenant can notice** — which is the literal definition of this lane and the reason we never fail at the wiring.
