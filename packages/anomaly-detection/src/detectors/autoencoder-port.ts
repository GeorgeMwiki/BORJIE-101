/**
 * Autoencoder anomaly detector — port (typed boundary).
 *
 * Architecture: Hinton, G. E. & Salakhutdinov, R. R. (2006).
 * *Reducing the dimensionality of data with neural networks.*
 * Science 313(5786):504-507. Extended in 2024 by TimesNet
 * (Wu et al. 2023, ICLR) and TimesURL (Liu et al. 2024, AAAI) for
 * temporal series. The actual model is trained off-platform (PyTorch),
 * exported to ONNX, and served via ONNX-runtime in
 * `apps/anomaly-sidecar` (out of scope here).
 *
 * This package owns:
 *   - the port interface every adapter implements;
 *   - the `AnomalyScore`-shaping wrapper that turns a reconstruction
 *     error into a verdict against a configurable quantile threshold;
 *   - a deterministic stub used in tests.
 *
 * Scoring convention: higher reconstruction error = more anomalous.
 * The threshold is set as a high quantile (default 0.99) of a
 * reference reconstruction-error vector — anything above that quantile
 * is flagged.
 *
 * @module @borjie/anomaly-detection/detectors/autoencoder-port
 */

import type { AnomalyScore, AutoencoderPortConfig } from '../types.js';

const DEFAULT_QUANTILE = 0.99;

/**
 * The port — host wires a sidecar adapter that returns the
 * reconstruction error for a feature vector (typically the MSE
 * between input and decoder output).
 */
export interface AutoencoderPort {
  reconstructionError(point: ReadonlyArray<number>): Promise<number>;
}

/**
 * Deterministic stub for tests and edge agents.
 */
export function createAutoencoderStub(
  reconstructionFn: (point: ReadonlyArray<number>) => number,
): AutoencoderPort {
  return {
    reconstructionError: async (point) => reconstructionFn(point),
  };
}

/**
 * Compute the quantile threshold on a reference vector.
 *
 * Pure, non-mutating: copies before sorting.
 */
export function quantileThreshold(
  referenceErrors: ReadonlyArray<number>,
  q: number,
): number {
  if (referenceErrors.length === 0) {
    throw new Error('quantileThreshold: empty reference error vector');
  }
  if (q < 0 || q > 1) {
    throw new Error('quantileThreshold: q must be in [0, 1]');
  }
  const sorted = [...referenceErrors].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  );
  return sorted[idx]!;
}

export async function scoreAutoencoder(
  port: AutoencoderPort,
  point: ReadonlyArray<number>,
  threshold: number,
  config: AutoencoderPortConfig = {},
): Promise<AnomalyScore> {
  // `quantile` is captured at threshold-build time, but we keep the
  // config plumbed so future quantile-recalibration loops can pass
  // through this scoring path.
  const _q = config.quantile ?? DEFAULT_QUANTILE;
  void _q;
  const error = await port.reconstructionError(point);
  return Object.freeze({
    value: point[0]!,
    score: error,
    scoreKind: 'autoencoder' as const,
    threshold,
    anomalous: error >= threshold,
  });
}
