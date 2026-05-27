# SOTA Causal Inference for Borjie — 2026

**Persona owner:** Mr. Mwikila (mining operator, royalty analyst, safety officer)
**Package:** `@borjie/causal-inference`
**Status:** Phase 1 specification — pure-TypeScript SOTA causal-inference primitives with optional Python sidecar ports, capability-catalogue addressable.
**Last reviewed:** 2026-05-27

---

## 1. Motivation

Statistical correlation tells Mr. Mwikila that night-shift weeks have more lost-time injuries. It does not tell him whether the shift schedule **caused** the injuries — drivers may include weather, supervisor assignment, or a coincident equipment overhaul. Without causal reasoning he cannot reliably forecast the effect of an intervention: "what happens if I rotate the foremen and shorten the night shift to six hours?"

The same problem recurs across the operation:

- "Did the new royalty schedule **cause** filing delays, or did the broker change at the same time?"
- "Did the fuel-price spike **cause** the production drop, or did the haul-road washout?"
- "Did rotating Supervisor Mbembe to Pit C **cause** the throughput lift, or was Pit C already on a positive trajectory?"
- "If we shift training to mornings, what is the expected change in incident rate?" — a **counterfactual** question.

`@borjie/causal-inference` is the platform's structural-causal-model (SCM) layer underneath every "did X cause Y" or "what if we changed Z" loop. It supplies:

- **Time-lagged causal discovery** (PCMCI+, Granger) — *learn the DAG* from time-series.
- **Identification** (Pearl back-door, front-door) — *decide* whether an effect is identifiable from observed data.
- **Estimation** (DoWhy ATE, DiD, synthetic control, regression discontinuity) — *quantify* the effect with a confidence interval.
- **Counterfactual reasoning** (twin-network) — *answer* "what would have happened if".
- **Refutation** (placebo, bootstrap, sensitivity) — *stress-test* the estimate against unobserved confounding.

Every numeric result must be **trustable**. The arithmetic is deterministic, validated against textbook reference examples, and accompanied by an auditable run record (`causal_runs` table, hash-chained per tenant).

## 2. Scope boundary

In scope:

- Pure-TypeScript Granger causality test on stationary time-series.
- Pure-TypeScript Pearl back-door / front-door criterion identification on a `CausalGraph` (DAG).
- Pure-TypeScript differences-in-differences (DiD) estimator on 2-group × 2-period panels (generalisable to staggered).
- Pure-TypeScript synthetic-control estimator (single treated unit) via convex weights.
- Pure-TypeScript regression discontinuity (sharp design) estimator.
- Pure-TypeScript twin-network counterfactual reasoning over a discrete SCM.
- Pure-TypeScript refutation tests: placebo (negative-control outcome), bootstrap confidence interval, sensitivity analysis (E-value).
- Python sidecar ports — PCMCI+ (tigramite) for time-lagged DAG discovery, DoWhy for ATE estimation under non-trivial graphs. Both behind an injected `pythonSidecar` port so the package itself runs offline.
- Mining-domain wrappers: `shiftScheduleImpact`, `royaltyRateImpact`, `fuelPriceImpact`, `supervisorAssignmentImpact`.
- In-memory + SQL repository for `causal_runs` with hash-chained audit.

Out of scope (lives elsewhere):

- Generic regression / correlation primitives → `@borjie/data-analysis`.
- Time-series forecasting → `@borjie/forecasting`.
- LLM-based narrative explanation of a causal result → `@borjie/executive-brief-engine`.
- Bayesian network parameter learning beyond the twin-network → future work.

## 3. Library landscape — citations

Every algorithm in this package is implemented against a canonical reference. Citations are URL + title + date-checked.

1. **Tigramite (PCMCI+)** — Runge et al. The reference Python implementation of PCMCI and PCMCI+ for time-lagged causal discovery on stationary multivariate time-series. Borjie does not re-implement PCMCI+ in TypeScript; instead the Python sidecar (`pcmci-plus-port.ts`) marshals data to a tigramite worker behind a port interface, so the package is callable offline (the port returns a `notAvailable` sentinel and the consumer falls back to Granger). URL: <https://github.com/jakobrunge/tigramite>. Title: "Tigramite — causal inference and causal discovery for time series". Date checked: 2026-05-27.

2. **DoWhy 2.x (py-why)** — The reference Python library for the four-step causal-inference workflow (model → identify → estimate → refute). Underpins our `dowhy-port.ts` sidecar: the port speaks JSON-over-stdio to a DoWhy worker for non-trivial back-door / front-door identification and ATE estimation. URL: <https://github.com/py-why/dowhy>. Title: "DoWhy: A Python library for causal inference". Date checked: 2026-05-27.

3. **EconML (py-why)** — Microsoft Research's library for heterogeneous treatment-effect estimation (CATE) via double machine learning and causal forests. Borjie does not directly call EconML in this phase; the API surface is reserved for a future `cate-estimator.ts` module. URL: <https://github.com/py-why/EconML>. Title: "EconML — ALICE: Automated Learning and Intelligence for Causation and Economics". Date checked: 2026-05-27.

4. **Microsoft Azure AI Causal Inference** — The managed-service surface that bundles DoWhy + EconML behind Azure ML pipelines. Borjie's design adopts the same model → identify → estimate → refute lifecycle but runs locally. URL: <https://learn.microsoft.com/en-us/azure/machine-learning/concept-causal-inference>. Title: "Causal inference in Azure Machine Learning". Date checked: 2026-05-27.

5. **CausalForestML / generalized random forests (Athey & Wager)** — Theoretical foundation for honest causal-forest CATE estimation. Cited here as the future extension target for the placeholder `cate-estimator.ts`; the present package implements ATE only. URL: <https://github.com/grf-labs/grf>. Title: "grf — Generalized Random Forests". Date checked: 2026-05-27.

6. **Pearl, J. — Causality (2nd ed., 2009) + the do-calculus** — The foundational text. Borjie's back-door and front-door identification follow the algorithm exactly as stated in Theorem 3.3.2 (back-door) and Theorem 3.3.4 (front-door). The textbook example used in our tests is the smoking → tar → cancer / genotype-confounder graph from Chapter 3. URL: <https://bayes.cs.ucla.edu/BOOK-2K/>. Title: "Causality: Models, Reasoning, and Inference". Date checked: 2026-05-27.

7. **Abadie, A. — Synthetic Control Methods (JEP 2021)** — The canonical formulation: convex non-negative weights summing to one, minimising pre-treatment outcome distance. Our `synthetic-control.ts` follows the closed-form coordinate-descent suggested in Abadie (2021) section 3.3. URL: <https://doi.org/10.1257/jep.35.2.1>. Title: "Using Synthetic Controls: Feasibility, Data Requirements, and Methodological Aspects". Date checked: 2026-05-27.

8. **Cunningham, S. — Causal Inference: The Mixtape (2021)** — Reference for our differences-in-differences and regression-discontinuity implementations. The 2×2 DiD identity ATE = (Y_T,post − Y_T,pre) − (Y_C,post − Y_C,pre) is the test oracle in `diff-in-diff.test.ts`. URL: <https://mixtape.scunning.com>. Title: "Causal Inference: The Mixtape". Date checked: 2026-05-27.

9. **VanderWeele, T. — The E-value (Annals of Internal Medicine, 2017)** — Closed-form sensitivity bound that says how strong an unobserved confounder would have to be to nullify the observed effect. Our `sensitivity.ts` implements the standard E-value for risk-ratios. URL: <https://www.acpjournals.org/doi/10.7326/M16-2607>. Title: "Sensitivity Analysis in Observational Research: Introducing the E-Value". Date checked: 2026-05-27.

10. **Causal foundation models (CausalLM / CausalQR, 2025)** — Emerging line of work training transformers on causal-graph + intervention data to perform generalised do-calculus at inference time. Borjie defers integration; the present package wires the four-step pipeline so a future `causal-lm-port.ts` can drop in. URL: <https://arxiv.org/abs/2502.01066>. Title: "Causal Language Models for Structural Causal Reasoning". Date checked: 2026-05-27.

11. **Runge et al. (Nature Communications 2019) — PCMCI+** — The published algorithm for time-lagged causal discovery with conditional-independence tests on lagged matrices. URL: <https://www.nature.com/articles/s41467-019-10105-3>. Title: "Inferring causation from time series in Earth system sciences". Date checked: 2026-05-27.

## 4. Architecture

```
packages/causal-inference/
  src/
    types.ts                                — CausalGraph, TreatmentEffect, Counterfactual, IdentificationStrategy, PCMCIResult
    logger.ts                               — createLogger wrapper
    discovery/
      pcmci-plus-port.ts                    — Python sidecar bridge to tigramite PCMCI+
      granger-causality.ts                  — pure-TS Granger test
    identify/
      backdoor-criterion.ts                 — Pearl back-door identification
      frontdoor-criterion.ts                — Pearl front-door identification
    estimate/
      dowhy-port.ts                         — Python sidecar to DoWhy
      synthetic-control.ts                  — Abadie convex-weights estimator
      diff-in-diff.ts                       — 2x2 DiD with std error
      regression-discontinuity.ts           — sharp RD via local linear regression
    counterfactual/
      twin-network.ts                       — twin-network counterfactual reasoning
    refute/
      placebo.ts                            — negative-control outcome refuter
      bootstrap.ts                          — bootstrap CI for the estimate
      sensitivity.ts                        — E-value sensitivity bound
    domain/
      mining-causal.ts                      — Mr. Mwikila wrappers
    repositories/
      causal-run-repository.ts              — in-memory + SQL (port)
    index.ts                                — public surface
```

### 4.1 Ports

`PythonSidecarPort` is the injected boundary between TypeScript and any Python-backed estimator (tigramite, DoWhy). The package itself never spawns Python; the host service wires the port at composition time. When the port is absent the consumers degrade to pure-TS alternatives (Granger instead of PCMCI+, DiD instead of DoWhy's IPW). All tests run offline against an in-memory stub.

### 4.2 Run record

Every causal answer Mr. Mwikila asks is recorded as a `causal_runs` row: the natural-language question, the identified treatment + outcome columns, the identification strategy (back-door / front-door / DiD / synthetic-control), the point estimate, the 95 % CI, the timestamp, and a SHA-256 audit hash chained against the previous row in the tenant's chain. The chain makes the analytic record tamper-evident — a regulator can replay every causal claim Mr. Mwikila relied on and verify the hash chain.

## 5. Migration 0067 — `causal_runs`

```
id               uuid primary key
tenant_id        text not null
question         text not null
treatment        text not null
outcome          text not null
identification   text not null   -- 'backdoor' | 'frontdoor' | 'did' | 'synthetic-control' | 'rd' | 'granger' | 'pcmci-plus'
effect_estimate  numeric not null
ci_low           numeric not null
ci_high          numeric not null
ran_at           timestamptz not null default now()
prev_hash        text not null default ''
audit_hash       text not null
```

Idempotent (`IF NOT EXISTS` + `DO` blocks), RLS via `app.tenant_id` GUC pattern from migration 0003, indexes on (tenant, ran_at desc) and (audit_hash).

## 6. Mining-domain wrappers

The `src/domain/mining-causal.ts` module exposes four high-level functions Mr. Mwikila can call by name:

- `shiftScheduleImpact(panel, options)` → 2×2 DiD on safety incidents, treated = "moved to compressed shift", control = "kept legacy schedule". Returns ATE + 95 % CI + refutation report.
- `royaltyRateImpact(panel, options)` → synthetic-control on royalty-filing latency, treated = "new royalty schedule", donor pool = comparable jurisdictions.
- `fuelPriceImpact(timeSeries, options)` → Granger causality test from fuel-price series to production-volume series. Returns lagged effect strength + p-value.
- `supervisorAssignmentImpact(panel, options)` → back-door-identified ATE on throughput, treatment = "supervisor rotated", confounders = pit + crew + season.

Each wrapper produces a `CausalRunResult` shaped for the `causal_runs` table.

## 7. Validation strategy

The textbook examples below are the regression oracles:

- **Pearl's smoking → cancer with genotype confounder** (Causality §3.3) — back-door set must be {genotype}; tested.
- **Pearl's smoking → tar → cancer front-door** (Causality §3.4) — front-door set must be {tar}; tested.
- **Synthetic Granger series** with known driver y(t) = 0.6·x(t-1) + ε — Granger test must reject H_0 of no-causation at α = 0.05.
- **2×2 DiD textbook panel** with hand-computed ATE = 4.0 (Cunningham 2021 worked example) — `diff-in-diff` must return 4.0 ± numerical tolerance.
- **Synthetic-control toy** with one treated and three control units sharing pre-period mean — weights must converge to the convex-hull representation that minimises pre-period RMSE.
- **Placebo refutation** — running the estimator on a synthetic outcome with no causal connection must return an effect indistinguishable from zero (|estimate| < 1.0 in standardised units).
- **Bootstrap CI** — the 95 % CI under 1000 bootstrap replications must contain the true effect.

## 8. Compliance and audit

- TS strict ON, no `@ts-nocheck`, no `any` in public types.
- Logger via `createLogger` from `@borjie/observability` — no direct `console.*`.
- Persona "Mr. Mwikila", brand "Borjie".
- Live-test only: Python sidecars behind an injected port; offline test suite runs against an in-memory stub.
- Migration idempotent, RLS enforced.
- Audit hash chain: every run row hashed against the prior row; tenant-scoped chain head; tamper evident.

## 9. Roadmap

- **v0.1.0 (this phase)** — Pure-TS discovery (Granger), identification (back-door, front-door), estimation (DiD, synthetic-control, RD), counterfactual (twin-network), refutation (placebo, bootstrap, sensitivity), mining-domain wrappers, repository, migration 0067.
- **v0.2.0** — Python sidecar wiring (tigramite, DoWhy) in the host service composition root; live tests gated behind `PYTHON_SIDECAR_URL`.
- **v0.3.0** — CATE / heterogeneous-effect estimation (`cate-estimator.ts`) via EconML port.
- **v0.4.0** — Causal-LM port for natural-language do-calculus.

---

End of spec.
