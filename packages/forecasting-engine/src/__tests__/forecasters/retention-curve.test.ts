import { describe, it, expect } from 'vitest';
import { retentionCurve } from '../../forecasters/causal/retention-curve.js';
import { pricingElasticity } from '../../forecasters/causal/pricing-elasticity.js';

describe('retentionCurve', () => {
  it('is monotonic decreasing in royaltyChangePct', () => {
    const base = { counterpartyTenureDays: 365, marketAvailableCapacityRate: 0.05 };
    const probs = [-0.1, -0.05, 0, 0.05, 0.1, 0.2].map(
      (x) => retentionCurve.apply({ ...base, royaltyChangePct: x }).probabilityRetained,
    );
    for (let i = 1; i < probs.length; i += 1) {
      const p = probs[i];
      const q = probs[i - 1];
      if (p !== undefined && q !== undefined) {
        expect(p).toBeLessThanOrEqual(q + 1e-9);
      }
    }
  });

  it('longer tenure → higher retention at same royalty change', () => {
    const a = retentionCurve.apply({
      royaltyChangePct: 0.1,
      counterpartyTenureDays: 90,
      marketAvailableCapacityRate: 0.05,
    });
    const b = retentionCurve.apply({
      royaltyChangePct: 0.1,
      counterpartyTenureDays: 365 * 5,
      marketAvailableCapacityRate: 0.05,
    });
    expect(b.probabilityRetained).toBeGreaterThan(a.probabilityRetained);
  });

  it('produces a probability in [0, 1]', () => {
    for (const x of [-0.3, 0, 0.5]) {
      const out = retentionCurve.apply({
        royaltyChangePct: x,
        counterpartyTenureDays: 365,
        marketAvailableCapacityRate: 0.05,
      });
      expect(out.probabilityRetained).toBeGreaterThanOrEqual(0);
      expect(out.probabilityRetained).toBeLessThanOrEqual(1);
    }
  });
});

describe('pricingElasticity', () => {
  it('is monotonic decreasing in askPriceDelta', () => {
    const probs = [-0.05, 0, 0.05, 0.1, 0.2].map(
      (x) =>
        pricingElasticity.apply({
          askPriceDelta: x,
          microMarketDemandIndex: 1,
          seasonFactor: 1,
        }).probabilitySigned,
    );
    for (let i = 1; i < probs.length; i += 1) {
      const p = probs[i];
      const q = probs[i - 1];
      if (p !== undefined && q !== undefined) {
        expect(p).toBeLessThanOrEqual(q + 1e-9);
      }
    }
  });

  it('expectedDaysToContract grows when probability shrinks', () => {
    const low = pricingElasticity.apply({
      askPriceDelta: 0.2,
      microMarketDemandIndex: 1,
      seasonFactor: 1,
    });
    const high = pricingElasticity.apply({
      askPriceDelta: 0,
      microMarketDemandIndex: 1,
      seasonFactor: 1,
    });
    expect(low.expectedDaysToContract).toBeGreaterThan(high.expectedDaysToContract);
  });
});
