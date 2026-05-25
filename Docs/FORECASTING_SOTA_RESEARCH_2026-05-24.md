# Forecasting SOTA Research — 2026-05-24

Scope: this note captures the 2026 state-of-the-art for time-series
forecasting (foundation models, classical, probabilistic, anomaly
detection, conformal calibration, ensembles, real-estate-specific
forecasters) and records what Borjie adopts vs defers.

This document amplifies the existing `packages/forecasting` package
(which is a Temporal-Graph-Network forecaster for per-node risk) with
a complementary **time-series** layer covering rent, occupancy,
churn, maintenance, energy, and market-cycle forecasting.

---

## 1. Foundation models for time-series

The 2024-2026 wave of pretrained foundation models for time series
broke the long-standing assumption that you need a bespoke model per
problem. Zero-shot forecasting at parity-or-better-than-bespoke is
the new floor.

| Model | Source | License | Zero-shot? | Notes |
|---|---|---|---|---|
| Chronos / Chronos-Bolt | Amazon (NeurIPS 2024) | Apache 2.0 | Yes | T5-based; Bolt is the fast variant. We adopt: `createChronosAdapter`. |
| TimesFM 2.0 | Google Research (2024-2025) | Apache 2.0 | Yes | Patched decoder-only on 100B+ time points. We adopt: `createTimesFMAdapter`. |
| Moirai-MoE | Salesforce (ICML 2025) | CC-BY-NC | Yes | Mixture-of-experts; best multivariate. Deferred (non-commercial). |
| Granite Tiny Time Mixers (TTM) | IBM (2024) | Apache 2.0 | Fine-tune | Sub-1M params; runs at the edge. Deferred to v2. |
| TimeGPT-2 | Nixtla (2025) | Commercial API | Yes | Closed-source. We adopt: `createTimeGPTAdapter` (network port). |
| Lag-Llama | Morgan Stanley + Mila (2024) | Apache 2.0 | Yes | Univariate, probabilistic. Deferred (Moirai/Chronos dominate). |

**Adopt now**: ports for Chronos, TimesFM, TimeGPT-2, plus a generic
LLM-zero-shot adapter that uses the existing multi-LLM brain.

**Defer**: TTM (no infrastructure for fine-tune yet), Lag-Llama (we
get better zero-shot from Chronos), Moirai-MoE (license).

## 2. Classical baselines (the floor)

| Method | Use case | Adopt? |
|---|---|---|
| Naive seasonal | Last-year baseline; any seasonal series | YES — `naive-seasonal.ts` |
| Moving average | Stationary low-noise series | YES — `moving-average.ts` |
| Holt-Winters (triple exponential smoothing) | Trend + seasonality | YES — `holt-winters.ts` |
| Linear regression on lagged + calendar | Cheap trend + holiday capture | YES — `linear-regression.ts` |
| Prophet (Facebook 2017) | Daily series with strong seasonality + holidays | Deferred — would add a heavy dep |
| NeuralProphet | Prophet + neural backbone | Deferred — Python-only |
| sktime / darts | Sklearn-style TS toolkits | Deferred — Python |
| statsmodels SARIMAX | ARIMA family | Deferred — Python |

**Adopt now**: four pure-TS local models, zero dependencies. They are
the floor every adapter must beat to justify network calls.

## 3. Probabilistic forecasters

- **GluonTS DeepAR (Salinas et al., 2020)** — RNN-based probabilistic
  forecaster. We adopt the **interval shape** (point + lo + hi per
  horizon step) but compute intervals via conformal prediction, which
  is calibration-guarantee-bearing where DeepAR's parametric assumption
  is not.
- **NHITS / N-BEATS** — strong univariate baselines. Deferred (we
  use Chronos as the strong baseline).
- **PyTorch Forecasting** — Python only.

## 4. Local-LLM zero-shot forecasting

The "LLMtime" line of work (Gruver et al., NeurIPS 2024) showed
that frontier LLMs do competitive zero-shot forecasting when the
series is serialised carefully. We adopt this via the existing
multi-LLM brain (`createLLMForecaster({ brain })`). The brain
synthesizes from Claude / GPT / Gemini and we parse the response.

This gives us a sixth "model" with no model-deployment overhead. It
costs tokens, so we use it as a fallback / ensemble member, not the
primary.

## 5. RE-specific forecasters (composers, not models)

These are the productised wrappers business users actually call. Each
is a composer that picks an ensemble of underlying forecasters and
adds domain logic (jurisdictional rent caps, capex amortisation,
weather covariates).

| Forecaster | Inputs | Domain logic |
|---|---|---|
| `forecastRent` | history of monthly rents + comparables | Rent-cap caps per jurisdiction (e.g. Tanzania Rent Restriction Act; EU caps) |
| `forecastOccupancy` | history of nightly occupancy | Seasonal Holt-Winters + Chronos ensemble |
| `forecastChurn` | tenant signals over time | Survival-style hazard projection |
| `forecastMaintenanceFailure` | asset event log | Reliability/Weibull-ish hazard |
| `forecastEnergyConsumption` | meter reads (+ optional weather) | Degree-day adjustment |
| `forecastMarketCycle` | regional metric + macro covariates | Trend + macro regression |

References:
- HUD rent indices and Zillow Home Value Forecast (public methods)
  for rent baselines.
- CBRE occupancy modelling reports (publicly summarised methodology)
  for the seasonality decomposition we mirror.
- IFC ESMAP weather-degree-day method for energy forecasting.

## 6. Ensembles + stacking

- **Linear weighted combiner** — fastest, robust to single-model
  catastrophic forecasts. We adopt as `combiner: 'weighted'`.
- **Median** — Huber-robust against single-model outliers. We adopt as
  `combiner: 'median'`.
- **Mean** — naive uniform-weight ensemble. We adopt as `'mean'`.
- **Stacking with linear regression on holdout** — learns weights from
  holdout performance. We adopt as `'stacking'`. References:
  Wolpert (1992); Hastie/Tibshirani/Friedman ESL ch.8.

## 7. Anomaly detection

- **Change-point: PELT (Killick et al., 2012)** — pruned-exact-linear-
  time change-point detector. We adopt a TS-pure variant.
- **Windowed z-score** — fastest, simplest. Adopted as `'zscore'`.
- **Isolation Forest (Liu et al., ICDM 2008)** — used for high-dim
  anomalies. Deferred (we'd need a forest library; the windowed
  z-score + PELT cover the time-series case).

## 8. Conformal prediction (CP) intervals

The existing package already ships
`createAbsoluteResidualCalibrator` and
`createProbabilityCalibrator`. We re-use them for the time-series
side via `wrapWithConformalIntervals(predictor, calibSet, alpha)`,
which:

1. Runs the predictor on the calibration set
2. Computes per-horizon-step residuals
3. Returns a wrapped predictor whose `Forecast.points[h].interval` is
   ICP-calibrated per horizon step (Romano et al. NeurIPS 2019).

References:
- Vovk, Gammerman, Shafer — Algorithmic Learning in a Random World.
- Angelopoulos, Bates — A Gentle Introduction to Conformal Prediction
  (2021).
- Romano, Patterson, Candès — Conformalized Quantile Regression
  (NeurIPS 2019).

## 9. Backtesting (time-series cross-validation)

Adopted: walk-forward CV with gap-anchored splits. The gap prevents
target-leakage when the forecaster uses lagged features.

Metrics: MAE, MAPE, RMSE, MASE (Hyndman & Koehler, 2006), CRPS for
probabilistic forecasts (Gneiting & Raftery, 2007).

References:
- Hyndman & Koehler "Another look at measures of forecast accuracy"
  (Int. J. Forecasting 2006).
- Bergmeir & Benítez "On the use of cross-validation for time-series"
  (Inf. Sciences 2012).
- Gneiting & Raftery "Strictly proper scoring rules" (JASA 2007).

## 10. Sources cited (≥ 10)

1. Ansari et al. "Chronos: Learning the Language of Time Series" (2024).
2. Das et al. "TimesFM: A decoder-only foundation model for time-series" (Google, 2024).
3. Woo et al. "Moirai: A Unified Pre-trained Time-Series Foundation Model" (Salesforce, 2024).
4. Ekambaram et al. "Tiny Time Mixers (TTMs)" (IBM, 2024).
5. Garza & Mergenthaler-Canseco "TimeGPT-1" (Nixtla, 2023).
6. Rasul et al. "Lag-Llama: Towards Foundation Models for Probabilistic Time Series Forecasting" (Morgan Stanley + Mila, 2024).
7. Salinas et al. "DeepAR: Probabilistic Forecasting with Autoregressive Recurrent Networks" (Int. J. Forecasting 2020).
8. Gruver et al. "Large Language Models Are Zero-Shot Time Series Forecasters" (NeurIPS 2024).
9. Romano, Patterson, Candès "Conformalized Quantile Regression" (NeurIPS 2019).
10. Angelopoulos & Bates "A Gentle Introduction to Conformal Prediction" (arXiv 2107.07511, 2021).
11. Hyndman & Koehler "Another look at measures of forecast accuracy" (Int. J. Forecasting 2006).
12. Killick, Fearnhead, Eckley "PELT" (JASA 2012).
13. Wolpert "Stacked Generalization" (Neural Networks 1992).
14. Gneiting & Raftery "Strictly Proper Scoring Rules" (JASA 2007).

## 11. What we adopt vs defer

Adopted in this round:
- 4 local pure-TS models (naive seasonal, MA, Holt-Winters, linreg).
- 4 foundation-model adapter ports (Chronos, TimesFM, TimeGPT-2,
  LLM zero-shot via multi-LLM brain).
- Conformal-interval wrapper over any predictor.
- Walk-forward backtesting with MAE/MAPE/RMSE/MASE/CRPS.
- 6 RE-specific composers (rent, occupancy, churn, maintenance,
  energy, market-cycle).
- Anomaly detection (z-score windowed + PELT-ish change-points).
- Ensembles (mean / median / weighted / stacking).

Deferred:
- TTM fine-tuning (no infra).
- Prophet / sktime / darts / statsmodels (Python-only; would need
  a service boundary like the TGN one).
- Moirai-MoE (CC-BY-NC license).
- Isolation forest (z-score + PELT cover our case).
