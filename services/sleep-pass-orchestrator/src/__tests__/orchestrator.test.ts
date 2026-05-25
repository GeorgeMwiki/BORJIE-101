import { describe, expect, it, vi } from 'vitest';
import { createOrchestrator, nextDueFrom } from '../orchestrator.js';
import type { PassResult, SleepPass } from '../types.js';

function fakePass(
  id: string,
  overrides: Partial<SleepPass['schedule']> = {},
  body: () => Promise<PassResult> = async () =>
    ({
      passId: id,
      itemsProcessed: 0,
      itemsEmitted: 0,
      notes: '',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      aborted: false,
      errored: false,
    }) as PassResult,
): SleepPass {
  return {
    id,
    schedule: {
      cadence: { kind: 'every-minutes', minutes: 1 },
      minIntervalMinutes: 0,
      priority: 3,
      maxDurationMs: 5_000,
      ...overrides,
    },
    run: () => body(),
  };
}

describe('nextDueFrom', () => {
  const t = new Date('2026-05-25T10:30:00.000Z');
  it('every-minutes adds the gap', () => {
    const p = fakePass('p', { cadence: { kind: 'every-minutes', minutes: 15 } });
    expect(nextDueFrom(p, t)).toBe('2026-05-25T10:45:00.000Z');
  });
  it('hourly snaps to offset minute and rolls past', () => {
    const p = fakePass('p', {
      cadence: { kind: 'hourly', offsetMinutes: 15 },
    });
    expect(nextDueFrom(p, t)).toBe('2026-05-25T11:15:00.000Z');
  });
  it('daily snaps to next H:M', () => {
    const p = fakePass('p', { cadence: { kind: 'daily', hour: 9, minute: 0 } });
    expect(nextDueFrom(p, t)).toBe('2026-05-26T09:00:00.000Z');
  });
  it('daily future today returns today', () => {
    const p = fakePass('p', {
      cadence: { kind: 'daily', hour: 23, minute: 0 },
    });
    expect(nextDueFrom(p, t)).toBe('2026-05-25T23:00:00.000Z');
  });
  it('weekly snaps to next dayOfWeek', () => {
    const p = fakePass('p', {
      cadence: { kind: 'weekly', dayOfWeek: 1, hour: 6, minute: 0 },
    });
    const result = nextDueFrom(p, t);
    expect(new Date(result).getUTCDay()).toBe(1);
  });
});

describe('orchestrator.decide', () => {
  const baseNow = new Date('2026-05-25T10:00:00.000Z');
  function fixedNow(): Date {
    return baseNow;
  }

  it('considers all passes', () => {
    const orch = createOrchestrator({
      passes: [fakePass('a'), fakePass('b')],
      now: fixedNow,
    });
    const tick = orch.decide();
    expect(tick.considered).toEqual(['a', 'b']);
  });

  it('dispatches due passes immediately on first decide', () => {
    const orch = createOrchestrator({
      passes: [
        fakePass('a', { cadence: { kind: 'every-minutes', minutes: 1 } }),
      ],
      now: fixedNow,
    });
    const tick = orch.decide();
    // First decide sees nextDue == now, so it is "due"
    expect(tick.skipped.find((s) => s.id === 'a')?.reason).toBe('not-due-yet');
  });

  it('sorts dispatched candidates by priority', async () => {
    const callOrder: string[] = [];
    const passes = [
      fakePass('low', { priority: 5 }, async () => {
        callOrder.push('low');
        return makeResult('low');
      }),
      fakePass('high', { priority: 1 }, async () => {
        callOrder.push('high');
        return makeResult('high');
      }),
    ];
    let t = baseNow.getTime();
    const orch = createOrchestrator({
      passes,
      now: () => new Date(t),
    });
    // Advance time so they're due
    t = baseNow.getTime() + 5 * 60_000;
    const out = await orch.tick();
    expect(out.tick.dispatched[0]).toBe('high');
    expect(out.tick.dispatched[1]).toBe('low');
  });

  it('skips passes inside minIntervalMinutes window', async () => {
    let t = baseNow.getTime();
    const orch = createOrchestrator({
      passes: [
        fakePass(
          'a',
          {
            cadence: { kind: 'every-minutes', minutes: 0 },
            minIntervalMinutes: 60,
          },
          async () => makeResult('a'),
        ),
      ],
      now: () => new Date(t),
    });
    // First tick — runs.
    t += 1_000;
    const r1 = await orch.tick();
    expect(r1.tick.dispatched).toEqual(['a']);
    // Second tick immediately after — skipped (min-interval).
    t += 10_000;
    const r2 = await orch.tick();
    expect(r2.tick.skipped.find((s) => s.id === 'a')?.reason).toBe(
      'min-interval-not-elapsed',
    );
  });
});

describe('orchestrator.tick', () => {
  it('emits results into resultSink', async () => {
    const sink = vi.fn();
    let t = new Date('2026-05-25T10:00:00.000Z').getTime();
    const orch = createOrchestrator({
      passes: [fakePass('a', {}, async () => makeResult('a'))],
      now: () => new Date(t),
      resultSink: sink,
    });
    t += 5 * 60_000;
    await orch.tick();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('captures thrown errors into PassResult.errored=true', async () => {
    let t = new Date('2026-05-25T10:00:00.000Z').getTime();
    const orch = createOrchestrator({
      passes: [
        fakePass('boom', {}, async () => {
          throw new Error('kaboom');
        }),
      ],
      now: () => new Date(t),
    });
    t += 5 * 60_000;
    const { results } = await orch.tick();
    expect(results[0]?.errored).toBe(true);
    expect(results[0]?.notes).toContain('kaboom');
  });

  it('updates state after dispatch', async () => {
    let t = new Date('2026-05-25T10:00:00.000Z').getTime();
    const orch = createOrchestrator({
      passes: [fakePass('a', {}, async () => makeResult('a'))],
      now: () => new Date(t),
    });
    t += 5 * 60_000;
    await orch.tick();
    const st = orch.getState('a');
    expect(st?.lastRunAt).toBeTruthy();
    expect(st?.lastResult?.passId).toBe('a');
  });
});

function makeResult(id: string): PassResult {
  return {
    passId: id,
    itemsProcessed: 1,
    itemsEmitted: 1,
    notes: 'ok',
    startedAt: '2026-05-25T10:00:00.000Z',
    completedAt: '2026-05-25T10:00:01.000Z',
    aborted: false,
    errored: false,
  };
}
