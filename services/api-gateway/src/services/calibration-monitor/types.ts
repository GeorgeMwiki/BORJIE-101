/**
 * Calibration-monitor port types - Wave CLOSED-LOOP.
 *
 * Pure type surface shared between tracker / alerter / the brain tool
 * adapter. No db client / network reference here so the types stay
 * importable from any composition layer.
 */

export interface CalibrationScoreInput {
  readonly tenantId: string;
  /** Restrict to one actor_kind (brain / owner / agent / external). */
  readonly actorKindFilter?: 'brain' | 'owner' | 'agent' | 'external';
  /** Look-back window in days. Defaults to 30. */
  readonly sinceDays?: number;
  /** Optional action_kind prefix filter (e.g. "mining.licence."). */
  readonly actionKindPrefix?: string;
}

export interface CalibrationCurvePoint {
  /** Bucketed confidence band lower-bound in [0,1]. */
  readonly confidenceLower: number;
  readonly confidenceUpper: number;
  /** How many reconciliations fell into this band. */
  readonly count: number;
  /** Fraction of `count` whose status === 'matched'. */
  readonly matchedFraction: number;
}

export interface CalibrationScore {
  readonly tenantId: string;
  readonly sinceDays: number;
  readonly actorKindFilter: 'brain' | 'owner' | 'agent' | 'external' | null;
  readonly actionKindPrefix: string | null;
  readonly predictedCount: number;
  readonly matchedCount: number;
  readonly divergentCount: number;
  readonly undeterminedCount: number;
  readonly expiredCount: number;
  /**
   * matched / (matched + divergent). Undetermined and expired are
   * excluded from the denominator because they have no clean verdict.
   * Returns 1.0 when the denominator is 0 (no failures to count yet).
   */
  readonly accuracy: number;
  /** Mean drift_score over (matched + divergent) reconciliations. */
  readonly meanDrift: number;
  /** Per-confidence-band breakdown for surfacing in the cockpit. */
  readonly calibrationCurve: readonly CalibrationCurvePoint[];
  /** Wall-clock the score was computed. */
  readonly computedAt: string;
}
