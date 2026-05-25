/**
 * Dual-tenant E2E fixtures — cross-tenant data-isolation suite.
 *
 * Surfaced by `.audit/deep-audit-2026-05-20.md` as a multi-tenant launch
 * blocker: there are currently ZERO tests that verify user-A-of-tenant-X
 * cannot read tenant-Y data. This fixture seeds two parallel tenants (X and
 * Y) with disjoint users, properties, and documents, then exposes a
 * Playwright fixture so each spec gets both contexts.
 *
 * Pattern follows `e2e/fixtures/seed-runner.ts` — postgres.js driver, every
 * insert guarded with `ON CONFLICT (id) DO NOTHING`, idempotent on re-run.
 *
 * Cleanup happens in `afterAll` (best-effort `DELETE … WHERE tenant_id IN
 * ('tnt_iso_x', 'tnt_iso_y')`). Between CI runs the postgres container is
 * recreated with `down -v`, so the destructive delete is safe.
 *
 * IDs intentionally stable so specs can reference them without round-tripping
 * the API just to discover an ID.
 *
 * Environment:
 *   DATABASE_URL   — postgres conn string (default mirrors seed-runner)
 *   API_GATEWAY_URL — real api-gateway base URL (default localhost:4000)
 *   E2E_ENABLE_REAL_BACKEND=1 — gate that confirms docker-compose.e2e.yml
 *                                is up; otherwise specs self-skip.
 */
import { test as base, type APIRequestContext } from '@playwright/test';
import postgres, { type Sql } from 'postgres';

const DEFAULT_DB_URL =
  'postgresql://borjie:borjie_e2e@localhost:55432/borjie_e2e';

export const API_GATEWAY_URL =
  process.env.API_GATEWAY_URL ?? 'http://localhost:4000';

export const REAL_BACKEND_ENABLED =
  process.env.E2E_ENABLE_REAL_BACKEND === '1';

// ============================================================================
// STABLE IDS — do NOT collide with seed.sql (tnt_e2e_0001) so the existing
// single-tenant suite keeps passing alongside us.
// ============================================================================

export const isolationIds = {
  tenantX: {
    tenantId: 'tnt_iso_x',
    userId: 'usr_iso_x_owner',
    email: 'iso-x-owner@borjie.test',
    propertyId: 'prp_iso_x',
    unitId: 'unt_iso_x',
    docId: 'doc_iso_x',
    distinctiveName: 'TENANT_X_VILLA_DISTINCTIVE_NAME',
  },
  tenantY: {
    tenantId: 'tnt_iso_y',
    userId: 'usr_iso_y_owner',
    email: 'iso-y-owner@borjie.test',
    propertyId: 'prp_iso_y',
    unitId: 'unt_iso_y',
    docId: 'doc_iso_y',
    distinctiveName: 'TENANT_Y_VILLA_DISTINCTIVE_NAME',
  },
} as const;

const PASSWORD_HASH =
  // bcrypt of "demo123" — same as seed.sql so the auth helpers Just Work.
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// ============================================================================
// TYPES
// ============================================================================

export interface TenantIsolationRecord {
  tenantId: string;
  userId: string;
  email: string;
  propertyId: string;
  unitId: string;
  docId: string;
  distinctiveName: string;
  jwt: string;
}

export interface DualTenantFixtures {
  tenantX: TenantIsolationRecord;
  tenantY: TenantIsolationRecord;
}

// ============================================================================
// SEED + CLEANUP
// ============================================================================

async function seedTenant(
  sql: Sql,
  ids: typeof isolationIds.tenantX,
  displayName: string,
): Promise<void> {
  await sql`
    INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
    VALUES (${ids.tenantId}, ${displayName}, ${ids.tenantId}, 'active', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, tenant_id, email, full_name, role, status, password_hash, created_at, updated_at)
    VALUES (${ids.userId}, ${ids.tenantId}, ${ids.email}, ${`Iso ${displayName} Owner`}, 'owner', 'active', ${PASSWORD_HASH}, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO properties (id, tenant_id, name, address, status, created_at, updated_at)
    VALUES (${ids.propertyId}, ${ids.tenantId}, ${ids.distinctiveName}, '99 Iso St, Nairobi', 'active', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO units (id, tenant_id, property_id, unit_number, status, monthly_rent, created_at, updated_at)
    VALUES (${ids.unitId}, ${ids.tenantId}, ${ids.propertyId}, 'ISO-1', 'vacant', 50000, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  // Documents table is optional — guard with try/catch so the fixture still
  // works if a build hasn't shipped the documents table yet.
  try {
    await sql`
      INSERT INTO documents (id, tenant_id, name, mime_type, url, created_at, updated_at)
      VALUES (${ids.docId}, ${ids.tenantId}, ${`iso-${ids.tenantId}.pdf`}, 'application/pdf', ${`/docs/${ids.docId}`}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
  } catch {
    // documents table may not exist in this build — that's fine, the
    // cross-tenant-document-access spec will self-skip via fixme().
  }
}

async function mintJwt(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  // Use the real api-gateway login endpoint to mint a JWT. If the endpoint
  // path differs ("/api/v1/auth/login" vs "/api/auth/login"), try both.
  const candidates = ['/api/v1/auth/login', '/api/auth/login'];
  for (const path of candidates) {
    const resp = await request
      .post(`${API_GATEWAY_URL}${path}`, {
        data: { email, password: 'demo123' },
        failOnStatusCode: false,
      })
      .catch(() => null);
    if (!resp || !resp.ok()) continue;
    const body = (await resp.json().catch(() => null)) as
      | { token?: string; data?: { token?: string; accessToken?: string } }
      | null;
    const token =
      body?.token ?? body?.data?.token ?? body?.data?.accessToken ?? '';
    if (token.length > 0) return token;
  }
  // Fallback: empty string — specs that need a real JWT will fixme().
  return '';
}

async function cleanup(sql: Sql): Promise<void> {
  const ids = [isolationIds.tenantX.tenantId, isolationIds.tenantY.tenantId];
  try {
    await sql`DELETE FROM documents WHERE tenant_id = ANY(${ids})`;
  } catch {
    // table optional
  }
  await sql`DELETE FROM units WHERE tenant_id = ANY(${ids})`;
  await sql`DELETE FROM properties WHERE tenant_id = ANY(${ids})`;
  await sql`DELETE FROM users WHERE tenant_id = ANY(${ids})`;
  await sql`DELETE FROM tenants WHERE id = ANY(${ids})`;
}

// ============================================================================
// FIXTURE
// ============================================================================

export const test = base.extend<DualTenantFixtures>({
  tenantX: async ({ request }, use) => {
    const record = await provisionAndUse(request, isolationIds.tenantX, 'Tenant X');
    await use(record);
  },
  tenantY: async ({ request }, use) => {
    const record = await provisionAndUse(request, isolationIds.tenantY, 'Tenant Y');
    await use(record);
  },
});

async function provisionAndUse(
  request: APIRequestContext,
  ids: typeof isolationIds.tenantX,
  displayName: string,
): Promise<TenantIsolationRecord> {
  if (!REAL_BACKEND_ENABLED) {
    // Return a record with empty JWT; specs gate on REAL_BACKEND_ENABLED.
    return { ...ids, jwt: '' };
  }
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const sql = postgres(dbUrl, { max: 1, onnotice: () => undefined });
  try {
    await seedTenant(sql, ids, displayName);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const jwt = await mintJwt(request, ids.email);
  return { ...ids, jwt };
}

/** Best-effort cleanup — call from afterAll in a single spec, e.g. the last
 *  one. Other specs share the same seed (idempotent). */
export async function cleanupDualTenants(): Promise<void> {
  if (!REAL_BACKEND_ENABLED) return;
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const sql = postgres(dbUrl, { max: 1, onnotice: () => undefined });
  try {
    await cleanup(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export { expect } from '@playwright/test';
