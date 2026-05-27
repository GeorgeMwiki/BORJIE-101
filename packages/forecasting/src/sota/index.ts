/**
 * `@borjie/forecasting/sota` — public surface for the SOTA
 * time-series forecasting layer.
 *
 * Six mining-domain forecasts (gold price, production volume,
 * royalty, demand, workforce, fuel) composed over a port-and-adapter
 * substrate covering TimeGPT, Chronos, MOIRAI, Prophet, ARIMA, and
 * N-BEATS/N-HiTS. See Docs/DESIGN/FORECASTING_SOTA_2026.md.
 *
 * Persona: Mr. Mwikila.
 *
 * @module @borjie/forecasting/sota
 */

// Types
export type {
  TimeSeries,
  TimePoint,
  TsFrequency,
  ForecastHorizon,
  ForecastResult,
  IntervalBound,
  ForecastOptions,
  SotaModel,
  ForecastTarget,
  BacktestMetrics,
  BacktestSplit,
  Backtest,
  SotaForecastingPort,
  Fetcher,
  SidecarPort,
  ForecastRun,
  ForecastRunInsert,
  ForecastRunFilter,
  ForecastRunRepository,
  MiningForecastNarrative,
  MiningForecastResult,
} from './types.js';

export {
  TS_FREQUENCIES,
  SOTA_MODELS,
  FORECAST_TARGETS,
  timeSeriesSchema,
  timePointSchema,
  forecastHorizonSchema,
  forecastResultSchema,
  intervalBoundSchema,
  sotaModelSchema,
  forecastTargetSchema,
  backtestMetricsSchema,
} from './types.js';

// Logger
export {
  buildSotaLogger,
  NOOP_SOTA_LOGGER,
  type SotaLogger,
  type SotaLoggerOptions,
} from './logger.js';

// Models
export {
  createNaiveLastForecaster,
  createNaiveSeasonalForecaster,
  createNaiveMeanForecaster,
  nextTimestamp,
  type NaiveSeasonalOptions,
} from './models/naive-baseline.js';

export {
  createTimeGptForecaster,
  type TimeGptPortOptions,
} from './models/timegpt-port.js';

export {
  createChronosForecaster,
  type ChronosPortOptions,
} from './models/chronos-port.js';

export {
  createMoiraiForecaster,
  type MoiraiPortOptions,
} from './models/moirai-port.js';

export {
  createProphetForecaster,
  type ProphetPortOptions,
} from './models/prophet-port.js';

export {
  createArimaForecaster,
  type ArimaPortOptions,
} from './models/arima-port.js';

export {
  createNBeatsForecaster,
  type NBeatsPortOptions,
  type NBeatsVariant,
} from './models/nbeats-port.js';

// Ensemble
export {
  createEnsembleForecaster,
  combineForecasts,
  weightedForecasterSchema,
  type WeightedForecaster,
  type EnsembleOptions,
} from './ensemble/ensemble.js';

// Backtest
export {
  walkForwardBacktest,
  type WalkForwardOptions,
} from './backtest/walk-forward.js';

export {
  mae,
  rmse,
  mape,
  smape,
  mase,
  owa,
  quantileLoss,
  weightedQuantileLoss,
  type MetricInputs,
  type MaseInputs,
  type OwaInputs,
  type QuantileInputs,
} from './backtest/metrics.js';

// Preprocess
export {
  decomposeSeasonality,
  type SeasonalDecomposition,
} from './preprocess/seasonality.js';

export {
  linearDetrend,
  type LinearTrend,
} from './preprocess/trend.js';

export {
  clipOutliers,
  type OutlierClipResult,
  type OutlierMethod,
} from './preprocess/outlier.js';

// Mining-domain wrappers
export {
  forecastGoldPrice,
  forecastProductionVolume,
  forecastDemand,
  forecastWorkforce,
  forecastFuelCost,
  forecastRoyaltyRevenue,
  type ForecastGoldPriceInput,
  type ForecastProductionVolumeInput,
  type ForecastDemandInput,
  type ForecastWorkforceInput,
  type ForecastFuelCostInput,
  type ForecastRoyaltyRevenueInput,
  type MiningForecastDeps,
} from './domain/mining-forecasts.js';
