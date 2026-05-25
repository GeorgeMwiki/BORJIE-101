/**
 * Kernel-feedback service — edge-case tests.
 *
 * The existing kernel-feedback.service.test.ts covers happy-path
 * record / recall / byThought / rollup. These tests target the input-
 * validation + boundary branches that a regression in the side-channel
 * would silently break:
 *
 *   - record() rejects an unknown signal (catches and returns synthetic id;
 *     row is NOT persisted)
 *   - record() rejects empty tenantId / userId / thoughtId
 *   - record() clamps a rating below 1 or above 5
 *   - record() truncates a 5_000-char correctionText to 4_000
 *   - recallForUser() with empty tenantId returns []
 *   - recallForUser() clamps a non-positive limit to the default
 *   - recallForUser() caps the limit at 200 (MAX_RECALL_LIMIT)
 *   - rollup() with empty tenantId returns the zeroed shape
 *   - rollup() with all-thumbs-up rows yields negativeRate=0
 *   - byThought() with empty thoughtId returns []
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
  appliedLimits: number[];
} {
  const state = { rows: [...initial] };
  const appliedLimits: number[] = [];

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

  function makeSelectChain(project?: 'rollup' | 'full'): unknown {
    let appliedLimit = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        appliedLimit = n;
        appliedLimits.push(n);
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
            sliced.map((r) => ({ signal: r.signal, category: r.category })),
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
      const keyCount = cols ? Object.keys(cols).length : Infinity;
      return makeSelectChain(keyCount === 2 ? 'rollup' : 'full');
    },
    insert: () => makeInsertChain(),
  };
  const result = {
    client: db as unknown as DatabaseClient,
    appliedLimits,
  } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
    appliedLimits: number[];
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  return result;
}

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

describe('createFeedbackService — edge cases', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('record swallows unknown signal: returns synthetic id, persists nothing', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    const out = await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      thoughtId: 'th_1',
      threadId: 'thread_1',
      // @ts-expect-error — deliberately invalid signal
      signal: 'mystery-signal',
    });
    expect(out.id).toBeTruthy();
    expect(stub.rows).toHaveLength(0);
  });

  it('record swallows missing tenantId / userId / thoughtId without throwing', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    const a = await svc.record({
      tenantId: '',
      userId: 'u',
      thoughtId: 't',
      threadId: 'thr',
      signal: 'thumbs-up',
    });
    const b = await svc.record({
      tenantId: 't',
      userId: '',
      thoughtId: 't',
      threadId: 'thr',
      signal: 'thumbs-up',
    });
    const c = await svc.record({
      tenantId: 't',
      userId: 'u',
      thoughtId: '',
      threadId: 'thr',
      signal: 'thumbs-up',
    });
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(c.id).toBeTruthy();
    expect(stub.rows).toHaveLength(0);
  });

  it('record clamps rating below 1 to 1 and above 5 to 5; non-finite drops the field', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    await svc.record({
      tenantId: 't',
      userId: 'u',
      thoughtId: 'th_low',
      threadId: 'thr',
      signal: 'thumbs-up',
      rating: -10,
    });
    await svc.record({
      tenantId: 't',
      userId: 'u',
      thoughtId: 'th_hi',
      threadId: 'thr',
      signal: 'thumbs-up',
      rating: 99,
    });
    await svc.record({
      tenantId: 't',
      userId: 'u',
      thoughtId: 'th_inf',
      threadId: 'thr',
      signal: 'thumbs-up',
      rating: Number.POSITIVE_INFINITY,
    });
    expect(stub.rows).toHaveLength(3);
    const byId: Record<string, StoredRow> = {};
    for (const r of stub.rows) byId[r.thoughtId] = r;
    expect(byId.th_low?.rating).toBe(1);
    expect(byId.th_hi?.rating).toBe(5);
    // Non-finite → field omitted from the insert.
    expect(byId.th_inf?.rating).toBeNull();
  });

  it('record truncates correctionText to 4_000 characters', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    const long = 'X'.repeat(6_000);
    await svc.record({
      tenantId: 't',
      userId: 'u',
      thoughtId: 'th_long',
      threadId: 'thr',
      signal: 'correction',
      correctionText: long,
    });
    expect(stub.rows).toHaveLength(1);
    const stored = stub.rows[0]?.correctionText ?? '';
    expect(stored.length).toBe(4_000);
  });

  it('recallForUser with empty tenantId returns [] without hitting the db', async () => {
    const stub = makeStubDb([mkRow({ id: 'r1' })]);
    const svc = createFeedbackService(stub.client);

    const out = await svc.recallForUser({
      tenantId: '',
      userId: 'u_alice',
    });
    expect(out).toEqual([]);
  });

  it('recallForUser clamps non-positive limit to the default (25)', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    await svc.recallForUser({
      tenantId: 't',
      userId: 'u',
      limit: -5,
    });
    expect(stub.appliedLimits).toContain(25);
  });

  it('recallForUser caps the limit at 200 even when caller asks for more', async () => {
    const stub = makeStubDb();
    const svc = createFeedbackService(stub.client);

    await svc.recallForUser({
      tenantId: 't',
      userId: 'u',
      limit: 10_000,
    });
    expect(stub.appliedLimits).toContain(200);
    expect(stub.appliedLimits.every((n) => n <= 200)).toBe(true);
  });

  it('rollup with empty tenantId returns the zeroed shape', async () => {
    const stub = makeStubDb([mkRow({ id: 'r1', signal: 'thumbs-down' })]);
    const svc = createFeedbackService(stub.client);

    const out = await svc.rollup({ tenantId: '', sinceDays: 30 });
    expect(out.thumbsUp).toBe(0);
    expect(out.thumbsDown).toBe(0);
    expect(out.corrections).toBe(0);
    expect(out.negativeRate).toBe(0);
    expect(out.byCategory).toEqual({});
  });

  it('rollup with all thumbs-up rows yields negativeRate=0', async () => {
    const stub = makeStubDb([
      mkRow({ id: '1', signal: 'thumbs-up', category: 'great' }),
      mkRow({ id: '2', signal: 'thumbs-up', category: 'great' }),
      mkRow({ id: '3', signal: 'thumbs-up', category: 'helpful' }),
    ]);
    const svc = createFeedbackService(stub.client);

    const out = await svc.rollup({ tenantId: 't_demo', sinceDays: 30 });
    expect(out.thumbsUp).toBe(3);
    expect(out.thumbsDown).toBe(0);
    expect(out.corrections).toBe(0);
    expect(out.negativeRate).toBe(0);
    expect(out.byCategory.great).toBe(2);
    expect(out.byCategory.helpful).toBe(1);
  });

  it('byThought with empty thoughtId returns []', async () => {
    const stub = makeStubDb([mkRow({ id: 'r1', thoughtId: 'th_present' })]);
    const svc = createFeedbackService(stub.client);

    const out = await svc.byThought('');
    expect(out).toEqual([]);
  });
});
