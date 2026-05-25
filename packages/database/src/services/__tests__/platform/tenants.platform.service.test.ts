/**
 * Unit tests — createPlatformTenantsService.
 *
 * Coverage (5+ per the B1 plan):
 *   - listTenants happy path with `active` filter
 *   - listTenants honours cursor + emits nextCursor when hasMore
 *   - listTenants returns empty result on DB error (degraded)
 *   - slugExists true / false / DB-error
 *   - tenantExists true / false / DB-error
 *   - provisionTenant happy path inserts tenant + owner inside a tx
 *   - provisionTenant rethrows on DB error
 *   - rollbackTenantProvision happy path: soft-deletes tenant + deactivates owner
 *   - rollbackTenantProvision rethrows on DB error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlatformTenantsService } from '../../platform/tenants.platform.service.js';
import { makeStubDb } from './_stub-db.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('platform.tenants — listTenants', () => {
  it('returns mapped rows for active filter', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        id: 't1',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        lastActivityAt: new Date('2026-05-01T00:00:00Z'),
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]);
    const svc = createPlatformTenantsService(stub.client);
    const out = await svc.listTenants({
      filter: 'active',
      limit: 10,
      cursor: null,
    });
    expect(out.totalReturned).toBe(1);
    expect(out.rows[0]?.tenantId).toBe('t1');
    expect(out.rows[0]?.status).toBe('active');
    expect(out.rows[0]?.mrrUsdCents).toBe(0);
    expect(out.nextCursor).toBeNull();
  });

  it('emits nextCursor when more pages exist', async () => {
    const stub = makeStubDb();
    // Seed limit+1 rows so adapter detects hasMore=true.
    const rows = Array.from({ length: 11 }).map((_, i) => ({
      id: `t${i}`,
      slug: `s${i}`,
      name: `n${i}`,
      status: 'active',
      lastActivityAt: null,
      createdAt: new Date(`2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    }));
    stub.setSelectRows(rows);
    const svc = createPlatformTenantsService(stub.client);
    const out = await svc.listTenants({
      filter: 'active',
      limit: 10,
      cursor: null,
    });
    expect(out.rows).toHaveLength(10);
    expect(out.nextCursor).not.toBeNull();
  });

  it('returns empty result on DB error (degraded)', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformTenantsService(stub.client);
    const out = await svc.listTenants({
      filter: 'all',
      limit: 10,
      cursor: null,
    });
    expect(out.rows).toEqual([]);
    expect(out.totalReturned).toBe(0);
  });

  it('maps churned filter rows correctly', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        id: 't1',
        slug: 'x',
        name: 'x',
        status: 'cancelled',
        lastActivityAt: null,
        createdAt: new Date(),
      },
    ]);
    const svc = createPlatformTenantsService(stub.client);
    const out = await svc.listTenants({
      filter: 'churned',
      limit: 25,
      cursor: null,
    });
    expect(out.rows[0]?.status).toBe('churned');
  });
});

describe('platform.tenants — slugExists / tenantExists', () => {
  it('slugExists returns true when row found', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([{ id: 't1' }]);
    const svc = createPlatformTenantsService(stub.client);
    expect(await svc.slugExists('acme')).toBe(true);
  });

  it('slugExists returns false when not found', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformTenantsService(stub.client);
    expect(await svc.slugExists('missing')).toBe(false);
  });

  it('slugExists returns false on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformTenantsService(stub.client);
    expect(await svc.slugExists('x')).toBe(false);
  });

  it('tenantExists returns false on empty input', async () => {
    const stub = makeStubDb();
    const svc = createPlatformTenantsService(stub.client);
    expect(await svc.tenantExists('')).toBe(false);
  });
});

describe('platform.tenants — provisionTenant', () => {
  it('inserts tenant + owner inside a transaction', async () => {
    const stub = makeStubDb();
    const svc = createPlatformTenantsService(stub.client);
    const out = await svc.provisionTenant({
      slug: 'acme',
      name: 'Acme',
      ownerEmail: 'admin@acme.test',
      plan: 'pro',
    });
    expect(out.tenantId).toMatch(/-/);
    expect(out.ownerUserId).toMatch(/-/);
    expect(out.plan).toBe('pro');
    expect(out.slug).toBe('acme');
    // Two inserts inside a single transaction.
    const inserts = stub.ops.filter((o) => o.op === 'insert');
    expect(inserts).toHaveLength(2);
    const begins = stub.ops.filter((o) => o.op === 'transaction-begin');
    expect(begins).toHaveLength(1);
  });

  it('refuses when slug or ownerEmail missing', async () => {
    const stub = makeStubDb();
    const svc = createPlatformTenantsService(stub.client);
    await expect(
      svc.provisionTenant({
        slug: '',
        name: 'x',
        ownerEmail: 'a@b.test',
        plan: 'starter',
      }),
    ).rejects.toThrow(/slug is required/);
    await expect(
      svc.provisionTenant({
        slug: 'x',
        name: 'x',
        ownerEmail: '',
        plan: 'starter',
      }),
    ).rejects.toThrow(/ownerEmail is required/);
  });

  it('rethrows on DB error so caller knows write failed', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('uniq-violation'));
    const svc = createPlatformTenantsService(stub.client);
    await expect(
      svc.provisionTenant({
        slug: 'x',
        name: 'x',
        ownerEmail: 'a@b.test',
        plan: 'starter',
      }),
    ).rejects.toThrow(/uniq-violation/);
  });
});

describe('platform.tenants — rollbackTenantProvision', () => {
  it('soft-deletes tenant + deactivates owner inside a transaction', async () => {
    const stub = makeStubDb();
    const svc = createPlatformTenantsService(stub.client);
    await svc.rollbackTenantProvision({
      tenantId: 't1',
      ownerUserId: 'u1',
    });
    const updates = stub.ops.filter((o) => o.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[0]?.set?.status).toBe('deactivated');
    expect(updates[1]?.set?.status).toBe('cancelled');
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformTenantsService(stub.client);
    await expect(
      svc.rollbackTenantProvision({ tenantId: 't1', ownerUserId: 'u1' }),
    ).rejects.toThrow(/boom/);
  });
});
