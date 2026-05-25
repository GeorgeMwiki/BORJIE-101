/**
 * Happy-path tests for the commodity-intelligence advisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createCommodityIntelligence,
  createLmeAdapter,
  createKitcoAdapter,
  type IntelInput,
} from '../index.js';

const SAMPLE_INPUT: IntelInput = {
  commodity: 'gold',
  baseCurrency: 'USD',
  histories: [
    {
      commodity: 'gold',
      ticks: [
        {
          commodity: 'gold',
          pricePerTonne: 60_000_000,
          currency: 'USD',
          source: 'lme-rest',
          asOfISO: '2026-02-01T00:00:00Z',
        },
        {
          commodity: 'gold',
          pricePerTonne: 63_000_000,
          currency: 'USD',
          source: 'lme-rest',
          asOfISO: '2026-04-01T00:00:00Z',
        },
        {
          commodity: 'gold',
          pricePerTonne: 65_000_000,
          currency: 'USD',
          source: 'lme-rest',
          asOfISO: '2026-04-30T00:00:00Z',
        },
      ],
    },
  ],
};

describe('commodity-intelligence.analyze', () => {
  it('computes trend windows and emits the latest price', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const intel = createCommodityIntelligence({ logger });
    const snapshot = await intel.analyze(SAMPLE_INPUT);
    expect(snapshot.latestPrice).toBe(65_000_000);
    expect(snapshot.windows.length).toBeGreaterThan(0);
    expect(snapshot.sources).toContain('lme-rest');
  });
});

describe('commodity-intelligence.recommend', () => {
  it('flags a price-lock recommendation when an upswing exceeds policy', async () => {
    const intel = createCommodityIntelligence();
    const snapshot = await intel.analyze(SAMPLE_INPUT);
    const recs = await intel.recommend({
      snapshot,
      policy: { lockOnUpswingPercent: 1, delaySaleOnDownswingPercent: -50 },
    });
    expect(recs.some((r) => r.kind === 'lock-offtake-price')).toBe(true);
  });
});

describe('source adapters (stub mode)', () => {
  it('LME adapter returns a tick without crashing in stub mode', async () => {
    const adapter = createLmeAdapter();
    const tick = await adapter.fetchLatest('copper');
    expect(tick.commodity).toBe('copper');
    expect(tick.source).toBe('lme-rest');
  });

  it('Kitco adapter returns a tick for gold', async () => {
    const adapter = createKitcoAdapter({ fetchImpl: (async () => ({ ok: false })) as unknown as typeof fetch });
    const tick = await adapter.fetchLatest('gold');
    expect(tick.commodity).toBe('gold');
  });
});
