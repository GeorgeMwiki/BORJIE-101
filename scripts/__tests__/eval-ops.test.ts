/**
 * Unit tests for the eval-ops release-gate runners + shared CLI plumbing
 * (LP-22a). These run the deterministic runners in-process (no spawn, no
 * filesystem writes) and assert:
 *   - seeded determinism + seed sensitivity,
 *   - every shipped runner clears its gate on the default seed,
 *   - the suite verdict is the AND of runner verdicts,
 *   - arg parsing is total (help / error / run) and rejects unknown ids,
 *   - the PRNG is well-formed (bounds, reproducibility).
 */

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from '../eval-ops-lib/seeded-random.js';
import {
  finalizeSuite,
  parseEvalArgs,
} from '../eval-ops-lib/cli.js';
import {
  renderRunnerMarkdown,
  renderSuiteMarkdown,
} from '../eval-ops-lib/report.js';
import {
  CAPABILITY_RUNNER_IDS,
  runCapabilitySuite,
} from '../run-capability-evals/runners.js';
import {
  SOTA_RUNNER_IDS,
  runSotaSuite,
} from '../run-sota-validation/runners.js';

describe('createSeededRandom', () => {
  it('is reproducible for a given seed', () => {
    const a = createSeededRandom(123);
    const b = createSeededRandom(123);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = createSeededRandom(1).next();
    const b = createSeededRandom(2).next();
    expect(a).not.toBe(b);
  });

  it('keeps next() in [0,1) and int() within bounds', () => {
    const r = createSeededRandom(99);
    for (let i = 0; i < 1000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });
});

describe('capability suite', () => {
  it('runs all runners and clears every gate on the default seed', () => {
    const reports = runCapabilitySuite(20260603);
    expect(reports).toHaveLength(CAPABILITY_RUNNER_IDS.length);
    expect(reports.every((r) => r.passed)).toBe(true);
  });

  it('is deterministic (same seed → identical metrics)', () => {
    const a = runCapabilitySuite(42);
    const b = runCapabilitySuite(42);
    expect(a.map((r) => r.metrics)).toEqual(b.map((r) => r.metrics));
  });

  it('honours --only', () => {
    const reports = runCapabilitySuite(42, ['evidence-grounding']);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.runnerId).toBe('evidence-grounding');
  });
});

describe('sota suite', () => {
  it('runs all runners and clears every gate on the default seed', () => {
    const reports = runSotaSuite(1337);
    expect(reports).toHaveLength(SOTA_RUNNER_IDS.length);
    expect(reports.every((r) => r.passed)).toBe(true);
  });

  it('is deterministic (same seed → identical metrics)', () => {
    const a = runSotaSuite(7);
    const b = runSotaSuite(7);
    expect(a.map((r) => r.metrics)).toEqual(b.map((r) => r.metrics));
  });

  it('produces different metrics for a different seed', () => {
    const a = runSotaSuite(7).map((r) => r.metrics);
    const b = runSotaSuite(8).map((r) => r.metrics);
    expect(a).not.toEqual(b);
  });
});

describe('finalizeSuite — verdict is the AND of runner verdicts', () => {
  it('passes only when all runners pass', () => {
    const pass = finalizeSuite('x', 1, [
      { runnerId: 'a', title: 'a', seed: 1, nScenarios: 1, durationMs: 0, summary: '', metrics: [], criteria: [], passed: true },
    ]);
    expect(pass.passed).toBe(true);

    const fail = finalizeSuite('x', 1, [
      { runnerId: 'a', title: 'a', seed: 1, nScenarios: 1, durationMs: 0, summary: '', metrics: [], criteria: [], passed: true },
      { runnerId: 'b', title: 'b', seed: 1, nScenarios: 1, durationMs: 0, summary: '', metrics: [], criteria: [], passed: false },
    ]);
    expect(fail.passed).toBe(false);
  });
});

describe('parseEvalArgs', () => {
  const opts = {
    defaultSeed: 100,
    validIds: ['a', 'b', 'c'],
    usage: 'usage',
  };

  it('returns help on -h/--help', () => {
    expect(parseEvalArgs(['-h'], opts).kind).toBe('help');
    expect(parseEvalArgs(['--help'], opts).kind).toBe('help');
  });

  it('defaults the seed and runs with no only-filter', () => {
    const r = parseEvalArgs([], opts);
    expect(r.kind).toBe('run');
    if (r.kind === 'run') {
      expect(r.seed).toBe(100);
      expect(r.only).toBeUndefined();
    }
  });

  it('parses --seed and --only (both spaced and =)', () => {
    const r1 = parseEvalArgs(['--seed', '7', '--only', 'a,b'], opts);
    const r2 = parseEvalArgs(['--seed=7', '--only=a,b'], opts);
    for (const r of [r1, r2]) {
      expect(r.kind).toBe('run');
      if (r.kind === 'run') {
        expect(r.seed).toBe(7);
        expect(r.only).toEqual(['a', 'b']);
      }
    }
  });

  it('errors on a non-numeric seed', () => {
    const r = parseEvalArgs(['--seed', 'abc'], opts);
    expect(r.kind).toBe('error');
  });

  it('errors on an unknown runner id', () => {
    const r = parseEvalArgs(['--only', 'a,zzz'], opts);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toContain('zzz');
  });

  it('errors on an unknown flag', () => {
    expect(parseEvalArgs(['--bogus'], opts).kind).toBe('error');
  });
});

describe('report rendering', () => {
  it('renders a runner report with verdict + tables', () => {
    const md = renderRunnerMarkdown({
      runnerId: 'x',
      title: 'Runner X',
      seed: 1,
      nScenarios: 10,
      durationMs: 5,
      summary: 'all good',
      metrics: [{ key: 'm', value: 0.5, unit: 'ratio' }],
      criteria: [{ criterion: 'c', observed: 0.5, threshold: 0.4, passed: true }],
      passed: true,
    });
    expect(md).toContain('# Runner X');
    expect(md).toContain('Verdict: **PASS**');
    expect(md).toContain('| c | 0.5000 | 0.4000 | PASS |');
  });

  it('renders the suite index with a machine-readable block', () => {
    const suite = finalizeSuite('cap', 1, runCapabilitySuite(1));
    const md = renderSuiteMarkdown(suite);
    expect(md).toContain('# cap suite');
    expect(md).toContain('```json');
  });
});
