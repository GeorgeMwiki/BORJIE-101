import { describe, expect, it } from 'vitest';
import {
  pickClosest,
  scoreCandidates,
} from '../routing/proximity-scorer.js';
import type { CustomerLocation, OrgUnitServiceArea } from '../types.js';

const CUSTOMER: CustomerLocation = {
  customer_id: 'c-1',
  tenant_id: 't1',
  source: 'gps',
  coordinates: { lat: -6.8, lng: 39.25 },
  recorded_at: '2026-05-26T12:00:00.000Z',
};

const NEAR_AREA: OrgUnitServiceArea = {
  org_unit_id: 'near',
  tenant_id: 't1',
  area_kind: 'station_radius',
  station_coords: { lat: -6.79, lng: 39.24 },
  station_radius_km: 50,
  priority: 10,
};

const FAR_AREA: OrgUnitServiceArea = {
  org_unit_id: 'far',
  tenant_id: 't1',
  area_kind: 'station_radius',
  station_coords: { lat: -3.39, lng: 36.69 },
  station_radius_km: 100,
  priority: 50,
};

const POSTAL_ONLY: OrgUnitServiceArea = {
  org_unit_id: 'postal',
  tenant_id: 't1',
  area_kind: 'postal_codes',
  postal_codes: ['11101'],
  priority: 25,
};

describe('proximity-scorer', () => {
  it('scoreCandidates attaches a distance when both sides have coords', () => {
    const scored = scoreCandidates(CUSTOMER, [NEAR_AREA, FAR_AREA]);
    expect(scored).toHaveLength(2);
    for (const s of scored) {
      expect(s.distance_km).toBeDefined();
      expect(s.score_kind).toBe('distance');
    }
  });

  it('scoreCandidates omits distance when one side has no coords', () => {
    const scored = scoreCandidates(CUSTOMER, [POSTAL_ONLY]);
    expect(scored).toHaveLength(1);
    expect(scored[0]?.distance_km).toBeUndefined();
    expect(scored[0]?.score_kind).toBe('priority');
  });

  it('pickClosest prefers the smaller distance over higher priority', () => {
    const scored = scoreCandidates(CUSTOMER, [NEAR_AREA, FAR_AREA]);
    const best = pickClosest(scored);
    expect(best?.area.org_unit_id).toBe('near');
  });

  it('pickClosest prefers a distance-scored area over a priority-only area', () => {
    const scored = scoreCandidates(CUSTOMER, [POSTAL_ONLY, NEAR_AREA]);
    const best = pickClosest(scored);
    expect(best?.area.org_unit_id).toBe('near');
  });

  it('pickClosest returns null for an empty scored list', () => {
    expect(pickClosest([])).toBeNull();
  });
});
