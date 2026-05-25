import { describe, expect, it } from 'vitest';
import {
  circlePolygon,
  closeRing,
  createPolygonEditor,
  hexagonPolygon,
  isPolygonSelfIntersecting,
  mergeIntoMultiPolygon,
  pointInPolygon,
  polygonAreaSqm,
  polygonBoundingBox,
  polygonCentroid,
  punchHole,
  rectanglePolygon,
  regularNgonPolygon,
  splitPolygon,
  webMercatorToWgs84,
  wgs84ToWebMercator,
} from '../geometry/index.js';
import type { GeoJsonPoint, GeoJsonPolygon, Position } from '../types.js';

describe('geometry — bounding box', () => {
  it('produces correct bbox for a square polygon', () => {
    const poly: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ] as readonly Position[]],
    };
    expect(polygonBoundingBox(poly)).toEqual({ minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 });
  });

  it('handles MultiPolygon bbox', () => {
    const poly = mergeIntoMultiPolygon([
      rectanglePolygon({ type: 'Point', coordinates: [0, 0] }, 1000, 1000),
      rectanglePolygon({ type: 'Point', coordinates: [10, 10] }, 1000, 1000),
    ]);
    const bbox = polygonBoundingBox(poly);
    expect(bbox.minLon).toBeLessThan(bbox.maxLon);
    expect(bbox.minLat).toBeLessThan(bbox.maxLat);
  });

  it('handles empty polygon gracefully', () => {
    const poly: GeoJsonPolygon = { type: 'Polygon', coordinates: [[]] };
    expect(polygonBoundingBox(poly)).toEqual({ minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 });
  });
});

describe('geometry — area calculation', () => {
  it('rectangle of 100m x 50m is ~5000 sqm (±0.1%)', () => {
    const center: GeoJsonPoint = { type: 'Point', coordinates: [36.0, -1.0] };
    const rect = rectanglePolygon(center, 100, 50);
    const area = polygonAreaSqm(rect);
    expect(area).toBeGreaterThan(5000 * 0.99);
    expect(area).toBeLessThan(5000 * 1.01);
  });

  it('circle of 100m radius is ~31415 sqm (±2% for 64-segment approximation)', () => {
    const center: GeoJsonPoint = { type: 'Point', coordinates: [0, 0] };
    const circle = circlePolygon(center, 100, 64);
    const area = polygonAreaSqm(circle);
    const expected = Math.PI * 100 * 100;
    expect(area).toBeGreaterThan(expected * 0.97);
    expect(area).toBeLessThan(expected * 1.02);
  });

  it('hexagon of 100m radius is ~26000 sqm', () => {
    const center: GeoJsonPoint = { type: 'Point', coordinates: [0, 0] };
    const hex = hexagonPolygon(center, 100);
    const area = polygonAreaSqm(hex);
    // Regular hexagon: (3*sqrt(3)/2) * r^2 ≈ 25,981
    expect(area).toBeGreaterThan(25000);
    expect(area).toBeLessThan(27000);
  });

  it('returns 0 for degenerate polygon', () => {
    const poly: GeoJsonPolygon = { type: 'Polygon', coordinates: [[
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ] as readonly Position[]] };
    expect(polygonAreaSqm(poly)).toBe(0);
  });

  it('subtracts holes from outer ring', () => {
    const center: GeoJsonPoint = { type: 'Point', coordinates: [0, 0] };
    const outer = rectanglePolygon(center, 200, 200);
    const hole = rectanglePolygon(center, 100, 100);
    const punched = punchHole(outer, hole.coordinates[0] as readonly Position[]);
    const outerArea = polygonAreaSqm(outer);
    const punchedArea = polygonAreaSqm(punched);
    expect(punchedArea).toBeLessThan(outerArea);
    expect(punchedArea).toBeGreaterThan(outerArea * 0.6);
  });
});

describe('geometry — centroid', () => {
  it('square centroid is at center', () => {
    const square: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
        [0, 0],
      ] as readonly Position[]],
    };
    const c = polygonCentroid(square);
    expect(c.coordinates[0]).toBeCloseTo(5, 5);
    expect(c.coordinates[1]).toBeCloseTo(5, 5);
  });

  it('returns origin for empty polygon', () => {
    const poly: GeoJsonPolygon = { type: 'Polygon', coordinates: [[]] };
    expect(polygonCentroid(poly).coordinates).toEqual([0, 0]);
  });
});

describe('geometry — self-intersection', () => {
  it('detects bow-tie self-intersection', () => {
    const bowtie: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
        [0, 0],
      ] as readonly Position[]],
    };
    expect(isPolygonSelfIntersecting(bowtie)).toBe(true);
  });

  it('does NOT mark a valid convex polygon as intersecting', () => {
    const square: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ] as readonly Position[]],
    };
    expect(isPolygonSelfIntersecting(square)).toBe(false);
  });
});

describe('geometry — point-in-polygon', () => {
  it('point inside a square returns true', () => {
    const square: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ] as readonly Position[]],
    };
    expect(pointInPolygon({ type: 'Point', coordinates: [5, 5] }, square)).toBe(true);
  });

  it('point outside a square returns false', () => {
    const square: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ] as readonly Position[]],
    };
    expect(pointInPolygon({ type: 'Point', coordinates: [50, 50] }, square)).toBe(false);
  });

  it('point inside a hole returns false', () => {
    const center: GeoJsonPoint = { type: 'Point', coordinates: [0, 0] };
    const outer = rectanglePolygon(center, 1000, 1000);
    const hole = rectanglePolygon(center, 500, 500);
    const punched = punchHole(outer, hole.coordinates[0] as readonly Position[]);
    expect(pointInPolygon(center, punched)).toBe(false);
  });
});

describe('geometry — regular shapes', () => {
  it('rectangle has 5 vertices (closed ring)', () => {
    const rect = rectanglePolygon({ type: 'Point', coordinates: [0, 0] }, 100, 50);
    expect(rect.coordinates[0]?.length).toBe(5);
  });

  it('circle requires at least 8 segments', () => {
    expect(() => circlePolygon({ type: 'Point', coordinates: [0, 0] }, 100, 4)).toThrow();
  });

  it('hexagon has 7 vertices (closed)', () => {
    const hex = hexagonPolygon({ type: 'Point', coordinates: [0, 0] }, 100);
    expect(hex.coordinates[0]?.length).toBe(7);
  });

  it('n-gon with 5 sides has 6 vertices', () => {
    const pent = regularNgonPolygon({ type: 'Point', coordinates: [0, 0] }, 100, 5);
    expect(pent.coordinates[0]?.length).toBe(6);
  });

  it('regular n-gon refuses <3 sides', () => {
    expect(() => regularNgonPolygon({ type: 'Point', coordinates: [0, 0] }, 100, 2)).toThrow();
  });
});

describe('geometry — polygon editor', () => {
  it('starts empty in drafting state', () => {
    const e = createPolygonEditor();
    expect(e.state).toBe('drafting');
    expect(e.vertices.length).toBe(0);
    expect(e.polygon).toBeNull();
  });

  it('adds vertices immutably', () => {
    const a = createPolygonEditor();
    const b = a.addVertex([0, 0]);
    expect(a.vertices.length).toBe(0);
    expect(b.vertices.length).toBe(1);
  });

  it('removes vertex at index', () => {
    const e = createPolygonEditor([[0, 0], [10, 0], [10, 10]] as Position[]);
    const removed = e.removeVertex(1);
    expect(removed.vertices.length).toBe(2);
    expect(removed.vertices[0]).toEqual([0, 0]);
    expect(removed.vertices[1]).toEqual([10, 10]);
  });

  it('moves vertex at index', () => {
    const e = createPolygonEditor([[0, 0], [10, 0], [10, 10]] as Position[]);
    const moved = e.moveVertex(1, [20, 0]);
    expect(moved.vertices[1]).toEqual([20, 0]);
  });

  it('refuses to close with <3 vertices', () => {
    const e = createPolygonEditor([[0, 0], [10, 10]] as Position[]);
    expect(() => e.close()).toThrow();
  });

  it('refuses to close a self-intersecting polygon', () => {
    const e = createPolygonEditor([[0, 0], [10, 10], [10, 0], [0, 10]] as Position[]);
    expect(() => e.close()).toThrow(/self-intersecting/);
  });

  it('closes a valid polygon and exposes it', () => {
    const e = createPolygonEditor([[0, 0], [10, 0], [10, 10], [0, 10]] as Position[]);
    const closed = e.close();
    expect(closed.state).toBe('closed');
    expect(closed.polygon).not.toBeNull();
  });

  it('throws when adding a vertex to a closed polygon', () => {
    const e = createPolygonEditor([[0, 0], [10, 0], [10, 10], [0, 10]] as Position[]).close();
    expect(() => e.addVertex([5, 5])).toThrow();
  });

  it('rejects out-of-range vertex index', () => {
    const e = createPolygonEditor([[0, 0]] as Position[]);
    expect(() => e.removeVertex(5)).toThrow();
    expect(() => e.moveVertex(-1, [0, 0])).toThrow();
  });
});

describe('geometry — split / merge', () => {
  it('split splits a square horizontally into two parts', () => {
    const square: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ] as readonly Position[]],
    };
    const { left, right } = splitPolygon(square, [[-1, 5], [11, 5]] as Position[]);
    expect(left.coordinates[0]?.length).toBeGreaterThan(2);
    expect(right.coordinates[0]?.length).toBeGreaterThan(2);
  });

  it('split throws when cut line does not intersect', () => {
    const square: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ] as readonly Position[]],
    };
    expect(() => splitPolygon(square, [[100, 100], [200, 200]] as Position[])).toThrow();
  });

  it('mergeIntoMultiPolygon preserves all rings', () => {
    const a = rectanglePolygon({ type: 'Point', coordinates: [0, 0] }, 1000, 1000);
    const b = rectanglePolygon({ type: 'Point', coordinates: [10, 10] }, 1000, 1000);
    const merged = mergeIntoMultiPolygon([a, b]);
    expect(merged.type).toBe('MultiPolygon');
    expect(merged.coordinates.length).toBe(2);
  });
});

describe('geometry — coordinate normalization', () => {
  it('round-trips lat/lng through Web Mercator', () => {
    const lon = 36.8;
    const lat = -1.28;
    const mercator = wgs84ToWebMercator(lon, lat);
    const back = webMercatorToWgs84(mercator.x, mercator.y);
    expect(back.lng).toBeCloseTo(lon, 4);
    expect(back.lat).toBeCloseTo(lat, 4);
  });

  it('clamps lat near poles to avoid Infinity', () => {
    const mercator = wgs84ToWebMercator(0, 90);
    expect(Number.isFinite(mercator.y)).toBe(true);
  });
});

describe('geometry — closeRing', () => {
  it('closes an open ring', () => {
    const open: Position[] = [[0, 0], [10, 0], [10, 10]];
    const closed = closeRing(open);
    expect(closed.length).toBe(4);
    expect(closed[closed.length - 1]).toEqual([0, 0]);
  });

  it('returns input unchanged if already closed', () => {
    const closed: Position[] = [[0, 0], [10, 0], [0, 0]];
    expect(closeRing(closed)).toBe(closed);
  });

  it('handles empty input', () => {
    expect(closeRing([]).length).toBe(0);
  });
});
