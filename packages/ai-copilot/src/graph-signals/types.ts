/**
 * Graph-signal types — narrow mapping from `@borjie/forecasting`
 * outputs onto the existing proactive-loop `Signal` contract.
 *
 * The forecasting package emits rich `Forecast` records with
 * conformal-prediction intervals and ordered driver attributions. The
 * proactive-loop (Wave 28) expects a normalised `Signal` with a
 * `source: 'forecasting'` and a tenant-scoped payload that its
 * template matcher can introspect.
 *
 * This module is a pure mapper: no runtime state, no I/O. Every
 * function is total and exhaustive across the `RiskKind` enum — adding
 * a new risk kind upstream fails the build here until the mapping is
 * supplied.
 */
import type { Forecast, RiskKind } from '@borjie/forecasting';
import type { SignalSeverity } from '../proactive-loop/types.js';

/**
 * Thresholds used to promote a forecast point / lower-bound estimate to
 * a graph-signal severity. Probability kinds (arrears, churn, ...)
 * live in `[0, 1]` so the defaults are probability bands. Regression
 * kinds (e.g. `void_risk` expressed as days) can supply their own
 * thresholds via `ThresholdRegistry`.
 */
export interface SeverityThresholds {
  /** Lower-bound of the conformal interval above which severity is
   *  'critical'. Reaching this means even the optimistic scenario is
   *  bad — the strongest trigger for high-priority response. */
  readonly criticalLowerBound: number;
  /** Point estimate above which severity is 'critical'. Used when the
   *  lower-bound is below but the point is still alarming. */
  readonly criticalPoint: number;
  /** Point estimate above which severity is 'high'. */
  readonly highPoint: number;
  /** Point estimate above which severity is 'medium'. Below this we
   *  emit 'low' so the proactive-loop can still see the signal but
   *  drop it under the auto-execution threshold. */
  readonly mediumPoint: number;
}

/** Per-kind registry of thresholds. Always total: every RiskKind must
 *  have an entry so severity classification is exhaustive. */
export type ThresholdRegistry = Readonly<Record<RiskKind, SeverityThresholds>>;

/**
 * Default thresholds keyed by RiskKind. Probability kinds share a
 * band; opportunity kinds (e.g. renewal_opportunity) use a lower
 * 'alarm' threshold because their value grows with the point, not
 * with a lower-bound breach.
 */
export const DEFAULT_THRESHOLDS: ThresholdRegistry = Object.freeze({
  arrears_risk:         { criticalLowerBound: 0.6, criticalPoint: 0.8, highPoint: 0.6, mediumPoint: 0.4 },
  churn_risk:           { criticalLowerBound: 0.6, criticalPoint: 0.8, highPoint: 0.6, mediumPoint: 0.4 },
  incident_risk:        { criticalLowerBound: 0.55, criticalPoint: 0.8, highPoint: 0.6, mediumPoint: 0.4 },
  vendor_decay:         { criticalLowerBound: 0.5, criticalPoint: 0.75, highPoint: 0.55, mediumPoint: 0.35 },
  renewal_opportunity:  { criticalLowerBound: 0.75, criticalPoint: 0.85, highPoint: 0.65, mediumPoint: 0.45 },
  compliance_drift:     { criticalLowerBound: 0.5, criticalPoint: 0.75, highPoint: 0.55, mediumPoint: 0.35 },
  void_risk:            { criticalLowerBound: 0.6, criticalPoint: 0.8, highPoint: 0.6, mediumPoint: 0.4 },
  repair_recurrence:    { criticalLowerBound: 0.55, criticalPoint: 0.75, highPoint: 0.55, mediumPoint: 0.35 },
  payment_method_decay: { criticalLowerBound: 0.5, criticalPoint: 0.7, highPoint: 0.5, mediumPoint: 0.3 },
  litigation_exposure:  { criticalLowerBound: 0.4, criticalPoint: 0.6, highPoint: 0.4, mediumPoint: 0.25 },
});

/** Shape of the `Signal.payload` emitted by the graph-signal emitter.
 *  Held in its own type so the proactive-loop template matcher can key
 *  off the stable field set (forecastId, kind, interval, drivers,
 *  modelVersion) without reaching into the opaque payload at runtime. */
export interface GraphSignalPayload {
  readonly forecastId: string;
  readonly kind: RiskKind;
  readonly nodeLabel: string;
  readonly nodeId: string;
  readonly horizonDays: number;
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  readonly alpha: number;
  readonly modelVersion: string;
  readonly featureFingerprint: string;
  readonly drivers: ReadonlyArray<{
    readonly name: string;
    readonly contribution: number;
    readonly narrative: string;
  }>;
}

export interface SeverityDecision {
  readonly severity: SignalSeverity;
  readonly reason:
    | 'lower_bound_breach'
    | 'point_critical'
    | 'point_high'
    | 'point_medium'
    | 'below_medium';
}

/** Pure helper re-exported for test access. */
export function classifySeverity(
  forecast: Forecast,
  thresholds: SeverityThresholds,
): SeverityDecision {
  const { point, lower } = forecast.interval;
  if (lower >= thresholds.criticalLowerBound) {
    return { severity: 'critical', reason: 'lower_bound_breach' };
  }
  if (point >= thresholds.criticalPoint) {
    return { severity: 'critical', reason: 'point_critical' };
  }
  if (point >= thresholds.highPoint) {
    return { severity: 'high', reason: 'point_high' };
  }
  if (point >= thresholds.mediumPoint) {
    return { severity: 'medium', reason: 'point_medium' };
  }
  return { severity: 'low', reason: 'below_medium' };
}
