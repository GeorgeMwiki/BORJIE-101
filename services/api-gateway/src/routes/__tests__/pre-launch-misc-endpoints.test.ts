/**
 * pre-launch-misc-endpoints tests — Wave PRE-LAUNCH-MISC.
 *
 * Verifies the 12 backend endpoints surfaced by the wiring agents:
 *
 *   - GET  /api/v1/mining/cockpit/decisions
 *   - GET  /api/v1/mining/cockpit/sic-pings
 *   - POST /api/v1/mining/incidents/:id/close
 *   - GET  /api/v1/mining/csr-plans
 *   - GET  /api/v1/mining/reports
 *   - POST /api/v1/mining/reports/:id/share
 *   - GET  /api/v1/mining/attendance
 *   - GET  /api/v1/mining/attendance/toolbox-topics
 *   - GET  /api/v1/mining/attendance/headcount
 *   - GET  /api/v1/mining/documents
 *   - GET  /api/v1/currency-rates
 *   - GET  /api/v1/warehouse/items (daysRemaining decoration)
 *
 * Each endpoint gets:
 *   1. auth-gate test (401 without token)
 *   2. happy-path test (returns 200/202 with envelope)
 *   3. validation/edge test (bad query/body returns 400 or graceful fallback)
 *
 * Tests use a stub `db` injected on context to bypass the real Postgres
 * connection. The stub returns deterministic rows so the response
 * envelope can be asserted without hitting a database.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

// Lazy router imports so the `process.env` setup above runs before the
// route modules read it during import.
import { miningIncidentsRouter } from '../mining/incidents.hono';
import { miningCockpitRouter } from '../mining/cockpit.hono';
import { miningReportsRouter } from '../mining/reports.hono';
import { miningAttendanceRouter } from '../mining/attendance.hono';
import { miningDocumentsRouter } from '../mining/documents.hono';
import { miningCsrPlansRouter } from '../mining/csr-plans.hono';
import { currencyRatesRouter } from '../currency-rates.hono';
import warehouseRouter from '../warehouse.router';

function bearer(
  role: UserRole = UserRole.ADMIN,
  userId = 'usr-test',
  tenantId = 'tnt-test',
): string {
  return `Bearer ${generateToken({
    userId,
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Build a chainable Drizzle-like stub. Each query-builder method
 * (`select`, `from`, `where`, `orderBy`, `limit`, `groupBy`) returns
 * `this` so the route can compose them; the terminal `then` (or
 * iteration) resolves to the supplied `rows` array. `update().set().where().returning()`
 * resolves to `updatedRows`. `insert().values().returning()` returns
 * `insertedRows`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDbStub(rows: any[] = [], updatedRows: any[] = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    rows,
    updatedRows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: () => chain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    // Make the chain await-able as the result of `select().from(...)`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve: any) => resolve(rows),
    update: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: () => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: () => ({
          returning: async () => updatedRows,
        }),
      }),
    }),
    insert: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      values: () => ({
        returning: async () => updatedRows,
      }),
    }),
    // R4 2026-05-29 — the database middleware now invokes
    // `database.execute(sql\`SELECT set_config(...)\`)` to install the
    // RLS tenant GUC before any handler runs (services/api-gateway/
    // src/middleware/database.ts:333). When the stub omitted `execute`
    // the call threw and the middleware short-circuited every endpoint
    // with a 500 RLS_CONTEXT_FAILED. Provide a no-op resolver so the
    // RLS step succeeds for the test stub.
    async execute(): Promise<unknown> {
      return { rows: [] };
    },
  };
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachContext(opts: { db?: any; services?: any } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    // Pre-inject db/services so the middleware skips its real lookup
    // path (per services/api-gateway/src/middleware/database.ts §324).
    if (opts.db !== undefined) c.set('db', opts.db);
    if (opts.services !== undefined) c.set('services', opts.services);
    await next();
  };
}

function mount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routerOrPath:
    | { prefix: string; router: unknown }
    | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contextOpts: { db?: any; services?: any } = {},
): Hono {
  const app = new Hono();
  app.use('*', attachContext(contextOpts));
  if (routerOrPath) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.route(routerOrPath.prefix, routerOrPath.router as any);
  }
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

// ===========================================================================
// 1) GET /api/v1/mining/cockpit/decisions
// ===========================================================================

describe('GET /api/v1/mining/cockpit/decisions', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/cockpit', router: miningCockpitRouter },
      {},
    );
    const res = await app.request('/cockpit/decisions');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty items when db is null', async () => {
    const app = mount(
      { prefix: '/cockpit', router: miningCockpitRouter },
      { db: null },
    );
    const res = await app.request('/cockpit/decisions', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { items: unknown[]; note?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
  });

  it('returns items from stub db on happy path', async () => {
    const stub = buildDbStub([
      { id: 'apr-1', tenantId: 'tnt-test', status: 'pending' },
    ]);
    const app = mount(
      { prefix: '/cockpit', router: miningCockpitRouter },
      { db: stub },
    );
    const res = await app.request('/cockpit/decisions', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { items: { id: string }[] };
    };
    expect(body.data.items.length).toBe(1);
    expect(body.data.items[0]?.id).toBe('apr-1');
  });
});

// ===========================================================================
// 2) GET /api/v1/mining/cockpit/sic-pings
// ===========================================================================

describe('GET /api/v1/mining/cockpit/sic-pings', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/cockpit', router: miningCockpitRouter },
      {},
    );
    const res = await app.request('/cockpit/sic-pings');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty items when db is null', async () => {
    const app = mount(
      { prefix: '/cockpit', router: miningCockpitRouter },
      { db: null },
    );
    const res = await app.request('/cockpit/sic-pings', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { items: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
  });

  it('returns ping rows from stub db on happy path', async () => {
    const stub = buildDbStub([
      { id: 'ping-1', status: 'ok', noteSw: 'Yote vizuri' },
    ]);
    const app = mount(
      { prefix: '/cockpit', router: miningCockpitRouter },
      { db: stub },
    );
    const res = await app.request('/cockpit/sic-pings', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { items: { id: string }[] };
    };
    expect(body.data.items[0]?.id).toBe('ping-1');
  });
});

// ===========================================================================
// 3) POST /api/v1/mining/incidents/:id/close
// ===========================================================================

describe('POST /api/v1/mining/incidents/:id/close', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/incidents', router: miningIncidentsRouter },
      {},
    );
    const res = await app.request('/incidents/inc-1/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ closureReason: 'resolved' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when closureReason is missing', async () => {
    const stub = buildDbStub();
    const app = mount(
      { prefix: '/incidents', router: miningIncidentsRouter },
      { db: stub },
    );
    const res = await app.request('/incidents/inc-1/close', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: false;
      error: { code: string };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when incident does not exist', async () => {
    const stub = buildDbStub([]); // no existing row
    const app = mount(
      { prefix: '/incidents', router: miningIncidentsRouter },
      { db: stub },
    );
    const res = await app.request('/incidents/inc-missing/close', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ closureReason: 'duplicate report' }),
    });
    expect(res.status).toBe(404);
  });

  it('idempotent: already-closed incident returns 200 without re-mutating', async () => {
    const stub = buildDbStub(
      [{ id: 'inc-1', status: 'closed', closedAt: '2026-05-01T00:00:00Z' }],
      [],
    );
    const app = mount(
      { prefix: '/incidents', router: miningIncidentsRouter },
      { db: stub },
    );
    const res = await app.request('/incidents/inc-1/close', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ closureReason: 'already closed' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: true;
      data: { status: string };
    };
    expect(body.data.status).toBe('closed');
  });
});

// ===========================================================================
// 4) GET /api/v1/mining/csr-plans
// ===========================================================================

describe('GET /api/v1/mining/csr-plans', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/csr-plans', router: miningCsrPlansRouter },
      {},
    );
    const res = await app.request('/csr-plans');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty data when db is null', async () => {
    const app = mount(
      { prefix: '/csr-plans', router: miningCsrPlansRouter },
      { db: null },
    );
    const res = await app.request('/csr-plans', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: true; data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('rejects invalid status filter (400)', async () => {
    const app = mount(
      { prefix: '/csr-plans', router: miningCsrPlansRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/csr-plans?status=invalid', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(400);
  });

  it('returns rows from stub db on happy path', async () => {
    const stub = buildDbStub([
      {
        id: 'csr-1',
        title: 'School roof',
        category: 'education',
        deliveredPct: '42.50',
      },
    ]);
    const app = mount(
      { prefix: '/csr-plans', router: miningCsrPlansRouter },
      { db: stub },
    );
    const res = await app.request('/csr-plans', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; deliveredPct: string }[];
    };
    expect(body.data[0]?.id).toBe('csr-1');
    expect(body.data[0]?.deliveredPct).toBe('42.50');
  });
});

// ===========================================================================
// 5) GET /api/v1/mining/reports
// ===========================================================================

describe('GET /api/v1/mining/reports', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      {},
    );
    const res = await app.request('/reports');
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed since param', async () => {
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/reports?since=not-a-date', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with rows from stub db', async () => {
    const stub = buildDbStub([
      {
        id: 'rep-1',
        reportInstanceId: 'inst-daily',
        renderKind: 'html_bundle',
      },
    ]);
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      { db: stub },
    );
    const res = await app.request('/reports', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data[0]?.id).toBe('rep-1');
  });
});

// ===========================================================================
// 6) POST /api/v1/mining/reports/:id/share
// ===========================================================================

describe('POST /api/v1/mining/reports/:id/share', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      {},
    );
    const res = await app.request('/reports/rep-1/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: 'whatsapp',
        recipients: ['+255700000000'],
      }),
    });
    expect(res.status).toBe(401);
  });

  it('whatsapp channel returns wa.me deeplink', async () => {
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/reports/rep-1/share', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        channel: 'whatsapp',
        recipients: ['+255700000000'],
        caption: 'Daily brief',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: true;
      data: { deeplink: string; channel: string };
    };
    expect(body.data.channel).toBe('whatsapp');
    expect(body.data.deeplink).toMatch(/^https:\/\/wa\.me\/255700000000/);
  });

  it('sms channel returns 503 NOTIFICATION_SINK_UNAVAILABLE', async () => {
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/reports/rep-1/share', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        channel: 'sms',
        recipients: ['+255700000000'],
      }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: false;
      error: { code: string };
    };
    expect(body.error.code).toBe('NOTIFICATION_SINK_UNAVAILABLE');
  });

  it('rejects empty recipients array (400)', async () => {
    const app = mount(
      { prefix: '/reports', router: miningReportsRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/reports/rep-1/share', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        channel: 'whatsapp',
        recipients: [],
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 7) GET /api/v1/mining/attendance
// ===========================================================================

describe('GET /api/v1/mining/attendance', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      {},
    );
    const res = await app.request('/attendance');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty data when db is null', async () => {
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      { db: null },
    );
    const res = await app.request('/attendance', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns rows from stub db', async () => {
    const stub = buildDbStub([
      { id: 'att-1', employeeId: 'usr-test', workDate: '2026-05-27' },
    ]);
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      { db: stub },
    );
    const res = await app.request('/attendance', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data[0]?.id).toBe('att-1');
  });
});

// ===========================================================================
// 8) GET /api/v1/mining/attendance/toolbox-topics
// ===========================================================================

describe('GET /api/v1/mining/attendance/toolbox-topics', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      {},
    );
    const res = await app.request('/attendance/toolbox-topics');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty items when db is null', async () => {
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      { db: null },
    );
    const res = await app.request('/attendance/toolbox-topics', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: unknown[] };
    };
    expect(body.data.items).toEqual([]);
  });

  it('returns topic rows on happy path', async () => {
    const stub = buildDbStub([
      { id: 'top-1', topicSw: 'Usalama wa milipuko', scheduledFor: '2026-05-27' },
    ]);
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      { db: stub },
    );
    const res = await app.request('/attendance/toolbox-topics', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: { id: string }[] };
    };
    expect(body.data.items[0]?.id).toBe('top-1');
  });
});

// ===========================================================================
// 9) GET /api/v1/mining/attendance/headcount
// ===========================================================================

describe('GET /api/v1/mining/attendance/headcount', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      {},
    );
    const res = await app.request('/attendance/headcount?groupBy=site');
    expect(res.status).toBe(401);
  });

  it('rejects invalid groupBy value (400)', async () => {
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/attendance/headcount?groupBy=employee', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(400);
  });

  it('returns per-site rollup on happy path', async () => {
    const stub = buildDbStub([
      { siteId: 'site-1', headcount: 7 },
      { siteId: 'site-2', headcount: 3 },
    ]);
    const app = mount(
      { prefix: '/attendance', router: miningAttendanceRouter },
      { db: stub },
    );
    const res = await app.request('/attendance/headcount?groupBy=site', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { groupBy: string; perSite: { siteId: string }[] };
    };
    expect(body.data.groupBy).toBe('site');
    expect(body.data.perSite.length).toBe(2);
  });
});

// ===========================================================================
// 10) GET /api/v1/mining/documents
// ===========================================================================

describe('GET /api/v1/mining/documents', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/documents', router: miningDocumentsRouter },
      {},
    );
    const res = await app.request('/documents');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty data when db is null', async () => {
    const app = mount(
      { prefix: '/documents', router: miningDocumentsRouter },
      { db: null },
    );
    const res = await app.request('/documents', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns documents on happy path', async () => {
    const stub = buildDbStub([
      { id: 'doc-1', documentType: 'national_id', fileName: 'id.jpg' },
    ]);
    const app = mount(
      { prefix: '/documents', router: miningDocumentsRouter },
      { db: stub },
    );
    const res = await app.request('/documents', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data[0]?.id).toBe('doc-1');
  });
});

// ===========================================================================
// 11) GET /api/v1/currency-rates
// ===========================================================================

describe('GET /api/v1/currency-rates', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(
      { prefix: '/currency-rates', router: currencyRatesRouter },
      {},
    );
    const res = await app.request('/currency-rates');
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid base code length', async () => {
    const app = mount(
      { prefix: '/currency-rates', router: currencyRatesRouter },
      { db: buildDbStub() },
    );
    const res = await app.request('/currency-rates?base=USDOLLAR', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(400);
  });

  it('returns rates from stub db on happy path', async () => {
    const stub = buildDbStub([
      { code: 'TZS', rateToUsd: 0.0004, asOf: '2026-05-27T00:00:00Z', source: 'manual' },
    ]);
    const app = mount(
      { prefix: '/currency-rates', router: currencyRatesRouter },
      { db: stub },
    );
    const res = await app.request('/currency-rates', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { code: string; rateToUsd: number }[];
    };
    expect(body.data[0]?.code).toBe('TZS');
  });
});

// ===========================================================================
// 12) GET /api/v1/warehouse/items (daysRemaining decoration)
// ===========================================================================

describe('GET /api/v1/warehouse/items — daysRemaining decoration', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount({ prefix: '/warehouse', router: warehouseRouter }, {});
    const res = await app.request('/warehouse/items');
    expect(res.status).toBe(401);
  });

  it('returns 503 NOT_IMPLEMENTED when warehouse service is unwired', async () => {
    const app = mount(
      { prefix: '/warehouse', router: warehouseRouter },
      { services: {} },
    );
    const res = await app.request('/warehouse/items', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: false;
      error: { code: string };
    };
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('decorates items with daysRemaining when burn rate is present', async () => {
    const warehouseStub = {
      listItems: async () => [
        {
          id: 'item-1',
          quantity: 100,
          metadata: { dailyBurnRate: 4 },
        },
        {
          id: 'item-2',
          quantity: 50,
          metadata: null, // no burn rate -> null
        },
      ],
    };
    const app = mount(
      { prefix: '/warehouse', router: warehouseRouter },
      { services: { warehouse: warehouseStub } },
    );
    const res = await app.request('/warehouse/items', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; daysRemaining: number | null }[];
    };
    expect(body.data[0]?.daysRemaining).toBe(25); // 100 / 4
    expect(body.data[1]?.daysRemaining).toBe(null);
  });
});
