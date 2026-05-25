/**
 * inFlight watchdog tests (DA2 fix).
 *
 * Verifies that a wedged tick is force-reset after `2 × intervalMs` so
 * a hung Postgres call cannot silently stop the processor forever.
 *
 *   - happy path: a normal tick flips `inFlight` true then false and
 *     leaves `tickStartedAt = null`.
 *   - skip path: a second tick fired while a healthy first tick is
 *     still in flight (within the watchdog window) is a no-op.
 *   - watchdog path: a tick fired after `3 × intervalMs` while the
 *     previous tick is still flagged in-flight force-resets the latch,
 *     emits a structured `warn`, and proceeds to drain.
 */

import { describe, it, expect } from 'vitest';
import {
  createTick,
  WATCHDOG_MULTIPLIER,
  type ProcessorLogger,
  type TickState,
} from '../index';

interface LogCall {
  readonly level: 'info' | 'warn' | 'error';
  readonly obj: Record<string, unknown>;
  readonly msg?: string;
}

function captureLogger(): { log: ProcessorLogger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    log: {
      info: (obj, msg) => calls.push({ level: 'info', obj, msg }),
      warn: (obj, msg) => calls.push({ level: 'warn', obj, msg }),
      error: (obj, msg) => calls.push({ level: 'error', obj, msg }),
    },
  };
}

function fakeBus(processOutbox: (n: number) => Promise<number>) {
  return { processOutbox };
}

describe('createTick — inFlight watchdog (DA2)', () => {
  it('happy path: drains and clears inFlight + tickStartedAt', async () => {
    const state: TickState = { inFlight: false, tickStartedAt: null };
    const { log, calls } = captureLogger();
    let nowMs = 1_000_000;
    const tick = createTick({
      bus: fakeBus(async () => 3),
      batchSize: 50,
      intervalMs: 5_000,
      state,
      log,
      stopping: () => false,
      now: () => nowMs,
    });

    await tick();

    expect(state.inFlight).toBe(false);
    expect(state.tickStartedAt).toBeNull();
    expect(calls.find((c) => c.msg === 'outbox drained')).toBeDefined();
    expect(calls.find((c) => c.level === 'warn')).toBeUndefined();
  });

  it('skip path: concurrent tick within the watchdog window is a no-op', async () => {
    const state: TickState = { inFlight: false, tickStartedAt: null };
    const { log, calls } = captureLogger();
    const intervalMs = 5_000;
    let nowMs = 1_000_000;

    // Latch a healthy in-flight tick at t=0.
    state.inFlight = true;
    state.tickStartedAt = new Date(nowMs);

    let processed = 0;
    const tick = createTick({
      bus: fakeBus(async () => {
        processed += 1;
        return 0;
      }),
      batchSize: 50,
      intervalMs,
      state,
      log,
      stopping: () => false,
      now: () => nowMs,
    });

    // Advance only 1× interval — still within the 2× watchdog window.
    nowMs += intervalMs;
    await tick();

    // Watchdog must NOT fire and the bus must NOT be called.
    expect(processed).toBe(0);
    expect(state.inFlight).toBe(true);
    expect(state.tickStartedAt).not.toBeNull();
    expect(calls.find((c) => c.level === 'warn')).toBeUndefined();
  });

  it('watchdog path: force-resets a hung tick after 3× interval, warns, drains', async () => {
    const state: TickState = { inFlight: false, tickStartedAt: null };
    const { log, calls } = captureLogger();
    const intervalMs = 5_000;
    let nowMs = 1_000_000;

    // Simulate a previous tick that hung — latch never cleared.
    const hungStart = new Date(nowMs);
    state.inFlight = true;
    state.tickStartedAt = hungStart;

    let processedBatches = 0;
    const tick = createTick({
      bus: fakeBus(async () => {
        processedBatches += 1;
        return 7;
      }),
      batchSize: 50,
      intervalMs,
      state,
      log,
      stopping: () => false,
      now: () => nowMs,
    });

    // Advance time by 3× interval — past the 2× watchdog threshold.
    nowMs += 3 * intervalMs;
    await tick();

    // Watchdog must have fired exactly once.
    const warnCall = calls.find((c) => c.level === 'warn');
    expect(warnCall).toBeDefined();
    expect(warnCall?.msg).toContain('watchdog');
    expect(warnCall?.obj.elapsedMs).toBe(3 * intervalMs);
    expect(warnCall?.obj.thresholdMs).toBe(WATCHDOG_MULTIPLIER * intervalMs);
    expect(warnCall?.obj.tickStartedAt).toBe(hungStart.toISOString());

    // After watchdog, the new tick must have run to completion.
    expect(processedBatches).toBe(1);
    expect(state.inFlight).toBe(false);
    expect(state.tickStartedAt).toBeNull();
  });

  it('does not run when stopping() returns true', async () => {
    const state: TickState = { inFlight: false, tickStartedAt: null };
    const { log } = captureLogger();
    let processed = 0;
    const tick = createTick({
      bus: fakeBus(async () => {
        processed += 1;
        return 0;
      }),
      batchSize: 50,
      intervalMs: 5_000,
      state,
      log,
      stopping: () => true,
      now: () => 1_000_000,
    });

    await tick();

    expect(processed).toBe(0);
    expect(state.inFlight).toBe(false);
  });

  it('clears latch even when processOutbox throws', async () => {
    const state: TickState = { inFlight: false, tickStartedAt: null };
    const { log, calls } = captureLogger();
    const tick = createTick({
      bus: fakeBus(async () => {
        throw new Error('boom');
      }),
      batchSize: 50,
      intervalMs: 5_000,
      state,
      log,
      stopping: () => false,
      now: () => 1_000_000,
    });

    await tick();

    expect(state.inFlight).toBe(false);
    expect(state.tickStartedAt).toBeNull();
    expect(calls.find((c) => c.level === 'error')?.msg).toBe(
      'outbox drain failed',
    );
  });
});
