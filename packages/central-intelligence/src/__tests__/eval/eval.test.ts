/**
 * Eval harness — single vitest entry point that runs the corpus
 * through `composeSovereign()` and asserts:
 *
 *   1. Every scenario passes its individual `expected.*` clauses.
 *   2. Aggregate metrics stay within thresholds vs `baseline.json`.
 *
 * To refresh the baseline after an intentional kernel change:
 *
 *   EVAL_WRITE_BASELINE=1 pnpm -C packages/central-intelligence test
 *
 * The runner writes `baseline.next.json` next to `baseline.json`; copy
 * it over after reviewing the diff.
 *
 * To skip the baseline diff (e.g. for a fresh-clone first run):
 *
 *   EVAL_NO_BASELINE=1 pnpm -C packages/central-intelligence test
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { EVAL_SCENARIOS } from './scenarios.js';
import { runEvalSuite, type EvalSummary } from './runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'baseline.json');
const BASELINE_NEXT_PATH = join(HERE, 'baseline.next.json');

// Drift thresholds — when comparing the live summary to the checked-in
// baseline. Each is a relative bound; the first that trips fails the
// suite. Keep these slack enough to absorb ordinary noise; tighten as
// the harness matures.
const THRESHOLDS = {
  meanConfidenceDropMax: 0.05,    // mean confidence may not drop > 0.05
  refusalRateChangeMax: 0.10,     // refusal rate may not move > 0.10 either way
  driftRateChangeMax: 0.10,       // drift rate may not move > 0.10 either way
  // p95 latency: only flag when BOTH the absolute p95 exceeds 250ms AND
  // the ratio against baseline exceeds 5x. The runner produces sub-ms
  // baselines on stub sensors; GC / scheduling jitter can double those
  // routinely, which is noise — not a regression. A real regression
  // (sensor stuck on a sync loop) lands well above 250ms.
  p95LatencyAbsoluteMaxMs: 250,
  p95LatencyRiseMaxRatio: 5.0,
} as const;

describe('central-intelligence — regression eval harness', () => {
  it('runs every curated scenario through composeSovereign() and applies expected.* assertions', async () => {
    const outcome = await runEvalSuite(EVAL_SCENARIOS);

    // ── Per-scenario assertions ────────────────────────────────────
    const failingScenarios = outcome.results.filter((r) => !r.pass);
    if (failingScenarios.length > 0) {
      const lines = failingScenarios.map(
        (r) => `  • [${r.scenarioId}] ${r.failures.join('; ')}`,
      );
      throw new Error(
        `${failingScenarios.length}/${outcome.results.length} eval scenario(s) failed:\n${lines.join('\n')}`,
      );
    }

    expect(outcome.summary.total).toBe(EVAL_SCENARIOS.length);
    expect(outcome.summary.passed).toBe(EVAL_SCENARIOS.length);
    expect(outcome.summary.failed).toBe(0);

    // ── Baseline write / diff ──────────────────────────────────────
    if (process.env['EVAL_WRITE_BASELINE'] === '1') {
      writeFileSync(BASELINE_NEXT_PATH, JSON.stringify(outcome.summary, null, 2) + '\n', 'utf8');
      // No assertion against an old baseline when explicitly writing.
      return;
    }
    if (process.env['EVAL_NO_BASELINE'] === '1') return;

    if (!existsSync(BASELINE_PATH)) {
      // First run — record the baseline alongside; do not fail.
      writeFileSync(BASELINE_PATH, JSON.stringify(outcome.summary, null, 2) + '\n', 'utf8');
      return;
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as EvalSummary;
    assertWithinThresholds(outcome.summary, baseline);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────
// Threshold assertions
// ─────────────────────────────────────────────────────────────────────

function assertWithinThresholds(live: EvalSummary, base: EvalSummary): void {
  const violations: string[] = [];

  if (base.meanConfidence - live.meanConfidence > THRESHOLDS.meanConfidenceDropMax) {
    violations.push(
      `meanConfidence dropped by ${(base.meanConfidence - live.meanConfidence).toFixed(3)} ` +
        `(baseline ${base.meanConfidence.toFixed(3)} → live ${live.meanConfidence.toFixed(3)}, ` +
        `max drop ${THRESHOLDS.meanConfidenceDropMax})`,
    );
  }

  const refusalDelta = Math.abs(live.refusalRate - base.refusalRate);
  if (refusalDelta > THRESHOLDS.refusalRateChangeMax) {
    violations.push(
      `refusalRate moved by ${refusalDelta.toFixed(3)} ` +
        `(baseline ${base.refusalRate.toFixed(3)} → live ${live.refusalRate.toFixed(3)}, ` +
        `max change ${THRESHOLDS.refusalRateChangeMax})`,
    );
  }

  const driftDelta = Math.abs(live.driftRate - base.driftRate);
  if (driftDelta > THRESHOLDS.driftRateChangeMax) {
    violations.push(
      `driftRate moved by ${driftDelta.toFixed(3)} ` +
        `(baseline ${base.driftRate.toFixed(3)} → live ${live.driftRate.toFixed(3)}, ` +
        `max change ${THRESHOLDS.driftRateChangeMax})`,
    );
  }

  // p95 latency rise — guard against runaway times. Flag ONLY when
  // BOTH the absolute p95 exceeds the floor (250ms — well above any
  // jitter band on a stub-sensor run) AND the ratio against baseline
  // exceeds 5x. This kills the sub-ms baseline flake (a 6ms baseline
  // jittering to 16ms is GC noise, not a regression).
  if (
    live.p95LatencyMs > THRESHOLDS.p95LatencyAbsoluteMaxMs &&
    live.p95LatencyMs > base.p95LatencyMs * THRESHOLDS.p95LatencyRiseMaxRatio
  ) {
    violations.push(
      `p95LatencyMs ${live.p95LatencyMs}ms exceeds ${THRESHOLDS.p95LatencyRiseMaxRatio}x baseline (${base.p95LatencyMs}ms) AND absolute floor ${THRESHOLDS.p95LatencyAbsoluteMaxMs}ms`,
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `eval baseline regression detected:\n  • ${violations.join('\n  • ')}\n` +
        `If this is intentional, refresh the baseline with:\n` +
        `  EVAL_WRITE_BASELINE=1 pnpm -C packages/central-intelligence test`,
    );
  }
}
