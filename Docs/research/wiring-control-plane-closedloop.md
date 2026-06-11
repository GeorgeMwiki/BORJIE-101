# Wiring Control Plane & Closed-Loop Optimization — 2026 SOTA + Beyond-Today Frontier

**Lane:** `control-plane-progressive-closedloop-frontier`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** research dossier (no code, no commit)
**Author:** subagent — control-plane / closed-loop lane
**Audience:** Borjie brain-layer + platform architects (admin control plane, `@borjie/brain-llm-router`, `@borjie/llm-budget-governor`, EstateMind Slow Loop, observability).

> **Owner directive:** *"Think about wiring ways we don't even know we can do — deep online research, expand to 1,000,000%, FULL SOTA."* This dossier surveys the 2026 state of the art of the **control plane over the wiring** + **closed-loop optimization of that wiring**, then goes **beyond** it: it shows how Borjie's already-built admin control plane + budget governor + observability become **one live, self-tuning Pareto-optimizer** of intelligence — observing production, recommending wiring changes, canarying them on a slice, auto-promoting on a proven win, all inside the existing four-eye / kill-switch / audit-chain rails.

---

## 0. Thesis — in one paragraph

Borjie already has the hard parts of a world-class **control plane over its own wiring**: an admin **Control Tower** that drives real platform state behind four-eye approval (`services/api-gateway/src/routes/admin/control-tower.hono.ts`); a **routing-overrides** layer with locked legal-significance categories (`packages/brain-llm-router/src/routing-overrides/`); a **cost-cascade**, **hedged-requests**, **judge-loop**, **provider-fallback**, **effort selector**, **dspy-compile**, and an **eval-drift-logger** that already encodes the regression rule *"current-week pass-rate < 4-week rolling mean − 5pp → page"*; a per-tenant **budget governor** with auto-downgrade; a **feature-flags** schema; an **undo_journal**; the **blackboard-sota** CRDT state-bus; and the **EstateMind Slow Loop** (perceive→orient→motivate→propose, leader-elected, propose-only). What it does **not** yet have is the **closed loop**: the eval-drift signal, the budget telemetry, and the trace stream do not yet *flow back* into a routing-config change automatically. The admin "AI-suggest" is a human-gated one-shot, not a continuous learner. **The 2026 SOTA — ParetoBandit, PILOT/BaRP bandit-feedback routers, GEPA reflective evolution, Argo-Rollouts-style analysis-driven auto-promotion, OpenFeature progressive delivery, OPA/Cedar policy-as-code — is precisely the missing arc that closes OBSERVE → RECOMMEND → APPLY → OBSERVE.** Borjie is one disciplined integration away from a system that *continuously self-tunes the routing/ensemble/budget configuration against a cost×quality×latency Pareto objective*, never replacing the rule-based wiring but **appending** a learned policy on top of it, every change canaried on a slice and auto-promoted only on a statistically proven win, every promotion an append-only audit row.

The central finding mirrors the operational-fabric dossier's: **no single 2026 vendor closes the whole loop for the *control plane over wiring*.** Feature-flag platforms (OpenFeature/LaunchDarkly/Unleash/Cloudflare Flagship) give you the *targeting + kill-switch + gradual rollout* primitive but have no notion of quality. Progressive-delivery controllers (Argo Rollouts / Flagger) give you *canary-with-analysis auto-promote* but are pod-shaped, not config-shaped. LLM gateways (LiteLLM/Portkey/OpenRouter) give you *shadow/canary/fallback routing* but stop at "delivered." Observability platforms (Langfuse/LangSmith) give you *online evals on prod traces* but don't act on them. Bandit routers (ParetoBandit/PILOT/BaRP) give you the *learner* but assume you'll wire the guardrails yourself. **The moat is the integration of those five primitives under ONE control plane + ONE hash-chained audit chain, expressed over Borjie's existing RLS-Postgres + four-eye + kill-switch invariants.**

---

## 1. The five pillars of the 2026 control-plane SOTA (survey)

### 1.1 Feature flags / progressive delivery as a control plane

The 2026 consensus has hardened around **OpenFeature** (CNCF, vendor-agnostic flag API, promoted to incubating Dec 2023) as the *code-level* standard so providers stay swappable, with the management plane behind it (LaunchDarkly, Unleash, GrowthBook, Flagsmith, Flipt, or — new in **May 2026** — **Cloudflare Flagship**, an edge-native OpenFeature service that evaluates flags *locally in Workers* with targeting rules + percentage rollouts and no external call). The pattern that matters for Borjie: **canary, ring, kill-switch, and per-tenant targeting all fall out of one well-designed flag with an *evaluation context*** (user/tenant/request attributes passed at evaluation time so the provider makes the targeting decision). The market is exploding ($1.45B in 2024 → projected $5.19B by 2033), which is the tell that *flag-as-config* has become the universal substrate for shipping change safely.

- **What Borjie already has:** `packages/database/src/schemas/platform-feature-flags.schema.ts` + `feature-flags.schema.ts`, the Control-Tower's `feature_flag` backend, and `platform-autonomy-settings`. This *is* a flag management plane — but global/boolean, without an OpenFeature-style **typed evaluation context** (tenant tier, jurisdiction, locale, risk-class) or **percentage/ring rollout**.
- **Sources:** OpenFeature 2026 Node.js guide (1xAPI); Cloudflare Flagship / InfoQ (May 2026); Flagsmith "Top 7 feature flag tools 2026"; Zylos "Feature Flags … Path to Progressive Delivery 2026"; Growthbook "What are feature flags 2026".

### 1.2 Canary / shadow / blue-green / A-B of **wiring configs** (not just pods)

**Argo Rollouts** and **Flagger** are the reference implementations of *progressive delivery with analysis-driven promotion*: a canary serves a traffic slice, an **AnalysisRun** queries metric providers (Prometheus/Datadog/CloudWatch/web-metrics), and the controller **auto-promotes or auto-rolls-back** on the KPI verdict. **Traffic mirroring (shadow)** copies prod requests to a silent candidate whose responses are *discarded* — evaluation with zero user blast-radius. The 2026 leap that the LLM-gateway world copied wholesale: LiteLLM/Portkey now expose **shadow testing, canary routing, latency/cost-based routing, fallbacks, and circuit breakers** as first-class gateway features (Portkey went fully open-source Apache-2.0 in March 2026). The unmet gap everyone notes: *these target pods/endpoints, not the **routing decision itself***. Nobody ships "canary a new *ensemble policy* on 5% of high-stakes turns and auto-promote when the judge-score wins."

- **What Borjie already has:** the *units* to canary (a `RoutingOverrideEntry` per `(tenant, taskCategory) → family`, an ensemble mode, a cascade threshold, a budget downgrade-fraction) and the *signal* to analyze (eval-drift events with confidence/cost/latency, judge-loop verdicts). What is missing is a **Rollout object over a wiring config** + an **AnalysisRun equivalent** over eval-drift.
- **Sources:** Argo Rollouts docs (canary/blue-green/analysis/experimentation); Flagger-vs-Argo (Buoyant, Calmops); LiteLLM auto-routing + routing/load-balancing docs; Portkey buyers-guide + "Portkey vs LiteLLM vs OpenRouter 2026"; Digital Applied "LLM Gateway Architecture 2026".

### 1.3 The closed loop: OBSERVE → RECOMMEND → APPLY → OBSERVE (bandits + Bayesian-opt)

This is the lane's keystone, and 2026 produced the exact algorithm Borjie needs.

- **ParetoBandit (arXiv:2604.00136, 2026)** — *"Budget-Paced Adaptive Routing for Non-Stationary LLM Serving."* A **cost-aware contextual bandit** + **online budget pacing** (cost is an *optimization variable*, not a hard wall — it reallocates spend across a time horizon as prices move) + **geometric forgetting** (exponentially-weighted history so recent observations dominate). It is the **first router evaluated under all three real-world non-stationarities at once**: provider price changes, model quality regression, and *new-endpoint absorption*. It optimizes a **cost×quality×latency Pareto frontier** rather than a single scalar — exactly Borjie's objective.
- **PILOT / BaRP (2025–26)** — formulate router training as a **contextual bandit**: learn a shared query×model embedding from offline preference data, then **refine online with bandit feedback**, letting operators **dial the cost/quality trade-off at inference time without retraining** (a trade-off *vector*, not a fixed point — BARP conditions the policy on it). This is the "one policy, many trade-offs" result (arXiv:2510.07429).
- **LLM Bandit (arXiv:2502.02743)** — preference-conditioned dynamic routing; **MetaLLM** — MAB selecting the cheapest model likely to be correct; **MixLLM** — contextual-bandit + policy-gradient meta decision-maker balancing quality/cost/latency.
- **MALBO (arXiv:2511.11788)** — *multi-objective Bayesian optimization* (qLogNEHVI acquisition) to find the **Pareto-optimal set of multi-agent team configurations** over cost/latency/performance. This is the **Bayesian-opt sibling** of the bandit approach, and it is the right tool for the *slower-moving* control knobs (ensemble mode, cascade depth, judge threshold) where you have few, expensive evaluations.
- **The survey** (Dynamic Model Routing & Cascading, arXiv:2603.04445, 2026) names the **OBSERVE→RECOMMEND→APPLY→OBSERVE** loop explicitly and stresses that *production systems must feed outcome data (user satisfaction, accuracy, latency) back to routers* so they adapt to real-world patterns rather than training-time statistics. Its forward-looking ideas: **continual adaptation without retraining**, **difficulty-aware cascade depth**, **uncertainty-as-routing-signal**.
- **RouterArena (arXiv:2510.00202)** / **RouterBench (Martian)** — the *benchmark/eval loop* that lets you measure a router config before promotion.

**The decisive 2026 framing:** bandit-feedback online-learning routers are *replacing* static classifiers; MCP gateways are emerging as *unified control planes*; routing is moving *below the application layer* (vLLM Iris semantic routing). Borjie should ride this wave but keep the learner **propose-only behind the policy-gate**.

- **Sources:** ParetoBandit (arXiv:2604.00136); Dynamic Routing/Cascading survey (arXiv:2603.04445); "Learning to Route from Bandit Feedback: One Policy, Many Trade-offs" (arXiv:2510.07429); LLM Bandit (arXiv:2502.02743); MALBO (arXiv:2511.11788); RouterArena (arXiv:2510.00202); Not-Diamond awesome-ai-model-routing; Zylos "AI Agent Model Routing 2026".

### 1.4 LLM observability + eval-in-the-loop (prod traces feeding the router)

**Langfuse** (open-source, acquired by ClickHouse Jan 2026, SDK v4 rewrite Mar 2026, 2,300+ companies, billions of observations/month) and **LangSmith** are the reference eval-in-the-loop platforms: structured **tracing** (exact prompt, response, tokens, latency, tool/retrieval steps) → **online LLM-as-a-judge evals on live production traces** (step-wise) → **interesting examples become datasets** → **experiments compare changes** → results judged manually or automatically. This is the *measurement organ* of the closed loop: the thing that turns raw traces into the **reward signal** the bandit consumes.

- **What Borjie already has:** the `eval-drift-logger` (every brainCall → structured `eval_drift_event` with confidence/cost/latency/fallbackDepth/cascadeSteps/wasHedged; a K-D Inspect harness samples + replays against the golden suite; the **5pp regression rule** already coded) + the `judge-loop` (score 0–100, regenerate below threshold) + the `cross-provider-auditor`. **This is a homegrown Langfuse-for-routing already.** The missing piece is wiring its `passRate()` / `regressionTriggered()` output **into the routing decision**, not just into a pager.
- **Sources:** Langfuse docs (observability + evaluation overview); Langfuse GitHub; PyImageSearch "Manual Tracing/Scores/Eval with Langfuse self-hosted" (May 2026); Laminar "Langfuse alternatives 2026".

### 1.5 Policy-as-code governance of the control plane

2026 hardened the rule that **the agent must not decide what's allowed — the policy engine does.** **OPA (Rego)** and **AWS Cedar** (formally-verified) enforce policy *at the tool-calling / config-change layer*, outside the code, as **versioned artifacts** that evolve without redeploying the agent — so even a hijacked agent is blocked before it reaches the target. The **OWASP Top 10 for Agentic Applications (2026)** names *Agent Goal Hijacking* the leading risk and mandates *minimizing unnecessary capability*. Applied to a *self-tuning control plane*, this is the load-bearing safety idea: **the bandit/optimizer may only emit config changes that pass a policy-as-code check** (never override a `LOCKED_CATEGORY`, never raise a tenant above its tier ceiling, never disable a kill-switch, never breach jurisdiction/locale rails), and high-risk promotions require human approval (step-up).

- **What Borjie already has:** the policy-gate + `inviolable.ts`, the `LOCKED_CATEGORIES` set in routing-overrides, the four-eye Control-Tower, the budget-governor's `allowedTiers`. These *are* policy-as-code — they just need to be the **mandatory gate on the optimizer's output**.
- **Sources:** Codilime "OPA as the missing guardrail for AI agents"; Gökalp "Runtime Governance for AI Agents: Policy-as-Code with OPA"; Natoma "MCP Access Control: OPA vs Cedar"; Spacelift "Top 12 Policy-as-Code tools 2026"; Frontegg "AI Agent Governance Starts with Guardrails"; getmaxim "AI Guardrails Implementation Guide 2026".

### 1.6 Cost-aware autoscaling of intelligence (spend more compute on high-value turns)

The 2026 reasoning-budget literature is decisive: **easy inputs waste the full budget while hard inputs starve, and redistributing compute from easy→hard yields higher aggregate accuracy at the *same total spend*.**
- **Adaptive Test-Time Compute via Constrained Policy Optimization (arXiv:2604.14853)** — Lagrangian relaxation decomposes a global compute budget into per-instance sub-problems with a **closed-form oracle action pricing accuracy against cost**, exact budget targeting via binary search; **+12.8% relative accuracy on MATH under matched budget**.
- **Plan-and-Budget (ICLR 2026, github junhongmit/P-and-B)** — *training-free* per-query token-budget allocation.
- **"Reasoning on a Budget" survey (arXiv:2507.02076)** — taxonomy of adaptive/controllable test-time compute.

For Borjie this is the *value-weighted* dimension of the Pareto objective: a tailings-dam safety decision or a licence-suspension notice **deserves** opus + ensemble-debate + a verifier pass; a "what's my royalty due date" lookup deserves haiku-single-shot. The control plane should set the **per-turn compute budget as a function of estate-value-at-risk**, not a flat tier.

- **Sources:** arXiv:2604.14853; arXiv:2602.03975; arXiv:2507.02076; P-and-B GitHub.

---

## 2. Where Borjie sits today (substrate audit) — what's built vs. the missing arc

| Capability | 2026 SOTA primitive | Borjie status | File |
|---|---|---|---|
| Flag-as-config control plane | OpenFeature + targeting context | **PARTIAL** — global boolean flags, no typed eval-context, no % rollout | `platform-feature-flags.schema.ts` |
| Four-eye / kill-switch governance | OPA/Cedar policy-as-code | **STRONG** — four-eye Control-Tower, fail-closed kill-switch, locked categories | `admin/control-tower.hono.ts`, routing-overrides |
| Cost ceiling + auto-downgrade | budget pacing | **PARTIAL** — hard cap + tier downgrade, but *static threshold*, not *paced/learned* | `llm-budget-governor/governor.ts` |
| Cascade (cheap→escalate) | difficulty-aware cascade | **STRONG** — `cost-cascade` Haiku→Sonnet→Opus, pluggable evalFn | `cost-cascade/cascade-runner.ts` |
| Ensemble | first-wins / vote / judge / debate | **PARTIAL** — `judge-loop`, `hedged-requests`, but admin-selected, not config-canaried | `judge-loop/`, `hedged-requests/` |
| Online eval / trace stream | Langfuse online evals | **STRONG (homegrown)** — `eval-drift-logger` with 5pp regression rule + replay | `eval-drift-logger/drift-logger.ts` |
| Per-use-case routing | learned router | **PARTIAL** — `routing-overrides` are *manual* admin entries | `routing-overrides/schema.ts` |
| **OBSERVE→RECOMMEND→APPLY→OBSERVE** | **bandit / Bayesian-opt** | **MISSING** — no learner closes drift→config | — |
| **Canary/shadow of a config** | Argo-Rollouts AnalysisRun | **MISSING** — no Rollout-over-wiring | — |
| **Auto-promote on proven win** | analysis-driven promotion | **MISSING** | — |
| Value-weighted compute | adaptive test-time budget | **MISSING** — `effort` selector is per-thread, not value-at-risk | `effort/effort.ts` |
| Proposal engine for self-tuning | propose-only loop | **PRESENT but unused for wiring** — EstateMind proposes *estate* actions, not *wiring* configs | EstateMind Slow Loop |

**The one-line gap:** *Borjie has the OBSERVE (eval-drift) and the APPLY (Control-Tower/overrides/governor) and the audit rails — it is missing the RECOMMEND learner and the canary→auto-promote bridge that connect them into a loop.*

---

## 3. The build: Borjie's admin control plane becomes a live self-tuning Pareto-optimizer

This is the architecture, expressed entirely over existing organs. No new product — a **new connective plane**.

```
   prod turns ─► eval-drift-logger ──► REWARD VECTOR (quality, cost, latency, value-at-risk)
        │              (OBSERVE)                    │
        │                                           ▼
        │                          ┌──────────────────────────────────────────┐
        │                          │  WIRING OPTIMIZER  (propose-only)         │
        │                          │   • ParetoBandit over fast knobs          │
        │                          │     (model family per taskCategory,       │
        │                          │      cascade threshold, hedge on/off)     │
        │                          │   • MALBO Bayesian-opt over slow knobs     │
        │                          │     (ensemble mode, judge threshold,       │
        │                          │      compute budget curve)                 │
        │                          │   • geometric forgetting (non-stationary)  │
        │                          └───────────────┬──────────────────────────┘
        │                                          │ emits a CANDIDATE WIRING CONFIG
        │                                          ▼ (RECOMMEND)
        │              ┌───────────────── POLICY-AS-CODE GATE ──────────────────┐
        │              │  reject if: LOCKED_CATEGORY · above tier ceiling ·      │
        │              │  disables kill-switch · breaches jurisdiction/locale ·  │
        │              │  HIGH-risk prefix (sovereign/kill_switch/four_eye)      │
        │              └───────────────┬─────────────────────────────────────────┘
        │                              │ passes → register a ROLLOUT
        │                              ▼ (APPLY, gated)
        │     ┌──────────────── CONFIG ROLLOUT (canary / shadow) ───────────────┐
        │     │  shadow: mirror N turns to candidate, responses discarded        │
        │     │  canary: route X% of an eligible slice to candidate              │
        │     │  AnalysisRun over eval-drift: candidate Pareto-dominates control?│
        │     │   • doubly-robust off-policy estimate + anytime-valid CI         │
        │     │   • auto-PROMOTE on proven win · auto-ROLLBACK on regression     │
        │     │   • HIGH-impact promotion → four-eye Control-Tower approval       │
        │     └───────────────┬──────────────────────────────────────────────────┘
        │                     │ promote → write RoutingOverride / governor / flag
        └─────────────────────┴──► every step = append-only hash-chained audit row ──► back to OBSERVE
```

### 3.1 The reward vector (the OBSERVE organ, already 80% built)

The `eval-drift-logger` already emits `{confidence, costUsd, latencyMs, fallbackDepth, cascadeSteps, wasHedged}` per turn. Extend the event (append-only) with a **value-at-risk tag** (estate-value the turn touches: licence/safety/money magnitude, from the policy-gate's risk-tier) and a **delayed outcome** (did the owner accept the draft? did the ledger confirm? did a human override?). This yields the **4-vector reward** `(quality, cost, latency, value-weighted-quality)` that ParetoBandit/MALBO consume. Langfuse-style **online LLM-as-judge** runs on a sampled slice to score turns with no ground-truth — exactly the `judge-loop` already in tree.

### 3.2 The RECOMMEND learner (the missing organ)

Two learners, by knob cadence — this is the dossier's core architectural recommendation:
- **Fast knobs → ParetoBandit (contextual bandit + budget pacing + geometric forgetting).** Per-`(tenant, taskCategory)` arms: which model *family*, cascade *threshold*, hedge on/off. Updates every turn. Geometric forgetting makes it absorb a new model (e.g. a new Anthropic tier) or a price change *automatically* — the non-stationarity ParetoBandit was built for.
- **Slow knobs → MALBO-style multi-objective Bayesian-opt (qLogNEHVI).** Ensemble mode (first-wins/vote/judge/debate), judge-threshold, the **value→compute-budget curve**. These are few-shot, expensive-to-evaluate global knobs → Bayesian-opt over the Pareto set is the right tool; runs nightly on replayed traces (offline), proposes one candidate per cycle.

Both are **propose-only**: they emit a *candidate config*, never mutate live state. This is the exact shape of the EstateMind Slow Loop — **reuse it**: EstateMind already does perceive→orient→motivate→**propose** under leader-election; add a "wiring" motivation drive so the same loop proposes routing configs alongside estate actions.

### 3.3 The policy-as-code gate (reuse, don't rebuild)

The optimizer's candidate flows through the **existing** rails before it can become a Rollout: `LOCKED_CATEGORIES` (offtake/licence/financial/legal pinned to opus — the bandit *cannot* touch them), `allowedTiers` tier ceiling, kill-switch fail-closed, jurisdiction/locale invariants, HIGH-risk policy prefixes hit literal rules (no generalisation). This is OPA/Cedar semantics already present as TypeScript — formalize it as a single `assertWiringCandidateAllowed(candidate)` chokepoint.

### 3.4 The canary→auto-promote bridge (the second missing organ)

Model it on **Argo Rollouts AnalysisRun**, but over a **wiring config** instead of a pod:
- **Shadow mode** for high-stakes categories: mirror turns to the candidate config, **discard** its responses, score them against control — zero blast-radius (the LiteLLM/Portkey traffic-mirroring pattern).
- **Canary mode** for low-stakes: route X% of an eligible slice (an OpenFeature *percentage + targeting-context* rollout) to the candidate.
- **The verdict** uses **doubly-robust off-policy evaluation with anytime-valid confidence intervals** (2026 OPE SOTA): promote only when the candidate **Pareto-dominates** control with statistical significance; auto-rollback on the `eval-drift` 5pp regression rule (already coded). HIGH-impact promotions don't auto-apply — they land as a **four-eye Control-Tower journal row**, reusing `control-tower.hono.ts` verbatim.

### 3.5 The APPLY surface (already built)

A promotion writes exactly one of: a `RoutingOverrideEntry` (per-category family), a budget-governor `downgradeAtFraction` / `allowedTiers` change, or a feature-flag. All three already exist with audit + four-eye. **The optimizer is just a new, governed *writer* of the same three backends the human admin already writes.** Every promotion → append-only hash-chained audit row (the AI-audit-chain invariant) carrying the candidate, the canary verdict, the CI, and the reward delta — a fully **explainable** self-tuning trail (answers the survey's interpretability open-challenge).

### 3.6 Value-weighted compute autoscaling (the cost-aware-intelligence dimension)

Replace the per-thread `effort` selector with a **value→budget curve** (the MALBO slow knob): the policy-gate's risk-tier already classifies a turn's estate-value-at-risk; the curve maps it to a per-turn compute budget (model tier × cascade depth × ensemble width × verifier passes). The Lagrangian closed-form from arXiv:2604.14853 prices accuracy against cost per-instance under a *platform-wide* daily compute budget — so the budget-governor stops being a flat cap and becomes a **global compute allocator** that redistributes spend from easy lookups to high-value safety/licence/money decisions. **Same total spend, higher aggregate estate-protective accuracy.**

---

## 4. Findings (the survey verdicts that drive the build)

1. **The closed loop is the entire moat — and Borjie owns every part except the connective two organs.** OBSERVE (eval-drift) ✓, APPLY (Control-Tower/overrides/governor) ✓, GOVERN (four-eye/kill-switch/locked-cats) ✓, AUDIT (hash-chain) ✓. Missing: the **RECOMMEND learner** and the **canary→auto-promote bridge**.
2. **ParetoBandit (arXiv:2604.00136) is the single best-fit algorithm published.** Cost-as-optimization-variable + geometric forgetting + the *only* router tested under price-change + quality-regression + new-endpoint-absorption simultaneously — Borjie's exact production reality (Anthropic re-prices, ships new tiers, models drift).
3. **Split the learner by knob cadence:** ParetoBandit for fast per-turn knobs, MALBO Bayesian-opt for slow global knobs. One algorithm cannot serve both cadences well.
4. **Reuse EstateMind as the propose-only host** — the brief's "AI suggests" becomes "the system continuously self-tunes" by adding a *wiring* motivation drive to the loop that already proposes, leader-elected, behind the gate. Zero new orchestration spine.
5. **Canary the *config*, not the pod.** No 2026 vendor ships "canary a routing/ensemble config on a slice and auto-promote on a Pareto-win"; building it over eval-drift + OpenFeature targeting + an Argo-style AnalysisRun is a genuine frontier capability and a defensible differentiator.
6. **Policy-as-code is the non-negotiable safety gate on a self-tuning plane** (OWASP 2026 Agentic Top-10: goal-hijacking is the #1 risk). Borjie's `LOCKED_CATEGORIES` + four-eye + kill-switch are already Cedar-grade — make them the mandatory chokepoint on the optimizer's output.
7. **Off-policy evaluation with anytime-valid CIs is the promotion gate** — promote only on statistically-proven Pareto-dominance; the doubly-robust estimator is unbiased if *either* the reward model *or* the propensity weights are right, which is the right robustness bar for irreversible-adjacent wiring changes.
8. **Cost-aware compute autoscaling turns the budget-governor from a flat cap into a global allocator** — redistribute compute from easy→high-value turns for higher estate-protective accuracy at constant spend (arXiv:2604.14853, +12.8% MATH at matched budget).
9. **The homegrown eval-drift-logger is already a Langfuse-for-routing** — Borjie does not need to adopt Langfuse; it needs to *feed eval-drift's `passRate()` back into the routing decision*, not just into a pager.
10. **Flag-as-config is the universal APPLY substrate** — adopt OpenFeature's typed *evaluation context* (tenant tier / jurisdiction / locale / risk-class) so canary targeting, kill-switch, and per-tenant routing all become one flag evaluation, edge-evaluable (Cloudflare Flagship pattern) for zero added latency.

---

## 5. Beyond-Today leaps (per finding) + how each AMPLIFIES Borjie

- **[B1] Self-tuning wiring as a propose-only EstateMind drive.** *Beyond:* the control plane stops being a dashboard humans poke and becomes a **resident optimizer** that proposes a better routing config every cycle. *Amplifies:* every tenant's Mr. Mwikila silently gets cheaper + sharper week over week without an engineer touching a YAML — the cost curve bends down and the quality curve bends up *automatically*, and the owner sees an explainable "I re-tuned routing for your safety-critical turns" audit entry.
- **[B2] Geometric-forgetting absorbs model churn for free.** *Beyond:* when Anthropic ships a new tier or re-prices, the bandit *re-discovers* the new Pareto frontier within hours. *Amplifies:* Borjie is never stranded on stale routing after a provider change — the non-stationarity that breaks static routers is a *non-event*.
- **[B3] Config-canary with shadow mode.** *Beyond:* test a debate-ensemble on tailings-dam decisions with **zero** user risk (responses discarded, only scored). *Amplifies:* Borjie can trial *aggressive* high-compute wiring on its most consequential decisions with the safety of a flight simulator — the exact opposite of the usual "we daren't change routing in prod."
- **[B4] Value-weighted compute allocator.** *Beyond:* the platform spends opus+debate+verifier on a licence-suspension notice and haiku-single-shot on a date lookup, under one global daily compute budget. *Amplifies:* the estate's most expensive-to-get-wrong decisions get the *most* intelligence precisely when value-at-risk is highest — a mining-domain framing no generic gateway has.
- **[B5] Anytime-valid promotion gate.** *Beyond:* promotions are statistically proven, not vibes; rollbacks are automatic on the 5pp rule. *Amplifies:* the self-tuning loop is *trustworthy enough to leave on* — the regulator-facing audit trail shows every config change was canaried and CI-proven before it touched a tenant.
- **[B6] Policy-as-code chokepoint on the optimizer.** *Beyond:* a hijacked or mis-rewarded optimizer *cannot* route a legal/offtake/safety turn to a cheap model — the locked-category gate physically blocks it. *Amplifies:* Borjie can run an *autonomous* self-tuner on a regulated mining estate because the unhackable rails bound what it can ever do.

---

## 6. Borjie amplification (cross-organ synthesis)

- **Blackboard CRDT bus carries the live wiring config** as named LWW slots (`wiring.routing.<category>`, `wiring.ensemble.<category>`, `wiring.budget.curve`) — so every surface and every node sees the same current config + version-vector, and a canary is just a *second slot* the slice reads. The control plane gets cross-surface consistency *for free* from an organ already shipped.
- **The brain-llm-router's existing parts become the bandit's *action space*:** cost-cascade threshold, hedged on/off, judge-threshold, provider-fallback order, effort tier — the optimizer doesn't invent new mechanisms, it *learns the best settings of the dials Borjie already built*.
- **The budget-governor becomes the Lagrangian dual variable** of the global compute allocator — its `downgradeAtFraction` stops being a hand-set constant and becomes the *price of compute* the allocator tunes to hit the platform daily budget.
- **EstateMind + control plane = one mind tuning both the estate and itself** — the same propose-only loop that nudges a licence renewal also nudges its own wiring, both behind the same gate, both in the same audit chain. The brain becomes *metacognitively self-improving* without a separate system.
- **Multi-tenant by construction:** every learner is per-`(tenant, taskCategory)` and RLS-scoped; a tenant's tuning never leaks across the boundary, and a regulated KE/UG/NG tenant's jurisdiction rails bound its optimizer independently.

---

## 7. "We did not know we could do this" — the unlock items

- **[U1] The platform can A/B-test its own intelligence wiring like a growth team A/B-tests a button** — canary a new ensemble policy on 5% of turns, auto-promote on a proven cost×quality win, with the *same* progressive-delivery machinery a web team uses for features, but the "feature" is *how the brain thinks*.
- **[U2] Borjie can keep an open-ended *archive of wiring configs* (Darwinian, not greedy)** — not a single current-best but a branching lineage of routing/ensemble configs scored on replayed estate decisions, so a config that looks worse today can seed tomorrow's breakthrough (the DGM/ADAS lineage idea applied to *wiring* instead of *agent code*) — and a regression in one lineage never poisons the pool.
- **[U3] The cost the owner pays can *provably* track the value at risk** — because the compute allocator prices accuracy against cost per-instance, Borjie can show an owner "we spent $0.003 on your date lookup and $0.40 on your tailings-dam decision, and here's the math" — a *defensible, auditable* cost-to-value story no flat-rate competitor can tell.
- **[U4] A new model can be *evaluated into production* by the system itself** — drop a new endpoint into the registry; ParetoBandit's new-endpoint-absorption explores it on a safe shadow slice, the AnalysisRun proves or rejects it, and it promotes (or doesn't) *with no human routing decision and a full audit trail* — the platform onboards its own upgrades.
- **[U5] The control plane can run a *closed-loop FinOps* on intelligence** — a global daily compute budget paced across the day (ParetoBandit budget pacing) means Borjie can promise an owner a *fixed monthly intelligence spend* and have the system **self-ration** to hit it while protecting the highest-value turns first — turning unpredictable token bills into a contracted line item.
- **[U6] Every wiring change becomes regulator-grade evidence** — because each promotion is a hash-chained audit row with the canary verdict + CI + reward delta, Borjie can *prove to a mining regulator* that the model deciding a licence matter was canaried, CI-proven, and never routed below the locked-category floor — *control-plane changes as compliance artifacts*.

---

## 8. Concrete next steps (no code in this dossier — build order for a follow-up)

1. **Append** `valueAtRisk` + `delayedOutcome` to `EvalDriftEvent` (immutable add) → completes the reward vector.
2. **`@borjie/wiring-optimizer`** package: ParetoBandit (fast) + MALBO-style BO (slow), both emitting a `WiringCandidate`, both propose-only.
3. **`assertWiringCandidateAllowed()`** chokepoint reusing `LOCKED_CATEGORIES` + tier ceiling + kill-switch + jurisdiction rails.
4. **Config-Rollout primitive** (shadow + canary + AnalysisRun-over-eval-drift + doubly-robust/anytime-valid promotion) writing to the existing three APPLY backends; HIGH-impact → four-eye Control-Tower row.
5. **OpenFeature evaluation-context** on `platform-feature-flags` (tenant tier / jurisdiction / locale / risk-class) → enables % + targeted canary rollouts.
6. **Value→compute-budget curve** replacing the flat `effort` tier; budget-governor becomes the global allocator's dual variable.
7. **Wiring drive in EstateMind** so the resident Slow Loop proposes wiring configs alongside estate actions, leader-elected, audited.

---

## Sources

- ParetoBandit: Budget-Paced Adaptive Routing for Non-Stationary LLM Serving — https://arxiv.org/pdf/2604.00136 (fetched)
- Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey — https://arxiv.org/pdf/2603.04445 (fetched)
- Learning to Route LLMs from Bandit Feedback: One Policy, Many Trade-offs — https://arxiv.org/pdf/2510.07429
- LLM Bandit: Cost-Efficient LLM Generation via Preference-Conditioned Dynamic Routing — https://arxiv.org/abs/2502.02743
- MALBO: Optimizing LLM-Based Multi-Agent Teams via Multi-Objective Bayesian Optimization — https://arxiv.org/pdf/2511.11788
- RouterArena: An Open Platform for Comprehensive Comparison of LLM Routers — https://arxiv.org/pdf/2510.00202
- Adaptive Test-Time Compute Allocation for Reasoning LLMs via Constrained Policy Optimization — https://arxiv.org/abs/2604.14853
- Reasoning on a Budget: A Survey of Adaptive and Controllable Test-Time Compute in LLMs — https://arxiv.org/html/2507.02076v1
- Plan-and-Budget (ICLR 2026) — https://github.com/junhongmit/P-and-B
- GEPA: Reflective Prompt Evolution Can Outperform RL (ICLR 2026 Oral) — https://arxiv.org/pdf/2507.19457 · https://dspy.ai/api/optimizers/GEPA/overview/
- OpenFeature feature flags in Node.js 2026 — https://1xapi.com/blog/feature-flags-nodejs-openfeature-2026-guide
- Cloudflare Flagship: Edge-Native Feature Flag Service on OpenFeature (InfoQ, May 2026) — https://www.infoq.com/news/2026/05/cloudflare-flagship-openfeature/
- Feature Flags & the Path to Progressive Delivery 2026 (Zylos) — https://zylos.ai/research/2026-02-12-feature-flags
- Top 7 Feature Flag Tools 2026 (Flagsmith) — https://www.flagsmith.com/blog/top-7-feature-flag-tools
- Argo Rollouts — Progressive Delivery for Kubernetes — https://argoproj.github.io/rollouts/
- Flagger vs Argo Rollouts (Buoyant) — https://www.buoyant.io/blog/flagger-vs-argo-rollouts-for-progressive-delivery-on-linkerd
- LiteLLM Auto Routing — https://docs.litellm.ai/docs/proxy/auto_routing · Routing & Load Balancing — https://docs.litellm.ai/docs/routing-load-balancing
- Portkey vs LiteLLM vs OpenRouter 2026 — https://dibi8.com/resources/llm-frameworks/llm-gateway-portkey-litellm-openrouter-comparison-2026/
- LLM Gateway Architecture 2026 (Digital Applied) — https://www.digitalapplied.com/blog/llm-gateway-architecture-2026-engineering-reference
- Langfuse — Evaluation overview — https://langfuse.com/docs/evaluation/overview · Observability overview — https://langfuse.com/docs/observability/overview
- Langfuse alternatives 2026 (Laminar) — https://laminar.sh/article/langfuse-alternatives-2026
- OPA as the missing guardrail for AI agents (Codilime) — https://codilime.com/blog/why-use-open-policy-agent-for-your-ai-agents/
- Runtime Governance for AI Agents: Policy-as-Code with OPA (Gökalp) — https://gokhan-gokalp.com/runtime-governance-for-ai-agents-policy-as-code-with-opa/
- MCP Access Control: OPA vs Cedar (Natoma) — https://natoma.ai/blog/mcp-access-control-opa-vs-cedar-the-definitive-guide
- The Complete AI Guardrails Implementation Guide for 2026 (Maxim) — https://www.getmaxim.ai/articles/the-complete-ai-guardrails-implementation-guide-for-2026/
- Not-Diamond awesome-ai-model-routing — https://github.com/Not-Diamond/awesome-ai-model-routing
- AI Agent Model Routing 2026 (Zylos) — https://zylos.ai/research/2026-03-02-ai-agent-model-routing/
- Safe Exploration for Optimizing Contextual Bandits (ACM TOIS) — https://dl.acm.org/doi/abs/10.1145/3385670
- Doubly-Robust OPE / Anytime-valid off-policy inference for contextual bandits — https://www.mdpi.com/2227-7390/14/5/846

---

*Internal substrate referenced:* `services/api-gateway/src/routes/admin/control-tower.hono.ts`, `packages/brain-llm-router/src/{routing-overrides,cost-cascade,hedged-requests,judge-loop,eval-drift-logger,dspy-compile,effort,provider-fallback}`, `packages/llm-budget-governor/src/{governor,types}.ts`, `packages/database/src/schemas/{platform-feature-flags,feature-flags,platform-autonomy-settings}.schema.ts`, `packages/blackboard-sota/`, EstateMind Slow Loop (`packages/central-intelligence/` situational-model + motivation + tick).
