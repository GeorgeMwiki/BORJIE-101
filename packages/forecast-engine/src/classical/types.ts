/**
 * Classical-floor model contract.
 *
 * Each classical model is a pure deterministic point forecaster: given
 * a numeric history and a horizon it returns one point per step. The
 * router wraps it in `classical-provider.ts` to add quantiles via
 * conformalised residuals, so the classical model itself stays a tiny,
 * testable, dependency-free numeric function.
 */

export interface ClassicalForecaster {
  /** Stable model name, e.g. 'seasonal_naive'. */
  readonly name: string;
  /** Model version (bump when numerics change). */
  readonly version: string;
  /**
   * Produce `horizon` point forecasts from `history`.
   * Pure: never mutates `history`. Always returns exactly `horizon`
   * finite numbers (degenerate inputs fall back to the last/mean value).
   */
  forecast(history: ReadonlyArray<number>, horizon: number): number[];
}
