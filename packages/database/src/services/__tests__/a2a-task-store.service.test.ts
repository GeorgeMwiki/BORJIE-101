/**
 * a2a-task-store.service — unit tests.
 *
 * Coverage:
 *   1. constructor requires tenantId
 *   2. put inserts a new task
 *   3. put on existing id updates (idempotent upsert)
 *   4. put rejects invalid status
 *   5. put rejects missing id / sessionId
 *   6. put truncates `error` to 4_000 chars
 *   7. put rethrows on DB error
 *   8. get returns the task within tenant scope
 *   9. get is tenant-scoped (no cross-tenant leak)
 *  10. get returns null for missing id
 *  11. get degrades to null on DB error
 *  12. list returns tenant + session-scoped tasks in createdAt order
 *  13. list returns [] on missing session
 *  14. list degrades to [] on DB error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createA2aTaskStoreService,
  type A2ATask,
} from '../a2a-task-store.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredTask {
  id: string;
  sessionId: string;
  tenantId: string;
  status: string;
  message: unknown;
  artifacts: unknown;
  error: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

interface StubState {
  rows: StoredTask[];
  failNextInsert: boolean;
  failNextSelect: boolean;
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: { name?: string }, value: unknown) => ({
      _op: 'eq',
      col: String(col?.name ?? ''),
      value,
    }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    asc: (col: unknown) => ({ _op: 'asc', col }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function captureWhere(pred: unknown): {
  ids: string[];
  sessionIds: string[];
  tenantIds: string[];
} {
  const out = { ids: [] as string[], sessionIds: [] as string[], tenantIds: [] as string[] };
  function walk(p: unknown): void {
    const x = p as { _op?: string; col?: string; value?: unknown; args?: unknown[] };
    if (!x) return;
    if (x._op === 'eq') {
      if (x.col === 'id') out.ids.push(String(x.value));
      if (x.col === 'session_id') out.sessionIds.push(String(x.value));
      if (x.col === 'tenant_id') out.tenantIds.push(String(x.value));
    }
    if (x._op === 'and' && Array.isArray(x.args)) {
      for (const a of x.args) walk(a);
    }
  }
  walk(pred);
  return out;
}

function makeStubDb(initial: ReadonlyArray<StoredTask> = []): {
  client: DatabaseClient;
  state: StubState;
} {
  const state: StubState = {
    rows: [...initial],
    failNextInsert: false,
    failNextSelect: false,
  };

  function makeSelectChain(): unknown {
    let wheres = captureWhere(undefined);
    let limitN = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (pred: unknown) => {
        wheres = captureWhere(pred);
        return chain;
      },
      orderBy: () => chain,
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        let out = state.rows.filter((r) => {
          if (wheres.tenantIds.length > 0 && !wheres.tenantIds.includes(r.tenantId)) {
            return false;
          }
          if (wheres.ids.length > 0 && !wheres.ids.includes(r.id)) return false;
          if (
            wheres.sessionIds.length > 0 &&
            !wheres.sessionIds.includes(r.sessionId)
          )
            return false;
          return true;
        });
        out.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));
        return resolve(out.slice(0, limitN));
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    let pending: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        pending = v;
        return chain;
      },
      onConflictDoUpdate: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        if (!pending) return resolve(undefined);
        const idx = state.rows.findIndex((r) => r.id === String(pending!.id));
        const row: StoredTask = {
          id: String(pending.id),
          sessionId: String(pending.sessionId),
          tenantId: String(pending.tenantId),
          status: String(pending.status),
          message: pending.message,
          artifacts: pending.artifacts,
          error:
            pending.error === null || pending.error === undefined
              ? null
              : String(pending.error),
          createdAtIso: String(pending.createdAtIso),
          updatedAtIso: String(pending.updatedAtIso),
        };
        if (idx >= 0) state.rows[idx] = row;
        else state.rows.push(row);
        return resolve(undefined);
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
  } as unknown as DatabaseClient;

  return { client, state };
}

function taskFixture(overrides: Partial<A2ATask> = {}): A2ATask {
  return {
    id: 'task-1',
    sessionId: 'sess-1',
    status: 'submitted',
    message: {
      role: 'user',
      parts: [{ type: 'text', content: 'hello' }],
    },
    artifacts: [],
    createdAt: '2026-05-23T00:00:00Z',
    updatedAt: '2026-05-23T00:00:00Z',
    ...overrides,
  };
}

describe('a2a-task-store constructor', () => {
  it('requires tenantId', () => {
    expect(() =>
      createA2aTaskStoreService({} as DatabaseClient, { tenantId: '' }),
    ).toThrow(/tenantId/);
  });
});

describe('a2a-task-store.put', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('inserts a new task', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await svc.put(taskFixture());
    expect(stub.state.rows).toHaveLength(1);
    expect(stub.state.rows[0]!.tenantId).toBe('t-1');
  });

  it('on existing id updates (idempotent upsert)', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await svc.put(taskFixture());
    await svc.put(
      taskFixture({
        status: 'completed',
        updatedAt: '2026-05-23T00:01:00Z',
      }),
    );
    expect(stub.state.rows).toHaveLength(1);
    expect(stub.state.rows[0]!.status).toBe('completed');
    expect(stub.state.rows[0]!.updatedAtIso).toBe('2026-05-23T00:01:00Z');
  });

  it('rejects invalid status', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await expect(
      svc.put(taskFixture({ status: 'banana' as unknown as 'submitted' })),
    ).rejects.toThrow();
  });

  it('rejects missing id / sessionId', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await expect(svc.put(taskFixture({ id: '' }))).rejects.toThrow();
    await expect(svc.put(taskFixture({ sessionId: '' }))).rejects.toThrow();
  });

  it('truncates `error` to 4_000 chars', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    const longError = 'x'.repeat(10_000);
    await svc.put(taskFixture({ status: 'failed', error: longError }));
    expect(stub.state.rows[0]!.error).toHaveLength(4_000);
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextInsert = true;
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await expect(svc.put(taskFixture())).rejects.toThrow('insert boom');
  });
});

describe('a2a-task-store.get', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the task within tenant scope', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await svc.put(taskFixture());
    const out = await svc.get('task-1');
    expect(out).not.toBeNull();
    expect(out!.id).toBe('task-1');
    expect(out!.status).toBe('submitted');
  });

  it('is tenant-scoped — no cross-tenant leak', async () => {
    const stub = makeStubDb();
    const t1 = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    const t2 = createA2aTaskStoreService(stub.client, { tenantId: 't-2' });
    await t1.put(taskFixture({ id: 'shared' }));
    const fromT2 = await t2.get('shared');
    expect(fromT2).toBeNull();
  });

  it('returns null for missing id', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    const out = await svc.get('does-not-exist');
    expect(out).toBeNull();
  });

  it('degrades to null on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    const out = await svc.get('task-1');
    expect(out).toBeNull();
  });
});

describe('a2a-task-store.list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns tenant + session-scoped tasks in createdAt order', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    await svc.put(
      taskFixture({ id: 'b', createdAt: '2026-05-23T00:01:00Z' }),
    );
    await svc.put(
      taskFixture({ id: 'a', createdAt: '2026-05-23T00:00:00Z' }),
    );
    await svc.put(
      taskFixture({ id: 'other-session', sessionId: 'sess-2' }),
    );
    const list = await svc.list('sess-1');
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('a');
    expect(list[1]!.id).toBe('b');
  });

  it('returns [] on missing session', async () => {
    const stub = makeStubDb();
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    const out = await svc.list('');
    expect(out).toEqual([]);
  });

  it('degrades to [] on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createA2aTaskStoreService(stub.client, { tenantId: 't-1' });
    const out = await svc.list('sess-1');
    expect(out).toEqual([]);
  });
});
