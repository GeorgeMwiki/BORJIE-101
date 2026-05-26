# Self-Improvement + Differential-Privacy Federation — Design Specification

> Wave **SELFIMPROVE**. Pillars: meta-learning conductor (closes the
> capability-catalogue feedback loop) and DP-federation primitives
> (lets the kernel learn across tenants without leaking any one
> tenant's data).
>
> Sibling specs:
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`RLVR_POST_TRAINING_SPEC.md`](./RLVR_POST_TRAINING_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`OMNI_P2_SOCIAL_CONNECTORS_SPEC.md`](./OMNI_P2_SOCIAL_CONNECTORS_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila — Borjie's autonomous Managing
Director for Tanzanian mining operators. Status: design-spec.

---

## 1. Thesis — Mr. Mwikila gets sharper every week, without a single tenant noticing

Two disciplines, one wave.

1. **Meta-learning conductor** — the daemon that turns capability-catalogue
   measurements into a curated training corpus, runs an evaluation on a
   held-out set, and decides whether the new policy is promoted into the
   catalogue, demoted, kept in place, or rolled back. The catalogue measures;
   the conductor *acts*.
2. **Differential-privacy federation** — the primitives that let
   cross-tenant aggregates (averages, gradients, frequency counts) flow into
   shared learning without any single tenant's records being recoverable.
   Per-tenant Rényi-DP budgets ($\varepsilon, \delta$) are charged on every
   aggregate, audited, and locked when the budget is exhausted.

Both disciplines are *transparent* to the owner. Every promotion is
named in the weekly self-improvement report. Every DP charge appears in
the privacy-ledger tab. The MD never gets smarter behind the owner's
back, and never spends the tenant's privacy budget without the owner
seeing the receipt.

---

## 2. The meta-learning loop — anatomy

A single run is a six-stage pipeline:

```
catalogue measurement  →  curate examples  →  shape rewards
       ↑                                              │
       │                                              ↓
   promote/demote/no-op/rollback ←  evaluate  ←  (delegate to RLVR)
```

### 2.1 Trigger

The conductor runs on a schedule (default daily for the production
tenant, hourly in staging) or on demand when the catalogue reports a
*regression* — a capability's rolling success-rate falls below a
configurable floor.

### 2.2 Curate examples

The curator pulls traces from `decision_traces` (the existing
audit-chain), redacts PII via the omnidata redactor, deduplicates by
canonical-JSON hash, and labels each example with the capability under
test. Trace-level rewards are inherited from the cognitive-engine
reward signal; the curator also computes a *coverage score* (how
broadly the example exercises the capability's surface) and a
*confidence score* (whether the trace was high or low confidence).

Examples below a minimum reward floor or above a redaction-failure
threshold are excluded.

### 2.3 Reward shaping

If the [`packages/rlvr/`](../STRATEGY/RLVR_POST_TRAINING_SPEC.md) RLVR
package is present, the conductor delegates reward computation to it.
Otherwise it applies a default shaping: $r = \alpha \cdot
\text{base} + \beta \cdot \text{coverage} - \gamma \cdot
\text{redaction-penalty}$.

### 2.4 Evaluate

The evaluator runs the capability on a held-out eval set both *before*
(current policy) and *after* (proposed policy). It reports a single
metric (default: success-rate; user-overridable). Holdouts are
tenant-scoped — no cross-tenant leakage at eval time.

### 2.5 Decide

The promotion decider applies four rules:

- **promote** if $\Delta \geq \tau_{\text{promote}}$ and statistical
  significance holds (Wilson lower-bound > previous mean).
- **demote** if $\Delta \leq -\tau_{\text{demote}}$ and significance
  holds.
- **rollback** if the previous run was a promotion *and* this run shows
  regression — instantly reinstates the prior policy.
- **no-op** otherwise.

### 2.6 Persist + audit

Every decision is written to `meta_learning_runs` with a
`prev_hash → audit_hash` link (chained per tenant). The curated
examples land in `meta_learning_examples` for replay + tribunal
review.

The capability-catalogue is updated through its **port** (we depend on
a structural interface `CapabilityCataloguePort`, not on the concrete
types — that keeps Wave CAPABILITY freely refactorable).

---

## 3. DP federation — background

### 3.1 $(\varepsilon, \delta)$-differential privacy

A randomised mechanism $M$ is $(\varepsilon, \delta)$-differentially
private iff for all neighbouring datasets $D, D'$ (differing by one
record) and all $S \subseteq \text{range}(M)$,

$$\Pr[M(D) \in S] \leq e^{\varepsilon} \Pr[M(D') \in S] + \delta.$$

The standard reference is Dwork & Roth's monograph
[*The Algorithmic Foundations of Differential Privacy* (2014)](https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf)
— title: "The Algorithmic Foundations of Differential Privacy", Cynthia
Dwork & Aaron Roth, Foundations & Trends in TCS, 2014.

### 3.2 Rényi DP

Rényi differential privacy (Mironov, 2017) is the composition-friendly
relaxation. A mechanism is $(\alpha, \varepsilon_\alpha)$-RDP iff the
Rényi divergence of order $\alpha$ between $M(D)$ and $M(D')$ is at
most $\varepsilon_\alpha$ for all neighbouring $D, D'$. Composition is
additive in $\varepsilon_\alpha$ at fixed $\alpha$.

Reference: [Mironov 2017 — *Rényi Differential Privacy*](https://arxiv.org/abs/1702.07476)
— title: "Rényi Differential Privacy", Ilya Mironov, CSF 2017,
2017-08-21.

### 3.3 The Gaussian mechanism — RDP curve

For the Gaussian mechanism with sensitivity $1$ and noise scale
$\sigma$, the RDP curve is

$$\varepsilon_\alpha = \frac{\alpha}{2 \sigma^2}.$$

For subsampled Gaussian (DP-SGD), Wang, Balle, Kasiviswanathan
(2019) give the tight numerical bound.

References:
- [Abadi et al. 2016 — *Deep Learning with Differential Privacy*](https://arxiv.org/abs/1607.00133)
  — title: "Deep Learning with Differential Privacy", Abadi, Chu,
  Goodfellow, McMahan, Mironov, Talwar, Zhang, CCS 2016,
  2016-07-01. Introduces DP-SGD + moments accountant.
- [Wang, Balle, Kasiviswanathan 2019 — *Subsampled Rényi Differential Privacy and Analytical Moments Accountant*](https://arxiv.org/abs/1808.00087)
  — title: "Subsampled Rényi Differential Privacy and Analytical
  Moments Accountant", AISTATS 2019, 2018-08-01.
- [Apple DP Team — *Learning with Privacy at Scale*](https://docs-assets.developer.apple.com/ml-research/papers/learning-with-privacy-at-scale.pdf)
  — title: "Learning with Privacy at Scale", Apple Machine Learning
  Journal Vol 1, Issue 8, 2017-12-01.
- [Google DP library](https://github.com/google/differential-privacy)
  — title: "Google's differential privacy libraries", GitHub repo,
  accessed 2026-05-25.
- [OpenDP project](https://opendp.org/) — title: "OpenDP: Open-Source
  Tools for Differential Privacy", Harvard / Microsoft, accessed
  2026-05-25.

### 3.4 RDP → $(\varepsilon, \delta)$ conversion

Given a composed RDP curve $\{(\alpha_i, \varepsilon_{\alpha_i})\}$, the
tightest $(\varepsilon, \delta)$ pair at a target $\delta$ is

$$\varepsilon = \min_\alpha \left( \varepsilon_\alpha + \frac{\log(1/\delta)}{\alpha - 1} \right).$$

The conductor uses the closed-form Mironov bound for unsubsampled
Gaussian and the Wang–Balle–Kasiviswanathan numeric formula for
subsampled Gaussian, picking the tighter of the two per query.

### 3.5 Per-tenant $\varepsilon$-budget

Every tenant has a tenant-level budget $\varepsilon_{\text{tot}}$ and
$\delta_{\text{tot}}$. The default in the schema is $\varepsilon_{\text{tot}} = 4.0$
per quarter and $\delta_{\text{tot}} = 10^{-5}$, in line with Apple's
deployed system and the Google DP library defaults. The owner can
edit the budget through the privacy-ledger tab (gated by
mutation-authority).

Every DP operation issues a *charge*:

```
op       → (α-curve, q, σ, op_id, period_start)
charge   → (ε_op, δ_op)        # from RDP composition + conversion
ledger   → row in dp_charges
remaining → εtot - Σ εop
```

If `remaining < ε_op`, the operation is **blocked** and an
`ai_audit_chain` entry records the denial.

### 3.6 Cross-tenant aggregation

The cross-tenant aggregator pulls per-tenant sufficient statistics
(e.g. a clipped mean), applies the Gaussian mechanism at the
tenant-side with the tenant's budget, and combines the noisy
statistics centrally. The central combiner does **not** see raw
per-tenant data — only noisy aggregates. This is the *local* DP regime
on the cross-tenant side, with central DP applied per-tenant on the
within-tenant side. Same security guarantee, simpler implementation,
zero trust in the central combiner.

---

## 4. Audit trail

Every promotion, demotion, no-op, rollback, and DP charge is hashed
into the `audit_hash`/`prev_hash` chain (one chain per
`(tenant, kind)` pair). Verification is a pure recompute; the
`verify-meta-learning-chain` job runs nightly.

Two complementary tables:

- **`meta_learning_runs`** — one row per conductor run. Audit-chained
  per `(tenant, capability_id)`.
- **`dp_charges`** — one row per DP operation. Audit-chained per
  `(tenant, period_start)`.

The strategic-layer `epsilon_budgets` and `epsilon_ledger` tables —
owned by `packages/strategic-layer/` — *sum* the `dp_charges` rows for
the owner-facing privacy ledger. This per-operation table is the
ground truth; the strategic-layer rollups are presentation-only.

---

## 5. Package layout

### 5.1 `@borjie/meta-learning-conductor`

```
src/
  types.ts                       MetaLearningRun, Example, Decision
  curator/
    example-curator.ts           pull traces, redact, dedupe, shape rewards
  evaluator/
    evaluator.ts                 before/after eval on held-out
  decider/
    promotion-decider.ts         promote/demote/no-op/rollback
  runner/
    meta-learning-runner.ts      orchestrate the loop
  repositories/
    in-memory-repo.ts            in-memory MetaLearningRunRepository
    sql-repo.ts                  SQL MetaLearningRunRepository
  index.ts
```

The runner depends on three injected ports:

- `CapabilityCataloguePort` — read measurements, write promotion
  decisions. Structural interface only; we do not import the catalogue
  package's types.
- `TraceSource` — pull decision traces by capability and time window.
- `Evaluator` — run the held-out eval (defaulted to a built-in
  implementation; production code injects an LLM-backed one).

### 5.2 `@borjie/dp-federation`

```
src/
  types.ts                       EpsilonBudget, DpCharge, RdpAccountant
  composition/
    rdp-accountant.ts            Renyi composition (additive in ε_α)
    rdp-to-dp.ts                 RDP → (ε,δ) conversion
  charges/
    charge-tracker.ts            record charge, return remaining budget
  aggregate/
    dp-mean.ts                   DP mean with Gaussian noise
  repositories/
    dp-charges-repository.ts     in-memory + SQL
  index.ts
```

Numerics are validated against the closed-form Mironov bound. The
test suite includes a published reference vector: for $\sigma = 5,
T = 1000, q = 0.01, \delta = 10^{-5}$ (Mironov 2017 Table 1), the
expected $\varepsilon$ is $\approx 1.26$. Our implementation must match
to within $10^{-2}$ on the unsubsampled curve and we mark the
subsampled-Gaussian Wang reference as xfail-with-citation if our
numerics deviate by more than $10^{-6}$ from the closed form (we ship
only the closed-form bound in this wave; the subsampled numeric
estimator lands in a follow-up).

---

## 6. Prior art the conductor builds on

- [Letta — *Self-Improvement at the Memory Layer*](https://www.letta.com/blog/self-improvement)
  — title: "Self-Improvement at the Memory Layer", Letta engineering
  blog, 2024-06-15. The architectural sketch of persistent agents
  rewriting their own memory through structured reflection.
- [Wang et al. 2023 — *Voyager: An Open-Ended Embodied Agent with Large Language Models*](https://arxiv.org/abs/2305.16291)
  — title: "Voyager: An Open-Ended Embodied Agent", NeurIPS 2023,
  2023-05-25. The skill-library + iterative-prompting loop that
  inspires our promote/demote semantics.
- [Madaan et al. 2023 — *Self-Refine: Iterative Refinement with Self-Feedback*](https://arxiv.org/abs/2303.17651)
  — title: "Self-Refine: Iterative Refinement with Self-Feedback",
  NeurIPS 2023, 2023-03-30. The single-turn reflect-then-revise loop
  that the curator borrows.
- [Shinn et al. 2023 — *Reflexion: Language Agents with Verbal Reinforcement Learning*](https://arxiv.org/abs/2303.11366)
  — title: "Reflexion: Language Agents with Verbal Reinforcement
  Learning", NeurIPS 2023, 2023-03-20.
- [Arxiv 2506.05109 — *Truly Self-Improving Agents Require Intrinsic Metacognitive Learning*](https://arxiv.org/abs/2506.05109)
  — title: "Truly Self-Improving Agents Require Intrinsic
  Metacognitive Learning", Arxiv, 2025-06-05.
- [Arxiv 2508.00271 — MetaAgent](https://arxiv.org/abs/2508.00271)
  — title: "MetaAgent: Self-Evolving Tool Meta-Learning",
  Arxiv 2508.00271, 2025-08-01.

---

## 7. Failure modes + mitigations

| Failure mode | Mitigation |
|---|---|
| Reward-hacking | Held-out eval set is rotated weekly; conductor never trains on the eval set. |
| Catastrophic forgetting | Rollback is automatic when a promotion regresses; the previous policy is kept in the catalogue for $\geq 30$ days. |
| Privacy-budget exhaustion | The DP-charge tracker blocks operations when remaining budget falls below the requested $\varepsilon$. The owner is notified before the budget is gone. |
| Audit-chain tampering | `prev_hash → audit_hash` per `(tenant, kind)`; nightly verifier; the chain is append-only at the SQL level. |
| Distribution shift | The catalogue's measurement layer (Wave CAPABILITY) detects drift; the conductor schedules a re-eval when drift exceeds threshold. |
| Cross-tenant contamination | DP federation is *local* on the cross-tenant side; the central combiner sees only noisy aggregates, never raw records. |

---

## 8. Live-test discipline

- The conductor's HTTP-touching surface (catalogue port + trace
  source) is behind injected ports. Tests pass deterministic stubs.
- The DP numerics test compares against the published Mironov 2017
  Table 1 reference: $\sigma = 5, T = 1000, q = 0.01, \delta =
  10^{-5} \Rightarrow \varepsilon \approx 1.26$. The unsubsampled
  closed-form check uses $\sigma = 1, T = 1 \Rightarrow \varepsilon_\alpha
  = \alpha / 2$.
- The DP-mean noise std-dev is verified statistically on $N = 10000$
  samples with a tolerance proportional to $\sigma / \sqrt{N}$.
- No real cross-tenant data is ever in scope at test time — tenants
  are deterministic stubs.

---

## 9. Glossary

- **Capability** — a named policy in the capability-catalogue. Has a
  measured success-rate, latency, cost.
- **Curated example** — a redacted, deduplicated, reward-shaped
  trace that the curator deems suitable for training.
- **Hold-out set** — a per-tenant eval set the conductor never trains
  on.
- **Charge** — a single DP operation's $(\varepsilon, \delta)$ cost.
- **Budget** — the tenant's quarter-long total $(\varepsilon_{\text{tot}},
  \delta_{\text{tot}})$.
- **Rényi composition** — the additive-in-$\varepsilon_\alpha$ rule
  that makes per-operation accounting tractable.
- **Conductor** — the orchestrator that owns the meta-learning loop.

---

## 10. Open questions resolved

- **Why a separate package and not part of the catalogue?** The
  catalogue *measures*; the conductor *acts*. Separation of concerns
  + the catalogue stays composable for non-self-improving consumers.
- **Why Rényi DP and not the moments accountant directly?** RDP is
  the modern composition-friendly formulation; moments accountant is
  a special case at $\alpha = $ many. Mironov 2017 + Wang 2019 give us
  the tight bounds for our exact noise distribution.
- **Why store `dp_charges` rows and not just budgets?** The owner can
  audit any operation back to its origin. Privacy budget management
  without per-charge ground truth is opaque; we refuse opaque privacy.
- **Why per-tenant chains instead of one global chain?** Tenant
  isolation. A global chain is a side channel.
- **Why does the strategic-layer keep its own `epsilon_budgets`
  table?** Because owner-facing rollups are a separable concern from
  per-operation accounting. The strategic-layer table sums
  `dp_charges`; this wave does not modify it.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

---

## § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

This section is the immutable reconciliation record of founder-locked decisions that override prior defaults in this spec. Idempotent — re-running the reconcile pass is a no-op once this section exists. Persona: Mr. Mwikila.

### Override — Decision #5 (Meta-learning consent path — unified via federation_consents)

**Verbatim**: *FOLD into federation consent. Cross-tenant template sharing IS a federation-consent surface; do NOT build a separate consent UI. … Meta-learning weekly reports (Wave SELFIMPROVE) MUST consume the same `federation_consents` table; do NOT create a parallel consent path.*

**Effect on this spec**:
- `packages/meta-learning-conductor/` reads consent state from the existing `federation_consents` table (per Wave M10 migration 0040), NOT from any new table or any sibling consent surface.
- The `scope` filter for meta-learning aggregation is the union of `federation_consents` rows whose `scope` covers the gradient class being aggregated (e.g. `scope = 'meta_learning'` for cross-tenant gradient sharing; `scope = 'tools'` for template-derived patterns).
- No parallel consent UI; tenants manage every cross-tenant data flow through the single federation-consent dashboard surfaced by `packages/strategic-layer/` (see `Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md`).
- Cross-reference: `Docs/DESIGN/ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md` shares this consent path on the producer side (template authoring).

**Action**: Confirm `packages/meta-learning-conductor/` has no separate consent state, no separate opt-in toggle, no separate audit trail — every revocation path flows back to `federation_consents` mutations.

**Rationale**: Founder-locked unification: one consent table, one revocation path, one audit trail. Splitting consent across meta-learning and template-sharing surfaces would create the exact "consent maze" the federation_consents design was built to prevent.
