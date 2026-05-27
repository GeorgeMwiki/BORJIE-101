import { describe, it, expect } from 'vitest';
import {
  applyFiltersInMemory,
  buildWhere,
  type InMemoryFilterableRow,
} from '../search/filter-builder.js';

describe('buildWhere', () => {
  it('emits tenant_id as the first predicate and first parameter', () => {
    const { whereSql, params } = buildWhere('tenant-a', undefined);
    expect(whereSql).toBe('tenant_id = $1');
    expect(params).toEqual(['tenant-a']);
  });

  it('compiles region + capabilityKind + date range to parameterised SQL', () => {
    const { whereSql, params } = buildWhere('tenant-a', {
      region: 'kahama',
      capabilityKind: 'junior',
      dateFrom: '2026-04-01T00:00:00.000Z',
      dateTo: '2026-04-30T23:59:59.000Z',
    });
    expect(whereSql).toBe(
      'tenant_id = $1 AND region = $2 AND capability_kind = $3 AND posted_at >= $4 AND posted_at <= $5',
    );
    expect(params).toEqual([
      'tenant-a',
      'kahama',
      'junior',
      '2026-04-01T00:00:00.000Z',
      '2026-04-30T23:59:59.000Z',
    ]);
  });

  it('compiles hasCrossRef into the parameterless predicate', () => {
    const { whereSql, params } = buildWhere('tenant-a', {
      hasCrossRef: true,
    });
    expect(whereSql).toBe('tenant_id = $1 AND cross_ref_count > 0');
    expect(params).toEqual(['tenant-a']);
  });
});

describe('applyFiltersInMemory', () => {
  const rows: ReadonlyArray<InMemoryFilterableRow> = [
    {
      tenantId: 'tenant-a',
      region: 'kahama',
      capabilityKind: 'junior',
      postedAt: '2026-04-15T00:00:00.000Z',
      crossRefCount: 2,
    },
    {
      tenantId: 'tenant-a',
      region: 'kivu',
      capabilityKind: 'connector',
      postedAt: '2026-05-15T00:00:00.000Z',
      crossRefCount: 0,
    },
    {
      tenantId: 'tenant-b',
      region: 'kahama',
      capabilityKind: 'junior',
      postedAt: '2026-04-20T00:00:00.000Z',
      crossRefCount: 1,
    },
  ];

  it('filters by tenant + region + date range', () => {
    const out = applyFiltersInMemory(rows, 'tenant-a', {
      region: 'kahama',
      dateFrom: '2026-04-01T00:00:00.000Z',
      dateTo: '2026-04-30T23:59:59.000Z',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.region).toBe('kahama');
  });

  it('hasCrossRef false excludes posts with cross_ref_count > 0', () => {
    const out = applyFiltersInMemory(rows, 'tenant-a', {
      hasCrossRef: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.crossRefCount).toBe(0);
  });
});
