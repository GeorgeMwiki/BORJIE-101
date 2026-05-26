/**
 * Calibration gate — Layer 4 gate #2.
 *
 * "Claimed confidence ≈ observed accuracy." The gate compares the
 * confidence the loop *claims* about its output to the historical hit
 * rate observed for that confidence band. A wide gap fails the gate
 * and routes the output for owner review.
 *
 * To keep this package free of a hard dependency on
 * `@borjie/cognitive-engine`, the gate accepts an injected
 * `CalibratorPort` whose contract matches the
 * `calibrateConfidence` helper from cognitive-engine §3 — production
 * wires the real implementation, tests inject a fake.
 *
 * Pass criteria:
 *   |claimed_score - observed_accuracy| ≤ tolerance
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4 #2.
 */

import {
  DEFAULT_CALIBRATION_TOLERANCE,
  DEFAULT_SIGNAL_WEIGHT,
  QualityGateError,
  type QualityGateResult,
  type QualitySignal,
} from '../types.js';

export type ConfidenceLabel = 'high' | 'medium' | 'low' | 'refused';

export interface CalibratorPort {
  /**
   * Returns the historical hit rate (in [0,1]) for outputs that
   * claimed the given confidence label. Production wires this to the
   * cognitive-engine calibrator's empirical-prior tracker.
   */
  readonly observedAccuracy: (label: ConfidenceLabel) => Promise<number>;
  /**
   * Returns the calibrator's claimed score for a given label. Wraps
   * the cognitive-engine `calibrateConfidence` signature so the gate
   * stays decoupled from the consumer's input shape.
   */
  readonly claimedScore: (label: ConfidenceLabel) => number;
}

export interface CalibrationInput {
  readonly claimedLabel: ConfidenceLabel;
  /** Override tolerance (defaults to DEFAULT_CALIBRATION_TOLERANCE). */
  readonly tolerance?: number;
}

const SIGNAL_NAME = 'calibration';

function makeSignal(
  score: number,
  evidence: Readonly<Record<string, unknown>>,
): QualitySignal {
  return Object.freeze({
    signal: SIGNAL_NAME,
    score,
    weight: DEFAULT_SIGNAL_WEIGHT,
    evidence,
  });
}

export async function calibrationGate(
  input: CalibrationInput,
  port: CalibratorPort,
): Promise<QualityGateResult> {
  if (!input || !input.claimedLabel) {
    throw new QualityGateError(
      'calibration gate received null input',
      'INVALID_INPUT',
    );
  }

  // Refused outputs always pass — there's no confidence claim to calibrate.
  if (input.claimedLabel === 'refused') {
    return Object.freeze({
      pass: true,
      signal: makeSignal(1.0, { claimedLabel: 'refused' }),
      reason: 'pass:refused-output-needs-no-calibration',
    });
  }

  const tolerance = input.tolerance ?? DEFAULT_CALIBRATION_TOLERANCE;
  if (tolerance < 0 || tolerance > 1) {
    throw new QualityGateError(
      `calibration tolerance must be within [0,1], got ${tolerance}`,
      'INVALID_INPUT',
    );
  }

  const claimedScore = port.claimedScore(input.claimedLabel);
  const observedAccuracy = await port.observedAccuracy(input.claimedLabel);

  if (claimedScore < 0 || claimedScore > 1) {
    throw new QualityGateError(
      `calibrator returned out-of-range claimedScore: ${claimedScore}`,
      'INTERNAL',
    );
  }
  if (observedAccuracy < 0 || observedAccuracy > 1) {
    throw new QualityGateError(
      `calibrator returned out-of-range observedAccuracy: ${observedAccuracy}`,
      'INTERNAL',
    );
  }

  const gap = Math.abs(claimedScore - observedAccuracy);
  const pass = gap <= tolerance;
  // Score = 1.0 if pass, else linear scale on |1 - normalised gap|.
  const score = pass ? 1.0 : Math.max(0, 1 - gap);

  return Object.freeze({
    pass,
    signal: makeSignal(score, {
      claimedLabel: input.claimedLabel,
      claimedScore,
      observedAccuracy,
      gap,
      tolerance,
    }),
    reason: pass
      ? `pass:gap-${gap.toFixed(3)}-within-${tolerance.toFixed(3)}`
      : `fail:gap-${gap.toFixed(3)}-exceeds-${tolerance.toFixed(3)}`,
  });
}
