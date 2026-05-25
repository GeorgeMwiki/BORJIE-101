import { describe, expect, it } from 'vitest';

import {
  bboxIntersects,
  pointInPolygon,
  polygonAreaSqm,
  polygonBoundingBox,
  polygonCentroid,
  polygonWithin,
  polygonsOverlap,
} from '../polygon-math.js';
import type { Polygon } from '../types.js';
import {
  TEST_CHILD_LL,
  TEST_CHILD_OUT_OF_BOUNDS,
  TEST_CHILD_OVERLAPPING,
  TEST_CHILD_UR,
  TEST_LAND_AREA_POLYGON,
} from './in-memory-port.js';

const unitSquare: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

describe('polygonCentroid', () => {
  it('computes centroid of a unit square at (0.5, 0.5)', () => {
    const c = polygonCentroid(unitSquare);
    expect(c.type).toBe('Point');
    expect(c.coordinates[0]).toBeCloseTo(0.5, 6);
    expect(c.coordinates[1]).toBeCloseTo(0.5, 6);
  });

  it('handles a thin near-degenerate polygon without throwing', () => {
    const thin: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 0.000001],
          [0, 0.000001],
          [0, 0],
        ],
      ],
    };
    const c = polygonCentroid(thin);
    expect(c.coordinates[0]).toBeCloseTo(0.5, 4);
  });

  it('throws on a polygon with insufficient ring points', () => {
    const bad = {
      type: 'Polygon',
      coordinates: [[[0, 0]]],
    } as Polygon;
    expect(() => polygonCentroid(bad)).toThrow();
  });

  it('falls back to vertex average for a strictly degenerate ring', () => {
    // A polygon where signed area is exactly zero (colinear points).
    const degenerate: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    };
    const c = polygonCentroid(degenerate);
    expect(c.type).toBe('Point');
    expect(Number.isFinite(c.coordinates[0])).toBe(true);
    expect(Number.isFinite(c.coordinates[1])).toBe(true);
  });
});

describe('polygonAreaSqm', () => {
  it('computes a non-zero positive area for the test land area', () => {
    const area = polygonAreaSqm(TEST_LAND_AREA_POLYGON);
    expect(area).toBeGreaterThan(0);
    // Small Dar polygon should be a few tens of thousands of m².
    expect(area).toBeLessThan(1_000_000);
  });

  it('returns 0 for a degenerate ring', () => {
    const bad: Polygon = { type: 'Polygon', coordinates: [[[0, 0]]] };
    expect(polygonAreaSqm(bad)).toBe(0);
  });

  it('returns positive value regardless of winding order', () => {
    const cw: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    };
    const ccw: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    expect(polygonAreaSqm(cw)).toBeGreaterThan(0);
    expect(polygonAreaSqm(ccw)).toBeGreaterThan(0);
  });
});

describe('polygonBoundingBox', () => {
  it('computes correct bbox for unit square', () => {
    const bbox = polygonBoundingBox(unitSquare);
    expect(bbox.min_lng).toBe(0);
    expect(bbox.min_lat).toBe(0);
    expect(bbox.max_lng).toBe(1);
    expect(bbox.max_lat).toBe(1);
  });

  it('throws for empty polygon', () => {
    const empty = { type: 'Polygon', coordinates: [[]] } as Polygon;
    expect(() => polygonBoundingBox(empty)).toThrow();
  });
});

describe('pointInPolygon', () => {
  it('returns true for a point clearly inside', () => {
    expect(pointInPolygon([0.5, 0.5], unitSquare)).toBe(true);
  });
  it('returns false for a point clearly outside', () => {
    expect(pointInPolygon([2, 2], unitSquare)).toBe(false);
  });
  it('returns false for a polygon with insufficient ring', () => {
    expect(pointInPolygon([0.5, 0.5], { type: 'Polygon', coordinates: [[[0, 0]]] } as Polygon)).toBe(false);
  });
});

describe('polygonWithin', () => {
  it('LL child is within the test land area', () => {
    expect(polygonWithin(TEST_CHILD_LL, TEST_LAND_AREA_POLYGON)).toBe(true);
  });
  it('UR child is within the test land area', () => {
    expect(polygonWithin(TEST_CHILD_UR, TEST_LAND_AREA_POLYGON)).toBe(true);
  });
  it('out-of-bounds polygon is NOT within the test land area', () => {
    expect(polygonWithin(TEST_CHILD_OUT_OF_BOUNDS, TEST_LAND_AREA_POLYGON)).toBe(false);
  });
  it('a slightly inset polygon is within the outer (PostGIS-like ST_Within)', () => {
    const inner: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.9, 0.9],
          [0.1, 0.9],
          [0.1, 0.1],
        ],
      ],
    };
    expect(polygonWithin(inner, unitSquare)).toBe(true);
  });
  it('handles missing ring on inner', () => {
    expect(polygonWithin({ type: 'Polygon', coordinates: [] } as unknown as Polygon, unitSquare)).toBe(false);
  });
});

describe('polygonsOverlap', () => {
  it('LL and UR children do NOT overlap (siblings)', () => {
    expect(polygonsOverlap(TEST_CHILD_LL, TEST_CHILD_UR)).toBe(false);
  });
  it('LL and overlapping child DO overlap', () => {
    expect(polygonsOverlap(TEST_CHILD_LL, TEST_CHILD_OVERLAPPING)).toBe(true);
  });
  it('detects strict interior overlap via vertex containment', () => {
    const a: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };
    const b: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
          [0.5, 0.5],
        ],
      ],
    };
    expect(polygonsOverlap(a, b)).toBe(true);
  });
  it('returns false for an empty inner ring', () => {
    expect(polygonsOverlap({ type: 'Polygon', coordinates: [] } as unknown as Polygon, unitSquare)).toBe(false);
  });
});

describe('bboxIntersects', () => {
  it('returns true for overlapping bboxes', () => {
    expect(
      bboxIntersects(
        { min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1 },
        { min_lng: 0.5, min_lat: 0.5, max_lng: 1.5, max_lat: 1.5 },
      ),
    ).toBe(true);
  });
  it('returns false for disjoint bboxes', () => {
    expect(
      bboxIntersects(
        { min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1 },
        { min_lng: 2, min_lat: 2, max_lng: 3, max_lat: 3 },
      ),
    ).toBe(false);
  });
});
