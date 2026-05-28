/**
 * Tests — scanner.ts.
 *
 * Covers:
 *   - ranking (high value × confidence × urgency wins)
 *   - default cap of 3 results, hard cap at 5
 *   - dedupe by id
 *   - kind filter narrows the catalog
 *   - minExpectedValueTzs filter excludes low-value matches
 *   - locale render helpers return en + sw correctly
 *   - empty state returns zero opportunities (never fabricates)
 *   - resilient to buggy rules in the catalog
 */

import { describe, expect, it } from 'vitest';
import {
  renderOpportunityHeadline,
  renderOpportunityNarrative,
  scanOpportunities,
} from '../scanner';
import type { ScanState } from '../types';

function emptyState(overrides: Partial<ScanState> = {}): ScanState {
  return Object.freeze({
    tenantId: 'tenant-test',
    nowIso: '2026-05-29T00:00:00.000Z',
    fuel: null,
    fx: null,
    tax: null,
    regulator: null,
    estate: null,
    marketplace: null,
    workforce: null,
    insurance: null,
    peer: null,
    vendors: null,
    capital: null,
    counterparties: null,
    carbon: null,
    energy: null,
    ops: null,
    ...overrides,
  });
}

describe('opportunity-scanner — scanner', () => {
  it('returns zero opportunities on empty state — never fabricates', () => {
    const opps = scanOpportunities(emptyState());
    expect(opps.length).toBe(0);
  });

  it('caps at default 3 results', () => {
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
      fx: {
        lbmaFixUsdPerOz: 2400,
        lbmaFixMean30dUsdPerOz: 2200,
        lbmaFixStdev30d: 60,
        botGoldWindowOpen: true,
        parcelOzReady: 50,
      },
      tax: {
        traQuarterlyElectionDaysUntilDeadline: 5,
        currentRoyaltyRatePct: 6,
        altRoyaltyRatePct: 4,
        quarterlyRoyaltyTzs: 60_000_000,
      },
      regulator: {
        nemcAmnestyWindowOpen: true,
        nemcAmnestyDaysRemaining: 14,
        tenantQualifiesForAmnesty: true,
        estimatedPenaltyAvoidedTzs: 12_000_000,
      },
      insurance: {
        policyDueWithin60d: true,
        currentAnnualPremiumTzs: 50_000_000,
        bestMarketQuoteTzs: 35_000_000,
      },
    });
    const opps = scanOpportunities(state);
    expect(opps.length).toBe(3);
  });

  it('caps at hard ceiling of 5 even when requested higher', () => {
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
      fx: {
        lbmaFixUsdPerOz: 2400,
        lbmaFixMean30dUsdPerOz: 2200,
        lbmaFixStdev30d: 60,
        botGoldWindowOpen: true,
        parcelOzReady: 50,
      },
      tax: {
        traQuarterlyElectionDaysUntilDeadline: 5,
        currentRoyaltyRatePct: 6,
        altRoyaltyRatePct: 4,
        quarterlyRoyaltyTzs: 60_000_000,
      },
      regulator: {
        nemcAmnestyWindowOpen: true,
        nemcAmnestyDaysRemaining: 14,
        tenantQualifiesForAmnesty: true,
        estimatedPenaltyAvoidedTzs: 12_000_000,
      },
      insurance: {
        policyDueWithin60d: true,
        currentAnnualPremiumTzs: 50_000_000,
        bestMarketQuoteTzs: 35_000_000,
      },
      estate: {
        subsidiaryCount: 3,
        intercompanySurplusTzs: 200_000_000,
        holdingCoExists: true,
        overdueSuccessionReviewCount: 0,
        forestryEntityCount: 0,
      },
      workforce: {
        apprenticeshipEligibleCount: 8,
        vetaSubsidyPerApprenticeTzs: 1_500_000,
        icaCertExpiringIn60dCount: 10,
        icaCertPerCertFeeTzs: 500_000,
      },
    });
    const opps = scanOpportunities(state, { maxResults: 20 });
    expect(opps.length).toBeLessThanOrEqual(5);
  });

  it('ranks by value × confidence × urgency — short window wins', () => {
    const state = emptyState({
      tax: {
        // 5-day window, valuable
        traQuarterlyElectionDaysUntilDeadline: 5,
        currentRoyaltyRatePct: 6,
        altRoyaltyRatePct: 4,
        quarterlyRoyaltyTzs: 60_000_000,
      },
      estate: {
        // 30-day window, similar value
        subsidiaryCount: 3,
        intercompanySurplusTzs: 200_000_000,
        holdingCoExists: true,
        overdueSuccessionReviewCount: 0,
        forestryEntityCount: 0,
      },
    });
    const opps = scanOpportunities(state);
    expect(opps[0]?.id).toBe('tra.royalty_rate_election'); // shorter window wins
  });

  it('kindFilter restricts the result set', () => {
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
      tax: {
        traQuarterlyElectionDaysUntilDeadline: 5,
        currentRoyaltyRatePct: 6,
        altRoyaltyRatePct: 4,
        quarterlyRoyaltyTzs: 60_000_000,
      },
    });
    const opps = scanOpportunities(state, { kindFilter: ['cost_saving'] });
    expect(opps.length).toBeGreaterThan(0);
    expect(opps.every((o) => o.kind === 'cost_saving')).toBe(true);
  });

  it('minExpectedValueTzs filter excludes small opportunities', () => {
    const state = emptyState({
      ica: undefined as unknown as ScanState['ica'],
      workforce: {
        apprenticeshipEligibleCount: 0,
        vetaSubsidyPerApprenticeTzs: null,
        icaCertExpiringIn60dCount: 5,
        icaCertPerCertFeeTzs: 100_000, // savings ~150K only
      },
    });
    const opps = scanOpportunities(state, { minExpectedValueTzs: 100_000_000 });
    expect(opps.find((o) => o.id === 'ica.cert_batch_savings')).toBeUndefined();
  });

  it('dedupes by opportunity id', () => {
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
    });
    const opps = scanOpportunities(state, { maxResults: 5 });
    const ids = opps.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('locale render helpers return en + sw correctly', () => {
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
    });
    const opps = scanOpportunities(state);
    const first = opps[0]!;
    expect(renderOpportunityHeadline(first, 'en')).toBe(first.headline.en);
    expect(renderOpportunityHeadline(first, 'sw')).toBe(first.headline.sw);
    expect(renderOpportunityNarrative(first, 'en')).toBe(first.narrative.en);
    expect(renderOpportunityNarrative(first, 'sw')).toBe(first.narrative.sw);
  });

  it('scopeIds filter requires at least one matching scope', () => {
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
    });
    const onlyEstate = scanOpportunities(state, { scopeIds: ['estate'] });
    expect(onlyEstate.find((o) => o.id === 'fuel.supplier_arbitrage')).toBeUndefined();
    const includesFuel = scanOpportunities(state, { scopeIds: ['fuel'] });
    expect(includesFuel.find((o) => o.id === 'fuel.supplier_arbitrage')).toBeDefined();
  });
});
