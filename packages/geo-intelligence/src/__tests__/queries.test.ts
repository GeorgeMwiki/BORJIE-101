import { describe, expect, it } from 'vitest';
import { createSpatialIndex } from '../queries/index.js';
import { rectanglePolygon, mergeIntoMultiPolygon } from '../geometry/index.js';
import type { Parcel } from '../types.js';

function makeParcel(id: string, lng: number, lat: number, sizeM = 100): Parcel {
  const center = { type: 'Point' as const, coordinates: [lng, lat] as readonly [number, number] };
  const rect = rectanglePolygon(center, sizeM, sizeM);
  return {
    parcelId: id,
    tenantId: 't1',
    orgId: 'o1',
    name: id,
    geometry: mergeIntoMultiPolygon([rect]),
    centroid: center,
    areaSqm: sizeM * sizeM,
    status: 'active',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('queries — spatial index', () => {
  const parcels = [
    makeParcel('p1', 0, 0),
    makeParcel('p2', 0.01, 0.01),
    makeParcel('p3', 10, 10),
  ];

  it('all() returns the input parcels', () => {
    const idx = createSpatialIndex(parcels);
    expect(idx.all().length).toBe(3);
  });

  it('pointInParcel locates a point inside a parcel', () => {
    const idx = createSpatialIndex(parcels);
    expect(idx.pointInParcel(0, 0)?.parcelId).toBe('p1');
  });

  it('pointInParcel returns null when no parcel contains the point', () => {
    const idx = createSpatialIndex(parcels);
    expect(idx.pointInParcel(99, 99)).toBeNull();
  });

  it('parcelsWithin returns parcels in bbox', () => {
    const idx = createSpatialIndex(parcels);
    const hits = idx.parcelsWithin({ minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 });
    expect(hits.length).toBe(2);
  });

  it('nearestParcels returns k closest in distance order', () => {
    const idx = createSpatialIndex(parcels);
    const near = idx.nearestParcels(0, 0, 2);
    expect(near[0]?.parcel.parcelId).toBe('p1');
    expect(near[1]?.parcel.parcelId).toBe('p2');
  });

  it('withinDistance excludes the seed and orders by distance', () => {
    const idx = createSpatialIndex(parcels);
    const radius = 5000; // 5 km
    const around = idx.withinDistance('p1', radius);
    expect(around.find((r) => r.parcel.parcelId === 'p1')).toBeUndefined();
    expect(around.find((r) => r.parcel.parcelId === 'p2')).toBeDefined();
  });

  it('parcelsIntersecting catches geometries that overlap the query polygon', () => {
    const idx = createSpatialIndex(parcels);
    const center = { type: 'Point' as const, coordinates: [0, 0] as readonly [number, number] };
    const big = rectanglePolygon(center, 5000, 5000);
    const hits = idx.parcelsIntersecting(big);
    expect(hits.some((p) => p.parcelId === 'p1')).toBe(true);
    expect(hits.some((p) => p.parcelId === 'p3')).toBe(false);
  });

  it('returns empty when no parcels are provided', () => {
    const idx = createSpatialIndex([]);
    expect(idx.pointInParcel(0, 0)).toBeNull();
    expect(idx.nearestParcels(0, 0, 5)).toEqual([]);
  });
});
