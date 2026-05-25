/**
 * Outbox worker tests.
 *
 * Validates that startOutboxWorker:
 *   - kicks off an immediate drain
 *   - schedules a recurring drain on the configured interval
 *   - absorbs processOutbox failures (logs but does not crash)
 *   - does nothing when enabled:false
 *   - stops cleanly on stopOutboxWorker
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';
import {
  startOutboxWorker,
  stopOutboxWorker,
  isOutboxWorkerRunning,
  type OutboxRunnerLike,
} from '../workers/outbox-worker';

function makeRunner(processed: number[] | Error): OutboxRunnerLike & { calls: number } {
  const runner = {
    calls: 0,
    async processOutbox() {
      runner.calls++;
      if (processed instanceof Error) throw processed;
      return processed[runner.calls - 1] ?? 0;
    },
  };
  return runner;
}

describe('outbox worker', () => {
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    stopOutboxWorker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopOutboxWorker();
    vi.useRealTimers();
  });

  it('kicks off an immediate drain on start', async () => {
    const runner = makeRunner([3]);
    startOutboxWorker(runner, { logger, intervalMs: 10_000, batchSize: 10 });
    // The immediate tick is void-returned, so wait a microtask cycle.
    await Promise.resolve();
    await Promise.resolve();
    expect(runner.calls).toBe(1);
    expect(isOutboxWorkerRunning()).toBe(true);
  });

  it('drains on every interval tick', async () => {
    const runner = makeRunner([1, 2, 3]);
    startOutboxWorker(runner, { logger, intervalMs: 1000, batchSize: 10 });
    await Promise.resolve();
    await Promise.resolve();
    expect(runner.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.calls).toBe(3);
  });

  it('is a no-op when enabled:false', async () => {
    const runner = makeRunner([1]);
    startOutboxWorker(runner, { logger, intervalMs: 100, enabled: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.calls).toBe(0);
    expect(isOutboxWorkerRunning()).toBe(false);
  });

  it('absorbs processOutbox failures without crashing', async () => {
    const runner = makeRunner(new Error('db unreachable'));
    // Must not throw synchronously
    expect(() =>
      startOutboxWorker(runner, { logger, intervalMs: 500, batchSize: 5 })
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(runner.calls).toBe(1);
    // Subsequent ticks keep firing even after the first one errored.
    await vi.advanceTimersByTimeAsync(500);
    expect(runner.calls).toBe(2);
  });

  it('stopOutboxWorker prevents further ticks', async () => {
    const runner = makeRunner([1, 2, 3, 4]);
    startOutboxWorker(runner, { logger, intervalMs: 100, batchSize: 5 });
    await Promise.resolve();
    await Promise.resolve();
    const before = runner.calls;
    stopOutboxWorker();
    await vi.advanceTimersByTimeAsync(500);
    expect(runner.calls).toBe(before);
    expect(isOutboxWorkerRunning()).toBe(false);
  });

  it('ignores duplicate start calls', async () => {
    const runner = makeRunner([1, 2]);
    startOutboxWorker(runner, { logger, intervalMs: 1000 });
    await Promise.resolve();
    const afterFirstStart = runner.calls;
    startOutboxWorker(runner, { logger, intervalMs: 1000 });
    await Promise.resolve();
    // Second start is a no-op — should not have triggered another immediate tick.
    expect(runner.calls).toBe(afterFirstStart);
  });
});
