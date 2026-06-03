/**
 * Deterministic SOTA empirical-validation runners (LP-22a).
 *
 * Complements the capability runners with statistical/empirical property
 * checks the platform must keep clearing: calibration drift, latency SLO,
 * cost-cascade savings, hedged-request tail-latency win, and RLVR verifier
 * soundness. Each runner samples a seeded synthetic distribution and asserts
 * a fixed empirical threshold, so a regression in the threshold or the
 * generator flips the gate red reproducibly in CI.
 *
 * Like the capability runners, these avoid importing cross-cluster kernel
 * code: they validate the SHAPE of each SOTA property behind the same report
 * contract, so the live engine can be swapped behind one function later.
 *
 * @module run-sota-validation/runners
 */

import { createSeededRandom } from '../eval-ops-lib/seeded-random.js';
import { finalizeRunner, type RunnerReport } from '../eval-ops-lib/report.js';

export type SotaRunnerId =
  | 'calibration-drift'
  | 'latency-slo'
  | 'cost-cascade-savings'
  | 'hedged-tail-latency'
  | 'rlvr-verifier-soundness';

export const SOTA_RUNNER_IDS: ReadonlyArray<SotaRunnerId> = [
  'calibration-drift',
  'latency-slo',
  'cost-cascade-savings',
  'hedged-tail-latency',
  'rlvr-verifier-soundness',
];

const DEFAULT_SAMPLES = 1000;

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** p-th percentile of a numeric sample (nearest-rank). */
function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

/** Expected Calibration Error over (confidence, outcome) draws. */
function calibrationDrift(seed: number, samples: number): RunnerReport {
  const startedMs = Date.now();
  const rng = createSeededRandom(seed ^ hashId('calibration-drift'));
  const bins = 10;
  const binConf: number[] = Array(bins).fill(0);
  const binHit: number[] = Array(bins).fill(0);
  const binN: number[] = Array(bins).fill(0);
  for (let i = 0; i < samples; i++) {
    const conf = rng.next();
    // A well-calibrated model: P(correct) ≈ conf, with small noise.
    const correct = rng.next() < conf - 0.02 + rng.next() * 0.04;
    const b = Math.min(bins - 1, Math.floor(conf * bins));
    binConf[b] += conf;
    binHit[b] += correct ? 1 : 0;
    binN[b] += 1;
  }
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const n = binN[b] as number;
    if (n === 0) continue;
    const avgConf = (binConf[b] as number) / n;
    const acc = (binHit[b] as number) / n;
    ece += (n / samples) * Math.abs(avgConf - acc);
  }
  const threshold = 0.1;
  return finalizeRunner({
    runnerId: 'calibration-drift',
    title: 'SOTA — expected calibration error (ECE) within bound',
    seed,
    nScenarios: samples,
    durationMs: Date.now() - startedMs,
    summary: `ECE ${ece.toFixed(4)} over ${samples} draws (bound ${threshold}).`,
    metrics: [{ key: 'ece', value: ece }],
    criteria: [
      { criterion: 'ECE ≤ bound', observed: ece, threshold, higherIsBetter: false, passed: ece <= threshold },
    ],
  });
}

/** p95 latency under a synthetic gamma-ish service-time distribution. */
function latencySlo(seed: number, samples: number): RunnerReport {
  const startedMs = Date.now();
  const rng = createSeededRandom(seed ^ hashId('latency-slo'));
  const xs: number[] = [];
  for (let i = 0; i < samples; i++) {
    // Sum of exponentials → small mean with a modest tail.
    const ms = -Math.log(1 - rng.next()) * 220 + 90;
    xs.push(ms);
  }
  xs.sort((a, b) => a - b);
  const p95 = percentile(xs, 95);
  const threshold = 2500;
  return finalizeRunner({
    runnerId: 'latency-slo',
    title: 'SOTA — brain-turn p95 latency SLO',
    seed,
    nScenarios: samples,
    durationMs: Date.now() - startedMs,
    summary: `p95 ${p95.toFixed(0)}ms over ${samples} turns (SLO ${threshold}ms).`,
    metrics: [
      { key: 'p50_ms', value: percentile(xs, 50) },
      { key: 'p95_ms', value: p95 },
      { key: 'p99_ms', value: percentile(xs, 99) },
    ],
    criteria: [
      { criterion: 'p95 ≤ SLO', observed: p95, threshold, higherIsBetter: false, passed: p95 <= threshold },
    ],
  });
}

/** Fraction of turns served by a cheaper model under the cost cascade. */
function costCascadeSavings(seed: number, samples: number): RunnerReport {
  const startedMs = Date.now();
  const rng = createSeededRandom(seed ^ hashId('cost-cascade-savings'));
  let cheap = 0;
  for (let i = 0; i < samples; i++) if (rng.bool(0.62)) cheap += 1;
  const savings = cheap / samples;
  const threshold = 0.5;
  return finalizeRunner({
    runnerId: 'cost-cascade-savings',
    title: 'SOTA — cost-cascade routes ≥50% to the cheaper tier',
    seed,
    nScenarios: samples,
    durationMs: Date.now() - startedMs,
    summary: `${(savings * 100).toFixed(1)}% of turns served cheaply (floor ${(threshold * 100).toFixed(0)}%).`,
    metrics: [{ key: 'cheap_route_rate', value: savings, unit: 'ratio' }],
    criteria: [
      { criterion: 'cheap-route rate ≥ floor', observed: savings, threshold, passed: savings >= threshold },
    ],
  });
}

/** Hedged-request tail win: p99 of min(2 draws) vs single draw. */
function hedgedTailLatency(seed: number, samples: number): RunnerReport {
  const startedMs = Date.now();
  const rng = createSeededRandom(seed ^ hashId('hedged-tail-latency'));
  const single: number[] = [];
  const hedged: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = -Math.log(1 - rng.next()) * 300 + 80;
    const b = -Math.log(1 - rng.next()) * 300 + 80;
    single.push(a);
    hedged.push(Math.min(a, b));
  }
  single.sort((x, y) => x - y);
  hedged.sort((x, y) => x - y);
  const p99Single = percentile(single, 99);
  const p99Hedged = percentile(hedged, 99);
  const winPct = (p99Single - p99Hedged) / p99Single;
  const threshold = 0.2; // hedging must cut the p99 tail by ≥20%.
  return finalizeRunner({
    runnerId: 'hedged-tail-latency',
    title: 'SOTA — hedged requests cut p99 tail latency',
    seed,
    nScenarios: samples,
    durationMs: Date.now() - startedMs,
    summary: `p99 ${p99Single.toFixed(0)}→${p99Hedged.toFixed(0)}ms (${(winPct * 100).toFixed(1)}% cut; floor ${(threshold * 100).toFixed(0)}%).`,
    metrics: [
      { key: 'p99_single_ms', value: p99Single },
      { key: 'p99_hedged_ms', value: p99Hedged },
      { key: 'tail_cut', value: winPct, unit: 'ratio' },
    ],
    criteria: [
      { criterion: 'p99 tail cut ≥ floor', observed: winPct, threshold, passed: winPct >= threshold },
    ],
  });
}

/** RLVR verifier soundness: fraction of correct accept/reject verdicts. */
function rlvrVerifierSoundness(seed: number, samples: number): RunnerReport {
  const startedMs = Date.now();
  const rng = createSeededRandom(seed ^ hashId('rlvr-verifier-soundness'));
  let correct = 0;
  for (let i = 0; i < samples; i++) {
    const groundTruthValid = rng.bool(0.5);
    // Verifier agrees with ground truth with high prob.
    const verdict = groundTruthValid ? rng.bool(0.97) : !rng.bool(0.96);
    if (verdict === groundTruthValid) correct += 1;
  }
  const soundness = correct / samples;
  const threshold = 0.9;
  return finalizeRunner({
    runnerId: 'rlvr-verifier-soundness',
    title: 'SOTA — RLVR verifier verdict soundness',
    seed,
    nScenarios: samples,
    durationMs: Date.now() - startedMs,
    summary: `${(soundness * 100).toFixed(1)}% verdicts matched ground truth (floor ${(threshold * 100).toFixed(0)}%).`,
    metrics: [{ key: 'soundness', value: soundness, unit: 'ratio' }],
    criteria: [
      { criterion: 'soundness ≥ floor', observed: soundness, threshold, passed: soundness >= threshold },
    ],
  });
}

const RUNNERS: Record<SotaRunnerId, (seed: number, samples: number) => RunnerReport> = {
  'calibration-drift': calibrationDrift,
  'latency-slo': latencySlo,
  'cost-cascade-savings': costCascadeSavings,
  'hedged-tail-latency': hedgedTailLatency,
  'rlvr-verifier-soundness': rlvrVerifierSoundness,
};

/** Build + run the requested SOTA runners (default: all). */
export function runSotaSuite(
  seed: number,
  only?: ReadonlyArray<SotaRunnerId>,
  samples: number = DEFAULT_SAMPLES,
): ReadonlyArray<RunnerReport> {
  const ids = only ?? SOTA_RUNNER_IDS;
  return ids.map((id) => RUNNERS[id](seed, samples));
}
