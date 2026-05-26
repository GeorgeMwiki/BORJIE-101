/**
 * Tests for the cadence selector (spec §4).
 */

import { describe, it, expect } from 'vitest';

import { createTickScheduler } from '../scheduler/tick-scheduler.js';
import { DEFAULT_CADENCE_MS } from '../types.js';
import type { WorkCycleState } from '../types.js';

function state(partial: Partial<WorkCycleState>): WorkCycleState {
  return {
    tenant_id: 'tenant-1',
    last_tick_no: 0n,
    last_tick_at: null,
    current_mode: 'idle',
    pending_threads: [],
    ...partial,
  };
}

describe('tick-scheduler / cadence', () => {
  it('returns now() when last_tick_at is null', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({ now: () => fixed });
    const due = scheduler.nextDueAt(state({ last_tick_at: null }));
    expect(due).toBe(fixed.toISOString());
  });

  it('schedules next tick at last_tick_at + interval (active = 30 s)', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({ now: () => fixed });
    const last = '2026-05-26T09:59:30.000Z'; // 30s ago
    const due = scheduler.nextDueAt(
      state({ last_tick_at: last, current_mode: 'active' }),
    );
    expect(due).toBe('2026-05-26T10:00:00.000Z');
  });

  it('schedules next tick at last_tick_at + interval (idle = 5 min)', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({ now: () => fixed });
    const last = '2026-05-26T09:55:00.000Z';
    const due = scheduler.nextDueAt(
      state({ last_tick_at: last, current_mode: 'idle' }),
    );
    expect(due).toBe('2026-05-26T10:00:00.000Z');
  });

  it('schedules night cadence at 15 min', () => {
    const last = '2026-05-26T02:00:00.000Z';
    const scheduler = createTickScheduler();
    const due = scheduler.nextDueAt(
      state({ last_tick_at: last, current_mode: 'night' }),
    );
    expect(due).toBe('2026-05-26T02:15:00.000Z');
  });

  it('schedules observe cadence at 60 min', () => {
    const last = '2026-05-26T02:00:00.000Z';
    const scheduler = createTickScheduler();
    const due = scheduler.nextDueAt(
      state({ last_tick_at: last, current_mode: 'observe' }),
    );
    expect(due).toBe('2026-05-26T03:00:00.000Z');
  });

  it('msUntilNextTick clamps at 0 when due in the past', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({ now: () => fixed });
    const last = '2026-05-26T08:00:00.000Z'; // 2h ago
    const ms = scheduler.msUntilNextTick(
      state({ last_tick_at: last, current_mode: 'night' }),
    );
    expect(ms).toBe(0);
  });

  it('isOverdue returns true past 2x interval', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({ now: () => fixed });
    // night interval = 15 min; 2x = 30 min; last tick 31 min ago = overdue
    const last = '2026-05-26T09:29:00.000Z';
    expect(
      scheduler.isOverdue(state({ last_tick_at: last, current_mode: 'night' })),
    ).toBe(true);
  });

  it('isOverdue returns false within 2x interval', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({ now: () => fixed });
    const last = '2026-05-26T09:45:00.000Z';
    expect(
      scheduler.isOverdue(state({ last_tick_at: last, current_mode: 'night' })),
    ).toBe(false);
  });

  it('respects per-tenant cadence override', () => {
    const fixed = new Date('2026-05-26T10:00:00.000Z');
    const scheduler = createTickScheduler({
      now: () => fixed,
      cadenceMs: { ...DEFAULT_CADENCE_MS, night: 10 * 60_000 }, // 10 min
    });
    const last = '2026-05-26T09:50:00.000Z';
    const due = scheduler.nextDueAt(
      state({ last_tick_at: last, current_mode: 'night' }),
    );
    expect(due).toBe('2026-05-26T10:00:00.000Z');
  });

  it('intervalMsFor returns the default cadence for each mode', () => {
    const scheduler = createTickScheduler();
    expect(scheduler.intervalMsFor('active')).toBe(30_000);
    expect(scheduler.intervalMsFor('idle')).toBe(5 * 60_000);
    expect(scheduler.intervalMsFor('night')).toBe(15 * 60_000);
    expect(scheduler.intervalMsFor('observe')).toBe(60 * 60_000);
  });
});
