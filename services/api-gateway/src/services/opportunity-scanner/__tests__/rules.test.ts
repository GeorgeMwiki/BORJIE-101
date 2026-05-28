/**
 * Tests — scan-rules.ts.
 *
 * Drives a representative slice of the rule catalog (10+ rules) against
 * synthetic `ScanState` snapshots. Each test asserts:
 *   - detect() returns the expected boolean
 *   - evaluate() emits a valid Opportunity (zod-validated)
 *   - kind + id match what the catalog declares
 *   - bilingual headline/narrative are present in both en + sw
 *   - expectedValueTzs is grounded in the synthetic inputs (no NaN /
 *     negative / non-finite values)
 */

import { describe, expect, it } from 'vitest';
import { SCAN_RULES, ALL_SCAN_RULES } from '../scan-rules';
import { OpportunitySchema, type ScanState } from '../types';

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

function findRule(id: string) {
  const rule = SCAN_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`scan rule not found: ${id}`);
  return rule;
}

describe('opportunity-scanner — scan-rules', () => {
  it('exposes 20+ distinct scan rules after dedupe', () => {
    expect(SCAN_RULES.length).toBeGreaterThanOrEqual(20);
    const ids = new Set(SCAN_RULES.map((r) => r.id));
    expect(ids.size).toBe(SCAN_RULES.length); // unique
  });

  it('covers every declared opportunity kind', () => {
    const kinds = new Set(SCAN_RULES.map((r) => r.kind));
    expect(kinds.has('cost_saving')).toBe(true);
    expect(kinds.has('revenue')).toBe(true);
    expect(kinds.has('tax_efficiency')).toBe(true);
    expect(kinds.has('regulatory_window')).toBe(true);
    expect(kinds.has('capital')).toBe(true);
    expect(kinds.has('market_timing')).toBe(true);
    expect(kinds.has('operational_arbitrage')).toBe(true);
    expect(kinds.has('hr')).toBe(true);
    expect(kinds.has('compliance_shortcut')).toBe(true);
    expect(kinds.has('estate_planning')).toBe(true);
    expect(kinds.has('counterparty')).toBe(true);
    expect(kinds.has('peer_best_practice')).toBe(true);
  });

  it('fuel.supplier_arbitrage detects + evaluates correctly', () => {
    const rule = findRule('fuel.supplier_arbitrage');
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 14,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(OpportunitySchema.parse(op).id).toBe('fuel.supplier_arbitrage');
    expect(op.kind).toBe('cost_saving');
    expect(op.headline.en).toContain('Switch fuel supplier');
    expect(op.headline.sw).toContain('Badilisha');
    expect(op.savingsTzs).toBeGreaterThan(0);
    expect(op.expectedValueTzs).toBeGreaterThan(0);
    expect(op.requiresActions[0]?.action).toBe('draft_supplier_rfp');
  });

  it('fuel.supplier_arbitrage refuses when delta is below threshold', () => {
    const rule = findRule('fuel.supplier_arbitrage');
    const state = emptyState({
      fuel: {
        litresPerTonneRolling30d: 12,
        peerP25LitresPerTonne: 11,
        currentDieselTzsPerLitre: 3200,
        tonnesProducedRolling30d: 1000,
        supplierCount: 2,
      },
    });
    expect(rule.detect(state)).toBe(false);
  });

  it('lbma.fix_premium_window detects when zscore > 1.5 and parcel ready', () => {
    const rule = findRule('lbma.fix_premium_window');
    const state = emptyState({
      fx: {
        lbmaFixUsdPerOz: 2400,
        lbmaFixMean30dUsdPerOz: 2300,
        lbmaFixStdev30d: 50, // (2400-2300)/50 = 2σ
        botGoldWindowOpen: false,
        parcelOzReady: 50,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('market_timing');
    expect(op.expectedValueTzs).toBeGreaterThan(0);
    expect(op.timeWindowDays).toBe(3);
  });

  it('lbma.fix_premium_window stays silent when stdev is unknown', () => {
    const rule = findRule('lbma.fix_premium_window');
    expect(
      rule.detect(
        emptyState({
          fx: {
            lbmaFixUsdPerOz: 2400,
            lbmaFixMean30dUsdPerOz: 2300,
            lbmaFixStdev30d: null,
            botGoldWindowOpen: false,
            parcelOzReady: 50,
          },
        }),
      ),
    ).toBe(false);
  });

  it('bot.gold_window_open detects on window+parcel', () => {
    const rule = findRule('bot.gold_window_open');
    const state = emptyState({
      fx: {
        lbmaFixUsdPerOz: 2400,
        lbmaFixMean30dUsdPerOz: 2400,
        lbmaFixStdev30d: 10,
        botGoldWindowOpen: true,
        parcelOzReady: 100,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.headline.en).toContain('BoT gold window');
    expect(op.expectedValueTzs).toBeGreaterThan(0);
  });

  it('tra.royalty_rate_election fires within 7 days', () => {
    const rule = findRule('tra.royalty_rate_election');
    const state = emptyState({
      tax: {
        traQuarterlyElectionDaysUntilDeadline: 5,
        currentRoyaltyRatePct: 6,
        altRoyaltyRatePct: 4,
        quarterlyRoyaltyTzs: 60_000_000,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('tax_efficiency');
    expect(op.savingsTzs).toBeGreaterThan(0);
  });

  it('nemc.amnesty_window detects when both flags true', () => {
    const rule = findRule('nemc.amnesty_window');
    const state = emptyState({
      regulator: {
        nemcAmnestyWindowOpen: true,
        nemcAmnestyDaysRemaining: 10,
        tenantQualifiesForAmnesty: true,
        estimatedPenaltyAvoidedTzs: 15_000_000,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('regulatory_window');
    expect(op.savingsTzs).toBe(15_000_000);
  });

  it('intercompany.surplus_routing detects on holding + surplus', () => {
    const rule = findRule('intercompany.surplus_routing');
    const state = emptyState({
      estate: {
        subsidiaryCount: 3,
        intercompanySurplusTzs: 200_000_000,
        holdingCoExists: true,
        overdueSuccessionReviewCount: 0,
        forestryEntityCount: 0,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('capital');
    expect(op.savingsTzs).toBeGreaterThan(0);
  });

  it('succession.review_overdue_advantage fires on overdue plans', () => {
    const rule = findRule('succession.review_overdue_advantage');
    const state = emptyState({
      estate: {
        subsidiaryCount: 1,
        intercompanySurplusTzs: 0,
        holdingCoExists: true,
        overdueSuccessionReviewCount: 2,
        forestryEntityCount: 0,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('estate_planning');
    expect(op.headline.en).toContain('2');
  });

  it('buyer.competitive_offer fires on premium + parcel', () => {
    const rule = findRule('buyer.competitive_offer');
    const state = emptyState({
      marketplace: {
        latestBuyerOfferPremiumOverLbmaPct: 1.2,
        latestBuyerOfferParcelOzEquivalent: 50,
        latestBuyerName: 'Heritage Refiners',
      },
      fx: {
        lbmaFixUsdPerOz: 2400,
        lbmaFixMean30dUsdPerOz: 2400,
        lbmaFixStdev30d: 5,
        botGoldWindowOpen: false,
        parcelOzReady: 50,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('revenue');
    expect(op.headline.en).toContain('Heritage Refiners');
  });

  it('vendor.consolidation_discount fires on 3+ suppliers + spend', () => {
    const rule = findRule('vendor.consolidation_discount');
    const state = emptyState({
      vendors: {
        categoriesWithMultipleSuppliers: [
          { category: 'tyres', supplierCount: 4, annualSpendTzs: 80_000_000 },
          { category: 'gloves', supplierCount: 2, annualSpendTzs: 5_000_000 },
        ],
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.headline.en).toContain('tyres');
    expect(op.savingsTzs).toBeGreaterThan(0);
  });

  it('training.apprenticeship_credit_available fires on eligible + subsidy', () => {
    const rule = findRule('training.apprenticeship_credit_available');
    const state = emptyState({
      workforce: {
        apprenticeshipEligibleCount: 8,
        vetaSubsidyPerApprenticeTzs: 1_500_000,
        icaCertExpiringIn60dCount: 0,
        icaCertPerCertFeeTzs: null,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('hr');
    expect(op.savingsTzs).toBe(12_000_000);
  });

  it('ica.cert_batch_savings fires on 5+ expiring certs', () => {
    const rule = findRule('ica.cert_batch_savings');
    const state = emptyState({
      workforce: {
        apprenticeshipEligibleCount: 0,
        vetaSubsidyPerApprenticeTzs: null,
        icaCertExpiringIn60dCount: 10,
        icaCertPerCertFeeTzs: 500_000,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('cost_saving');
    expect(op.savingsTzs).toBeGreaterThan(0);
  });

  it('insurance.broker_market_quote_better fires on premium delta', () => {
    const rule = findRule('insurance.broker_market_quote_better');
    const state = emptyState({
      insurance: {
        policyDueWithin60d: true,
        currentAnnualPremiumTzs: 50_000_000,
        bestMarketQuoteTzs: 35_000_000,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.savingsTzs).toBe(15_000_000);
  });

  it('peer.best_practice_unmatched fires when pattern absent + below p75', () => {
    const rule = findRule('peer.best_practice_unmatched');
    const state = emptyState({
      peer: {
        tenantProductionPercentile: 45,
        p75Pattern: 'staggered_shift_overlap',
        tenantUsesP75Pattern: false,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('peer_best_practice');
  });

  it('forestry.carbon_credit_eligible fires on forestry + carbon data', () => {
    const rule = findRule('forestry.carbon_credit_eligible');
    const state = emptyState({
      estate: {
        subsidiaryCount: 1,
        intercompanySurplusTzs: 0,
        holdingCoExists: false,
        overdueSuccessionReviewCount: 0,
        forestryEntityCount: 2,
      },
      carbon: {
        eligibleHectares: 5000,
        tzsPerHectarePerYear: 80_000,
      },
    });
    expect(rule.detect(state)).toBe(true);
    const op = rule.evaluate(state);
    expect(op.kind).toBe('revenue');
    expect(op.expectedValueTzs).toBe(400_000_000);
  });

  it('all rules emit valid Opportunity shapes for synthetic states', () => {
    // Hammer every rule with the richest synthetic state — anything
    // that detects must emit a zod-valid Opportunity.
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
      estate: {
        subsidiaryCount: 3,
        intercompanySurplusTzs: 200_000_000,
        holdingCoExists: true,
        overdueSuccessionReviewCount: 2,
        forestryEntityCount: 1,
      },
      marketplace: {
        latestBuyerOfferPremiumOverLbmaPct: 1.2,
        latestBuyerOfferParcelOzEquivalent: 50,
        latestBuyerName: 'X',
      },
      workforce: {
        apprenticeshipEligibleCount: 6,
        vetaSubsidyPerApprenticeTzs: 1_500_000,
        icaCertExpiringIn60dCount: 10,
        icaCertPerCertFeeTzs: 500_000,
      },
      insurance: {
        policyDueWithin60d: true,
        currentAnnualPremiumTzs: 50_000_000,
        bestMarketQuoteTzs: 35_000_000,
      },
      peer: {
        tenantProductionPercentile: 45,
        p75Pattern: 'staggered_blast_pattern',
        tenantUsesP75Pattern: false,
      },
      vendors: {
        categoriesWithMultipleSuppliers: [
          { category: 'tyres', supplierCount: 4, annualSpendTzs: 80_000_000 },
          { category: 'reagent', supplierCount: 3, annualSpendTzs: 50_000_000 },
        ],
      },
      capital: {
        currentLoanRatePct: 16,
        tibBetterRatePct: 12,
        loanBalanceTzs: 500_000_000,
        cashOnHandTzs: 400_000_000,
        idleCashOver90dTzs: 100_000_000,
        tibillsYieldPct: 8.5,
      },
      counterparties: {
        newBuyerPremiumOpportunity: {
          buyerId: 'b1',
          buyerName: 'NewBuyer',
          premiumOverFixPct: 0.9,
          parcelOzEquivalent: 30,
        },
      },
      carbon: {
        eligibleHectares: 5000,
        tzsPerHectarePerYear: 80_000,
      },
      energy: {
        currentGridTariffTzsPerKwh: 360,
        solarHybridTzsPerKwh: 200,
        monthlyKwhConsumption: 30_000,
      },
      ops: {
        nightShiftIdleCapacityPct: 70,
        nightShiftFuelDeltaTzsPerTonne: 0,
        bcmHaulDistanceMetresMean: 1500,
        bcmHaulDistanceP25Metres: 900,
        rejectedOreTonnesRolling30d: 120,
        downstreamProcessingTzsPerTonne: 55_000,
        stockpileAgeP90Days: 75,
      },
    });
    let detected = 0;
    for (const rule of ALL_SCAN_RULES) {
      if (rule.detect(state)) {
        detected += 1;
        const parsed = OpportunitySchema.safeParse(rule.evaluate(state));
        expect(parsed.success).toBe(true);
      }
    }
    expect(detected).toBeGreaterThanOrEqual(10);
  });
});
