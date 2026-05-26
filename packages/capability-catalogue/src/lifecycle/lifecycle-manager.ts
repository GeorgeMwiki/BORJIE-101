/**
 * Lifecycle manager (Wave CAPABILITY).
 *
 * Pure function: given a capability + its most recent measurement
 * (typically the 7-day window for promote/demote signals, 91-day for
 * recover-from-locked), return the *next* lifecycle state, or `null`
 * to leave it alone.
 *
 * Promotion requires ALL THREE axes to clear thresholds simultaneously.
 * Demotion fires on ANY ONE axis dropping below its demotion floor.
 * This asymmetry is intentional: it makes the system slow to promote
 * but fast to protect.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §6`.
 *
 * @module @borjie/capability-catalogue/lifecycle/lifecycle-manager
 */

import type {
  Capability,
  Lifecycle,
  Measurement,
} from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds — exported so tenants can override per-policy if needed
// ---------------------------------------------------------------------------

export interface LifecycleThresholds {
  /** Min competence to promote shadow → live. */
  readonly promoteCompetenceMin: number;
  /** Max calibration error to promote (0 = perfect). */
  readonly promoteCalibrationMax: number;
  /** Min utility to promote shadow → live. */
  readonly promoteUtilityMin: number;
  /** Min number of observations to act on a measurement. */
  readonly minObservations: number;
  /** Any axis falling below half its promote threshold demotes live → locked. */
  readonly demoteHalfMultiplier: number;
  /** Min 28-day utility for a live capability; below → deprecate. */
  readonly deprecateUtilityMin: number;
}

export const DEFAULT_THRESHOLDS: LifecycleThresholds = Object.freeze({
  promoteCompetenceMin: 0.85,
  promoteCalibrationMax: 0.2,
  promoteUtilityMin: 0.5,
  minObservations: 30,
  demoteHalfMultiplier: 0.5,
  deprecateUtilityMin: 0.1,
});

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface LifecycleVerdict {
  readonly nextState: Lifecycle | null;
  readonly reason: string;
}

/**
 * Evaluate a capability's most recent 7-day + 28-day measurements and
 * decide whether to transition lifecycle. Returns `null` if no change.
 *
 * The function is intentionally pure — callers (the worker) read the
 * verdict and then call `registry.transitionLifecycle()` if non-null.
 */
export function decideLifecycle(args: {
  readonly capability: Capability;
  readonly window7d: Measurement | null;
  readonly window28d: Measurement | null;
  readonly dependenciesLive: boolean;
  readonly thresholds?: LifecycleThresholds;
}): LifecycleVerdict {
  const t = args.thresholds ?? DEFAULT_THRESHOLDS;
  const { capability, window7d, window28d, dependenciesLive } = args;

  // Deprecated capabilities never move further.
  if (capability.lifecycleState === 'deprecated') {
    return { nextState: null, reason: 'terminal-state' };
  }

  // Locked → live only on a 28d recovery snapshot.
  if (capability.lifecycleState === 'locked') {
    if (
      window28d &&
      window28d.nObservations >= t.minObservations &&
      window28d.competenceRate >= t.promoteCompetenceMin &&
      window28d.calibrationError <= t.promoteCalibrationMax &&
      window28d.utilityRate >= t.promoteUtilityMin
    ) {
      return { nextState: 'live', reason: 'locked-recovered-on-28d' };
    }
    return { nextState: null, reason: 'locked-no-recovery' };
  }

  // Live → locked if any 7d axis collapses, OR live → deprecated if 28d
  // utility is sustained at zero usage.
  if (capability.lifecycleState === 'live') {
    if (window7d && window7d.nObservations >= t.minObservations) {
      if (
        window7d.competenceRate <
          t.promoteCompetenceMin * t.demoteHalfMultiplier ||
        window7d.calibrationError >
          1 - (1 - t.promoteCalibrationMax) * t.demoteHalfMultiplier ||
        window7d.utilityRate < t.promoteUtilityMin * t.demoteHalfMultiplier
      ) {
        return { nextState: 'locked', reason: 'live-demoted-on-7d-regression' };
      }
    }
    if (
      window28d &&
      window28d.nObservations >= t.minObservations &&
      window28d.utilityRate <= t.deprecateUtilityMin
    ) {
      return { nextState: 'deprecated', reason: 'live-deprecated-low-utility' };
    }
    return { nextState: null, reason: 'live-stable' };
  }

  // Shadow → live requires all three 7d axes + composite dependency check.
  if (capability.lifecycleState === 'shadow') {
    if (!dependenciesLive) {
      return {
        nextState: null,
        reason: 'shadow-blocked-by-non-live-dependency',
      };
    }
    if (!window7d || window7d.nObservations < t.minObservations) {
      return { nextState: null, reason: 'shadow-low-confidence-window' };
    }
    if (
      window7d.competenceRate >= t.promoteCompetenceMin &&
      window7d.calibrationError <= t.promoteCalibrationMax &&
      window7d.utilityRate >= t.promoteUtilityMin
    ) {
      return { nextState: 'live', reason: 'shadow-promoted-on-7d' };
    }
    return { nextState: null, reason: 'shadow-thresholds-not-met' };
  }

  // Draft → shadow on first observation window with any data.
  if (capability.lifecycleState === 'draft') {
    if (window7d && window7d.nObservations >= 1) {
      return { nextState: 'shadow', reason: 'draft-first-data' };
    }
    return { nextState: null, reason: 'draft-no-data' };
  }

  return { nextState: null, reason: 'unhandled' };
}
