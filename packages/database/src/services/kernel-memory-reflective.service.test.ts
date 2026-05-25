/**
 * Unit tests for createReflectiveMemoryService.
 *
 * The reflective store is read-mostly from the kernel's perspective —
 * the consolidation cycle agent populates it. This service exposes a
 * minimal record + latest read surface; tests cover:
 *
 *   1. record persists a digest row tagged with periodKind + period
 *   2. latest returns digests newest-first, scoped by (tenant, user,
 *      periodKind)
 *   3. latest with userId=null returns ONLY tenant-wide digests (rows
 *      where user_id IS NULL)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReflectiveMemoryService } from './kernel-memory-reflective.service.js';
import type { DatabaseClient } from '../client.js';

interface StoredRow {
  id: string;
  tenantId: string | null;
  userId: string | null;
  periodKind: string;
  periodStart: Date;
  periodEnd: Date;
  summary: string;
  topTopics: ReadonlyArray<{ topic: string; count: number }>;
  sentimentAvg: number | null;
  actionItems: ReadonlyArray<string>;
  generatedAt: Date;
}

interface CapturedFilter {
  tenantId?: string;
  userIdEq?: string;
  userIdIsNull?: boolean;
  periodKind?: string;
}

const captured: { current: CapturedFilter } = { current: {} };

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') captured.current.tenantId = String(value);
      else if (colName === 'user_id') captured.current.userIdEq = String(value);
      else if (colName === 'period_kind')
        captured.current.periodKind = String(value);
      return { _op: 'eq', col: colName, value };
    },
    isNull: (column: { name?: string }) => {
      const colName = String(column?.name ?? '');
      if (colName === 'user_id') captured.current.userIdIsNull = true;
      return { _op: 'isNull', col: colName };
    },
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    desc: (column: unknown) => ({ _op: 'desc', column }),
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
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        const f = captured.current;
        let out = [...state.rows];
        if (f.tenantId !== undefined)
          out = out.filter((r) => r.tenantId === f.tenantId);
        if (f.userIdIsNull) {
          out = out.filter((r) => r.userId === null);
        } else if (f.userIdEq !== undefined) {
          out = out.filter((r) => r.userId === f.userIdEq);
        }
        if (f.periodKind !== undefined)
          out = out.filter((r) => r.periodKind === f.periodKind);
        out.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());
        captured.current = {};
        return resolve(out);
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
            userId: (v.userId ?? null) as string | null,
            periodKind: String(v.periodKind ?? 'weekly'),
            periodStart:
              v.periodStart instanceof Date ? v.periodStart : new Date(),
            periodEnd: v.periodEnd instanceof Date ? v.periodEnd : new Date(),
            summary: String(v.summary ?? ''),
            topTopics: Array.isArray(v.topTopics)
              ? (v.topTopics as { topic: string; count: number }[])
              : [],
            sentimentAvg:
              typeof v.sentimentAvg === 'number' ? v.sentimentAvg : null,
            actionItems: Array.isArray(v.actionItems)
              ? (v.actionItems as string[])
              : [],
            generatedAt: new Date(),
          });
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
  };
  const result = { client: db as unknown as DatabaseClient } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  return result;
}

describe('createReflectiveMemoryService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('record persists a digest row tagged with periodKind + period range', async () => {
    const stub = makeStubDb();
    const svc = createReflectiveMemoryService(stub.client);

    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      periodKind: 'weekly',
      periodStart: '2026-04-27T00:00:00.000Z',
      periodEnd: '2026-05-04T00:00:00.000Z',
      summary: 'Asked 14 times about vacancy; sentiment trending negative.',
      topTopics: [{ topic: 'vacancy', count: 14 }],
      sentimentAvg: -0.2,
      actionItems: ['Schedule a vacancy strategy review'],
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.periodKind).toBe('weekly');
    expect(stub.rows[0]?.summary).toContain('vacancy');
    expect(stub.rows[0]?.topTopics).toEqual([{ topic: 'vacancy', count: 14 }]);
    expect(stub.rows[0]?.sentimentAvg).toBe(-0.2);
    expect(stub.rows[0]?.actionItems).toEqual([
      'Schedule a vacancy strategy review',
    ]);
  });

  it('latest returns digests newest-first, scoped by (tenant, user, periodKind)', async () => {
    const older = new Date('2026-04-01T00:00:00.000Z');
    const newer = new Date('2026-04-15T00:00:00.000Z');
    const stub = makeStubDb([
      {
        id: 'd1',
        tenantId: 't_demo',
        userId: 'u_alice',
        periodKind: 'weekly',
        periodStart: older,
        periodEnd: new Date(older.getTime() + 7 * 86400_000),
        summary: 'older digest',
        topTopics: [],
        sentimentAvg: null,
        actionItems: [],
        generatedAt: new Date(),
      },
      {
        id: 'd2',
        tenantId: 't_demo',
        userId: 'u_alice',
        periodKind: 'weekly',
        periodStart: newer,
        periodEnd: new Date(newer.getTime() + 7 * 86400_000),
        summary: 'newer digest',
        topTopics: [],
        sentimentAvg: null,
        actionItems: [],
        generatedAt: new Date(),
      },
      {
        id: 'd3',
        tenantId: 't_demo',
        userId: 'u_alice',
        periodKind: 'monthly',
        periodStart: newer,
        periodEnd: new Date(newer.getTime() + 30 * 86400_000),
        summary: 'monthly digest — should not appear',
        topTopics: [],
        sentimentAvg: null,
        actionItems: [],
        generatedAt: new Date(),
      },
    ]);
    const svc = createReflectiveMemoryService(stub.client);

    const digests = await svc.latest({
      tenantId: 't_demo',
      userId: 'u_alice',
      periodKind: 'weekly',
      n: 5,
    });

    expect(digests).toHaveLength(2);
    expect(digests[0]?.summary).toBe('newer digest');
    expect(digests[1]?.summary).toBe('older digest');
  });

  it('latest with userId=null returns ONLY tenant-wide digests', async () => {
    const now = new Date();
    const stub = makeStubDb([
      {
        id: 'd1',
        tenantId: 't_demo',
        userId: 'u_alice',
        periodKind: 'weekly',
        periodStart: now,
        periodEnd: now,
        summary: 'per-user',
        topTopics: [],
        sentimentAvg: null,
        actionItems: [],
        generatedAt: now,
      },
      {
        id: 'd2',
        tenantId: 't_demo',
        userId: null,
        periodKind: 'weekly',
        periodStart: now,
        periodEnd: now,
        summary: 'tenant-wide',
        topTopics: [],
        sentimentAvg: null,
        actionItems: [],
        generatedAt: now,
      },
    ]);
    const svc = createReflectiveMemoryService(stub.client);

    const digests = await svc.latest({
      tenantId: 't_demo',
      userId: null,
      periodKind: 'weekly',
      n: 5,
    });

    expect(digests).toHaveLength(1);
    expect(digests[0]?.summary).toBe('tenant-wide');
  });
});
