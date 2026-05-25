/**
 * lesson-store.service — unit tests.
 *
 * Coverage:
 *   1. put persists a new lesson + returns its canonical id
 *   2. put dedupes by (tenantId, taskTag, lesson) — recency bump path
 *   3. put rejects empty lesson text
 *   4. put rejects missing tenantId / taskTag
 *   5. put degrades on DB error (returns lesson, never throws)
 *   6. recent returns rows ordered by recency_score DESC
 *   7. recent is tenant + task-tag scoped (no cross-bucket leak)
 *   8. recent returns [] when limit is 0 or negative
 *   9. recent degrades to [] on DB error
 *  10. clear truncates everything (test-only)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLessonStoreService, type Lesson } from '../lesson-store.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredLesson {
  id: string;
  tenantId: string;
  taskTag: string;
  lesson: string;
  evidence: string;
  createdAt: string;
  recencyScore: number;
}

interface StubState {
  rows: StoredLesson[];
  failNextInsert: boolean;
  failNextSelect: boolean;
  failNextExecute: boolean;
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
    desc: (col: unknown) => ({ _op: 'desc', col }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredLesson> = []): {
  client: DatabaseClient;
  state: StubState;
} {
  const state: StubState = {
    rows: [...initial],
    failNextInsert: false,
    failNextSelect: false,
    failNextExecute: false,
  };

  function captureWhere(pred: unknown): {
    tenantId: string | null;
    taskTag: string | null;
  } {
    const out = { tenantId: null as string | null, taskTag: null as string | null };
    function walk(p: unknown): void {
      const x = p as { _op?: string; col?: string; value?: unknown; args?: unknown[] };
      if (!x) return;
      if (x._op === 'eq') {
        if (x.col === 'tenant_id') out.tenantId = String(x.value);
        if (x.col === 'task_tag') out.taskTag = String(x.value);
      }
      if (x._op === 'and' && Array.isArray(x.args)) {
        for (const a of x.args) walk(a);
      }
    }
    walk(pred);
    return out;
  }

  function makeSelectChain(): unknown {
    let wheres: { tenantId: string | null; taskTag: string | null } = {
      tenantId: null,
      taskTag: null,
    };
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
        let out = state.rows.filter(
          (r) =>
            (wheres.tenantId === null || r.tenantId === wheres.tenantId) &&
            (wheres.taskTag === null || r.taskTag === wheres.taskTag),
        );
        out.sort((a, b) => {
          if (b.recencyScore !== a.recencyScore) {
            return b.recencyScore - a.recencyScore;
          }
          return b.createdAt.localeCompare(a.createdAt);
        });
        return resolve(out.slice(0, limitN));
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    let pending: Record<string, unknown> | null = null;
    let upsertSet: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        pending = v;
        return chain;
      },
      onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
        upsertSet = set;
        return chain;
      },
      returning: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        if (!pending) return resolve([]);
        const dupIdx = state.rows.findIndex(
          (r) =>
            r.tenantId === String(pending!.tenantId) &&
            r.taskTag === String(pending!.taskTag) &&
            r.lesson === String(pending!.lesson),
        );
        if (dupIdx >= 0) {
          // Apply ON CONFLICT bump (best-effort approximation).
          const existing = state.rows[dupIdx]!;
          const bumped = Math.min(1, existing.recencyScore + 0.1);
          const updated: StoredLesson = { ...existing, recencyScore: bumped };
          state.rows[dupIdx] = updated;
          return resolve([updated]);
        }
        const row: StoredLesson = {
          id: String(pending.id),
          tenantId: String(pending.tenantId),
          taskTag: String(pending.taskTag),
          lesson: String(pending.lesson),
          evidence: String(pending.evidence),
          createdAt: String(pending.createdAt),
          recencyScore: Number(pending.recencyScore ?? 0),
        };
        state.rows.push(row);
        void upsertSet;
        return resolve([row]);
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    execute: () => {
      if (state.failNextExecute) {
        state.failNextExecute = false;
        return Promise.reject(new Error('execute boom'));
      }
      state.rows.length = 0;
      return Promise.resolve(undefined);
    },
  } as unknown as DatabaseClient;

  return { client, state };
}

function lessonFixture(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'lesson-1',
    tenantId: 't-1',
    taskTag: 'maintenance.triage',
    lesson: 'always confirm unit number before dispatching plumber',
    evidence: 'trace:abc/step3',
    createdAt: '2026-05-23T00:00:00Z',
    recencyScore: 0.5,
    ...overrides,
  };
}

describe('lesson-store.put', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists a new lesson and returns it', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    const out = await svc.put(lessonFixture());
    expect(out.id).toBe('lesson-1');
    expect(stub.state.rows).toHaveLength(1);
    expect(stub.state.rows[0]!.lesson).toMatch(/always confirm unit number/);
  });

  it('dedupes by (tenantId, taskTag, lesson) — recency bump path', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    await svc.put(lessonFixture({ recencyScore: 0.5 }));
    const second = await svc.put(lessonFixture({ id: 'lesson-2', recencyScore: 0.9 }));
    expect(stub.state.rows).toHaveLength(1);
    // The stub bumps by 0.1 on dup; expected = 0.5 + 0.1 = 0.6.
    expect(second.recencyScore).toBeCloseTo(0.6);
  });

  it('rejects empty lesson text — returns lesson without throwing', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    const out = await svc.put(lessonFixture({ lesson: '   ' }));
    expect(stub.state.rows).toHaveLength(0);
    // Returns input lesson; doesn't throw.
    expect(out.lesson).toBe('   ');
  });

  it('rejects missing tenantId / taskTag — returns lesson without throwing', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    await svc.put(lessonFixture({ tenantId: '' }));
    await svc.put(lessonFixture({ taskTag: '' }));
    expect(stub.state.rows).toHaveLength(0);
  });

  it('degrades on DB error — returns input lesson, never throws', async () => {
    const stub = makeStubDb();
    stub.state.failNextInsert = true;
    const svc = createLessonStoreService(stub.client);
    const out = await svc.put(lessonFixture());
    expect(out.id).toBe('lesson-1');
    expect(stub.state.rows).toHaveLength(0);
  });
});

describe('lesson-store.recent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns rows ordered by recency_score DESC', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    await svc.put(lessonFixture({ id: 'a', lesson: 'lesson a', recencyScore: 0.1 }));
    await svc.put(lessonFixture({ id: 'b', lesson: 'lesson b', recencyScore: 0.9 }));
    await svc.put(lessonFixture({ id: 'c', lesson: 'lesson c', recencyScore: 0.5 }));
    const out = await svc.recent('t-1', 'maintenance.triage', 3);
    expect(out).toHaveLength(3);
    expect(out[0]!.id).toBe('b');
    expect(out[1]!.id).toBe('c');
    expect(out[2]!.id).toBe('a');
  });

  it('is tenant + task-tag scoped (no cross-bucket leak)', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    await svc.put(lessonFixture({ id: 'x', tenantId: 't-1', lesson: 'l1' }));
    await svc.put(lessonFixture({ id: 'y', tenantId: 't-2', lesson: 'l2' }));
    await svc.put(
      lessonFixture({ id: 'z', tenantId: 't-1', taskTag: 'arrears', lesson: 'l3' }),
    );
    const t1Triage = await svc.recent('t-1', 'maintenance.triage', 10);
    expect(t1Triage).toHaveLength(1);
    expect(t1Triage[0]!.id).toBe('x');
  });

  it('returns [] when limit is 0 or negative', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    await svc.put(lessonFixture());
    expect(await svc.recent('t-1', 'maintenance.triage', 0)).toEqual([]);
    expect(await svc.recent('t-1', 'maintenance.triage', -3)).toEqual([]);
  });

  it('degrades to [] on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createLessonStoreService(stub.client);
    const out = await svc.recent('t-1', 'maintenance.triage', 5);
    expect(out).toEqual([]);
  });
});

describe('lesson-store.clear', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('truncates everything (test-only)', async () => {
    const stub = makeStubDb();
    const svc = createLessonStoreService(stub.client);
    await svc.put(lessonFixture({ id: 'a' }));
    await svc.put(lessonFixture({ id: 'b', lesson: 'b' }));
    await svc.clear();
    expect(stub.state.rows).toHaveLength(0);
  });

  it('does not throw on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextExecute = true;
    const svc = createLessonStoreService(stub.client);
    await expect(svc.clear()).resolves.toBeUndefined();
  });
});
