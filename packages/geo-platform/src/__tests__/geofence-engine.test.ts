/**
 * Tests for the geofence engine.
 *
 * Covers: bbox computation, ray-cast point-in-polygon (including holes
 * and edge cases), enter / exit / dwell transitions, and the engine's
 * immutability guarantee.
 */
import { describe, expect, it } from 'vitest';
import {
  GeofenceEngine,
  pointInPolygon,
  polygonBoundingBox,
} from '../geofence/geofence-engine.js';
import { GeofenceEventBus } from '../geofence/geofence-events.js';
import type { GeoFence, GeoJsonPoint, GeoJsonPolygon } from '../types.js';

// A simple square around (0,0): 100 m × 100 m approx (1° ≈ 111 km).
const SQUARE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-0.001, -0.001],
      [0.001, -0.001],
      [0.001, 0.001],
      [-0.001, 0.001],
      [-0.001, -0.001],
    ],
  ],
};

// Square with a hole in the middle.
const SQUARE_WITH_HOLE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-0.002, -0.002],
      [0.002, -0.002],
      [0.002, 0.002],
      [-0.002, 0.002],
      [-0.002, -0.002],
    ],
    [
      [-0.0005, -0.0005],
      [0.0005, -0.0005],
      [0.0005, 0.0005],
      [-0.0005, 0.0005],
      [-0.0005, -0.0005],
    ],
  ],
};

function point(lon: number, lat: number): GeoJsonPoint {
  return { type: 'Point', coordinates: [lon, lat] };
}

describe('polygonBoundingBox', () => {
  it('computes the min/max lon/lat across all rings', () => {
    const bbox = polygonBoundingBox(SQUARE_WITH_HOLE);
    expect(bbox).toEqual({
      minLon: -0.002,
      minLat: -0.002,
      maxLon: 0.002,
      maxLat: 0.002,
    });
  });

  it('handles a single-vertex degenerate polygon without throwing', () => {
    const degenerate: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [1, 2],
          [1, 2],
        ],
      ],
    };
    const bbox = polygonBoundingBox(degenerate);
    expect(bbox.minLon).toBe(1);
    expect(bbox.maxLat).toBe(2);
  });
});

describe('pointInPolygon', () => {
  it('returns true for a point inside the outer ring', () => {
    expect(pointInPolygon(point(0, 0), SQUARE)).toBe(true);
  });

  it('returns false for a point outside', () => {
    expect(pointInPolygon(point(0.005, 0.005), SQUARE)).toBe(false);
  });

  it('returns false for a point inside a hole', () => {
    expect(pointInPolygon(point(0, 0), SQUARE_WITH_HOLE)).toBe(false);
  });

  it('returns true between the hole and outer ring', () => {
    expect(pointInPolygon(point(0.001, 0.001), SQUARE_WITH_HOLE)).toBe(true);
  });
});

describe('GeofenceEngine — enter / exit transitions', () => {
  const fence: GeoFence = { id: 'f1', label: 'yard', polygon: SQUARE };

  it('emits enter when subject crosses in from outside', () => {
    const engine = GeofenceEngine.create([fence]);
    const { events, engine: next } = engine.detect({
      subjectId: 'worker-1',
      point: point(0, 0),
      at: '2026-05-24T10:00:00Z',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('enter');
    expect(events[0]?.fenceId).toBe('f1');
    expect(next.insideFor('worker-1').has('f1')).toBe(true);
  });

  it('does not re-emit enter on repeat inside detections', () => {
    const e1 = GeofenceEngine.create([fence]);
    const { engine: e2 } = e1.detect({
      subjectId: 'w',
      point: point(0, 0),
      at: '2026-05-24T10:00:00Z',
    });
    const { events } = e2.detect({
      subjectId: 'w',
      point: point(0.0005, 0.0005),
      at: '2026-05-24T10:00:01Z',
    });
    expect(events).toHaveLength(0);
  });

  it('emits exit when subject leaves', () => {
    const e1 = GeofenceEngine.create([fence]);
    const { engine: e2 } = e1.detect({
      subjectId: 'w',
      point: point(0, 0),
      at: '2026-05-24T10:00:00Z',
    });
    const { events, engine: e3 } = e2.detect({
      subjectId: 'w',
      point: point(1, 1),
      at: '2026-05-24T10:00:01Z',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('exit');
    expect(e3.insideFor('w').size).toBe(0);
  });

  it('emits dwell once the threshold passes', () => {
    const e1 = GeofenceEngine.create([fence]);
    const { engine: e2 } = e1.detect({
      subjectId: 'w',
      point: point(0, 0),
      at: '2026-05-24T10:00:00Z',
    });
    const { events } = e2.detect(
      {
        subjectId: 'w',
        point: point(0, 0),
        at: '2026-05-24T10:00:05Z',
      },
      { dwellThresholdMs: 5_000 },
    );
    expect(events.some((e) => e.kind === 'dwell' && e.dwellMs === 5_000)).toBe(true);
  });
});

describe('GeofenceEngine immutability', () => {
  it('returns a new engine instance on every detect', () => {
    const e1 = GeofenceEngine.create([
      { id: 'a', label: 'a', polygon: SQUARE },
    ]);
    const { engine: e2 } = e1.detect({
      subjectId: 'x',
      point: point(0, 0),
    });
    expect(e2).not.toBe(e1);
    expect(e1.insideFor('x').size).toBe(0);
    expect(e2.insideFor('x').size).toBe(1);
  });

  it('withFences carries forward state for surviving fence ids', () => {
    const e1 = GeofenceEngine.create([
      { id: 'a', label: 'a', polygon: SQUARE },
      { id: 'b', label: 'b', polygon: SQUARE },
    ]);
    const { engine: e2 } = e1.detect({ subjectId: 'x', point: point(0, 0) });
    const e3 = e2.withFences([{ id: 'a', label: 'a', polygon: SQUARE }]);
    expect(e3.insideFor('x').has('a')).toBe(true);
    expect(e3.insideFor('x').has('b')).toBe(false);
  });
});

describe('GeofenceEventBus', () => {
  it('dispatches only to subscribers of the matching kind', () => {
    const bus = new GeofenceEventBus();
    const enters: string[] = [];
    const all: string[] = [];
    bus.on('enter', (e) => enters.push(e.fenceId));
    bus.onAny((e) => all.push(`${e.kind}:${e.fenceId}`));
    bus.emit([
      { kind: 'enter', fenceId: 'a', subjectId: 's', point: point(0, 0), at: 'now' },
      { kind: 'exit', fenceId: 'a', subjectId: 's', point: point(0, 0), at: 'now' },
    ]);
    expect(enters).toEqual(['a']);
    expect(all).toEqual(['enter:a', 'exit:a']);
  });

  it('continues dispatch when a listener throws', () => {
    const bus = new GeofenceEventBus();
    const seen: string[] = [];
    bus.onAny(() => {
      throw new Error('boom');
    });
    bus.onAny((e) => seen.push(e.kind));
    expect(() =>
      bus.emit([
        { kind: 'enter', fenceId: 'a', subjectId: 's', point: point(0, 0), at: 'now' },
      ]),
    ).not.toThrow();
    expect(seen).toEqual(['enter']);
  });
});
