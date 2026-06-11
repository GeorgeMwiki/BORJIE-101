/**
 * Former-leak guards (INV-A / FIRE-2, FIRE-4).
 *
 * Asserts that the metadata-by-default routes return NO tenant business
 * CONTENT to a platform operator who holds no break-glass grant:
 *   - /internal/decision-trace (list + header) projects metadata columns only
 *     — never inputs / branches / chosenRationale / attributes / output;
 *   - /internal/support/tickets default REDACTS the free-text escalation
 *     summary.
 *
 * `authMiddleware` is mocked to a pass-through that stamps a SUPER_ADMIN auth
 * (so `requireRole` + `requireBreakGlass` still run for real), and
 * `databaseMiddlewareNoPin` injects a fake Drizzle client that records the
 * columns each query selected and returns canned rows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { UserRole } from '../../types/user-role';
import { __setOperatorAccessStore } from '../store-singleton';
import { createInMemoryOperatorAccessStore } from '../operator-access-store';

// State the fake db reads from (mutated per-test before the request).
const dbState: { rows: Record<string, unknown>[]; selectedColumnSets: string[][] } = {
  rows: [],
  selectedColumnSets: [],
};

function makeFakeDb() {
  function builder(cols?: Record<string, unknown>) {
    const keys = cols ? Object.keys(cols) : null;
    if (keys) dbState.selectedColumnSets.push(keys);
    const projected = keys
      ? dbState.rows.map((r) =>
          Object.fromEntries(keys.map((k) => [k, (r as any)[k]])),
        )
      : dbState.rows;
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(projected),
      then: (resolve: (v: unknown) => void) => resolve(projected),
    };
    return chain;
  }
  return {
    select: (cols?: Record<string, unknown>) => builder(cols),
    // No `.transaction` → withServiceRoleContext runs fn(db) directly.
  };
}

vi.mock('../../middleware/hono-auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('auth', {
        userId: 'op-1',
        role: UserRole.SUPER_ADMIN,
        tenantId: 't-platform',
        permissions: [],
        propertyAccess: [],
      });
      await next();
    },
  };
});

vi.mock('../../middleware/database', () => ({
  databaseMiddlewareNoPin: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', makeFakeDb());
    await next();
  },
  // store-singleton imports getDatabaseClient — keep it defined (null → the
  // in-memory store fallback, which we override anyway).
  getDatabaseClient: () => null,
}));

const FORBIDDEN_CONTENT_KEYS = [
  'inputs',
  'branches',
  'chosenRationale',
  'attributes',
  'output',
  'error',
];

const FULL_TRACE_ROW = {
  id: 'trace-1',
  tenantId: 'tenant-a',
  name: 'payments.disburse',
  startedAt: new Date('2026-06-09T10:00:00Z'),
  finalisedAt: new Date('2026-06-09T10:00:01Z'),
  durationMs: 1000,
  outcome: 'executed',
  chosenBranchId: 'b1',
  userId: 'u1',
  requestId: 'r1',
  parentTraceId: null,
  inputs: { amount: 9999 },
  branches: [{ id: 'b1', rationale: 'secret reasoning' }],
  chosenRationale: 'secret rationale',
  attributes: { note: 'tenant secret' },
  output: { paid: true },
  error: null,
};

describe('FIRE-2 — decision-trace metadata route leaks no content', () => {
  beforeEach(() => {
    __setOperatorAccessStore(createInMemoryOperatorAccessStore());
    dbState.rows = [FULL_TRACE_ROW];
    dbState.selectedColumnSets = [];
  });
  afterEach(() => __setOperatorAccessStore(null));

  it('the list projection contains no content keys', async () => {
    const { miningInternalDecisionTraceRouter } = await import(
      '../../routes/mining/internal/decision-trace.hono'
    );
    const app = new Hono();
    app.route('/', miningInternalDecisionTraceRouter);

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const row = body.data[0];
    for (const key of FORBIDDEN_CONTENT_KEYS) {
      expect(row).not.toHaveProperty(key);
    }
    for (const cols of dbState.selectedColumnSets) {
      for (const key of FORBIDDEN_CONTENT_KEYS) {
        expect(cols).not.toContain(key);
      }
    }
  });

  it('the content route is break-glass gated (403 without a grant)', async () => {
    const { miningInternalDecisionTraceRouter } = await import(
      '../../routes/mining/internal/decision-trace.hono'
    );
    const app = new Hono();
    app.route('/', miningInternalDecisionTraceRouter);

    const res = await app.request('/trace-1/content?tenant=tenant-a', {
      method: 'GET',
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('BREAK_GLASS_REQUIRED');
  });
});

describe('FIRE-4 — support-tickets default redacts the free-text summary', () => {
  beforeEach(() => {
    __setOperatorAccessStore(createInMemoryOperatorAccessStore());
    dbState.rows = [
      {
        id: 'esc-1',
        tenantId: 'tenant-a',
        severity: 'high',
        summary: 'TENANT SECRET ESCALATION BODY',
        escalatedAt: new Date('2026-06-09T10:00:00Z'),
        resolvedAt: null,
      },
    ];
    dbState.selectedColumnSets = [];
  });
  afterEach(() => __setOperatorAccessStore(null));

  it('default list never returns the escalation summary text', async () => {
    const { miningInternalSupportTicketsRouter } = await import(
      '../../routes/mining/internal/support-tickets.hono'
    );
    const app = new Hono();
    app.route('/', miningInternalSupportTicketsRouter);

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data[0];
    expect(row.summary).not.toContain('TENANT SECRET');
    expect(body.meta.content).toBe(false);
  });
});
