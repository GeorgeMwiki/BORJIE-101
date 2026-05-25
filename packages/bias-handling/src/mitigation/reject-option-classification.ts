/**
 * Post-processing mitigation: **Reject Option Classification**
 * (Kamiran, Karim, Zhang ICDM 2012).
 *
 * In a confidence band around the decision boundary (typically
 * `|score - 0.5| < margin`), flip the prediction in favor of the
 * unprivileged group:
 *  - if subject is in unprivileged group: predict 1.
 *  - if subject is in privileged group: predict 0.
 *
 * Outside the band, leave the original prediction unchanged.
 * Deterministic alternative to randomised equalized-odds
 * post-processing.
 *
 * Tradeoffs:
 *  - Flipping based on group membership is per-group treatment —
 *    same disparate-treatment caveat as equalized-odds post-process.
 *  - Margin width is a tuning knob — too wide → high accuracy
 *    loss; too narrow → little fairness gain.
 *  - Only operates near the boundary; far-from-boundary bias
 *    needs additional treatment.
 */

export interface RejectOptionInput {
  readonly group: string;
  readonly score: number;
  readonly originalPrediction: 0 | 1;
}

export interface RejectOptionConfig {
  /** Set of group ids treated as unprivileged. */
  readonly unprivilegedGroups: ReadonlyArray<string>;
  /** Set of group ids treated as privileged. */
  readonly privilegedGroups: ReadonlyArray<string>;
  /** Half-width of the confidence band around 0.5. Default 0.1. */
  readonly margin?: number;
}

export function rejectOptionClassification(args: {
  predictions: ReadonlyArray<RejectOptionInput>;
  config: RejectOptionConfig;
}): ReadonlyArray<{ row: RejectOptionInput; finalPrediction: 0 | 1; flipped: boolean }> {
  const margin = args.config.margin ?? 0.1;
  const unpriv = new Set(args.config.unprivilegedGroups);
  const priv = new Set(args.config.privilegedGroups);
  return args.predictions.map((p) => {
    const inBand = Math.abs(p.score - 0.5) < margin;
    if (!inBand) {
      return { row: p, finalPrediction: p.originalPrediction, flipped: false };
    }
    if (unpriv.has(p.group)) {
      return {
        row: p,
        finalPrediction: 1 as const,
        flipped: p.originalPrediction !== 1,
      };
    }
    if (priv.has(p.group)) {
      return {
        row: p,
        finalPrediction: 0 as const,
        flipped: p.originalPrediction !== 0,
      };
    }
    return { row: p, finalPrediction: p.originalPrediction, flipped: false };
  });
}
