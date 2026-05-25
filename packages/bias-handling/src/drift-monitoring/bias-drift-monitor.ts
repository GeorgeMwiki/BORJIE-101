/**
 * Production bias drift monitor.
 *
 * Pattern adapted from the Evidently AI playbook for ML
 * monitoring: maintain rolling baseline + current windows of
 * observations, compute group-specific selection rates per
 * "batch" (sub-window), and run a two-sample KS test on the
 * resulting distributions.
 *
 * When the p-value falls below `alertThreshold` we emit a
 * `BiasDriftAlert`. The alert is emitted at most once per call
 * to `check()`; the caller is responsible for cooldown logic.
 *
 * Storage: in-memory bounded ring buffer. Persist externally if
 * you need durability across restarts.
 */

import type {
  BiasDriftAlert,
  BiasDriftObservation,
  BiasMetric,
} from '../types.js';
import { twoSampleKS } from './ks-test.js';

export interface BiasDriftMonitorOptions {
  /** Number of observations to keep as baseline. Default 200. */
  readonly baselineWindowSize?: number;
  /** Number of recent observations for "current". Default 200. */
  readonly currentWindowSize?: number;
  /** Sub-batch size used to compute one selection rate per batch. Default 25. */
  readonly batchSize?: number;
  /** Alert when KS p-value < this. Default 0.01. */
  readonly alertThreshold?: number;
  /** Metric reported in alerts. Default 'demographic_parity'. */
  readonly metric?: BiasMetric;
}

interface InternalObservation {
  readonly group: string;
  readonly prediction: 0 | 1;
  readonly tsMs: number;
}

export class BiasDriftMonitor {
  private readonly baselineMax: number;
  private readonly currentMax: number;
  private readonly batchSize: number;
  private readonly alertThreshold: number;
  private readonly metric: BiasMetric;
  private readonly baseline: InternalObservation[] = [];
  private readonly current: InternalObservation[] = [];

  constructor(opts: BiasDriftMonitorOptions = {}) {
    this.baselineMax = opts.baselineWindowSize ?? 200;
    this.currentMax = opts.currentWindowSize ?? 200;
    this.batchSize = opts.batchSize ?? 25;
    this.alertThreshold = opts.alertThreshold ?? 0.01;
    this.metric = opts.metric ?? 'demographic_parity';
    if (this.batchSize < 2) {
      throw new Error('[bias-handling] batchSize must be >= 2.');
    }
  }

  /** Number of baseline observations recorded so far. */
  baselineSize(): number {
    return this.baseline.length;
  }

  /** Number of current observations recorded so far. */
  currentSize(): number {
    return this.current.length;
  }

  /** Record an observation. Fills baseline first, then current. */
  observe(obs: BiasDriftObservation): void {
    const o: InternalObservation = {
      group: obs.group,
      prediction: obs.prediction,
      tsMs: obs.tsMs ?? Date.now(),
    };
    if (this.baseline.length < this.baselineMax) {
      this.baseline.push(o);
      return;
    }
    this.current.push(o);
    if (this.current.length > this.currentMax) {
      this.current.shift();
    }
  }

  /** Force reset baseline window (e.g. after model re-deploy). */
  resetBaseline(): void {
    // Move current → baseline as the new baseline if we have any.
    this.baseline.splice(0, this.baseline.length, ...this.current.slice());
    this.current.splice(0, this.current.length);
  }

  /**
   * Compute disparity scores per batch within a window, where
   * disparity = max(selection-rate) − min(selection-rate) across
   * groups in that batch.
   */
  private batchedDisparities(
    window: ReadonlyArray<InternalObservation>,
  ): { disparities: number[]; groups: ReadonlyArray<string> } {
    const groupsSet = new Set<string>();
    const out: number[] = [];
    for (let i = 0; i + this.batchSize <= window.length; i += this.batchSize) {
      const batch = window.slice(i, i + this.batchSize);
      const counts = new Map<string, { pos: number; n: number }>();
      for (const o of batch) {
        groupsSet.add(o.group);
        const slot = counts.get(o.group) ?? { pos: 0, n: 0 };
        slot.n += 1;
        if (o.prediction === 1) slot.pos += 1;
        counts.set(o.group, slot);
      }
      const rates: number[] = [];
      for (const slot of counts.values()) {
        rates.push(slot.n === 0 ? 0 : slot.pos / slot.n);
      }
      if (rates.length < 2) continue;
      const lo = Math.min(...rates);
      const hi = Math.max(...rates);
      out.push(hi - lo);
    }
    return { disparities: out, groups: [...groupsSet].sort() };
  }

  /**
   * Returns an alert if drift detected; null otherwise. Returns
   * null if baseline or current window is too small to evaluate.
   */
  check(): BiasDriftAlert | null {
    if (this.baseline.length < this.batchSize * 2) return null;
    if (this.current.length < this.batchSize * 2) return null;
    const base = this.batchedDisparities(this.baseline);
    const cur = this.batchedDisparities(this.current);
    if (base.disparities.length < 2 || cur.disparities.length < 2) return null;
    const { pValue } = twoSampleKS(base.disparities, cur.disparities);
    if (pValue >= this.alertThreshold) return null;
    const baselineMean = mean(base.disparities);
    const currentMean = mean(cur.disparities);
    return {
      metric: this.metric,
      baselineScore: baselineMean,
      currentScore: currentMean,
      pValue,
      threshold: this.alertThreshold,
      groupsObserved: cur.groups,
      windowSize: this.current.length,
      tsMs: Date.now(),
    };
  }

  /** For testing — drop both windows. */
  reset(): void {
    this.baseline.splice(0, this.baseline.length);
    this.current.splice(0, this.current.length);
  }
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}
