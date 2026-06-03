/**
 * Tests for the budget-bounded sleep tick (LP-21a + LP-21c).
 *
 * Coverage:
 *   - effectiveOverallDurationMs: platform-cap undercut on serverless;
 *     full budget on long-lived pods.
 *   - runSleepTick persists a run row per pass (running → done) and
 *     persists emissions.
 *   - aggregate budget: a slow pass that burns the budget causes later
 *     passes to be SKIPPED (not failed) with an audit report.
 *   - per-pass cap is min(pass.maxDurationMs, remainingBudget).
 *   - min-interval skip honours the DURABLE last-run timestamp.
 *   - a pass that ignores its abort is reported as `timeout`.
 *   - a throwing pass is reported as `failed`.
 *   - single-flight: a fresh `running` row makes beginRun return null.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runSleepTick,
  effectiveOverallDurationMs,
  DEFAULT_OVERALL_DURATION_MS,
  SERVERLESS_OVERALL_DURATION_MS,
} from '../sleep-tick.js';
import { createInMemorySleepRunStore } from '../passes/adapters.js';
import type { PassResult, PassSchedule, SleepPass } from '../types.js';

const SCHEDULE: PassSchedule = {
  cadence: { kind: 'every-minutes', minutes: 1 },
  minIntervalMinutes: 0,
  priority: 1,
  maxDurationMs: 5_000,
};

function makePass(
  id: string,
  run: SleepPass['run'],
  schedule: Partial<PassSchedule> = {},
): SleepPass {
  return { id, schedule: { ...SCHEDULE, ...schedule }, run };
}

function okResult(id: string, over: Partial<PassResult> = {}): PassResult {
  return {
    passId: id,
    itemsProcessed: 1,
    itemsEmitted: 0,
    notes: 'ok',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    aborted: false,
    errored: false,
    ...over,
  };
}

describe('effectiveOverallDurationMs — platform-cap undercut', () => {
  it('returns the full budget for a long-lived pod', () => {
    expect(effectiveOverallDurationMs({})).toBe(DEFAULT_OVERALL_DURATION_MS);
  });

  it('undercuts on Vercel', () => {
    expect(effectiveOverallDurationMs({ VERCEL: '1' })).toBe(
      SERVERLESS_OVERALL_DURATION_MS,
    );
  });

  it('undercuts on AWS Lambda', () => {
    expect(
      effectiveOverallDurationMs({ AWS_LAMBDA_FUNCTION_NAME: 'fn' }),
    ).toBe(SERVERLESS_OVERALL_DURATION_MS);
  });

  it('undercuts on Azure Functions', () => {
    expect(
      effectiveOverallDurationMs({ FUNCTIONS_WORKER_RUNTIME: 'node' }),
    ).toBe(SERVERLESS_OVERALL_DURATION_MS);
  });

  it('keeps the serverless undercut strictly below the default', () => {
    expect(SERVERLESS_OVERALL_DURATION_MS).toBeLessThan(
      DEFAULT_OVERALL_DURATION_MS,
    );
  });
});

describe('runSleepTick — persistence bookending', () => {
  it('writes a run row per pass and persists emissions', async () => {
    const store = createInMemorySleepRunStore();
    const pass = makePass('p1', async () =>
      okResult('p1', {
        itemsEmitted: 2,
        emissions: [
          { kind: 'lesson', payload: { lesson: 'a' } },
          { kind: 'nudge', payload: { subjectId: 't1' } },
        ],
      }),
    );

    const report = await runSleepTick({ passes: [pass], store });

    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ passId: 'p1', status: 'done' });
    expect(report.runs[0]?.runId).toBeTruthy();

    const rows = store.runs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ passId: 'p1', status: 'done' });
    expect(rows[0]?.completedAt).not.toBeNull();

    const emissions = store.emissions();
    expect(emissions).toHaveLength(2);
    expect(emissions.map((e) => e.kind)).toEqual(['lesson', 'nudge']);
  });
});

describe('runSleepTick — aggregate budget', () => {
  it('skips later passes once the overall budget is exhausted', async () => {
    const store = createInMemorySleepRunStore();
    // Deterministic monotonic clock: the first pass "takes" 1000ms.
    let t = 0;
    const monotonicNowMs = () => t;

    const slow = makePass('slow', async () => {
      t += 1_000; // advance the budget clock as if work happened
      return okResult('slow');
    });
    const later = makePass('later', async () => okResult('later'));

    const report = await runSleepTick({
      passes: [slow, later],
      store,
      maxOverallDurationMs: 500, // smaller than the 1000ms the slow pass burns
      monotonicNowMs,
    });

    expect(report.runs[0]).toMatchObject({ passId: 'slow', status: 'done' });
    expect(report.runs[1]).toMatchObject({
      passId: 'later',
      status: 'skipped',
      runId: null,
    });
    expect(report.runs[1]?.notes).toContain('budget exhausted');
    // The skipped pass must NOT have a persisted run row.
    expect(store.runs().map((r) => r.passId)).toEqual(['slow']);
  });

  it('caps a hanging pass at the remaining budget, not its own larger maxDuration', async () => {
    const store = createInMemorySleepRunStore();
    // The pass would happily run for 10s (its maxDuration) but the tick only
    // has a 30ms overall budget. The cap must be the 30ms remaining budget:
    // a pass that hangs until aborted must time out fast, proving the cap is
    // min(pass.maxDurationMs, remainingBudget) and not the pass's 10s.
    const pass = makePass(
      'capped',
      ({ abortSignal }) =>
        new Promise<PassResult>((resolve) => {
          abortSignal.addEventListener('abort', () => resolve(okResult('capped')), {
            once: true,
          });
        }),
      { maxDurationMs: 10_000 },
    );

    const start = Date.now();
    const report = await runSleepTick({
      passes: [pass],
      store,
      maxOverallDurationMs: 30,
    });
    const elapsed = Date.now() - start;

    expect(report.overallBudgetMs).toBe(30);
    expect(report.runs[0]?.status).toBe('timeout');
    // Must abort within the budget window, not after the pass's 10s ceiling.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('runSleepTick — min-interval skip from durable timestamp', () => {
  it('skips a pass that ran more recently than its min interval', async () => {
    const store = createInMemorySleepRunStore();
    const pass = makePass('freq', async () => okResult('freq'), {
      minIntervalMinutes: 60,
    });

    // First run lands a row.
    await runSleepTick({ passes: [pass], store });
    // Immediate second tick — should skip on min-interval.
    const second = await runSleepTick({ passes: [pass], store });

    expect(second.runs[0]).toMatchObject({ status: 'skipped', runId: null });
    expect(second.runs[0]?.notes).toContain('since last run');
    // Only the first run persisted a row.
    expect(store.runs()).toHaveLength(1);
  });
});

describe('runSleepTick — abort + error handling', () => {
  it('reports a pass that ignores its abort as timeout', async () => {
    const store = createInMemorySleepRunStore();
    // Pass never resolves until well past the budget; the hard timer aborts it.
    const pass = makePass(
      'hang',
      ({ abortSignal }) =>
        new Promise<PassResult>((resolve) => {
          const onAbort = () => resolve(okResult('hang'));
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }),
      { maxDurationMs: 20 },
    );

    const report = await runSleepTick({
      passes: [pass],
      store,
      maxOverallDurationMs: 60_000,
    });
    expect(report.runs[0]?.status).toBe('timeout');
    expect(store.runs()[0]?.status).toBe('timeout');
  });

  it('reports a throwing pass as failed with the error text', async () => {
    const store = createInMemorySleepRunStore();
    const pass = makePass('boom', async () => {
      throw new Error('kaboom');
    });

    const report = await runSleepTick({ passes: [pass], store });
    expect(report.runs[0]).toMatchObject({ status: 'failed' });
    expect(report.runs[0]?.errorText).toContain('kaboom');
    expect(store.runs()[0]?.status).toBe('failed');
  });
});

describe('createInMemorySleepRunStore — single-flight + rescue', () => {
  it('returns null from beginRun when a fresh running row exists', async () => {
    const store = createInMemorySleepRunStore();
    const first = await store.beginRun('p');
    expect(first).toBeTruthy();
    // Second begin while the first is still 'running' → single-flight skip.
    const second = await store.beginRun('p');
    expect(second).toBeNull();
  });

  it('reaps a stale running row and inserts a fresh one', async () => {
    let clock = 0;
    const store = createInMemorySleepRunStore({
      rescueAgeMs: 1_000,
      nowMs: () => clock,
    });
    const first = await store.beginRun('p');
    expect(first).toBeTruthy();

    // Advance past the rescue window.
    clock += 2_000;
    const second = await store.beginRun('p');
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    const rows = store.runs();
    const reaped = rows.find((r) => r.id === first);
    expect(reaped?.status).toBe('failed');
    expect(reaped?.errorText).toContain('presumed crash');
  });
});

describe('runSleepTick — report sink', () => {
  it('invokes the sink once per finalized pass', async () => {
    const store = createInMemorySleepRunStore();
    const sink = vi.fn();
    const passes = [
      makePass('a', async () => okResult('a')),
      makePass('b', async () => okResult('b')),
    ];
    await runSleepTick({ passes, store, reportSink: sink });
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
