import { describe, expect, it } from 'vitest';

import { captureLandArea } from '../land-area-capture.js';
import { subdivideParcel } from '../subdivide.js';
import { GeoParcelsError } from '../types.js';
import { verifyActivityChain } from '../activity-log.js';
import {
  InMemoryPort,
  TEST_CHILD_LL,
  TEST_CHILD_OUT_OF_BOUNDS,
  TEST_CHILD_OVERLAPPING,
  TEST_CHILD_UR,
  TEST_LAND_AREA_POLYGON,
} from './in-memory-port.js';

async function seedLandArea(port: InMemoryPort) {
  return captureLandArea(port, {
    id: 'la1',
    tenant_id: 't1',
    display_name: 'Plot 27',
    boundary_polygon: TEST_LAND_AREA_POLYGON,
    jurisdiction: 'TZ',
    captured_via: 'gps_walk',
    captured_by_user_id: 'u1',
  });
}

describe('subdivideParcel', () => {
  it('creates child parcels inside a land area', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);

    const children = await subdivideParcel(port, {
      tenant_id: 't1',
      parent_kind: 'land_area',
      parent_id: 'la1',
      parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
      land_area_id: 'la1',
      children: [
        {
          id: 'p1',
          display_name: '27A',
          boundary_polygon: TEST_CHILD_LL,
          parcel_number: '27A',
          color_hex: '#FF5722',
        },
        {
          id: 'p2',
          display_name: '27B',
          boundary_polygon: TEST_CHILD_UR,
          parcel_number: '27B',
        },
      ],
      actor_user_id: 'u1',
      captured_via: 'manual_draw',
    });

    expect(children).toHaveLength(2);
    expect(children[0]?.status).toBe('available');
    expect(children[0]?.color_hex).toBe('#FF5722');
    expect(children[1]?.area_sqm).toBeGreaterThan(0);

    const stored = await port.listParcelsByLandArea('la1', 't1');
    expect(stored).toHaveLength(2);
  });

  it('rejects when a sibling overlaps with another sibling', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);
    await expect(
      subdivideParcel(port, {
        tenant_id: 't1',
        parent_kind: 'land_area',
        parent_id: 'la1',
        parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
        land_area_id: 'la1',
        children: [
          { id: 'pa', display_name: 'a', boundary_polygon: TEST_CHILD_LL },
          { id: 'pb', display_name: 'b', boundary_polygon: TEST_CHILD_OVERLAPPING },
        ],
        actor_user_id: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'SIBLING_OVERLAP' });
  });

  it('rejects when a child is outside the parent boundary', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);
    await expect(
      subdivideParcel(port, {
        tenant_id: 't1',
        parent_kind: 'land_area',
        parent_id: 'la1',
        parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
        land_area_id: 'la1',
        children: [
          { id: 'pa', display_name: 'a', boundary_polygon: TEST_CHILD_LL },
          { id: 'pb', display_name: 'b', boundary_polygon: TEST_CHILD_OUT_OF_BOUNDS },
        ],
        actor_user_id: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'CHILD_OUT_OF_BOUNDS' });
  });

  it('rejects when no children supplied', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);
    await expect(
      subdivideParcel(port, {
        tenant_id: 't1',
        parent_kind: 'land_area',
        parent_id: 'la1',
        parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
        land_area_id: 'la1',
        children: [],
        actor_user_id: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'NO_CHILDREN' });
  });

  it('rejects when a child has an invalid color_hex', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);
    await expect(
      subdivideParcel(port, {
        tenant_id: 't1',
        parent_kind: 'land_area',
        parent_id: 'la1',
        parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
        land_area_id: 'la1',
        children: [
          {
            id: 'pa',
            display_name: 'bad-color',
            boundary_polygon: TEST_CHILD_LL,
            color_hex: 'not-a-hex',
          },
        ],
        actor_user_id: 'u1',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('emits activity log events on every child + parent subdivide', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);
    const [first] = await subdivideParcel(port, {
      tenant_id: 't1',
      parent_kind: 'land_area',
      parent_id: 'la1',
      parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
      land_area_id: 'la1',
      children: [{ id: 'pa', display_name: 'a', boundary_polygon: TEST_CHILD_LL }],
      actor_user_id: 'u1',
    });
    const events = await port.listActivityLog(first!.id, 't1');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_kind).toBe('created');
    expect(verifyActivityChain(events)).toEqual({ ok: true });
  });

  it('supports nested subdivision via parent_kind=parcel', async () => {
    const port = new InMemoryPort();
    await seedLandArea(port);
    // First-level subdivision.
    const [parent] = await subdivideParcel(port, {
      tenant_id: 't1',
      parent_kind: 'land_area',
      parent_id: 'la1',
      parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
      land_area_id: 'la1',
      children: [
        { id: 'p1', display_name: '27A', boundary_polygon: TEST_CHILD_LL },
      ],
      actor_user_id: 'u1',
    });
    expect(parent).toBeDefined();

    // Build a child polygon strictly inside TEST_CHILD_LL.
    const innerChild = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [39.2706, -6.8204],
          [39.2708, -6.8204],
          [39.2708, -6.8202],
          [39.2706, -6.8202],
          [39.2706, -6.8204],
        ],
      ],
    };

    const children = await subdivideParcel(port, {
      tenant_id: 't1',
      parent_kind: 'parcel',
      parent_id: parent!.id,
      parent_parcel_id: parent!.id,
      parent_boundary_polygon: parent!.boundary_polygon,
      land_area_id: 'la1',
      children: [{ id: 'p1a', display_name: '27A.1', boundary_polygon: innerChild }],
      actor_user_id: 'u1',
    });
    expect(children[0]?.parent_parcel_id).toBe(parent!.id);
    const parentEvents = await port.listActivityLog(parent!.id, 't1');
    // Parent gets `created` (when it was made) and `subdivided` (from this run).
    expect(parentEvents.map((e) => e.event_kind)).toContain('subdivided');
    expect(verifyActivityChain(parentEvents)).toEqual({ ok: true });
  });
});
