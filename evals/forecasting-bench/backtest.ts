/**
 * Rolling-origin backtest framework.
 *
 * Idea: split a time series into successive (train, test) windows, slide
 * the origin forward, evaluate at every cut. This is the only honest way
 * to score a forecaster without lookahead leakage.
 *
 *   Expanding window: train on [0..k], test on [k..k+h], advance k.
 *                     Training data grows monotonically.
 *
 *   Sliding window:   train on [k-w..k], test on [k..k+h], advance k.
 *                     Training window is fixed width — better for
 *                     non-stationary series.
 *
 * Returns:
 *   - per-fold metrics
 *   - per-series aggregates (mean over folds)
 *   - per-tenant aggregates (mean over series within tenant)
 *   - global aggregate (mean over tenants)
 *
 * The framework is forecaster-agnostic — it accepts the standard
 * `Forecaster` interface from `baselines.ts` and never inspects the model.
 */

import type { Forecaster, ForecastOutput } from './baselines.ts';
import {
  mae,
  rmse,
  mape,
  smape,
  mase,
  crps,
  intervalCoverage,
  type MetricReport,
} from './metrics.ts';

export interface SeriesInput {
  readonly seriesId: string;
  readonly tenantId: string;
  /** Full observed history, length >= minTrainSize + horizon. */
  readonly values: ReadonlyArray<number>;
  /** Seasonal period m; informs MASE denominator + seasonal-naive baseline. */
  readonly seasonality: number;
}

export type WindowStrategy = 'expanding' | 'sliding';

export interface BacktestConfig {
  readonly strategy: WindowStrategy;
  /** Forecast horizon h — number of steps predicted per fold. */
  readonly horizon: number;
  /** Minimum training window — first fold uses exactly this many points. */
  readonly minTrainSize: number;
  /** Fixed training-window width for sliding mode; ignored for expanding. */
  readonly slidingWindow?: number;
  /** Step between fold origins. Default = horizon (non-overlapping test sets). */
  readonly stride?: number;
  /** Hard cap on folds per series — prevents runaway costs on long histories. */
  readonly maxFolds?: number;
}

export interface FoldResult {
  readonly seriesId: string;
  readonly tenantId: string;
  readonly foldIndex: number;
  readonly origin: number;
  readonly trainSize: number;
  readonly horizon: number;
  readonly metrics: MetricReport;
}

export interface SeriesResult {
  readonly seriesId: string;
  readonly tenantId: string;
  readonly foldCount: number;
  readonly aggregate: AggregateMetrics;
  readonly folds: ReadonlyArray<FoldResult>;
}

export interface TenantResult {
  readonly tenantId: string;
  readonly seriesCount: number;
  readonly aggregate: AggregateMetrics;
}

export interface GlobalResult {
  readonly tenantCount: number;
  readonly seriesCount: number;
  readonly foldCount: number;
  readonly aggregate: AggregateMetrics;
}

export interface AggregateMetrics {
  readonly mae: number;
  readonly rmse: number;
  readonly mape: number;
  readonly smape: number;
  readonly mase: number;
  readonly crps: number | null;
  readonly coverage80: number | null;
  readonly coverage95: number | null;
}

export interface BacktestRun {
  readonly modelName: string;
  readonly scenarioId: string;
  readonly config: BacktestConfig;
  readonly perSeries: ReadonlyArray<SeriesResult>;
  readonly perTenant: ReadonlyArray<TenantResult>;
  readonly global: GlobalResult;
  readonly elapsedMs: number;
}

// ───────────────────────────────────────────────────────────────────────
// Fold generation.
// ───────────────────────────────────────────────────────────────────────

interface Fold {
  readonly trainStart: number;
  readonly trainEnd: number; // exclusive
  readonly testStart: number;
  readonly testEnd: number;  // exclusive
}

function planFolds(seriesLength: number, config: BacktestConfig): ReadonlyArray<Fold> {
  const stride = config.stride ?? config.horizon;
  const maxFolds = config.maxFolds ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(config.horizon) || config.horizon < 1) {
    throw new Error(`backtest: horizon must be a positive integer, got ${config.horizon}`);
  }
  if (!Number.isInteger(config.minTrainSize) || config.minTrainSize < 1) {
    throw new Error(`backtest: minTrainSize must be a positive integer, got ${config.minTrainSize}`);
  }
  if (!Number.isInteger(stride) || stride < 1) {
    throw new Error(`backtest: stride must be a positive integer, got ${stride}`);
  }
  if (config.strategy === 'sliding') {
    if (!config.slidingWindow || config.slidingWindow < 1) {
      throw new Error('backtest: sliding strategy requires positive slidingWindow');
    }
    if (config.slidingWindow < config.minTrainSize) {
      throw new Error('backtest: slidingWindow must be >= minTrainSize');
    }
  }
  const folds: Array<Fold> = [];
  let origin = config.minTrainSize;
  while (origin + config.horizon <= seriesLength && folds.length < maxFolds) {
    const trainStart = config.strategy === 'sliding'
      ? Math.max(0, origin - (config.slidingWindow ?? 0))
      : 0;
    folds.push({
      trainStart,
      trainEnd: origin,
      testStart: origin,
      testEnd: origin + config.horizon,
    });
    origin += stride;
  }
  return folds;
}

// ───────────────────────────────────────────────────────────────────────
// Single-fold evaluation.
// ───────────────────────────────────────────────────────────────────────

function scoreFold(
  series: SeriesInput,
  fold: Fold,
  forecast: ForecastOutput,
  foldIndex: number,
): FoldResult {
  const train = series.values.slice(fold.trainStart, fold.trainEnd);
  const actuals = series.values.slice(fold.testStart, fold.testEnd);
  if (actuals.length !== forecast.point.length) {
    throw new Error(`backtest: forecast horizon (${forecast.point.length}) does not match test length (${actuals.length})`);
  }
  const metrics: MetricReport = {
    mae: mae({ actuals, predictions: forecast.point }),
    rmse: rmse({ actuals, predictions: forecast.point }),
    mape: mape({ actuals, predictions: forecast.point }),
    smape: smape({ actuals, predictions: forecast.point }),
    mase: mase({
      actuals,
      predictions: forecast.point,
      trainHistory: train,
      seasonality: series.seasonality,
    }),
    crps: crps({ actuals, samples: forecast.samples }),
    coverage80: intervalCoverage({
      actuals,
      lowers: forecast.lower80,
      uppers: forecast.upper80,
    }),
    coverage95: intervalCoverage({
      actuals,
      lowers: forecast.lower95,
      uppers: forecast.upper95,
    }),
  };
  return {
    seriesId: series.seriesId,
    tenantId: series.tenantId,
    foldIndex,
    origin: fold.testStart,
    trainSize: fold.trainEnd - fold.trainStart,
    horizon: forecast.point.length,
    metrics,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Aggregation helpers.
// ───────────────────────────────────────────────────────────────────────

function averageOptional(values: ReadonlyArray<number | null | undefined>): number | null {
  const kept: Array<number> = [];
  for (const v of values) {
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      kept.push(v);
    }
  }
  if (kept.length === 0) {
    return null;
  }
  let sum = 0;
  for (const v of kept) {
    sum += v;
  }
  return sum / kept.length;
}

function aggregateFoldMetrics(folds: ReadonlyArray<FoldResult>): AggregateMetrics {
  if (folds.length === 0) {
    throw new Error('backtest: cannot aggregate zero folds');
  }
  return {
    mae: averageOptional(folds.map((f) => f.metrics.mae)) ?? 0,
    rmse: averageOptional(folds.map((f) => f.metrics.rmse)) ?? 0,
    mape: averageOptional(folds.map((f) => f.metrics.mape)) ?? 0,
    smape: averageOptional(folds.map((f) => f.metrics.smape)) ?? 0,
    mase: averageOptional(folds.map((f) => f.metrics.mase)) ?? 0,
    crps: averageOptional(folds.map((f) => f.metrics.crps)),
    coverage80: averageOptional(folds.map((f) => f.metrics.coverage80?.rate ?? null)),
    coverage95: averageOptional(folds.map((f) => f.metrics.coverage95?.rate ?? null)),
  };
}

function aggregateSeriesMetrics(seriesResults: ReadonlyArray<SeriesResult>): AggregateMetrics {
  if (seriesResults.length === 0) {
    throw new Error('backtest: cannot aggregate zero series');
  }
  return {
    mae: averageOptional(seriesResults.map((s) => s.aggregate.mae)) ?? 0,
    rmse: averageOptional(seriesResults.map((s) => s.aggregate.rmse)) ?? 0,
    mape: averageOptional(seriesResults.map((s) => s.aggregate.mape)) ?? 0,
    smape: averageOptional(seriesResults.map((s) => s.aggregate.smape)) ?? 0,
    mase: averageOptional(seriesResults.map((s) => s.aggregate.mase)) ?? 0,
    crps: averageOptional(seriesResults.map((s) => s.aggregate.crps)),
    coverage80: averageOptional(seriesResults.map((s) => s.aggregate.coverage80)),
    coverage95: averageOptional(seriesResults.map((s) => s.aggregate.coverage95)),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Public entrypoint.
// ───────────────────────────────────────────────────────────────────────

export interface RunBacktestInput {
  readonly modelName: string;
  readonly scenarioId: string;
  readonly series: ReadonlyArray<SeriesInput>;
  readonly forecaster: Forecaster;
  readonly config: BacktestConfig;
}

export function runBacktest(input: RunBacktestInput): BacktestRun {
  const start = Date.now();
  const perSeries: Array<SeriesResult> = [];
  for (const series of input.series) {
    const folds = planFolds(series.values.length, input.config);
    if (folds.length === 0) {
      continue;
    }
    const foldResults: Array<FoldResult> = [];
    let foldIndex = 0;
    for (const fold of folds) {
      const train = series.values.slice(fold.trainStart, fold.trainEnd);
      const forecast = input.forecaster(train, input.config.horizon);
      foldResults.push(scoreFold(series, fold, forecast, foldIndex));
      foldIndex += 1;
    }
    perSeries.push({
      seriesId: series.seriesId,
      tenantId: series.tenantId,
      foldCount: foldResults.length,
      aggregate: aggregateFoldMetrics(foldResults),
      folds: foldResults,
    });
  }
  if (perSeries.length === 0) {
    throw new Error('backtest: produced zero folds across all series — check minTrainSize vs series length');
  }
  // Per-tenant aggregation.
  const byTenant = new Map<string, Array<SeriesResult>>();
  for (const sr of perSeries) {
    const list = byTenant.get(sr.tenantId);
    if (list) {
      list.push(sr);
    } else {
      byTenant.set(sr.tenantId, [sr]);
    }
  }
  const perTenant: Array<TenantResult> = [];
  for (const [tenantId, list] of byTenant) {
    perTenant.push({
      tenantId,
      seriesCount: list.length,
      aggregate: aggregateSeriesMetrics(list),
    });
  }
  perTenant.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  return {
    modelName: input.modelName,
    scenarioId: input.scenarioId,
    config: input.config,
    perSeries,
    perTenant,
    global: {
      tenantCount: perTenant.length,
      seriesCount: perSeries.length,
      foldCount: perSeries.reduce((acc, s) => acc + s.foldCount, 0),
      aggregate: aggregateSeriesMetrics(perSeries),
    },
    elapsedMs: Date.now() - start,
  };
}

// Exposed for unit tests + advanced callers that want to inspect the
// fold plan before running.
export { planFolds };
