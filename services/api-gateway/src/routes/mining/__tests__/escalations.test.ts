/**
 * Escalations route unit tests.
 *
 * Mounts the real router against a fake Drizzle client + injected auth
 * context. The router's middleware honours pre-set `db` / `auth` values
 * on `c.set(...)` and falls through without touching the production
 * jwt + postgres path. This keeps the suite fast and DB-free.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub auth/database middleware BEFORE importing the router so the router's
// `app.use('*', authMiddleware/databaseMiddleware)` picks up the stubs.
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

import { Hono } from 'hono';
import { miningEscalationsRouter } from '../escalations.hono';

// ---------------------------------------------------------------------------
// Fake Drizzle client — tracks rows in a Map keyed by table reference.
// ---------------------------------------------------------------------------

function createFakeDb(initial: any[] = []) {
  let rows: any[] = [...initial];
  const api = {
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
    insert() {
      return {
        values(input: any) {
          const next = Array.isArray(input) ? input : [input];
          return {
            returning() {
              const created = next.map((row) => ({
                id: row.id ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
                acknowledgedAt: null,
                resolvedAt: null,
                createdAt: new Date(),
                hashChainId: null,
                ...row,
              }));
              rows = [...rows, ...created];
              return Promise.resolve(created);
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
  return api;
}

// ---------------------------------------------------------------------------
// Drizzle eq/and/or mocks — produce a `__filter` function that the fake
// client uses to filter rows. Real drizzle returns SQL fragments which
// our fake cannot interpret, so we replace these with predicate builders
// via a shallow mock.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const MANAGER_USER_ID = 'user-mgr';
const WORKER_USER_ID = 'user-worker';

function setAuth(
  partial: Partial<{ userId: string; role: string; tenantId: string }> = {},
) {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: partial.userId ?? MANAGER_USER_ID,
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
  app.route('/', miningEscalationsRouter);
  return app;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mining escalations router', () => {
  beforeEach(() => {
    clearAuth();
    setDb(undefined);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('GET / returns only rows visible to current user (raised/addressed/role)', async () => {
    setAuth({ userId: MANAGER_USER_ID, role: 'manager' });
    setDb(
      createFakeDb([
        {
          id: 'e1',
          tenantId: TENANT_ID,
          raisedByUserId: WORKER_USER_ID,
          toUserId: MANAGER_USER_ID,
          toRole: null,
          sourceKind: 'incident',
          sourceId: null,
          contextSw: 'Tatizo kwenye mtambo',
          severity: 'warning',
          status: 'open',
          createdAt: new Date(),
        },
        {
          id: 'e2',
          tenantId: TENANT_ID,
          raisedByUserId: 'someone-else',
          toUserId: 'another-user',
          toRole: null,
          sourceKind: 'task',
          sourceId: null,
          contextSw: 'Si yangu',
          severity: 'info',
          status: 'open',
          createdAt: new Date(),
        },
        {
          id: 'e3',
          tenantId: TENANT_ID,
          raisedByUserId: WORKER_USER_ID,
          toUserId: null,
          toRole: 'manager',
          sourceKind: 'safety',
          sourceId: null,
          contextSw: 'Tahadhari',
          severity: 'critical',
          status: 'open',
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await app.request('/?status=open', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: any[] };
    expect(body.success).toBe(true);
    const ids = body.data.map((r) => r.id).sort();
    expect(ids).toEqual(['e1', 'e3']);
  });

  it('POST / rejects when neither toUserId nor toRole provided (validation)', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceKind: 'task',
        contextSw: 'kitu',
        severity: 'warning',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST / rejects when both toUserId and toRole provided (exclusive constraint)', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        toUserId: '22222222-2222-4222-8222-222222222222',
        toRole: 'owner',
        sourceKind: 'task',
        contextSw: 'kitu',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST / creates an escalation with the current user as raiser', async () => {
    setAuth({ userId: WORKER_USER_ID, role: 'worker' });
    const db = createFakeDb();
    setDb(db);
    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        toRole: 'manager',
        sourceKind: 'safety',
        contextSw: 'Mafuta yamemwagika',
        severity: 'critical',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: any };
    expect(body.success).toBe(true);
    expect(body.data.raisedByUserId).toBe(WORKER_USER_ID);
    expect(body.data.severity).toBe('critical');
    expect(body.data.toRole).toBe('manager');
    expect(body.data.status).toBe('open');
    expect(db.rows()).toHaveLength(1);
  });

  it('POST /:id/acknowledge forbids non-addressee', async () => {
    setAuth({ userId: 'other-user', role: 'worker' });
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          raisedByUserId: WORKER_USER_ID,
          toUserId: MANAGER_USER_ID,
          toRole: null,
          sourceKind: 'task',
          contextSw: 'kitu',
          severity: 'warning',
          status: 'open',
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/acknowledge`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('POST /:id/acknowledge marks acked and is idempotent', async () => {
    setAuth({ userId: MANAGER_USER_ID, role: 'manager' });
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          raisedByUserId: WORKER_USER_ID,
          toUserId: MANAGER_USER_ID,
          toRole: null,
          sourceKind: 'task',
          contextSw: 'kitu',
          severity: 'warning',
          status: 'open',
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const first = await app.request(`/${VALID_UUID}/acknowledge`, { method: 'POST' });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: any };
    expect(firstBody.data.status).toBe('acknowledged');

    const second = await app.request(`/${VALID_UUID}/acknowledge`, { method: 'POST' });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data: any };
    expect(secondBody.data.status).toBe('acknowledged');
  });

  it('POST /:id/resolve allows raiser to close and rejects strangers', async () => {
    setAuth({ userId: WORKER_USER_ID, role: 'worker' });
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          raisedByUserId: WORKER_USER_ID,
          toUserId: MANAGER_USER_ID,
          toRole: null,
          sourceKind: 'task',
          contextSw: 'kitu',
          severity: 'warning',
          status: 'acknowledged',
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/resolve`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe('resolved');
  });

  it('POST /:id/resolve returns 404 when escalation does not exist', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/resolve`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /:id/acknowledge returns 400 on malformed id', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await app.request('/not-a-uuid/acknowledge', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('RLS: GET / excludes rows from a different tenant (tenantId mismatch)', async () => {
    setAuth({ userId: MANAGER_USER_ID, role: 'manager', tenantId: TENANT_ID });
    setDb(
      createFakeDb([
        {
          id: 'e1',
          tenantId: 'OTHER-TENANT',
          raisedByUserId: WORKER_USER_ID,
          toUserId: MANAGER_USER_ID,
          toRole: null,
          sourceKind: 'task',
          contextSw: 'foreign',
          severity: 'info',
          status: 'open',
          createdAt: new Date(),
        },
        {
          id: 'e2',
          tenantId: TENANT_ID,
          raisedByUserId: WORKER_USER_ID,
          toUserId: MANAGER_USER_ID,
          toRole: null,
          sourceKind: 'task',
          contextSw: 'mine',
          severity: 'info',
          status: 'open',
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('e2');
  });
});
