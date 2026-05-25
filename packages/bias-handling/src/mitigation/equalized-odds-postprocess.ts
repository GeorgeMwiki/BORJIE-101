/**
 * Post-processing mitigation: **Equalized-odds post-processing**
 * (Hardt, Price, Srebro NeurIPS 2016).
 *
 * Given a trained scorer that emits a score in [0,1] and a
 * calibration set with labels and group memberships, derives
 * per-group thresholds that achieve approximate equalized odds.
 *
 * We use a simplified scheme: for each group, find the threshold
 * t_g that maximises accuracy subject to |TPR_g − TPR_ref| < tol
 * and |FPR_g − FPR_ref| < tol where the reference group's
 * (TPR_ref, FPR_ref) is taken from its own optimum-accuracy
 * threshold. This is faster than the original LP formulation but
 * good enough for production use; for the full ROC-convex
 * formulation, swap the optimiser.
 *
 * Tradeoffs:
 *  - Per-group thresholds = different decision rule per protected
 *    class — can raise legal questions under "disparate treatment"
 *    doctrine in some jurisdictions.
 *  - Requires holdout calibration data.
 *  - Improves equalized odds, may hurt overall accuracy.
 */

export interface CalibrationRow {
  readonly group: string;
  readonly score: number;
  readonly label: 0 | 1;
}

export interface EqualizedOddsThresholds {
  readonly perGroupThreshold: Readonly<Record<string, number>>;
  /** TPR achieved per group. */
  readonly perGroupTPR: Readonly<Record<string, number>>;
  /** FPR achieved per group. */
  readonly perGroupFPR: Readonly<Record<string, number>>;
}

export interface EqualizedOddsPostprocessArgs {
  readonly calibrationSet: ReadonlyArray<CalibrationRow>;
  /** Candidate thresholds to evaluate per group. Default 0.05 step from 0 to 1. */
  readonly thresholdGrid?: ReadonlyArray<number>;
  /** Tolerance on group TPR / FPR gap. Default 0.05. */
  readonly tol?: number;
}

function tprFpr(
  rows: ReadonlyArray<CalibrationRow>,
  t: number,
): { tpr: number; fpr: number } {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  for (const r of rows) {
    const pred = r.score >= t ? 1 : 0;
    if (r.label === 1) {
      if (pred === 1) tp += 1;
      else fn += 1;
    } else {
      if (pred === 1) fp += 1;
      else tn += 1;
    }
  }
  return {
    tpr: tp + fn === 0 ? 0 : tp / (tp + fn),
    fpr: fp + tn === 0 ? 0 : fp / (fp + tn),
  };
}

export function equalizedOddsPostprocess(
  args: EqualizedOddsPostprocessArgs,
): EqualizedOddsThresholds {
  const grid =
    args.thresholdGrid ?? Array.from({ length: 21 }, (_, i) => i / 20);
  const tol = args.tol ?? 0.05;
  const groups = new Set<string>();
  for (const r of args.calibrationSet) groups.add(r.group);
  const byGroup = new Map<string, CalibrationRow[]>();
  for (const g of groups) byGroup.set(g, []);
  for (const r of args.calibrationSet) byGroup.get(r.group)!.push(r);

  // Pick the reference group: largest group.
  let refGroup = '';
  let refSize = -1;
  for (const [g, rows] of byGroup) {
    if (rows.length > refSize) {
      refSize = rows.length;
      refGroup = g;
    }
  }

  function pickBestForGroup(
    rows: ReadonlyArray<CalibrationRow>,
    targetTPR?: number,
    targetFPR?: number,
  ): { t: number; tpr: number; fpr: number } {
    let best = { t: 0.5, tpr: 0, fpr: 0, score: -Infinity };
    for (const t of grid) {
      const { tpr, fpr } = tprFpr(rows, t);
      let s = tpr - fpr; // maximise tpr-fpr (Youden's J)
      if (targetTPR !== undefined) {
        const tprGap = Math.abs(tpr - targetTPR);
        const fprGap = Math.abs(fpr - (targetFPR as number));
        if (tprGap > tol || fprGap > tol) s -= 1; // heavy penalty
      }
      if (s > best.score) best = { t, tpr, fpr, score: s };
    }
    return { t: best.t, tpr: best.tpr, fpr: best.fpr };
  }

  // First find ref group's optimum unconstrained.
  const refOpt = pickBestForGroup(byGroup.get(refGroup)!);
  const perGroupThreshold: Record<string, number> = {};
  const perGroupTPR: Record<string, number> = {};
  const perGroupFPR: Record<string, number> = {};
  perGroupThreshold[refGroup] = refOpt.t;
  perGroupTPR[refGroup] = refOpt.tpr;
  perGroupFPR[refGroup] = refOpt.fpr;
  for (const [g, rows] of byGroup) {
    if (g === refGroup) continue;
    const choice = pickBestForGroup(rows, refOpt.tpr, refOpt.fpr);
    perGroupThreshold[g] = choice.t;
    perGroupTPR[g] = choice.tpr;
    perGroupFPR[g] = choice.fpr;
  }
  return { perGroupThreshold, perGroupTPR, perGroupFPR };
}
