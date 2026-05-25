/**
 * Tests for the footprint snapper — distance, source priority, and
 * the "no candidate within radius" path.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAP_RADIUS_M,
  rankCandidates,
  snapToBuilding,
} from '../segmentation/footprint-snapper.js';
import type { GeoJsonPolygon, ReferenceBuilding } from '../types.js';

function squareAround(lon: number, lat: number, halfDeg = 0.0001): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - halfDeg, lat - halfDeg],
        [lon + halfDeg, lat - halfDeg],
        [lon + halfDeg, lat + halfDeg],
        [lon - halfDeg, lat + halfDeg],
        [lon - halfDeg, lat - halfDeg],
      ],
    ],
  };
}

const POINT = { type: 'Point' as const, coordinates: [0, 0] as const };

describe('snapToBuilding', () => {
  it('returns null when no candidate is within radius', () => {
    const far: ReferenceBuilding = {
      id: 'x',
      source: 'overture',
      polygon: squareAround(10, 10),
    };
    expect(snapToBuilding({ point: POINT, candidates: [far] })).toBeNull();
  });

  it('picks the closest candidate', () => {
    const near: ReferenceBuilding = {
      id: 'near',
      source: 'overture',
      polygon: squareAround(0.00005, 0),
    };
    const farther: ReferenceBuilding = {
      id: 'far',
      source: 'overture',
      polygon: squareAround(0.0002, 0),
    };
    const result = snapToBuilding({ point: POINT, candidates: [farther, near] });
    expect(result?.building.id).toBe('near');
  });

  it('breaks ties on source priority (google_open_buildings first)', () => {
    const overture: ReferenceBuilding = {
      id: 'o',
      source: 'overture',
      polygon: squareAround(0, 0),
    };
    const gob: ReferenceBuilding = {
      id: 'g',
      source: 'google_open_buildings',
      polygon: squareAround(0, 0),
    };
    const result = snapToBuilding({ point: POINT, candidates: [overture, gob] });
    expect(result?.building.id).toBe('g');
  });

  it('respects the custom radius', () => {
    const justOutside: ReferenceBuilding = {
      id: 'x',
      source: 'overture',
      // ~22 m east of (0,0) at the equator.
      polygon: squareAround(0.0002, 0),
    };
    expect(
      snapToBuilding({ point: POINT, candidates: [justOutside], radiusM: 5 }),
    ).toBeNull();
    expect(
      snapToBuilding({ point: POINT, candidates: [justOutside], radiusM: DEFAULT_SNAP_RADIUS_M }),
    ).not.toBeNull();
  });
});

describe('rankCandidates', () => {
  it('returns every candidate within radius, sorted by distance', () => {
    const candidates: ReferenceBuilding[] = [
      { id: 'a', source: 'overture', polygon: squareAround(0.0002, 0) },
      { id: 'b', source: 'overture', polygon: squareAround(0.00005, 0) },
      { id: 'c', source: 'overture', polygon: squareAround(0.0001, 0) },
    ];
    const ranked = rankCandidates({ point: POINT, candidates });
    expect(ranked.map((r) => r.building.id)).toEqual(['b', 'c', 'a']);
  });

  it('ignores candidates outside the radius', () => {
    const candidates: ReferenceBuilding[] = [
      { id: 'in', source: 'overture', polygon: squareAround(0, 0) },
      { id: 'out', source: 'overture', polygon: squareAround(0.01, 0) },
    ];
    const ranked = rankCandidates({ point: POINT, candidates, radiusM: 5 });
    expect(ranked.map((r) => r.building.id)).toEqual(['in']);
  });
});
