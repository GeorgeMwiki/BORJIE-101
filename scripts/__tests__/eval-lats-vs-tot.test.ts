/**
 * eval-lats-vs-tot — unit tests.
 *
 * Runs the deterministic harness in-process and asserts the contract:
 * both planners terminate, return real numbers, and the LATS regression
 * vs ToT stays within the 10% default cap on the canonical problem set.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const RUNNER = resolve(__filename, '..', '..', 'eval-lats-vs-tot.mjs');

function runEval(budget = 800, maxRegression = 0.1) {
  return spawnSync(
    'node',
    [
      RUNNER,
      '--json',
      '--budget',
      String(budget),
      '--max-regression',
      String(maxRegression),
    ],
    { encoding: 'utf8' },
  );
}

describe('eval-lats-vs-tot harness', () => {
  it('runs the canonical 5-problem set and emits one row per problem', () => {
    const r = runEval();
    const report = JSON.parse(r.stdout);
    expect(report.rows.length).toBe(5);
  });

  it('emits aggregate metrics for both planners', () => {
    const r = runEval();
    const report = JSON.parse(r.stdout);
    for (const key of ['bestScore', 'expansionsUsed', 'tokensUsed', 'wallClockMs']) {
      expect(report.aggregate[key]).toHaveProperty('tot');
      expect(report.aggregate[key]).toHaveProperty('lats');
      expect(typeof report.aggregate[key].tot).toBe('number');
      expect(typeof report.aggregate[key].lats).toBe('number');
    }
  });

  it('keeps LATS bestScore within the default 10% regression cap', () => {
    const r = runEval(800, 0.1);
    expect(r.status).toBe(0);
  });

  it('hard-fails when the regression cap is set unrealistically tight', () => {
    // Forcing a negative cap makes ANY drift fail — useful smoke for the gate.
    const r = runEval(800, -1);
    expect(r.status).toBe(1);
  });

  it('respects the --budget flag (tokens consumed monotonic with budget)', () => {
    const r1 = JSON.parse(runEval(200).stdout);
    const r2 = JSON.parse(runEval(800).stdout);
    expect(r1.aggregate.tokensUsed.tot).toBeLessThanOrEqual(
      r2.aggregate.tokensUsed.tot + 50,
    );
  });
});
