/**
 * Unit tests for createSensoriumEventLogService.
 *
 * Mirrors the kernel-feedback.service.test pattern: a hand-rolled in-
 * memory Drizzle stub + drizzle-orm operator mocks so we can assert:
 *
 *   1. appendBatch persists every valid row + reports rejected count
 *   2. appendBatch rejects rows with missing required fields
 *   3. appendBatch rejects rows with unknown event types
 *   4. appendBatch defence-in-depth: rejects rows carrying raw mouse
 *      coordinates or input values (client should have stripped them)
 *   5. listForSession is tenant + session scoped, ordered newest-first
 *   6. countByTypeForUser returns the per-event-type histogram
 *   7. listForSession returns [] on DB error (side-channel safety)
 *   8. appendBatch returns inserted = 0 on DB error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSensoriumEventLogService,
  type SensoriumEventInput,
} from '../sensorium-event-log.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredRow {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  surface: string;
  route: string;
  eventType: string;
  payloadJson: Record<string, unknown>;
  emittedAt: Date;
  receivedAt: Date;
}

interface CapturedFilter {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
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
      else if (colName === 'session_id')
        captured.current.sessionId = String(value);
      return { _op: 'eq', col: colName, value };
    },
    gte: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'emitted_at' && value instanceof Date) {
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
  fail: { insert: boolean; select: boolean };
} {
  const state = {
    rows: [...initial],
    fail: { insert: false, select: false },
  };

  function applyFilter(rows: StoredRow[]): StoredRow[] {
    const f = captured.current;
    let out = [...rows];
    if (f.tenantId !== undefined) {
      out = out.filter((r) => r.tenantId === f.tenantId);
    }
    if (f.userId !== undefined) {
      out = out.filter((r) => r.userId === f.userId);
    }
    if (f.sessionId !== undefined) {
      out = out.filter((r) => r.sessionId === f.sessionId);
    }
    if (f.sinceMs !== undefined) {
      out = out.filter((r) => r.emittedAt.getTime() >= (f.sinceMs ?? 0));
    }
    return out;
  }

  function makeSelectChain(project: 'rows' | 'histogram'): unknown {
    let appliedLimit = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: (n: number) => {
        appliedLimit = n;
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => {
        if (state.fail.select) {
          captured.current = {};
          throw new Error('stub select failure');
        }
        const filtered = applyFilter(state.rows);
        if (project === 'histogram') {
          const histogram: Record<string, number> = {};
          for (const r of filtered) {
            histogram[r.eventType] = (histogram[r.eventType] ?? 0) + 1;
          }
          captured.current = {};
          return resolve(
            Object.entries(histogram).map(([eventType, n]) => ({
              eventType,
              n,
            })),
          );
        }
        const sorted = filtered.sort(
          (a, b) => b.emittedAt.getTime() - a.emittedAt.getTime(),
        );
        const sliced = Number.isFinite(appliedLimit)
          ? sorted.slice(0, appliedLimit)
          : sorted;
        captured.current = {};
        return resolve(sliced);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      values: (vs: ReadonlyArray<Record<string, unknown>>) => {
        if (state.fail.insert) {
          return {
            then: (_resolve: unknown, reject: (e: Error) => unknown) =>
              reject(new Error('stub insert failure')),
          };
        }
        const list = Array.isArray(vs) ? vs : [vs];
        for (const v of list) {
          state.rows.push({
            id: String(v.id ?? `r_${state.rows.length}`),
            tenantId: String(v.tenantId ?? ''),
            userId: String(v.userId ?? ''),
            sessionId: String(v.sessionId ?? ''),
            surface: String(v.surface ?? ''),
            route: String(v.route ?? ''),
            eventType: String(v.eventType ?? ''),
            payloadJson:
              (v.payloadJson as Record<string, unknown>) ?? {},
            emittedAt:
              v.emittedAt instanceof Date
                ? v.emittedAt
                : new Date(String(v.emittedAt ?? Date.now())),
            receivedAt: new Date(),
          });
        }
        return { then: (resolve: () => unknown) => resolve() };
      },
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: (cols?: Record<string, unknown>) => {
      const keyCount = cols ? Object.keys(cols).length : Infinity;
      return makeSelectChain(keyCount === 2 ? 'histogram' : 'rows');
    },
    insert: () => makeInsertChain(),
  };
  const result = {
    client: db as unknown as DatabaseClient,
  } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
    fail: { insert: boolean; select: boolean };
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  Object.defineProperty(result, 'fail', { get: () => state.fail });
  return result;
}

function makeInput(
  overrides: Partial<SensoriumEventInput> = {},
): SensoriumEventInput {
  return {
    tenantId: 't_demo',
    userId: 'u_alice',
    sessionId: 'sess_1',
    surface: 'admin-web',
    route: '/jarvis',
    eventType: 'page.view',
    payload: { route: '/jarvis' },
    emittedAt: new Date().toISOString(),
    ...overrides,
  } as SensoriumEventInput;
}

describe('createSensoriumEventLogService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('appendBatch persists every valid row and reports counts', async () => {
    const stub = makeStubDb();
    const svc = createSensoriumEventLogService(stub.client);

    const out = await svc.appendBatch([
      makeInput({ eventType: 'page.view' }),
      makeInput({ eventType: 'element.click', payload: { tag: 'button' } }),
      makeInput({ eventType: 'scroll.depth', payload: { percent: 50 } }),
    ]);

    expect(out.inserted).toBe(3);
    expect(out.rejected).toBe(0);
    expect(stub.rows).toHaveLength(3);
    const types = new Set(stub.rows.map((r) => r.eventType));
    expect(types.has('page.view')).toBe(true);
    expect(types.has('element.click')).toBe(true);
    expect(types.has('scroll.depth')).toBe(true);
  });

  it('appendBatch returns zero when batch is empty', async () => {
    const stub = makeStubDb();
    const svc = createSensoriumEventLogService(stub.client);
    const out = await svc.appendBatch([]);
    expect(out).toEqual({ inserted: 0, rejected: 0 });
  });

  it('appendBatch rejects rows missing required fields', async () => {
    const stub = makeStubDb();
    const svc = createSensoriumEventLogService(stub.client);

    const out = await svc.appendBatch([
      makeInput(),
      makeInput({ tenantId: '' }),
      makeInput({ sessionId: '' }),
      makeInput({ userId: '' }),
    ]);

    expect(out.inserted).toBe(1);
    expect(out.rejected).toBe(3);
  });

  it('appendBatch rejects rows with unknown event types', async () => {
    const stub = makeStubDb();
    const svc = createSensoriumEventLogService(stub.client);

    const out = await svc.appendBatch([
      makeInput(),
      // @ts-expect-error — exercising the runtime guard
      makeInput({ eventType: 'mouse.move' }),
      // @ts-expect-error — exercising the runtime guard
      makeInput({ eventType: 'made.up.event' }),
    ]);

    expect(out.inserted).toBe(1);
    expect(out.rejected).toBe(2);
  });

  it('appendBatch (defence-in-depth) rejects rows carrying mouse coords or raw input values', async () => {
    const stub = makeStubDb();
    const svc = createSensoriumEventLogService(stub.client);

    const out = await svc.appendBatch([
      makeInput({ payload: { mouseX: 100, mouseY: 200 } as never }),
      makeInput({ payload: { value: 'super-secret-password' } as never }),
      makeInput(),
    ]);

    expect(out.inserted).toBe(1);
    expect(out.rejected).toBe(2);
  });

  it('listForSession returns newest-first and is tenant/user/session scoped', async () => {
    const now = Date.now();
    const stub = makeStubDb([
      makeStored({
        id: 'old-outside-window',
        tenantId: 't_demo',
        userId: 'u_alice',
        sessionId: 'sess_1',
        eventType: 'page.view',
        emittedAt: new Date(now - 100 * 60 * 1000),
      }),
      makeStored({
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        sessionId: 'sess_1',
        eventType: 'page.view',
        emittedAt: new Date(now - 5 * 60 * 1000),
      }),
      makeStored({
        id: 'r2',
        tenantId: 't_demo',
        userId: 'u_alice',
        sessionId: 'sess_1',
        eventType: 'element.click',
        emittedAt: new Date(now - 1 * 60 * 1000),
      }),
      makeStored({
        id: 'cross-tenant',
        tenantId: 't_other',
        userId: 'u_alice',
        sessionId: 'sess_1',
        eventType: 'page.view',
        emittedAt: new Date(now - 1 * 60 * 1000),
      }),
      makeStored({
        id: 'cross-session',
        tenantId: 't_demo',
        userId: 'u_alice',
        sessionId: 'sess_2',
        eventType: 'page.view',
        emittedAt: new Date(now - 1 * 60 * 1000),
      }),
    ]);
    const svc = createSensoriumEventLogService(stub.client);

    const rows = await svc.listForSession({
      tenantId: 't_demo',
      userId: 'u_alice',
      sessionId: 'sess_1',
      windowMinutes: 30,
    });

    expect(rows.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('countByTypeForUser returns per-event-type histogram', async () => {
    const now = Date.now();
    const stub = makeStubDb([
      makeStored({
        id: '1',
        eventType: 'element.click',
        emittedAt: new Date(now - 1_000),
      }),
      makeStored({
        id: '2',
        eventType: 'element.click',
        emittedAt: new Date(now - 2_000),
      }),
      makeStored({
        id: '3',
        eventType: 'scroll.depth',
        emittedAt: new Date(now - 3_000),
      }),
      makeStored({
        id: '4',
        eventType: 'page.view',
        emittedAt: new Date(now - 4_000),
      }),
      makeStored({
        id: 'cross-tenant',
        tenantId: 't_other',
        eventType: 'element.click',
        emittedAt: new Date(now - 5_000),
      }),
    ]);
    const svc = createSensoriumEventLogService(stub.client);

    const histogram = await svc.countByTypeForUser({
      tenantId: 't_demo',
      userId: 'u_alice',
    });

    expect(histogram['element.click']).toBe(2);
    expect(histogram['scroll.depth']).toBe(1);
    expect(histogram['page.view']).toBe(1);
    expect(histogram['form.submit']).toBe(0);
  });

  it('listForSession returns [] on DB failure (side-channel safety)', async () => {
    const stub = makeStubDb();
    stub.fail.select = true;
    const svc = createSensoriumEventLogService(stub.client);

    const rows = await svc.listForSession({
      tenantId: 't_demo',
      userId: 'u_alice',
      sessionId: 'sess_1',
    });
    expect(rows).toEqual([]);
  });

  it('appendBatch reports inserted=0 + bumped rejected on DB failure', async () => {
    const stub = makeStubDb();
    stub.fail.insert = true;
    const svc = createSensoriumEventLogService(stub.client);

    const out = await svc.appendBatch([makeInput(), makeInput()]);
    expect(out.inserted).toBe(0);
    expect(out.rejected).toBeGreaterThanOrEqual(2);
  });
});

function makeStored(overrides: Partial<StoredRow>): StoredRow {
  return {
    id: 'r',
    tenantId: 't_demo',
    userId: 'u_alice',
    sessionId: 'sess_1',
    surface: 'admin-web',
    route: '/jarvis',
    eventType: 'page.view',
    payloadJson: {},
    emittedAt: new Date(),
    receivedAt: new Date(),
    ...overrides,
  };
}
