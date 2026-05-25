import { describe, expect, it } from 'vitest';
import {
  createInMemoryLayerStore,
  customLayerSchema,
  environmentalLayerSchema,
  financialLayerSchema,
  infrastructureLayerSchema,
  layerSchemaByKind,
  legalLayerSchema,
  physicalLayerSchema,
  socialLayerSchema,
} from '../metadata/index.js';
import { z } from 'zod';

describe('metadata — layer schemas', () => {
  it('legal layer parses minimal valid input', () => {
    const parsed = legalLayerSchema.parse({});
    expect(parsed.tenure).toBe('unknown');
    expect(parsed.encumbrances).toEqual([]);
  });

  it('physical layer applies defaults', () => {
    const parsed = physicalLayerSchema.parse({});
    expect(parsed.terrain).toBe('unknown');
    expect(parsed.utilitiesPresent.power).toBe(false);
  });

  it('financial layer rejects negative valuation', () => {
    expect(() => financialLayerSchema.parse({
      valuation: { amount: -1, currency: 'KES', asOf: '2026-01-01T00:00:00.000Z' },
    })).toThrow();
  });

  it('environmental layer constrains flood-risk enum', () => {
    expect(() => environmentalLayerSchema.parse({ floodRisk: 'apocalyptic' })).toThrow();
  });

  it('social layer constrains crime index 0-100', () => {
    expect(() => socialLayerSchema.parse({ crimeIndex: 150 })).toThrow();
  });

  it('infrastructure layer applies water source enum', () => {
    const parsed = infrastructureLayerSchema.parse({
      water: { connected: true, source: 'borehole' },
    });
    expect(parsed.water.source).toBe('borehole');
  });

  it('customLayerSchema produces a working Zod schema', () => {
    const schema = customLayerSchema({ rooms: z.number(), color: z.string() });
    expect(schema.parse({ rooms: 3, color: 'red' })).toEqual({ rooms: 3, color: 'red' });
    expect(() => schema.parse({ rooms: 'three', color: 'red' })).toThrow();
  });

  it('layerSchemaByKind exposes all 6 standard schemas', () => {
    expect(Object.keys(layerSchemaByKind).sort()).toEqual([
      'environmental',
      'financial',
      'infrastructure',
      'legal',
      'physical',
      'social',
    ]);
  });
});

describe('metadata — layer store', () => {
  it('stores and retrieves a legal layer', () => {
    const store = createInMemoryLayerStore();
    const applied = store.applyLayer({
      parcelId: 'p1',
      tenantId: 't1',
      kind: 'legal',
      data: { tenure: 'freehold' },
    });
    expect(applied.kind).toBe('legal');
    const fetched = store.getLayer('p1', 'legal');
    expect(fetched).toBeDefined();
    expect((fetched?.data as { tenure: string }).tenure).toBe('freehold');
  });

  it('keeps versioned history (newest first)', () => {
    const store = createInMemoryLayerStore();
    store.applyLayer({ parcelId: 'p1', tenantId: 't1', kind: 'legal', data: { tenure: 'freehold' }, recordedAt: '2026-01-01T00:00:00Z' });
    store.applyLayer({ parcelId: 'p1', tenantId: 't1', kind: 'legal', data: { tenure: 'leasehold' }, recordedAt: '2026-02-01T00:00:00Z' });
    const history = store.getLayerHistory('p1', 'legal');
    expect(history.length).toBe(2);
    expect((history[0]?.data as { tenure: string }).tenure).toBe('leasehold');
  });

  it('mergeLayers returns a fully-populated record across all kinds', () => {
    const store = createInMemoryLayerStore();
    store.applyLayer({ parcelId: 'p1', tenantId: 't1', kind: 'legal', data: { tenure: 'freehold' } });
    store.applyLayer({ parcelId: 'p1', tenantId: 't1', kind: 'physical', data: { terrain: 'flat' } });
    const merged = store.mergeLayers('p1');
    expect(merged.legal).toBeDefined();
    expect(merged.physical).toBeDefined();
    expect(merged.financial).toBeNull();
    expect(merged.environmental).toBeNull();
    expect(merged.social).toBeNull();
    expect(merged.infrastructure).toBeNull();
  });

  it('rejects invalid layer data via schema validation', () => {
    const store = createInMemoryLayerStore();
    expect(() => store.applyLayer({
      parcelId: 'p1',
      tenantId: 't1',
      kind: 'environmental',
      data: { floodRisk: 'apocalyptic' },
    })).toThrow();
  });
});
