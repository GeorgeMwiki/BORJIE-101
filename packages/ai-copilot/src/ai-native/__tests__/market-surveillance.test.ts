import { describe, it, expect } from 'vitest';
import {
  createMarketSurveillance,
  percentile,
  driftFlagFor,
  type MarketSurveillanceRepository,
  type MarketRatePort,
  type UnitForSurveillance,
  type MarketRateSnapshot,
  type ComparableListing,
} from '../market-surveillance/index.js';
import type { ClassifyLLMPort } from '../shared.js';

function makeUnit(overrides: Partial<UnitForSurveillance> = {}): UnitForSurveillance {
  return {
    tenantId: 't1',
    unitId: 'u1',
    propertyId: 'p1',
    currencyCode: 'KES',
    ourRentMinor: 100_000,
    latitude: -1.2,
    longitude: 36.8,
    bedrooms: 2,
    bathrooms: 1,
    sqft: 900,
    amenities: ['parking'],
    ...overrides,
  };
}

function makeRepo(units: UnitForSurveillance[] = []): MarketSurveillanceRepository & {
  snapshots: MarketRateSnapshot[];
} {
  const snapshots: MarketRateSnapshot[] = [];
  return {
    snapshots,
    async listActiveUnits() {
      return units;
    },
    async insertSnapshot(s) {
      snapshots.push(s);
      return s;
    },
    async listRecentSnapshots(_t, _p) {
      return snapshots;
    },
  };
}

describe('market-surveillance', () => {
  describe('pure helpers', () => {
    it('percentile returns median for sorted list', () => {
      expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
      expect(percentile([], 0.5)).toBeNull();
    });

    it('driftFlagFor detects below/above/on_band', () => {
      expect(driftFlagFor(90, 100, 0.1, 0.2)).toBe('below_market'); // -10%
      expect(driftFlagFor(125, 100, 0.1, 0.2)).toBe('above_market'); // +25%
      expect(driftFlagFor(100, 100, 0.1, 0.2)).toBe('on_band');
      expect(driftFlagFor(100, 0, 0.1, 0.2)).toBeNull();
    });
  });

  it('scanUnit persists a snapshot with drift flag when LLM + port are live', async () => {
    const unit = makeUnit({ ourRentMinor: 70_000 });
    const comparables: ComparableListing[] = [
      { adapterId: 'test', url: null, title: 't', rawDescription: 'a', latitude: null, longitude: null },
      { adapterId: 'test', url: null, title: 't', rawDescription: 'b', latitude: null, longitude: null },
      { adapterId: 'test', url: null, title: 't', rawDescription: 'c', latitude: null, longitude: null },
    ];
    const port: MarketRatePort = {
      adapterId: 'test',
      async fetchComparables() {
        return comparables;
      },
    };
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({ monthlyRentMinor: 100_000, currencyCode: 'KES' }),
          modelVersion: 'claude',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const repo = makeRepo();
    const svc = createMarketSurveillance({ repo, port, llm });
    const snap = await svc.scanUnit(unit);
    expect(snap.driftFlag).toBe('below_market');
    expect(snap.marketMedianMinor).toBe(100_000);
    expect(snap.marketSampleSize).toBe(3);
    expect(snap.sourceAdapter).toBe('test');
    expect(repo.snapshots).toHaveLength(1);
  });

  it('scanUnit degrades gracefully when LLM is missing (sample_size=0, no median)', async () => {
    const port: MarketRatePort = {
      adapterId: 'noop',
      async fetchComparables() {
        return [
          {
            adapterId: 'noop',
            url: null,
            title: 't',
            rawDescription: 'x',
            latitude: null,
            longitude: null,
          },
        ];
      },
    };
    const repo = makeRepo();
    const svc = createMarketSurveillance({ repo, port });
    const snap = await svc.scanUnit(makeUnit());
    expect(snap.marketSampleSize).toBe(0);
    expect(snap.marketMedianMinor).toBeNull();
    expect(snap.driftFlag).toBeNull();
  });

  it('scanTenant runs across all units from repo', async () => {
    const units = [makeUnit({ unitId: 'a' }), makeUnit({ unitId: 'b' })];
    const port: MarketRatePort = {
      adapterId: 'test',
      async fetchComparables() {
        return [];
      },
    };
    const repo = makeRepo(units);
    const svc = createMarketSurveillance({ repo, port });
    const out = await svc.scanTenant('t1');
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.unitId).sort()).toEqual(['a', 'b']);
  });
});
