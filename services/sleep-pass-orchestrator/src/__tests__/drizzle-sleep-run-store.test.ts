/**
 * Tests for the Drizzle-backed SleepRunStore adapter (LP-21a).
 *
 * The adapter is parameterised over an injected `SleepRunDbClient`, so these
 * tests use a hand-rolled fake client + a capturing logger. Coverage:
 *   - happy path delegates to the client methods.
 *   - single-flight: a fresh running row → beginRun returns null.
 *   - stale-row rescue: an old running row is reaped, fresh row inserted.
 *   - resilience: a throwing client never propagates — beginRun → null,
 *     recordEmissions/finalizeRun no-op, lastRunAt → null; logger sees it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDrizzleSleepRunStore,
  type SleepRunDbClient,
  type SleepRunDbRow,
  type SleepRunStoreLogger,
} from '../drizzle-sleep-run-store.js';
import type { SleepRunFinalize } from '../types.js';

function fakeLogger(): SleepRunStoreLogger & {
  warns: Array<string>;
  errors: Array<string>;
} {
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    warn: (m) => warns.push(m),
    error: (m) => errors.push(m),
    warns,
    errors,
  };
}

function happyClient(over: Partial<SleepRunDbClient> = {}): SleepRunDbClient {
  return {
    findRunningRun: vi.fn(async () => null as SleepRunDbRow | null),
    reapStuckRun: vi.fn(async () => {}),
    insertRunningRun: vi.fn(async () => 'uuid-1'),
    insertEmissions: vi.fn(async () => {}),
    updateRun: vi.fn(async () => {}),
    latestStartedAt: vi.fn(async () => null as string | null),
    ...over,
  };
}

const FINAL: SleepRunFinalize = {
  status: 'done',
  itemsProcessed: 3,
  itemsEmitted: 1,
  durationMs: 42,
  notes: 'ok',
};

describe('createDrizzleSleepRunStore — happy path', () => {
  it('inserts a running row and finalizes it', async () => {
    const client = happyClient();
    const store = createDrizzleSleepRunStore({ client, logger: fakeLogger() });

    const runId = await store.beginRun('p1');
    expect(runId).toBe('uuid-1');
    expect(client.insertRunningRun).toHaveBeenCalledWith('p1');

    await store.recordEmissions(runId, [{ kind: 'lesson', payload: { a: 1 } }]);
    expect(client.insertEmissions).toHaveBeenCalledWith('uuid-1', [
      { kind: 'lesson', payload: { a: 1 } },
    ]);

    await store.finalizeRun(runId, FINAL);
    expect(client.updateRun).toHaveBeenCalledWith('uuid-1', FINAL);
  });

  it('no-ops emissions/finalize when runId is null', async () => {
    const client = happyClient();
    const store = createDrizzleSleepRunStore({ client, logger: fakeLogger() });
    await store.recordEmissions(null, [{ kind: 'x', payload: 1 }]);
    await store.finalizeRun(null, FINAL);
    expect(client.insertEmissions).not.toHaveBeenCalled();
    expect(client.updateRun).not.toHaveBeenCalled();
  });
});

describe('createDrizzleSleepRunStore — single-flight + rescue', () => {
  it('returns null when a fresh running row exists', async () => {
    const now = 10_000;
    const client = happyClient({
      findRunningRun: vi.fn(async () => ({
        id: 'old',
        status: 'running',
        startedAt: new Date(now - 1_000).toISOString(), // 1s old, fresh
      })),
    });
    const logger = fakeLogger();
    const store = createDrizzleSleepRunStore({
      client,
      logger,
      rescueAgeMs: 60_000,
      nowMs: () => now,
    });

    const runId = await store.beginRun('p1');
    expect(runId).toBeNull();
    expect(client.insertRunningRun).not.toHaveBeenCalled();
    expect(logger.warns.some((w) => w.includes('concurrent run'))).toBe(true);
  });

  it('reaps a stale running row and inserts a fresh one', async () => {
    const now = 10_000_000;
    const client = happyClient({
      findRunningRun: vi.fn(async () => ({
        id: 'stale',
        status: 'running',
        startedAt: new Date(now - 60 * 60 * 1000).toISOString(), // 1h old
      })),
    });
    const store = createDrizzleSleepRunStore({
      client,
      logger: fakeLogger(),
      rescueAgeMs: 30 * 60 * 1000,
      nowMs: () => now,
    });

    const runId = await store.beginRun('p1');
    expect(runId).toBe('uuid-1');
    expect(client.reapStuckRun).toHaveBeenCalledTimes(1);
    expect(client.insertRunningRun).toHaveBeenCalledWith('p1');
  });
});

describe('createDrizzleSleepRunStore — resilience', () => {
  it('swallows a throwing client across all methods', async () => {
    const boom = () => Promise.reject(new Error('db down'));
    const client: SleepRunDbClient = {
      findRunningRun: vi.fn(boom),
      reapStuckRun: vi.fn(boom),
      insertRunningRun: vi.fn(boom),
      insertEmissions: vi.fn(boom),
      updateRun: vi.fn(boom),
      latestStartedAt: vi.fn(boom),
    };
    const logger = fakeLogger();
    const store = createDrizzleSleepRunStore({ client, logger });

    await expect(store.beginRun('p1')).resolves.toBeNull();
    await expect(
      store.recordEmissions('uuid-1', [{ kind: 'x', payload: 1 }]),
    ).resolves.toBeUndefined();
    await expect(store.finalizeRun('uuid-1', FINAL)).resolves.toBeUndefined();
    await expect(store.lastRunAt('p1')).resolves.toBeNull();
    // Each failure was logged (never thrown).
    expect(logger.errors.length).toBeGreaterThanOrEqual(3);
  });
});
