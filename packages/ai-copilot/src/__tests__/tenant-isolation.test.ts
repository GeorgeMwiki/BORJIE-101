/**
 * Tenant isolation tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTenantScope,
  assertTenantScope,
  scrubForeignTenantData,
  assertQueryHasTenantFilter,
  TenantBoundaryError,
} from '../security/tenant-isolation.js';

describe('tenant-isolation', () => {
  it('passes when all records belong to current tenant', () => {
    const result = validateTenantScope(
      {
        rows: [
          { tenant_id: 't1', amount: 100 },
          { tenantId: 't1', amount: 50 },
        ],
      },
      { tenantId: 't1' },
    );
    expect(result.safe).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags a cross-tenant record deep inside the object', () => {
    const result = validateTenantScope(
      {
        page: 1,
        rows: [
          { tenantId: 't1', amount: 100 },
          { nested: { org_id: 'other-org', data: 'leaky' } },
        ],
      },
      { tenantId: 't1' },
    );
    expect(result.safe).toBe(false);
    expect(result.violations[0].type).toBe('cross_tenant_record');
    expect(result.violations[0].foreignTenantId).toBe('other-org');
  });

  it('assertTenantScope throws TenantBoundaryError on breach', () => {
    expect(() =>
      assertTenantScope(
        { rows: [{ tenantId: 't1' }, { tenantId: 'other' }] },
        { tenantId: 't1' },
      ),
    ).toThrow(TenantBoundaryError);
  });

  it('scrubForeignTenantData removes foreign subtrees', () => {
    const scrubbed = scrubForeignTenantData(
      {
        rows: [
          { tenantId: 't1', value: 'ok' },
          { tenantId: 'other', value: 'bad' },
        ],
      },
      { tenantId: 't1' },
    );
    expect(Array.isArray((scrubbed as { rows: unknown[] }).rows)).toBe(true);
    const rows = (scrubbed as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(1);
    expect((rows[0] as { value: string }).value).toBe('ok');
  });

  it('assertQueryHasTenantFilter rejects un-scoped filters', () => {
    expect(() =>
      assertQueryHasTenantFilter('listLeases', { propertyId: 'p1' }, { tenantId: 't1' }),
    ).toThrow(TenantBoundaryError);
  });

  it('assertQueryHasTenantFilter accepts tenantId filter', () => {
    expect(() =>
      assertQueryHasTenantFilter(
        'listLeases',
        { tenantId: 't1', propertyId: 'p1' },
        { tenantId: 't1' },
      ),
    ).not.toThrow();
  });
});
