import { describe, it, expect } from 'vitest';
import { valueProperty, propertyValuationTool } from '../property-valuation.js';
import { scoreTenderBids, tenderBidScoringTool } from '../tender-bid-scoring.js';
import { forecastOccupancy, occupancyForecastTool } from '../occupancy-forecast.js';
import { analyzeRentRoll, rentRollAnalysisTool } from '../rent-roll-analysis.js';
import { tenantHealthCheck, tenantHealthCheckTool } from '../tenant-health-check.js';
import { forecastMaintenanceCost, maintenanceCostForecastTool } from '../maintenance-cost-forecast.js';
import { adviseRentRepricing, rentRepricingAdvisorTool } from '../rent-repricing-advisor.js';
import { ESTATE_SKILL_TOOLS } from '../index.js';

describe('property-valuation', () => {
  it('returns a point estimate with a range', () => {
    const r = valueProperty({
      propertyId: 'p1',
      bedrooms: 2,
      sqm: 70,
      ageYears: 5,
      condition: 'good',
      comparables: [
        { id: 'c1', pricePerSqm: 100_000, bedrooms: 2, ageYears: 5, condition: 'good', distanceKm: 0.5, soldMonthsAgo: 2 },
        { id: 'c2', pricePerSqm: 110_000, bedrooms: 2, ageYears: 4, condition: 'excellent', distanceKm: 1, soldMonthsAgo: 4 },
        { id: 'c3', pricePerSqm: 95_000, bedrooms: 3, ageYears: 7, condition: 'fair', distanceKm: 2, soldMonthsAgo: 6 },
      ],
    });
    expect(r.estimateTotal).toBeGreaterThan(0);
    expect(r.rangeLow).toBeLessThan(r.estimateTotal);
    expect(r.rangeHigh).toBeGreaterThan(r.estimateTotal);
  });

  it('marks confidence low for few comparables', () => {
    const r = valueProperty({
      propertyId: 'p1',
      bedrooms: 2,
      sqm: 50,
      ageYears: 1,
      comparables: [
        { id: 'c1', pricePerSqm: 100_000, bedrooms: 2, ageYears: 1, condition: 'good', distanceKm: 0.5, soldMonthsAgo: 1 },
      ],
    });
    expect(r.confidence).toBe('low');
  });

  it('tool returns ok on valid input', async () => {
    const r = await propertyValuationTool.execute(
      {
        propertyId: 'p1',
        bedrooms: 2,
        sqm: 50,
        ageYears: 1,
        comparables: [
          { id: 'c1', pricePerSqm: 100_000, bedrooms: 2, ageYears: 1, condition: 'good', distanceKm: 0.5, soldMonthsAgo: 1 },
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

describe('occupancy-forecast', () => {
  it('produces 12 months of forecast', () => {
    const r = forecastOccupancy({
      propertyId: 'p1',
      totalUnits: 20,
      currentlyOccupied: 18,
      leasesExpiringPerMonth: [1, 2, 0, 0, 3, 1, 0, 2, 1, 0, 0, 1],
    });
    expect(r.months.length).toBe(12);
  });

  it('tool returns ok', async () => {
    const r = await occupancyForecastTool.execute(
      {
        propertyId: 'p1',
        totalUnits: 10,
        currentlyOccupied: 9,
        leasesExpiringPerMonth: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('rent-roll-analysis', () => {
  it('flags chronic arrears', () => {
    const r = analyzeRentRoll({
      propertyId: 'p1',
      rows: [
        { unitId: 'u1', unitLabel: '1A', monthlyRent: 30_000, arrearsMonths: 4, arrearsAmount: 120_000, hasLease: true, lastPaymentDaysAgo: 120 },
      ],
    });
    expect(r.anomalies.some((a) => a.kind === 'chronic_arrears')).toBe(true);
  });

  it('flags under-market rent', () => {
    const r = analyzeRentRoll({
      propertyId: 'p1',
      rows: [
        { unitId: 'u1', unitLabel: '1A', monthlyRent: 20_000, marketRent: 35_000, hasLease: true, lastPaymentDaysAgo: 3, arrearsAmount: 0, arrearsMonths: 0 },
      ],
    });
    expect(r.anomalies.some((a) => a.kind === 'under_market_rent')).toBe(true);
  });

  it('tool returns ok', async () => {
    const r = await rentRollAnalysisTool.execute(
      {
        propertyId: 'p1',
        rows: [{ unitId: 'u1', unitLabel: '1A', monthlyRent: 25_000, hasLease: true, arrearsMonths: 0, arrearsAmount: 0, lastPaymentDaysAgo: 0 }],
      },
      {} as never
    );
    expect(r.ok).toBe(true);
  });
});

describe('tenant-health-check', () => {
  it('returns green for healthy tenant', () => {
    const r = tenantHealthCheck({
      tenantId: 't1',
      unitId: 'u1',
      paymentOnTimeRatio: 1,
      paymentDaysLateAvg: 0,
      propertyConditionScore: 1,
      kycComplete: true,
      referencesCount: 3,
      depositPaid: true,
      guarantorPresent: true,
      insuranceOnFile: true,
    });
    expect(r.rating).toBe('green');
  });

  it('returns red for high-risk tenant', () => {
    const r = tenantHealthCheck({
      tenantId: 't1',
      unitId: 'u1',
      paymentOnTimeRatio: 0.2,
      paymentDaysLateAvg: 40,
      propertyConditionScore: 0.3,
      complaintsLast12m: 6,
      kycComplete: false,
      referencesCount: 0,
      depositPaid: false,
      guarantorPresent: false,
      insuranceOnFile: false,
    });
    expect(r.rating).toBe('red');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('tool returns ok', async () => {
    const r = await tenantHealthCheckTool.execute(
      { tenantId: 't1', unitId: 'u1' },
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

describe('rent-repricing-advisor', () => {
  it('holds flat when vacancy risk is high', () => {
    const r = adviseRentRepricing({
      propertyId: 'p1',
      units: [
        { unitId: 'u1', currentRent: 30_000, marketRent: 40_000, tenantPaymentScore: 0.9, tenantTenureMonths: 24, vacancyRisk: 0.5 },
      ],
      maxIncreasePct: 0.1,
    });
    const rec = r.recommendations[0];
    expect(rec.increasePct).toBeLessThanOrEqual(0.05);
  });

  it('proposes an increase when market gap is wide', () => {
    const r = adviseRentRepricing({
      propertyId: 'p1',
      units: [
        { unitId: 'u1', currentRent: 30_000, marketRent: 40_000, tenantPaymentScore: 1, tenantTenureMonths: 36, vacancyRisk: 0.05 },
      ],
    });
    expect(r.recommendations[0].recommendedRent).toBeGreaterThan(30_000);
  });

  it('tool returns ok', async () => {
    const r = await rentRepricingAdvisorTool.execute(
      {
        propertyId: 'p1',
        units: [{ unitId: 'u1', currentRent: 1000, marketRent: 1100, tenantPaymentScore: 0.5, tenantTenureMonths: 12, vacancyRisk: 0.1 }],
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

  it('includes skill.estate.grade_property', () => {
    const names = ESTATE_SKILL_TOOLS.map((t) => t.name);
    expect(names).toContain('skill.estate.grade_property');
  });
});
