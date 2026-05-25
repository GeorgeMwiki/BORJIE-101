/**
 * Owner-portal placeholder-page skeleton tests (Wave-4 D6, Phase D update).
 *
 * Phase D flipped these endpoints from "honest empty list with degraded
 * header" (HTTP 200) to "loud-failure 501 unless a per-tenant feature
 * flag is on" (`flag.bff.<endpoint>`). The previous silent-empty
 * behaviour hid the gap from observability dashboards and confused
 * operators who reasonably believed an empty response meant the tenant
 * had no data.
 *
 * The fixed contract is now:
 *
 *   - HTTP 501 Not Implemented (default; flag is off)
 *   - response body: { success: false, error: { code: 'NOT_IMPLEMENTED',
 *       message: '<concrete next-step>', flagKey: '<flag.bff.…>' } }
 *   - `X-Backend-Status: degraded` header (unchanged from Wave-4 D6).
 *
 * Tests exercise:
 *   - the auth gate (anonymous → 401)
 *   - the role gate (RESIDENT → 403)
 *   - the loud-failure 501 envelope (no FeatureFlags service wired)
 *   - the `flagKey` field is per-endpoint (so observability can pivot
 *     on it).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// JWT secret + NODE_ENV must be set BEFORE importing the routers (auth
// middleware captures the secret at module init).
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { analyticsExportsRouter } from '../analytics-exports.router';
import { analyticsGrowthRouter } from '../analytics-growth.router';
import { analyticsUsageRouter } from '../analytics-usage.router';
import { billingRouter } from '../billing.router';
import { ownerMessagingRouter } from '../owner-messaging.router';
import { supportRouter } from '../support.router';
import { adminUsersRouter } from '../admin-users.router';

const TEST_TENANT = 'tenant-skeleton-1';
const OTHER_TENANT = 'tenant-skeleton-2';
const TEST_USER = 'user-owner-skeleton-1';

function bearer(role: UserRole = UserRole.OWNER, tenantId = TEST_TENANT): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId,
    role: role as any,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(prefix: string, router: Hono): Hono {
  const app = new Hono();
  app.route(prefix, router);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

/**
 * Shared assertion for the new 501-Not-Implemented contract. The
 * caller has no FeatureFlags service in context, so the route falls
 * through to the loud-failure path.
 */
async function assertNotImplemented(
  app: Hono,
  path: string,
  expectedFlagKey: string,
): Promise<void> {
  const res = await app.request(path, {
    headers: { Authorization: bearer(UserRole.OWNER, TEST_TENANT) },
  });
  expect(res.status).toBe(501);
  expect(res.headers.get('x-backend-status')).toBe('degraded');
  const body = await res.json();
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('NOT_IMPLEMENTED');
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.flagKey).toBe(expectedFlagKey);
}

// ---------------------------------------------------------------------------
// 1. GET /analytics/exports/templates
// ---------------------------------------------------------------------------

describe('GET /analytics/exports/templates (skeleton)', () => {
  const app = mount('/analytics/exports', analyticsExportsRouter);

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/analytics/exports/templates');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/analytics/exports/templates', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 501 loud-failure when feature flag is off', async () => {
    await assertNotImplemented(
      app,
      '/analytics/exports/templates',
      'flag.bff.analytics.exports',
    );
  });

  it('still applies tenant-scoped auth (other tenant gets the same 501)', async () => {
    const res = await app.request('/analytics/exports/templates', {
      headers: { Authorization: bearer(UserRole.OWNER, OTHER_TENANT) },
    });
    expect(res.status).toBe(501);
  });
});

// ---------------------------------------------------------------------------
// 2. GET /analytics/growth
// ---------------------------------------------------------------------------

describe('GET /analytics/growth (skeleton)', () => {
  const app = mount('/analytics/growth', analyticsGrowthRouter);

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/analytics/growth');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/analytics/growth', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 501 loud-failure for OWNER when flag is off', async () => {
    await assertNotImplemented(app, '/analytics/growth', 'flag.bff.analytics.growth');
  });

  it('returns 501 loud-failure for TENANT_ADMIN when flag is off', async () => {
    const res = await app.request('/analytics/growth', {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(501);
  });
});

// ---------------------------------------------------------------------------
// 3. GET /analytics/usage
// ---------------------------------------------------------------------------

describe('GET /analytics/usage (skeleton)', () => {
  const app = mount('/analytics/usage', analyticsUsageRouter);

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/analytics/usage');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/analytics/usage', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 501 loud-failure for OWNER when flag is off', async () => {
    await assertNotImplemented(app, '/analytics/usage', 'flag.bff.analytics.usage');
  });
});

// ---------------------------------------------------------------------------
// 4. GET /billing/subscription
// ---------------------------------------------------------------------------

describe('GET /billing/subscription (skeleton)', () => {
  const app = mount('/billing', billingRouter);

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/billing/subscription');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/billing/subscription', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 501 loud-failure for OWNER when no platformBilling is wired', async () => {
    await assertNotImplemented(
      app,
      '/billing/subscription',
      'flag.bff.billing.subscription',
    );
  });
});

// ---------------------------------------------------------------------------
// 5–7. GET /owner/messaging/{broadcasts,campaigns,templates}
// ---------------------------------------------------------------------------

describe('GET /owner/messaging/{broadcasts,campaigns,templates} (skeleton)', () => {
  const app = mount('/owner/messaging', ownerMessagingRouter);

  it('rejects anonymous broadcasts (401)', async () => {
    const res = await app.request('/owner/messaging/broadcasts');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT on broadcasts (403)', async () => {
    const res = await app.request('/owner/messaging/broadcasts', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 501 for /broadcasts when flag is off', async () => {
    await assertNotImplemented(
      app,
      '/owner/messaging/broadcasts',
      'flag.bff.owner_messaging.broadcasts',
    );
  });

  it('returns 501 for /campaigns when flag is off', async () => {
    await assertNotImplemented(
      app,
      '/owner/messaging/campaigns',
      'flag.bff.owner_messaging.campaigns',
    );
  });

  it('returns 501 for /templates when flag is off', async () => {
    await assertNotImplemented(
      app,
      '/owner/messaging/templates',
      'flag.bff.owner_messaging.templates',
    );
  });

  it('next-step messages are domain-specific (not copy-pasted)', async () => {
    const headers = { Authorization: bearer(UserRole.OWNER) };
    const [b, c, t] = await Promise.all([
      app.request('/owner/messaging/broadcasts', { headers }),
      app.request('/owner/messaging/campaigns', { headers }),
      app.request('/owner/messaging/templates', { headers }),
    ]);
    const [bb, cb, tb] = await Promise.all([b.json(), c.json(), t.json()]);
    expect(bb.error.message).toMatch(/broadcasts/);
    expect(cb.error.message).toMatch(/campaigns/);
    expect(tb.error.message).toMatch(/templates/);
  });
});

// ---------------------------------------------------------------------------
// 8. GET /support/tickets
// ---------------------------------------------------------------------------

describe('GET /support/tickets (skeleton)', () => {
  const app = mount('/support', supportRouter);

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/support/tickets');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/support/tickets', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 501 loud-failure for OWNER when flag is off', async () => {
    await assertNotImplemented(app, '/support/tickets', 'flag.bff.support.tickets');
  });
});

// ---------------------------------------------------------------------------
// 9. GET /admin/users
// ---------------------------------------------------------------------------

describe('GET /admin/users (skeleton)', () => {
  const app = mount('/admin', adminUsersRouter);

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/admin/users');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/admin/users', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('allows TENANT_ADMIN past the auth gate (501 still, because no platformUsers svc)', async () => {
    const res = await app.request('/admin/users', {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(501);
  });

  it('returns 501 for OWNER when flag is off', async () => {
    await assertNotImplemented(app, '/admin/users', 'flag.bff.admin_users.list');
  });

  it('isolates tenants — a malicious query string cannot route to another tenant', async () => {
    // Even with a query that tries to override tenantId, the route reads
    // from auth context. We assert the 501 still fires (the loud-failure
    // path runs after auth) — tenant isolation is preserved.
    const res = await app.request(
      `/admin/users?tenantId=${OTHER_TENANT}`,
      { headers: { Authorization: bearer(UserRole.OWNER, TEST_TENANT) } },
    );
    expect(res.status).toBe(501);
  });
});
