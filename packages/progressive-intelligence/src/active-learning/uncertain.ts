/**
 * Uncertain-case detection — flag predictions for human or LLM-jury
 * review. Two strategies:
 *
 *   - `low_confidence`: prediction confidence is below the threshold
 *   - `outlier`: prediction confidence is much further below the
 *     threshold than the population's mean gap (z-score > 1.5)
 *
 * Both flagging modes are deterministic — same predictions + same
 * threshold → same uncertain set.
 */
import type { Prediction, UncertainCase } from '../types.js';

export interface FlagUncertainCasesArgs<T = unknown> {
  readonly predictions: ReadonlyArray<Prediction<T>>;
  /**
   * Threshold below which a prediction is uncertain. Default 0.7 —
   * matches Cleanlab's "label issues" sweet-spot for binary classifiers.
   */
  readonly threshold?: number;
  /** If true (default) also flag z-score outliers below the mean. */
  readonly includeOutliers?: boolean;
}

const DEFAULT_THRESHOLD = 0.7;

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdev(xs: ReadonlyArray<number>, mu: number): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += (x - mu) ** 2;
  return Math.sqrt(s / xs.length);
}

export function flagUncertainCases<T = unknown>(
  args: FlagUncertainCasesArgs<T>,
): ReadonlyArray<UncertainCase<T>> {
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;
  const includeOutliers = args.includeOutliers ?? true;

  const confidences = args.predictions.map((p) => p.confidence);
  const mu = mean(confidences);
  const sigma = stdev(confidences, mu);

  const out: UncertainCase<T>[] = [];
  for (const p of args.predictions) {
    if (p.confidence < threshold) {
      out.push({
        id: p.id,
        prediction: p,
        gap: Math.max(0, threshold - p.confidence),
        reason: 'low_confidence',
      });
      continue;
    }
    if (includeOutliers && sigma > 0) {
      const z = (mu - p.confidence) / sigma;
      if (z > 1.5) {
        out.push({
          id: p.id,
          prediction: p,
          gap: Math.max(0, mu - p.confidence),
          reason: 'outlier',
        });
      }
    }
  }
  // Sort by largest gap first — caller probably wants to review the
  // most problematic predictions first.
  return out.sort((a, b) => b.gap - a.gap);
}
