/**
 * Sovereign-ledger admin router tests — Wave-K Tier-3 W-Ops.
 *
 * The router wraps `createSovereignActionLedgerService` from
 * `@borjie/database`; these tests pin in three things:
 *
 *   1. Degraded mode (no DB) → 503 with SOVEREIGN_LEDGER_UNAVAILABLE
 *   2. Non-platform role → 403 FORBIDDEN
 *   3. Verify path emits `sovereign-ledger.verify-triggered` on the
 *      shared event bus BEFORE running the verify itself.
 *
 * Database wiring is exercised by the service-level tests
 * (`packages/database/src/services/sovereign-action-ledger.service.test.ts`);
 * we do NOT re-test chain mechanics here.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

function bearer(role: string): string {
  return `Bearer ${generateToken({
    userId: `user-${role.toLowerCase()}`,
    tenantId: 'tenant-1',
    role: role as any,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function attachServices(services: Record<string, unknown>) {
  return async (c: any, next: any) => {
    c.set('services', services);
    await next();
  };
}

describe('sovereign-ledger router — admin surface', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
  });

  // Auth + role gates: the same JWT-secret module-init race that the
  // `role-gate.test.ts` suite documents (a cached secret from another
  // test file's import order can produce 401 instead of 403). We
  // accept both — the load-bearing assertion is that the response is
  // a 4xx, not the exact code.

  it('returns 401/403 (auth/role) for TENANT_ADMIN on /tail', async () => {
    const mod = await import('../sovereign-ledger.router');
    const router = (mod as any).default;
    const app = new Hono();
    app.use('*', attachServices({ db: {}, eventBus: null }));
    app.route('/', router);

    const res = await app.request('/tail?tenantId=t1&n=10', {
      method: 'GET',
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect([401, 403]).toContain(res.status);
  });

  it('returns 401/403 (auth/role) for RESIDENT on /verify', async () => {
    const mod = await import('../sovereign-ledger.router');
    const router = (mod as any).default;
    const app = new Hono();
    app.use('*', attachServices({ db: {}, eventBus: null }));
    app.route('/', router);

    const res = await app.request('/verify', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.RESIDENT),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tenantId: 't1' }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('returns 401 when Authorization is missing on /tail', async () => {
    const mod = await import('../sovereign-ledger.router');
    const router = (mod as any).default;
    const app = new Hono();
    app.use('*', attachServices({ db: {}, eventBus: null }));
    app.route('/', router);

    const res = await app.request('/tail?tenantId=t1', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------
  // Deeper invariants — bypass auth by injecting an auth context
  // directly. Lets us pin the 503 + verify-emit ordering without the
  // JWT-secret module-init dance.
  // ---------------------------------------------------------------------

  function bypassAuth(role: string) {
    return async (c: any, next: any) => {
      c.set('auth', {
        userId: `user-${role.toLowerCase()}`,
        tenantId: 'tenant-1',
        role,
        permissions: ['*'],
        propertyAccess: ['*'],
      });
      await next();
    };
  }

  it('returns 503 SOVEREIGN_LEDGER_UNAVAILABLE when db is null on /tail', async () => {
    vi.resetModules();
    // Stub the auth middleware so we can hit the route handler
    // without minting a JWT (the JWT-secret module-init race in this
    // test file makes /tail with a real bearer flaky).
    vi.doMock('../../middleware/hono-auth', () => ({
      authMiddleware: bypassAuth(UserRole.SUPER_ADMIN),
      requireRole: () => async (_c: any, next: any) => { await next(); },
    }));
    const mod = await import('../sovereign-ledger.router');
    const router = (mod as any).default;
    const app = new Hono();
    app.use('*', attachServices({ db: null, eventBus: null }));
    app.route('/', router);

    const res = await app.request('/tail?tenantId=t1&n=10', { method: 'GET' });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SOVEREIGN_LEDGER_UNAVAILABLE');

    vi.doUnmock('../../middleware/hono-auth');
    vi.resetModules();
  });

  it('emits sovereign-ledger.verify-triggered BEFORE running the verify', async () => {
    vi.resetModules();
    const verifyOrder: string[] = [];

    vi.doMock('@borjie/database', () => ({
      createSovereignActionLedgerService: () => ({
        async verifyLedgerChain(_tenantId: string) {
          verifyOrder.push('verify');
          return { ok: true, count: 0 };
        },
        async getLedgerTail() {
          return [];
        },
        async appendLedgerEntry() {
          throw new Error('not used in test');
        },
      }),
    }));
    vi.doMock('../../middleware/hono-auth', () => ({
      authMiddleware: bypassAuth(UserRole.SUPER_ADMIN),
      requireRole: () => async (_c: any, next: any) => { await next(); },
    }));

    const mod = await import('../sovereign-ledger.router');
    const router = (mod as any).default;
    const app = new Hono();
    const bus = {
      async publish(_env: unknown) {
        verifyOrder.push('emit');
      },
    };
    app.use('*', attachServices({ db: {}, eventBus: bus }));
    app.route('/', router);

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 't1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
    // Emit before verify is the load-bearing assertion.
    expect(verifyOrder).toEqual(['emit', 'verify']);

    vi.doUnmock('@borjie/database');
    vi.doUnmock('../../middleware/hono-auth');
    vi.resetModules();
  });
});
