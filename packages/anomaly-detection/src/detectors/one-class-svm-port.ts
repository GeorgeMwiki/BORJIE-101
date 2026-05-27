/**
 * One-Class SVM — port (typed boundary).
 *
 * The Schölkopf, B., Williamson, R. C., Smola, A. J., Shawe-Taylor, J.
 * & Platt, J. (2001) ν-SVM is a constrained quadratic-program that we
 * deliberately do NOT solve in TypeScript — the solver weight is
 * inappropriate for our edge-agent footprint, and the high-quality
 * implementation already exists in scikit-learn / libsvm.
 *
 * Instead this module defines the **port** the host service plugs a
 * sidecar adapter into. The host owns the actual solver; this package
 * owns the contract.
 *
 * In tests we use the in-process **deterministic stub** — it accepts a
 * caller-supplied decision-function value (typically: the score the
 * sidecar would have returned) and applies the package's standard
 * `AnomalyScore` shaping on top. This means a host can:
 *
 *   1. Capture historic decision-function values from sklearn.
 *   2. Pipe them through the stub.
 *   3. Get back `AnomalyScore` objects that compose with the rest of
 *      `@borjie/anomaly-detection` (ensembles, repositories, etc.).
 *
 * Sklearn convention: a NEGATIVE decision-function value is an
 * outlier. We honour that: `anomalous = decisionValue < threshold`
 * with `threshold = 0` by default.
 *
 * @module @borjie/anomaly-detection/detectors/one-class-svm-port
 */

import type { AnomalyScore, OneClassSvmPortConfig } from '../types.js';

const DEFAULT_THRESHOLD = 0;

/**
 * The port interface — the host service implements this with a real
 * sidecar adapter (HTTP / gRPC / in-process Python).
 */
export interface OneClassSvmPort {
  /**
   * Score a feature vector. The implementation returns the SVM
   * decision function value `f(x) = sign(w·φ(x) + ρ)` where negative
   * is outlier.
   */
  decisionFunction(point: ReadonlyArray<number>): Promise<number>;
}

/**
 * Deterministic in-process stub used by tests, edge-agent fallback,
 * and the host's composition root when no sidecar is wired.
 */
export function createOneClassSvmStub(
  decisionFn: (point: ReadonlyArray<number>) => number,
): OneClassSvmPort {
  return {
    decisionFunction: async (point) => decisionFn(point),
  };
}

export async function scoreOneClassSvm(
  port: OneClassSvmPort,
  point: ReadonlyArray<number>,
  config: OneClassSvmPortConfig = {},
): Promise<AnomalyScore> {
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const decision = await port.decisionFunction(point);
  return Object.freeze({
    value: point[0]!,
    score: decision,
    scoreKind: 'one-class-svm' as const,
    threshold,
    anomalous: decision < threshold,
  });
}
