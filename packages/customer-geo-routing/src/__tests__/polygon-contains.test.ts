import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../geo/polygon-contains.js';
import type { GeoJsonPolygon } from '../types.js';

// A simple rectangle around Dar es Salaam (rough bounding box).
const DSM_RECTANGLE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [39.15, -6.9],
      [39.35, -6.9],
      [39.35, -6.7],
      [39.15, -6.7],
      [39.15, -6.9],
    ],
  ],
};

// Same rectangle with a hole cut out around the city centre.
const DSM_WITH_HOLE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [39.15, -6.9],
      [39.35, -6.9],
      [39.35, -6.7],
      [39.15, -6.7],
      [39.15, -6.9],
    ],
    [
      [39.2, -6.82],
      [39.22, -6.82],
      [39.22, -6.78],
      [39.2, -6.78],
      [39.2, -6.82],
    ],
  ],
};

describe('pointInPolygon', () => {
  it('returns true for a point clearly inside the polygon', () => {
    const p = { lat: -6.8, lng: 39.25 };
    expect(pointInPolygon(p, DSM_RECTANGLE)).toBe(true);
  });

  it('returns false for a point outside the polygon', () => {
    const arusha = { lat: -3.3869, lng: 36.683 };
    expect(pointInPolygon(arusha, DSM_RECTANGLE)).toBe(false);
  });

  it('returns false for a point inside a polygon hole', () => {
    // Centre of the cut-out hole.
    const cityCentre = { lat: -6.8, lng: 39.21 };
    expect(pointInPolygon(cityCentre, DSM_WITH_HOLE)).toBe(false);
  });

  it('returns true for a point inside the outer ring but outside the hole', () => {
    const outsideHole = { lat: -6.85, lng: 39.3 };
    expect(pointInPolygon(outsideHole, DSM_WITH_HOLE)).toBe(true);
  });

  it('returns false for an empty polygon', () => {
    const empty: GeoJsonPolygon = { type: 'Polygon', coordinates: [] };
    expect(pointInPolygon({ lat: 0, lng: 0 }, empty)).toBe(false);
  });
});
