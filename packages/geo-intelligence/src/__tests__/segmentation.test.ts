import { describe, expect, it } from 'vitest';
import {
  buildClusters,
  buildHeatmap,
  createSegmentationView,
  normalizeToScale,
  sampleCategorical,
  sampleScale,
} from '../segmentation/index.js';
import type { Parcel } from '../types.js';

function makeParcel(overrides: Partial<Parcel>): Parcel {
  return {
    parcelId: 'p1',
    tenantId: 't1',
    orgId: 'o1',
    name: 'P1',
    geometry: { type: 'MultiPolygon', coordinates: [[[ [0,0],[1,0],[1,1],[0,1],[0,0] ]]] },
    centroid: { type: 'Point', coordinates: [0, 0] },
    areaSqm: 100,
    status: 'active',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Parcel;
}

describe('segmentation — color scales', () => {
  it('viridis is deterministic for the same t', () => {
    expect(sampleScale('viridis', 0.5)).toBe(sampleScale('viridis', 0.5));
  });

  it('plasma at t=0 differs from t=1', () => {
    expect(sampleScale('plasma', 0)).not.toBe(sampleScale('plasma', 1));
  });

  it('rdylgn at t=0 is reddish', () => {
    const c = sampleScale('rdylgn', 0);
    expect(c.startsWith('#a5')).toBe(true);
  });

  it('categorical-12 wraps modulo 12', () => {
    expect(sampleCategorical(0)).toBe(sampleCategorical(12));
  });

  it('clamps t to [0,1]', () => {
    expect(sampleScale('viridis', -1)).toBe(sampleScale('viridis', 0));
    expect(sampleScale('viridis', 5)).toBe(sampleScale('viridis', 1));
  });

  it('normalizeToScale clamps and handles zero range', () => {
    expect(normalizeToScale(5, 0, 10)).toBeCloseTo(0.5);
    expect(normalizeToScale(5, 5, 5)).toBe(0);
    expect(normalizeToScale(15, 0, 10)).toBe(1);
  });

  it('unknown scale id falls back to gray', () => {
    expect(sampleScale('unknown-scale' as never, 0.5)).toBe('#888888');
  });
});

describe('segmentation — view builder', () => {
  it('produces a deterministic numeric segmentation', () => {
    const parcels = [
      makeParcel({ parcelId: 'p1', areaSqm: 100 }),
      makeParcel({ parcelId: 'p2', areaSqm: 200 }),
      makeParcel({ parcelId: 'p3', areaSqm: 300 }),
    ];
    const view = createSegmentationView({
      parcels,
      dimension: 'revenue_band',
      colorScale: 'viridis',
      valueResolver: (p) => p.areaSqm,
    });
    expect(view.length).toBe(3);
    expect(view[0]?.parcelId).toBe('p1');
    expect(view.map((v) => v.color)).not.toContain(undefined);
  });

  it('produces a stable categorical segmentation', () => {
    const parcels = [
      makeParcel({ parcelId: 'p1' }),
      makeParcel({ parcelId: 'p2' }),
    ];
    const view = createSegmentationView({
      parcels,
      dimension: 'zoning',
      colorScale: 'categorical-12',
      valueResolver: (p) => (p.parcelId === 'p1' ? 'residential' : 'commercial'),
    });
    expect(view[0]?.color).not.toEqual(view[1]?.color);
  });

  it('returns empty for empty input', () => {
    expect(createSegmentationView({
      parcels: [],
      dimension: 'status',
      colorScale: 'viridis',
      valueResolver: () => 0,
    })).toEqual([]);
  });
});

describe('segmentation — heatmap', () => {
  it('produces opacity proportional to value', () => {
    const cells = buildHeatmap({
      parcels: [
        { parcelId: 'p1', value: 0 },
        { parcelId: 'p2', value: 50 },
        { parcelId: 'p3', value: 100 },
      ],
      colorScale: 'plasma',
    });
    expect(cells.length).toBe(3);
    expect(cells[0]!.opacity).toBeLessThan(cells[2]!.opacity);
  });

  it('uses custom opacity bounds', () => {
    const cells = buildHeatmap({
      parcels: [{ parcelId: 'p1', value: 100 }],
      colorScale: 'rdylgn',
      minOpacity: 0.1,
      maxOpacity: 0.5,
    });
    expect(cells[0]!.opacity).toBeLessThanOrEqual(0.5);
  });
});

describe('segmentation — clustering', () => {
  it('groups parcels by cell', () => {
    const parcels = [
      makeParcel({ parcelId: 'p1', centroid: { type: 'Point', coordinates: [0, 0] }, areaSqm: 100 }),
      makeParcel({ parcelId: 'p2', centroid: { type: 'Point', coordinates: [0.001, 0.001] }, areaSqm: 200 }),
      makeParcel({ parcelId: 'p3', centroid: { type: 'Point', coordinates: [10, 10] }, areaSqm: 300 }),
    ];
    const clusters = buildClusters({ parcels, cellDeg: 0.01 });
    expect(clusters.length).toBe(2);
    const localCluster = clusters.find((c) => c.parcelIds.includes('p1'));
    expect(localCluster?.count).toBe(2);
    expect(localCluster?.summary.totalAreaSqm).toBe(300);
  });
});
