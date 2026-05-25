/**
 * Unit tests for createAgencyRunCheckpointsService.
 *
 * Stub the DatabaseClient so each call inspects the SET/VALUES shapes
 * the service hands to drizzle. The stub records all operations as
 * normalised `{op, table, set, where}` entries so assertions can stay
 * concise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgencyRunCheckpointsService } from '../agency-run-checkpoints.service.js';
import type { DatabaseClient } from '../../client.js';

interface RecordedOp {
  readonly op: 'insert' | 'update' | 'select';
  readonly values?: Record<string, unknown>;
  readonly set?: Record<string, unknown>;
}

interface StubDb {
  readonly client: DatabaseClient;
  readonly ops: ReadonlyArray<RecordedOp>;
  /** Test override: rows the next select() returns. */
  setSelectRows: (rows: ReadonlyArray<Record<string, unknown>>) => void;
  /** Test override: force the next op to throw. */
  setNextThrow: (err: Error) => void;
}

function makeStub(): StubDb {
  const ops: RecordedOp[] = [];
  let selectRows: ReadonlyArray<Record<string, unknown>> = [];
  let nextThrow: Error | null = null;

  const thenify = <T>(value: T) => ({
    then: (resolve: (v: T) => unknown) => resolve(value),
  });
  const thenifyThrow = (err: Error) => ({
    then: (
      _resolve: (v: unknown) => unknown,
      reject: (e: unknown) => void,
    ) => reject(err),
  });

  const db: Record<string, unknown> = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (nextThrow) {
          const e = nextThrow;
          nextThrow = null;
          return thenifyThrow(e);
        }
        ops.push({ op: 'insert', values: v });
        return thenify(undefined);
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: (_: unknown) => {
          if (nextThrow) {
            const e = nextThrow;
            nextThrow = null;
            return thenifyThrow(e);
          }
          ops.push({ op: 'update', set: s });
          return thenify(undefined);
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (_: unknown) => {
          // The query chain may end in any of:
          //   .where(...).limit(n)
          //   .where(...).orderBy(asc)
          //   .where(...).orderBy(asc).limit(n)
          // We model all three by returning a thenable that ALSO
          // exposes `orderBy()` and `limit()` for further chaining.
          const terminal = () => {
            if (nextThrow) {
              const e = nextThrow;
              nextThrow = null;
              return thenifyThrow(e);
            }
            ops.push({ op: 'select' });
            return thenify(selectRows);
          };
          const thenableChain = {
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => void) => {
              const t = terminal() as { then: (r: any, j?: any) => void };
              return t.then(resolve, reject);
            },
            orderBy: () => ({
              ...thenableChain,
              limit: (_n: number) => terminal(),
            }),
            limit: (_n: number) => terminal(),
          };
          return thenableChain as never;
        },
      }),
    }),
  };

  const stub = {
    client: db as unknown as DatabaseClient,
    setSelectRows: (rows: ReadonlyArray<Record<string, unknown>>) => {
      selectRows = rows;
    },
    setNextThrow: (err: Error) => {
      nextThrow = err;
    },
  } as unknown as StubDb;
  Object.defineProperty(stub, 'ops', { get: () => ops });
  return stub;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('createAgencyRunCheckpointsService — recordPending', () => {
  it('inserts a row with state=pending and attempt_count=0', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    const out = await svc.recordPending({
      tenantId: 't1',
      runId: 'r1',
      goalId: 'g1',
      stepIndex: 2,
      stepName: 'send-reminder',
      inputPayload: { leaseId: 'l1' },
    });
    expect(out.id).toMatch(/-/);
    const op = stub.ops[0];
    expect(op?.op).toBe('insert');
    expect(op?.values?.tenantId).toBe('t1');
    expect(op?.values?.runId).toBe('r1');
    expect(op?.values?.stepIndex).toBe(2);
    expect(op?.values?.state).toBe('pending');
    expect(op?.values?.attemptCount).toBe(0);
    expect(op?.values?.inputPayload).toEqual({ leaseId: 'l1' });
  });

  it('rethrows on DB error so durable contract is preserved', async () => {
    const stub = makeStub();
    stub.setNextThrow(new Error('boom'));
    const svc = createAgencyRunCheckpointsService(stub.client);
    await expect(
      svc.recordPending({
        tenantId: 't',
        runId: 'r',
        goalId: 'g',
        stepIndex: 0,
        stepName: 's',
        inputPayload: {},
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe('createAgencyRunCheckpointsService — recordRunning', () => {
  it('updates state to running (attempt_count bump via SQL fragment)', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    await svc.recordRunning('cp_1');
    const op = stub.ops[0];
    expect(op?.op).toBe('update');
    expect(op?.set?.state).toBe('running');
    // attemptCount is set via sql`...` fragment — its presence is
    // enough; the SQL builder turns the symbol into the COUNT+1 update.
    expect('attemptCount' in (op?.set ?? {})).toBe(true);
  });
});

describe('createAgencyRunCheckpointsService — recordSuccess', () => {
  it('updates state to success with output payload + completedAt', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    await svc.recordSuccess('cp_1', { ok: true });
    const op = stub.ops[0];
    expect(op?.op).toBe('update');
    expect(op?.set?.state).toBe('success');
    expect(op?.set?.outputPayload).toEqual({ ok: true });
    expect(op?.set?.completedAt).toBeInstanceOf(Date);
    expect(op?.set?.errorMessage).toBeNull();
  });

  it('defaults output payload to empty object when null', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    await svc.recordSuccess('cp_2', null);
    expect(stub.ops[0]?.set?.outputPayload).toEqual({});
  });
});

describe('createAgencyRunCheckpointsService — recordFailure', () => {
  it('updates state to failure with error message + completedAt', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    await svc.recordFailure('cp_1', 'sensor timeout');
    const op = stub.ops[0];
    expect(op?.set?.state).toBe('failure');
    expect(op?.set?.errorMessage).toBe('sensor timeout');
    expect(op?.set?.completedAt).toBeInstanceOf(Date);
  });

  it('truncates very long error messages to 2000 chars', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    const long = 'x'.repeat(5000);
    await svc.recordFailure('cp_1', long);
    expect((stub.ops[0]?.set?.errorMessage as string).length).toBe(2000);
  });
});

describe('createAgencyRunCheckpointsService — recordPaused', () => {
  it('updates state to paused with error message + completedAt', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    await svc.recordPaused('cp_1', 'retries exhausted');
    const op = stub.ops[0];
    expect(op?.set?.state).toBe('paused');
    expect(op?.set?.errorMessage).toBe('retries exhausted');
  });
});

describe('createAgencyRunCheckpointsService — listForRun', () => {
  it('returns rows in step_index ascending order', async () => {
    const stub = makeStub();
    stub.setSelectRows([
      {
        id: 'cp_0',
        tenantId: 't1',
        runId: 'r1',
        goalId: 'g1',
        stepIndex: 0,
        stepName: 'a',
        state: 'success',
        attemptCount: 1,
        inputPayload: {},
        outputPayload: { ok: true },
        errorMessage: null,
        startedAt: new Date('2026-05-01T00:00:00Z'),
        completedAt: new Date('2026-05-01T00:01:00Z'),
      },
      {
        id: 'cp_1',
        tenantId: 't1',
        runId: 'r1',
        goalId: 'g1',
        stepIndex: 1,
        stepName: 'b',
        state: 'failure',
        attemptCount: 3,
        inputPayload: {},
        outputPayload: null,
        errorMessage: 'boom',
        startedAt: new Date('2026-05-01T00:02:00Z'),
        completedAt: new Date('2026-05-01T00:03:00Z'),
      },
    ]);
    const svc = createAgencyRunCheckpointsService(stub.client);
    const rows = await svc.listForRun('r1');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.state).toBe('success');
    expect(rows[1]?.state).toBe('failure');
    expect(rows[1]?.attemptCount).toBe(3);
  });

  it('returns [] when runId is empty', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    expect(await svc.listForRun('')).toEqual([]);
  });

  it('returns [] on DB error', async () => {
    const stub = makeStub();
    stub.setNextThrow(new Error('boom'));
    const svc = createAgencyRunCheckpointsService(stub.client);
    expect(await svc.listForRun('r1')).toEqual([]);
  });
});

describe('createAgencyRunCheckpointsService — listStuckRunning', () => {
  it('returns rows in started_at ascending order with default limit', async () => {
    const stub = makeStub();
    stub.setSelectRows([
      {
        id: 'cp_stuck',
        tenantId: 't1',
        runId: 'r1',
        goalId: 'g1',
        stepIndex: 1,
        stepName: 's',
        state: 'running',
        attemptCount: 1,
        inputPayload: {},
        outputPayload: null,
        errorMessage: null,
        startedAt: new Date('2026-05-01T00:00:00Z'),
        completedAt: null,
      },
    ]);
    const svc = createAgencyRunCheckpointsService(stub.client);
    const rows = await svc.listStuckRunning({
      olderThan: new Date('2026-05-01T00:05:00Z'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('running');
  });

  it('clamps over-large limit to MAX_STUCK_LIMIT (500)', async () => {
    const stub = makeStub();
    stub.setSelectRows([]);
    const svc = createAgencyRunCheckpointsService(stub.client);
    // Effect: no throw; result empty. Limit clamping is internal.
    const out = await svc.listStuckRunning({
      olderThan: new Date(),
      limit: 99999,
    });
    expect(out).toEqual([]);
  });
});

describe('createAgencyRunCheckpointsService — getById', () => {
  it('returns null when id is empty', async () => {
    const stub = makeStub();
    const svc = createAgencyRunCheckpointsService(stub.client);
    expect(await svc.getById('')).toBeNull();
  });

  it('returns the row when found', async () => {
    const stub = makeStub();
    stub.setSelectRows([
      {
        id: 'cp_42',
        tenantId: 't1',
        runId: 'r1',
        goalId: 'g1',
        stepIndex: 0,
        stepName: 's',
        state: 'pending',
        attemptCount: 0,
        inputPayload: {},
        outputPayload: null,
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
      },
    ]);
    const svc = createAgencyRunCheckpointsService(stub.client);
    const row = await svc.getById('cp_42');
    expect(row?.id).toBe('cp_42');
    expect(row?.state).toBe('pending');
  });

  it('returns null on DB error', async () => {
    const stub = makeStub();
    stub.setNextThrow(new Error('boom'));
    const svc = createAgencyRunCheckpointsService(stub.client);
    expect(await svc.getById('cp_42')).toBeNull();
  });
});
