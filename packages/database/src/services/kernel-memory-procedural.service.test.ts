/**
 * Unit tests for createProceduralMemoryService.
 *
 * Mocks the Drizzle DatabaseClient with an in-memory store; the
 * service itself does the keyword tokenisation + ranking in-process,
 * so the stub only needs to model insert/upsert/select. Tests cover:
 *
 *   1. record inserts a new (tenant, user, patternName) row
 *   2. record bumps invocations and successes when re-run with success=true
 *   3. match returns patterns whose trigger keywords overlap the message
 *   4. match ranks patterns by keyword overlap first, then success rate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProceduralMemoryService } from './kernel-memory-procedural.service.js';
import type { DatabaseClient } from '../client.js';

interface StoredRow {
  id: string;
  tenantId: string | null;
  userId: string;
  patternName: string;
  toolSequence: ReadonlyArray<string>;
  triggerKeywords: ReadonlyArray<string>;
  invocations: number;
  successes: number;
  lastInvokedAt: Date | null;
  createdAt: Date;
}

interface CapturedFilter {
  tenantId?: string;
  userId?: string;
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
      return { _op: 'eq', col: colName, value };
    },
    and: (...args: unknown[]) => ({ _op: 'and', args }),
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
      where: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        const f = captured.current;
        let out = [...state.rows];
        if (f.tenantId !== undefined)
          out = out.filter((r) => r.tenantId === f.tenantId);
        if (f.userId !== undefined)
          out = out.filter((r) => r.userId === f.userId);
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
      onConflictDoUpdate: (cfg: { set: Partial<StoredRow> | unknown }) => {
        const v = (chain._values ?? {}) as Partial<StoredRow>;
        const tenantId = (v.tenantId ?? null) as string | null;
        const userId = String(v.userId ?? '');
        const patternName = String(v.patternName ?? '');
        const existing = state.rows.find(
          (r) =>
            r.tenantId === tenantId &&
            r.userId === userId &&
            r.patternName === patternName,
        );
        const set = (cfg.set ?? {}) as Record<string, unknown>;
        if (existing) {
          if (Array.isArray(set.toolSequence)) {
            existing.toolSequence = (set.toolSequence as string[]).map(String);
          }
          if (Array.isArray(set.triggerKeywords)) {
            existing.triggerKeywords = (set.triggerKeywords as string[]).map(
              String,
            );
          }
          existing.invocations += 1;
          // The service writes successes as either `sql` (bump) or
          // the raw column (no-op). We mirror by inspecting whether
          // the inbound v.successes was 1 (success path).
          if (Number(v.successes ?? 0) > 0) {
            existing.successes += 1;
          }
          existing.lastInvokedAt = new Date();
        } else {
          state.rows.push({
            id: String(v.id ?? `r_${state.rows.length}`),
            tenantId,
            userId,
            patternName,
            toolSequence: Array.isArray(v.toolSequence)
              ? (v.toolSequence as string[]).map(String)
              : [],
            triggerKeywords: Array.isArray(v.triggerKeywords)
              ? (v.triggerKeywords as string[]).map(String)
              : [],
            invocations: Number(v.invocations ?? 0),
            successes: Number(v.successes ?? 0),
            lastInvokedAt: new Date(),
            createdAt: new Date(),
          });
        }
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => resolve(undefined),
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

describe('createProceduralMemoryService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('record inserts a new (tenant, user, patternName) row', async () => {
    const stub = makeStubDb();
    const svc = createProceduralMemoryService(stub.client);

    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      patternName: 'monday-arrears-pull',
      toolSequence: ['arrears.list', 'report.export'],
      triggerKeywords: ['arrears', 'monday'],
      success: true,
    });

    expect(stub.rows).toHaveLength(1);
    const row = stub.rows[0]!;
    expect(row.patternName).toBe('monday-arrears-pull');
    expect(row.invocations).toBe(1);
    expect(row.successes).toBe(1);
    expect(row.toolSequence).toEqual(['arrears.list', 'report.export']);
  });

  it('record bumps invocations and successes when re-run', async () => {
    const stub = makeStubDb();
    const svc = createProceduralMemoryService(stub.client);

    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      patternName: 'p1',
      toolSequence: ['t.a'],
      triggerKeywords: ['arrears'],
      success: true,
    });
    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      patternName: 'p1',
      toolSequence: ['t.a'],
      triggerKeywords: ['arrears'],
      success: false,
    });
    await svc.record({
      tenantId: 't_demo',
      userId: 'u_alice',
      patternName: 'p1',
      toolSequence: ['t.a'],
      triggerKeywords: ['arrears'],
      success: true,
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.invocations).toBe(3);
    expect(stub.rows[0]?.successes).toBe(2);
  });

  it('match returns only patterns whose trigger keywords overlap the message', async () => {
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        patternName: 'arrears-pull',
        toolSequence: ['arrears.list'],
        triggerKeywords: ['arrears', 'overdue'],
        invocations: 4,
        successes: 4,
        lastInvokedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'r2',
        tenantId: 't_demo',
        userId: 'u_alice',
        patternName: 'inspection-schedule',
        toolSequence: ['inspection.list'],
        triggerKeywords: ['inspection', 'visit'],
        invocations: 2,
        successes: 1,
        lastInvokedAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const svc = createProceduralMemoryService(stub.client);

    const out = await svc.match({
      tenantId: 't_demo',
      userId: 'u_alice',
      userMessage: 'show me overdue tenants and arrears today',
    });

    expect(out).toHaveLength(1);
    expect(out[0]?.patternName).toBe('arrears-pull');
    expect((out[0]?.matchScore ?? 0)).toBeGreaterThan(0);
  });

  it('match ranks patterns by keyword overlap, then by success rate', async () => {
    // Both patterns share one trigger ("arrears") with the message.
    // The first has higher success rate; should rank first.
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        patternName: 'arrears-low-success',
        toolSequence: ['t.a'],
        triggerKeywords: ['arrears'],
        invocations: 10,
        successes: 1,
        lastInvokedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'r2',
        tenantId: 't_demo',
        userId: 'u_alice',
        patternName: 'arrears-high-success',
        toolSequence: ['t.b'],
        triggerKeywords: ['arrears'],
        invocations: 10,
        successes: 9,
        lastInvokedAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const svc = createProceduralMemoryService(stub.client);

    const out = await svc.match({
      tenantId: 't_demo',
      userId: 'u_alice',
      userMessage: 'arrears report please',
    });

    expect(out).toHaveLength(2);
    expect(out[0]?.patternName).toBe('arrears-high-success');
    expect(out[1]?.patternName).toBe('arrears-low-success');
  });
});
