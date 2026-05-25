import { describe, expect, it } from 'vitest';
import { createComplianceEngine } from '../compliance/index.js';
import type { GeoJsonPoint } from '../types.js';

const engine = createComplianceEngine();

describe('compliance — TZ', () => {
  it('Dar es Salaam CBD is commercial', () => {
    const overlay = engine.zoningOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [39.28, -6.81] },
      jurisdiction: 'TZ',
    });
    expect(overlay.zoningClass).toBe('commercial');
    expect(overlay.authority).toBe('NLUPC');
  });

  it('Jangwani is high flood risk', () => {
    const overlay = engine.floodRiskOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [39.28, -6.81] },
      jurisdiction: 'TZ',
    });
    expect(overlay.band).toBe('high');
  });

  it('prefixed id triggers disputed legal status', () => {
    const overlay = engine.legalTitleOverlay({
      parcelId: 't-dispute-1',
      jurisdiction: 'TZ',
    });
    expect(overlay.status).toBe('disputed');
  });
});

describe('compliance — KE', () => {
  it('Nairobi CBD is commercial', () => {
    const overlay = engine.zoningOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [36.82, -1.28] },
      jurisdiction: 'KE',
    });
    expect(overlay.zoningClass).toBe('commercial');
  });

  it('rural id is clean legal status', () => {
    expect(engine.legalTitleOverlay({ parcelId: 'k-rural-7', jurisdiction: 'KE' }).status).toBe('clean');
  });
});

describe('compliance — UG', () => {
  it('Kampala CBD is commercial', () => {
    const overlay = engine.zoningOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [32.58, 0.31] },
      jurisdiction: 'UG',
    });
    expect(overlay.zoningClass).toBe('commercial');
  });

  it('Lake Kyoga basin is high flood risk', () => {
    const overlay = engine.floodRiskOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [32.5, 1.5] },
      jurisdiction: 'UG',
    });
    expect(overlay.band).toBe('high');
  });
});

describe('compliance — RW', () => {
  it('Kigali CBD is commercial', () => {
    const overlay = engine.zoningOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [30.06, -1.95] },
      jurisdiction: 'RW',
    });
    expect(overlay.zoningClass).toBe('commercial');
  });

  it('pending id surfaces correctly', () => {
    expect(engine.legalTitleOverlay({ parcelId: 'r-pending-1', jurisdiction: 'RW' }).status).toBe('pending');
  });
});

describe('compliance — unsupported jurisdiction', () => {
  it('throws on unknown country code', () => {
    expect(() => engine.zoningOverlay({
      parcelId: 'p1',
      centroid: { type: 'Point', coordinates: [0, 0] } as GeoJsonPoint,
      jurisdiction: 'ZZ' as never,
    })).toThrow();
  });
});
