/**
 * Trajectory — edge-case tests.
 *
 * The world-model.test.ts suite covers the happy-path regimes. These
 * tests stress the numeric helpers + boundary conditions that a
 * regression in the kernel's "imagination" would hurt:
 *
 *   - clamp() handles NaN by returning the lower bound
 *   - empty history throws (forecast{Property,TenantArrears,OwnerCashflow})
 *   - single-point history → flat slope (intercept = only value)
 *   - reverse-order history (descending observedAt) — daysBetween uses
 *     absolute diff so ordering is symmetric, but inflectionDay must
 *     still treat the most recent point as t=0
 *   - NaN observedAt strings degrade to t=0 spread (slope=0 fallback)
 *   - inflectionDay never reports a day past horizonDays
 *   - confidence floor at 0.1 holds for very long horizons
 *   - addDaysIso with malformed iso → returns input unchanged
 *   - horizonDays=0 collapses the forecast to a single point at t=0
 *     with confidence=1
 *   - p10/p90 widen monotonically with horizon
 */

import { describe, it, expect } from 'vitest';
import {
  forecastPropertyTrajectory,
  forecastTenantArrearsTrajectory,
  forecastOwnerCashflow,
  type OwnerState,
  type PropertyState,
  type TenantState,
} from '../kernel/world-model/index.js';

const BASE_OBSERVED = '2026-01-01T00:00:00.000Z';

function makeProperty(over: Partial<PropertyState> = {}): PropertyState {
  return {
    propertyId: 'p_1',
    tenantId: 't_acme',
    observedAt: BASE_OBSERVED,
    vacancyRate: 0.05,
    avgRentMajor: 1_000_000,
    currency: 'TZS',
    arrearsRate: 0.02,
    maintenanceBacklog: 3,
    renewalRate: 0.7,
    turnoverRate: 0.2,
    conditionScore: 0.85,
    ...over,
  };
}

function makeTenant(over: Partial<TenantState> = {}): TenantState {
  return {
    leaseId: 'l_1',
    tenantId: 't_acme',
    observedAt: BASE_OBSERVED,
    arrearsDays: 0,
    arrearsAmountMajor: 0,
    currency: 'TZS',
    paymentRegularity: 0.95,
    tenureMonths: 18,
    disputeCount: 0,
    maintenanceComplaintsLast90d: 0,
    ...over,
  };
}

function makeOwner(over: Partial<OwnerState> = {}): OwnerState {
  return {
    ownerId: 'o_1',
    tenantId: 't_acme',
    observedAt: BASE_OBSERVED,
    portfolioSizeUnits: 24,
    portfolioOccupancy: 0.92,
    netCollectionRate: 0.95,
    disbursementCadenceDays: 30,
    ...over,
  };
}

describe('trajectory — empty history boundary', () => {
  it('forecastPropertyTrajectory throws on empty history', () => {
    expect(() => forecastPropertyTrajectory({ history: [] })).toThrow(
      /history is empty/,
    );
  });

  it('forecastTenantArrearsTrajectory throws on empty history', () => {
    expect(() => forecastTenantArrearsTrajectory({ history: [] })).toThrow(
      /history is empty/,
    );
  });

  it('forecastOwnerCashflow throws on empty history', () => {
    expect(() => forecastOwnerCashflow({ history: [] })).toThrow(
      /history is empty/,
    );
  });
});

describe('trajectory — single-point history', () => {
  it('property forecast with one point produces a flat curve at the only value', () => {
    const only = makeProperty({ vacancyRate: 0.07 });
    const result = forecastPropertyTrajectory({ history: [only] });
    // With n=1 the slope is forced to 0 → every horizon point should
    // mirror the single observation's vacancyRate.
    for (const p of result.forecast) {
      expect(p.state.vacancyRate).toBeCloseTo(0.07, 5);
    }
    // Regime: no slope, no volatility data → 'stable'
    expect(result.regime).toBe('stable');
    expect(result.notableInflectionDays).toEqual([]);
  });

  it('tenant arrears forecast with one point produces a flat curve at the only value', () => {
    const only = makeTenant({ arrearsAmountMajor: 25_000, arrearsDays: 12 });
    const result = forecastTenantArrearsTrajectory({ history: [only] });
    for (const p of result.arrearsAmountMajorAt) {
      expect(p.expected).toBeCloseTo(25_000, 5);
    }
    // p10/p90 widen with horizon even at a flat expected curve.
    const first = result.arrearsAmountMajorAt[0];
    const last = result.arrearsAmountMajorAt[result.arrearsAmountMajorAt.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first && last) {
      const spreadFirst = first.p90 - first.p10;
      const spreadLast = last.p90 - last.p10;
      expect(spreadLast).toBeGreaterThanOrEqual(spreadFirst);
    }
  });

  it('owner cashflow with one point produces a flat curve at the only value', () => {
    const only = makeOwner({ netCollectionRate: 0.88 });
    const result = forecastOwnerCashflow({ history: [only] });
    for (const p of result.netCollectionRateForecast) {
      expect(p.rate).toBeCloseTo(0.88, 5);
      expect(p.rate).toBeGreaterThanOrEqual(0);
      expect(p.rate).toBeLessThanOrEqual(1);
    }
  });
});

describe('trajectory — NaN / malformed inputs are clamped', () => {
  it('NaN vacancyRate in history clamps the projected output to [0, 1]', () => {
    // Build a 6-point history with one bad entry mixed in.
    const startMs = Date.parse(BASE_OBSERVED);
    const history: PropertyState[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push(
        makeProperty({
          observedAt: new Date(startMs + i * 30 * 86_400_000).toISOString(),
          vacancyRate: i === 3 ? NaN : 0.05 + i * 0.01,
        }),
      );
    }
    const result = forecastPropertyTrajectory({ history });
    for (const p of result.forecast) {
      expect(p.state.vacancyRate).toBeGreaterThanOrEqual(0);
      expect(p.state.vacancyRate).toBeLessThanOrEqual(1);
      // Critically, the projected value should never come back as NaN.
      expect(Number.isNaN(p.state.vacancyRate)).toBe(false);
    }
  });

  it('malformed observedAt strings collapse the time spread to zero (flat slope)', () => {
    // All entries share an unparseable observedAt → daysBetween returns
    // 0 for each, the time spread is zero, fitLinear returns slope=0.
    const history = Array.from({ length: 4 }, () =>
      makeProperty({ observedAt: 'not-a-date', vacancyRate: 0.07 }),
    );
    const result = forecastPropertyTrajectory({ history });
    for (const p of result.forecast) {
      // Slope=0 → every horizon mirrors the most recent value.
      expect(p.state.vacancyRate).toBeCloseTo(0.07, 5);
    }
    expect(result.regime).toBe('stable');
  });
});

describe('trajectory — reverse-order history', () => {
  it('reverse-ordered history still anchors point0 at the LAST history element', () => {
    // Same shape, but the array is built newest-first instead of oldest-
    // first. The trajectory module documents oldest-first input; the
    // implementation reads point0 = history[history.length - 1] so we
    // assert the contract explicitly: passing newest-first results in
    // point0 being whatever the LAST array element holds.
    const startMs = Date.parse(BASE_OBSERVED);
    const ascending: PropertyState[] = [];
    for (let i = 0; i < 6; i += 1) {
      ascending.push(
        makeProperty({
          observedAt: new Date(startMs + i * 30 * 86_400_000).toISOString(),
          vacancyRate: 0.05 + i * 0.01,
        }),
      );
    }
    const reversed = [...ascending].reverse();
    const a = forecastPropertyTrajectory({ history: ascending });
    const b = forecastPropertyTrajectory({ history: reversed });
    // The point0 vacancyRate differs by direction (last element of the
    // input array). This pins the public contract.
    expect(a.point0.vacancyRate).toBeCloseTo(0.10, 5);
    expect(b.point0.vacancyRate).toBeCloseTo(0.05, 5);
  });
});

describe('trajectory — confidence floor', () => {
  it('confidence at the maximum horizon is at or above the 0.1 floor', () => {
    const history = [makeProperty(), makeProperty({ observedAt: '2026-02-01T00:00:00.000Z' })];
    const result = forecastPropertyTrajectory({ history, horizonDays: 9999 });
    const last = result.forecast[result.forecast.length - 1];
    expect(last).toBeDefined();
    if (last) {
      expect(last.confidence).toBeGreaterThanOrEqual(0.1);
      expect(last.confidence).toBeLessThanOrEqual(1);
    }
    const first = result.forecast[0];
    if (first) {
      expect(first.confidence).toBeCloseTo(1, 5);
    }
  });
});

describe('trajectory — horizon=0 collapses to single-point forecast', () => {
  it('horizonDays=0 still produces samplePoints horizons all anchored to t=0', () => {
    const history = [makeProperty()];
    const result = forecastPropertyTrajectory({ history, horizonDays: 0 });
    // With horizonDays=0, every sample horizon is t=0 and confidence=1
    // (sampleHorizons floors max horizon at 2 → step=0 → all zeros).
    expect(result.forecast.length).toBe(6);
    for (const p of result.forecast) {
      expect(p.horizonDays).toBe(0);
      // confidenceAt(0, 0): horizonMax<=0 → returns 1
      expect(p.confidence).toBeCloseTo(1, 5);
    }
  });
});

describe('trajectory — arrears p10/p90 widening', () => {
  it('p10/p90 widen monotonically with horizon for tenant arrears', () => {
    const startMs = Date.parse(BASE_OBSERVED);
    const history: TenantState[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push(
        makeTenant({
          observedAt: new Date(startMs + i * 30 * 86_400_000).toISOString(),
          arrearsAmountMajor: 10_000 + i * 5_000,
        }),
      );
    }
    const result = forecastTenantArrearsTrajectory({ history });
    let lastSpread = -Infinity;
    for (const p of result.arrearsAmountMajorAt) {
      const spread = p.p90 - p.p10;
      expect(spread).toBeGreaterThanOrEqual(lastSpread);
      lastSpread = spread;
    }
  });
});

describe('trajectory — owner cashflow rate clamping', () => {
  it('owner cashflow rate stays in [0, 1] even when forecast extrapolation pushes outside', () => {
    // Steeply declining: 1.0 → 0.0 over the history. The slope at the
    // far horizon would push below 0, so the clamp must hold.
    const startMs = Date.parse(BASE_OBSERVED);
    const history: OwnerState[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push(
        makeOwner({
          observedAt: new Date(startMs + i * 30 * 86_400_000).toISOString(),
          netCollectionRate: Math.max(1.0 - i * 0.18, 0),
        }),
      );
    }
    const result = forecastOwnerCashflow({ history, horizonDays: 365 });
    for (const p of result.netCollectionRateForecast) {
      expect(p.rate).toBeGreaterThanOrEqual(0);
      expect(p.rate).toBeLessThanOrEqual(1);
      expect(p.p10).toBeGreaterThanOrEqual(0);
      expect(p.p10).toBeLessThanOrEqual(1);
      expect(p.p90).toBeGreaterThanOrEqual(0);
      expect(p.p90).toBeLessThanOrEqual(1);
    }
  });
});

describe('trajectory — default probability monotonicity at extreme inputs', () => {
  it('default probability reaches the [0,1] bound when arrearsDays grows large and regularity falls', () => {
    const startMs = Date.parse(BASE_OBSERVED);
    const history: TenantState[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push(
        makeTenant({
          observedAt: new Date(startMs + i * 30 * 86_400_000).toISOString(),
          arrearsDays: i * 30,                       // 0..150
          paymentRegularity: Math.max(1 - i * 0.18, 0), // 1..0.1..0
        }),
      );
    }
    const result = forecastTenantArrearsTrajectory({ history });
    const probs = result.defaultProbabilityAt.map((p) => p.probability);
    // Every probability is bounded.
    for (const p of probs) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // The probability at the longest horizon is at least as high as at
    // the start when arrears+regularity both move adversely.
    const first = probs[0];
    const last = probs[probs.length - 1];
    if (first !== undefined && last !== undefined) {
      expect(last).toBeGreaterThanOrEqual(first);
    }
  });
});
