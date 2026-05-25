/**
 * Tests for StationMasterRouter (NEW 18).
 *
 * Verifies:
 *   - Deterministic matching by tag / city / region / property_ids.
 *   - Tie-breaking by (priority, backlog, lastAssignedAt, stationMasterId).
 *   - Cross-tenant isolation — only the requesting tenant's rows match.
 *   - Polygon coverage is skipped (KI-010 — awaits GeoNode).
 *   - NO_MATCH error when nothing matches.
 */

import { describe, it, expect } from 'vitest';
import {
  StationMasterRouter,
  StationMasterRouterError,
  StationMasterRouterException,
} from '../station-master-router.js';
import type {
  StationMasterCoverageRepository,
  StationMasterCoverageRow,
} from '../types.js';

function row(
  input: Partial<StationMasterCoverageRow> & { id: string; coverage: StationMasterCoverageRow['coverage'] }
): StationMasterCoverageRow {
  return {
    tenantId: 't1',
    stationMasterId: `sm-${input.id}`,
    priority: 100,
    backlog: 0,
    lastAssignedAt: null,
    ...input,
  };
}

function repo(
  rows: readonly StationMasterCoverageRow[]
): StationMasterCoverageRepository {
  return {
    async list(tenantId) {
      return rows.filter((r) => r.tenantId === tenantId);
    },
    async putForStationMaster() {
      // not under test
    },
  };
}

describe('StationMasterRouter', () => {
  it('matches by tag and returns the deterministic winner', async () => {
    const rows = [
      row({ id: 'a', coverage: { kind: 'tag', value: { tag: 'nairobi-east' } }, priority: 100 }),
      row({ id: 'b', coverage: { kind: 'tag', value: { tag: 'nairobi-east' } }, priority: 50 }),
    ];
    const router = new StationMasterRouter({ repository: repo(rows) });

    const result = await router.routeApplication({
      applicationId: 'app-1',
      location: { tags: ['nairobi-east'] },
      assetType: 'residential',
      tenantId: 't1',
    });

    expect(result.stationMasterId).toBe('sm-b');
    expect(result.coverageKind).toBe('tag');
  });

  it('breaks ties by backlog when priorities match', async () => {
    const rows = [
      row({
        id: 'a',
        coverage: { kind: 'city', value: { city: 'Nairobi' } },
        priority: 50,
        backlog: 10,
      }),
      row({
        id: 'b',
        coverage: { kind: 'city', value: { city: 'Nairobi' } },
        priority: 50,
        backlog: 2,
      }),
    ];
    const router = new StationMasterRouter({ repository: repo(rows) });

    const result = await router.routeApplication({
      applicationId: 'app-1',
      location: { city: 'Nairobi' },
      assetType: 'residential',
      tenantId: 't1',
    });
    expect(result.stationMasterId).toBe('sm-b');
  });

  it('breaks further ties by lastAssignedAt (older first)', async () => {
    const rows = [
      row({
        id: 'a',
        coverage: { kind: 'region', value: { regionId: 'R1' } },
        lastAssignedAt: '2025-01-01T00:00:00Z',
      }),
      row({
        id: 'b',
        coverage: { kind: 'region', value: { regionId: 'R1' } },
        lastAssignedAt: '2024-06-01T00:00:00Z',
      }),
    ];
    const router = new StationMasterRouter({ repository: repo(rows) });

    const result = await router.routeApplication({
      applicationId: 'app-2',
      location: { regionId: 'R1' },
      assetType: 'residential',
      tenantId: 't1',
    });
    expect(result.stationMasterId).toBe('sm-b');
  });

  it('matches property_ids coverage', async () => {
    const rows = [
      row({
        id: 'a',
        coverage: {
          kind: 'property_ids',
          value: { propertyIds: ['prop-1', 'prop-2'] },
        },
      }),
    ];
    const router = new StationMasterRouter({ repository: repo(rows) });

    const result = await router.routeApplication({
      applicationId: 'app-3',
      location: { propertyId: 'prop-2' },
      assetType: 'commercial',
      tenantId: 't1',
    });
    expect(result.stationMasterId).toBe('sm-a');
  });

  it('enforces cross-tenant isolation', async () => {
    const rows = [
      row({
        id: 'a',
        tenantId: 't1',
        coverage: { kind: 'city', value: { city: 'Nairobi' } },
      }),
      row({
        id: 'b',
        tenantId: 't2',
        coverage: { kind: 'city', value: { city: 'Nairobi' } },
      }),
    ];
    const router = new StationMasterRouter({ repository: repo(rows) });

    const result = await router.routeApplication({
      applicationId: 'app-1',
      location: { city: 'Nairobi' },
      assetType: 'residential',
      tenantId: 't2',
    });
    expect(result.stationMasterId).toBe('sm-b');
  });

  it('skips polygon coverages until GeoNode is operational', async () => {
    const rows = [
      row({
        id: 'a',
        coverage: { kind: 'polygon', value: { geoJson: {} } },
      }),
    ];
    const router = new StationMasterRouter({ repository: repo(rows) });

    await expect(
      router.routeApplication({
        applicationId: 'app-x',
        location: { city: 'Nairobi' },
        assetType: 'residential',
        tenantId: 't1',
      })
    ).rejects.toMatchObject({
      code: StationMasterRouterError.NO_MATCH,
    });
  });

  it('raises NO_MATCH when nothing covers the location', async () => {
    const router = new StationMasterRouter({ repository: repo([]) });
    try {
      await router.routeApplication({
        applicationId: 'app-1',
        location: { city: 'Mombasa' },
        assetType: 'residential',
        tenantId: 't1',
      });
      expect.fail('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StationMasterRouterException);
      expect((e as StationMasterRouterException).code).toBe(
        StationMasterRouterError.NO_MATCH
      );
    }
  });
});
