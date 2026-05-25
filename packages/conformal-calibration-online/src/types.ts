/**
 * Online conformal calibration — public types.
 *
 * State for the Gibbs & Candès 2021 Adaptive Conformal Inference
 * (ACI) variant. The state is immutable; every `updateConformal` call
 * returns a new state struct so callers can persist between
 * observations (typically once per officer feedback cycle).
 */

export interface CoverageObservation {
  /**
   * True if the actual value fell inside the predicted interval at
   * the time of the prediction.
   */
  readonly predictedCovered: boolean;
  /** ISO 8601 timestamp of the observation. */
  readonly observedAtIso: string;
}

export interface OnlineConformalConfig {
  /** Target coverage (1 - alpha). Default 0.9. */
  readonly targetCoverage?: number;
  /** Initial alpha. Default 0.1. */
  readonly initialAlpha?: number;
  /** Learning rate gamma. Smaller smooths slower. Default 0.05. */
  readonly learningRate?: number;
  /** Window size; older observations roll off. Default 200. */
  readonly windowSize?: number;
}

export interface OnlineConformalState {
  readonly targetCoverage: number;
  /** Current alpha (rejection rate). */
  readonly alpha: number;
  readonly learningRate: number;
  readonly windowSize: number;
  readonly recent: ReadonlyArray<CoverageObservation>;
}

export interface ConformalDiagnostic {
  readonly alpha: number;
  readonly targetCoverage: number;
  readonly observedCoverage: number;
  readonly windowFilled: number;
  readonly drifting: boolean;
}
