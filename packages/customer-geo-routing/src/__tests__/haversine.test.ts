import { describe, expect, it } from 'vitest';
import { haversineKm } from '../geo/haversine.js';

describe('haversineKm', () => {
  it('returns 0 for identical coordinates', () => {
    const p = { lat: -6.7924, lng: 39.2083 }; // Dar es Salaam
    expect(haversineKm(p, p)).toBe(0);
  });

  it('computes the great-circle distance Dar es Salaam ↔ Arusha', () => {
    const dsm = { lat: -6.7924, lng: 39.2083 };
    const arusha = { lat: -3.3869, lng: 36.683 };
    const d = haversineKm(dsm, arusha);
    // Reference great-circle distance is ~ 470 km (road distance is
    // ~ 630 km — different metric). We accept ±5%.
    expect(d).toBeGreaterThan(447);
    expect(d).toBeLessThan(494);
  });

  it('is symmetric (a→b == b→a)', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 10, lng: 10 };
    const d1 = haversineKm(a, b);
    const d2 = haversineKm(b, a);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it('never returns NaN for tiny offsets', () => {
    const a = { lat: -6.79240001, lng: 39.20830001 };
    const b = { lat: -6.7924, lng: 39.2083 };
    const d = haversineKm(a, b);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
  });
});
