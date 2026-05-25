/**
 * Forecasting metrics — pure, immutable, no I/O.
 *
 * Implements the standard scoring rules used by the M-series competitions
 * and modern probabilistic-forecasting literature:
 *
 *   - MAE   — Mean Absolute Error
 *   - RMSE  — Root Mean Squared Error
 *   - MAPE  — Mean Absolute Percentage Error (asymmetric, unbounded)
 *   - sMAPE — symmetric MAPE, bounded 0..200 percent
 *   - MASE  — Mean Absolute Scaled Error (scale-free, M4-recommended)
 *   - CRPS  — Continuous Ranked Probability Score (probabilistic)
 *   - intervalCoverage — empirical hit rate of a prediction interval
 *
 * Reference: Hyndman & Koehler (2006), "Another look at measures of
 * forecast accuracy", IJF 22(4); Gneiting & Raftery (2007), "Strictly
 * proper scoring rules", JASA 102.
 *
 * All functions throw on bad shape and return NaN-free numbers (well-
 * defined edge cases described inline).
 */

export interface PointForecastSeries {
  readonly actuals: ReadonlyArray<number>;
  readonly predictions: ReadonlyArray<number>;
}

export interface ProbabilisticForecastSeries {
  readonly actuals: ReadonlyArray<number>;
  /** Per-step ensemble or quantile samples. samples[t] = array of draws. */
  readonly samples: ReadonlyArray<ReadonlyArray<number>>;
}

export interface IntervalForecastSeries {
  readonly actuals: ReadonlyArray<number>;
  readonly lowers: ReadonlyArray<number>;
  readonly uppers: ReadonlyArray<number>;
}

// ───────────────────────────────────────────────────────────────────────
// Internal helpers (no export — keep the public surface narrow).
// ───────────────────────────────────────────────────────────────────────

function assertSameLength(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>, label: string): void {
  if (a.length !== b.length) {
    throw new Error(`metrics: ${label} length mismatch (${a.length} vs ${b.length})`);
  }
  if (a.length === 0) {
    throw new Error(`metrics: ${label} cannot be empty`);
  }
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) {
    throw new Error('metrics: mean of empty array');
  }
  let sum = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum / xs.length;
}

// ───────────────────────────────────────────────────────────────────────
// Point-forecast scoring rules.
// ───────────────────────────────────────────────────────────────────────

export function mae(series: PointForecastSeries): number {
  assertSameLength(series.actuals, series.predictions, 'mae');
  let acc = 0;
  for (let i = 0; i < series.actuals.length; i += 1) {
    acc += Math.abs((series.actuals[i] ?? 0) - (series.predictions[i] ?? 0));
  }
  return acc / series.actuals.length;
}

export function rmse(series: PointForecastSeries): number {
  assertSameLength(series.actuals, series.predictions, 'rmse');
  let acc = 0;
  for (let i = 0; i < series.actuals.length; i += 1) {
    const e = (series.actuals[i] ?? 0) - (series.predictions[i] ?? 0);
    acc += e * e;
  }
  return Math.sqrt(acc / series.actuals.length);
}

/**
 * Mean Absolute Percentage Error.
 *
 * Returns percentage (0..∞). Skips steps where the actual is zero — those
 * are undefined under the classical definition; the returned mean is over
 * the kept steps. If every actual is zero, returns 0 (no information).
 */
export function mape(series: PointForecastSeries): number {
  assertSameLength(series.actuals, series.predictions, 'mape');
  let acc = 0;
  let kept = 0;
  for (let i = 0; i < series.actuals.length; i += 1) {
    const a = series.actuals[i] ?? 0;
    if (a === 0) {
      continue;
    }
    acc += Math.abs((a - (series.predictions[i] ?? 0)) / a);
    kept += 1;
  }
  if (kept === 0) {
    return 0;
  }
  return (acc / kept) * 100;
}

/**
 * symmetric MAPE — bounded in [0, 200] regardless of sign or zero.
 *
 * Uses the Hyndman 2006 form:  200 * |F - A| / (|A| + |F|).
 * The denominator is zero only when both actual and forecast are zero;
 * those steps contribute zero (perfect forecast on a zero series).
 */
export function smape(series: PointForecastSeries): number {
  assertSameLength(series.actuals, series.predictions, 'smape');
  let acc = 0;
  for (let i = 0; i < series.actuals.length; i += 1) {
    const a = series.actuals[i] ?? 0;
    const f = series.predictions[i] ?? 0;
    const denom = Math.abs(a) + Math.abs(f);
    if (denom === 0) {
      continue;
    }
    acc += (200 * Math.abs(a - f)) / denom;
  }
  return acc / series.actuals.length;
}

export interface MaseInput {
  readonly actuals: ReadonlyArray<number>;
  readonly predictions: ReadonlyArray<number>;
  /** In-sample training history used for the naive scaling denominator. */
  readonly trainHistory: ReadonlyArray<number>;
  /** Seasonal period m. m=1 for non-seasonal (naive); m=7 for daily-weekly, etc. */
  readonly seasonality: number;
}

/**
 * Mean Absolute Scaled Error — Hyndman 2006.
 *
 *   MASE = mean_t |F_t - A_t| / scale
 *   scale = mean over training history of |y_i - y_{i-m}|
 *
 * The seasonal naive in-sample MAE is the denominator. Scale-free, so
 * comparable across series of any magnitude. MASE < 1 means we beat a
 * seasonal-naive model on the training horizon; MASE = 0 is perfect.
 *
 * Edge cases:
 *   - If trainHistory has fewer than (m + 1) points, throws.
 *   - If the seasonal-naive denominator is zero (constant history), the
 *     metric is undefined; we return 0 if predictions also perfectly match
 *     actuals, otherwise Infinity (signalling "naive cannot be beaten").
 */
export function mase(input: MaseInput): number {
  const { actuals, predictions, trainHistory, seasonality } = input;
  assertSameLength(actuals, predictions, 'mase');
  if (!Number.isInteger(seasonality) || seasonality < 1) {
    throw new Error(`metrics: mase seasonality must be a positive integer, got ${seasonality}`);
  }
  if (trainHistory.length <= seasonality) {
    throw new Error(`metrics: mase trainHistory length ${trainHistory.length} must exceed seasonality ${seasonality}`);
  }
  let scaleAcc = 0;
  for (let i = seasonality; i < trainHistory.length; i += 1) {
    scaleAcc += Math.abs((trainHistory[i] ?? 0) - (trainHistory[i - seasonality] ?? 0));
  }
  const scaleDenom = trainHistory.length - seasonality;
  const scale = scaleAcc / scaleDenom;
  const errorMae = mae({ actuals, predictions });
  if (scale === 0) {
    return errorMae === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return errorMae / scale;
}

// ───────────────────────────────────────────────────────────────────────
// Probabilistic scoring — CRPS via sample-based estimator.
// ───────────────────────────────────────────────────────────────────────

/**
 * CRPS for one observation against an empirical sample distribution.
 *
 * Uses the well-known equivalent form:
 *   CRPS(F, y) = E|X - y| - (1/2) * E|X - X'|
 * where X, X' are i.i.d. draws from F. For n samples the unbiased
 * estimator is:
 *   E|X - y|   ≈ (1/n)   * Σ_i |x_i - y|
 *   E|X - X'|  ≈ (1/n^2) * Σ_{i,j} |x_i - x_j|
 *
 * Lower is better; CRPS reduces to MAE for deterministic forecasts
 * (single-sample distributions), so the metric is unit-consistent with
 * the point metrics above.
 */
export function crpsSingle(samples: ReadonlyArray<number>, observed: number): number {
  if (samples.length === 0) {
    throw new Error('metrics: crps samples cannot be empty');
  }
  let absErr = 0;
  for (const x of samples) {
    absErr += Math.abs(x - observed);
  }
  absErr /= samples.length;

  // O(n log n) computation of E|X - X'| via sorting:
  //   Σ_{i<j} (x_(j) - x_(i)) = Σ_i (2*i - n + 1) * x_(i)
  // dividing by n^2 (not n*(n-1)) keeps it consistent with the biased
  // estimator standardly used in scoringRules R and properscoring py.
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  let weighted = 0;
  for (let i = 0; i < n; i += 1) {
    weighted += (2 * i - n + 1) * (sorted[i] ?? 0);
  }
  const pairwise = weighted / (n * n);
  return absErr - pairwise;
}

/** Mean CRPS across all forecast steps. */
export function crps(series: ProbabilisticForecastSeries): number {
  if (series.actuals.length !== series.samples.length) {
    throw new Error(`metrics: crps length mismatch (${series.actuals.length} vs ${series.samples.length})`);
  }
  if (series.actuals.length === 0) {
    throw new Error('metrics: crps cannot be empty');
  }
  const perStep: Array<number> = [];
  for (let t = 0; t < series.actuals.length; t += 1) {
    const draws = series.samples[t];
    const y = series.actuals[t];
    if (!draws || y === undefined) {
      throw new Error(`metrics: crps missing data at step ${t}`);
    }
    perStep.push(crpsSingle(draws, y));
  }
  return mean(perStep);
}

// ───────────────────────────────────────────────────────────────────────
// Interval coverage — empirical hit rate of a (lower, upper) band.
// ───────────────────────────────────────────────────────────────────────

export interface CoverageResult {
  /** Empirical hit rate, [0,1]. */
  readonly rate: number;
  /** Number of actuals inside the band. */
  readonly hits: number;
  /** Total observations. */
  readonly total: number;
  /** Mean width of the band (in actual units). */
  readonly meanWidth: number;
}

/**
 * Empirical coverage rate of a prediction interval.
 *
 * For a target 90 percent interval we expect rate ≈ 0.9; over- or under-
 * coverage flags miscalibration of the underlying conformal procedure.
 */
export function intervalCoverage(series: IntervalForecastSeries): CoverageResult {
  assertSameLength(series.actuals, series.lowers, 'intervalCoverage.lowers');
  assertSameLength(series.actuals, series.uppers, 'intervalCoverage.uppers');
  let hits = 0;
  let widthAcc = 0;
  for (let i = 0; i < series.actuals.length; i += 1) {
    const a = series.actuals[i] ?? 0;
    const lo = series.lowers[i] ?? 0;
    const hi = series.uppers[i] ?? 0;
    if (a >= lo && a <= hi) {
      hits += 1;
    }
    widthAcc += hi - lo;
  }
  return {
    rate: hits / series.actuals.length,
    hits,
    total: series.actuals.length,
    meanWidth: widthAcc / series.actuals.length,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Aggregate report — every metric in one shot.
// ───────────────────────────────────────────────────────────────────────

export interface MetricReport {
  readonly mae: number;
  readonly rmse: number;
  readonly mape: number;
  readonly smape: number;
  readonly mase: number;
  readonly crps: number | null;
  readonly coverage80: CoverageResult | null;
  readonly coverage95: CoverageResult | null;
}

export interface ReportInput {
  readonly actuals: ReadonlyArray<number>;
  readonly predictions: ReadonlyArray<number>;
  readonly trainHistory: ReadonlyArray<number>;
  readonly seasonality: number;
  readonly samples?: ReadonlyArray<ReadonlyArray<number>>;
  readonly intervals80?: { readonly lowers: ReadonlyArray<number>; readonly uppers: ReadonlyArray<number> };
  readonly intervals95?: { readonly lowers: ReadonlyArray<number>; readonly uppers: ReadonlyArray<number> };
}

export function metricReport(input: ReportInput): MetricReport {
  const point: PointForecastSeries = { actuals: input.actuals, predictions: input.predictions };
  return {
    mae: mae(point),
    rmse: rmse(point),
    mape: mape(point),
    smape: smape(point),
    mase: mase({
      actuals: input.actuals,
      predictions: input.predictions,
      trainHistory: input.trainHistory,
      seasonality: input.seasonality,
    }),
    crps: input.samples
      ? crps({ actuals: input.actuals, samples: input.samples })
      : null,
    coverage80: input.intervals80
      ? intervalCoverage({
          actuals: input.actuals,
          lowers: input.intervals80.lowers,
          uppers: input.intervals80.uppers,
        })
      : null,
    coverage95: input.intervals95
      ? intervalCoverage({
          actuals: input.actuals,
          lowers: input.intervals95.lowers,
          uppers: input.intervals95.uppers,
        })
      : null,
  };
}
