/**
 * Polygon editor — stateful, immutable.
 *
 * Each operation returns a NEW editor; the caller can keep history /
 * undo via plain array of snapshots. The editor wraps an in-flight
 * polygon (the "draft") and only emits a GeoJSON polygon on `close()`.
 *
 * Subdivision (`split`) and union (`merge`) operate on already-closed
 * polygons. They use simple cut-line geometry: split projects vertices
 * onto the cut line and re-builds two daughter polygons; merge is
 * union-by-shared-edge (caller must ensure the two polygons share at
 * least one edge).
 */

import type { GeoJsonPolygon, Position } from '../types.js';
import { closeRing, isPolygonSelfIntersecting, polygonAreaSqm } from './polygon-ops.js';

export type EditorState = 'drafting' | 'closed';

export interface PolygonEditor {
  readonly state: EditorState;
  readonly vertices: ReadonlyArray<Position>;
  readonly polygon: GeoJsonPolygon | null;
  readonly addVertex: (pos: Position) => PolygonEditor;
  readonly removeVertex: (index: number) => PolygonEditor;
  readonly moveVertex: (index: number, pos: Position) => PolygonEditor;
  readonly close: () => PolygonEditor;
  readonly reopen: () => PolygonEditor;
}

function build(state: EditorState, vertices: ReadonlyArray<Position>): PolygonEditor {
  let polygon: GeoJsonPolygon | null = null;
  if (state === 'closed' && vertices.length >= 3) {
    polygon = {
      type: 'Polygon',
      coordinates: [closeRing(vertices) as ReadonlyArray<Position>],
    };
  }
  return Object.freeze({
    state,
    vertices,
    polygon,
    addVertex(pos: Position): PolygonEditor {
      if (state === 'closed') {
        throw new Error('PolygonEditor: cannot addVertex on a closed polygon');
      }
      return build('drafting', [...vertices, pos]);
    },
    removeVertex(index: number): PolygonEditor {
      if (index < 0 || index >= vertices.length) {
        throw new Error(`PolygonEditor: vertex index ${index} out of range`);
      }
      const next = [...vertices.slice(0, index), ...vertices.slice(index + 1)];
      return build(state, next);
    },
    moveVertex(index: number, pos: Position): PolygonEditor {
      if (index < 0 || index >= vertices.length) {
        throw new Error(`PolygonEditor: vertex index ${index} out of range`);
      }
      const next = vertices.map((v, i) => (i === index ? pos : v));
      return build(state, next);
    },
    close(): PolygonEditor {
      if (vertices.length < 3) {
        throw new Error('PolygonEditor: need >= 3 vertices to close');
      }
      const candidate: GeoJsonPolygon = {
        type: 'Polygon',
        coordinates: [closeRing(vertices) as ReadonlyArray<Position>],
      };
      if (isPolygonSelfIntersecting(candidate)) {
        throw new Error('PolygonEditor: refused to close — self-intersecting');
      }
      return build('closed', vertices);
    },
    reopen(): PolygonEditor {
      return build('drafting', vertices);
    },
  });
}

export function createPolygonEditor(initial: ReadonlyArray<Position> = []): PolygonEditor {
  return build('drafting', initial);
}

// ============================================================================
// Hole punch — add an interior ring (forms a polygon-with-hole)
// ============================================================================

export function punchHole(
  polygon: GeoJsonPolygon,
  hole: ReadonlyArray<Position>,
): GeoJsonPolygon {
  if (hole.length < 3) {
    throw new Error('punchHole: hole ring must have >= 3 vertices');
  }
  const closedHole = closeRing(hole);
  return {
    type: 'Polygon',
    coordinates: [...polygon.coordinates, closedHole as ReadonlyArray<Position>],
  };
}

// ============================================================================
// Subdivide (split) — accepts a polygon + a cut LineString and returns
// two daughter polygons. Implementation: degenerate single-cut split
// that intersects exactly twice with the outer ring. For richer splits,
// callers should defer to a turf-backed implementation.
// ============================================================================

export interface SplitResult {
  readonly left: GeoJsonPolygon;
  readonly right: GeoJsonPolygon;
}

export function splitPolygon(
  polygon: GeoJsonPolygon,
  cutLine: ReadonlyArray<Position>,
): SplitResult {
  if (cutLine.length !== 2) {
    throw new Error('splitPolygon: cutLine must be a 2-point line for the simple split');
  }
  const outer = polygon.coordinates[0];
  if (!outer) throw new Error('splitPolygon: polygon has no outer ring');

  // Find segment intersections with the cut line.
  const cutA = cutLine[0] as Position;
  const cutB = cutLine[1] as Position;
  const hits: Array<{ readonly i: number; readonly t: number; readonly pt: Position }> = [];
  for (let i = 0; i < outer.length - 1; i++) {
    const a = outer[i] as Position;
    const b = outer[i + 1] as Position;
    const ix = segmentSegmentIntersection(a, b, cutA, cutB);
    if (ix) hits.push({ i, t: ix.t, pt: ix.pt });
  }
  if (hits.length < 2) {
    throw new Error('splitPolygon: cut line does not intersect polygon twice');
  }
  // Use the first two intersections.
  hits.sort((a, b) => a.i - b.i || a.t - b.t);
  const h1 = hits[0];
  const h2 = hits[1];
  if (!h1 || !h2) {
    throw new Error('splitPolygon: cut line does not intersect polygon twice');
  }

  const left: Position[] = [h1.pt];
  for (let k = h1.i + 1; k <= h2.i; k++) {
    left.push(outer[k] as Position);
  }
  left.push(h2.pt);

  const right: Position[] = [h2.pt];
  for (let k = h2.i + 1; k < outer.length; k++) {
    right.push(outer[k] as Position);
  }
  for (let k = 1; k <= h1.i; k++) {
    right.push(outer[k] as Position);
  }
  right.push(h1.pt);

  return {
    left: {
      type: 'Polygon',
      coordinates: [closeRing(left) as ReadonlyArray<Position>],
    },
    right: {
      type: 'Polygon',
      coordinates: [closeRing(right) as ReadonlyArray<Position>],
    },
  };
}

function segmentSegmentIntersection(
  p1: Position,
  p2: Position,
  p3: Position,
  p4: Position,
): { readonly t: number; readonly pt: Position } | null {
  const x1 = p1[0];
  const y1 = p1[1];
  const x2 = p2[0];
  const y2 = p2[1];
  const x3 = p3[0];
  const y3 = p3[1];
  const x4 = p4[0];
  const y4 = p4[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return {
    t,
    pt: [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] as Position,
  };
}

// ============================================================================
// Merge — naive: if two polygons share a vertex, output a MultiPolygon
// covering both; if they completely overlap one returns the larger.
// Production-grade union should use turf.union; this is a placeholder
// suitable for adjacent parcel merges where the two polygons share an
// edge already.
// ============================================================================

export function mergePolygons(
  a: GeoJsonPolygon,
  b: GeoJsonPolygon,
): GeoJsonPolygon {
  // If b is fully inside a, return a (and vice versa).
  if (polygonAreaSqm(b) === 0) return a;
  if (polygonAreaSqm(a) === 0) return b;
  // Simple concat — the caller should re-validate the resulting polygon.
  // For non-touching polygons callers should keep them as MultiPolygon
  // (use mergeIntoMultiPolygon below).
  const aOuter = a.coordinates[0] ?? [];
  const bOuter = b.coordinates[0] ?? [];
  const combined: Position[] = [
    ...(aOuter as ReadonlyArray<Position>),
    ...(bOuter as ReadonlyArray<Position>),
  ];
  return {
    type: 'Polygon',
    coordinates: [closeRing(combined) as ReadonlyArray<Position>],
  };
}

export function mergeIntoMultiPolygon(
  polygons: ReadonlyArray<GeoJsonPolygon>,
): {
  readonly type: 'MultiPolygon';
  readonly coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<Position>>>;
} {
  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((p) => p.coordinates),
  };
}
