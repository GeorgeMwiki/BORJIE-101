# Intelligence Self-Improve Wiring 2026 — Design Specification

> Wave: **INTEL-SELF-IMPROVE**.
> Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
> Tanzanian mining operators.
> Companion package: `@borjie/intel-self-improve`.
> Companion migration: `packages/database/drizzle/0072_intel_self_improve.sql`.
> Companion drizzle schema: `packages/database/src/schemas/intel-self-improve.schema.ts`.
> Sibling specs:
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md`](./SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md),
> [`RLVR_POST_TRAINING_SPEC.md`](./RLVR_POST_TRAINING_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`CALIBRATION_INTERPRETABILITY_SPEC.md`](./CALIBRATION_INTERPRETABILITY_SPEC.md),
> [`FORECASTING_SOTA_2026.md`](./FORECASTING_SOTA_2026.md),
> [`DATA_ANALYSIS_SOTA_2026.md`](./DATA_ANALYSIS_SOTA_2026.md),
> [`GRAPH_DATABASE_SOTA_2026.md`](./GRAPH_DATABASE_SOTA_2026.md),
> [`CAUSAL_INFERENCE_SOTA_2026.md`](./CAUSAL_INFERENCE_SOTA_2026.md),
> [`ANOMALY_DETECTION_SOTA_2026.md`](./ANOMALY_DETECTION_SOTA_2026.md).

---

## 1. Founder directive

> *"all that daviz and stuff part of our self improving loop too"*
> — George Mwikila Macharia, 2026-05-27.

The SOTA-INTEL stack (forecasting, data-analysis, graph-database,
graph-viz, causal-inference, anomaly-detection, recommendations) is
**not** a passive set of utilities. Every forecast, statistical test,
graph query, causal estimate, anomaly score and recommendation Mr.
Mwikila emits is measured against ground truth, scored on three
independent axes, curated into training pairs, fed through RLVR
verifiers ([Reinforcement Learning from Verifiable Rewards — Lambert
et al., "Tülu 3: Pushing Frontiers in Open Language Model Post-
Training", arXiv 2411.15124, November
2024](https://arxiv.org/abs/2411.15124)) and used to promote or demote
the underlying capability in the catalogue lifecycle. The intel stack
is **part of the same loop** that promotes `research_v1` and
`compose_anything_v1`, not a parallel one.

This document specifies the **wiring contract**: how each intel
package adapter implements `MeasuredCapability`, how invocations and
outcomes flow into the existing self-improving substrate, the per-
intel-kind measurement formulas, the RLVR verifiers we add, and the
lifecycle gates the intel packages must obey.

---

## 2. The integration pattern

Every intel package exposes one or more domain functions of the shape
`(input) => Promise<output>` (forecasting emits forecasts, data-
analysis runs tests, graph-database returns query results, etc.).
None of those signatures know anything about the self-improving loop.
We do **not** modify the domain code. Instead, the intel-self-improve
package provides a single higher-order wrapper, `wrapAsMeasured`,
which takes any such function plus a small `MeasuredCapability`
descriptor (the capability id, the intel kind, the claimed-confidence
extractor, the input/output hash extractors) and returns a new
function with identical signature that — on every call — :

1. Generates an invocation id and audit hash chained from the prior
   intel-invocation row.
2. Records a row into `intel_invocation_audit` capturing the inputs,
   the outputs, the claimed confidence, latency, cost in USD cents,
   and the linked `capability_id`.
3. Records a peer row into `capability_invocations` (the canonical
   `@borjie/capability-catalogue` table) so the existing measurement
   worker observes the call.
4. Pushes a pattern fingerprint into `intel_skill_traces` so similar
   inputs accumulate success/failure counters — the "skill library"
   Mr. Mwikila uses to recall what worked before. This mirrors the
   [Voyager skill library (Wang et al., "Voyager: An Open-Ended
   Embodied Agent with Large Language Models", arXiv 2305.16291,
   May 2023)](https://arxiv.org/abs/2305.16291) pattern adapted from
   Minecraft to mining domain workflows.
5. Returns the unchanged output to the caller.

Steps 1–4 happen in a fire-and-forget telemetry path. The caller
sees no latency overhead beyond audit-hash chaining (sub-millisecond
on commodity hardware per
[Trillian benchmarks, 2022](https://github.com/google/trillian)).

A second wrapper, `withOutcomeObserver`, registers the invocation in
the **outcome-observer queue** — a cron-driven worker that, after the
intel-kind's measurement horizon elapses, looks up the actual
observed value (the forecast horizon's true number, the labelled
anomaly outcome, the recommendation's click feedback) and writes an
`Outcome` row through the existing capability-catalogue port. From
that point the meta-learning-conductor's curator sees the row and
shapes it into a training example exactly as it already does for
research/compose traces.

---

## 3. Per-axis measurement per intel kind

The capability-catalogue scores every capability on three axes:
**competence** (did the answer work), **calibration** (was the claimed
confidence honest), **utility** (did the user act on it). Each intel
kind reduces to those axes deterministically. The formulas below are
the canonical mapping — `@borjie/intel-self-improve`'s measurers
implement exactly these.

### 3.1 Forecast

- **Competence:** did the realised value at the forecast horizon fall
  inside the predicted **80 %** interval (`compRate_80`) and the
  **95 %** interval (`compRate_95`)? The aggregate competence rate is
  `0.5 * compRate_80 + 0.5 * compRate_95`. This is the classic
  *interval coverage* score from probabilistic forecasting — see
  [Gneiting & Raftery, "Strictly Proper Scoring Rules, Prediction,
  and Estimation", J. Amer. Statist. Assoc. 102 (2007):
  359–378](https://www.tandfonline.com/doi/abs/10.1198/016214506000001437).
- **Calibration:** the deviation between claimed nominal coverage and
  empirical coverage rate, averaged over both intervals. A perfectly
  calibrated forecast emits 80 % intervals that capture truth 80 % of
  the time. CalibrationError = `|empirical_80 − 0.80| +
  |empirical_95 − 0.95|`, bounded to `[0, 1]`. See [Vovk et al.,
  *Algorithmic Learning in a Random World*, 2nd ed., Springer 2022,
  Ch. 1–3](https://link.springer.com/book/10.1007/978-3-031-06649-8)
  on conformal prediction for the canonical theory.
- **Utility:** did the user act on the forecast within the user-
  followthrough window? `accepted` and `modified` ⇒ utility = 1;
  `rejected` or `ignored` ⇒ utility = 0.

### 3.2 Stat

- **Competence:** for a hypothesis test, did the test return a well-
  formed result (statistic + p-value + df where applicable + non-NaN
  numbers)? For a confidence-interval test, did the bootstrap
  resample cover the labelled true value within the nominal level?
  Aggregate over the call's logical outputs.
- **Calibration:** under the null (matched control fixtures shipped
  in `__fixtures__/`), the empirical false-positive rate should equal
  `alpha`. CalibrationError = `|empirical_fpr − alpha|` clamped.
- **Utility:** did the operator accept the test's recommendation —
  e.g., did they file the difference-in-means report after a
  significant t-test? Recorded via the same `userFollowthrough` enum.

### 3.3 Graph-DB

- **Competence:** did the query return a non-empty result AND match
  the expected output shape declared in the capability contract? An
  empty result for a "find all licences" call is a fail; an empty
  result for a "find all denied buyers" call may be a pass — the
  capability contract carries the expected-cardinality predicate.
- **Calibration:** did the user follow-up confirm the graph claim?
  Confirmation rate over a 28-day window.
- **Utility:** did the graph result drive a decision — i.e., was the
  graph row cited in a downstream artifact (`cite` operation in
  `@borjie/cognitive-memory`)?

### 3.4 Causal

- **Competence:** is the identified estimate stable under refutation
  tests (placebo treatment, random subset, sensitivity analysis)?
  Pass if at least 2 out of 3 refutations leave the point estimate
  within `±10%`. This follows [DoWhy's refutation framework — Sharma
  & Kıcıman, "DoWhy: An End-to-End Library for Causal Inference",
  arXiv 2011.04216, November
  2020](https://arxiv.org/abs/2011.04216).
- **Calibration:** the empirical CI coverage at the claimed
  confidence level on labelled benchmark cases.
- **Utility:** did the operator implement the intervention the causal
  estimate recommended? `accepted` ⇒ utility = 1.

### 3.5 Anomaly

- **Competence:** precision and recall on the labelled-anomaly
  evaluation set. Aggregate competence rate = F1 score. Labelled
  anomalies are sourced from the existing
  `services/wave-resilience-manager` incident table.
- **Calibration:** the distribution of anomaly scores under the null
  (normal operating periods); empirical false-positive rate at the
  chosen threshold compared to the claimed FPR. See [Görnitz et al.,
  "Toward Supervised Anomaly Detection", JAIR 46 (2013):
  235–262](https://www.jair.org/index.php/jair/article/view/10802).
- **Utility:** did the operator investigate the flagged anomaly
  within the SLA window? Investigation events stream from
  `services/wave-resilience-manager`'s investigate-ack channel.

### 3.6 Recommendation

- **Competence:** top-K hit rate — did the user click any of the top
  K recommendations within the feedback window? K is read from the
  capability contract (default K = 5). This is the standard offline
  IR evaluation metric — see [Cremonesi, Koren & Turrin, "Performance
  of recommender algorithms on top-n recommendation tasks", ACM
  RecSys 2010](https://dl.acm.org/doi/10.1145/1864708.1864721).
- **Calibration:** the predicted click-probability score distribution
  vs. the empirical click rate at each score bucket — the standard
  reliability-diagram check from [DeGroot & Fienberg, "The Comparison
  and Evaluation of Forecasters", The Statistician 32 (1983):
  12–22](https://www.jstor.org/stable/2987588).
- **Utility:** conversion / dismissal rate. Conversion ⇒ utility = 1;
  dismissal ⇒ utility = 0.

---

## 4. Cross-package data flow

```
domain-call(input)
   │
   ▼
wrapAsMeasured                                          ┌─ intel_invocation_audit
   ├─ emit invocation row ────────────────────────────► │  (per-intel detail)
   ├─ emit capability_invocation row ─────────► capability_invocations
   ├─ tick intel_skill_traces (pattern fingerprint) ──► intel_skill_traces
   └─ return output to caller
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
outcome-observer (cron)
   ├─ horizon-reached forecast    → measure-forecast      → Outcome
   ├─ labelled anomaly cohort     → measure-anomaly       → Outcome
   ├─ recommendation feedback     → measure-recommendation→ Outcome
   ├─ stat-test followthrough     → measure-stat          → Outcome
   ├─ graph-query followthrough   → measure-graph         → Outcome
   └─ causal refutation cron      → measure-causal        → Outcome
        │
        ▼
capability-catalogue::OutcomeRepository.insert
        │
        ▼
capability-measurement-worker (existing — 7d / 28d / 91d windows)
   ├─ computeCompetence
   ├─ computeCalibration
   ├─ computeUtility
   └─ aggregateMeasurement → capability_measurements
        │
        ▼
meta-learning-conductor::curator
   ├─ pulls intel_invocation_audit + Outcome
   ├─ shapes Example { prompt, completion, reward }
   └─ persists via MetaLearningRunRepository
        │
        ▼
post-training-rlvr::RlvrRunner
   ├─ verifyAll(trace) using intel-specific verifiers (§5)
   ├─ shapeReward
   ├─ curate (dedup, redact, exclude)
   └─ hand off to fine-tuner
        │
        ▼
calibration-monitor (Brier / ECE) → reliability diagrams
cognitive-memory::observe        → durable memory cell
persistent-memory::SkillLibrary  → reusable pattern record
```

Every arrow above is **idempotent** and **audit-chained**. The
audit-hash chain is rooted in `@borjie/audit-hash-chain`'s
`chainHash`, which is the canonical primitive across the platform —
see [`audit-hash-chain/src/chain.ts`](../../packages/audit-hash-chain/src/chain.ts).

---

## 5. RLVR verifiers added

`@borjie/post-training-rlvr` already ships six built-in verifiers
(citation-resolves, tra-schema, royalty-math, brand-lock,
calibration, mutation-authority). The intel-self-improve wave adds
**six more**, each implementing the existing `Verifier` port from
`@borjie/post-training-rlvr` (see
`packages/post-training-rlvr/src/types.ts`, lines 97–102). The shape
is the same: `name`, `version`, `applies(trace)`, `verify(trace) →
Promise<VerificationResult>`. Each new verifier inspects the trace's
`metadata` for the intel-kind sentinel and pulls the relevant
ground-truth fields the outcome-observer attached.

| Verifier name                       | Source kind     | Pass criterion                                                  |
| ----------------------------------- | --------------- | --------------------------------------------------------------- |
| `forecast-interval-coverage`        | forecast        | observed value ∈ predicted interval                             |
| `stat-result-shape`                 | stat            | result has well-formed `statistic`, `pValue`, `nObservations`   |
| `graph-query-non-empty`             | graph_db        | result is non-empty and matches output schema                   |
| `causal-refutation-stable`          | causal          | ≥ 2 of 3 refutations leave estimate within ±10%                 |
| `anomaly-precision-recall`          | anomaly         | F1 ≥ 0.7 against labelled set in trace metadata                 |
| `recommendation-hit-rate`           | recommendation  | ≥ 1 of top-K clicked within feedback window                     |

Each verifier:

- Returns `verdict = 'skip'` when the trace metadata does not carry
  the required ground-truth fields (e.g. forecast horizon not yet
  reached). This is consistent with the existing
  `calibration` verifier's behaviour.
- Clamps `reward` to `[0, 1]`.
- Returns evidence including the raw inputs so the curator can dedupe
  and the reviewer can inspect.

---

## 6. Lifecycle wiring

The capability-catalogue lifecycle is `draft → shadow → live →
locked → deprecated`. Intel capabilities follow the same path:

- **draft → shadow**: a new intel capability (e.g.
  `forecast_chronos_v0.2.0`) is registered with `lifecycleState =
  'shadow'`. Its `wrapAsMeasured` wrapper is invoked alongside the
  current `live` version's wrapper, but its outputs are discarded
  upstream.
- **shadow → live**: promotion requires
  `competenceRate ≥ promoteThreshold` (default 0.7 — see
  `DEFAULT_THRESHOLDS` in
  [`packages/capability-catalogue/src/lifecycle/lifecycle-manager.ts`](../../packages/capability-catalogue/src/lifecycle/lifecycle-manager.ts))
  AND `calibrationError ≤ 0.1` AND `nObservations ≥ 30` measured over
  the 28-day window. The decider is the existing
  `decideLifecycle` function — no intel-specific logic is added at
  the decider; instead the per-axis measurers feed the same
  thresholds.
- **live → locked**: triggered when `calibrationError` drifts above
  0.25 (calibration drift detector — analogous to the [Adversarial
  Calibration Detection method, Tygert,
  arXiv 2206.13494, June
  2022](https://arxiv.org/abs/2206.13494)).
- **locked → deprecated**: triggered when `utilityRate` over a 91-day
  window falls below 0.1 — the capability is technically correct but
  no operator is acting on it.

---

## 7. Patch contract for the seven intel packages

Each intel package, **if it exists**, is patched additively as
follows:

1. Add `"@borjie/intel-self-improve": "workspace:*"` to its
   `dependencies` block.
2. In the package's `src/index.ts`, re-export a `measured*` factory
   for each domain function — e.g.
   `measuredForecastChronos(...)`, `measuredAnomalyDetect(...)`,
   `measuredCypherQuery(...)`. Each factory accepts the original
   function plus a `MeasuredCapability` descriptor and returns a
   wrapped function with the identical input/output signature.
3. No domain-code edits. No breaking changes. The original exports
   stay intact — callers can opt in by switching to the `measured*`
   factory at composition root.

For packages that do not yet exist at the time of this PR
(causal-inference, anomaly-detection, recommendations may be still
en route from sibling agents), the patch instructions above are
recorded here verbatim so the sibling can apply them once they
land. The wiring package is forward-compatible: the wrappers do not
import any sibling package directly; they only depend on
`@borjie/capability-catalogue`, `@borjie/audit-hash-chain` and
`@borjie/observability`.

---

## 8. Status of sibling packages at PR time

| Package                       | Status              | Patch applied?                |
| ----------------------------- | ------------------- | ----------------------------- |
| `@borjie/forecasting`         | EXISTS              | Yes — `measuredForecast()`    |
| `@borjie/data-analysis`       | EXISTS              | Yes — `measuredStat()`        |
| `@borjie/graph-database`      | EXISTS              | Yes — `measuredGraphQuery()`  |
| `@borjie/graph-viz`           | EXISTS              | Documented (UI surface only)  |
| `@borjie/causal-inference`    | NOT YET LANDED      | Pattern documented            |
| `@borjie/anomaly-detection`   | partial — anomaly subdir in `@borjie/forecasting` | Pattern documented |
| `@borjie/recommendations`     | NOT YET LANDED      | Pattern documented            |

When a sibling agent lands a missing package, the patch is a
one-commit addition: add the dependency line, re-export the
`measured*` factory, point its capability id at the row registered
during package bootstrap.

---

## 9. Non-goals

- **No prediction logic inside the wrapper.** `wrapAsMeasured` does
  not compute forecasts, detect anomalies, run queries. It only
  observes calls, emits telemetry, and returns the underlying
  output. Domain logic stays in the domain package.
- **No retraining inside the wrapper.** The wrapper does not call
  the meta-learning-conductor synchronously. Retraining is a
  separate cron-driven workflow consuming the telemetry the wrapper
  emits.
- **No mutation of the existing capability-catalogue API.** Every
  artefact here is additive. The lifecycle decider, the measurement
  aggregator, the registry — all untouched.
- **No cross-tenant data leakage.** The intel tables enforce the
  canonical `app.tenant_id` RLS pattern from migration 0003.
  Cross-tenant aggregation only happens through DP-federation
  (see [`SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md`](./SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md)).

---

## 10. Open questions

- **Granularity of skill-trace fingerprints.** The current
  implementation hashes the canonical-JSON of the input. For
  forecasts this is fine; for graph queries the fingerprint may need
  to strip tenant-specific identifiers so cross-tenant skill
  reinforcement can accumulate. Slated for a follow-up wave.
- **Federated calibration.** When two tenants run the same intel
  capability against the same global benchmark, can we DP-aggregate
  their calibration measurements to upgrade the platform-wide
  reliability diagram? Slated for a follow-up wave alongside the
  `dp_federation_aggregator` work.

---

## 11. References

- Lambert et al., "Tülu 3: Pushing Frontiers in Open Language Model
  Post-Training", arXiv 2411.15124, November 2024 —
  https://arxiv.org/abs/2411.15124
- Wang et al., "Voyager: An Open-Ended Embodied Agent with Large
  Language Models", arXiv 2305.16291, May 2023 —
  https://arxiv.org/abs/2305.16291
- Gneiting & Raftery, "Strictly Proper Scoring Rules, Prediction,
  and Estimation", J. Amer. Statist. Assoc. 102 (2007): 359–378 —
  https://www.tandfonline.com/doi/abs/10.1198/016214506000001437
- Vovk et al., *Algorithmic Learning in a Random World*, 2nd ed.,
  Springer 2022 —
  https://link.springer.com/book/10.1007/978-3-031-06649-8
- Sharma & Kıcıman, "DoWhy: An End-to-End Library for Causal
  Inference", arXiv 2011.04216, November 2020 —
  https://arxiv.org/abs/2011.04216
- Görnitz et al., "Toward Supervised Anomaly Detection", JAIR 46
  (2013): 235–262 —
  https://www.jair.org/index.php/jair/article/view/10802
- Cremonesi, Koren & Turrin, "Performance of recommender algorithms
  on top-n recommendation tasks", ACM RecSys 2010 —
  https://dl.acm.org/doi/10.1145/1864708.1864721
- DeGroot & Fienberg, "The Comparison and Evaluation of
  Forecasters", The Statistician 32 (1983): 12–22 —
  https://www.jstor.org/stable/2987588
- Tygert, "Adversarial Calibration Detection", arXiv 2206.13494,
  June 2022 —
  https://arxiv.org/abs/2206.13494
- Trillian transparent log benchmarks, 2022 —
  https://github.com/google/trillian
