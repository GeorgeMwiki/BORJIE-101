# forecasting-bench

World-class evaluation infrastructure for the Borjie forecasting
engine (`packages/forecasting/`). Built to score TGN, conformal,
foundation-model, and any third-party forecaster against a stable suite
of zero-trained baselines on realistic property-management scenarios.

## What is in here

```
evals/forecasting-bench/
  metrics.ts        # MAE, RMSE, MAPE, sMAPE, MASE, CRPS, interval coverage
  baselines.ts      # naive-last-value, mean-window, seasonal-naive
  scenarios.ts      # rent_forecast, vacancy_forecast, churn_forecast
  backtest.ts       # rolling-origin (expanding | sliding) framework
  run.ts            # CLI entrypoint — pnpm bench:forecast
  __tests__/        # unit tests covering metrics + backtest plumbing
  results/          # generated JSON + markdown + CSV (gitignored)
```

The bench is deliberately self-contained: no workspace dependency on
`packages/forecasting/`. It is the audit harness, not a downstream
consumer. A real forecaster plugs in by implementing the `Forecaster`
function type below.

## Running the bench

```bash
# All scenarios, all baselines.
pnpm bench:forecast

# Only one scenario.
pnpm bench:forecast --scenario rent_forecast

# Plug in a custom model implementation.
pnpm bench:forecast --scenario rent_forecast --model ./my-forecaster.mjs

# Custom output directory.
pnpm bench:forecast --out ./tmp/bench-results

# Silent mode (still writes results files).
pnpm bench:forecast --quiet
```

Outputs land in `evals/forecasting-bench/results/`:

- `results-<ISO-date>.json` — full per-fold, per-series, per-tenant, global metrics
- `results-<ISO-date>.md`   — human-readable summary table per scenario
- `results-<ISO-date>.csv`  — per-series aggregates for spreadsheet analysis

## Metrics

| Metric | Bounds | What it tells you |
|---|---|---|
| MAE | [0, ∞) | Absolute average miss in domain units |
| RMSE | [0, ∞) | Punishes large misses more heavily than MAE |
| MAPE | [0, ∞) % | Percent error; undefined when actuals are zero |
| sMAPE | [0, 200] % | Symmetric, bounded variant of MAPE |
| MASE | [0, ∞) | Scale-free; <1 beats seasonal-naive in-sample |
| CRPS | [0, ∞) | Probabilistic score; collapses to MAE for point forecasts |
| Coverage 80 / 95 | [0, 1] | Empirical hit rate of the prediction interval |

MASE is the headline metric for cross-scenario comparison — it is the
only one that is unit-free and not pathological at zero actuals.

References:

- Hyndman & Koehler (2006), *Another look at measures of forecast accuracy*, IJF 22(4)
- Gneiting & Raftery (2007), *Strictly proper scoring rules*, JASA 102

## Scenarios

| Scenario | Series | Horizon | Seasonality | Strategy |
|---|---|---|---|---|
| `rent_forecast` | 100 units across 10 tenants, 60 months | 3 months | 12 (annual) | expanding |
| `vacancy_forecast` | 32 properties across 8 tenants, 365 days | 7 days | 7 (weekly) | sliding |
| `churn_forecast` | 36 cohorts across 12 tenants, 24 quarters | 1 quarter | 4 (annual) | expanding |

All scenarios are seeded — re-running the bench produces byte-identical
inputs. Scenario data is currently synthetic but the
`SeriesInput` shape maps 1:1 to the real signals you would feed in
production (per-tenant series IDs, observed values, seasonal period).

To swap in real data later, write a function that returns
`ReadonlyArray<SeriesInput>` from your warehouse and replace the body of
`buildRentForecastScenario` / `buildVacancyForecastScenario` /
`buildChurnForecastScenario` — the rest of the pipeline is unchanged.

## Backtest framework

The `runBacktest` function in `backtest.ts` implements a rolling-origin
evaluation with two window strategies:

- **Expanding** — training window grows monotonically.
  `train = values[0..origin]`, `test = values[origin..origin+h]`.
  Good for stable series; uses every data point.

- **Sliding** — training window stays a fixed width.
  `train = values[origin-w..origin]`, `test = values[origin..origin+h]`.
  Good for non-stationary or regime-shifting series.

The origin advances by `stride` (default = horizon) and stops at
`maxFolds`. The framework outputs metrics at three levels:

1. Per-fold — for debugging an individual cut.
2. Per-series — mean across folds within a series.
3. Per-tenant — mean across series within a tenant.
4. Global — mean across tenants.

## Plugging in a real model

A forecaster is a pure function:

```ts
import type { Forecaster, ForecastOutput } from './baselines.ts';

export default function myForecaster(
  history: ReadonlyArray<number>,
  horizon: number,
): ForecastOutput {
  // 1. fit / load whatever you need from history
  // 2. predict the next `horizon` points
  // 3. return point + 80/95 percent bands + ensemble samples
  return {
    point:    [...],
    lower80:  [...],
    upper80:  [...],
    lower95:  [...],
    upper95:  [...],
    samples:  [[...], [...], ...],  // length === horizon, each draw count >= 50
  };
}
```

Save the module, then point the bench at it:

```bash
pnpm bench:forecast --scenario rent_forecast --model ./my-forecaster.mjs
```

The module may either default-export the function or export a named
`forecaster`. An optional `name` export overrides the displayed model
name. Compiled TypeScript files work too — the harness uses dynamic
`import()`.

### Wiring `packages/forecasting/` itself

To bench the production TGN+conformal pipeline, write a thin adapter
that:

1. Constructs a `FeatureVector` from the history slice (a stub
   tabular vector + the temporal sequence suffices).
2. Calls `Forecaster.forecast(kind, features, ctx)` from
   `@borjie/forecasting`.
3. Maps the resulting `Forecast.interval` into `ForecastOutput`
   point/lower/upper bands and (optionally) draws ensemble samples from
   the conformal interval for CRPS.

Keep that adapter in this directory under a name like
`adapters/tgn-adapter.ts` — it is intentionally kept out of
`packages/forecasting/` so the production package stays free of bench-
only code paths.

## Tests

```bash
# From repo root
pnpm vitest run evals/forecasting-bench
```

Test coverage:

- `metrics.test.ts` — closed-form expected values for each metric
  (MASE = 0 on identity, sMAPE bounded, CRPS reduces to MAE for
  deterministic forecasts, CRPS on a degenerate sample matches the
  reference identity, interval coverage on edge cases).
- `backtest.test.ts` — fold plan correctness for expanding and sliding
  strategies, error handling, end-to-end run with a stub forecaster.

## CI

Add a `pnpm bench:forecast --quiet` step to the nightly CI run. A drop
in any global MASE > 5 percent vs the prior nightly should page the
forecasting on-call (alert wiring is out of scope for this PR).
