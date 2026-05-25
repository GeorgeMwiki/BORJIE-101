/**
 * Tenant-isolation invariants — simulated through the in-memory port's
 * RLS-aware fetch methods. Each tenant should be locked into their own
 * data on the BASE tables; cross-tenant data flow is ONLY through the
 * marketplace public view (faked by InMemoryPort.searchPublicListings).
 *
 * These tests don't replace the SQL migration's RLS — they verify the
 * port surface stays narrow + consistent.
 */

import { describe, expect, it } from 'vitest';

import { attachEvidence } from '../evidence.js';
import { captureLandArea } from '../land-area-capture.js';
import { setParcelMetadata } from '../metadata.js';
import { subdivideParcel } from '../subdivide.js';
import {
  InMemoryPort,
  TEST_CHILD_LL,
  TEST_LAND_AREA_POLYGON,
} from './in-memory-port.js';

describe('Tenant isolation', () => {
  async function setupTwoTenants(port: InMemoryPort) {
    await captureLandArea(port, {
      id: 'la-A',
      tenant_id: 'tenant-A',
      display_name: 'Plot A',
      boundary_polygon: TEST_LAND_AREA_POLYGON,
      jurisdiction: 'TZ',
      captured_via: 'gps_walk',
      captured_by_user_id: 'user-A',
    });
    await captureLandArea(port, {
      id: 'la-B',
      tenant_id: 'tenant-B',
      display_name: 'Plot B',
      boundary_polygon: TEST_LAND_AREA_POLYGON,
      jurisdiction: 'KE',
      captured_via: 'gps_walk',
      captured_by_user_id: 'user-B',
    });
    const [pA] = await subdivideParcel(port, {
      tenant_id: 'tenant-A',
      parent_kind: 'land_area',
      parent_id: 'la-A',
      parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
      land_area_id: 'la-A',
      children: [{ id: 'parcel-A', display_name: 'A1', boundary_polygon: TEST_CHILD_LL }],
      actor_user_id: 'user-A',
    });
    const [pB] = await subdivideParcel(port, {
      tenant_id: 'tenant-B',
      parent_kind: 'land_area',
      parent_id: 'la-B',
      parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
      land_area_id: 'la-B',
      children: [{ id: 'parcel-B', display_name: 'B1', boundary_polygon: TEST_CHILD_LL }],
      actor_user_id: 'user-B',
    });
    return { parcelA: pA!, parcelB: pB! };
  }

  it('listLandAreas returns ONLY the caller tenant\'s rows', async () => {
    const port = new InMemoryPort();
    await setupTwoTenants(port);
    const aList = await port.listLandAreas('tenant-A');
    expect(aList).toHaveLength(1);
    expect(aList[0]?.id).toBe('la-A');
    const bList = await port.listLandAreas('tenant-B');
    expect(bList).toHaveLength(1);
    expect(bList[0]?.id).toBe('la-B');
  });

  it('getLandArea cross-tenant returns null', async () => {
    const port = new InMemoryPort();
    await setupTwoTenants(port);
    const peek = await port.getLandArea('la-A', 'tenant-B');
    expect(peek).toBeNull();
  });

  it('parcels are isolated by tenant', async () => {
    const port = new InMemoryPort();
    const { parcelA, parcelB } = await setupTwoTenants(port);
    const aRead = await port.getParcel(parcelA.id, 'tenant-A');
    expect(aRead?.id).toBe(parcelA.id);
    const wrong = await port.getParcel(parcelA.id, 'tenant-B');
    expect(wrong).toBeNull();
    const bRead = await port.getParcel(parcelB.id, 'tenant-B');
    expect(bRead?.id).toBe(parcelB.id);
  });

  it('parcel metadata is isolated by tenant', async () => {
    const port = new InMemoryPort();
    const { parcelA, parcelB } = await setupTwoTenants(port);
    await setParcelMetadata(port, {
      id: 'mA',
      tenant_id: 'tenant-A',
      parcel_id: parcelA.id,
      key: 'soil_type',
      value_kind: 'text',
      value: 'loam',
    });
    await setParcelMetadata(port, {
      id: 'mB',
      tenant_id: 'tenant-B',
      parcel_id: parcelB.id,
      key: 'soil_type',
      value_kind: 'text',
      value: 'sandy',
    });
    const aList = await port.listParcelMetadata(parcelA.id, 'tenant-A');
    expect(aList).toHaveLength(1);
    expect((aList[0]!.value_jsonb as { value: string }).value).toBe('loam');
    // Cross-tenant read returns 0.
    const wrong = await port.listParcelMetadata(parcelA.id, 'tenant-B');
    expect(wrong).toHaveLength(0);
  });

  it('evidence is isolated by tenant', async () => {
    const port = new InMemoryPort();
    const { parcelA, parcelB } = await setupTwoTenants(port);
    await attachEvidence(port, {
      id: 'eA',
      tenant_id: 'tenant-A',
      parcel_id: parcelA.id,
      evidence_kind: 'title_deed',
      document_id: 'docA',
      public_visible: true,
    });
    await attachEvidence(port, {
      id: 'eB',
      tenant_id: 'tenant-B',
      parcel_id: parcelB.id,
      evidence_kind: 'photo',
      storage_path: 'b/photo',
    });
    const aList = await port.listEvidence(parcelA.id, 'tenant-A');
    expect(aList.map((r) => r.id)).toEqual(['eA']);
    const bList = await port.listEvidence(parcelB.id, 'tenant-B');
    expect(bList.map((r) => r.id)).toEqual(['eB']);
  });

  it('activity log is isolated by tenant', async () => {
    const port = new InMemoryPort();
    const { parcelA, parcelB } = await setupTwoTenants(port);
    // Subdivision already emitted 'created' for each parcel.
    const eventsA = await port.listActivityLog(parcelA.id, 'tenant-A');
    expect(eventsA).toHaveLength(1);
    expect(eventsA[0]?.tenant_id).toBe('tenant-A');
    const wrong = await port.listActivityLog(parcelA.id, 'tenant-B');
    expect(wrong).toHaveLength(0);
  });

  it('updateParcelStatus rejects cross-tenant mutation', async () => {
    const port = new InMemoryPort();
    const { parcelA } = await setupTwoTenants(port);
    await expect(
      port.updateParcelStatus(parcelA.id, 'tenant-B', 'sold'),
    ).rejects.toThrow(/not found/);
  });
});
