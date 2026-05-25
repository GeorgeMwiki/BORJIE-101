/**
 * Unit tests for createFeedbackService.
 *
 * Mocks the Drizzle DatabaseClient with an in-memory store + drizzle-
 * orm operator mocks so we can assert the contracts the kernel relies
 * on:
 *
 *   1. record persists one row keyed by (tenantId, userId, thoughtId)
 *      and returns its id
 *   2. recallForUser respects sinceDays and orders newest-first
 *   3. byThought returns every row referencing a given thoughtId
 *   4. rollup with no rows returns zeroed counters and negativeRate=0
 *   5. rollup with mixed signals computes per-category counters and
 *      the (thumbsDown + corrections) / total ratio
 *   6. recallForUser orders by capturedAt DESC and respects the limit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFeedbackService } from './kernel-feedback.service.js';
import type { DatabaseClient } from '../client.js';

interface StoredRow {
  id: string;
  tenantId: string;
  userId: string;
  thoughtId: string;
  threadId: string;
  signal: string;
  rating: number | null;
  correctionText: string | null;
  category: string | null;
  capturedAt: Date;
}

interface CapturedFilter {
  tenantId?: string;
  userId?: string;
  thoughtId?: string;
  sinceMs?: number;
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
      else if (colName === 'thought_id')
        captured.current.thoughtId = String(value);
      return { _op: 'eq', col: colName, value };
    },
    gte: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'captured_at' && value instanceof Date) {
        captured.current.sinceMs = value.getTime();
      }
      return { _op: 'gte', col: colName, value };
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

  function applyFilter(rows: StoredRow[]): StoredRow[] {
    const f = captured.current;
    let out = [...rows];
    if (f.tenantId !== undefined) {
      out = out.filter((r) => r.tenantId === f.tenantId);
    }
    if (f.userId !== undefined) {
      out = out.filter((r) => r.userId === f.userId);
    }
    if (f.thoughtId !== undefined) {
      out = out.filter((r) => r.thoughtId === f.thoughtId);
    }
    if (f.sinceMs !== undefined) {
      out = out.filter((r) => r.capturedAt.getTime() >= (f.sinceMs ?? 0));
    }
    return out;
  }

  function makeSelectChain(
    project?: 'rollup' | 'full',
  ): unknown {
    let appliedLimit = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        appliedLimit = n;
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => {
        const rows = applyFilter(state.rows);
        rows.sort(
          (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
        );
        const sliced = Number.isFinite(appliedLimit)
          ? rows.slice(0, appliedLimit)
          : rows;
        captured.current = {};
        if (project === 'rollup') {
          return resolve(
            sliced.map((r) => ({
              signal: r.signal,
              category: r.category,
            })),
          );
        }
        return resolve(sliced);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      values: (v: Partial<StoredRow>) => {
        state.rows.push({
          id: String(v.id ?? `r_${state.rows.length}`),
          tenantId: String(v.tenantId ?? ''),
          userId: String(v.userId ?? ''),
          thoughtId: String(v.thoughtId ?? ''),
          threadId: String(v.threadId ?? ''),
          signal: String(v.signal ?? 'thumbs-up'),
          rating: typeof v.rating === 'number' ? v.rating : null,
          correctionText: (v.correctionText ?? null) as string | null,
          category: (v.category ?? null) as string | null,
          capturedAt: new Date(),
        });
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => resolve(undefined),
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: (cols?: Record<string, unknown>) => {
      // The rollup query selects exactly { signal, category }; the
      // recallForUser / byThought paths select the full SELECT_COLS
      // bundle. Detect by key count.
      const keyCount = cols ? Object.keys(cols).length : Infinity;
      return makeSelectChain(keyCount === 2 ? 'rollup' : 'full');
    },
    insert: () => makeInsertChain(),
  };
  const result = { client: db as unknown as DatabaseClient } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  return result;
}

describe('createFeedbackService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('record persists one row and returns its id', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    const out = await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      thoughtId: 'th_1',
      threadId: 'thread_1',
      signal: 'thumbs-down',
      category: 'hallucinated',
      correctionText: 'You cited a non-existent unit.',
    });

    expect(out.id).toBeTruthy();
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.signal).toBe('thumbs-down');
    expect(stub.rows[0]?.category).toBe('hallucinated');
    expect(stub.rows[0]?.correctionText).toContain('non-existent unit');
  });

  it('recallForUser respects sinceDays and limit, ordered newest first', async () => {
    const now = Date.now();
    const stub = makeStubDb([
      // 60 days old — should be filtered out by sinceDays = 30
      mkRow({
        id: 'r_old',
        thoughtId: 'th_old',
        capturedAt: new Date(now - 60 * 24 * 60 * 60 * 1000),
        signal: 'thumbs-up',
      }),
      mkRow({
        id: 'r_a',
        thoughtId: 'th_a',
        capturedAt: new Date(now - 1 * 60 * 60 * 1000),
        signal: 'thumbs-up',
      }),
      mkRow({
        id: 'r_b',
        thoughtId: 'th_b',
        capturedAt: new Date(now - 2 * 60 * 60 * 1000),
        signal: 'thumbs-down',
      }),
      mkRow({
        id: 'r_c',
        thoughtId: 'th_c',
        capturedAt: new Date(now - 3 * 60 * 60 * 1000),
        signal: 'correction',
      }),
    ]);
    const svc = createFeedbackService(stub.client);

    const recent = await svc.recallForUser({
      tenantId: 't_demo',
      userId: 'u_alice',
      sinceDays: 30,
      limit: 10,
    });

    expect(recent.map((r) => r.id)).toEqual(['r_a', 'r_b', 'r_c']);

    const limited = await svc.recallForUser({
      tenantId: 't_demo',
      userId: 'u_alice',
      sinceDays: 30,
      limit: 2,
    });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.id).toBe('r_a');
  });

  it('byThought returns every row referencing one thoughtId', async () => {
    const stub = makeStubDb([
      mkRow({ id: 'r1', thoughtId: 'th_target' }),
      mkRow({ id: 'r2', thoughtId: 'th_target' }),
      mkRow({ id: 'r3', thoughtId: 'th_other' }),
    ]);
    const svc = createFeedbackService(stub.client);

    const hits = await svc.byThought('th_target');
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.thoughtId === 'th_target')).toBe(true);
  });

  it('rollup with zero rows returns zeroed counters and negativeRate=0', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    const out = await svc.rollup({ tenantId: 't_demo', sinceDays: 30 });
    expect(out.thumbsUp).toBe(0);
    expect(out.thumbsDown).toBe(0);
    expect(out.corrections).toBe(0);
    expect(out.negativeRate).toBe(0);
    expect(Object.keys(out.byCategory)).toHaveLength(0);
  });

  it('rollup with mixed signals computes per-category counters and negativeRate', async () => {
    const now = Date.now();
    const stub = makeStubDb([
      mkRow({
        id: '1',
        signal: 'thumbs-up',
        category: 'great',
        capturedAt: new Date(now - 1_000),
      }),
      mkRow({
        id: '2',
        signal: 'thumbs-up',
        category: 'great',
        capturedAt: new Date(now - 2_000),
      }),
      mkRow({
        id: '3',
        signal: 'thumbs-down',
        category: 'hallucinated',
        capturedAt: new Date(now - 3_000),
      }),
      mkRow({
        id: '4',
        signal: 'correction',
        category: 'wrong-tone',
        capturedAt: new Date(now - 4_000),
      }),
      mkRow({
        id: '5',
        signal: 'flagged',
        category: 'other',
        capturedAt: new Date(now - 5_000),
      }),
    ]);
    const svc = createFeedbackService(stub.client);

    const out = await svc.rollup({ tenantId: 't_demo', sinceDays: 30 });
    expect(out.thumbsUp).toBe(2);
    expect(out.thumbsDown).toBe(1);
    expect(out.corrections).toBe(1);
    expect(out.byCategory.great).toBe(2);
    expect(out.byCategory.hallucinated).toBe(1);
    expect(out.byCategory['wrong-tone']).toBe(1);
    // (1 thumbs-down + 1 correction) / 5 total = 0.4
    expect(out.negativeRate).toBeCloseTo(0.4);
  });

  it('recallForUser is ordered newest-first and limited correctly', async () => {
    const now = Date.now();
    const stub = makeStubDb([
      mkRow({
        id: 'oldest',
        capturedAt: new Date(now - 5 * 60 * 60 * 1000),
        thoughtId: 'th_oldest',
      }),
      mkRow({
        id: 'middle',
        capturedAt: new Date(now - 2 * 60 * 60 * 1000),
        thoughtId: 'th_middle',
      }),
      mkRow({
        id: 'newest',
        capturedAt: new Date(now - 5 * 60 * 1000),
        thoughtId: 'th_newest',
      }),
    ]);
    const svc = createFeedbackService(stub.client);

    const out = await svc.recallForUser({
      tenantId: 't_demo',
      userId: 'u_alice',
      sinceDays: 30,
    });
    expect(out.map((r) => r.id)).toEqual(['newest', 'middle', 'oldest']);
  });
});

// Convenience row factory.
function mkRow(over: Partial<StoredRow>): StoredRow {
  return {
    id: 'r',
    tenantId: 't_demo',
    userId: 'u_alice',
    thoughtId: 'th_x',
    threadId: 'thread_x',
    signal: 'thumbs-up',
    rating: null,
    correctionText: null,
    category: null,
    capturedAt: new Date(),
    ...over,
  };
}
