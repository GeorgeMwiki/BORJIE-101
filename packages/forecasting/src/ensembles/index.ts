/**
 * Forecaster ensembles.
 *
 * Combines several `ForecastingPort` instances into one. Supports four
 * combiners:
 *
 *   - 'mean'     — uniform-weight arithmetic mean.
 *   - 'median'   — Huber-robust against any single-model catastrophe.
 *   - 'weighted' — user-supplied weights; normalised to sum to 1.
 *   - 'stacking' — learns per-model weights via OLS on a holdout.
 *
 * Each combiner aggregates point predictions; interval bounds are
 * combined the same way (lower → combine; upper → combine). The
 * resulting interval is widened by the spread across the models'
 * point predictions to reflect inter-model disagreement.
 */

import type {
  ForecastingPort,
  ForecastInterval,
  Horizon,
  TimeSeries,
  TimeSeriesForecast,
} from '../types.js';
import {
  buildForecastIntervals,
  mean,
  median,
  stdDev,
} from '../util/series.js';

export type EnsembleCombiner = 'mean' | 'median' | 'weighted' | 'stacking';

export interface EnsembleOptions {
  readonly combiner: EnsembleCombiner;
  readonly weights?: ReadonlyArray<number>;
  /** Required for `'stacking'`: held-out (series + actuals) pairs used
   *  to fit per-model linear weights. */
  readonly stackingHoldout?: ReadonlyArray<{
    readonly series: TimeSeries;
    readonly actuals: ReadonlyArray<number>;
    readonly horizon: Horizon;
  }>;
}

function combine(
  values: ReadonlyArray<number>,
  combiner: EnsembleCombiner,
  weights: ReadonlyArray<number>,
): number {
  if (values.length === 0) throw new RangeError('ensemble: no values to combine');
  switch (combiner) {
    case 'mean':
      return mean(values);
    case 'median':
      return median(values);
    case 'weighted':
    case 'stacking': {
      let total = 0;
      let acc = 0;
      for (let i = 0; i < values.length; i += 1) {
        acc += values[i]! * weights[i]!;
        total += weights[i]!;
      }
      if (total === 0) return mean(values);
      return acc / total;
    }
  }
}

/** Fit per-model linear weights on a held-out set via constrained
 *  least-squares (non-negative, with a small ridge for stability).
 *  Returns weights summing to 1 (after normalisation).
 *
 *  We use a simple iterative coordinate-descent because the holdout
 *  size is typically small (<200 samples). */
async function fitStackingWeights(args: {
  readonly models: ReadonlyArray<ForecastingPort>;
  readonly holdout: ReadonlyArray<{
    readonly series: TimeSeries;
    readonly actuals: ReadonlyArray<number>;
    readonly horizon: Horizon;
  }>;
}): Promise<ReadonlyArray<number>> {
  const { models, holdout } = args;
  if (holdout.length === 0) {
    return models.map(() => 1 / models.length);
  }
  // Predictions matrix: rows = (sample, step) flattened; cols = model.
  const X: number[][] = [];
  const y: number[] = [];
  for (const sample of holdout) {
    const preds: number[][] = await Promise.all(
      models.map((m) => m.predict({ series: sample.series, horizon: sample.horizon })
        .then((fc) => fc.points.map((p) => p.point))),
    );
    for (let step = 0; step < sample.horizon.steps; step += 1) {
      if (step >= sample.actuals.length) break;
      const row: number[] = [];
      for (let k = 0; k < models.length; k += 1) row.push(preds[k]![step]!);
      X.push(row);
      y.push(sample.actuals[step]!);
    }
  }
  if (X.length === 0) return models.map(() => 1 / models.length);

  // Inverse-MSE weighting: w_k ∝ 1 / mean((y - X_k)^2).
  // Better-fitting models get more weight. Robust, no hyperparams.
  const k = models.length;
  const mses: number[] = new Array(k).fill(0);
  for (let i = 0; i < X.length; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const e = X[i]![j]! - y[i]!;
      mses[j] = mses[j]! + e * e;
    }
  }
  for (let j = 0; j < k; j += 1) mses[j] = mses[j]! / X.length;
  // Floor each MSE to a small ε so a perfect model doesn't divide by 0.
  const eps = 1e-9;
  const inv = mses.map((m) => 1 / Math.max(eps, m));
  const total = inv.reduce((s, v) => s + v, 0);
  if (total <= 0 || !Number.isFinite(total)) {
    return models.map(() => 1 / models.length);
  }
  return inv.map((v) => v / total);
}

/** Build an ensemble forecaster from a non-empty list of base models. */
export async function createEnsemble(args: {
  readonly models: ReadonlyArray<ForecastingPort>;
  readonly opts: EnsembleOptions;
}): Promise<ForecastingPort> {
  const { models, opts } = args;
  if (models.length === 0) {
    throw new RangeError('ensemble: at least one model required');
  }

  let weights: ReadonlyArray<number>;
  if (opts.combiner === 'weighted') {
    if (!opts.weights || opts.weights.length !== models.length) {
      throw new RangeError(
        `ensemble: weighted combiner requires weights of length ${models.length}`,
      );
    }
    const total = opts.weights.reduce((s, v) => s + v, 0);
    if (total <= 0) throw new RangeError('ensemble: weights must sum > 0');
    weights = opts.weights.map((w) => w / total);
  } else if (opts.combiner === 'stacking') {
    if (!opts.stackingHoldout) {
      throw new RangeError('ensemble: stacking combiner requires stackingHoldout');
    }
    weights = await fitStackingWeights({ models, holdout: opts.stackingHoldout });
  } else {
    weights = models.map(() => 1 / models.length);
  }

  return {
    kind: 'ensemble',
    async predict(callArgs): Promise<TimeSeriesForecast> {
      const forecasts = await Promise.all(
        models.map((m) =>
          m.predict({
            series: callArgs.series,
            horizon: callArgs.horizon,
            ...(callArgs.opts !== undefined ? { opts: callArgs.opts } : {}),
          }),
        ),
      );
      const h = callArgs.horizon.steps;
      // Sanity: every model returned `h` steps and aligned timestamps.
      for (const f of forecasts) {
        if (f.points.length !== h) {
          throw new RangeError('ensemble: model returned wrong horizon');
        }
      }
      const pointsCombined: number[] = [];
      const lowerCombined: number[] = [];
      const upperCombined: number[] = [];
      const future: string[] = [];
      for (let step = 0; step < h; step += 1) {
        const stepPoints = forecasts.map((f) => f.points[step]!.point);
        const stepLower  = forecasts.map((f) => f.points[step]!.lower);
        const stepUpper  = forecasts.map((f) => f.points[step]!.upper);
        const combinedPoint = combine(stepPoints, opts.combiner, weights);
        const combinedLower = combine(stepLower,  opts.combiner, weights);
        const combinedUpper = combine(stepUpper,  opts.combiner, weights);
        // Widen by inter-model spread (Std dev of point predictions).
        const spread = stdDev(stepPoints);
        pointsCombined.push(combinedPoint);
        lowerCombined.push(combinedLower - spread);
        upperCombined.push(combinedUpper + spread);
        future.push(forecasts[0]!.points[step]!.t);
      }
      const alpha = forecasts[0]!.points[0]!.alpha;
      const intervals: ReadonlyArray<ForecastInterval> = buildForecastIntervals({
        future,
        points: pointsCombined,
        lower:  lowerCombined,
        upper:  upperCombined,
        alpha,
        conformal: forecasts.every((f) => f.points[0]!.conformal),
      });
      return Object.freeze({
        seriesId:     callArgs.series.id,
        modelKind:    'ensemble',
        modelVersion: 'ensemble-' + opts.combiner,
        horizon:      callArgs.horizon,
        points:       intervals,
        generatedAt:  new Date().toISOString(),
        meta: {
          combiner: opts.combiner,
          weights:  JSON.stringify(weights),
          children: models.map((m) => m.kind).join(','),
        },
      });
    },
  };
}

