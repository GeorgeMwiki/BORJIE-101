/**
 * Shared helpers used by every group fairness metric. Mostly group-by
 * counters that compute (TP, FP, TN, FN) per protected-attribute value.
 */

import type { FairnessRow } from '../types.js';

export interface GroupCounts {
  /** Total rows in this group. */
  readonly n: number;
  /** Predicted positives. */
  readonly predPos: number;
  /** Predicted negatives. */
  readonly predNeg: number;
  /** True positives (pred=1, label=1). */
  readonly tp: number;
  /** False positives (pred=1, label=0). */
  readonly fp: number;
  /** True negatives (pred=0, label=0). */
  readonly tn: number;
  /** False negatives (pred=0, label=1). */
  readonly fn: number;
  /** Actual positives (label=1). */
  readonly actualPos: number;
  /** Actual negatives (label=0). */
  readonly actualNeg: number;
  /** Whether labels were supplied for every row. */
  readonly hasLabels: boolean;
}

/** Group rows by `row.group` and produce confusion counts. */
export function countByGroup(
  rows: ReadonlyArray<FairnessRow>,
): Readonly<Record<string, GroupCounts>> {
  const out: Record<
    string,
    {
      n: number;
      predPos: number;
      predNeg: number;
      tp: number;
      fp: number;
      tn: number;
      fn: number;
      actualPos: number;
      actualNeg: number;
      labelMissing: number;
    }
  > = {};
  for (const r of rows) {
    const g = r.group;
    const slot = out[g] ?? {
      n: 0,
      predPos: 0,
      predNeg: 0,
      tp: 0,
      fp: 0,
      tn: 0,
      fn: 0,
      actualPos: 0,
      actualNeg: 0,
      labelMissing: 0,
    };
    slot.n += 1;
    if (r.prediction === 1) slot.predPos += 1;
    else slot.predNeg += 1;
    if (r.label === undefined) {
      slot.labelMissing += 1;
    } else if (r.label === 1) {
      slot.actualPos += 1;
      if (r.prediction === 1) slot.tp += 1;
      else slot.fn += 1;
    } else {
      slot.actualNeg += 1;
      if (r.prediction === 1) slot.fp += 1;
      else slot.tn += 1;
    }
    out[g] = slot;
  }
  const final: Record<string, GroupCounts> = {};
  for (const [g, s] of Object.entries(out)) {
    final[g] = {
      n: s.n,
      predPos: s.predPos,
      predNeg: s.predNeg,
      tp: s.tp,
      fp: s.fp,
      tn: s.tn,
      fn: s.fn,
      actualPos: s.actualPos,
      actualNeg: s.actualNeg,
      hasLabels: s.labelMissing === 0,
    };
  }
  return final;
}

/** Selection rate P(Y_hat=1 | A=g). 0 if group is empty. */
export function selectionRate(c: GroupCounts): number {
  return c.n === 0 ? 0 : c.predPos / c.n;
}

/** True positive rate P(Y_hat=1 | Y=1, A=g). 0 if no actual positives. */
export function truePositiveRate(c: GroupCounts): number {
  return c.actualPos === 0 ? 0 : c.tp / c.actualPos;
}

/** False positive rate P(Y_hat=1 | Y=0, A=g). 0 if no actual negatives. */
export function falsePositiveRate(c: GroupCounts): number {
  return c.actualNeg === 0 ? 0 : c.fp / c.actualNeg;
}

/** Positive predictive value (precision). 0 if no predicted positives. */
export function positivePredictiveValue(c: GroupCounts): number {
  return c.predPos === 0 ? 0 : c.tp / c.predPos;
}

/** False discovery rate FP / (FP + TP). */
export function falseDiscoveryRate(c: GroupCounts): number {
  const denom = c.fp + c.tp;
  return denom === 0 ? 0 : c.fp / denom;
}

/** False omission rate FN / (FN + TN). */
export function falseOmissionRate(c: GroupCounts): number {
  const denom = c.fn + c.tn;
  return denom === 0 ? 0 : c.fn / denom;
}

/** Sorted list of group keys for stable iteration. */
export function groupKeys(
  counts: Readonly<Record<string, GroupCounts>>,
): ReadonlyArray<string> {
  return Object.keys(counts).sort();
}

/** Min + max of an iterable; returns [min, max]. */
export function minMax(values: ReadonlyArray<number>): readonly [number, number] {
  if (values.length === 0) return [0, 0];
  let lo = values[0]!;
  let hi = values[0]!;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}
