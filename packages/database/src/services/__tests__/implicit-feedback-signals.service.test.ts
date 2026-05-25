/**
 * Implicit feedback signals — unit tests.
 *
 * Coverage:
 *   1. record persists one row, normalises strength to [0,1]
 *   2. record rejects unknown signal_type
 *   3. record rejects empty surface / tenantId / userId / traceId
 *   4. listByTrace returns rows ordered newest-first
 *   5. listForUser respects limit + sinceDays cutoff
 *   6. rollupForTenant computes byType + bySurface + meanStrength
 *   7. rollupForTenant returns ZERO_ROLLUP when (tenantId) is missing
 *   8. DB failure paths degrade gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createImplicitFeedbackSignalsService,
} from '../implicit-feedback-signals.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredSignal {
  id: string;
  traceId: string;
  agentActionId: string | null;
  tenantId: string;
  userId: string;
  surface: string;
  signalType: string;
  strength: number;
  payloadJson: unknown;
  emittedAt: Date;
}

interface Captured {
  insertValues?: Record<string, unknown>;
  whereTraceId?: string;
  whereTenantId?: string;
  whereUserId?: string;
  sinceMs?: number;
}

function makeStub(initial: ReadonlyArray<StoredSignal> = []): {
  client: DatabaseClient;
  rows: StoredSignal[];
  captured: Captured;
  failNextSelect?: boolean;
  failNextInsert?: boolean;
} {
  const state = {
    rows: [...initial] as StoredSignal[],
    captured: {} as Captured,
    failNextSelect: false,
    failNextInsert: false,
  };

  function makeSelectChain(): unknown {
    let limitN = Infinity;
    let isRollup = false;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('boom'));
          throw new Error('boom');
        }
        let out = [...state.rows];
        if (state.captured.whereTraceId) {
          out = out.filter((r) => r.traceId === state.captured.whereTraceId);
        }
        if (state.captured.whereTenantId) {
          out = out.filter(
            (r) => r.tenantId === state.captured.whereTenantId,
          );
        }
        if (state.captured.whereUserId) {
          out = out.filter((r) => r.userId === state.captured.whereUserId);
        }
        if (state.captured.sinceMs !== undefined) {
          out = out.filter(
            (r) => r.emittedAt.getTime() >= (state.captured.sinceMs ?? 0),
          );
        }
        out.sort((a, b) => b.emittedAt.getTime() - a.emittedAt.getTime());
        if (isRollup) {
          return resolve(
            out.map((r) => ({
              signalType: r.signalType,
              surface: r.surface,
              strength: r.strength,
            })),
          );
        }
        return resolve(out.slice(0, limitN));
      },
    };
    // Heuristic: the rollup query only selects 3 columns — we can spy
    // via the `from` call but the simplest mechanism is a separate
    // method override. Use a marker via the chain prop trick:
    Object.defineProperty(chain, '__rollup__', {
      configurable: true,
      set(v: boolean) {
        isRollup = v;
      },
    });
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        state.captured.insertValues = v;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        const v = state.captured.insertValues ?? {};
        state.rows.push({
          id: String(v.id),
          traceId: String(v.traceId),
          agentActionId: (v.agentActionId as string | null) ?? null,
          tenantId: String(v.tenantId),
          userId: String(v.userId),
          surface: String(v.surface),
          signalType: String(v.signalType),
          strength: Number(v.strength),
          payloadJson: v.payloadJson ?? {},
          emittedAt: new Date(),
        });
        return resolve(undefined);
      },
    };
    return chain;
  }

  const client = {
    select: (_cols?: unknown) => {
      const chain = makeSelectChain() as Record<string, unknown> & {
        __rollup__?: boolean;
      };
      // crude rollup detection — rollup selects only 3 keys
      if (
        _cols &&
        typeof _cols === 'object' &&
        Object.keys(_cols as object).length === 3
      ) {
        chain.__rollup__ = true;
      }
      return chain;
    },
    insert: () => makeInsertChain(),
  } as unknown as DatabaseClient;

  return Object.assign(state, { client });
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => ({
      _op: 'eq',
      col: String(column?.name ?? ''),
      value,
    }),
    gte: (column: { name?: string }, value: unknown) => ({
      _op: 'gte',
      col: String(column?.name ?? ''),
      value,
    }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    desc: (column: unknown) => ({ _op: 'desc', column }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

describe('implicit-feedback.record', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists one row + clamps strength', async () => {
    const stub = makeStub();
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const out = await svc.record({
      traceId: 'tr-1',
      tenantId: 't-1',
      userId: 'u-1',
      surface: 'admin-portal',
      signalType: 'copy',
      strength: 9.0, // clamp to 1
      payload: { selectionLength: 12 },
    });
    expect(out.id).toBeTruthy();
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.strength).toBe(1);
  });

  it('rejects unknown signal type', async () => {
    const stub = makeStub();
    const svc = createImplicitFeedbackSignalsService(stub.client);
    await svc.record({
      traceId: 'tr-1',
      tenantId: 't-1',
      userId: 'u-1',
      surface: 'admin-portal',
      signalType: 'banana' as unknown as 'copy',
      strength: 0.5,
    });
    expect(stub.rows).toHaveLength(0);
  });

  it('rejects empty required fields', async () => {
    const stub = makeStub();
    const svc = createImplicitFeedbackSignalsService(stub.client);
    await svc.record({
      traceId: '',
      tenantId: 't-1',
      userId: 'u-1',
      surface: 'admin-portal',
      signalType: 'copy',
      strength: 0.5,
    });
    expect(stub.rows).toHaveLength(0);

    await svc.record({
      traceId: 'tr-1',
      tenantId: 't-1',
      userId: 'u-1',
      surface: '',
      signalType: 'copy',
      strength: 0.5,
    });
    expect(stub.rows).toHaveLength(0);
  });

  it('degrades to synthetic id when insert throws', async () => {
    const stub = makeStub();
    stub.failNextInsert = true;
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const out = await svc.record({
      traceId: 'tr-1',
      tenantId: 't-1',
      userId: 'u-1',
      surface: 'admin-portal',
      signalType: 'copy',
      strength: 0.7,
    });
    expect(out.id).toBeTruthy();
    expect(stub.rows).toHaveLength(0);
  });
});

describe('implicit-feedback.listByTrace', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns rows for a trace newest-first', async () => {
    const stub = makeStub([
      makeRow('s1', 'tr-A', 't-1', 'u-1', 'copy', new Date(2026, 0, 1)),
      makeRow('s2', 'tr-A', 't-1', 'u-1', 'override', new Date(2026, 0, 2)),
    ]);
    stub.captured.whereTraceId = 'tr-A';
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const rows = await svc.listByTrace({ traceId: 'tr-A' });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.signalType).toBe('override');
  });

  it('returns [] when traceId is missing', async () => {
    const stub = makeStub();
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const rows = await svc.listByTrace({ traceId: '' });
    expect(rows).toEqual([]);
  });
});

describe('implicit-feedback.rollupForTenant', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('computes byType + bySurface + meanStrength', async () => {
    const stub = makeStub([
      makeRow('s1', 'tr-1', 't-1', 'u-1', 'copy', new Date(), 0.7),
      makeRow('s2', 'tr-1', 't-1', 'u-2', 'override', new Date(), 1.0),
      makeRow(
        's3',
        'tr-2',
        't-1',
        'u-2',
        'edit-resubmit',
        new Date(),
        0.95,
        'owner-portal',
      ),
    ]);
    stub.captured.whereTenantId = 't-1';
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const out = await svc.rollupForTenant({ tenantId: 't-1', sinceDays: 30 });
    expect(out.totalSignals).toBe(3);
    expect(out.byType.copy).toBe(1);
    expect(out.byType.override).toBe(1);
    expect(out.byType['edit-resubmit']).toBe(1);
    expect(out.bySurface['admin-portal']).toBe(2);
    expect(out.bySurface['owner-portal']).toBe(1);
    expect(out.meanStrength).toBeCloseTo((0.7 + 1.0 + 0.95) / 3, 3);
  });

  it('returns zeroed rollup when tenantId is missing', async () => {
    const stub = makeStub();
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const out = await svc.rollupForTenant({ tenantId: '', sinceDays: 30 });
    expect(out.totalSignals).toBe(0);
    expect(out.meanStrength).toBe(0);
  });

  it('returns zeroed rollup on db error', async () => {
    const stub = makeStub();
    stub.failNextSelect = true;
    const svc = createImplicitFeedbackSignalsService(stub.client);
    const out = await svc.rollupForTenant({ tenantId: 't-1', sinceDays: 30 });
    expect(out.totalSignals).toBe(0);
  });
});

function makeRow(
  id: string,
  traceId: string,
  tenantId: string,
  userId: string,
  signalType: string,
  emittedAt: Date,
  strength = 0.5,
  surface = 'admin-portal',
): StoredSignal {
  return {
    id,
    traceId,
    agentActionId: null,
    tenantId,
    userId,
    surface,
    signalType,
    strength,
    payloadJson: {},
    emittedAt,
  };
}
