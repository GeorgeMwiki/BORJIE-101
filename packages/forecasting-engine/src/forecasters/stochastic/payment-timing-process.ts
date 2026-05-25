/**
 * PaymentTimingProcess — when does a tenant pay next?
 *
 * Per-tenant renewal process. We infer a log-normal inter-arrival
 * distribution from historical payments. Future arrivals are sampled
 * forward.
 */

import { mulberry32 } from '../../util/rng.js';

export interface PaymentObservation {
  readonly tMs: number;
  readonly tenantId: string;
}

export interface PaymentTimingParams {
  readonly tenantId: string;
  readonly meanLogIntervalMs: number;
  readonly stdLogIntervalMs: number;
  readonly lastObservedMs: number;
  readonly sampleSize: number;
}

const MIN_LOG_STD = 0.05;

export function fitPaymentTiming(
  observations: ReadonlyArray<PaymentObservation>,
): PaymentTimingParams {
  if (observations.length < 2) {
    throw new Error('Need at least 2 payment observations');
  }
  const sorted = [...observations].sort((a, b) => a.tMs - b.tMs);
  const tenantId = sorted[0]?.tenantId ?? 'unknown';
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (cur !== undefined && prev !== undefined) {
      intervals.push(Math.max(1, cur.tMs - prev.tMs));
    }
  }
  const logIntervals = intervals.map((x) => Math.log(x));
  const mean = logIntervals.reduce((s, x) => s + x, 0) / logIntervals.length;
  const variance =
    logIntervals.reduce((s, x) => s + (x - mean) * (x - mean), 0) /
    Math.max(1, logIntervals.length);
  const lastObserved = sorted[sorted.length - 1]?.tMs ?? 0;
  return {
    tenantId,
    meanLogIntervalMs: mean,
    stdLogIntervalMs: Math.max(MIN_LOG_STD, Math.sqrt(variance)),
    lastObservedMs: lastObserved,
    sampleSize: observations.length,
  };
}

export interface SamplePaymentsOptions {
  readonly params: PaymentTimingParams;
  readonly horizonMs: number;
  readonly seed: number;
}

export function samplePaymentTimes(
  opts: SamplePaymentsOptions,
): ReadonlyArray<number> {
  const rng = mulberry32(opts.seed);
  const out: number[] = [];
  let t = opts.params.lastObservedMs;
  const end = opts.params.lastObservedMs + opts.horizonMs;
  while (t < end) {
    // Sample log-normal interval
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const logInterval =
      opts.params.meanLogIntervalMs + opts.params.stdLogIntervalMs * z;
    const interval = Math.exp(logInterval);
    t += interval;
    if (t < end) out.push(t);
    if (out.length > 200) break; // safety
  }
  return out;
}

export function expectedIntervalMs(params: PaymentTimingParams): number {
  // E[log-normal] = exp(mu + sigma^2 / 2)
  return Math.exp(
    params.meanLogIntervalMs + 0.5 * params.stdLogIntervalMs ** 2,
  );
}
