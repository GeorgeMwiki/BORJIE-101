/**
 * Approvals route unit tests — Linear-Triage unified queue.
 *
 * Same in-memory fake-db + middleware-stub pattern as
 * `escalations.test.ts`. We exercise validation, RLS, status-transition
 * invariants (pending -> approved | rejected | deferred), and the
 * tenant-isolation guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_TEST_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    const db = (globalThis as any).__BORJIE_TEST_DB__;
    c.set('db', db);
    c.set('repos', {});
    c.set('useMockData', false);
    await next();
  },
}));

vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  const readField = (col: any) => col?.name ?? col?._?.name ?? null;
  return {
    ...real,
    eq: (col: any, value: any) => ({
      __filter: (row: any) => {
        const key = readField(col);
        if (!key) return true;
        return row[snakeToCamel(key)] === value || row[key] === value;
      },
    }),
    and: (...conds: any[]) => ({
      __filter: (row: any) =>
        conds.every((c) => (c?.__filter ? c.__filter(row) : true)),
    }),
    or: (...conds: any[]) => ({
      __filter: (row: any) =>
        conds.some((c) => (c?.__filter ? c.__filter(row) : false)),
    }),
    desc: (col: any) => col,
  };
});

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

import { Hono } from 'hono';
import { miningApprovalsRouter } from '../approvals.hono';

function createFakeDb(initial: any[] = []) {
  let rows: any[] = [...initial];
  return {
    rows: () => rows,
    select() {
      return {
        from() {
          return {
            where(condition: any) {
              const filterFn = (condition as any).__filter ?? (() => true);
              return {
                orderBy() {
                  return {
                    limit() {
                      return Promise.resolve(rows.filter(filterFn));
                    },
                  };
                },
                limit() {
                  return Promise.resolve(rows.filter(filterFn));
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: any) {
          return {
            where(condition: any) {
              const filterFn = (condition as any).__filter ?? (() => true);
              return {
                returning() {
                  const updated: any[] = [];
                  rows = rows.map((row) => {
                    if (filterFn(row)) {
                      const merged = { ...row, ...patch };
                      updated.push(merged);
                      return merged;
                    }
                    return row;
                  });
                  return Promise.resolve(updated);
                },
              };
            },
          };
        },
      };
    },
  };
}

const TENANT_ID = 'tenant-001';
const APPROVER_ID = 'user-mgr';
const VALID_UUID = '22222222-2222-4222-8222-222222222222';

function setAuth(
  partial: Partial<{ userId: string; role: string; tenantId: string }> = {},
) {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: partial.userId ?? APPROVER_ID,
    tenantId: partial.tenantId ?? TENANT_ID,
    role: partial.role ?? 'manager',
    permissions: [],
    propertyAccess: ['*'],
  };
}

function clearAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = undefined;
}

function setDb(db: any) {
  (globalThis as any).__BORJIE_TEST_DB__ = db;
}

function buildApp() {
  const app = new Hono();
  app.route('/', miningApprovalsRouter);
  return app;
}

function makePending(over: Partial<any> = {}) {
  return {
    id: VALID_UUID,
    tenantId: TENANT_ID,
    approverUserId: APPROVER_ID,
    requestKind: 'leave',
    requestPayload: { workerId: 'w1', from: '2026-06-04', to: '2026-06-06' },
    requestedByUserId: 'user-worker',
    status: 'pending',
    decidedAt: null,
    decisionReason: null,
    expiresAt: null,
    createdAt: new Date(),
    hashChainId: null,
    ...over,
  };
}

describe('mining approvals router', () => {
  beforeEach(() => {
    clearAuth();
    setDb(undefined);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('GET / returns only pending items where current user is the approver', async () => {
    setAuth();
    setDb(
      createFakeDb([
        makePending(),
        makePending({ id: 'a2', approverUserId: 'someone-else' }),
        makePending({ id: 'a3', status: 'approved' }),
      ]),
    );
    const app = buildApp();
    const res = await app.request('/?status=pending', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(VALID_UUID);
  });

  it('POST /:id/approve transitions pending -> approved with optional reason', async () => {
    setAuth();
    setDb(createFakeDb([makePending()]));
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Schedule allows' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe('approved');
    expect(body.data.decisionReason).toBe('Schedule allows');
    expect(body.data.decidedAt).toBeTruthy();
  });

  it('POST /:id/reject requires reason (validation)', async () => {
    setAuth();
    setDb(createFakeDb([makePending()]));
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/reject transitions pending -> rejected with reason persisted', async () => {
    setAuth();
    setDb(createFakeDb([makePending()]));
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Crew shortage' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe('rejected');
    expect(body.data.decisionReason).toBe('Crew shortage');
  });

  it('POST /:id/defer requires future newDueAt and flips status to deferred', async () => {
    setAuth();
    setDb(createFakeDb([makePending()]));
    const app = buildApp();
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await app.request(`/${VALID_UUID}/defer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newDueAt: future, reason: 'Awaiting context' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe('deferred');
    expect(body.data.expiresAt).toBeTruthy();
  });

  it('POST /:id/defer rejects past timestamps', async () => {
    setAuth();
    setDb(createFakeDb([makePending()]));
    const app = buildApp();
    const past = new Date(Date.now() - 1000).toISOString();
    const res = await app.request(`/${VALID_UUID}/defer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newDueAt: past }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/approve forbids non-approver (FORBIDDEN)', async () => {
    setAuth({ userId: 'not-the-approver' });
    setDb(createFakeDb([makePending()]));
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('POST /:id/approve is idempotent-safe: returns 409 if already decided', async () => {
    setAuth();
    setDb(createFakeDb([makePending({ status: 'approved' })]));
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_STATE');
  });

  it('returns 404 when id does not exist', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('RLS: GET / hides approvals belonging to a different tenant', async () => {
    setAuth();
    setDb(
      createFakeDb([
        makePending(),
        makePending({ id: 'cross-tenant', tenantId: 'OTHER-TENANT' }),
      ]),
    );
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tenantId).toBe(TENANT_ID);
  });
});
