/**
 * GET /api/v1/mining/accounting/ledger — router contract (WS-4).
 *
 * The route now READS the REAL payments-ledger `ledger_entries` via the
 * `listLedgerLines` projection (proven end-to-end against a real Postgres in
 * `packages/database/src/__tests__/analytics-warehouse.integration.test.ts`).
 * Here we assert the gateway contract with a stub `db`:
 *   - anonymous → 401;
 *   - OWNER → 200 with the projected journal lines (each carrying an ISO-4217
 *     currency — money never hardcoded);
 *   - an invalid query (bad range / limit) → 400.
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
import { miningAccountingRouter } from '../accounting.hono';

const TENANT = 'tenant-acct-1';

function bearer(role: UserRole = UserRole.OWNER, tenantId = TENANT): string {
  return `Bearer ${generateToken({
    userId: 'user-acct-1',
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/** Stub Drizzle client whose fluent SELECT resolves to `rows`. */
function makeStubDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = ret;
  chain.from = ret;
  chain.where = ret;
  chain.orderBy = ret;
  chain.limit = () => Promise.resolve(rows);
  chain.execute = () => Promise.resolve(rows);
  return chain;
}

function mount(db: unknown): Hono {
  const app = new Hono();
  app.use('/api/v1/mining/accounting/*', async (c, next) => {
    c.set('db', db as never);
    c.set('repos', null as never);
    await next();
  });
  app.route('/api/v1/mining/accounting', miningAccountingRouter);
  return app;
}

const ledgerRows = [
  {
    id: 'le-1',
    journalId: 'jr-1',
    accountId: 'acct-1',
    type: 'RENT_PAYMENT',
    direction: 'CREDIT',
    amountMinorUnits: 7000,
    balanceAfterMinorUnits: 12000,
    currency: 'TZS',
    effectiveDate: new Date(),
    postedAt: new Date(),
    description: 'sale',
    paymentIntentId: null,
  },
];

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('GET /mining/accounting/ledger (real journals)', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mount(makeStubDb(ledgerRows));
    const res = await app.request('/api/v1/mining/accounting/ledger');
    expect(res.status).toBe(401);
  });

  it('returns 200 with real journal lines for OWNER', async () => {
    const app = mount(makeStubDb(ledgerRows));
    const res = await app.request('/api/v1/mining/accounting/ledger', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    // Real projected shape — carries currency (never hardcoded downstream).
    expect(body.data[0]).toMatchObject({
      journalId: 'jr-1',
      direction: 'CREDIT',
      amountMinorUnits: 7000,
      currency: 'TZS',
    });
  });

  it('rejects an invalid range token (400)', async () => {
    const app = mount(makeStubDb(ledgerRows));
    const res = await app.request('/api/v1/mining/accounting/ledger?range=99z', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(400);
  });

  it('returns an empty list (not an error) when the tenant has no journals', async () => {
    const app = mount(makeStubDb([]));
    const res = await app.request('/api/v1/mining/accounting/ledger', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});
