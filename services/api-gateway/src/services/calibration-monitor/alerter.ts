/**
 * Calibration alerter - Wave CLOSED-LOOP.
 *
 * Watches the per-tenant calibration accuracy. When it dips below the
 * configured floor (default 0.6) on a fresh score, the alerter emits a
 * `calibration_drift` event so the brain can surface a humble line in
 * the next chat turn ("My predictions have been less accurate this
 * week - let me ask you for more context").
 *
 * Side-effect-free apart from the emit callback - the alerter does NOT
 * persist anything (no row writes, no audit). Persistence is the
 * tracker's domain; this is a thin observer.
 */

import type { CalibrationScore } from './types';

const DEFAULT_FLOOR = 0.6;
const DEFAULT_MIN_SAMPLES = 5;

export interface CalibrationDriftEvent {
  readonly type: 'calibration_drift';
  readonly tenantId: string;
  readonly accuracy: number;
  readonly meanDrift: number;
  readonly predictedCount: number;
  readonly verdictCount: number;
  readonly emittedAt: string;
}

export type CalibrationDriftSink = (event: CalibrationDriftEvent) => void;

export interface CalibrationAlerterOptions {
  readonly sink: CalibrationDriftSink;
  /** Trigger when accuracy < floor. Defaults to 0.6. */
  readonly accuracyFloor?: number;
  /**
   * Skip the alert when the verdict population (matched + divergent)
   * is below this threshold - we don't want to alert on a single
   * unlucky divergent row in a quiet tenant.
   */
  readonly minSamples?: number;
  readonly now?: () => Date;
}

export interface CalibrationAlerter {
  /**
   * Inspect the freshly-computed score and emit a drift event when
   * the floor is crossed. Returns true if an event was emitted.
   */
  inspect(score: CalibrationScore): boolean;
}

export function createCalibrationAlerter(
  options: CalibrationAlerterOptions,
): CalibrationAlerter {
  const floor = options.accuracyFloor ?? DEFAULT_FLOOR;
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const now = options.now ?? (() => new Date());

  return {
    inspect(score: CalibrationScore): boolean {
      const verdictCount = score.matchedCount + score.divergentCount;
      if (verdictCount < minSamples) return false;
      if (score.accuracy >= floor) return false;
      options.sink(
        Object.freeze({
          type: 'calibration_drift',
          tenantId: score.tenantId,
          accuracy: score.accuracy,
          meanDrift: score.meanDrift,
          predictedCount: score.predictedCount,
          verdictCount,
          emittedAt: now().toISOString(),
        }),
      );
      return true;
    },
  };
}
