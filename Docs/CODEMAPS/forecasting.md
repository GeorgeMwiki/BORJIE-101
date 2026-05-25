# Forecasting Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/forecasting/`
**Public entry:** `packages/forecasting/src/index.ts`
**Tier scope:** cognitive core (probabilistic forecasting)

## Purpose

The probabilistic forecasting toolkit: feature engineering, point
models, and **conformal prediction** wrappers that turn any point
forecaster into a calibrated interval forecaster. Used by the Brain
for occupancy, churn, arrears, and cashflow forecasts. Bench
harness lives at repo-root `evals/forecasting-bench/`.

## Entry points

- `src/index.ts` — barrel.
- `src/types.ts` — `Forecast`, `Interval`, `Series`, model interfaces.
- `src/features/` — feature transforms (lags, calendar, rolling).
- `src/models/` — point forecasters (ARIMA-style, ETS, naive).
- `src/conformal/` — `SplitConformalRegressor`, calibrated intervals.
- `src/util/` — split utilities, metrics.

## Internal structure

- `features/` — time-series feature engineering.
- `models/` — point forecasters with consistent fit/predict API.
- `conformal/` — wraps any model with split-conformal intervals.
- `util/` — train/calibration/test splits + scoring.

## Dependencies

- Upstream: zod, `@borjie/observability` (for eval traces).
- Downstream: central-intelligence (forecast tools),
  forecasting-engine (orchestration), reports-service.

## Common workflows

- **Fit + forecast** →
  `const m = new ETSModel(); m.fit(series); m.predict(h)`.
- **Calibrate intervals** →
  `new SplitConformal(m).fit(...).predict(h, { alpha: 0.1 })`.
- **Score** → `crps(forecast, actual)`.
- **Bench** → `pnpm bench:forecast`.

## Anti-patterns to avoid

- Never predict without a calibration split (no-leak rule).
- Never ship a point forecast on a money path — use intervals.
- Never log raw training data (PII).
- Never claim coverage without a held-out calibration set.

## Related codemaps

- [forecasting-engine.md](./forecasting-engine.md) — orchestrator
- [central-intelligence.md](./central-intelligence.md) — consumer
- [observability.md](./observability.md) — bench traces
