/**
 * Tests for OccupancyTimelineService (NEW 22).
 *
 * Verifies:
 *   - Unit timeline returns paginated periods.
 *   - Pagination clamps to the documented bounds (max 500).
 *   - Cross-tenant queries are passed through the repository (tenant
 *     isolation is the repository's job, so we assert it's called with
 *     the correct tenantId).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OccupancyTimelineService,
  type OccupancyPeriod,
  type OccupancyTimelineRepository,
} from '../occupancy-timeline-service.js';

function makePeriod(overrides: Partial<OccupancyPeriod> = {}): OccupancyPeriod {
  return {
    id: overrides.id ?? 'p1',
    tenantId: overrides.tenantId ?? 't1',
    unitId: overrides.unitId ?? 'u1',
    propertyId: overrides.propertyId ?? 'prop1',
    customerId: overrides.customerId ?? 'cust1',
    customerName: overrides.customerName ?? 'Alice',
    from: overrides.from ?? '2020-01-01T00:00:00Z',
    to: overrides.to ?? '2021-12-31T00:00:00Z',
    rent: overrides.rent ?? { amount: 50000, currency: 'KES' },
    status: overrides.status ?? 'moved_out',
    exitReason: overrides.exitReason ?? null,
    leaseId: overrides.leaseId ?? 'lease1',
  };
}

describe('OccupancyTimelineService', () => {
  it('getUnitTimeline returns periods with pagination metadata', async () => {
    const repo: OccupancyTimelineRepository = {
      findByUnit: vi.fn().mockResolvedValue({
        unitId: 'u1',
        propertyId: 'prop1',
        periods: [makePeriod()],
        total: 1,
      }),
      findByProperty: vi.fn(),
    };
    const svc = new OccupancyTimelineService(repo);

    const result = await svc.getUnitTimeline('u1', 't1');

    expect(result.periods).toHaveLength(1);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
    expect(repo.findByUnit).toHaveBeenCalledWith({
      tenantId: 't1',
      unitId: 'u1',
      page: 1,
      limit: 50,
    });
  });

  it('clamps limit to the documented max (500)', async () => {
    const repo: OccupancyTimelineRepository = {
      findByUnit: vi.fn().mockResolvedValue({
        unitId: 'u1',
        propertyId: 'prop1',
        periods: [],
        total: 0,
      }),
      findByProperty: vi.fn(),
    };
    const svc = new OccupancyTimelineService(repo);

    await svc.getUnitTimeline('u1', 't1', { page: 2, limit: 9999 });

    expect(repo.findByUnit).toHaveBeenCalledWith({
      tenantId: 't1',
      unitId: 'u1',
      page: 2,
      limit: 500,
    });
  });

  it('propagates tenantId so cross-tenant isolation is enforced at the repo', async () => {
    const findByUnit = vi.fn().mockResolvedValue({
      unitId: 'u1',
      propertyId: 'prop1',
      periods: [],
      total: 0,
    });
    const svc = new OccupancyTimelineService({
      findByUnit,
      findByProperty: vi.fn(),
    });

    await svc.getUnitTimeline('u1', 'tenant-A');
    await svc.getUnitTimeline('u1', 'tenant-B');

    expect(findByUnit).toHaveBeenCalledTimes(2);
    expect((findByUnit.mock.calls[0]![0] as any).tenantId).toBe('tenant-A');
    expect((findByUnit.mock.calls[1]![0] as any).tenantId).toBe('tenant-B');
  });

  it('getPortfolioTimeline aggregates across units', async () => {
    const repo: OccupancyTimelineRepository = {
      findByUnit: vi.fn(),
      findByProperty: vi.fn().mockResolvedValue({
        propertyId: 'prop1',
        units: [
          { unitId: 'u1', periods: [makePeriod({ unitId: 'u1' })] },
          { unitId: 'u2', periods: [] },
        ],
        totalUnits: 2,
      }),
    };
    const svc = new OccupancyTimelineService(repo);

    const result = await svc.getPortfolioTimeline('prop1', 't1');
    expect(result.timelinesByUnit).toHaveLength(2);
    expect(result.pagination.totalUnits).toBe(2);
  });
});
