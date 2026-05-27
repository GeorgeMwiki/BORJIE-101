/**
 * Forecast accuracy metrics — pure functions.
 *
 * Formulas follow Hyndman & Athanasopoulos, Forecasting: Principles
 * and Practice (3rd ed., 2021), sections 5.8 and 11.6, and the M4
 * competition error-formula appendix.
 *
 *  - MAE   = mean(|y - ŷ|)
 *  - RMSE  = sqrt(mean((y - ŷ)²))
 *  - MAPE  = mean(|y - ŷ| / |y|) × 100   (NaN when any y_t = 0)
 *  - sMAPE = mean(2 · |y - ŷ| / (|y| + |ŷ|)) × 100
 *  - MASE  = mean(|y - ŷ|) / mean(|y_t - y_{t-m}|)   (m = seasonal period)
 *  - OWA   = (sMAPE/sMAPE_naive + MASE/MASE_naive) / 2
 *  - WQL   = Σ_{q ∈ {.1,.5,.9}} w_q · QL_q(y, ŷ_q)
 *
 * Reference test values come from Hyndman & Athanasopoulos chapter
 * 5 worked examples and the M4 competition GitHub repository.
 *
 * @module @borjie/forecasting/sota/backtest/metrics
 */

export interface MetricInputs {
  readonly y: ReadonlyArray<number>;
  readonly yhat: ReadonlyArray<number>;
}

function assertSameLength(args: MetricInputs, fn: string): void {
  if (args.y.length !== args.yhat.length) {
    throw new RangeError(
      `${fn}: length mismatch y=${args.y.length} yhat=${args.yhat.length}`,
    );
  }
  if (args.y.length === 0) {
    throw new RangeError(`${fn}: empty inputs`);
  }
}

/** Mean Absolute Error. */
export function mae(args: MetricInputs): number {
  assertSameLength(args, 'mae');
  let sum = 0;
  for (let i = 0; i < args.y.length; i += 1) {
    sum += Math.abs(args.y[i]! - args.yhat[i]!);
  }
  return sum / args.y.length;
}

/** Root Mean Square Error. */
export function rmse(args: MetricInputs): number {
  assertSameLength(args, 'rmse');
  let sum = 0;
  for (let i = 0; i < args.y.length; i += 1) {
    const e = args.y[i]! - args.yhat[i]!;
    sum += e * e;
  }
  return Math.sqrt(sum / args.y.length);
}

/** Mean Absolute Percentage Error (returned as %). NaN propagates when y_t = 0. */
export function mape(args: MetricInputs): number {
  assertSameLength(args, 'mape');
  let sum = 0;
  for (let i = 0; i < args.y.length; i += 1) {
    const yi = args.y[i]!;
    if (yi === 0) return Number.NaN;
    sum += Math.abs((yi - args.yhat[i]!) / yi);
  }
  return (sum / args.y.length) * 100;
}

/** Symmetric MAPE (returned as %). Bounded in [0, 200]. */
export function smape(args: MetricInputs): number {
  assertSameLength(args, 'smape');
  let sum = 0;
  for (let i = 0; i < args.y.length; i += 1) {
    const denom = Math.abs(args.y[i]!) + Math.abs(args.yhat[i]!);
    if (denom === 0) continue;
    sum += (2 * Math.abs(args.y[i]! - args.yhat[i]!)) / denom;
  }
  return (sum / args.y.length) * 100;
}

export interface MaseInputs extends MetricInputs {
  /** Full training series used to scale via seasonal-naive error. */
  readonly trainY: ReadonlyArray<number>;
  /** Seasonal period m (1 = non-seasonal naive). */
  readonly seasonalPeriod: number;
}

/**
 * Mean Absolute Scaled Error.
 *
 * scale = mean(|y_t - y_{t-m}|) over the training set.
 * MASE  = mean(|y - ŷ|) / scale
 */
export function mase(args: MaseInputs): number {
  assertSameLength(args, 'mase');
  const m = args.seasonalPeriod;
  if (m < 1) throw new RangeError(`mase: seasonalPeriod must be >= 1`);
  if (args.trainY.length <= m) {
    throw new RangeError(
      `mase: trainY length ${args.trainY.length} <= seasonalPeriod ${m}`,
    );
  }
  let scaleSum = 0;
  for (let i = m; i < args.trainY.length; i += 1) {
    scaleSum += Math.abs(args.trainY[i]! - args.trainY[i - m]!);
  }
  const scale = scaleSum / (args.trainY.length - m);
  if (scale === 0) return Number.NaN;
  return mae(args) / scale;
}

export interface OwaInputs {
  readonly y: ReadonlyArray<number>;
  readonly yhat: ReadonlyArray<number>;
  readonly trainY: ReadonlyArray<number>;
  readonly seasonalPeriod: number;
  /** sMAPE of the seasonal-naive benchmark. */
  readonly smapeNaive: number;
  /** MASE of the seasonal-naive benchmark (≈ 1 by definition). */
  readonly maseNaive: number;
}

/** Overall Weighted Average — M4 competition. */
export function owa(args: OwaInputs): number {
  if (args.smapeNaive === 0 || args.maseNaive === 0) {
    return Number.NaN;
  }
  const sm = smape({ y: args.y, yhat: args.yhat });
  const ms = mase({
    y: args.y,
    yhat: args.yhat,
    trainY: args.trainY,
    seasonalPeriod: args.seasonalPeriod,
  });
  return (sm / args.smapeNaive + ms / args.maseNaive) / 2;
}

export interface QuantileInputs {
  readonly y: ReadonlyArray<number>;
  /** Forecast quantile (e.g. predicted 0.9-quantile). */
  readonly yhatQuantile: ReadonlyArray<number>;
  readonly q: number;
}

/** Pinball / quantile loss at level q. */
export function quantileLoss(args: QuantileInputs): number {
  if (args.q <= 0 || args.q >= 1) {
    throw new RangeError(`quantileLoss: q must be in (0,1), got ${args.q}`);
  }
  if (args.y.length !== args.yhatQuantile.length) {
    throw new RangeError(
      `quantileLoss: length mismatch y=${args.y.length} yhat=${args.yhatQuantile.length}`,
    );
  }
  let sum = 0;
  for (let i = 0; i < args.y.length; i += 1) {
    const e = args.y[i]! - args.yhatQuantile[i]!;
    sum += e >= 0 ? args.q * e : (args.q - 1) * e;
  }
  return sum / args.y.length;
}

/**
 * Weighted Quantile Loss across the standard three quantiles
 * {0.1, 0.5, 0.9} with equal weights. The DeepAR / GluonTS metric.
 */
export function weightedQuantileLoss(args: {
  readonly y: ReadonlyArray<number>;
  readonly q10: ReadonlyArray<number>;
  readonly q50: ReadonlyArray<number>;
  readonly q90: ReadonlyArray<number>;
}): number {
  return (
    (quantileLoss({ y: args.y, yhatQuantile: args.q10, q: 0.1 }) +
      quantileLoss({ y: args.y, yhatQuantile: args.q50, q: 0.5 }) +
      quantileLoss({ y: args.y, yhatQuantile: args.q90, q: 0.9 })) /
    3
  );
}
