/**
 * `@borjie/forecast-engine` — public surface.
 *
 * A provider-abstraction forecasting engine:
 *  - FORECAST PORT + zod types (TimeSeries / ForecastRequest / ForecastResult).
 *  - CLASSICAL FLOOR (SeasonalNaive / ETS-Theta / Croston / TSB).
 *  - PROVIDER PORT + registry + default classical adapter + TSFM HTTP adapter.
 *  - CONFORMAL WRAPPER (split-conformal / CQR) extending the existing
 *    `@borjie/conformal-calibration-online` ACI substrate (read-only import).
 *  - PORTFOLIO ROUTER (regime + horizon routing, floor-beating gate, blend).
 *  - HIERARCHICAL RECONCILIATION (MinT-lite).
 *  - PREDICTION-APPEND port (forecast APPENDS to a rule-based decision).
 *  - DOMAIN TARGETS (mining-estate + real-estate).
 *
 * Every forecast carries >=1 evidence_id and APPENDS to (never replaces)
 * a rule-based decision.
 */

// Core port + types
export * from './types.js';

// Classical floor
export * from './classical/index.js';

// Providers (port + registry + adapters)
export * from './providers/index.js';

// Conformal wrapper
export * from './conformal/index.js';

// Router + regime + backtest
export {
  createForecastRouter,
  type ForecastRouter,
  type RouterConfig,
  type RouteOutcome,
} from './router/forecast-router.js';
export {
  classifyRegime,
  classicalMethodForRegime,
  type DataRegime,
  type RegimeAssessment,
  type RegimeThresholds,
} from './router/regime-classifier.js';
export {
  backtestProvider,
  beatsFloor,
  type BacktestConfig,
  type BacktestScore,
} from './router/backtest.js';

// Hierarchical reconciliation
export {
  reconcile,
  isCoherent,
  type HierarchyNode,
  type ReconcileMethod,
  type ReconcileInput,
  type ReconcileResult,
} from './hierarchy/reconcile.js';

// Prediction-append port
export {
  appendForecastPrediction,
  AdvisoryPredictionSchema,
  type RuleBasedDecision,
  type AdvisoryPrediction,
  type AppendedForecastEnvelope,
} from './append/prediction-append.js';

// Domain targets
export * from './targets/index.js';

// Engine entry
export {
  createForecastEngine,
  type ForecastEngine,
  type ForecastEngineDeps,
} from './engine.js';

// Numeric utilities (useful for callers building calibration / metrics)
export {
  quantileKey,
  empiricalQuantile,
  conformalQuantile,
  mean,
  mase,
  meanAbsoluteError,
} from './util/quantiles.js';
