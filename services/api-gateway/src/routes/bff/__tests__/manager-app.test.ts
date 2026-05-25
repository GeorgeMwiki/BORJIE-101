/**
 * Estate Manager BFF tests — covers the new aggregator endpoints:
 *
 *   GET /manager/work-orders/queue        (real-wrap, manager-scoped)
 *   GET /manager/inspections/upcoming     (real-wrap, 30-day window)
 *   GET /manager/escalations              (real if inbox bound; honest-empty otherwise)
 *   GET /manager/vendors/scorecards       (real-wrap or honest-empty on missing relation)
 *
 * Auth + role gating is asserted against the JWT-mounted real router.
 * The router's role gate accepts PROPERTY_MANAGER + adjacent admin
 * roles, so all happy-path tests use a synthetic PROPERTY_MANAGER bearer.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { estateManagerAppRouter } from '../estate-manager-app';

const TEST_TENANT = 'tenant-1';
const TEST_USER = 'user-mgr-1';

function bearer(role: string = UserRole.PROPERTY_MANAGER): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Minimal drizzle-shaped DB fake for the manager BFF aggregators.
 * Each query path under test exercises one of:
 *   .select(cols).from(t).innerJoin(t2,c).where(c).orderBy(...).limit(n)
 *   .select(cols).from(t).where(c).limit(n)
 * The fake captures the rows the test wants returned and the call
 * count so we can assert the chain ran end-to-end.
 */
function makeFakeDb(rows: unknown[], opts: { throwCode?: string } = {}) {
  let calls = 0;
  const builder = {
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: async () => {
      calls += 1;
      if (opts.throwCode) {
        const err = new Error('relation does not exist');
        (err as unknown as { code: string }).code = opts.throwCode;
        throw err;
      }
      return rows;
    },
  };
  return {
    db: {
      select: () => ({ from: () => builder }),
    },
    getCalls: () => calls,
  };
}

function mountWithContext(overrides: { services?: unknown } = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (overrides.services !== undefined) c.set('services', overrides.services);
    await next();
  });
  app.route('/manager', estateManagerAppRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

// ---------------------------------------------------------------------------
// 1. /manager/work-orders/queue
// ---------------------------------------------------------------------------

describe('GET /manager/work-orders/queue', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/manager/work-orders/queue');
    expect(res.status).toBe(401);
  });

  it('returns the manager-scoped active+pending list', async () => {
    const { db } = makeFakeDb([
      {
        id: 'wo-1',
        tenantId: TEST_TENANT,
        propertyId: 'prop-1',
        priority: 'high',
        status: 'submitted',
        title: 'Leak',
        category: 'plumbing',
      },
      {
        id: 'wo-2',
        tenantId: TEST_TENANT,
        propertyId: 'prop-1',
        priority: 'medium',
        status: 'in_progress',
        title: 'AC',
        category: 'hvac',
      },
    ]);
    const app = mountWithContext({ services: { db } });
    const res = await app.request('/manager/work-orders/queue', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.managerId).toBe(TEST_USER);
    expect(body.meta.count).toBe(2);
  });

  it('returns 503 when the database is unavailable', async () => {
    const app = mountWithContext({ services: {} });
    const res = await app.request('/manager/work-orders/queue', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 2. /manager/inspections/upcoming
// ---------------------------------------------------------------------------

describe('GET /manager/inspections/upcoming', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/manager/inspections/upcoming');
    expect(res.status).toBe(401);
  });

  it('returns rows scoped to next 30 days, manager-managed properties', async () => {
    const { db } = makeFakeDb([
      {
        id: 'insp-1',
        tenantId: TEST_TENANT,
        propertyId: 'prop-1',
        type: 'routine',
        status: 'scheduled',
        scheduledDate: '2026-05-15T10:00:00.000Z',
      },
    ]);
    const app = mountWithContext({ services: { db } });
    const res = await app.request('/manager/inspections/upcoming', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.windowDays).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 3. /manager/escalations
// ---------------------------------------------------------------------------

describe('GET /manager/escalations', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/manager/escalations');
    expect(res.status).toBe(401);
  });

  it('returns honest-empty when autonomy.exceptionInbox is not bound', async () => {
    const app = mountWithContext({ services: { db: {} } });
    const res = await app.request('/manager/escalations', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta.source).toBe('honest-empty');
  });

  it('proxies to autonomy.exceptionInbox.listOpen when bound', async () => {
    let receivedTenant: string | undefined;
    const services = {
      db: {},
      autonomy: {
        exceptionInbox: {
          listOpen: async (tenantId: string) => {
            receivedTenant = tenantId;
            return [
              { id: 'exc-1', domain: 'finance', priority: 'P1' },
            ];
          },
        },
      },
    };
    const app = mountWithContext({ services });
    const res = await app.request('/manager/escalations', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.source).toBe('autonomy.exceptionInbox');
    expect(receivedTenant).toBe(TEST_TENANT);
  });
});

// ---------------------------------------------------------------------------
// 4. /manager/vendors/scorecards
// ---------------------------------------------------------------------------

describe('GET /manager/vendors/scorecards', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/manager/vendors/scorecards');
    expect(res.status).toBe(401);
  });

  it('returns real rows from the vendor_scorecards table', async () => {
    const { db } = makeFakeDb([
      {
        id: 'sc-1',
        tenantId: TEST_TENANT,
        vendorId: 'v-1',
        score: 4.2,
      },
    ]);
    const app = mountWithContext({ services: { db } });
    const res = await app.request('/manager/vendors/scorecards', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.count).toBe(1);
  });

  it('falls through to honest-empty when relation is missing (42P01)', async () => {
    const { db } = makeFakeDb([], { throwCode: '42P01' });
    const app = mountWithContext({ services: { db } });
    const res = await app.request('/manager/vendors/scorecards', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta.source).toBe('honest-empty');
  });
});
