/**
 * Tests for the `getTenantRegion(db, tenantId)` helper — resolves
 * `tenants.region` for per-request region routing (KMS, EFT, OCR).
 *
 * Coverage:
 *   - Returns the region string when the row exists with a non-empty
 *     `tenants.region` value (e.g. ZA tenant -> 'af-south-1').
 *   - Returns null when the row does not exist (unprovisioned tenant
 *     or soft-deleted row).
 *   - Returns null when the query throws (transient DB outage); the
 *     caller falls back to `env.AWS_REGION`.
 *   - Returns null for empty / null `tenantId` (defensive — avoids a
 *     full-table scan on `eq(id, '')`).
 */
import { describe, it, expect } from 'vitest';

import { getTenantRegion } from '../get-tenant-region.js';
import type { GetTenantRegionDb } from '../get-tenant-region.js';

interface StubOptions {
  readonly rows?: ReadonlyArray<{ readonly region: string | null }>;
  readonly throws?: Error;
}

function makeStub(opts: StubOptions = {}): GetTenantRegionDb {
  const rows = opts.rows ?? [];
  return {
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: () => {
          if (opts.throws) {
            return Promise.reject(opts.throws);
          }
          return Promise.resolve(rows);
        },
      };
      return chain as never;
    },
  } as unknown as GetTenantRegionDb;
}

describe('getTenantRegion', () => {
  it("returns 'af-south-1' when the tenant row has region='af-south-1'", async () => {
    const db = makeStub({ rows: [{ region: 'af-south-1' }] });
    const out = await getTenantRegion(db, 'tenant-ZA');
    expect(out).toBe('af-south-1');
  });

  it('returns null when the tenant row does not exist (no rows match)', async () => {
    const db = makeStub({ rows: [] });
    const out = await getTenantRegion(db, 'tenant-missing');
    expect(out).toBeNull();
  });

  it('returns null when the row exists but region is empty / null', async () => {
    const dbEmpty = makeStub({ rows: [{ region: '' }] });
    const dbNull = makeStub({ rows: [{ region: null }] });
    expect(await getTenantRegion(dbEmpty, 'tenant-X')).toBeNull();
    expect(await getTenantRegion(dbNull, 'tenant-X')).toBeNull();
  });

  it('returns null when the query throws (transient outage — caller falls back to env)', async () => {
    const db = makeStub({ throws: new Error('db_unavailable') });
    const out = await getTenantRegion(db, 'tenant-ZA');
    expect(out).toBeNull();
  });

  it('returns null for empty / null / undefined tenantId without querying', async () => {
    // Use a stub that fails if anything calls .select() — defensive
    // path MUST short-circuit before issuing any query.
    let queryCount = 0;
    const trippingDb: GetTenantRegionDb = {
      select: () => {
        queryCount += 1;
        return {} as never;
      },
    } as unknown as GetTenantRegionDb;
    expect(await getTenantRegion(trippingDb, '')).toBeNull();
    expect(await getTenantRegion(trippingDb, null)).toBeNull();
    expect(await getTenantRegion(trippingDb, undefined)).toBeNull();
    expect(queryCount).toBe(0);
  });
});
