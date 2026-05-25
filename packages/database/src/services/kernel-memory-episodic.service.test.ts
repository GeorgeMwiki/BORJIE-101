/**
 * Unit tests for createEpisodicMemoryService.
 *
 * Mocks the Drizzle DatabaseClient with an in-memory store + drizzle-
 * orm operator mocks so we can assert:
 *
 *   1. record persists a row keyed by (tenantId, userId, threadId, turnId)
 *   2. record honours the default 90-day TTL and the explicit ttlDays
 *      override
 *   3. recall returns rows newest-first, scoped by (tenantId, userId)
 *   4. purgeExpired deletes rows whose expires_at is past now
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEpisodicMemoryService } from './kernel-memory-episodic.service.js';
import type { DatabaseClient } from '../client.js';

interface StoredRow {
  id: string;
  tenantId: string | null;
  userId: string;
  threadId: string;
  turnId: string;
  kind: string;
  summary: string;
  payload: unknown;
  capturedAt: Date;
  expiresAt: Date | null;
}

interface CapturedFilter {
  tenantId?: string;
  userId?: string;
  threadId?: string;
  // when set, recall caller passed `since`
  sinceMs?: number;
  // when true, the where filtered on expiresAt < now
  expiresBeforeNow?: boolean;
}

const captured: { current: CapturedFilter } = { current: {} };

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') captured.current.tenantId = String(value);
      else if (colName === 'user_id') captured.current.userId = String(value);
      else if (colName === 'thread_id')
        captured.current.threadId = String(value);
      return { _op: 'eq', col: colName, value };
    },
    gte: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'captured_at' && value instanceof Date) {
        captured.current.sinceMs = value.getTime();
      }
      return { _op: 'gte', col: colName, value };
    },
    lt: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'expires_at' && value instanceof Date) {
        captured.current.expiresBeforeNow = true;
      }
      return { _op: 'lt', col: colName, value };
    },
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    desc: (column: unknown) => ({ _op: 'desc', column }),
    sql: Object.assign(
      (strings: TemplateStringsArray) => ({ _sql: strings.join('') }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredRow> = []): {
  client: DatabaseClient;
  readonly rows: StoredRow[];
} {
  const state = { rows: [...initial] };

  function makeSelectChain(): unknown {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (predicate: unknown) => {
        void predicate;
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        const filt = captured.current;
        let rows = [...state.rows];
        if (filt.tenantId !== undefined) {
          rows = rows.filter((r) => r.tenantId === filt.tenantId);
        }
        if (filt.userId !== undefined) {
          rows = rows.filter((r) => r.userId === filt.userId);
        }
        if (filt.sinceMs !== undefined) {
          rows = rows.filter((r) => r.capturedAt.getTime() >= filt.sinceMs!);
        }
        rows.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
        captured.current = {};
        return resolve(rows);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      _values: null as Partial<StoredRow> | null,
      values: (v: Partial<StoredRow>) => {
        chain._values = v;
        return chain;
      },
      onConflictDoNothing: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        const v = (chain._values ?? null) as Partial<StoredRow> | null;
        if (v) {
          state.rows.push({
            id: String(v.id ?? `r_${state.rows.length}`),
            tenantId: (v.tenantId ?? null) as string | null,
            userId: String(v.userId ?? ''),
            threadId: String(v.threadId ?? ''),
            turnId: String(v.turnId ?? ''),
            kind: String(v.kind ?? 'user-message'),
            summary: String(v.summary ?? ''),
            payload: v.payload,
            capturedAt: new Date(),
            expiresAt:
              v.expiresAt instanceof Date
                ? v.expiresAt
                : v.expiresAt === null
                  ? null
                  : null,
          });
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeDeleteChain(): unknown {
    const chain: Record<string, unknown> = {
      _removed: 0,
      where: (predicate: unknown) => {
        const filt = captured.current;
        if (filt.expiresBeforeNow) {
          const before = state.rows.length;
          state.rows = state.rows.filter(
            (r) => !r.expiresAt || r.expiresAt.getTime() >= Date.now(),
          );
          chain._removed = before - state.rows.length;
        }
        captured.current = {};
        void predicate;
        return chain;
      },
      returning: () => ({
        then: (resolve: (rows: unknown) => unknown) => {
          const removed = chain._removed as number;
          return resolve(Array.from({ length: removed }, (_v, i) => ({ id: `e${i}` })));
        },
      }),
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    delete: () => makeDeleteChain(),
  };
  // Use a getter so the returned `rows` always reflects the live
  // backing array even after delete/upsert reassignment.
  const result = { client: db as unknown as DatabaseClient } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  return result;
}

describe('createEpisodicMemoryService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('record persists a row tied to (tenant, user, thread, turn)', async () => {
    const stub = makeStubDb();
    const svc = createEpisodicMemoryService(stub.client);

    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      threadId: 'th_1',
      turnId: 'tu_1',
      kind: 'user-message',
      summary: 'asks about lease L-417',
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.tenantId).toBe('t_demo');
    expect(stub.rows[0]?.userId).toBe('u_alice');
    expect(stub.rows[0]?.threadId).toBe('th_1');
    expect(stub.rows[0]?.turnId).toBe('tu_1');
    expect(stub.rows[0]?.summary).toBe('asks about lease L-417');
  });

  it('record honours an explicit ttlDays override and accepts ttl=null', async () => {
    const stub = makeStubDb();
    const svc = createEpisodicMemoryService(stub.client);

    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      threadId: 'th_1',
      turnId: 'tu_a',
      kind: 'user-message',
      summary: 'short ttl',
      ttlDays: 1,
    });
    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      threadId: 'th_1',
      turnId: 'tu_b',
      kind: 'user-message',
      summary: 'no ttl',
      ttlDays: null,
    });

    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(stub.rows).toHaveLength(2);
    const ttl1Days = stub.rows[0]?.expiresAt;
    expect(ttl1Days).not.toBeNull();
    if (ttl1Days) {
      const delta = ttl1Days.getTime() - Date.now();
      expect(delta).toBeGreaterThan(oneDayMs - 5_000);
      expect(delta).toBeLessThan(oneDayMs + 5_000);
    }
    expect(stub.rows[1]?.expiresAt).toBeNull();
  });

  it('recall returns recent rows newest-first, scoped by (tenant, user)', async () => {
    const old = new Date(Date.now() - 60_000);
    const recent = new Date(Date.now() - 1_000);
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        threadId: 'th_1',
        turnId: 't1',
        kind: 'user-message',
        summary: 'older',
        payload: {},
        capturedAt: old,
        expiresAt: null,
      },
      {
        id: 'r2',
        tenantId: 't_demo',
        userId: 'u_alice',
        threadId: 'th_1',
        turnId: 't2',
        kind: 'agent-action',
        summary: 'newer',
        payload: {},
        capturedAt: recent,
        expiresAt: null,
      },
      {
        id: 'r3',
        tenantId: 't_other',
        userId: 'u_alice',
        threadId: 'th_2',
        turnId: 't3',
        kind: 'user-message',
        summary: 'cross-tenant noise',
        payload: {},
        capturedAt: recent,
        expiresAt: null,
      },
    ]);
    const svc = createEpisodicMemoryService(stub.client);

    const entries = await svc.recall({ tenantId: 't_demo', userId: 'u_alice' });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.summary).toBe('newer');
    expect(entries[1]?.summary).toBe('older');
    expect(entries.every((e) => e.tenantId === 't_demo')).toBe(true);
  });

  it('purgeExpired deletes rows whose expires_at is past now', async () => {
    const past = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 10 * 60_000);
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't',
        userId: 'u',
        threadId: 'th',
        turnId: 't1',
        kind: 'user-message',
        summary: 'expired',
        payload: {},
        capturedAt: new Date(),
        expiresAt: past,
      },
      {
        id: 'r2',
        tenantId: 't',
        userId: 'u',
        threadId: 'th',
        turnId: 't2',
        kind: 'agent-action',
        summary: 'fresh',
        payload: {},
        capturedAt: new Date(),
        expiresAt: future,
      },
    ]);
    const svc = createEpisodicMemoryService(stub.client);

    const removed = await svc.purgeExpired();

    expect(removed).toBe(1);
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.summary).toBe('fresh');
  });
});
