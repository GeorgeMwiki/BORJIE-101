/**
 * Anomaly detection for univariate time-series.
 *
 * Two methods, both pure-TS, no external deps:
 *
 *  1. Windowed z-score — for each point, compute the z-score against
 *     the rolling mean + std of the preceding `window` observations.
 *     Points with |z| ≥ `threshold` are flagged.
 *
 *  2. Change-point detection — a lightweight PELT-style sweep over
 *     candidate split points, picking those whose pre/post means
 *     differ by more than `threshold` standard deviations of the
 *     full series.
 *
 * Both methods are anytime O(n) (z-score) or O(n²) (change-point on
 * naive sweep). Series ≥ 5000 should prefer z-score; PELT is fine up
 * to a few thousand points.
 *
 * References: Killick et al. PELT (JASA 2012); Iglewicz & Hoaglin
 * "How to Detect and Handle Outliers" (ASQC 1993).
 */

import type { Anomaly, TimeSeries } from '../types.js';
import { assertValidSeries, mean, stdDev, values } from '../util/series.js';

export interface AnomalyDetectorOptions {
  /** Z-score threshold above which a point is flagged. Default 3. */
  readonly threshold?: number;
  /** Rolling window length for z-score. Default 14. */
  readonly window?: number;
  /** Detection methods to apply. Default ['zscore']. */
  readonly methods?: ReadonlyArray<'zscore' | 'change-point'>;
  /** Minimum gap between consecutive change-points. Default = window. */
  readonly minChangePointGap?: number;
}

/** Windowed z-score detector. Returns indices and scores of flagged
 *  points. Skips the first `window` observations (insufficient history). */
function detectZScore(
  series: TimeSeries,
  window: number,
  threshold: number,
): ReadonlyArray<Anomaly> {
  const ys = values(series);
  const out: Anomaly[] = [];
  if (ys.length <= window) return out;
  for (let i = window; i < ys.length; i += 1) {
    const ref = ys.slice(i - window, i);
    const mu = mean(ref);
    const sigma = stdDev(ref);
    const diff = ys[i]! - mu;
    let score: number;
    if (sigma === 0) {
      // Reference is constant — any non-zero deviation is infinitely
      // anomalous. Cap the reported score at a large constant.
      if (diff === 0) continue;
      score = 1e6;
    } else {
      score = Math.abs(diff / sigma);
    }
    if (score >= threshold) {
      out.push(Object.freeze({
        index:  i,
        t:      series.points[i]!.t,
        y:      ys[i]!,
        score,
        method: 'zscore',
      }));
    }
  }
  return out;
}

/** Lightweight change-point detection: a single PELT-style sweep that
 *  finds split points where the means of the two halves differ by
 *  more than `threshold` series-stddev. Returns the points around each
 *  detected change-point. */
function detectChangePoints(
  series: TimeSeries,
  threshold: number,
  minGap: number,
): ReadonlyArray<Anomaly> {
  const ys = values(series);
  if (ys.length < 2 * minGap) return [];
  const sigma = stdDev(ys);
  if (sigma === 0) return [];

  const out: Anomaly[] = [];
  let lastFlagged = -minGap;

  for (let i = minGap; i < ys.length - minGap; i += 1) {
    const before = ys.slice(Math.max(0, i - minGap), i);
    const after = ys.slice(i, Math.min(ys.length, i + minGap));
    const muBefore = mean(before);
    const muAfter = mean(after);
    const diff = Math.abs(muAfter - muBefore) / sigma;
    if (diff >= threshold && i - lastFlagged >= minGap) {
      out.push(Object.freeze({
        index:  i,
        t:      series.points[i]!.t,
        y:      ys[i]!,
        score:  diff,
        method: 'change-point',
      }));
      lastFlagged = i;
    }
  }
  return out;
}

/** Detect anomalies in a series. Returns the union of flagged points
 *  from the requested methods, de-duplicated by (index, method). */
export function detectAnomalies(args: {
  readonly series: TimeSeries;
  readonly opts?: AnomalyDetectorOptions;
}): ReadonlyArray<Anomaly> {
  const { series } = args;
  assertValidSeries(series);
  const opts = args.opts ?? {};
  const window = opts.window ?? 14;
  const threshold = opts.threshold ?? 3;
  const methods = opts.methods ?? ['zscore'];
  const minGap = opts.minChangePointGap ?? window;

  const accumulator: Anomaly[] = [];
  for (const m of methods) {
    if (m === 'zscore') {
      accumulator.push(...detectZScore(series, window, threshold));
    } else if (m === 'change-point') {
      accumulator.push(...detectChangePoints(series, threshold, minGap));
    }
  }
  return Object.freeze(accumulator);
}
