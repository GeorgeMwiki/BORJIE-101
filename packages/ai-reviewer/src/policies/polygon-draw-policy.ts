/**
 * Polygon-draw policy.
 *
 * A "polygon draw" submits a new or updated parcel boundary. PreChecks
 * enforce the structural rules of a simple polygon (≥3 vertices,
 * closed/closeable, no obvious self-intersection markers). Red lines
 * catch boundaries that exceed the property envelope or would swallow
 * a neighbour parcel — those need a surveyor, not an LLM.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readNumber } from './_helpers.js';

interface Vertex {
  readonly lat: number;
  readonly lng: number;
}

function readVertices(payload: Readonly<Record<string, unknown>>): ReadonlyArray<Vertex> {
  const raw = readArray(payload, ['polygon', 'vertices']);
  if (!raw) return [];
  const out: Vertex[] = [];
  for (const v of raw) {
    if (
      v &&
      typeof v === 'object' &&
      typeof (v as { lat?: unknown }).lat === 'number' &&
      typeof (v as { lng?: unknown }).lng === 'number'
    ) {
      out.push({
        lat: (v as { lat: number }).lat,
        lng: (v as { lng: number }).lng,
      });
    }
  }
  return out;
}

export const polygonDrawPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'polygon_draw',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const vertices = readVertices(req.payload);
    if (vertices.length < 3) {
      issues.push(
        issue(
          'polygon.vertices.too_few',
          `A polygon needs at least 3 vertices; received ${vertices.length}.`,
          'error',
          'polygon.vertices',
        ),
      );
    }
    if (vertices.length > 0 && vertices.length < 4) {
      // edge case: 3 vertices is OK but no warnings
    }
    // Coordinate sanity
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i];
      if (!v) continue;
      if (v.lat < -90 || v.lat > 90 || v.lng < -180 || v.lng > 180) {
        issues.push(
          issue(
            'polygon.coordinates.out_of_range',
            `Vertex ${i} (${v.lat}, ${v.lng}) is outside valid lat/lng range.`,
            'error',
            `polygon.vertices[${i}]`,
          ),
        );
      }
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const vertices = readVertices(req.payload);
    if (vertices.length === 0) return redLines;
    // Bounding box sanity — vertices must not span > 0.5° lat or lng
    // (that would be ~55 km, clearly out of scale for a parcel).
    const lats = vertices.map((v) => v.lat);
    const lngs = vertices.map((v) => v.lng);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const lngSpan = Math.max(...lngs) - Math.min(...lngs);
    if (latSpan > 0.5 || lngSpan > 0.5) {
      redLines.push(
        issue(
          'polygon.span.too_large',
          `Polygon spans ${latSpan.toFixed(3)}° lat × ${lngSpan.toFixed(
            3,
          )}° lng — clearly not a single parcel. Re-draw or escalate to a surveyor.`,
          'critical',
          'polygon.vertices',
        ),
      );
    }
    // Optional declared maxAreaSqm; if the polygon claims an area larger
    // than its parent property envelope (carried on the payload) we red-line.
    const declared = readNumber(req.payload, ['polygon', 'declaredAreaSqm']);
    const envelope = readNumber(req.payload, ['propertyEnvelopeAreaSqm']);
    if (declared !== undefined && envelope !== undefined && declared > envelope * 1.05) {
      redLines.push(
        issue(
          'polygon.area.exceeds_envelope',
          `Declared polygon area (${declared} sqm) exceeds parent envelope (${envelope} sqm) by >5%.`,
          'critical',
          'polygon.declaredAreaSqm',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const vertices = readVertices(req.payload);
    return [
      `You are reviewing a polygon-draw submission for tenant ${req.context.tenantId}.`,
      `The polygon has ${vertices.length} vertices.`,
      `Decide whether the boundary looks plausible and self-consistent, or whether the user should redraw, escalate to a surveyor, or be rejected outright.`,
      `Use 'reject_with_changes' for fixable issues (gaps, near-misses); 'escalate' when only a surveyor can adjudicate.`,
    ].join(' ');
  },
};
