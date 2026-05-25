/**
 * advisory-lock tests — verify recoverStuckRuns wraps the scan in a
 * pg_advisory_xact_lock when a db client is wired. The mock db
 * records the SQL it receives so we can assert the lock dance:
 *   BEGIN
 *   SELECT pg_advisory_xact_lock(hashtext($ns))
 *   <scan>
 *   COMMIT
 * On error the runner ROLLBACKs.
 *
 * Also tests the per-tenant `withTenantAdvisoryLock` helper used by
 * the multi-replica recovery worker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createDurableRunner } from '../durable-runner.js';
import {
  withTenantAdvisoryLock,
  type AdvisoryLockDbClient,
} from '../step-checkpoint-store.js';
import type { StepCheckpointStore } from '../step-checkpoint-store.js';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

interface RecordingDb extends AdvisoryLockDbClient {
  readonly calls: ReadonlyArray<string>;
  setLockAcquired(acquired: boolean): void;
  setShouldThrowOnLock(shouldThrow: boolean): void;
}

function makeRecordingDb(): RecordingDb {
  const calls: string[] = [];
  let lockAcquired = true;
  let throwOnLock = false;
  const db = {
    get calls() {
      return calls;
    },
    setLockAcquired(acquired: boolean) {
      lockAcquired = acquired;
    },
    setShouldThrowOnLock(shouldThrow: boolean) {
      throwOnLock = shouldThrow;
    },
    async execute(q: unknown) {
      const sqlText = sqlToString(q);
      calls.push(sqlText);
      if (sqlText.includes('pg_try_advisory_xact_lock')) {
        if (throwOnLock) throw new Error('lock-failed');
        return { rows: [{ acquired: lockAcquired }] };
      }
      if (sqlText.includes('pg_advisory_xact_lock')) {
        if (throwOnLock) throw new Error('lock-failed');
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as RecordingDb;
  return db;
}

/** Stringify a drizzle sql template literal for assertion. The real
 *  drizzle sql tag emits a `{ queryChunks, params }` shape; for our
 *  purposes inspecting the JSON form is enough. */
function sqlToString(q: unknown): string {
  if (typeof q === 'string') return q;
  try {
    return JSON.stringify(q);
  } catch {
    return String(q);
  }
}

function makeInMemoryStore(): {
  readonly store: StepCheckpointStore;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  seedStuck(args: { runId: string; tenantId: string; goalId: string }): void;
} {
  const rows: Array<Record<string, unknown>> = [];
  return {
    get rows() {
      return rows;
    },
    seedStuck({ runId, tenantId, goalId }) {
      rows.push({
        id: `cp_${randomUUID()}`,
        tenantId,
        runId,
        goalId,
        stepIndex: 0,
        state: 'running',
        startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      });
    },
    store: {
      async pending(args) {
        const id = `cp_${randomUUID()}`;
        rows.push({ id, ...args, state: 'pending' });
        return { id };
      },
      async running() {},
      async success() {},
      async failure() {},
      async paused() {},
      async listForRun() {
        return [] as never;
      },
      async stuckRunning(_args) {
        return rows.filter((r) => r.state === 'running') as never;
      },
      async getById() {
        return null as never;
      },
    },
  };
}

describe('durable-runner — advisory-lock recovery', () => {
  it('wraps recoverStuckRuns in BEGIN / pg_advisory_xact_lock / COMMIT', async () => {
    const db = makeRecordingDb();
    const store = makeInMemoryStore();
    const runner = createDurableRunner({
      executor: {
        async executeGoal() {
          return {
            goalId: 'g1',
            stepsRun: 0,
            stepsSucceeded: 0,
            stepsFailed: 0,
            stepsAwaitingApproval: 0,
            proposedActionIds: [],
            failureMessages: [],
          };
        },
      },
      goals: { get: async () => null as never },
      checkpoints: store.store,
      db,
      sleep: async () => undefined,
    });
    await runner.recoverStuckRuns();
    // Expect BEGIN → advisory lock → COMMIT to all appear in order.
    const sqls = db.calls.join('|');
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('pg_advisory_xact_lock');
    expect(sqls).toContain('hashtext');
    expect(sqls).toContain('COMMIT');
    // BEGIN must precede the lock.
    const idxBegin = db.calls.findIndex((c) => c.includes('BEGIN'));
    const idxLock = db.calls.findIndex((c) => c.includes('pg_advisory_xact_lock'));
    const idxCommit = db.calls.findIndex((c) => c.includes('COMMIT'));
    expect(idxBegin).toBeLessThan(idxLock);
    expect(idxLock).toBeLessThan(idxCommit);
  });

  it('rolls back on scan error', async () => {
    const db = makeRecordingDb();
    db.setShouldThrowOnLock(true);
    const store = makeInMemoryStore();
    const runner = createDurableRunner({
      executor: {
        async executeGoal() {
          return {
            goalId: 'g1',
            stepsRun: 0,
            stepsSucceeded: 0,
            stepsFailed: 0,
            stepsAwaitingApproval: 0,
            proposedActionIds: [],
            failureMessages: [],
          };
        },
      },
      goals: { get: async () => null as never },
      checkpoints: store.store,
      db,
      sleep: async () => undefined,
    });
    const out = await runner.recoverStuckRuns();
    expect(out).toEqual([]);
    expect(db.calls.some((c) => c.includes('ROLLBACK'))).toBe(true);
  });

  it('falls back to lock-free scan when db is absent', async () => {
    const store = makeInMemoryStore();
    store.seedStuck({ runId: 'r-stuck', tenantId: 't1', goalId: 'g1' });
    const goal = {
      id: 'g1',
      tenantId: 't1',
      userId: 'u1',
      threadId: 'th1',
      title: 'g',
      description: '',
      status: 'active' as const,
      priority: 'medium' as const,
      createdAt: '',
      updatedAt: '',
      completedAt: null,
      steps: [],
      metrics: { stepsTotal: 0, stepsDone: 0 },
    };
    const runner = createDurableRunner({
      executor: {
        async executeGoal() {
          return {
            goalId: 'g1',
            stepsRun: 0,
            stepsSucceeded: 0,
            stepsFailed: 0,
            stepsAwaitingApproval: 0,
            proposedActionIds: [],
            failureMessages: [],
          };
        },
      },
      goals: { get: async () => goal as never },
      checkpoints: store.store,
      sleep: async () => undefined,
    });
    const out = await runner.recoverStuckRuns();
    expect(out).toHaveLength(1);
    expect(out[0]?.runId).toBe('r-stuck');
  });
});

describe('withTenantAdvisoryLock helper', () => {
  it('acquires + releases the lock around the body when available', async () => {
    const db = makeRecordingDb();
    const result = await withTenantAdvisoryLock(db, 't1', async () => 'ran');
    expect(result).toBe('ran');
    const sqls = db.calls.join('|');
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('pg_try_advisory_xact_lock');
    expect(sqls).toContain('hashtext');
    expect(sqls).toContain('COMMIT');
  });

  it('returns null when another replica holds the lock', async () => {
    const db = makeRecordingDb();
    db.setLockAcquired(false);
    let bodyCalled = false;
    const result = await withTenantAdvisoryLock(db, 't1', async () => {
      bodyCalled = true;
      return 'should-not-run';
    });
    expect(result).toBeNull();
    expect(bodyCalled).toBe(false);
  });

  it('rejects empty tenantId', async () => {
    const db = makeRecordingDb();
    await expect(withTenantAdvisoryLock(db, '', async () => 1)).rejects.toThrow();
  });

  it('rolls back when the body throws', async () => {
    const db = makeRecordingDb();
    await expect(
      withTenantAdvisoryLock(db, 't1', async () => {
        throw new Error('body-failed');
      }),
    ).rejects.toThrow('body-failed');
    expect(db.calls.some((c) => c.includes('ROLLBACK'))).toBe(true);
  });
});
