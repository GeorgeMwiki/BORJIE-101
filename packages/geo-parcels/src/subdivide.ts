/**
 * Piece N — parcel subdivision.
 *
 * `subdivideParcel` accepts a parent (either a `land_area` for the
 * first cut, or an existing `parcel` for sub-subdivision) plus the
 * child polygons. It validates:
 *
 *   1. Every child polygon lies fully INSIDE the parent boundary.
 *   2. No two child polygons OVERLAP (sibling exclusivity).
 *   3. Each child polygon is well-formed (closed ring, ≥ 4 points).
 *
 * Validation passes once on the application side via Cartesian
 * polygon maths (fast, cheap, deterministic for tests). PostGIS
 * re-validates on the server via `ST_Within` and `ST_Intersects`
 * before the constraint-checked INSERTs commit — defence-in-depth.
 *
 * Each successful subdivide emits one activity log event per child
 * (`event_kind: 'subdivided'`).
 */

import { GeoParcelsError, ParcelSchema } from './types.js';
import type {
  CaptureVia,
  Parcel,
  Polygon,
} from './types.js';
import {
  polygonAreaSqm,
  polygonCentroid,
  polygonWithin,
  polygonsOverlap,
} from './polygon-math.js';
import type { GeoParcelsPort } from './persistence-port.js';
import { appendActivity } from './activity-log.js';

export interface ChildParcelSpec {
  /** Application-supplied stable id. */
  id: string;
  display_name: string;
  boundary_polygon: Polygon;
  parcel_number?: string | null;
  color_hex?: string | null;
  label?: string | null;
  zoning?: Parcel['zoning'] | null;
  land_use?: string | null;
  road_frontage_m?: number | null;
  core_entity_id?: string | null;
}

export interface SubdivideArgs {
  tenant_id: string;
  /** Parent type — drives validation path. */
  parent_kind: 'land_area' | 'parcel';
  parent_id: string;
  parent_boundary_polygon: Polygon;
  /** land_area_id even if parent_kind === 'parcel' — every parcel ultimately roots to a land_area. */
  land_area_id: string;
  parent_parcel_id?: string | null;
  children: ChildParcelSpec[];
  actor_user_id: string;
  actor_persona_id?: string | null;
  /** Source attribution for the activity-log payload. */
  captured_via?: CaptureVia;
}

/**
 * Validate non-overlap among siblings. O(n²) sweep — fine for typical
 * batch sizes (single-digit children). For larger batches, callers
 * should chunk.
 */
function assertSiblingsDontOverlap(children: ChildParcelSpec[]): void {
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      if (
        polygonsOverlap(
          children[i]!.boundary_polygon,
          children[j]!.boundary_polygon,
        )
      ) {
        throw new GeoParcelsError(
          'SIBLING_OVERLAP',
          `child parcels ${children[i]!.id} and ${children[j]!.id} overlap`,
        );
      }
    }
  }
}

/**
 * Validate each child is fully within the parent boundary.
 */
function assertChildrenWithinParent(
  parent: Polygon,
  children: ChildParcelSpec[],
): void {
  for (const child of children) {
    if (!polygonWithin(child.boundary_polygon, parent)) {
      throw new GeoParcelsError(
        'CHILD_OUT_OF_BOUNDS',
        `child parcel ${child.id} is not fully inside parent boundary`,
      );
    }
  }
}

/**
 * Subdivide a parent into N children. Returns the persisted parcels.
 */
export async function subdivideParcel(
  port: GeoParcelsPort,
  args: SubdivideArgs,
): Promise<Parcel[]> {
  if (args.children.length === 0) {
    throw new GeoParcelsError('NO_CHILDREN', 'subdivide requires at least one child');
  }

  // 1. Sibling non-overlap.
  assertSiblingsDontOverlap(args.children);

  // 2. Within-parent containment.
  assertChildrenWithinParent(args.parent_boundary_polygon, args.children);

  // 3. Build candidate parcel rows.
  const now = new Date().toISOString();
  const rows: Parcel[] = args.children.map((child) => {
    const center_point = polygonCentroid(child.boundary_polygon);
    const area_sqm = polygonAreaSqm(child.boundary_polygon);
    const parcel: Parcel = {
      id: child.id,
      tenant_id: args.tenant_id,
      land_area_id: args.land_area_id,
      parent_parcel_id:
        args.parent_kind === 'parcel'
          ? (args.parent_parcel_id ?? args.parent_id)
          : null,
      core_entity_id: child.core_entity_id ?? null,
      display_name: child.display_name,
      boundary_polygon: child.boundary_polygon,
      center_point,
      area_sqm,
      parcel_number: child.parcel_number ?? null,
      status: 'available',
      status_changed_at: now,
      color_hex: child.color_hex ?? null,
      label: child.label ?? null,
      zoning: child.zoning ?? null,
      land_use: child.land_use ?? null,
      road_frontage_m: child.road_frontage_m ?? null,
      created_at: now,
      updated_at: now,
    };
    // Validate full shape — surfaces colour/zoning regex issues early.
    const result = ParcelSchema.safeParse(parcel);
    if (!result.success) {
      throw new GeoParcelsError(
        'INVALID_PARCEL',
        `child parcel ${child.id} failed validation: ${result.error.message}`,
      );
    }
    return parcel;
  });

  // 4. Persist.
  const persisted = await port.insertParcelsBatch(rows);

  // 5. Emit activity-log events — one per child.
  for (const row of persisted) {
    await appendActivity(port, {
      id: `${row.id}_act_created`,
      tenant_id: row.tenant_id,
      parcel_id: row.id,
      event_kind: 'created',
      event_payload_jsonb: {
        parent_kind: args.parent_kind,
        parent_id: args.parent_id,
        captured_via: args.captured_via ?? null,
      },
      actor_user_id: args.actor_user_id,
      actor_persona_id: args.actor_persona_id ?? null,
    });
  }

  // 6. Emit one event on the PARENT noting the subdivision.
  if (args.parent_kind === 'parcel') {
    await appendActivity(port, {
      id: `${args.parent_id}_act_subdivided_${Date.now()}`,
      tenant_id: args.tenant_id,
      parcel_id: args.parent_id,
      event_kind: 'subdivided',
      event_payload_jsonb: {
        child_parcel_ids: persisted.map((p) => p.id),
      },
      actor_user_id: args.actor_user_id,
      actor_persona_id: args.actor_persona_id ?? null,
    });
  }

  return persisted;
}
