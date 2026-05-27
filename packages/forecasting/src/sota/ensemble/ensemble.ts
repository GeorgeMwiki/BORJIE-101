/**
 * SOTA forecast ensemble — weighted convex combination.
 *
 * Combines N `ForecastResult`s under user-supplied weights that must
 * sum to 1 (zod-validated). The point forecast is the weighted point;
 * the 80 / 95 intervals use the *conservative envelope*: lower =
 * min(lower_i), upper = max(upper_i). The convex-combine alternative
 * is rejected because it systematically under-covers when constituent
 * models disagree.
 *
 * The ensemble itself implements `SotaForecastingPort` so it can be
 * registered as a model — useful when an operator wants
 * `ensemble:timegpt,chronos,naive-seasonal` as a first-class model.
 *
 * @module @borjie/forecasting/sota/ensemble/ensemble
 */

import { z } from 'zod';
import type {
  ForecastHorizon,
  ForecastResult,
  IntervalBound,
  SotaForecastingPort,
  TimeSeries,
} from '../types.js';

const WEIGHT_TOLERANCE = 1e-6;

export interface WeightedForecaster {
  readonly forecaster: SotaForecastingPort;
  readonly weight: number;
}

export const weightedForecasterSchema = z.object({
  forecaster: z.any(),
  weight: z.number().nonnegative(),
});

export interface EnsembleOptions {
  readonly members: ReadonlyArray<WeightedForecaster>;
  /** Optional version label (e.g. 'ensemble:timegpt,chronos,naive-seasonal'). */
  readonly versionLabel?: string;
}

function assertNormalizedWeights(
  members: ReadonlyArray<WeightedForecaster>,
): void {
  if (members.length === 0) {
    throw new RangeError('ensemble: no members');
  }
  const sum = members.reduce((acc, m) => acc + m.weight, 0);
  if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
    throw new RangeError(
      `ensemble: weights must sum to 1 (got ${sum.toFixed(6)})`,
    );
  }
}

/**
 * Build a weighted ensemble forecast from already-computed results.
 * Useful when the caller wants to fan out to a custom executor.
 */
export function combineForecasts(args: {
  readonly seriesId: string;
  readonly horizon: ForecastHorizon;
  readonly weighted: ReadonlyArray<{
    readonly result: ForecastResult;
    readonly weight: number;
  }>;
  readonly versionLabel?: string;
}): ForecastResult {
  if (args.weighted.length === 0) {
    throw new RangeError('combineForecasts: no results');
  }
  const sumW = args.weighted.reduce((acc, w) => acc + w.weight, 0);
  if (Math.abs(sumW - 1) > WEIGHT_TOLERANCE) {
    throw new RangeError(
      `combineForecasts: weights must sum to 1 (got ${sumW.toFixed(6)})`,
    );
  }
  const steps = args.horizon.steps;
  // Validate all results align on horizon.
  for (const w of args.weighted) {
    if (w.result.point.length !== steps) {
      throw new RangeError(
        `combineForecasts: member point length ${w.result.point.length} != horizon ${steps}`,
      );
    }
  }
  const point: number[] = new Array(steps).fill(0);
  const i80: IntervalBound[] = [];
  const i95: IntervalBound[] = [];
  for (let s = 0; s < steps; s += 1) {
    let pSum = 0;
    let lower80 = Number.POSITIVE_INFINITY;
    let upper80 = Number.NEGATIVE_INFINITY;
    let lower95 = Number.POSITIVE_INFINITY;
    let upper95 = Number.NEGATIVE_INFINITY;
    for (const w of args.weighted) {
      pSum += w.weight * w.result.point[s]!;
      const b80 = w.result.intervals_80[s]!;
      const b95 = w.result.intervals_95[s]!;
      if (b80.lower < lower80) lower80 = b80.lower;
      if (b80.upper > upper80) upper80 = b80.upper;
      if (b95.lower < lower95) lower95 = b95.lower;
      if (b95.upper > upper95) upper95 = b95.upper;
    }
    point[s] = pSum;
    i80.push({ step: s + 1, lower: lower80, upper: upper80 });
    i95.push({ step: s + 1, lower: lower95, upper: upper95 });
  }
  return {
    seriesId: args.seriesId,
    model: 'ensemble',
    modelVersion: args.versionLabel ?? 'ensemble',
    horizon: args.horizon,
    point,
    intervals_80: i80,
    intervals_95: i95,
    generatedAtISO: new Date().toISOString(),
  };
}

/**
 * Create an ensemble that itself implements `SotaForecastingPort`.
 * On predict(), it fans out to every member in parallel and combines.
 */
export function createEnsembleForecaster(
  options: EnsembleOptions,
): SotaForecastingPort {
  assertNormalizedWeights(options.members);
  const versionLabel =
    options.versionLabel ??
    `ensemble:${options.members
      .map((m) => m.forecaster.model)
      .sort((a, b) => a.localeCompare(b))
      .join(',')}`;
  return {
    model: 'ensemble',
    modelVersion: versionLabel,
    async predict(args) {
      const series: TimeSeries = args.series;
      const horizon: ForecastHorizon = args.horizon;
      const results = await Promise.all(
        options.members.map(async (m) => {
          const r = await m.forecaster.predict({
            series,
            horizon,
            ...(args.opts !== undefined ? { opts: args.opts } : {}),
          });
          return { result: r, weight: m.weight };
        }),
      );
      return combineForecasts({
        seriesId: series.id,
        horizon,
        weighted: results,
        versionLabel,
      });
    },
  };
}
