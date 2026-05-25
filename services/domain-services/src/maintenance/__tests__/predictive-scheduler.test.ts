/**
 * Unit tests for the predictive maintenance scheduler (Wave 8).
 *
 * These tests lock down:
 *   - Age-weighted scoring behaviour.
 *   - Condition transitions in the degradation forecast.
 *   - Seasonal HVAC / roofing boosts (Tanzanian dry/wet calendar).
 *   - Budget-constrained replacement recommendations (greedy by ratio).
 *   - Tenant isolation — every output carries the input's tenantId.
 *   - Pure-function invariants — same inputs always yield same outputs.
 */

import { describe, it, expect } from 'vitest';
import {
  scorePriority,
  recommendInspections,
  recommendReplacements,
  forecastConditionDegradation,
  seasonalProfile,
  type PredictiveComponentInput,
  type ComponentCondition,
} from '../predictive-scheduler.js';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const TENANT_A = 'tnt_alpha';
const TENANT_B = 'tnt_beta';
const PROPERTY_1 = 'prop_1';
const DRY_SEASON = new Date('2026-08-15T00:00:00.000Z'); // August = dry
const WET_SEASON = new Date('2026-04-15T00:00:00.000Z'); // April = wet
const NEUTRAL_SEASON = new Date('2026-01-15T00:00:00.000Z'); // January = neutral

function isoMonthsAgo(base: Date, months: number): string {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

function isoDaysAgo(base: Date, days: number): string {
  const d = new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function makeComponent(
  overrides: Partial<PredictiveComponentInput> = {}
): PredictiveComponentInput {
  return {
    id: 'cmp_1',
    tenantId: TENANT_A,
    propertyId: PROPERTY_1,
    name: 'Main HVAC unit',
    category: 'hvac',
    installedAt: isoMonthsAgo(DRY_SEASON, 24),
    expectedLifespanMonths: 180,
    currentCondition: 'good',
    lastInspectionAt: isoDaysAgo(DRY_SEASON, 30),
    criticality: 3,
    replacementCostCents: 5_000_000,
    cumulativeRepairCostCents: 200_000,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// scorePriority
// ----------------------------------------------------------------------------

describe('scorePriority', () => {
  it('returns a pristine score near zero for a new, excellent, just-inspected component', () => {
    const cmp = makeComponent({
      currentCondition: 'excellent',
      installedAt: isoMonthsAgo(NEUTRAL_SEASON, 1),
      lastInspectionAt: isoDaysAgo(NEUTRAL_SEASON, 1),
      criticality: 1,
      category: 'plumbing',
    });
    const score = scorePriority(cmp, NEUTRAL_SEASON);
    expect(score).toBeLessThan(5);
  });

  it('produces a near-maximum score for a critical, overdue, past-life component', () => {
    const cmp = makeComponent({
      currentCondition: 'critical',
      installedAt: isoMonthsAgo(DRY_SEASON, 240), // 20 years on a 15-year HVAC
      lastInspectionAt: isoDaysAgo(DRY_SEASON, 400),
      criticality: 5,
    });
    const score = scorePriority(cmp, DRY_SEASON);
    expect(score).toBeGreaterThan(90);
  });

  it('weighs age — older component scores higher than identical younger one', () => {
    const young = makeComponent({ installedAt: isoMonthsAgo(DRY_SEASON, 12) });
    const old = makeComponent({ installedAt: isoMonthsAgo(DRY_SEASON, 180) });
    expect(scorePriority(old, DRY_SEASON)).toBeGreaterThan(
      scorePriority(young, DRY_SEASON)
    );
  });

  it('weighs inspection gap — longer gap raises score', () => {
    const fresh = makeComponent({
      lastInspectionAt: isoDaysAgo(DRY_SEASON, 10),
    });
    const stale = makeComponent({
      lastInspectionAt: isoDaysAgo(DRY_SEASON, 500),
    });
    expect(scorePriority(stale, DRY_SEASON)).toBeGreaterThan(
      scorePriority(fresh, DRY_SEASON)
    );
  });

  it('adds a seasonal HVAC boost during dry season but not neutral season', () => {
    const dry = scorePriority(
      makeComponent({ category: 'hvac' }),
      DRY_SEASON
    );
    const neutral = scorePriority(
      makeComponent({
        category: 'hvac',
        installedAt: isoMonthsAgo(NEUTRAL_SEASON, 24),
        lastInspectionAt: isoDaysAgo(NEUTRAL_SEASON, 30),
      }),
      NEUTRAL_SEASON
    );
    expect(dry - neutral).toBeGreaterThanOrEqual(5);
  });

  it('adds a seasonal roofing boost in wet season', () => {
    const wet = scorePriority(
      makeComponent({
        category: 'roofing',
        installedAt: isoMonthsAgo(WET_SEASON, 36),
        lastInspectionAt: isoDaysAgo(WET_SEASON, 30),
      }),
      WET_SEASON
    );
    const neutral = scorePriority(
      makeComponent({
        category: 'roofing',
        installedAt: isoMonthsAgo(NEUTRAL_SEASON, 36),
        lastInspectionAt: isoDaysAgo(NEUTRAL_SEASON, 30),
      }),
      NEUTRAL_SEASON
    );
    expect(wet - neutral).toBeGreaterThanOrEqual(5);
  });

  it('is a pure function — same input yields same score', () => {
    const cmp = makeComponent();
    const a = scorePriority(cmp, DRY_SEASON);
    const b = scorePriority(cmp, DRY_SEASON);
    expect(a).toBe(b);
  });

  it('does not mutate its input component', () => {
    const cmp = makeComponent();
    const snapshot = JSON.stringify(cmp);
    scorePriority(cmp, DRY_SEASON);
    expect(JSON.stringify(cmp)).toBe(snapshot);
  });
});

// ----------------------------------------------------------------------------
// seasonalProfile (helper sanity check)
// ----------------------------------------------------------------------------

describe('seasonalProfile', () => {
  it('classifies August as dry', () => {
    expect(seasonalProfile(DRY_SEASON)).toBe('dry');
  });

  it('classifies April as wet', () => {
    expect(seasonalProfile(WET_SEASON)).toBe('wet');
  });

  it('classifies January as neutral', () => {
    expect(seasonalProfile(NEUTRAL_SEASON)).toBe('neutral');
  });
});

// ----------------------------------------------------------------------------
// recommendInspections
// ----------------------------------------------------------------------------

describe('recommendInspections', () => {
  it('returns recommendations sorted by priority score DESC', () => {
    const low = makeComponent({
      id: 'cmp_low',
      currentCondition: 'good',
      installedAt: isoMonthsAgo(DRY_SEASON, 12),
      lastInspectionAt: isoDaysAgo(DRY_SEASON, 10),
      criticality: 2,
    });
    const high = makeComponent({
      id: 'cmp_high',
      currentCondition: 'poor',
      installedAt: isoMonthsAgo(DRY_SEASON, 160),
      lastInspectionAt: isoDaysAgo(DRY_SEASON, 300),
      criticality: 5,
    });
    const recs = recommendInspections([low, high], 30, DRY_SEASON);
    expect(recs.length).toBe(2);
    expect(recs[0].componentId).toBe('cmp_high');
    expect(recs[1].componentId).toBe('cmp_low');
  });

  it('filters out cold components (excellent + recent inspection)', () => {
    const cold = makeComponent({
      id: 'cmp_cold',
      currentCondition: 'excellent',
      installedAt: isoMonthsAgo(DRY_SEASON, 2),
      lastInspectionAt: isoDaysAgo(DRY_SEASON, 3),
      criticality: 1,
      category: 'structural',
    });
    const hot = makeComponent({
      id: 'cmp_hot',
      currentCondition: 'poor',
      criticality: 5,
    });
    const recs = recommendInspections([cold, hot], 30, DRY_SEASON);
    expect(recs.map((r) => r.componentId)).toEqual(['cmp_hot']);
  });

  it('recommends critical components within 1 day regardless of horizon', () => {
    const cmp = makeComponent({ currentCondition: 'critical' });
    const recs = recommendInspections([cmp], 365, DRY_SEASON);
    expect(recs[0].recommendedWithinDays).toBe(1);
  });

  it('preserves tenantId on every recommendation — tenant isolation', () => {
    const a = makeComponent({ id: 'a', tenantId: TENANT_A });
    const b = makeComponent({ id: 'b', tenantId: TENANT_B });
    const recs = recommendInspections([a, b], 90, DRY_SEASON);
    const tenants = new Set(recs.map((r) => r.tenantId));
    expect(tenants.has(TENANT_A)).toBe(true);
    expect(tenants.has(TENANT_B)).toBe(true);
    for (const rec of recs) {
      const source = rec.componentId === 'a' ? TENANT_A : TENANT_B;
      expect(rec.tenantId).toBe(source);
    }
  });

  it('includes human-readable rationale for each recommendation', () => {
    const cmp = makeComponent({
      currentCondition: 'poor',
      installedAt: isoMonthsAgo(DRY_SEASON, 150),
      lastInspectionAt: null,
      criticality: 5,
    });
    const [rec] = recommendInspections([cmp], 30, DRY_SEASON);
    expect(rec.rationale.length).toBeGreaterThan(0);
    expect(rec.rationale.some((r) => r.includes('poor'))).toBe(true);
    expect(rec.rationale.some((r) => r.includes('never'))).toBe(true);
  });

  it('returns an empty array for an empty input', () => {
    const recs = recommendInspections([], 30, DRY_SEASON);
    expect(recs).toEqual([]);
  });

  it('is deterministic — same input yields structurally identical output', () => {
    const cmps = [
      makeComponent({ id: 'cmp_x', currentCondition: 'fair' }),
      makeComponent({ id: 'cmp_y', currentCondition: 'poor', criticality: 4 }),
    ];
    const first = recommendInspections(cmps, 30, DRY_SEASON);
    const second = recommendInspections(cmps, 30, DRY_SEASON);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// ----------------------------------------------------------------------------
// recommendReplacements
// ----------------------------------------------------------------------------

describe('recommendReplacements', () => {
  it('recommends replacement when condition is critical', () => {
    const cmp = makeComponent({
      currentCondition: 'critical',
      replacementCostCents: 1_000_000,
    });
    const [rec] = recommendReplacements([cmp], 10_000_000, DRY_SEASON);
    expect(rec.action).toBe('replace');
    expect(rec.estimatedCostCents).toBe(1_000_000);
  });

  it('applies the 50% rule — replace when age and repair spend both past half', () => {
    const cmp = makeComponent({
      currentCondition: 'fair',
      installedAt: isoMonthsAgo(DRY_SEASON, 120), // 10y on 15y HVAC = 66%
      cumulativeRepairCostCents: 3_000_000, // 60% of 5M replacement
      replacementCostCents: 5_000_000,
    });
    const [rec] = recommendReplacements([cmp], 50_000_000, DRY_SEASON);
    expect(rec.action).toBe('replace');
    expect(rec.rationale.some((r) => r.includes('50% rule'))).toBe(true);
  });

  it('defers when the component is excellent and young', () => {
    const cmp = makeComponent({
      currentCondition: 'excellent',
      installedAt: isoMonthsAgo(DRY_SEASON, 3),
      cumulativeRepairCostCents: 0,
    });
    const [rec] = recommendReplacements([cmp], 50_000_000, DRY_SEASON);
    expect(rec.action).toBe('defer');
    expect(rec.estimatedCostCents).toBe(0);
  });

  it('consumes budget greedily by cost-benefit ratio DESC, deferring the rest', () => {
    const cheapHighImpact = makeComponent({
      id: 'cmp_cheap',
      currentCondition: 'critical',
      replacementCostCents: 100_000,
    });
    const expensiveModerate = makeComponent({
      id: 'cmp_expensive',
      currentCondition: 'poor',
      installedAt: isoMonthsAgo(DRY_SEASON, 150),
      cumulativeRepairCostCents: 3_000_000,
      replacementCostCents: 8_000_000,
    });
    const recs = recommendReplacements(
      [cheapHighImpact, expensiveModerate],
      500_000, // only enough for cheap one
      DRY_SEASON
    );
    const byId = Object.fromEntries(recs.map((r) => [r.componentId, r]));
    expect(byId['cmp_cheap'].action).toBe('replace');
    expect(byId['cmp_expensive'].action).toBe('defer');
    expect(
      byId['cmp_expensive'].rationale.some((r) => r.includes('budget'))
    ).toBe(true);
  });

  it('preserves tenantId on every replacement recommendation', () => {
    const a = makeComponent({ id: 'a', tenantId: TENANT_A });
    const b = makeComponent({ id: 'b', tenantId: TENANT_B });
    const recs = recommendReplacements([a, b], 100_000_000, DRY_SEASON);
    for (const rec of recs) {
      const source = rec.componentId === 'a' ? TENANT_A : TENANT_B;
      expect(rec.tenantId).toBe(source);
    }
  });

  it('does not mutate inputs', () => {
    const cmp = makeComponent({ currentCondition: 'critical' });
    const snapshot = JSON.stringify(cmp);
    recommendReplacements([cmp], 1_000_000, DRY_SEASON);
    expect(JSON.stringify(cmp)).toBe(snapshot);
  });
});

// ----------------------------------------------------------------------------
// forecastConditionDegradation
// ----------------------------------------------------------------------------

describe('forecastConditionDegradation', () => {
  it('returns zero degradation for a zero-day horizon', () => {
    const cmp = makeComponent({ currentCondition: 'good' });
    const f = forecastConditionDegradation(cmp, 0, DRY_SEASON);
    expect(f.pointsLost).toBe(0);
    expect(f.startCondition).toBe('good');
    expect(f.endCondition).toBe('good');
  });

  it('projects a long-horizon degradation that crosses a condition boundary', () => {
    const cmp = makeComponent({
      currentCondition: 'fair',
      installedAt: isoMonthsAgo(DRY_SEASON, 120), // past half-life on HVAC
      expectedLifespanMonths: 180,
    });
    const f = forecastConditionDegradation(cmp, 365 * 3, DRY_SEASON);
    const rank: Record<ComponentCondition, number> = {
      excellent: 0,
      good: 1,
      fair: 2,
      poor: 3,
      critical: 4,
    };
    expect(rank[f.endCondition]).toBeGreaterThan(rank[f.startCondition]);
  });

  it('accelerates decay past half-life (older component loses more points over the same horizon)', () => {
    const young = makeComponent({
      installedAt: isoMonthsAgo(DRY_SEASON, 24),
      expectedLifespanMonths: 180,
      currentCondition: 'good',
    });
    const old = makeComponent({
      installedAt: isoMonthsAgo(DRY_SEASON, 150),
      expectedLifespanMonths: 180,
      currentCondition: 'good',
    });
    const youngF = forecastConditionDegradation(young, 365, DRY_SEASON);
    const oldF = forecastConditionDegradation(old, 365, DRY_SEASON);
    expect(oldF.pointsLost).toBeGreaterThan(youngF.pointsLost);
  });

  it('never exceeds the critical ceiling', () => {
    const cmp = makeComponent({
      currentCondition: 'poor',
      installedAt: isoMonthsAgo(DRY_SEASON, 300),
      expectedLifespanMonths: 180,
    });
    const f = forecastConditionDegradation(cmp, 365 * 20, DRY_SEASON);
    expect(f.endCondition).toBe('critical');
    expect(f.pointsLost).toBeLessThanOrEqual(4);
  });

  it('preserves tenantId on the forecast', () => {
    const cmp = makeComponent({ tenantId: TENANT_B });
    const f = forecastConditionDegradation(cmp, 90, DRY_SEASON);
    expect(f.tenantId).toBe(TENANT_B);
  });

  it('is a pure function — same input yields same forecast', () => {
    const cmp = makeComponent();
    const a = forecastConditionDegradation(cmp, 120, DRY_SEASON);
    const b = forecastConditionDegradation(cmp, 120, DRY_SEASON);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
