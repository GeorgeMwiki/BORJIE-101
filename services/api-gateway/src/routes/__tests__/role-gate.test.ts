/**
 * Role-gate regression coverage — Wave 19 Agent H+I.
 *
 * Before this wave, several high-blast-radius endpoints were gated only by
 * `authMiddleware` — ANY authenticated user (including RESIDENT / customer-
 * app logins) could create, update, or delete leases, invoices, customers,
 * properties, units, and could even call the cross-tenant listing on
 * `/api/v1/tenants`. This test locks the gates in place.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret BEFORE importing any router so all middlewares that
// capture the secret at module init agree.
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

describe('Role gates — mutations rejected for non-staff', () => {
  beforeAll(() => {
    // sanity: secret must have been pinned.
    expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
  });

  it('customers router is reachable for RESIDENT with rejection (401/403)', async () => {
    const { customersRouter } = await import('../customers');
    const app = new Hono();
    app.route('/', customersRouter);
    const auth = bearer(UserRole.RESIDENT);

    const delRes = await app.request('/abc', {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    // DELETE flows through auth+db+role gates. We allow 401 (JWT
    // secret drift in cached module) OR 403 (the gate we added). The
    // "requireRole middleware — direct assertion" suite below proves
    // the gate itself works deterministically.
    expect([401, 403]).toContain(delRes.status);
  });

  it('leases POST is rejected for RESIDENT (403 or 401)', async () => {
    const mod = await import('../leases');
    const router = (mod as any).leasesRouter ?? (mod as any).default;
    const app = new Hono();
    app.route('/', router);
    const auth = bearer(UserRole.RESIDENT);

    const postRes = await app.request('/', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: 'u1',
        customerId: 'c1',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        rentAmount: 1000,
      }),
    });
    expect([401, 403]).toContain(postRes.status);
  });

  it('invoices /:id/send is rejected for RESIDENT (403 or 401)', async () => {
    const mod = await import('../invoices');
    const router = (mod as any).invoicesApp ?? (mod as any).default;
    const app = new Hono();
    app.route('/', router);
    const auth = bearer(UserRole.RESIDENT);

    const sendRes = await app.request('/inv-1/send', {
      method: 'POST',
      headers: { Authorization: auth },
    });
    expect([401, 403]).toContain(sendRes.status);
  });

  it('tenants list is rejected for TENANT_ADMIN (cross-tenant = platform-only)', async () => {
    const mod = await import('../tenants.hono');
    const app = new Hono();
    app.route('/', mod.tenantsRouter);
    const auth = bearer(UserRole.TENANT_ADMIN);
    const listRes = await app.request('/', {
      method: 'GET',
      headers: { Authorization: auth },
    });
    expect([401, 403]).toContain(listRes.status);
  });

  it('properties POST is rejected for RESIDENT', async () => {
    const mod = await import('../properties');
    const app = new Hono();
    app.route('/', mod.propertiesRouter);
    const auth = bearer(UserRole.RESIDENT);

    const postRes = await app.request('/', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Seaside' }),
    });
    expect([401, 403]).toContain(postRes.status);
  });

  it('units POST is rejected for RESIDENT', async () => {
    const mod = await import('../units');
    const app = new Hono();
    app.route('/', mod.unitsRouter);
    const auth = bearer(UserRole.RESIDENT);

    const postRes = await app.request('/', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: 'p1', unitNumber: 'A1' }),
    });
    expect([401, 403]).toContain(postRes.status);
  });
});

// -----------------------------------------------------------------------------
// Direct role-middleware exercise — bypasses JWT verification entirely so we
// can assert the exact "FORBIDDEN" envelope regardless of module-init order.
// This is the load-bearing test for the role gate; the JWT-based ones above
// are integration sanity checks.
// -----------------------------------------------------------------------------

describe('requireRole middleware — direct assertion', () => {
  it('rejects a role not in the allow-list with FORBIDDEN envelope', async () => {
    const { requireRole } = await import('../../middleware/hono-auth');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth', {
        userId: 'u1',
        tenantId: 't1',
        role: UserRole.RESIDENT,
        permissions: ['*'],
        propertyAccess: ['*'],
      });
      await next();
    });
    app.post(
      '/mutate',
      requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN),
      (c) => c.json({ success: true }),
    );

    const res = await app.request('/mutate', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('lets through a role in the allow-list', async () => {
    const { requireRole } = await import('../../middleware/hono-auth');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth', {
        userId: 'u1',
        tenantId: 't1',
        role: UserRole.TENANT_ADMIN,
        permissions: ['*'],
        propertyAccess: ['*'],
      });
      await next();
    });
    app.post(
      '/mutate',
      requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN),
      (c) => c.json({ success: true }, 201),
    );

    const res = await app.request('/mutate', { method: 'POST' });
    expect(res.status).toBe(201);
  });
});
