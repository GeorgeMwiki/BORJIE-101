/**
 * Reflexion buffer service — unit tests.
 *
 * Coverage:
 *   1. record persists one row + returns its id
 *   2. record rejects unknown outcome
 *   3. record rejects empty reflection text
 *   4. recall returns the last N rows newest-first
 *   5. recall returns [] when (tenant, user) is missing
 *   6. recall bumps retrieved_count by default; honours bumpTelemetry=false
 *   7. record failure degrades — returns synthetic id, no throw
 *   8. recall db-error degrades to []
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReflexionBufferService } from '../reflexion-buffer.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredReflexion {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  reflection: string;
  outcome: string;
  recordedAt: Date;
  retrievedCount: number;
}

interface Captured {
  insertValues?: Record<string, unknown>;
  updateSet?: Record<string, unknown>;
  whereTenantId?: string;
  whereUserId?: string;
}

function makeStubDb(initial: ReadonlyArray<StoredReflexion> = []): {
  client: DatabaseClient;
  rows: StoredReflexion[];
  captured: Captured;
  failNextInsert?: boolean;
  failNextSelect?: boolean;
  failNextUpdate?: boolean;
} {
  const state = {
    rows: [...initial] as StoredReflexion[],
    captured: {} as Captured,
    failNextInsert: false,
    failNextSelect: false,
    failNextUpdate: false,
  };

  function makeSelectChain(): unknown {
    let limitN = Infinity;
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
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        let out = [...state.rows];
        if (state.captured.whereTenantId) {
          out = out.filter((r) => r.tenantId === state.captured.whereTenantId);
        }
        if (state.captured.whereUserId) {
          out = out.filter((r) => r.userId === state.captured.whereUserId);
        }
        // newest-first
        out.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
        return resolve(out.slice(0, limitN));
      },
    };
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
          tenantId: String(v.tenantId),
          userId: String(v.userId),
          sessionId: String(v.sessionId),
          reflection: String(v.reflection),
          outcome: String(v.outcome),
          recordedAt: new Date(),
          retrievedCount: 0,
        });
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeUpdateChain(): unknown {
    const chain: Record<string, unknown> = {
      set: (v: Record<string, unknown>) => {
        state.captured.updateSet = v;
        return chain;
      },
      where: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextUpdate) {
          state.failNextUpdate = false;
          if (reject) return reject(new Error('update boom'));
          throw new Error('update boom');
        }
        // Bump every row's retrievedCount in our stub
        for (const r of state.rows) r.retrievedCount += 1;
        return resolve(undefined);
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    update: () => makeUpdateChain(),
  } as unknown as DatabaseClient;

  return Object.assign(state, { client });
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      return { _op: 'eq', col: colName, value };
    },
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

describe('reflexion-buffer.record', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists one row and returns its id', async () => {
    const stub = makeStubDb();
    const svc = createReflexionBufferService(stub.client);
    const out = await svc.record({
      tenantId: 't-1',
      userId: 'u-1',
      sessionId: 'sess-1',
      reflection: 'next time ask before fuzzy matching unit numbers',
      outcome: 'mixed',
    });
    expect(out.id).toBeTruthy();
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.outcome).toBe('mixed');
  });

  it('rejects unknown outcome (no row inserted)', async () => {
    const stub = makeStubDb();
    const svc = createReflexionBufferService(stub.client);
    await svc.record({
      tenantId: 't-1',
      userId: 'u-1',
      sessionId: 's-1',
      reflection: 'whatever',
      outcome: 'banana' as unknown as 'success',
    });
    expect(stub.rows).toHaveLength(0);
  });

  it('rejects empty reflection text', async () => {
    const stub = makeStubDb();
    const svc = createReflexionBufferService(stub.client);
    await svc.record({
      tenantId: 't-1',
      userId: 'u-1',
      sessionId: 's-1',
      reflection: '   ',
      outcome: 'failure',
    });
    expect(stub.rows).toHaveLength(0);
  });

  it('returns a synthetic id when the insert throws', async () => {
    const stub = makeStubDb();
    stub.failNextInsert = true;
    const svc = createReflexionBufferService(stub.client);
    const out = await svc.record({
      tenantId: 't-1',
      userId: 'u-1',
      sessionId: 's-1',
      reflection: 'something',
      outcome: 'success',
    });
    expect(out.id).toBeTruthy();
    expect(stub.rows).toHaveLength(0);
  });
});

describe('reflexion-buffer.recall', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns the last N rows newest-first', async () => {
    const stub = makeStubDb([
      makeRow('r1', 't-1', 'u-1', new Date(2026, 0, 1)),
      makeRow('r2', 't-1', 'u-1', new Date(2026, 0, 2)),
      makeRow('r3', 't-1', 'u-1', new Date(2026, 0, 3)),
    ]);
    // Patch the where capture so the filter applies properly.
    stub.captured.whereTenantId = 't-1';
    stub.captured.whereUserId = 'u-1';
    const svc = createReflexionBufferService(stub.client);
    const out = await svc.recall({
      tenantId: 't-1',
      userId: 'u-1',
      limit: 2,
      bumpTelemetry: false,
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe('r3');
    expect(out[1]?.id).toBe('r2');
  });

  it('returns [] when tenantId or userId is missing', async () => {
    const stub = makeStubDb([makeRow('r1', 't-1', 'u-1', new Date())]);
    const svc = createReflexionBufferService(stub.client);
    const out = await svc.recall({
      tenantId: '',
      userId: 'u-1',
    });
    expect(out).toEqual([]);
  });

  it('bumps retrieved_count by default', async () => {
    const stub = makeStubDb([makeRow('r1', 't-1', 'u-1', new Date())]);
    stub.captured.whereTenantId = 't-1';
    stub.captured.whereUserId = 'u-1';
    const svc = createReflexionBufferService(stub.client);
    const before = stub.rows[0]?.retrievedCount ?? 0;
    await svc.recall({ tenantId: 't-1', userId: 'u-1' });
    expect(stub.rows[0]?.retrievedCount).toBe(before + 1);
  });

  it('skips telemetry bump when bumpTelemetry=false', async () => {
    const stub = makeStubDb([makeRow('r1', 't-1', 'u-1', new Date())]);
    stub.captured.whereTenantId = 't-1';
    stub.captured.whereUserId = 'u-1';
    const svc = createReflexionBufferService(stub.client);
    const before = stub.rows[0]?.retrievedCount ?? 0;
    await svc.recall({
      tenantId: 't-1',
      userId: 'u-1',
      bumpTelemetry: false,
    });
    expect(stub.rows[0]?.retrievedCount).toBe(before);
  });

  it('degrades to [] when the db throws', async () => {
    const stub = makeStubDb([makeRow('r1', 't-1', 'u-1', new Date())]);
    stub.failNextSelect = true;
    const svc = createReflexionBufferService(stub.client);
    const out = await svc.recall({ tenantId: 't-1', userId: 'u-1' });
    expect(out).toEqual([]);
  });
});

function makeRow(
  id: string,
  tenantId: string,
  userId: string,
  recordedAt: Date,
): StoredReflexion {
  return {
    id,
    tenantId,
    userId,
    sessionId: 'sess',
    reflection: `reflection-${id}`,
    outcome: 'mixed',
    recordedAt,
    retrievedCount: 0,
  };
}
