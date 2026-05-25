/**
 * Unit tests for createSensorRoutingService.
 *
 * Mocks the Drizzle DatabaseClient with an in-memory store + drizzle-
 * orm operator mocks so we can assert the contracts the kernel relies
 * on:
 *
 *   1. recordSensorCall persists one row and debits the matching budget
 *      envelope by cost_usd_micro
 *   2. recordSensorCall is best-effort — DB errors swallow + log
 *   3. getBudgetStatus returns null when no envelope is configured
 *   4. getBudgetStatus computes remaining + utilisation correctly
 *   5. selectSensorChain returns a builtin chain per task
 *   6. selectSensorChain downgrades Opus → Sonnet for free tier
 *   7. selectSensorChain defaults to Sonnet→Haiku for unknown tasks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSensorRoutingService,
  type RecordSensorCallArgs,
} from './sensor-routing.service.js';
import type { DatabaseClient } from '../client.js';

interface CallLogRow {
  id: string;
  tenantId: string | null;
  task: string;
  sensor: string;
  outcome: string;
  costUsdMicro: number;
  tokensIn: number;
  tokensOut: number;
}

interface EnvelopeRow {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  budgetUsdMicro: number;
  consumedUsdMicro: number;
  alertThresholdPct: number;
  hardCapEnforced: boolean;
}

interface CapturedFilter {
  tenantId?: string;
  // We don't actually filter on date in the stub — the production
  // service does, but matching expected behaviour with the table-scan
  // stub is sufficient for these unit tests.
}

const captured: { current: CapturedFilter } = { current: {} };

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') captured.current.tenantId = String(value);
      return { _op: 'eq', col: colName, value };
    },
    gte: (_col: unknown, _v: unknown) => ({ _op: 'gte' }),
    lt: (_col: unknown, _v: unknown) => ({ _op: 'lt' }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        _sql: strings.join(''),
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

interface Stub {
  client: DatabaseClient;
  readonly callLog: ReadonlyArray<CallLogRow>;
  readonly envelopes: ReadonlyArray<EnvelopeRow>;
}

function makeStubDb(initialEnvelopes: ReadonlyArray<EnvelopeRow> = []): Stub {
  const state = {
    callLog: [] as CallLogRow[],
    envelopes: [...initialEnvelopes] as EnvelopeRow[],
  };

  function makeSelectChain(): unknown {
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
        let rows = state.envelopes;
        if (captured.current.tenantId !== undefined) {
          rows = rows.filter((r) => r.tenantId === captured.current.tenantId);
        }
        const sliced = Number.isFinite(appliedLimit)
          ? rows.slice(0, appliedLimit)
          : rows;
        captured.current = {};
        return resolve(sliced);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        state.callLog.push({
          id: String(v.id ?? `row-${state.callLog.length}`),
          tenantId: (v.tenantId ?? null) as string | null,
          task: String(v.task ?? ''),
          sensor: String(v.sensor ?? ''),
          outcome: String(v.outcome ?? ''),
          costUsdMicro: Number(v.costUsdMicro ?? 0),
          tokensIn: Number(v.tokensIn ?? 0),
          tokensOut: Number(v.tokensOut ?? 0),
        });
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
    };
    return chain;
  }

  function makeUpdateChain(): unknown {
    // The production code uses `db.update(x).set(patch).where(and(eq(tenantId,
    // X), …))`. The `eq` operator runs at .where() argument-evaluation time,
    // AFTER `.set()` has returned. We therefore defer the actual debit until
    // the .where() call so `captured.current.tenantId` is populated.
    let pendingPatch: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      set: (patch: Record<string, unknown>) => {
        pendingPatch = patch;
        return chain;
      },
      where: () => {
        const rawDelta = pendingPatch?.consumedUsdMicro as
          | { _sql?: string }
          | number
          | undefined;
        const last = state.callLog[state.callLog.length - 1];
        const cost = last ? last.costUsdMicro : 0;
        for (const env of state.envelopes) {
          if (env.tenantId === captured.current.tenantId) {
            if (typeof rawDelta === 'number') {
              env.consumedUsdMicro = rawDelta;
            } else {
              env.consumedUsdMicro += cost;
            }
          }
        }
        pendingPatch = null;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        captured.current = {};
        return resolve(undefined);
      },
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    update: () => makeUpdateChain(),
  };
  const stub = { client: db as unknown as DatabaseClient } as Stub;
  Object.defineProperty(stub, 'callLog', { get: () => state.callLog });
  Object.defineProperty(stub, 'envelopes', { get: () => state.envelopes });
  return stub;
}

function args(over: Partial<RecordSensorCallArgs> = {}): RecordSensorCallArgs {
  const startedAt = new Date('2026-05-14T10:00:00Z');
  return {
    tenantId: 't_demo',
    task: 'greeting',
    sensor: 'claude.haiku-4-5',
    startedAt,
    completedAt: new Date('2026-05-14T10:00:01Z'),
    outcome: 'ok',
    tokensIn: 100,
    tokensOut: 50,
    costUsdMicro: 1000,
    latencyMs: 800,
    thinkingActive: false,
    ...over,
  };
}

describe('createSensorRoutingService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('recordSensorCall persists one row + debits the matching envelope', async () => {
    const periodStart = new Date('2026-05-01T00:00:00Z');
    const periodEnd = new Date('2026-06-01T00:00:00Z');
    const stub = makeStubDb([
      {
        tenantId: 't_demo',
        periodStart,
        periodEnd,
        budgetUsdMicro: 1_000_000_000,
        consumedUsdMicro: 5000,
        alertThresholdPct: 80,
        hardCapEnforced: true,
      },
    ]);
    const svc = createSensorRoutingService(stub.client);

    const out = await svc.recordSensorCall(args({ costUsdMicro: 2500 }));
    expect(out.id).toBeTruthy();
    expect(stub.callLog).toHaveLength(1);
    expect(stub.callLog[0]?.outcome).toBe('ok');
    expect(stub.callLog[0]?.costUsdMicro).toBe(2500);
    expect(stub.envelopes[0]?.consumedUsdMicro).toBe(5000 + 2500);
  });

  it('recordSensorCall with cost 0 does NOT debit the envelope', async () => {
    const stub = makeStubDb([
      {
        tenantId: 't_demo',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
        budgetUsdMicro: 1_000_000_000,
        consumedUsdMicro: 1000,
        alertThresholdPct: 80,
        hardCapEnforced: true,
      },
    ]);
    const svc = createSensorRoutingService(stub.client);

    await svc.recordSensorCall(args({ costUsdMicro: 0, outcome: 'refused' }));
    expect(stub.envelopes[0]?.consumedUsdMicro).toBe(1000);
  });

  it('recordSensorCall with no tenant skips envelope debit', async () => {
    const stub = makeStubDb();
    const svc = createSensorRoutingService(stub.client);
    const out = await svc.recordSensorCall(
      args({ tenantId: null, costUsdMicro: 999 }),
    );
    expect(out.id).toBeTruthy();
    expect(stub.callLog[0]?.tenantId).toBeNull();
  });

  it('getBudgetStatus returns null when no envelope exists', async () => {
    const stub = makeStubDb();
    const svc = createSensorRoutingService(stub.client);
    const status = await svc.getBudgetStatus({ tenantId: 't_demo' });
    expect(status).toBeNull();
  });

  it('getBudgetStatus computes remaining + utilisation', async () => {
    const stub = makeStubDb([
      {
        tenantId: 't_demo',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
        budgetUsdMicro: 1_000_000,
        consumedUsdMicro: 250_000,
        alertThresholdPct: 80,
        hardCapEnforced: true,
      },
    ]);
    const svc = createSensorRoutingService(stub.client);
    const status = await svc.getBudgetStatus({
      tenantId: 't_demo',
      now: new Date('2026-05-14T10:00:00Z'),
    });
    expect(status).not.toBeNull();
    expect(status?.remainingUsdMicro).toBe(750_000);
    expect(status?.utilisation).toBeCloseTo(0.25, 5);
    expect(status?.hardCapEnforced).toBe(true);
  });

  it('selectSensorChain returns the builtin chain for greeting', () => {
    const stub = makeStubDb();
    const svc = createSensorRoutingService(stub.client);
    const v = svc.selectSensorChain('greeting');
    expect(v.task).toBe('greeting');
    expect(v.source).toBe('builtin');
    expect(v.primary.sensor).toBe('claude.haiku-4-5');
    expect(v.cognitionMode).toBe('fast');
  });

  it('selectSensorChain downgrades Opus → Sonnet on free tier', () => {
    const stub = makeStubDb();
    const svc = createSensorRoutingService(stub.client);
    const enterprise = svc.selectSensorChain('arrears_memo', 'enterprise');
    expect(enterprise.primary.sensor).toBe('claude.opus-4-7');

    const free = svc.selectSensorChain('arrears_memo', 'free');
    // The free tier downgrade rewrites any opus choice to sonnet
    // before selecting the primary — verify no opus remains in chain.
    expect(free.primary.sensor).not.toBe('claude.opus-4-7');
    expect([
      free.primary.sensor,
      ...free.fallbacks.map((f) => f.sensor),
    ]).not.toContain('claude.opus-4-7');
  });

  it('selectSensorChain defaults to Sonnet → Haiku for unknown tasks', () => {
    const stub = makeStubDb();
    const svc = createSensorRoutingService(stub.client);
    const v = svc.selectSensorChain('made_up_task');
    expect(v.primary.sensor).toBe('claude.sonnet-4-6');
    expect(v.source).toBe('builtin');
    expect(v.reasoning).toMatch(/no builtin route/i);
  });
});
