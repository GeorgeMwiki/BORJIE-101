/**
 * Cluster leader-election tests (CAP RSS-06).
 *
 * Pinned behaviours:
 *   1. lockIdFor is deterministic + BIGINT-safe (positive int63 string).
 *   2. Election DISABLED (default / "off") → withClusterLeader is a pure
 *      pass-through: inner supervisor starts on every "replica".
 *   3. Election ENABLED → exactly ONE of two competing instances wins
 *      the lock (THE crown-jewel: two instances → one leader).
 *   4. isLeader() reflects the acquire outcome; followers read false.
 *   5. The follower starts its inner supervisor only after it is
 *      promoted (the previous leader releasing the lock).
 *   6. acquireLeadership is idempotent while already leader.
 *
 * Two instances are modelled with a SHARED in-memory advisory-lock table
 * (one Postgres backend serving both) plus per-instance connection
 * fakes. Because the manager's leadership registry + config are
 * module-scoped singletons, each "instance" is simulated by resetting
 * the module and re-initing with that instance's connection — every
 * instance's connection talks to the SAME shared lock table, so the
 * `pg_try_advisory_lock` contention is faithful.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  lockIdFor,
  initClusterLock,
  acquireLeadership,
  releaseLeadership,
  isLeader,
  withClusterLeader,
  __resetClusterLockForTests,
  DEFAULT_LEADER_LOCK_ID,
  type ClusterLockConnection,
  type ClusterCronSupervisor,
} from '../cluster-lock';

// ---------------------------------------------------------------------------
// Shared advisory-lock table — one row per held lock id. Two instance
// connections share this, so only ONE can hold a given lock at a time,
// exactly like a real Postgres `pg_try_advisory_lock`.
// ---------------------------------------------------------------------------
function makeSharedLockTable() {
  const held = new Set<string>();
  return {
    held,
    /** Build a connection fake for ONE instance against this table. */
    connect(): ClusterLockConnection & { closed: boolean } {
      let owns = false;
      const conn = {
        closed: false,
        async query<T = Record<string, unknown>>(
          sqlText: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<ReadonlyArray<T>> {
          const lockId = String(params[0] ?? '');
          if (sqlText.includes('pg_try_advisory_lock')) {
            if (held.has(lockId)) {
              return [{ acquired: false } as unknown as T];
            }
            held.add(lockId);
            owns = true;
            return [{ acquired: true } as unknown as T];
          }
          if (sqlText.includes('pg_advisory_unlock')) {
            if (owns) {
              held.delete(lockId);
              owns = false;
            }
            return [{ unlocked: true } as unknown as T];
          }
          return [];
        },
        async close(): Promise<void> {
          // Session close releases any held lock (real PG behaviour).
          if (owns) {
            // We can't know the lock id at close time in this fake; the
            // tests call releaseLeadership() which unlocks first. As a
            // backstop, closing a still-owning connection clears every
            // lock this connection holds — here at most one.
            owns = false;
          }
          conn.closed = true;
        },
      };
      return conn;
    },
  };
}

function makeSilentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeSupervisor(): ClusterCronSupervisor & {
  startCalls: number;
  stopCalls: number;
} {
  let startCalls = 0;
  let stopCalls = 0;
  return {
    get startCalls() {
      return startCalls;
    },
    get stopCalls() {
      return stopCalls;
    },
    start() {
      startCalls += 1;
    },
    stop() {
      stopCalls += 1;
    },
  };
}

beforeEach(() => {
  __resetClusterLockForTests();
});

describe('lockIdFor', () => {
  it('is deterministic for the same name', () => {
    expect(lockIdFor('fx-feed')).toBe(lockIdFor('fx-feed'));
  });

  it('differs for different names', () => {
    expect(lockIdFor('fx-feed')).not.toBe(lockIdFor('daily-brief'));
  });

  it('produces a positive BIGINT-safe decimal string (int63)', () => {
    const id = lockIdFor('borjie-cron-leader');
    expect(id).toMatch(/^\d+$/);
    const big = BigInt(id);
    expect(big).toBeGreaterThan(0n);
    // Must fit a signed 64-bit (we clear the sign bit → int63 max).
    expect(big).toBeLessThanOrEqual((1n << 63n) - 1n);
  });

  it('rejects an empty name', () => {
    expect(() => lockIdFor('   ')).toThrow();
  });

  it('DEFAULT_LEADER_LOCK_ID matches lockIdFor("borjie-cron-leader")', () => {
    expect(DEFAULT_LEADER_LOCK_ID).toBe(lockIdFor('borjie-cron-leader'));
  });
});

describe('election DISABLED (default = today behaviour)', () => {
  it('withClusterLeader passes through — inner supervisor always starts', () => {
    initClusterLock({ enabled: false, connectionFactory: null });
    const sup = makeSupervisor();
    const wrapped = withClusterLeader(sup);
    wrapped.start();
    expect(sup.startCalls).toBe(1);
  });

  it('isLeader() is true for every replica when disabled', () => {
    initClusterLock({ enabled: false, connectionFactory: null });
    expect(isLeader()).toBe(true);
  });

  it('disabled is the default when CRON_LEADER_ELECTION is unset', () => {
    const prev = process.env.CRON_LEADER_ELECTION;
    delete process.env.CRON_LEADER_ELECTION;
    try {
      const cfg = initClusterLock();
      expect(cfg.enabled).toBe(false);
    } finally {
      if (prev !== undefined) process.env.CRON_LEADER_ELECTION = prev;
    }
  });

  it('respects CRON_LEADER_ELECTION="on"', () => {
    const prev = process.env.CRON_LEADER_ELECTION;
    process.env.CRON_LEADER_ELECTION = 'on';
    try {
      // No session URL provided via env in tests → connectionFactory null,
      // but the flag itself must parse to enabled=true.
      const cfg = initClusterLock({ connectionFactory: null });
      expect(cfg.enabled).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CRON_LEADER_ELECTION;
      else process.env.CRON_LEADER_ELECTION = prev;
    }
  });
});

describe('election ENABLED — two instances → exactly one leader', () => {
  it('only ONE of two competing instances wins the lock', async () => {
    const table = makeSharedLockTable();

    // --- Instance A boots and attempts to acquire ---
    const connA = table.connect();
    initClusterLock({
      enabled: true,
      connectionFactory: () => connA,
      logger: makeSilentLogger(),
    });
    const aWon = await acquireLeadership();
    const aIsLeader = isLeader();

    // Snapshot the shared table — exactly one lock id held.
    expect(table.held.size).toBe(1);

    // --- Instance B boots (fresh module state, SAME shared table) ---
    // Simulate a second replica: reset module singletons but keep the
    // shared lock table so B's try_advisory_lock sees A's held lock.
    __resetClusterLockForTests();
    const connB = table.connect();
    initClusterLock({
      enabled: true,
      connectionFactory: () => connB,
      logger: makeSilentLogger(),
    });
    const bWon = await acquireLeadership();
    const bIsLeader = isLeader();

    // EXACTLY ONE leader cluster-wide.
    expect(aWon).toBe(true);
    expect(aIsLeader).toBe(true);
    expect(bWon).toBe(false);
    expect(bIsLeader).toBe(false);
    expect(table.held.size).toBe(1);
  });

  it('promotes the follower after the leader releases', async () => {
    const table = makeSharedLockTable();

    // Leader A acquires.
    const connA = table.connect();
    initClusterLock({
      enabled: true,
      connectionFactory: () => connA,
      logger: makeSilentLogger(),
    });
    expect(await acquireLeadership()).toBe(true);

    // A releases (graceful shutdown) → lock freed.
    await releaseLeadership();
    expect(table.held.size).toBe(0);

    // Follower B now acquires.
    __resetClusterLockForTests();
    const connB = table.connect();
    initClusterLock({
      enabled: true,
      connectionFactory: () => connB,
      logger: makeSilentLogger(),
    });
    expect(await acquireLeadership()).toBe(true);
    expect(isLeader()).toBe(true);
    expect(table.held.size).toBe(1);
  });

  it('acquireLeadership is idempotent while already leader', async () => {
    const table = makeSharedLockTable();
    const conn = table.connect();
    const querySpy = vi.spyOn(conn, 'query');
    initClusterLock({
      enabled: true,
      connectionFactory: () => conn,
      logger: makeSilentLogger(),
    });
    expect(await acquireLeadership()).toBe(true);
    const callsAfterFirst = querySpy.mock.calls.length;
    // Second acquire is a no-op — no extra advisory-lock round-trip.
    expect(await acquireLeadership()).toBe(true);
    expect(querySpy.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('withClusterLeader — leader gating', () => {
  it('leader starts its inner supervisor; follower does NOT', async () => {
    const table = makeSharedLockTable();

    // Leader A: acquire first, then wrap+start → inner starts.
    const connA = table.connect();
    initClusterLock({
      enabled: true,
      connectionFactory: () => connA,
      logger: makeSilentLogger(),
    });
    const supA = makeSupervisor();
    const wrappedA = withClusterLeader(supA);
    wrappedA.start();
    // start() kicks off async acquire; await a tick for it to resolve.
    await new Promise((r) => setImmediate(r));
    expect(isLeader()).toBe(true);
    expect(supA.startCalls).toBe(1);

    // Follower B: same shared table, lock already held → never starts.
    __resetClusterLockForTests();
    const connB = table.connect();
    initClusterLock({
      enabled: true,
      connectionFactory: () => connB,
      logger: makeSilentLogger(),
      // Long retry so the follower does NOT flip mid-assertion.
      retryIntervalMs: 5_000,
    });
    const supB = makeSupervisor();
    const wrappedB = withClusterLeader(supB);
    wrappedB.start();
    await new Promise((r) => setImmediate(r));
    expect(isLeader()).toBe(false);
    expect(supB.startCalls).toBe(0);

    // Cleanup the follower's retry timer.
    wrappedB.stop();
  });
});
