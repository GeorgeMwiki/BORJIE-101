/**
 * Per-org elastic geo-hierarchy. NOT the country registry — see
 * `packages/domain-models/src/common/region-config.ts` for currency/compliance/tax.
 * This module handles location trees only.
 *
 * Design summary (see Docs/analysis/CONFLICT_RESOLUTIONS.md §3):
 *   - Each organization defines its OWN label vocabulary and nesting direction
 *     (e.g. a public-sector estate client: Districts > Regions; a Kenyan org:
 *     Counties > Sub-counties > Wards).
 *   - Arbitrary depth (N-level nesting) via `GeoNode.parentId`.
 *   - Each node optionally carries a GeoJSON polygon for map rendering and
 *     point-in-polygon classification.
 *   - Workforce assignments (`GeoAssignment`) may bind users/tags to any node
 *     and optionally cascade to descendants.
 *
 * All types here are PURE: no DB access, no I/O, no side effects.
 *
 * GeoJSON note (RFC 7946): coordinate pairs are `[lng, lat]` (longitude first,
 * then latitude). This is the opposite of the common `{ lat, lng }` object
 * convention used elsewhere in this codebase for pins/centroids.
 */

import type { Brand, OrganizationId, UserId, ISOTimestamp } from '../common/types';

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export type GeoNodeId = Brand<string, 'GeoNodeId'>;
export type GeoLabelTypeId = Brand<string, 'GeoLabelTypeId'>;
export type GeoAssignmentId = Brand<string, 'GeoAssignmentId'>;

export function asGeoNodeId(id: string): GeoNodeId {
  return id as GeoNodeId;
}

export function asGeoLabelTypeId(id: string): GeoLabelTypeId {
  return id as GeoLabelTypeId;
}

export function asGeoAssignmentId(id: string): GeoAssignmentId {
  return id as GeoAssignmentId;
}

// ---------------------------------------------------------------------------
// GeoJSON polygon shape
// ---------------------------------------------------------------------------

/**
 * A single coordinate pair in GeoJSON order: `[longitude, latitude]`.
 * RFC 7946. DO NOT swap to `[lat, lng]` — Google Maps Data layer, Mapbox,
 * PostGIS GeoJSON all expect this order.
 */
export type GeoCoordinate = readonly [number, number];

/** A linear ring of coordinates (closed loop — first and last coords equal). */
export type GeoLinearRing = readonly GeoCoordinate[];

/**
 * GeoJSON Polygon / MultiPolygon representation.
 *
 * Coordinate nesting:
 *   - Polygon:      rings[]                     → ring[]           → [lng, lat]
 *   - MultiPolygon: polygons[] → polygon rings[] → ring[]          → [lng, lat]
 *
 * The first ring of a Polygon is the outer boundary; subsequent rings are holes.
 */
export interface GeoPolygon {
  readonly type: 'Polygon' | 'MultiPolygon';
  readonly coordinates:
    | readonly GeoLinearRing[]
    | readonly (readonly GeoLinearRing[])[];
}

// ---------------------------------------------------------------------------
// Label types — per-org classification of hierarchy levels
// ---------------------------------------------------------------------------

/**
 * Org-defined label for a single ordinal depth in its hierarchy.
 *
 * Examples:
 *   Public-sector estate: depth=0 "District", depth=1 "Region", depth=2 "Ward".
 *   Kenyan org:           depth=0 "County",   depth=1 "Sub-county", depth=2 "Ward".
 *
 * `depth` is ORDINAL only — it carries no global semantic meaning. "Region"
 * in one org's tree and "Region" in another org's tree are unrelated concepts.
 */
export interface GeoLabelType {
  readonly id: GeoLabelTypeId;
  readonly organizationId: OrganizationId;
  /** 0 = direct child of root. Increases deeper in tree. */
  readonly depth: number;
  /** Singular display noun, e.g. "District". */
  readonly singular: string;
  /** Plural display noun, e.g. "Districts". */
  readonly plural: string;
  /** Default HEX color for nodes of this depth. null = use fallback. */
  readonly color: string | null;
  /** If false, UI prevents drawing polygons for nodes of this depth. */
  readonly allowsPolygon: boolean;
}

// ---------------------------------------------------------------------------
// GeoNode — the tree
// ---------------------------------------------------------------------------

/**
 * A single node in an organization's geo-hierarchy.
 *
 * `parentId === null` marks a root node. Arbitrary depth is permitted;
 * the effective depth is recorded by the referenced `GeoLabelType.depth`
 * and by closure-table entries.
 */
export interface GeoNode {
  readonly id: GeoNodeId;
  readonly organizationId: OrganizationId;
  readonly parentId: GeoNodeId | null;
  readonly labelTypeId: GeoLabelTypeId;
  readonly name: string;
  /** Optional internal/admin code, e.g. census code. null if unused. */
  readonly code: string | null;
  /** GeoJSON polygon for map rendering / point-in-polygon tests. */
  readonly polygon: GeoPolygon | null;
  /** Cached centroid for labeling + zoom-to. Uses `{lat,lng}` (NOT GeoJSON). */
  readonly centroid: { readonly lat: number; readonly lng: number } | null;
  /** Per-node color override; falls back to label-type color. */
  readonly colorOverride: string | null;
  /** Sort order among siblings. */
  readonly orderIndex: number;
  /** Open-ended metadata bag (e.g. population, area). */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Closure table — O(1) ancestor/descendant lookups
// ---------------------------------------------------------------------------

/**
 * A single row in the closure table. For every (ancestor, descendant) pair
 * in the tree (including self-pairs with depth=0) there is exactly one row.
 *
 * `depth` = number of hops from ancestor to descendant. A node's row with
 * itself has depth=0.
 */
export interface GeoNodeClosure {
  readonly ancestorId: GeoNodeId;
  readonly descendantId: GeoNodeId;
  readonly depth: number;
}

// ---------------------------------------------------------------------------
// Geo-scoped workforce assignments
// ---------------------------------------------------------------------------

export type GeoResponsibility =
  | 'station_master'
  | 'surveyor'
  | 'manager'
  | 'worker';

/**
 * Binds a user (or worker-tag) to a geo-node with a responsibility.
 * When `inherits=true`, the assignment cascades to all descendants of
 * `geoNodeId`.
 */
export interface GeoAssignment {
  readonly id: GeoAssignmentId;
  readonly organizationId: OrganizationId;
  readonly geoNodeId: GeoNodeId;
  readonly userId?: UserId;
  readonly workerTagKey?: string;
  readonly responsibility: GeoResponsibility;
  readonly inherits: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, no mutation, deterministic
// ---------------------------------------------------------------------------

/**
 * Returns the ancestor ids of `nodeId` from closest (depth=1) to farthest,
 * using the given closure rows. Excludes the self-pair (depth=0).
 *
 * Pure function: does not mutate inputs.
 */
export function getAncestorIds(
  closures: readonly GeoNodeClosure[],
  nodeId: GeoNodeId
): readonly GeoNodeId[] {
  return closures
    .filter((c) => c.descendantId === nodeId && c.depth > 0)
    .slice()
    .sort((a, b) => a.depth - b.depth)
    .map((c) => c.ancestorId);
}

/**
 * Returns the descendant ids of `nodeId` from closest (depth=1) to farthest.
 * Excludes the self-pair (depth=0).
 *
 * Pure function: does not mutate inputs.
 */
export function getDescendantIds(
  closures: readonly GeoNodeClosure[],
  nodeId: GeoNodeId
): readonly GeoNodeId[] {
  return closures
    .filter((c) => c.ancestorId === nodeId && c.depth > 0)
    .slice()
    .sort((a, b) => a.depth - b.depth)
    .map((c) => c.descendantId);
}

// ---------------------------------------------------------------------------
// Point-in-polygon (ray casting)
// ---------------------------------------------------------------------------

/** Type guard for MultiPolygon shape. */
function isMultiPolygonCoords(
  polygon: GeoPolygon
): polygon is GeoPolygon & {
  readonly coordinates: readonly (readonly GeoLinearRing[])[];
} {
  return polygon.type === 'MultiPolygon';
}

/**
 * Deterministic ray-casting test: is the point on or inside the given
 * linear ring? "On the edge" is treated deterministically as INSIDE.
 *
 * Input is a GeoJSON ring — each coord is `[lng, lat]`.
 */
function pointInRing(
  lng: number,
  lat: number,
  ring: GeoLinearRing
): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    const [xi, yi] = pi;
    const [xj, yj] = pj;

    // Edge check: point lies exactly on segment (i,j) → INSIDE (deterministic).
    const onSegment =
      Math.min(xi, xj) <= lng &&
      lng <= Math.max(xi, xj) &&
      Math.min(yi, yj) <= lat &&
      lat <= Math.max(yi, yj) &&
      // Cross-product ≈ 0 → collinear.
      Math.abs((xj - xi) * (lat - yi) - (yj - yi) * (lng - xi)) < 1e-12;
    if (onSegment) return true;

    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Classic polygon containment test over a single polygon (outer ring +
 * optional holes). Point is treated as inside if within the outer ring
 * AND not inside any hole.
 */
function pointInSinglePolygon(
  lng: number,
  lat: number,
  rings: readonly GeoLinearRing[]
): boolean {
  if (rings.length === 0) return false;
  const [outer, ...holes] = rings;
  if (!outer) return false;
  if (!pointInRing(lng, lat, outer)) return false;
  for (const hole of holes) {
    if (pointInRing(lng, lat, hole)) return false;
  }
  return true;
}

/**
 * Ray-casting point-in-polygon for GeoJSON `Polygon` and `MultiPolygon`.
 *
 * Input point uses the `{ lat, lng }` convention (consistent with
 * `GeoNode.centroid`). Polygon coordinates are GeoJSON `[lng, lat]`.
 *
 * - Polygon:      true iff inside outer ring and not inside any hole.
 * - MultiPolygon: true iff inside any of the component polygons.
 * - Point on edge: deterministically INSIDE.
 *
 * Pure function.
 */
export function pointInPolygon(
  point: { readonly lat: number; readonly lng: number },
  polygon: GeoPolygon
): boolean {
  const { lat, lng } = point;

  if (isMultiPolygonCoords(polygon)) {
    for (const poly of polygon.coordinates) {
      if (pointInSinglePolygon(lng, lat, poly)) return true;
    }
    return false;
  }

  // Polygon
  const rings = polygon.coordinates as readonly GeoLinearRing[];
  return pointInSinglePolygon(lng, lat, rings);
}
