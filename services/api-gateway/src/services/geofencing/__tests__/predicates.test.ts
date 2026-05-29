/**
 * Geofencing predicate tests — drive each spatial predicate with an
 * in-memory DB double so we never touch a real Postgres.
 *
 * Covers:
 *   - pointInSite hit / miss / invalid lat-lon / tenant required
 *   - pointInHazard ordering by severity (forbidden > caution > work_zone)
 *   - pointInTitle hit / miss
 *   - distanceToNearestSite limit bounds
 *   - pointInComplianceZone tenant-agnostic + empty authority list
 *   - estimateRoute wet-season vs dry-season penalty
 *   - haversineMeters numeric correctness across two known landmarks
 */

import { describe, it, expect } from 'vitest';
import {
  pointInSite,
  pointInHazard,
  pointInTitle,
  distanceToNearestSite,
  pointInComplianceZone,
  estimateRoute,
  haversineMeters,
  type DbLike,
} from '../predicates.js';
import { GeofencingError } from '../types.js';

function fakeDb(rows: ReadonlyArray<Record<string, unknown>>): DbLike {
  return {
    async execute() {
      return { rows };
    },
  };
}

const DAR = { lat: -6.7924, lon: 39.2083 };
const ARUSHA = { lat: -3.3869, lon: 36.683 };

describe('pointInSite', () => {
  it('returns site hit when DB row present', async () => {
    const db = fakeDb([
      { id: 'site-1', name: 'Pit A', mineral: 'Au', phase: 'extraction' },
    ]);
    const hit = await pointInSite(db, 'tenant-1', DAR);
    expect(hit).toEqual({
      siteId: 'site-1',
      name: 'Pit A',
      mineral: 'Au',
      phase: 'extraction',
    });
  });

  it('returns null when DB returns no rows', async () => {
    const hit = await pointInSite(fakeDb([]), 'tenant-1', DAR);
    expect(hit).toBeNull();
  });

  it('rejects out-of-range latitude', async () => {
    await expect(
      pointInSite(fakeDb([]), 'tenant-1', { lat: 95, lon: 0 }),
    ).rejects.toBeInstanceOf(GeofencingError);
  });

  it('rejects empty tenantId', async () => {
    await expect(pointInSite(fakeDb([]), '', DAR)).rejects.toMatchObject({
      code: 'invalid_tenant',
    });
  });
});

describe('pointInHazard', () => {
  it('orders hits forbidden > caution > work_zone', async () => {
    const db = fakeDb([
      {
        id: 'h-w',
        name_sw: 'Eneo la kazi',
        name_en: 'Work zone',
        severity: 'work_zone',
        category: 'ore_pit',
        site_id: 'site-1',
      },
      {
        id: 'h-f',
        name_sw: 'Marufuku',
        name_en: 'Forbidden',
        severity: 'forbidden',
        category: 'magazine',
        site_id: 'site-1',
      },
      {
        id: 'h-c',
        name_sw: 'Tahadhari',
        name_en: 'Caution',
        severity: 'caution',
        category: 'flood_plain',
        site_id: null,
      },
    ]);
    const hits = await pointInHazard(db, 'tenant-1', DAR);
    expect(hits.map((h) => h.severity)).toEqual([
      'forbidden',
      'caution',
      'work_zone',
    ]);
  });

  it('returns empty array when no hazards', async () => {
    const hits = await pointInHazard(fakeDb([]), 'tenant-1', DAR);
    expect(hits).toEqual([]);
  });
});

describe('pointInTitle', () => {
  it('returns licence hit', async () => {
    const db = fakeDb([
      {
        id: 'lic-1',
        kind: 'PML',
        number: 'PML/123/2024',
        mineral: 'Au',
        company_id: 'co-1',
      },
    ]);
    const hit = await pointInTitle(db, 'tenant-1', DAR);
    expect(hit?.licenceId).toBe('lic-1');
    expect(hit?.kind).toBe('PML');
  });

  it('returns null when no rows', async () => {
    const hit = await pointInTitle(fakeDb([]), 'tenant-1', DAR);
    expect(hit).toBeNull();
  });
});

describe('distanceToNearestSite', () => {
  it('returns distance hit array', async () => {
    const db = fakeDb([
      { id: 'site-1', name: 'Pit A', distance_m: 1234.5 },
      { id: 'site-2', name: 'Pit B', distance_m: 5678.9 },
    ]);
    const hits = await distanceToNearestSite(db, 'tenant-1', DAR, 2);
    expect(hits[0]?.distanceMeters).toBeCloseTo(1234.5);
    expect(hits.length).toBe(2);
  });

  it('rejects limit out of range', async () => {
    await expect(
      distanceToNearestSite(fakeDb([]), 'tenant-1', DAR, 0),
    ).rejects.toMatchObject({ code: 'invalid_point' });
    await expect(
      distanceToNearestSite(fakeDb([]), 'tenant-1', DAR, 101),
    ).rejects.toMatchObject({ code: 'invalid_point' });
  });
});

describe('pointInComplianceZone', () => {
  it('returns regulatory zone hits', async () => {
    const db = fakeDb([
      {
        id: 'rz-1',
        authority: 'eiti',
        name_sw: 'Mbeya',
        name_en: 'Mbeya',
        code: 'MBY',
        attributes: { teiti_zone: 'MBY' },
      },
    ]);
    const hits = await pointInComplianceZone(db, ARUSHA);
    expect(hits[0]?.authority).toBe('eiti');
    expect(hits[0]?.code).toBe('MBY');
  });

  it('short-circuits on empty authority filter', async () => {
    const db = fakeDb([{ id: 'rz-1', authority: 'eiti' }]);
    const hits = await pointInComplianceZone(db, ARUSHA, []);
    expect(hits).toEqual([]);
  });
});

describe('estimateRoute', () => {
  it('applies wet-season penalty in April', () => {
    const hint = estimateRoute(DAR, ARUSHA, { month: 4 });
    expect(hint.wetSeasonPenalty).toBeGreaterThan(1);
    expect(hint.note).toMatch(/wet-season/);
  });

  it('returns 1.0 penalty in July', () => {
    const hint = estimateRoute(DAR, ARUSHA, { month: 7 });
    expect(hint.wetSeasonPenalty).toBe(1);
    expect(hint.note).toMatch(/dry-season/);
  });

  it('rejects invalid points', () => {
    expect(() => estimateRoute({ lat: 999, lon: 0 }, ARUSHA)).toThrow();
  });
});

describe('haversineMeters', () => {
  it('matches Dar↔Arusha at ~470km (great-circle)', () => {
    const distance = haversineMeters(DAR, ARUSHA);
    expect(distance).toBeGreaterThan(450_000);
    expect(distance).toBeLessThan(490_000);
  });

  it('returns ~0 for same point', () => {
    expect(haversineMeters(DAR, DAR)).toBeCloseTo(0, 1);
  });
});
