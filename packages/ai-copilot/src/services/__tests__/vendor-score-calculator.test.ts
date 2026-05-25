/**
 * vendor-score-calculator — determinism + monotonicity (SCAFFOLDED 9)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateVendorScore,
  rankVendors,
  scoreCost,
  scoreResponsiveness,
  scoreSkillOverlap,
  type VendorSignal,
  type WorkOrderSignal,
} from '../risk/vendor-score-calculator.js';

const baseWo: WorkOrderSignal = {
  requiredSkills: ['plumbing'],
  emergency: false,
  budgetMidpoint: 2000,
};

const baseVendor: VendorSignal = {
  id: 'v1',
  specialties: ['plumbing', 'electrical'],
  serviceAreas: ['Nairobi'],
  averageResponseTimeHours: 4,
  ratings: { overall: 4, quality: 4, communication: 4, value: 4 },
  onTimeCompletionPct: 90,
  hourlyRate: 2000,
  emergencyAvailable: false,
};

describe('subscore helpers', () => {
  it('scoreSkillOverlap returns 1 for full overlap', () => {
    expect(scoreSkillOverlap(['plumbing'], ['plumbing', 'hvac'])).toBe(1);
  });
  it('scoreSkillOverlap returns 0 for no overlap', () => {
    expect(scoreSkillOverlap(['plumbing'], ['hvac'])).toBe(0);
  });
  it('scoreResponsiveness saturates at 24h cap', () => {
    expect(scoreResponsiveness(24)).toBe(0);
    expect(scoreResponsiveness(0)).toBe(1);
  });
  it('scoreCost rewards staying at or below budget', () => {
    expect(scoreCost(1000, 2000)).toBe(1);
    expect(scoreCost(4000, 2000)).toBe(0);
    expect(scoreCost(null, 2000)).toBe(0.5);
  });
});

describe('calculateVendorScore', () => {
  it('is deterministic — same inputs produce same output', () => {
    const a = calculateVendorScore(baseWo, baseVendor);
    const b = calculateVendorScore(baseWo, baseVendor);
    expect(a).toEqual(b);
  });

  it('is monotonic in quality — higher rating → higher composite', () => {
    const low = calculateVendorScore(baseWo, { ...baseVendor, ratings: { ...baseVendor.ratings, quality: 2 } });
    const high = calculateVendorScore(baseWo, { ...baseVendor, ratings: { ...baseVendor.ratings, quality: 5 } });
    expect(high.composite).toBeGreaterThanOrEqual(low.composite);
  });

  it('is monotonic in onTime — higher pct → higher composite', () => {
    const low = calculateVendorScore(baseWo, { ...baseVendor, onTimeCompletionPct: 50 });
    const high = calculateVendorScore(baseWo, { ...baseVendor, onTimeCompletionPct: 100 });
    expect(high.composite).toBeGreaterThanOrEqual(low.composite);
  });

  it('is monotonic in responsiveness — lower hours → higher composite', () => {
    const slow = calculateVendorScore(baseWo, { ...baseVendor, averageResponseTimeHours: 20 });
    const fast = calculateVendorScore(baseWo, { ...baseVendor, averageResponseTimeHours: 1 });
    expect(fast.composite).toBeGreaterThanOrEqual(slow.composite);
  });

  it('flags emergency mismatch as a concern', () => {
    const r = calculateVendorScore(
      { ...baseWo, emergency: true },
      { ...baseVendor, emergencyAvailable: false }
    );
    expect(r.concerns.some((c) => /emergency/i.test(c))).toBe(true);
  });
});

describe('rankVendors', () => {
  it('orders by descending composite score', () => {
    const high: VendorSignal = { ...baseVendor, id: 'high', ratings: { overall: 5, quality: 5, communication: 5, value: 5 }, onTimeCompletionPct: 100, averageResponseTimeHours: 1 };
    const low: VendorSignal = { ...baseVendor, id: 'low', ratings: { overall: 2, quality: 2, communication: 2, value: 2 }, onTimeCompletionPct: 40, averageResponseTimeHours: 20 };
    const results = rankVendors(baseWo, [low, high]);
    expect(results[0]?.vendorId).toBe('high');
    expect(results[1]?.vendorId).toBe('low');
  });
});
