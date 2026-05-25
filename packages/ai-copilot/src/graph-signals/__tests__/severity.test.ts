/**
 * Tests for graph-signals/types classifySeverity.
 *
 * Coverage: lower-bound breach beats point critical, every band
 * (critical, high, medium, low) including reason codes,
 * DEFAULT_THRESHOLDS shape, frozen registry.
 */

import { describe, it, expect } from 'vitest';
import {
  classifySeverity,
  DEFAULT_THRESHOLDS,
  type SeverityThresholds,
} from '../types.js';
import type { Forecast } from '@borjie/forecasting';

const thresholds: SeverityThresholds = {
  criticalLowerBound: 0.6,
  criticalPoint: 0.8,
  highPoint: 0.6,
  mediumPoint: 0.4,
};

function fakeForecast(point: number, lower: number): Forecast {
  // Cast — the function only reads `interval.{point, lower}`.
  return {
    interval: { point, lower, upper: point + 0.1, alpha: 0.1 },
  } as unknown as Forecast;
}

describe('classifySeverity', () => {
  it('returns critical/lower_bound_breach when lower >= criticalLowerBound', () => {
    const decision = classifySeverity(fakeForecast(0.65, 0.7), thresholds);
    expect(decision.severity).toBe('critical');
    expect(decision.reason).toBe('lower_bound_breach');
  });

  it('returns critical/point_critical when only point >= criticalPoint', () => {
    const decision = classifySeverity(fakeForecast(0.85, 0.3), thresholds);
    expect(decision.severity).toBe('critical');
    expect(decision.reason).toBe('point_critical');
  });

  it('returns high/point_high when only point >= highPoint', () => {
    const decision = classifySeverity(fakeForecast(0.65, 0.1), thresholds);
    expect(decision.severity).toBe('high');
    expect(decision.reason).toBe('point_high');
  });

  it('returns medium/point_medium when only point >= mediumPoint', () => {
    const decision = classifySeverity(fakeForecast(0.45, 0.1), thresholds);
    expect(decision.severity).toBe('medium');
    expect(decision.reason).toBe('point_medium');
  });

  it('returns low/below_medium when point < mediumPoint', () => {
    const decision = classifySeverity(fakeForecast(0.2, 0.1), thresholds);
    expect(decision.severity).toBe('low');
    expect(decision.reason).toBe('below_medium');
  });

  it('lower-bound breach trumps point classification — even if point would be medium', () => {
    const decision = classifySeverity(fakeForecast(0.45, 0.7), thresholds);
    expect(decision.severity).toBe('critical');
    expect(decision.reason).toBe('lower_bound_breach');
  });

  it('honours equality at the boundary (>= for criticalLowerBound)', () => {
    expect(classifySeverity(fakeForecast(0.5, 0.6), thresholds).reason).toBe(
      'lower_bound_breach',
    );
  });

  it('honours equality at criticalPoint', () => {
    expect(classifySeverity(fakeForecast(0.8, 0.1), thresholds).reason).toBe(
      'point_critical',
    );
  });
});

describe('DEFAULT_THRESHOLDS', () => {
  it('contains an entry for every documented RiskKind', () => {
    const expected = [
      'arrears_risk',
      'churn_risk',
      'incident_risk',
      'vendor_decay',
      'renewal_opportunity',
      'compliance_drift',
      'void_risk',
      'repair_recurrence',
      'payment_method_decay',
      'litigation_exposure',
    ];
    for (const k of expected) {
      expect(DEFAULT_THRESHOLDS).toHaveProperty(k);
    }
  });

  it('orders thresholds correctly: medium < high < criticalPoint', () => {
    for (const t of Object.values(DEFAULT_THRESHOLDS)) {
      expect(t.mediumPoint).toBeLessThan(t.highPoint);
      expect(t.highPoint).toBeLessThan(t.criticalPoint);
    }
  });

  it('is frozen at module load', () => {
    expect(Object.isFrozen(DEFAULT_THRESHOLDS)).toBe(true);
  });
});
