/**
 * Tests for `createSessionReplayRetention` — periodic supervisor that
 * purges `session_replay_chunks` rows + cold-store blobs older than
 * the configured retention window.
 *
 * Coverage:
 *   1. Happy path: expired rows → DB rows deleted, storage blobs deleted,
 *      bytes purged tallied.
 *   2. No expired rows → no-op result.
 *   3. Storage adapter missing → DB-only purge proceeds, single warn emitted.
 *   4. Storage partial failure → storageFailures counted, DB still purged.
 *   5. listExpired throws → swallowed, empty result, warn emitted.
 *   6. deleteByIds throws → swallowed, storage stats preserved.
 *   7. `retentionDays` config respected (cutoff date is `now - days * 86400000`).
 *   8. `intervalMs` throttling: `.start()` schedules at the configured cadence;
 *      `.stop()` clears the interval.
 *   9. `.start()` is idempotent.
 *  10. `.stop()` is idempotent.
 *  11. `.stop()` mid-tick: in-flight tick resolves successfully.
 *  12. Overlapping ticks: second concurrent invocation short-circuits.
 *  13. Bad input → throws on missing db.
 *  14. ExpiredChunkRef with non-finite byteSize → ignored (0 added to total).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSessionReplayRetention,
  type ExpiredChunkRef,
  type SessionReplayPurgeDb,
  type SessionReplayPurgeStorage,
} from '../session-replay-retention.js';

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function fakeStorage(): SessionReplayPurgeStorage & {
  readonly deleted: string[];
  failOn(uri: string): void;
} {
  const deleted: string[] = [];
  const failures = new Set<string>();
  return {
    deleted,
    failOn(uri: string) {
      failures.add(uri);
    },
    async delete(uri: string) {
      if (failures.has(uri)) {
        throw new Error(`fake storage failure for ${uri}`);
      }
      deleted.push(uri);
    },
  };
}

function fakeDb(
  expired: ReadonlyArray<ExpiredChunkRef>,
): SessionReplayPurgeDb & {
  readonly listCalls: Array<{ cutoffIso: string; limit: number }>;
  readonly deleteCalls: Array<ReadonlyArray<string>>;
} {
  const listCalls: Array<{ cutoffIso: string; limit: number }> = [];
  const deleteCalls: Array<ReadonlyArray<string>> = [];
  return {
    listCalls,
    deleteCalls,
    async listExpired(args) {
      listCalls.push(args);
      return expired;
    },
    async deleteByIds(ids) {
      deleteCalls.push(ids);
      return ids.length;
    },
  };
}

function ref(id: string, byteSize = 100): ExpiredChunkRef {
  return { id, storageUri: `file:///tmp/${id}.gz`, byteSize };
}

describe('createSessionReplayRetention', () => {
  it('purges DB rows + storage blobs on the happy path', async () => {
    const db = fakeDb([ref('c-1', 100), ref('c-2', 200), ref('c-3', 300)]);
    const storage = fakeStorage();
    const supervisor = createSessionReplayRetention({
      db,
      storage,
      now: () => NOW,
    });
    const result = await supervisor.tick();
    expect(result.rowsDeleted).toBe(3);
    expect(result.bytesPurged).toBe(600);
    expect(result.storageDeletes).toBe(3);
    expect(result.storageFailures).toBe(0);
    expect(storage.deleted).toEqual([
      'file:///tmp/c-1.gz',
      'file:///tmp/c-2.gz',
      'file:///tmp/c-3.gz',
    ]);
    expect(db.deleteCalls).toEqual([['c-1', 'c-2', 'c-3']]);
  });

  it('returns the empty result when there is nothing to purge', async () => {
    const db = fakeDb([]);
    const storage = fakeStorage();
    const supervisor = createSessionReplayRetention({
      db,
      storage,
      now: () => NOW,
    });
    const result = await supervisor.tick();
    expect(result).toEqual({
      rowsDeleted: 0,
      bytesPurged: 0,
      storageDeletes: 0,
      storageFailures: 0,
    });
    expect(db.deleteCalls).toHaveLength(0);
  });

  it('falls back to DB-only purge when no storage adapter is provided', async () => {
    const db = fakeDb([ref('c-1', 50)]);
    const warn = vi.fn();
    const supervisor = createSessionReplayRetention({
      db,
      storage: null,
      now: () => NOW,
      logger: { warn },
    });
    const result = await supervisor.tick();
    expect(result.rowsDeleted).toBe(1);
    expect(result.bytesPurged).toBe(50);
    expect(result.storageDeletes).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject({
      limitation: 'storage-port-missing-delete-method',
    });
  });

  it('counts storage failures without aborting the DB purge', async () => {
    const db = fakeDb([ref('c-1'), ref('c-2'), ref('c-3')]);
    const storage = fakeStorage();
    storage.failOn('file:///tmp/c-2.gz');
    const warn = vi.fn();
    const supervisor = createSessionReplayRetention({
      db,
      storage,
      now: () => NOW,
      logger: { warn },
    });
    const result = await supervisor.tick();
    expect(result.rowsDeleted).toBe(3);
    expect(result.storageDeletes).toBe(2);
    expect(result.storageFailures).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('swallows listExpired failures and emits a warn', async () => {
    const warn = vi.fn();
    const db: SessionReplayPurgeDb = {
      async listExpired() {
        throw new Error('boom');
      },
      async deleteByIds() {
        return 0;
      },
    };
    const supervisor = createSessionReplayRetention({
      db,
      storage: fakeStorage(),
      now: () => NOW,
      logger: { warn },
    });
    const result = await supervisor.tick();
    expect(result.rowsDeleted).toBe(0);
    expect(result.bytesPurged).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject({
      worker: 'session-replay-retention',
    });
  });

  it('preserves storage stats when deleteByIds throws', async () => {
    const warn = vi.fn();
    const storage = fakeStorage();
    const db: SessionReplayPurgeDb = {
      async listExpired() {
        return [ref('c-1'), ref('c-2')];
      },
      async deleteByIds() {
        throw new Error('db gone');
      },
    };
    const supervisor = createSessionReplayRetention({
      db,
      storage,
      now: () => NOW,
      logger: { warn },
    });
    const result = await supervisor.tick();
    expect(result.rowsDeleted).toBe(0);
    expect(result.bytesPurged).toBe(0);
    expect(result.storageDeletes).toBe(2);
    expect(warn).toHaveBeenCalled();
  });

  it('respects retentionDays when computing the cutoff', async () => {
    const db = fakeDb([]);
    const supervisor = createSessionReplayRetention({
      db,
      now: () => NOW,
      retentionDays: 30,
    });
    await supervisor.tick();
    expect(db.listCalls).toHaveLength(1);
    const expectedCutoffMs = NOW - 30 * MS_PER_DAY;
    expect(db.listCalls[0]!.cutoffIso).toBe(
      new Date(expectedCutoffMs).toISOString(),
    );
  });

  it('defaults retentionDays to 90 when not configured', async () => {
    const db = fakeDb([]);
    const supervisor = createSessionReplayRetention({
      db,
      now: () => NOW,
    });
    await supervisor.tick();
    const expectedCutoffMs = NOW - 90 * MS_PER_DAY;
    expect(db.listCalls[0]!.cutoffIso).toBe(
      new Date(expectedCutoffMs).toISOString(),
    );
  });

  describe('start()/stop() lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('start() schedules ticks at intervalMs', async () => {
      const db = fakeDb([]);
      const supervisor = createSessionReplayRetention({
        db,
        intervalMs: 1_000,
        now: () => NOW,
      });
      supervisor.start();
      // Initial setInterval does not invoke immediately — advance once.
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(db.listCalls.length).toBeGreaterThanOrEqual(2);
      supervisor.stop();
    });

    it('start() is idempotent', async () => {
      const db = fakeDb([]);
      const supervisor = createSessionReplayRetention({
        db,
        intervalMs: 1_000,
        now: () => NOW,
      });
      supervisor.start();
      supervisor.start();
      await vi.advanceTimersByTimeAsync(1_000);
      // A single timer scheduled ⇒ one tick per interval.
      expect(db.listCalls.length).toBe(1);
      supervisor.stop();
    });

    it('stop() clears the interval and is idempotent', async () => {
      const db = fakeDb([]);
      const supervisor = createSessionReplayRetention({
        db,
        intervalMs: 1_000,
        now: () => NOW,
      });
      supervisor.start();
      supervisor.stop();
      supervisor.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(db.listCalls.length).toBe(0);
    });

    it('stop() mid-tick lets the in-flight tick resolve', async () => {
      let resolveList: (refs: ReadonlyArray<ExpiredChunkRef>) => void = () => {};
      const db: SessionReplayPurgeDb = {
        listExpired: () =>
          new Promise<ReadonlyArray<ExpiredChunkRef>>((r) => {
            resolveList = r;
          }),
        async deleteByIds() {
          return 0;
        },
      };
      const supervisor = createSessionReplayRetention({
        db,
        intervalMs: 1_000,
        now: () => NOW,
      });
      const ticking = supervisor.tick();
      supervisor.stop();
      resolveList([]);
      const result = await ticking;
      expect(result.rowsDeleted).toBe(0);
    });
  });

  it('overlapping tick() invocations short-circuit', async () => {
    let resolveList: (refs: ReadonlyArray<ExpiredChunkRef>) => void = () => {};
    const db: SessionReplayPurgeDb = {
      listExpired: vi.fn(
        () =>
          new Promise<ReadonlyArray<ExpiredChunkRef>>((r) => {
            resolveList = r;
          }),
      ),
      async deleteByIds() {
        return 0;
      },
    };
    const supervisor = createSessionReplayRetention({
      db,
      now: () => NOW,
    });
    const first = supervisor.tick();
    const second = await supervisor.tick();
    expect(second.rowsDeleted).toBe(0);
    expect(db.listExpired).toHaveBeenCalledTimes(1);
    resolveList([]);
    await first;
  });

  it('throws when db is missing', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createSessionReplayRetention({ db: undefined as any }),
    ).toThrow(/db is required/);
  });

  it('treats non-finite byteSize as 0 in the bytes tally', async () => {
    const db = fakeDb([
      { id: 'c-1', storageUri: 'file:///tmp/c-1.gz', byteSize: NaN },
      { id: 'c-2', storageUri: 'file:///tmp/c-2.gz', byteSize: 250 },
    ]);
    const supervisor = createSessionReplayRetention({
      db,
      storage: fakeStorage(),
      now: () => NOW,
    });
    const result = await supervisor.tick();
    expect(result.bytesPurged).toBe(250);
    expect(result.rowsDeleted).toBe(2);
  });
});
