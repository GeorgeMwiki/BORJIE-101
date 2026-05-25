/**
 * @borjie/forecasting — public surface.
 *
 * Per-org and platform-scale forecasts with conformal prediction
 * intervals. Ports-and-adapters throughout; a downstream inference
 * service (Python + PyTorch + PyG) implements the TGN port.
 *
 * Three layers stack:
 *   1. Local tabular baseline (GBM-style) — floor model.
 *   2. Temporal Graph Network on the tenant subgraph — primary.
 *   3. Geometric foundation model on the DP-aggregated platform
 *      graph — moat product, via PlatformForecast.
 *
 * Every forecast ships with a calibrated prediction interval plus
 * driver narrative; nothing ever leaves this package as a bare
 * point estimate.
 */

export * from './types.js';
export {
  createAbsoluteResidualCalibrator,
  createProbabilityCalibrator,
  quantile,
  type Calibrator,
  type CalibrationPoint,
  type CalibratorOptions,
} from './conformal/inductive.js';
export {
  createFeatureExtractor,
  type FeatureExtractor,
  type FeatureExtractorDeps,
  type FeatureExtractorOptions,
  type TabularSource,
  type GraphSource,
  type TemporalSource,
} from './features/extractor.js';
export {
  createTgnForecaster,
  type CalibratorRegistry,
  type DriverExplainer,
  type TgnInferenceAdapter,
  type TgnInferencePrediction,
  type TgnForecasterDeps,
} from './models/tgn-forecaster.js';
export { canonicalJSON, sha256Hex, sha256Short } from './util/hash.js';

// ─────────────────────────────────────────────────────────────────────
// Time-series forecasting layer — added 2026-05-24.
// ─────────────────────────────────────────────────────────────────────

export {
  createNaiveSeasonalForecaster,
  type NaiveSeasonalOptions,
} from './models/naive-seasonal.js';
export {
  createMovingAverageForecaster,
  type MovingAverageOptions,
} from './models/moving-average.js';
export {
  createHoltWintersForecaster,
  type HoltWintersOptions,
} from './models/holt-winters.js';
export {
  createLinearRegressionForecaster,
  type LinearRegressionOptions,
} from './models/linear-regression.js';
export {
  createChronosAdapter,
  createTimesFMAdapter,
  createTimeGPTAdapter,
  createLLMForecaster,
  createDeterministicMockNetwork,
  type ChronosAdapterOptions,
  type TimesFMAdapterOptions,
  type TimeGPTAdapterOptions,
  type LLMForecasterOptions,
  type LLMBrain,
  type FoundationModelNetwork,
  type FoundationModelResponse,
  type FoundationModelCallArgs,
} from './models/adapters.js';
export {
  wrapWithConformalIntervals,
  type CalibrationSample,
  type ConformalWrapperOptions,
} from './conformal/time-series.js';
export {
  advanceTimestamp,
  assertValidSeries,
  buildForecastIntervals,
  frequencyToMinutes,
  futureTimestamps,
  heuristicIntervals,
  lagDifference,
  mean,
  median,
  stdDev,
  tail,
  values,
} from './util/series.js';
export {
  backtest,
  type BacktestOptions,
  type BacktestMetric,
} from './backtesting/index.js';
export {
  detectAnomalies,
  type AnomalyDetectorOptions,
} from './anomaly/index.js';
export {
  createEnsemble,
  type EnsembleCombiner,
  type EnsembleOptions,
} from './ensembles/index.js';
export {
  forecastRent,
  forecastOccupancy,
  forecastChurn,
  forecastMaintenanceFailure,
  forecastEnergyConsumption,
  forecastMarketCycle,
  rentCapFor,
  applyRentCap,
  type RentForecastInput,
  type OccupancyForecastInput,
  type ChurnForecastInput,
  type MaintenanceForecastInput,
  type EnergyForecastInput,
  type MarketCycleForecastInput,
  type RentCapPolicy,
} from './re-forecasters/index.js';
