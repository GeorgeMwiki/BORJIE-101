import { describe, expect, it } from 'vitest';
import { createGeoIntelligence } from '../orchestrator.js';
import { rectanglePolygon, mergeIntoMultiPolygon } from '../geometry/index.js';
import type { Parcel } from '../types.js';

function makeParcel(id: string): Parcel {
  const center = { type: 'Point' as const, coordinates: [36.82, -1.28] as readonly [number, number] };
  const rect = rectanglePolygon(center, 100, 100);
  return {
    parcelId: id,
    tenantId: 't1',
    orgId: 'o1',
    name: id,
    geometry: mergeIntoMultiPolygon([rect]),
    centroid: center,
    areaSqm: 10_000,
    status: 'active',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('orchestrator', () => {
  it('returns a fully-composed object with default deps', () => {
    const gi = createGeoIntelligence();
    expect(gi.layerStore).toBeDefined();
    expect(gi.eventStore).toBeDefined();
    expect(gi.captureStore).toBeDefined();
    expect(gi.capturePipeline.submitFieldCapture).toBeDefined();
    expect(gi.spatialIndex).toBeDefined();
    expect(gi.graph).toBeDefined();
    expect(gi.imagery.satellite.length).toBeGreaterThan(0);
    expect(gi.imagery.streetView.length).toBeGreaterThan(0);
    expect(gi.imagery.drone.length).toBeGreaterThan(0);
    expect(gi.compliance).toBeDefined();
  });

  it('explore() returns parcel + layers + history + associations', async () => {
    const parcels = [makeParcel('p1')];
    const gi = createGeoIntelligence({ initialParcels: parcels });
    gi.layerStore.applyLayer({ parcelId: 'p1', tenantId: 't1', kind: 'legal', data: { tenure: 'freehold' } });
    gi.eventStore.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'acquired' });

    const view = await gi.explore('p1');
    expect(view.parcel?.parcelId).toBe('p1');
    expect((view.layers as { legal?: unknown }).legal).toBeDefined();
    expect(view.history.length).toBe(1);
    expect(view.associations.nodes.length).toBeGreaterThanOrEqual(0);
  });

  it('explore for unknown parcel returns null parcel', async () => {
    const gi = createGeoIntelligence();
    const view = await gi.explore('missing');
    expect(view.parcel).toBeNull();
  });
});
