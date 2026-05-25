import { describe, it, expect } from 'vitest';
import {
  asGeoNodeId,
  getAncestorIds,
  getDescendantIds,
  pointInPolygon,
  type GeoNodeClosure,
  type GeoPolygon,
} from './geo-node.js';

// ---------------------------------------------------------------------------
// pointInPolygon
// ---------------------------------------------------------------------------

describe('pointInPolygon', () => {
  // Simple unit square in GeoJSON [lng, lat] order. Closed ring.
  const square: GeoPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };

  it('returns true for a point strictly inside the square', () => {
    expect(pointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
  });

  it('returns false for a point strictly outside the square', () => {
    expect(pointInPolygon({ lat: 20, lng: 20 }, square)).toBe(false);
    expect(pointInPolygon({ lat: -1, lng: 5 }, square)).toBe(false);
  });

  it('handles a point on the edge deterministically (inside)', () => {
    // Point lies exactly on the bottom edge of the square.
    expect(pointInPolygon({ lat: 0, lng: 5 }, square)).toBe(true);
    // Corner.
    expect(pointInPolygon({ lat: 0, lng: 0 }, square)).toBe(true);
    // Right edge.
    expect(pointInPolygon({ lat: 7, lng: 10 }, square)).toBe(true);
  });

  it('respects hole rings: point inside hole is not contained', () => {
    const squareWithHole: GeoPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    expect(pointInPolygon({ lat: 5, lng: 5 }, squareWithHole)).toBe(false);
    expect(pointInPolygon({ lat: 2, lng: 2 }, squareWithHole)).toBe(true);
  });

  it('MultiPolygon: point inside any component returns true', () => {
    const multi: GeoPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        // First polygon: square at origin.
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
        // Second polygon: square at (10,10).
        [
          [
            [10, 10],
            [12, 10],
            [12, 12],
            [10, 12],
            [10, 10],
          ],
        ],
      ],
    };

    expect(pointInPolygon({ lat: 1, lng: 1 }, multi)).toBe(true);
    expect(pointInPolygon({ lat: 11, lng: 11 }, multi)).toBe(true);
    expect(pointInPolygon({ lat: 5, lng: 5 }, multi)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Closure-table helpers
// ---------------------------------------------------------------------------

describe('closure-table helpers', () => {
  // 3-deep chain: A -> B -> C -> D.
  const A = asGeoNodeId('A');
  const B = asGeoNodeId('B');
  const C = asGeoNodeId('C');
  const D = asGeoNodeId('D');

  const closures: readonly GeoNodeClosure[] = [
    // self-pairs
    { ancestorId: A, descendantId: A, depth: 0 },
    { ancestorId: B, descendantId: B, depth: 0 },
    { ancestorId: C, descendantId: C, depth: 0 },
    { ancestorId: D, descendantId: D, depth: 0 },
    // direct parents
    { ancestorId: A, descendantId: B, depth: 1 },
    { ancestorId: B, descendantId: C, depth: 1 },
    { ancestorId: C, descendantId: D, depth: 1 },
    // transitive
    { ancestorId: A, descendantId: C, depth: 2 },
    { ancestorId: B, descendantId: D, depth: 2 },
    { ancestorId: A, descendantId: D, depth: 3 },
  ];

  it('getAncestorIds returns ancestors from closest to farthest', () => {
    expect(getAncestorIds(closures, D)).toEqual([C, B, A]);
  });

  it('getAncestorIds excludes self', () => {
    const ancestors = getAncestorIds(closures, D);
    expect(ancestors).not.toContain(D);
  });

  it('getAncestorIds returns empty for root', () => {
    expect(getAncestorIds(closures, A)).toEqual([]);
  });

  it('getDescendantIds returns descendants from closest to farthest', () => {
    expect(getDescendantIds(closures, A)).toEqual([B, C, D]);
  });

  it('getDescendantIds excludes self', () => {
    const descendants = getDescendantIds(closures, A);
    expect(descendants).not.toContain(A);
  });

  it('getDescendantIds returns empty for leaf', () => {
    expect(getDescendantIds(closures, D)).toEqual([]);
  });
});
