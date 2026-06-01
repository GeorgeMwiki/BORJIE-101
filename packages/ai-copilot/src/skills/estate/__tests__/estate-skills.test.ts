import { describe, it, expect } from 'vitest';
import { valueAsset, assetValuationTool } from '../asset-valuation.js';
import { scoreTenderBids, tenderBidScoringTool } from '../tender-bid-scoring.js';
import { forecastProductionCapacity, productionCapacityForecastTool } from '../production-capacity-forecast.js';
import { analyzeRoyaltyRoll, royaltyRollAnalysisTool } from '../royalty-roll-analysis.js';
import { buyerHealthCheck, buyerHealthCheckTool } from '../buyer-health-check.js';
import { forecastMaintenanceCost, maintenanceCostForecastTool } from '../maintenance-cost-forecast.js';
import { adviseRoyaltyRepricing, royaltyRepricingAdvisorTool } from '../royalty-repricing-advisor.js';
import { ESTATE_SKILL_TOOLS } from '../index.js';

describe('asset-valuation', () => {
  it('returns a point estimate with a range', () => {
    const r = valueAsset({
      assetId: 'a1',
      oreGradeGpt: 2.5,
      reserveTonnes: 70,
      ageYears: 5,
      condition: 'good',
      comparables: [
        { id: 'c1', pricePerTonne: 100_000, oreGradeGpt: 2.5, ageYears: 5, condition: 'good', distanceKm: 0.5, soldMonthsAgo: 2 },
        { id: 'c2', pricePerTonne: 110_000, oreGradeGpt: 2.4, ageYears: 4, condition: 'excellent', distanceKm: 1, soldMonthsAgo: 4 },
        { id: 'c3', pricePerTonne: 95_000, oreGradeGpt: 3.0, ageYears: 7, condition: 'fair', distanceKm: 2, soldMonthsAgo: 6 },
      ],
    });
    expect(r.estimateTotal).toBeGreaterThan(0);
    expect(r.rangeLow).toBeLessThan(r.estimateTotal);
    expect(r.rangeHigh).toBeGreaterThan(r.estimateTotal);
  });

  it('marks confidence low for few comparables', () => {
    const r = valueAsset({
      assetId: 'a1',
      oreGradeGpt: 2.5,
      reserveTonnes: 50,
      ageYears: 1,
      comparables: [
        { id: 'c1', pricePerTonne: 100_000, oreGradeGpt: 2.5, ageYears: 1, condition: 'good', distanceKm: 0.5, soldMonthsAgo: 1 },
      ],
    });
    expect(r.confidence).toBe('low');
  });

  it('tool returns ok on valid input', async () => {
    const r = await assetValuationTool.execute(
      {
        assetId: 'a1',
        oreGradeGpt: 2.5,
        reserveTonnes: 50,
        ageYears: 1,
        comparables: [
          { id: 'c1', pricePerTonne: 100_000, oreGradeGpt: 2.5, ageYears: 1, condition: 'good', distanceKm: 0.5, soldMonthsAgo: 1 },
        ],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('tender-bid-scoring', () => {
  it('ranks bids with the best composite first', () => {
    // Same price so non-price dimensions decide. b1 dominates.
    const r = scoreTenderBids({
      tenderId: 't1',
      bids: [
        { bidId: 'b1', vendorId: 'v1', vendorName: 'A', priceTotal: 1000, timelineDays: 30, pastPerformanceScore: 0.9, complianceDocsComplete: true, referenceCount: 3 },
        { bidId: 'b2', vendorId: 'v2', vendorName: 'B', priceTotal: 1000, timelineDays: 45, pastPerformanceScore: 0.3, complianceDocsComplete: false, referenceCount: 0 },
      ],
    });
    expect(r.winnerBidId).toBe('b1');
    expect(r.ranking[0].score).toBeGreaterThan(r.ranking[1].score);
  });

  it('flags low-price, unproven vendor', () => {
    const r = scoreTenderBids({
      tenderId: 't1',
      bids: [
        { bidId: 'b1', vendorId: 'v1', vendorName: 'A', priceTotal: 500, timelineDays: 20, pastPerformanceScore: 0.2, complianceDocsComplete: false, referenceCount: 0 },
        { bidId: 'b2', vendorId: 'v2', vendorName: 'B', priceTotal: 900, timelineDays: 30, pastPerformanceScore: 0.8, complianceDocsComplete: true, referenceCount: 5 },
      ],
    });
    const b1 = r.ranking.find((x) => x.bidId === 'b1')!;
    expect(b1.flagged).toContain('low_price_unproven_vendor');
  });

  it('tool returns ok', async () => {
    const r = await tenderBidScoringTool.execute(
      {
        tenderId: 't1',
        bids: [{ bidId: 'b1', vendorId: 'v1', vendorName: 'A', priceTotal: 1, timelineDays: 1, pastPerformanceScore: 0.5, complianceDocsComplete: true, referenceCount: 1 }],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('production-capacity-forecast', () => {
  it('produces 12 months of forecast', () => {
    const r = forecastProductionCapacity({
      siteId: 'a1',
      totalCapacityUnits: 20,
      currentlyCommitted: 18,
      offtakesExpiringPerMonth: [1, 2, 0, 0, 3, 1, 0, 2, 1, 0, 0, 1],
    });
    expect(r.months.length).toBe(12);
  });

  it('tool returns ok', async () => {
    const r = await productionCapacityForecastTool.execute(
      {
        siteId: 'a1',
        totalCapacityUnits: 10,
        currentlyCommitted: 9,
        offtakesExpiringPerMonth: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('royalty-roll-analysis', () => {
  it('flags chronic outstanding royalties', () => {
    const r = analyzeRoyaltyRoll({
      siteId: 'a1',
      rows: [
        { consignmentId: 'u1', consignmentLabel: '1A', monthlyRoyalty: 30_000, outstandingMonths: 4, outstandingAmount: 120_000, hasOfftake: true, lastPaymentDaysAgo: 120 },
      ],
    });
    expect(r.anomalies.some((a) => a.kind === 'chronic_outstanding')).toBe(true);
  });

  it('flags under-market royalty', () => {
    const r = analyzeRoyaltyRoll({
      siteId: 'a1',
      rows: [
        { consignmentId: 'u1', consignmentLabel: '1A', monthlyRoyalty: 20_000, marketRoyalty: 35_000, hasOfftake: true, lastPaymentDaysAgo: 3, outstandingAmount: 0, outstandingMonths: 0 },
      ],
    });
    expect(r.anomalies.some((a) => a.kind === 'under_market_royalty')).toBe(true);
  });

  it('tool returns ok', async () => {
    const r = await royaltyRollAnalysisTool.execute(
      {
        siteId: 'a1',
        rows: [{ consignmentId: 'u1', consignmentLabel: '1A', monthlyRoyalty: 25_000, hasOfftake: true, outstandingMonths: 0, outstandingAmount: 0, lastPaymentDaysAgo: 0 }],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('buyer-health-check', () => {
  it('returns green for healthy buyer', () => {
    const r = buyerHealthCheck({
      buyerId: 't1',
      consignmentId: 'u1',
      paymentOnTimeRatio: 1,
      paymentDaysLateAvg: 0,
      performanceScore: 1,
      kycComplete: true,
      referencesCount: 3,
      performanceBondPaid: true,
      guarantorPresent: true,
      insuranceOnFile: true,
    });
    expect(r.rating).toBe('green');
  });

  it('returns red for high-risk buyer', () => {
    const r = buyerHealthCheck({
      buyerId: 't1',
      consignmentId: 'u1',
      paymentOnTimeRatio: 0.2,
      paymentDaysLateAvg: 40,
      performanceScore: 0.3,
      disputesLast12m: 6,
      kycComplete: false,
      referencesCount: 0,
      performanceBondPaid: false,
      guarantorPresent: false,
      insuranceOnFile: false,
    });
    expect(r.rating).toBe('red');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('tool returns ok', async () => {
    const r = await buyerHealthCheckTool.execute(
      { buyerId: 't1', consignmentId: 'u1' },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('maintenance-cost-forecast', () => {
  it('produces 12 months of forecast', () => {
    const r = forecastMaintenanceCost({
      unitId: 'u1',
      averageMonthlyCostLast12m: 5000,
    });
    expect(r.monthly.length).toBe(12);
  });

  it('adds component replacement cost in the correct month', () => {
    const r = forecastMaintenanceCost({
      unitId: 'u1',
      averageMonthlyCostLast12m: 1000,
      components: [
        { name: 'water heater', lastServicedMonthsAgo: 54, expectedLifeMonths: 60, replacementCost: 80_000 },
      ],
    });
    expect(r.componentAlerts.length).toBe(1);
    expect(r.componentAlerts[0].expectedMonth).toBe(6);
  });

  it('tool returns ok', async () => {
    const r = await maintenanceCostForecastTool.execute(
      { unitId: 'u1', averageMonthlyCostLast12m: 1000 },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('royalty-repricing-advisor', () => {
  it('holds flat when available-capacity risk is high', () => {
    const r = adviseRoyaltyRepricing({
      siteId: 'a1',
      consignments: [
        { consignmentId: 'u1', currentPrice: 30_000, marketPrice: 40_000, buyerPaymentScore: 0.9, buyerTenureMonths: 24, availableCapacityRisk: 0.5 },
      ],
      maxIncreasePct: 0.1,
    });
    const rec = r.recommendations[0];
    expect(rec.increasePct).toBeLessThanOrEqual(0.05);
  });

  it('proposes an increase when market gap is wide', () => {
    const r = adviseRoyaltyRepricing({
      siteId: 'a1',
      consignments: [
        { consignmentId: 'u1', currentPrice: 30_000, marketPrice: 40_000, buyerPaymentScore: 1, buyerTenureMonths: 36, availableCapacityRisk: 0.05 },
      ],
    });
    expect(r.recommendations[0].recommendedPrice).toBeGreaterThan(30_000);
  });

  it('tool returns ok', async () => {
    const r = await royaltyRepricingAdvisorTool.execute(
      {
        siteId: 'a1',
        consignments: [{ consignmentId: 'u1', currentPrice: 1000, marketPrice: 1100, buyerPaymentScore: 0.5, buyerTenureMonths: 12, availableCapacityRisk: 0.1 }],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('estate skill bundle', () => {
  it('ships at least the seven legacy tools', () => {
    expect(ESTATE_SKILL_TOOLS.length).toBeGreaterThanOrEqual(7);
  });

  it('every tool has a unique name', () => {
    const names = ESTATE_SKILL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes skill.estate.grade_asset', () => {
    const names = ESTATE_SKILL_TOOLS.map((t) => t.name);
    expect(names).toContain('skill.estate.grade_asset');
  });
});
