import { describe, it, expect } from 'vitest';
import { retentionCurve } from '../../forecasters/causal/retention-curve.js';
import { pricingElasticity } from '../../forecasters/causal/pricing-elasticity.js';

describe('retentionCurve', () => {
  it('is monotonic decreasing in rentChangePct', () => {
    const base = { tenantTenureDays: 365, marketVacancyRate: 0.05 };
    const probs = [-0.1, -0.05, 0, 0.05, 0.1, 0.2].map(
      (x) => retentionCurve.apply({ ...base, rentChangePct: x }).probabilityRetained,
    );
    for (let i = 1; i < probs.length; i += 1) {
      const p = probs[i];
      const q = probs[i - 1];
      if (p !== undefined && q !== undefined) {
        expect(p).toBeLessThanOrEqual(q + 1e-9);
      }
    }
  });

  it('longer tenure → higher retention at same rent change', () => {
    const a = retentionCurve.apply({
      rentChangePct: 0.1,
      tenantTenureDays: 90,
      marketVacancyRate: 0.05,
    });
    const b = retentionCurve.apply({
      rentChangePct: 0.1,
      tenantTenureDays: 365 * 5,
      marketVacancyRate: 0.05,
    });
    expect(b.probabilityRetained).toBeGreaterThan(a.probabilityRetained);
  });

  it('produces a probability in [0, 1]', () => {
    for (const x of [-0.3, 0, 0.5]) {
      const out = retentionCurve.apply({
        rentChangePct: x,
        tenantTenureDays: 365,
        marketVacancyRate: 0.05,
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

  it('expectedDaysToLease grows when probability shrinks', () => {
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
    expect(low.expectedDaysToLease).toBeGreaterThan(high.expectedDaysToLease);
  });
});
