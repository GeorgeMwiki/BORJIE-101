import { describe, it, expect } from 'vitest';
import { detectDrift, dedupeDriftSignals } from '../drift-detector.js';
import { makeMission, makeStep, FROZEN_NOW_ISO } from './_fixtures.js';

describe('drift-detector — detectDrift', () => {
  it('emits no signals for a fresh mission with pending steps inside its window', () => {
    const mission = makeMission({
      expectedCompletionDate: '2099-12-31',
      budgetMinorUnits: 5_000_000,
      spentMinorUnits: 100,
      status: 'active',
    });
    const steps = [makeStep({ id: 'mst-1', ordinal: 0 })];
    const signals = detectDrift({ mission, steps, nowIso: FROZEN_NOW_ISO });
    expect(signals).toEqual([]);
  });

  it('emits deadline_slip when expectedCompletionDate is past and steps remain', () => {
    const mission = makeMission({
      expectedCompletionDate: '2020-01-01',
      status: 'active',
    });
    const steps = [makeStep({ status: 'pending' })];
    const signals = detectDrift({ mission, steps, nowIso: FROZEN_NOW_ISO });
    expect(signals.some((s) => s.kind === 'deadline_slip')).toBe(true);
  });

  it('does NOT emit deadline_slip when all steps are terminal', () => {
    const mission = makeMission({
      expectedCompletionDate: '2020-01-01',
      status: 'active',
    });
    const steps = [makeStep({ status: 'completed' })];
    const signals = detectDrift({ mission, steps, nowIso: FROZEN_NOW_ISO });
    expect(signals.some((s) => s.kind === 'deadline_slip')).toBe(false);
  });

  it('emits budget_overrun when spent > budget', () => {
    const mission = makeMission({
      budgetMinorUnits: 1000,
      spentMinorUnits: 2000,
    });
    const signals = detectDrift({ mission, steps: [], nowIso: FROZEN_NOW_ISO });
    expect(signals.find((s) => s.kind === 'budget_overrun')).toBeTruthy();
  });

  it('emits step_replan when a step has 3+ attempts and is still pending', () => {
    const mission = makeMission();
    const steps = [
      makeStep({ id: 'stuck-1', attempts: 5, status: 'in_progress' }),
      makeStep({ id: 'ok-1', ordinal: 1, attempts: 0, status: 'pending' }),
    ];
    const signals = detectDrift({ mission, steps, nowIso: FROZEN_NOW_ISO });
    const replan = signals.find((s) => s.kind === 'step_replan');
    expect(replan).toBeTruthy();
    expect(replan?.details['stepId']).toBe('stuck-1');
  });

  it('emits external_blocker for blocked steps', () => {
    const mission = makeMission();
    const steps = [makeStep({ id: 'blk-1', status: 'blocked' })];
    const signals = detectDrift({ mission, steps, nowIso: FROZEN_NOW_ISO });
    expect(signals.find((s) => s.kind === 'external_blocker')).toBeTruthy();
  });

  it('emits no drift when mission is already completed', () => {
    const mission = makeMission({
      expectedCompletionDate: '2020-01-01',
      status: 'completed',
    });
    const steps = [makeStep({ status: 'completed' })];
    const signals = detectDrift({ mission, steps, nowIso: FROZEN_NOW_ISO });
    expect(signals).toEqual([]);
  });

  it('returns empty when there is no budget', () => {
    const mission = makeMission({
      budgetMinorUnits: null,
      spentMinorUnits: 1_000_000,
    });
    const signals = detectDrift({ mission, steps: [], nowIso: FROZEN_NOW_ISO });
    expect(signals.find((s) => s.kind === 'budget_overrun')).toBeUndefined();
  });
});

describe('drift-detector — dedupeDriftSignals', () => {
  it('collapses identical (kind, stepId) signals keeping latest observedAt', () => {
    const result = dedupeDriftSignals([
      {
        kind: 'step_replan',
        message: 'old',
        observedAt: '2026-05-21T00:00:00.000Z',
        details: { stepId: 'mst-1' },
      },
      {
        kind: 'step_replan',
        message: 'newer',
        observedAt: '2026-05-22T00:00:00.000Z',
        details: { stepId: 'mst-1' },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe('newer');
  });

  it('keeps different kinds separately', () => {
    const result = dedupeDriftSignals([
      { kind: 'deadline_slip', message: 'a', observedAt: '2026-05-22T00:00:00.000Z', details: {} },
      { kind: 'budget_overrun', message: 'b', observedAt: '2026-05-22T00:00:00.000Z', details: {} },
    ]);
    expect(result).toHaveLength(2);
  });
});
