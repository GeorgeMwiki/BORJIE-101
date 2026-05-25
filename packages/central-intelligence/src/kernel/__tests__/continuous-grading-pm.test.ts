/**
 * Continuous grading — property-management 5-axis tests.
 *
 * Exercises the new `evaluatePropertyGrade` surface: per-axis
 * evidence / missing / watchpoints arrays, weakest-axis surfacing,
 * weighted overall + band, and the directive system-prompt-fragment
 * `renderGradeBriefing` (snapshot variant). The legacy
 * `gradeProperty(GradeInputs)` facade is covered by the existing
 * kernel-units tests.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePropertyGrade,
  renderGradeBriefing,
  type AxisEvaluation,
  type GradeAxisKey,
} from '../continuous-grading.js';

function findAxis(
  evals: ReadonlyArray<AxisEvaluation>,
  key: GradeAxisKey,
): AxisEvaluation {
  const e = evals.find((x) => x.key === key);
  if (!e) throw new Error(`axis ${key} missing from snapshot`);
  return e;
}

describe('evaluatePropertyGrade — 5 property-management axes', () => {
  it('returns all five axes in a stable order', () => {
    const snap = evaluatePropertyGrade({});
    const keys = snap.evaluations.map((e) => e.key);
    expect(keys).toEqual([
      'occupancy',
      'collections',
      'assetQuality',
      'compliance',
      'tenantSatisfaction',
    ]);
  });

  it('surfaces a missing[] entry when the input is absent', () => {
    const snap = evaluatePropertyGrade({});
    for (const e of snap.evaluations) {
      expect(e.missing.length).toBeGreaterThan(0);
    }
  });

  it('an A-grade healthy property scores ≥ 0.85 overall', () => {
    const snap = evaluatePropertyGrade({
      unitsOccupied: 95,
      unitsTotal: 100,
      occupancyTrend30d: 0.06,
      avgVacancyDays: 10,
      onTimeCollectionRate: 0.98,
      arrearsAvgDays: 2,
      disputeCount30d: 0,
      collectionsTrend30d: 0.04,
      inspectionPassRate: 0.96,
      maintenanceBacklogCount: 2,
      oldestOpenDefectDays: 5,
      kraMriFiledOnTimeRate: 1,
      kraMriLateCount30d: 0,
      gepgControlNumbersReconciledRate: 1,
      expiredCertificateCount: 0,
      certificatesValidRate: 1,
      sentimentRolling30d: 0.7,
      npsScore: 65,
      complaintRatePer100Units: 1,
      resolvedComplaintRate: 0.95,
    });
    expect(snap.overall).toBeGreaterThanOrEqual(0.85);
    expect(snap.band).toBe('A');
  });

  it('a struggling property scores band D or F', () => {
    const snap = evaluatePropertyGrade({
      unitsOccupied: 40,
      unitsTotal: 100,
      occupancyTrend30d: -0.1,
      avgVacancyDays: 90,
      onTimeCollectionRate: 0.5,
      arrearsAvgDays: 60,
      disputeCount30d: 8,
      collectionsTrend30d: -0.1,
      inspectionPassRate: 0.5,
      maintenanceBacklogCount: 25,
      oldestOpenDefectDays: 120,
      kraMriFiledOnTimeRate: 0.6,
      kraMriLateCount30d: 4,
      gepgControlNumbersReconciledRate: 0.7,
      expiredCertificateCount: 5,
      certificatesValidRate: 0.6,
      sentimentRolling30d: -0.4,
      npsScore: -20,
      complaintRatePer100Units: 9,
      resolvedComplaintRate: 0.3,
    });
    expect(['D', 'F']).toContain(snap.band);
  });

  it('emits watchpoints for high arrears days', () => {
    const snap = evaluatePropertyGrade({
      onTimeCollectionRate: 0.8,
      arrearsAvgDays: 45,
      disputeCount30d: 0,
    });
    const collections = findAxis(snap.evaluations, 'collections');
    expect(
      collections.watchpoints.some((w) => /arrears/i.test(w)),
    ).toBe(true);
  });

  it('emits watchpoints for an expired certificate', () => {
    const snap = evaluatePropertyGrade({
      kraMriFiledOnTimeRate: 1,
      gepgControlNumbersReconciledRate: 1,
      expiredCertificateCount: 3,
    });
    const compliance = findAxis(snap.evaluations, 'compliance');
    expect(
      compliance.watchpoints.some((w) => /expired/i.test(w)),
    ).toBe(true);
  });

  it('emits an occupancy watchpoint when below 60%', () => {
    const snap = evaluatePropertyGrade({
      unitsOccupied: 50,
      unitsTotal: 100,
    });
    const occ = findAxis(snap.evaluations, 'occupancy');
    expect(occ.watchpoints.length).toBeGreaterThan(0);
  });

  it('weakestAxis points to the lowest-scoring evaluation', () => {
    const snap = evaluatePropertyGrade({
      unitsOccupied: 99,
      unitsTotal: 100,
      onTimeCollectionRate: 0.99,
      inspectionPassRate: 0.95,
      kraMriFiledOnTimeRate: 1,
      gepgControlNumbersReconciledRate: 1,
      certificatesValidRate: 1,
      // Tenant satisfaction is rough.
      sentimentRolling30d: -0.7,
      npsScore: -50,
      complaintRatePer100Units: 10,
      resolvedComplaintRate: 0.2,
    });
    expect(snap.weakestAxis).toBe('tenantSatisfaction');
  });

  it('overall is a weighted mean of the 5 axes (collections weighted heaviest)', () => {
    // Collections weight 0.30 vs others ≤ 0.20. Crank just collections.
    const high = evaluatePropertyGrade({
      onTimeCollectionRate: 1,
      arrearsAvgDays: 0,
      disputeCount30d: 0,
      collectionsTrend30d: 0.05,
    });
    const low = evaluatePropertyGrade({
      onTimeCollectionRate: 0.2,
      arrearsAvgDays: 60,
      disputeCount30d: 10,
      collectionsTrend30d: -0.1,
    });
    expect(high.overall).toBeGreaterThan(low.overall);
    const collectionsHigh = findAxis(high.evaluations, 'collections');
    const collectionsLow = findAxis(low.evaluations, 'collections');
    expect(collectionsHigh.score).toBeGreaterThan(collectionsLow.score);
  });

  it('clamps every axis to [0, 1]', () => {
    const snap = evaluatePropertyGrade({
      sentimentRolling30d: -10,
      npsScore: -500,
    });
    for (const e of snap.evaluations) {
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('renderGradeBriefing — directive system-prompt fragment', () => {
  it('names the weakest axis in the briefing', () => {
    const snap = evaluatePropertyGrade({
      unitsOccupied: 100,
      unitsTotal: 100,
      onTimeCollectionRate: 1,
      inspectionPassRate: 1,
      kraMriFiledOnTimeRate: 1,
      gepgControlNumbersReconciledRate: 1,
      certificatesValidRate: 1,
      sentimentRolling30d: -0.5,
      npsScore: -30,
      complaintRatePer100Units: 10,
      resolvedComplaintRate: 0.2,
    });
    const briefing = renderGradeBriefing(snap);
    expect(briefing).toContain(snap.weakestAxis);
    expect(briefing).toMatch(/lift(?:ing)? the weakest axis/i);
  });

  it('includes evidence or watchpoints inline', () => {
    const snap = evaluatePropertyGrade({
      unitsOccupied: 50,
      unitsTotal: 100,
      onTimeCollectionRate: 0.9,
      arrearsAvgDays: 10,
    });
    const briefing = renderGradeBriefing(snap);
    expect(briefing.length).toBeGreaterThan(100);
    // Has the 5 axis lines.
    for (const axis of [
      'occupancy',
      'collections',
      'assetQuality',
      'compliance',
      'tenantSatisfaction',
    ] as const) {
      expect(briefing).toContain(axis);
    }
  });

  it('legacy PropertyGrade renders a single-line summary (backward-compat)', () => {
    // Backwards-compatible facade — pass a flat PropertyGrade shape.
    const flat = {
      condition: 0.8,
      cashflow: 0.7,
      covenant: 0.9,
      context: 0.85,
      compliance: 0.95,
      overall: 0.82,
      band: 'B' as const,
    };
    const out = renderGradeBriefing(flat);
    expect(out).toContain('Asset grade: B');
    expect(out).toContain('cashflow 70%');
  });
});
