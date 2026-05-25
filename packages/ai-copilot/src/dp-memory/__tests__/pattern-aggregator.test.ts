/**
 * pattern-aggregator.test.ts — contribution-contract + aggregation.
 */

import { describe, it, expect } from 'vitest';
import { ConsentManager, InMemoryConsentRepository } from '../consent-manager.js';
import {
  PatternAggregator,
  ContributionRejectedError,
} from '../pattern-aggregator.js';
import type { TenantContribution } from '../types.js';

function contribution(partial: Partial<TenantContribution> = {}): TenantContribution {
  return {
    tenantId: 't1',
    domain: 'lease',
    feature: 'time_on_market_days',
    value: 14,
    sampleSize: 10,
    filters: { jurisdiction: 'KE-NBO-Westlands', unitType: '2BR', bedrooms: 2 },
    contributedAt: '2026-04-20T00:00:00Z',
    ...partial,
  };
}

describe('dp-memory/pattern-aggregator', () => {
  it('rejects contributions from opted-out tenants', async () => {
    const consent = new ConsentManager({ repository: new InMemoryConsentRepository() });
    await consent.optOut('t1');
    const agg = new PatternAggregator({ consent });
    await expect(agg.contribute(contribution())).rejects.toBeInstanceOf(ContributionRejectedError);
  });

  it('accepts contributions from opted-in tenants and aggregates', async () => {
    const consent = new ConsentManager();
    const agg = new PatternAggregator({ consent });
    await agg.contribute(contribution({ tenantId: 't1', value: 12, sampleSize: 10 }));
    await agg.contribute(contribution({ tenantId: 't2', value: 16, sampleSize: 20 }));
    const result = agg.aggregate('lease', 'time_on_market_days', {
      jurisdiction: 'KE-NBO-Westlands',
      unitType: '2BR',
      bedrooms: 2,
    });
    expect(result).not.toBeNull();
    // Weighted mean: (12·10 + 16·20) / 30 = 440/30 ≈ 14.666...
    expect(result!.value).toBeCloseTo(440 / 30);
    expect(result!.sampleSize).toBe(30);
    expect(result!.contributingTenantCount).toBe(2);
  });

  it('rejects contributions with sampleSize below the minimum', async () => {
    const consent = new ConsentManager();
    const agg = new PatternAggregator({ consent });
    await expect(
      agg.contribute(contribution({ sampleSize: 1 })),
    ).rejects.toHaveProperty('reason', 'sample_too_small');
  });

  it('rejects non-rounded values (suspected raw row leak)', async () => {
    const consent = new ConsentManager();
    const agg = new PatternAggregator({ consent });
    await expect(
      agg.contribute(contribution({ value: 14.12345678 })),
    ).rejects.toHaveProperty('reason', 'value_not_rounded');
  });

  it('rejects filters that look like PII (UUID, email)', async () => {
    const consent = new ConsentManager();
    const agg = new PatternAggregator({ consent });
    await expect(
      agg.contribute(
        contribution({
          filters: { jurisdiction: '00000000-0000-4000-8000-000000000000' } as any,
        }),
      ),
    ).rejects.toHaveProperty('reason', 'malformed_filters');
    await expect(
      agg.contribute(contribution({ filters: { bucket: 'george@example.com' } as any })),
    ).rejects.toHaveProperty('reason', 'malformed_filters');
  });

  it('purgeTenant removes a tenant from every pool entry', async () => {
    const consent = new ConsentManager();
    const agg = new PatternAggregator({ consent });
    await agg.contribute(contribution({ tenantId: 't1' }));
    await agg.contribute(contribution({ tenantId: 't2' }));
    agg.purgeTenant('t1');
    const result = agg.aggregate('lease', 'time_on_market_days', {
      jurisdiction: 'KE-NBO-Westlands',
      unitType: '2BR',
      bedrooms: 2,
    });
    expect(result!.contributingTenantCount).toBe(1);
  });
});
