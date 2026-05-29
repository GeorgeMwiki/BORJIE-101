/**
 * worker-heartbeat tests — G6 robustness-audit closure (2026-05-29).
 *
 * Pins the contract that the heartbeat registry:
 *   1. Tracks lastTickAt + tickCount per registered worker.
 *   2. Auto-registers heartbeats from workers that forgot the explicit
 *      registerWorker call (defensive — better to surface late than
 *      stay invisible).
 *   3. Flags a worker as `stuck` when msSinceLastTick > 2 × intervalMs.
 *   4. Flags an unregistered-but-late worker as `stuck` when the
 *      grace window since registration has elapsed without any tick.
 *   5. Records lastError on failure heartbeats so /health/deep can
 *      distinguish "ticking but failing" from "stuck".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
  snapshotWorkers,
  __resetWorkerHeartbeatRegistry,
} from '../worker-heartbeat';

describe('worker-heartbeat', () => {
  beforeEach(() => {
    __resetWorkerHeartbeatRegistry();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a worker and shows it as never-ticked', () => {
    registerWorker({ name: 'outcome-reconciliation', intervalMs: 1_000 });
    const snap = snapshotWorkers();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.name).toBe('outcome-reconciliation');
    expect(snap[0]!.lastTickAt).toBeNull();
    expect(snap[0]!.tickCount).toBe(0);
    expect(snap[0]!.msSinceLastTick).toBeNull();
    expect(snap[0]!.stuck).toBe(false); // grace until first tick window
  });

  it('records lastTickAt and tickCount on a successful tick', () => {
    registerWorker({ name: 'daily-brief-cron', intervalMs: 1_000 });
    workerHeartbeat('daily-brief-cron');
    workerHeartbeat('daily-brief-cron');
    workerHeartbeat('daily-brief-cron');
    const snap = snapshotWorkers();
    expect(snap[0]!.tickCount).toBe(3);
    expect(snap[0]!.lastTickAt).toBe('2026-05-29T12:00:00.000Z');
    expect(snap[0]!.msSinceLastTick).toBe(0);
    expect(snap[0]!.stuck).toBe(false);
  });

  it('flags a worker as stuck after 2 × intervalMs without a tick', () => {
    registerWorker({ name: 'fx-feed-cron', intervalMs: 10_000 });
    workerHeartbeat('fx-feed-cron');
    // Advance >2× interval without another tick.
    vi.advanceTimersByTime(25_000);
    const snap = snapshotWorkers();
    expect(snap[0]!.stuck).toBe(true);
    expect(snap[0]!.msSinceLastTick).toBe(25_000);
  });

  it('does NOT flag a worker as stuck within 2 × intervalMs', () => {
    registerWorker({ name: 'reminders-dispatch', intervalMs: 10_000 });
    workerHeartbeat('reminders-dispatch');
    vi.advanceTimersByTime(15_000); // < 20_000 (2x)
    expect(snapshotWorkers()[0]!.stuck).toBe(false);
  });

  it('flags a never-ticked worker as stuck only after the boot grace window', () => {
    registerWorker({ name: 'ica-cert-expiry-cron', intervalMs: 5_000 });
    // 1× interval — still in grace, not stuck.
    vi.advanceTimersByTime(5_000);
    expect(snapshotWorkers()[0]!.stuck).toBe(false);
    // 2× + interval — past grace, stuck.
    vi.advanceTimersByTime(6_000);
    expect(snapshotWorkers()[0]!.stuck).toBe(true);
  });

  it('auto-registers a worker that ticks without prior registration', () => {
    workerHeartbeat('forgot-to-register');
    const snap = snapshotWorkers();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.name).toBe('forgot-to-register');
    expect(snap[0]!.tickCount).toBe(1);
    expect(snap[0]!.intervalMs).toBe(60_000); // default
  });

  it('records lastError on failure and bumps tickCount', () => {
    registerWorker({ name: 'entity-indexer', intervalMs: 1_000 });
    workerHeartbeatFailure('entity-indexer', new Error('upstream timeout'));
    const snap = snapshotWorkers();
    expect(snap[0]!.tickCount).toBe(1);
    expect(snap[0]!.lastError).toBe('upstream timeout');
    // Ticking + failing is NOT stuck — the worker is alive.
    expect(snap[0]!.stuck).toBe(false);
  });

  it('clears lastError on a subsequent successful heartbeat', () => {
    registerWorker({ name: 'decision-retrospective', intervalMs: 1_000 });
    workerHeartbeatFailure('decision-retrospective', new Error('fail'));
    workerHeartbeat('decision-retrospective');
    expect(snapshotWorkers()[0]!.lastError).toBeNull();
  });

  it('re-registering with a new intervalMs updates the interval', () => {
    registerWorker({ name: 'fx-feed-cron', intervalMs: 1_000 });
    registerWorker({ name: 'fx-feed-cron', intervalMs: 5_000 });
    expect(snapshotWorkers()[0]!.intervalMs).toBe(5_000);
  });

  it('snapshots all registered workers in one call', () => {
    registerWorker({ name: 'a', intervalMs: 1 });
    registerWorker({ name: 'b', intervalMs: 2 });
    registerWorker({ name: 'c', intervalMs: 3 });
    const snap = snapshotWorkers();
    const names = snap.map((s) => s.name).sort();
    expect(names).toEqual(['a', 'b', 'c']);
  });
});
