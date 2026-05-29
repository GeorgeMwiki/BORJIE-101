/**
 * compliance.router tests — GET endpoints + POST error/edge cases.
 *
 * The POST /exports happy-path is covered by
 * wired-post-endpoints.test.ts. These tests add:
 *
 *   GET /
 *     - 401 without bearer
 *     - 503 when db is unwired
 *     - 200 returning a tenant-scoped slice of compliance_exports
 *     - cross-tenant denial: rows for other tenants must not leak
 *
 *   GET /exports
 *     - alias of GET /, same wire shape
 *
 *   POST /exports
 *     - 400 when the body is missing required fields
 *     - 400 when exportType is not in the enum
 *
 *   POST /exports/:id/generate
 *     - 503 when the ComplianceExportService is unwired
 *
 *   GET /exports/:id/download
 *     - 503 when the ComplianceExportService is unwired
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Stable JWT secret BEFORE the router import — authMiddleware captures
// the secret at module init.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

import complianceRouter from '../compliance.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

type Row = Record<string, unknown>;

const TEST_TENANT = 'tnt_1';
const TEST_USER = 'usr-owner-1';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT,
    role: UserRole.TENANT_ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Resolve a Drizzle table's underlying SQL name by walking the symbols
 * it carries. Mirrors the approach used by
 * `routes/__tests__/wired-post-endpoints.test.ts`.
 */
function tableName(table: unknown): string {
  if (table == null || typeof table !== 'object') return '';
  for (const sym of Object.getOwnPropertySymbols(table)) {
    if (sym.toString().includes('Name')) {
      return (table as Record<symbol, string>)[sym] ?? '';
    }
  }
  return '';
}

/**
 * Walk the Drizzle eq() AST to extract the bound value for a
 * tenant_id comparison.
 *
 * Drizzle 0.45 emits an `eq(col, val)` as a `SQL` instance whose
 * `queryChunks` is `[StringChunk(''), Column { name: 'tenant_id', … },
 * StringChunk(' = '), Param { value: 'tnt_1' }, StringChunk('')]`.
 * We look for a Column with `name === 'tenant_id'` followed by a
 * Param node and return its `value` if it is a string.
 */
function extractTenantFilter(cond: unknown): string | undefined {
  const sql = cond as { queryChunks?: unknown[] } | undefined;
  if (!sql?.queryChunks || !Array.isArray(sql.queryChunks)) return undefined;
  let sawTenantColumn = false;
  for (const chunk of sql.queryChunks) {
    if (chunk == null || typeof chunk !== 'object') continue;
    const cell = chunk as Record<string, unknown>;
    if (cell.name === 'tenant_id') {
      sawTenantColumn = true;
      continue;
    }
    if (sawTenantColumn && typeof cell.value === 'string') {
      return cell.value;
    }
  }
  return undefined;
}

function fakeDb(seeded: Row[]) {
  const select = () => ({
    from(table: unknown) {
      const matched = tableName(table) === 'compliance_exports';
      let tenant: string | undefined;
      const qb = {
        where(cond: unknown) {
          tenant = extractTenantFilter(cond);
          return qb;
        },
        orderBy() {
          return qb;
        },
        async limit(_n: number) {
          if (!matched) return [];
          if (tenant === undefined) return seeded;
          return seeded.filter((row) => row.tenantId === tenant);
        },
      };
      return qb;
    },
  });
  return { select };
}

function seedRow(over: Row): Row {
  return {
    id: 'cex_seed',
    tenantId: TEST_TENANT,
    exportType: 'tz_tra',
    format: 'csv',
    status: 'scheduled',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...over,
  };
}

/**
 * Mount the compliance router under a tiny outer middleware that
 * injects the `services` container the handler reads.
 */
function mountWithServices(services: unknown): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/', complianceRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

// ---------------------------------------------------------------------------
// GET / — list compliance exports
// ---------------------------------------------------------------------------

describe('GET /compliance/', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithServices({ db: fakeDb([]) });
    const res = await app.request('/');
    expect(res.status).toBe(401);
  });

  it('returns 503 when the DB is unwired', async () => {
    const app = mountWithServices({ db: undefined });
    const res = await app.request('/', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/DATABASE_URL/);
  });

  it('returns 200 with the tenant-scoped slice of compliance_exports', async () => {
    const seeded = [
      seedRow({ id: 'cex_a', exportType: 'tz_tra' }),
      seedRow({ id: 'cex_b', exportType: 'ke_dpa' }),
    ];
    const app = mountWithServices({ db: fakeDb(seeded) });
    const res = await app.request('/', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((row) => row.id).sort()).toEqual([
      'cex_a',
      'cex_b',
    ]);
  });

  it('does not leak rows that belong to another tenant', async () => {
    const seeded = [
      seedRow({ id: 'cex_mine' }),
      seedRow({ id: 'cex_theirs', tenantId: 'tnt_other' }),
    ];
    const app = mountWithServices({ db: fakeDb(seeded) });
    const res = await app.request('/', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe('cex_mine');
  });
});

// ---------------------------------------------------------------------------
// GET /exports — alias of GET /
// ---------------------------------------------------------------------------

describe('GET /compliance/exports', () => {
  it('returns the same wire shape as GET /', async () => {
    const seeded = [seedRow({ id: 'cex_alias' })];
    const app = mountWithServices({ db: fakeDb(seeded) });
    const res = await app.request('/exports', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data[0]?.id).toBe('cex_alias');
  });
});

// ---------------------------------------------------------------------------
// POST /exports — error / edge cases. The happy path is covered by the
// wired-post-endpoints suite.
// ---------------------------------------------------------------------------

describe('POST /compliance/exports — validation', () => {
  it('rejects a body missing required fields (400)', async () => {
    const app = mountWithServices({ db: fakeDb([]) });
    const res = await app.request('/exports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an exportType outside the enum (400)', async () => {
    const app = mountWithServices({ db: fakeDb([]) });
    const res = await app.request('/exports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        exportType: 'eu_gdpr',
        periodStart: '2026-01-01T00:00:00Z',
        periodEnd: '2026-03-31T23:59:59Z',
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /exports/:id/generate + GET /exports/:id/download — service gating
// ---------------------------------------------------------------------------

describe('POST /compliance/exports/:id/generate', () => {
  it('returns 503 when the ComplianceExportService is not wired', async () => {
    const app = mountWithServices({ db: fakeDb([]) });
    const res = await app.request('/exports/cex_a/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not yet wired/);
  });
});

describe('GET /compliance/exports/:id/download', () => {
  it('returns 503 when the ComplianceExportService is not wired', async () => {
    const app = mountWithServices({ db: fakeDb([]) });
    const res = await app.request('/exports/cex_a/download', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not yet wired/);
  });
});
