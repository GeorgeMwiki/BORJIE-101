/**
 * Outlier detection + clipping.
 *
 * Two policies:
 *  - Hampel filter — median + MAD. The default. Robust to up to
 *    50 % contamination.
 *  - IQR clip       — Tukey fences at Q1 - k·IQR / Q3 + k·IQR.
 *
 * Returns the clipped values alongside a boolean mask flagging every
 * point that was modified, so the audit trail can record the change.
 *
 * @module @borjie/forecasting/sota/preprocess/outlier
 */

import type { TimeSeries } from '../types.js';

export interface OutlierClipResult {
  readonly clipped: ReadonlyArray<number>;
  readonly mask: ReadonlyArray<boolean>;
}

export type OutlierMethod = 'hampel' | 'iqr';

function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function quantileSorted(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function clipOutliers(
  series: TimeSeries,
  method: OutlierMethod = 'hampel',
  k = 3,
): OutlierClipResult {
  const y = series.points.map((p) => p.y);
  if (y.length === 0) {
    return { clipped: [], mask: [] };
  }
  if (method === 'hampel') {
    const med = median(y);
    const absDev = y.map((v) => Math.abs(v - med));
    const mad = median(absDev);
    if (mad === 0) {
      return { clipped: y, mask: y.map(() => false) };
    }
    const threshold = k * 1.4826 * mad; // 1.4826 = sigma scale
    const clipped: number[] = [];
    const mask: boolean[] = [];
    for (const v of y) {
      const dev = Math.abs(v - med);
      if (dev > threshold) {
        const bound = v > med ? med + threshold : med - threshold;
        clipped.push(bound);
        mask.push(true);
      } else {
        clipped.push(v);
        mask.push(false);
      }
    }
    return { clipped, mask };
  }
  // IQR method.
  const sorted = [...y].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  const clipped: number[] = [];
  const mask: boolean[] = [];
  for (const v of y) {
    if (v < lo) {
      clipped.push(lo);
      mask.push(true);
    } else if (v > hi) {
      clipped.push(hi);
      mask.push(true);
    } else {
      clipped.push(v);
      mask.push(false);
    }
  }
  return { clipped, mask };
}
