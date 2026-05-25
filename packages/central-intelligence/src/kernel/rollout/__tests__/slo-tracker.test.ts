/**
 * SLO tracker — threshold breach + auto-rollback coverage.
 *
 * Drives the tracker with a fake clock so we can step through
 * windowed evaluations deterministically.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSloTracker,
  DEFAULT_SLO_THRESHOLDS,
  type InteractionEvent,
} from '../slo-tracker.js';

describe('createSloTracker', () => {
  let nowMs = 0;
  const advance = (deltaMs: number) => {
    nowMs += deltaMs;
  };

  beforeEach(() => {
    nowMs = 5 * 60 * 1000 * 1000; // start well past zero
  });

  function newTracker(
    overrides: Partial<Parameters<typeof createSloTracker>[0]> = {},
  ) {
    return createSloTracker({
      now: () => nowMs,
      windowMs: 5 * 60 * 1000,
      ...overrides,
    });
  }

  function emit(
    tracker: ReturnType<typeof createSloTracker>,
    overrides: Partial<InteractionEvent> = {},
  ) {
    const event: InteractionEvent = {
      capability: 'support',
      version: 'v1',
      outcome: 'completed',
      judgeScore: 0.9,
      costUsd: 0.01,
      timestampMs: nowMs,
      ...overrides,
    };
    tracker.record(event);
  }

  it('uses sane default thresholds documented in the design', () => {
    expect(DEFAULT_SLO_THRESHOLDS.completionRateMin).toBe(0.92);
    expect(DEFAULT_SLO_THRESHOLDS.escalationRateMax).toBe(0.1);
    expect(DEFAULT_SLO_THRESHOLDS.judgeScoreP50Min).toBe(0.75);
    expect(DEFAULT_SLO_THRESHOLDS.costMultiplierMax).toBe(1.2);
  });

  it('snapshot returns null for an unknown version', () => {
    const t = newTracker();
    expect(t.snapshot('cap', 'v_ghost')).toBeNull();
  });

  it('computes completion / escalation / judge / cost over the window', () => {
    const t = newTracker();
    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'completed', judgeScore: 0.8, costUsd: 0.02 });
    emit(t, { outcome: 'refused', judgeScore: 0.4, costUsd: 0.05 });
    const snap = t.snapshot('support', 'v1')!;
    expect(snap.interactions).toBe(11);
    expect(snap.completionRate).toBeGreaterThan(0.9);
    expect(snap.escalationRate).toBeGreaterThan(0);
    expect(snap.judgeScoreP50).toBeGreaterThan(0.5);
    expect(snap.costPerInteractionUsd).toBeGreaterThan(0);
  });

  it('does NOT rollback on a single window breach', () => {
    const t = newTracker();
    // Window 1: high escalation rate.
    for (let i = 0; i < 5; i += 1) emit(t, { outcome: 'refused' });
    for (let i = 0; i < 5; i += 1) emit(t, { outcome: 'completed' });
    advance(6 * 60 * 1000); // move into NEXT window so the breached one becomes "completed"
    const verdict = t.evaluate('support', 'v1');
    expect(verdict).not.toBeNull();
    expect(verdict!.breaches.length).toBeGreaterThan(0);
    expect(verdict!.shouldRollback).toBe(false);
    expect(verdict!.consecutiveBreachWindows).toBe(1);
  });

  it('rolls back after TWO consecutive window breaches', () => {
    const t = newTracker();
    // Window 1: breach
    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'refused' });
    advance(6 * 60 * 1000);
    const v1 = t.evaluate('support', 'v1');
    expect(v1!.shouldRollback).toBe(false);

    // Window 2: breach again
    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'refused' });
    advance(6 * 60 * 1000);
    const v2 = t.evaluate('support', 'v1');
    expect(v2!.shouldRollback).toBe(true);
    expect(v2!.consecutiveBreachWindows).toBeGreaterThanOrEqual(2);
  });

  it('healthy window resets the consecutive breach counter', () => {
    const t = newTracker();
    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'refused' });
    advance(6 * 60 * 1000);
    t.evaluate('support', 'v1');

    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'completed', judgeScore: 0.9 });
    advance(6 * 60 * 1000);
    const v = t.evaluate('support', 'v1');
    expect(v!.shouldRollback).toBe(false);
    expect(v!.consecutiveBreachWindows).toBe(0);
  });

  it('idle window does NOT count as a breach', () => {
    const t = newTracker();
    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'refused' });
    advance(6 * 60 * 1000);
    t.evaluate('support', 'v1');

    // No events in the next window.
    advance(6 * 60 * 1000);
    const v = t.evaluate('support', 'v1');
    expect(v!.consecutiveBreachWindows).toBe(1);
    expect(v!.shouldRollback).toBe(false);
  });

  it('flags cost breach when activeCostResolver returns a baseline', () => {
    const t = newTracker({
      activeCostResolver: () => 0.01,
    });
    // Same number of completed, judge above floor, but cost 3x above
    // the baseline → cost breach.
    for (let i = 0; i < 10; i += 1) emit(t, {
      outcome: 'completed',
      judgeScore: 0.9,
      costUsd: 0.05,
    });
    advance(6 * 60 * 1000);
    const v = t.evaluate('support', 'v1');
    const reasons = v!.breaches.map((b) => b.reason);
    expect(reasons).toContain('cost-per-interaction-above-threshold');
  });

  it('skips cost evaluation when no baseline is wired', () => {
    const t = newTracker(); // no activeCostResolver
    for (let i = 0; i < 10; i += 1) emit(t, { outcome: 'completed', judgeScore: 0.9, costUsd: 100 });
    advance(6 * 60 * 1000);
    const v = t.evaluate('support', 'v1');
    const reasons = v!.breaches.map((b) => b.reason);
    expect(reasons).not.toContain('cost-per-interaction-above-threshold');
  });

  it('flags judge-score breach when p50 drops below the floor', () => {
    const t = newTracker();
    // 9 completed but judge p50 of 0.2 — well below 0.75
    for (let i = 0; i < 9; i += 1) emit(t, { outcome: 'completed', judgeScore: 0.2 });
    advance(6 * 60 * 1000);
    const v = t.evaluate('support', 'v1');
    const reasons = v!.breaches.map((b) => b.reason);
    expect(reasons).toContain('judge-score-p50-below-threshold');
  });

  it('reset() per-version clears just that version', () => {
    const t = newTracker();
    emit(t, { version: 'v1' });
    emit(t, { version: 'v2' });
    t.reset('support', 'v1');
    expect(t.snapshot('support', 'v1')).toBeNull();
    expect(t.snapshot('support', 'v2')).not.toBeNull();
  });

  it('reset() with no args clears everything', () => {
    const t = newTracker();
    emit(t, { version: 'v1' });
    emit(t, { version: 'v2' });
    t.reset();
    expect(t.snapshot('support', 'v1')).toBeNull();
    expect(t.snapshot('support', 'v2')).toBeNull();
  });

  it('refuses to record an event without capability/version', () => {
    const t = newTracker();
    emit(t, { capability: '' });
    expect(t.snapshot('', 'v1')).toBeNull();
  });
});
