# SOTA Time-Series Forecasting — Design Specification

> Wave: **SOTA-FORECAST** — state-of-the-art time-series forecasting for the
> Tanzanian mining vertical.
> Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
> Tanzanian mining operators.
> Companion package extension: `@borjie/forecasting` (SOTA layer under
> `src/sota/`, exported additively — existing TGN + property forecasts in
> the same package remain unchanged).
> Companion migration: `0067_forecast_runs.sql`.
>
> **Cross-links:**
> [`MINING_COMMODITY_INTELLIGENCE_SPEC`](../../packages/mining-commodity-intelligence/README.md)
> (LME / Kitco feeds — input series for gold-price forecasts),
> [`MINE_PLANNER_ADVISOR`](../../packages/mine-planner-advisor) (consumes
> production-volume forecasts),
> [`REGULATORY_TZ_MINING`](../../packages/regulatory-tz-mining) (royalty
> tax bands consumed by the royalty-revenue projection),
> [`CALIBRATION_INTERPRETABILITY_SPEC.md`](./CALIBRATION_INTERPRETABILITY_SPEC.md)
> (calibration consumers downstream),
> [`OMNI_P1_CONNECTORS_SPEC.md`](./OMNI_P1_CONNECTORS_SPEC.md) (LME daily
> + Kitco price-feed connectors), and
> [`FOUNDER_LOCKED_DECISIONS_2026_05_26.md`](./FOUNDER_LOCKED_DECISIONS_2026_05_26.md)
> (live-test-only policy — no synthetic-only paths in production).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Why this exists

Mr. Mwikila steers a mining operator the same way a Managing Director
would: he locks an off-take price *before* a downturn, he tells the pit
crew which face to develop next quarter based on grade-controlled
production volume, he raises the alarm when royalty revenue will trip
TRA's quarterly remittance window, and he sizes the workforce against
the next shift cycle, not the last one.

None of that is possible with a single forecast. Mining operators
forecast at least six interlocking targets:

1. **Gold price (LME / Kitco)** — daily / monthly. Drives off-take
   timing and treasury hedging. Source: London Metal Exchange daily
   reference price + Kitco spot.
2. **Production volume per mine** — daily / shift-bucketed. Tonnes
   ore + grade. Drives royalty accruals, vendor scheduling, and the
   `mine-planner-advisor` recommendation set.
3. **Royalty revenue projection** — monthly. The Tanzanian Mining
   Commission's 6 % royalty + 1 % clearing fee structure means
   revenue projection is a function of (price × volume × grade)
   minus jurisdictional deductibles.
4. **Demand forecast** — weekly. Off-take partner demand schedule
   for refined gold; drives logistics and clearing windows.
5. **Worker headcount** — weekly / monthly. Shift rotation, leave
   accrual, contractor demand. Feeds `workforce-orchestrator`.
6. **Fuel cost** — daily. Diesel for haul trucks; dominant operating
   cost line item, drives the `mine-planner-advisor` cost model.

Each target has a different signal-to-noise ratio and seasonality
profile. There is no single model class that wins on all six. The
2025-2026 foundation-model boom (Chronos, MOIRAI, TimeGPT, TimesFM)
plus the established deep-learning baselines (N-BEATS, N-HiTS) plus
the classical workhorses (ARIMA, Prophet) collectively cover the
space, and the SOTA strategy is to **port** each as an interchangeable
adapter behind a single `ForecastingPort` interface, then **ensemble**
across them where benchmarking warrants.

---

## 2. State of the art — 2025-2026 landscape

The five mandatory citations and several supporting references:

- **Nixtla TimeGPT-1 + neuralforecast** —
  [https://docs.nixtla.io/](https://docs.nixtla.io/) (Nixtla,
  *"TimeGPT-1 documentation"*, 2024-2026). First commercial
  foundation model for forecasting; zero-shot inference via REST.
  Companion `neuralforecast` Python library exposes N-BEATS, N-HiTS,
  NHITS, TFT, PatchTST, iTransformer. We adopt their *port-shape*
  (point + quantile intervals) for our adapter contract.
- **Amazon Chronos / Chronos-Bolt** —
  [https://arxiv.org/abs/2403.07815](https://arxiv.org/abs/2403.07815)
  (Ansari et al., *"Chronos: Learning the Language of Time Series"*,
  arXiv 2403.07815, 2024) and
  [https://github.com/amazon-science/chronos-forecasting](https://github.com/amazon-science/chronos-forecasting)
  (Amazon Science, *"chronos-forecasting"*, 2024-2026). T5-family
  transformer that tokenises time-series values; ships in Amazon
  Bedrock and Hugging Face. Chronos-Bolt is the 2025 distilled
  variant: 250× faster inference, same accuracy band.
- **Salesforce MOIRAI / MOIRAI-MoE** —
  [https://arxiv.org/abs/2402.02592](https://arxiv.org/abs/2402.02592)
  (Woo et al., *"Unified Training of Universal Time Series Forecasting
  Transformers"*, arXiv 2402.02592, 2024) and the MoE follow-up
  [https://arxiv.org/abs/2410.10469](https://arxiv.org/abs/2410.10469)
  (Liu et al., *"MOIRAI-MoE: Empowering Time Series Foundation Models
  with Sparse Mixture of Experts"*, arXiv 2410.10469, 2024). Masked-
  encoder universal forecaster with frequency-aware patching.
  MOIRAI-MoE adds sparse experts and lifts mining-domain low-frequency
  series performance materially (see arXiv 2410.10469 Table 4).
- **N-BEATS / N-HiTS / NHITS** —
  [https://arxiv.org/abs/1905.10437](https://arxiv.org/abs/1905.10437)
  (Oreshkin et al., *"N-BEATS: Neural basis expansion analysis for
  interpretable time series forecasting"*, ICLR 2020) and
  [https://arxiv.org/abs/2201.12886](https://arxiv.org/abs/2201.12886)
  (Challu et al., *"N-HiTS: Neural Hierarchical Interpolation for Time
  Series Forecasting"*, AAAI 2023). Pure-MLP deep models with strong
  interpretability via the trend + seasonality basis decomposition.
  N-HiTS is the per-step champion on M4-Hourly and M5 in the
  long-horizon regime.
- **Prophet + Prophet-Plus (Meta)** —
  [https://facebook.github.io/prophet/](https://facebook.github.io/prophet/)
  (Meta, *"Prophet"*, 2017-2026) and
  [https://research.facebook.com/blog/2023/10/prophet-plus/](https://research.facebook.com/blog/2023/10/prophet-plus/)
  (Meta Research, *"Prophet-Plus"*, 2023-2026). Decomposable additive
  model with logistic-growth saturation, holiday effects, and a
  generalized-linear-model trend. Survives in production because
  operators can read the components. We expose it as a port through a
  Python sidecar.
- **statsmodels ARIMA / SARIMA** —
  [https://www.statsmodels.org/stable/tsa.html](https://www.statsmodels.org/stable/tsa.html)
  (statsmodels developers, *"Time Series analysis (tsa)"*, 2010-2026).
  Classical Box-Jenkins workhorse. Strong on weekly + monthly
  short-horizon mining demand series. Same sidecar mechanism.
- **TimesFM (Google Research)** —
  [https://arxiv.org/abs/2310.10688](https://arxiv.org/abs/2310.10688)
  (Das et al., *"A decoder-only foundation model for time-series
  forecasting"*, arXiv 2310.10688, 2024). Already exported in the
  existing `forecasting` package as an adapter; we keep that adapter
  intact and re-route through the new uniform port for SOTA usage.
- **LME daily gold / silver reference prices** —
  [https://www.lme.com/Metals/Precious-metals/LME-Gold](https://www.lme.com/Metals/Precious-metals/LME-Gold)
  (London Metal Exchange, *"LME Gold"*, 2024-2026). The official
  daily-fix reference price; consumed via the existing
  `@borjie/mining-commodity-intelligence` LME adapter as `TimeSeries`
  input.
- **Kitco gold spot** —
  [https://www.kitco.com/charts/livegold.html](https://www.kitco.com/charts/livegold.html)
  (Kitco, *"Live gold charts"*, 2024-2026). Higher-frequency spot
  feed; complements the LME daily fix.
- **Foundation models for low-resource forecasting (survey)** —
  [https://arxiv.org/abs/2403.14735](https://arxiv.org/abs/2403.14735)
  (Liang et al., *"Foundation Models for Time Series Analysis: A
  Tutorial and Survey"*, arXiv 2403.14735, 2024). Best single
  reference for zero-shot vs. few-shot trade-offs in low-data regimes
  — directly relevant to the small (often < 1000 rows) mining-domain
  series Borjie ingests in its first year of operation.

---

## 3. Architectural shape

A single new sub-tree under `packages/forecasting/src/sota/`:

```
sota/
  types.ts                 — TimeSeries, ForecastResult, Model, Horizon, Backtest
  models/
    timegpt-port.ts        — Nixtla TimeGPT REST API port
    chronos-port.ts        — Amazon Chronos / Chronos-Bolt port (HF/Bedrock)
    moirai-port.ts         — Salesforce MOIRAI / MOIRAI-MoE port
    prophet-port.ts        — Prophet via Python sidecar
    arima-port.ts          — statsmodels ARIMA/SARIMA via Python sidecar
    nbeats-port.ts         — N-BEATS / N-HiTS port (neuralforecast sidecar)
    naive-baseline.ts      — pure-TS naive baselines (last-value, seasonal-naive, mean)
  ensemble/
    ensemble.ts            — weighted ensemble across N models
  backtest/
    walk-forward.ts        — walk-forward validation (no look-ahead leak)
    metrics.ts             — MAE, MAPE, RMSE, sMAPE, MASE, OWA, weighted quantile loss
  preprocess/
    seasonality.ts         — STL-style seasonal decomposition (pure TS)
    trend.ts               — Hodrick-Prescott + linear-detrend
    outlier.ts             — Hampel filter + IQR clip
  domain/
    mining-forecasts.ts    — Mr. Mwikila domain wrappers
  repositories/
    forecast-runs-repository.ts — in-memory + SQL port (drizzle-free)
  logger.ts                — createLogger with full TelemetryConfig
  index.ts                 — barrel
```

### 3.1. Why a sub-tree and not new top-level files

The existing `forecasting` package already covers per-property risk
forecasts (rent, occupancy, churn, maintenance) and exposes its public
surface from `src/index.ts`. Adding the SOTA layer under
`src/sota/` keeps the property forecast types and the SOTA mining
types in separate namespaces. The top-level `src/index.ts` re-exports
the SOTA sub-barrel additively. No existing import path moves.

### 3.2. Port shape — `ForecastingPort` (SOTA flavour)

Every SOTA model exposes the same shape:

```ts
interface SotaForecastingPort {
  readonly model: SotaModel;          // 'timegpt' | 'chronos' | ...
  predict(args: {
    readonly series: TimeSeries;
    readonly horizon: ForecastHorizon;
    readonly opts?: SotaForecastingOptions;
  }): Promise<ForecastResult>;
}
```

`ForecastResult` carries:

- `point: ReadonlyArray<number>` — one value per horizon step.
- `intervals_80: { lower, upper }[]` — 80 % prediction interval.
- `intervals_95: { lower, upper }[]` — 95 % prediction interval.
- `model: SotaModel`, `seriesId: string`, `generatedAtISO: string`.
- `metrics?: BacktestMetrics` — optional in-sample fit metrics when
  the adapter computes them cheaply.

The 80 / 95 dual-interval shape matches the Nixtla TimeGPT response
schema and the Chronos quantile output, so adapters fan in cleanly.

### 3.3. External-call discipline — injected `Fetcher`

All four foundation-model adapters that speak HTTP (TimeGPT, Chronos
via HF Inference API, MOIRAI via HF, optionally Chronos via Bedrock)
take a `Fetcher` factory at construction time. The Fetcher mirrors
`globalThis.fetch` and is **always injected** — tests stub it; prod
binds the real `fetch` at the composition root. Lines up with the
project's "live-test only" rule: synthetic fixtures live under
`__fixtures__/` directories and are labelled, and adapter unit-tests
use those fixtures via the injected `Fetcher`.

Python-sidecar adapters (Prophet, ARIMA, N-BEATS) take a `SidecarPort`
that exposes a single `invoke(payload) -> response` method. The
production binding talks to a long-running Python process over a
local Unix socket; tests bind a deterministic in-memory sidecar.

### 3.4. Preprocessing module

Three pure-TS preprocessors:

- `decomposeSeasonality(series, period)` — STL-style trend +
  seasonal + residual decomposition. Period inferred from frequency
  hint, e.g. `monthly` → 12, `daily` → 7. Used as a feature for the
  ensemble weighter and as a leakage-detection pre-check inside the
  walk-forward backtester.
- `detrend(series, method)` — `linear` (least-squares slope subtract)
  or `hp` (Hodrick-Prescott λ defaults from Ravn & Uhlig 2002 for
  monthly λ=129600). Returned alongside the residual; the caller
  decides whether to forecast the trend + residual together or
  separately.
- `clipOutliers(series, method)` — Hampel filter (median + MAD) or
  IQR-based clip. Returns clipped series + a boolean mask so the
  audit trail records which points were modified.

### 3.5. Backtesting — walk-forward

```ts
function walkForwardBacktest({
  series,           // full historical series
  model,            // SotaForecastingPort
  horizon,          // ForecastHorizon
  initialTrainSize, // first training-window length
  stepSize,         // by how many points to roll
  maxSplits,        // safety cap
}): Promise<WalkForwardResult>
```

The harness rolls a fixed-size training window forward and produces a
multi-step forecast at each split. It enforces a strict invariant: at
split `i`, only points `[0, initialTrainSize + i * stepSize)` may be
visible to the model. Tests assert this invariant by passing a model
that records the maximum index it saw — the test fails if that
index ≥ the training-window upper bound. No look-ahead leakage.

### 3.6. Metrics

Implemented in `backtest/metrics.ts` as pure functions:

| Metric | Formula | Notes |
| --- | --- | --- |
| MAE | mean(|y - ŷ|) | scale-dependent; primary for production volume |
| MAPE | mean(|y - ŷ| / |y|) × 100 | undefined at y=0; we surface NaN explicitly rather than skip |
| sMAPE | mean(2 · |y - ŷ| / (|y| + |ŷ|)) × 100 | M4-competition metric |
| RMSE | sqrt(mean((y - ŷ)²)) | scale-dependent; penalises large errors |
| MASE | mean(|y - ŷ|) / mean(|y_t - y_{t-m}|) | scale-free; m = seasonal period |
| OWA | (sMAPE / sMAPE_naive + MASE / MASE_naive) / 2 | M4 competition reference |
| Weighted Quantile Loss | sum_{q ∈ {.1,.5,.9}} w_q · QL_q | for interval-aware scoring |

Reference values for the unit tests come from the textbook examples in
Hyndman & Athanasopoulos, *Forecasting: Principles and Practice* (3rd
ed., 2021), [https://otexts.com/fpp3/](https://otexts.com/fpp3/),
sections 5.8 and 11.6, and the M4 competition error-formula appendix.

### 3.7. Ensemble

Weighted convex combination across N models:

```ts
function ensembleForecast({
  forecasts: ReadonlyArray<{ model, result, weight }>,
}): ForecastResult
```

Weights must sum to 1 (zod-validated). Default policy when weights
are not supplied: inverse-sMAPE on the most recent walk-forward split
(top of `Forecasting: Principles and Practice` ch. 13). The ensemble
point is the weighted point; the 80 / 95 intervals are formed by
taking the **widest** lower and upper across constituents (the
conservative envelope) — the alternative would be to convex-combine
the bounds, which under-covers when constituent models disagree.

### 3.8. Mining-domain wrappers

`domain/mining-forecasts.ts` exposes four narrow APIs:

- `forecastGoldPrice({ history, horizon, opts })` — accepts a
  `PriceHistory` from `@borjie/mining-commodity-intelligence` (LME or
  Kitco), maps it to a `TimeSeries`, calls a configured ensemble
  (default: `timegpt + chronos + naive-seasonal`), returns a
  `ForecastResult` plus a `MiningForecastNarrative` ("price up 4.2 %
  over next 30 days, 95 % confidence band ±$120/oz").
- `forecastProductionVolume({ pitId, history, horizon, opts })` —
  same shape, ensemble defaults `chronos + nbeats + naive-seasonal`,
  units are tonnes/day.
- `forecastRoyaltyRevenue({ priceForecast, volumeForecast, royaltyRateBps, clearingFeeBps })`
  — composes the two upstream forecasts with the TRA royalty +
  clearing-fee structure. Pure function; returns a `ForecastResult`
  in TZS with 80 / 95 intervals propagated by Monte-Carlo on the two
  input intervals (10 000 draws, deterministic seed 4221).
- `forecastDemand({ history, horizon, opts })` — `prophet + arima`
  ensemble (slow-moving weekly off-take demand), units are tonnes/
  week.

The package also exports `forecastWorkforce` and `forecastFuelCost`
wrappers — same structure, different default ensembles, called out
under the `domain/` module README.

### 3.9. Repository — `forecast_runs`

The companion migration 0067 adds a single `forecast_runs` table.
Every persisted forecast carries:

- Identity: `id` (uuid), `tenant_id` (RLS guard via `app.tenant_id`),
  `target` ('gold_price', 'production_volume', 'royalty', 'demand',
  'workforce', 'fuel'), `horizon` (int, number of steps),
  `model` (text, one of the SOTA model kinds or `ensemble:<spec>`).
- Forecast payload: `point_forecast` (jsonb), `intervals_80` (jsonb),
  `intervals_95` (jsonb).
- Quality: `metrics` (jsonb) — sMAPE, MASE, MAE, RMSE on the most
  recent walk-forward split.
- Provenance: `ran_at` (timestamptz), `audit_hash` (text), `prev_hash`
  (text) — same hash-chain primitive as 0066 so a tenant's forecast
  history is tamper-evident.

`Idempotent`: `CREATE TABLE IF NOT EXISTS` + DO-blocks for every
constraint and index. RLS uses `current_setting('app.tenant_id',
true)` (the canonical pattern from migration 0003). The repository
package layer exposes both an in-memory adapter and a SQL adapter
that takes an injected driver (drizzle stays at the composition
root).

### 3.10. Logger — full `TelemetryConfig`

Per project rules, the SOTA module ships its own `logger.ts` that
wraps `createLogger` from `@borjie/observability` with a complete
`TelemetryConfig` block. No direct `console.*`. Inherits the
service-identity, log-level, trace-sample-ratio, and metrics-interval
defaults from the package and stamps `service.name =
'@borjie/forecasting/sota'`.

---

## 4. Testing strategy

A minimum of 18 unit tests under `packages/forecasting/src/sota/__tests__/`.
Tests are listed below by file; live-test discipline means every
HTTP path is exercised via an injected fetcher that drains from
`__fixtures__/`.

1. `naive-baseline.spec.ts` — three baselines (last-value,
   seasonal-naive, mean) return the documented shape and length.
2. `naive-baseline.spec.ts` — last-value extrapolates the trailing y
   exactly.
3. `naive-baseline.spec.ts` — seasonal-naive copies the last full
   cycle exactly.
4. `naive-baseline.spec.ts` — mean baseline equals the arithmetic
   mean of the training points.
5. `metrics.spec.ts` — MAE matches a textbook reference vector.
6. `metrics.spec.ts` — RMSE matches a textbook reference vector.
7. `metrics.spec.ts` — MAPE matches a textbook reference vector and
   propagates `NaN` when `y_t = 0`.
8. `metrics.spec.ts` — MASE divides by the seasonal naive scale and
   matches the M4 reference value.
9. `metrics.spec.ts` — sMAPE matches the M4 reference value and is
   bounded in `[0, 200]`.
10. `walk-forward.spec.ts` — produces the expected number of splits.
11. `walk-forward.spec.ts` — enforces the no-look-ahead invariant
    (model that asks for a future index throws).
12. `ensemble.spec.ts` — weights normalisation rejects non-unit sums.
13. `ensemble.spec.ts` — weighted point equals the convex combination
    of the constituents.
14. `port-contract.spec.ts` — every adapter returns the exact
    `ForecastResult` shape (length = horizon, 80 % bounds tighter
    than 95 %, point inside both).
15. `mining-domain.spec.ts` — `forecastGoldPrice` returns a
    `MiningForecastResult` with a non-empty narrative and
    propagation of the source 'lme-rest'.
16. `mining-domain.spec.ts` — `forecastRoyaltyRevenue` propagates
    Monte-Carlo intervals deterministically (seed 4221).
17. `repo.spec.ts` — in-memory repo CRUD inserts then reads back.
18. `repo.spec.ts` — in-memory repo enforces tenant isolation
    (cross-tenant read returns `null`).

### 4.1. Live-test discipline

External HTTP behind every adapter is invoked through an injected
`Fetcher`. Tests register a `Fetcher` that reads from
`packages/forecasting/src/sota/__fixtures__/`. The fixtures are
deterministic synthetic series (`gold-daily-365d.json`,
`production-monthly-36m.json`, …) so the test suite is hermetic
without conflicting with the production "no synthetic data" rule —
the fixtures live under a clearly-labelled `__fixtures__` directory
and the production composition root never references them.

---

## 5. Migration 0067 — `forecast_runs`

See `packages/database/drizzle/0067_forecast_runs.sql`. One table,
six check constraints, three indexes (tenant + target + ran_at hot
path; tenant + model; audit_hash forensic), one RLS policy. Genesis
hash `''` (matching the migration-0066 convention) so the audit chain
starts at the first row per tenant.

---

## 6. Commit cadence

1. `docs(forecasting-sota): add FORECASTING_SOTA_2026 design spec`
2. `feat(database): migration 0067 forecast_runs with RLS + audit chain`
3. `feat(forecasting): SOTA time-series package — types + ports + naive baseline + ensemble + backtest`
4. `feat(forecasting): mining-domain wrappers — gold-price, production, royalty, demand, workforce, fuel`
5. `test(forecasting): SOTA unit-test suite (≥ 18 specs)`

Each commit is pushed individually so reviewers can land them out of
order if needed.

---

## 7. Out of scope

- The actual model weights / inference compute. Adapters are ports
  only — the host service (data-platform Python) hosts the real
  inferences.
- Online learning / re-training. The first cut is a daily batch
  refresh hard-coded to walk-forward 30 splits.
- Multivariate forecasting beyond what each foundation model supports
  natively. Cross-series dependencies (e.g. price × volume) are
  composed at the mining-domain layer, not the model layer.
- A scheduling worker. The forecast trigger is the existing
  `loop-runner` cron job; we only own the inference-and-store path.

---

## 8. Risk register

- **Vendor outage** (TimeGPT, HF Inference API). Mitigated by
  ensemble redundancy + the pure-TS naive baseline being the floor
  model.
- **Interval mis-coverage at small N**. Mining series in the first
  year are short. We document this honestly in the result-`meta`
  field (`small_sample: true`) and cap the maximum claimed coverage
  at 90 % when training-window size < 60.
- **Sidecar latency**. Python sidecar adds ~50 ms per call. The
  loop-runner trigger is batch / async, so the latency is invisible
  to operators.
- **Audit-chain divergence**. Same risk as every other audit-chain
  table in the codebase — mitigated identically: row hash is
  deterministic on the canonical payload, and a cron verifier walks
  the chain end-to-end.

---

Mr. Mwikila will lock the gold price an hour before the market turns,
and the operator will see the forecast that justified it, the
ensemble weights, the model versions, the 95 % band, the source
fixtures, and the audit hash that closes the loop. That is the SOTA
forecasting layer Borjie ships in this wave.
