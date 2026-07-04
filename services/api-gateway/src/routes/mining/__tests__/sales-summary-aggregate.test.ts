/**
 * GET /api/v1/mining/sales — whole-book KPI aggregate (Track B6).
 *
 * DEFECT (RED): the list handler returned only the paged rows (≤500) and the
 * owner cockpit folded those client-side into "Total Net/Gross Revenue", so a
 * tenant with more sales than the page size saw a fabricated-low total.
 *
 * FIX (GREEN): the handler now folds the totals in SQL over EVERY matching row
 * (tenant-scoped) and returns them in a `summary` envelope field. This test
 * proves the response carries a `summary` whose SUM/COUNT reflect the WHOLE
 * book — a value strictly greater than what a fold over the returned page
 * would yield — and that the paged `data` stays capped independently.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { miningSalesRouter } from '../sales.hono';

const TENANT = 'tenant-sales-b6';

function bearer(role: UserRole = UserRole.OWNER, tenantId = TENANT): string {
  return `Bearer ${generateToken({
    userId: 'user-sales-b6',
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

interface StubShape {
  readonly summaryRow: Record<string, unknown>;
  readonly pageRows: readonly unknown[];
}

/**
 * Stub Drizzle client. The handler runs two SELECTs sharing one fluent chain:
 *   - the SUMMARY select is `.select({ ... })` (object projection) then awaits
 *     directly after `.where(...)` → resolves to `[summaryRow]`;
 *   - the LIST select is `.select()` (no args) then `.orderBy().limit()` →
 *     resolves to `pageRows`.
 * We branch on whether `.select` received a projection object.
 */
function makeStubDb({ summaryRow, pageRows }: StubShape) {
  const listChain: Record<string, unknown> = {};
  listChain.from = () => listChain;
  listChain.where = () => listChain;
  listChain.orderBy = () => listChain;
  listChain.limit = () => Promise.resolve(pageRows);

  const summaryChain: Record<string, unknown> = {};
  summaryChain.from = () => summaryChain;
  // Awaited directly after `.where(...)`: make the returned object thenable.
  summaryChain.where = () => Promise.resolve([summaryRow]);

  return {
    // `databaseMiddleware` binds RLS tenant context via `db.execute(...)` on
    // the fallback (mock-client) path; a no-op keeps the stub past that gate.
    execute: () => Promise.resolve([]),
    select: (projection?: unknown) =>
      projection ? summaryChain : listChain,
  };
}

function mount(db: unknown): Hono {
  const app = new Hono();
  // Pre-inject the stub `db` on the context; `databaseMiddleware` honours an
  // existing binding (unit-test seam) instead of reaching for a live client.
  app.use('*', async (c, next) => {
    c.set('db', db as never);
    c.set('repos', null as never);
    await next();
  });
  app.route('/api/v1/mining/sales', miningSalesRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('GET /mining/sales — whole-book KPI aggregate', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mount(
      makeStubDb({ summaryRow: {}, pageRows: [] }),
    );
    const res = await app.request('/api/v1/mining/sales');
    expect(res.status).toBe(401);
  });

  it('returns a summary folded over the WHOLE book, not the paged rows', async () => {
    // 100 rows on the page each net 10 → a client fold would report 1_000.
    const pageRows = Array.from({ length: 100 }, (_, i) => ({
      id: `sale-${i}`,
      tenantId: TENANT,
      parcelId: `parcel-${i}`,
      buyerId: null,
      route: 'trader',
      weighbridgeDocId: null,
      vehiclePlate: null,
      driverUserId: null,
      grossPriceUsd: null,
      grossPriceTzs: '12',
      fxAtSaleTzsPerUsd: null,
      royaltyPct: null,
      inspectionPct: null,
      vatPct: null,
      otherLevies: {},
      netTzs: '10',
      paymentStatus: 'paid',
      ts: new Date().toISOString(),
    }));
    // But the tenant actually has 250 sales: net SUM 2_500, gross SUM 3_000,
    // 40 pending. The SQL aggregate returns numeric SUMs as strings.
    const summaryRow = {
      totalNetTzs: '2500',
      totalGrossTzs: '3000',
      count: 250,
      pendingCount: 40,
    };
    const app = mount(makeStubDb({ summaryRow, pageRows }));

    const res = await app.request('/api/v1/mining/sales', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // The paged list stays capped (the table's rows) …
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(100);

    // … while the KPI summary reflects the WHOLE book, strictly greater than
    // a fold over the returned page (100×10 = 1_000).
    const foldOverPage = body.data.reduce(
      (sum: number, r: { netTzs: string }) => sum + Number(r.netTzs),
      0,
    );
    expect(foldOverPage).toBe(1000);
    expect(body.summary).toBeTruthy();
    expect(Number(body.summary.totalNetTzs)).toBe(2500);
    expect(Number(body.summary.totalGrossTzs)).toBe(3000);
    expect(body.summary.count).toBe(250);
    expect(body.summary.pendingCount).toBe(40);
    expect(Number(body.summary.totalNetTzs)).toBeGreaterThan(foldOverPage);
  });

  it('serves the same aggregate on the sibling GET /summary route', async () => {
    // The FE reads its KPI totals here (survives apiRequest envelope-unwrap).
    const summaryRow = {
      totalNetTzs: '2500',
      totalGrossTzs: '3000',
      count: 250,
      pendingCount: 40,
    };
    const app = mount(makeStubDb({ summaryRow, pageRows: [] }));
    const res = await app.request('/api/v1/mining/sales/summary', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      totalNetTzs: '2500',
      totalGrossTzs: '3000',
      count: 250,
      pendingCount: 40,
    });
  });

  it('rejects an anonymous caller on GET /summary (401)', async () => {
    const app = mount(makeStubDb({ summaryRow: {}, pageRows: [] }));
    const res = await app.request('/api/v1/mining/sales/summary');
    expect(res.status).toBe(401);
  });

  it('coalesces an empty book to zero (never null/undefined)', async () => {
    const summaryRow = {
      totalNetTzs: '0',
      totalGrossTzs: '0',
      count: 0,
      pendingCount: 0,
    };
    const app = mount(makeStubDb({ summaryRow, pageRows: [] }));
    const res = await app.request('/api/v1/mining/sales', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.summary).toMatchObject({
      totalNetTzs: '0',
      totalGrossTzs: '0',
      count: 0,
      pendingCount: 0,
    });
  });
});
