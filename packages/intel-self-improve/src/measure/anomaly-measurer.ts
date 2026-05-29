/**
 * Anomaly measurer — reduces labelled-anomaly observations to the
 * three capability-catalogue axes.
 *
 * Spec §3.5 of Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * Competence : F1 score from precision and recall on the labelled
 *              set (incident table in `services/wave-resilience-
 *              manager`). Precision = TP / (TP+FP); recall = TP /
 *              (TP+FN); F1 = 2 P R / (P + R).
 *
 * Calibration: empirical false-positive rate at the chosen threshold
 *              compared to the *claimed* FPR. Görnitz et al., "Toward
 *              Supervised Anomaly Detection", JAIR 46 (2013): 235–262.
 *              https://www.jair.org/index.php/jair/article/view/10802
 *
 * Utility    : did the operator investigate the flagged anomaly
 *              within the SLA window (`accepted` / `modified` ⇒ 1)?
 *
 * @module @borjie/intel-self-improve/measure/anomaly-measurer
 */

import type { UserFollowthrough } from '@borjie/capability-catalogue';

// ---------------------------------------------------------------------------
// Per-call observation
// ---------------------------------------------------------------------------

export interface AnomalyObservation {
  readonly truePositive: boolean;
  readonly falsePositive: boolean;
  readonly falseNegative: boolean;
  readonly claimedFalsePositiveRate: number;
  readonly observedFalsePositive: boolean;
  readonly userFollowthrough: UserFollowthrough;
}

// ---------------------------------------------------------------------------
// Aggregate output
// ---------------------------------------------------------------------------

export interface AnomalyMeasurementResult {
  readonly competenceRate: number;
  readonly calibrationError: number;
  readonly utilityRate: number;
  readonly nObservations: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly empiricalFpr: number;
  readonly claimedFpr: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function measureAnomalies(
  observations: ReadonlyArray<AnomalyObservation>,
): AnomalyMeasurementResult {
  if (observations.length === 0) {
    throw new RangeError('measureAnomalies: empty observations cohort');
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let fpEvents = 0;
  let claimedSum = 0;
  let utilityCount = 0;

  for (const obs of observations) {
    if (obs.truePositive) tp += 1;
    if (obs.falsePositive) fp += 1;
    if (obs.falseNegative) fn += 1;
    if (obs.observedFalsePositive) fpEvents += 1;
    claimedSum += clamp01(obs.claimedFalsePositiveRate);
    if (
      obs.userFollowthrough === 'accepted' ||
      obs.userFollowthrough === 'modified'
    ) {
      utilityCount += 1;
    }
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const empiricalFpr = fpEvents / observations.length;
  const claimedFpr = claimedSum / observations.length;
  const calibrationError = clamp01(Math.abs(empiricalFpr - claimedFpr));
  const utilityRate = clamp01(utilityCount / observations.length);

  return Object.freeze({
    competenceRate: clamp01(f1),
    calibrationError,
    utilityRate,
    nObservations: observations.length,
    precision: clamp01(precision),
    recall: clamp01(recall),
    f1: clamp01(f1),
    empiricalFpr: clamp01(empiricalFpr),
    claimedFpr: clamp01(claimedFpr),
  });
}

// ---------------------------------------------------------------------------
// Per-call labelled-cohort measurement
// ---------------------------------------------------------------------------

export interface AnomalyMeasurementInput {
  readonly predictions: ReadonlyArray<boolean>;
  readonly labels: ReadonlyArray<boolean>;
}

export interface AnomalyMeasurement {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly trueNegatives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/**
 * Per-call labelled-cohort measurement — given parallel arrays of
 * detector predictions and ground-truth labels, compute the standard
 * confusion matrix plus precision / recall / F1.
 *
 * Used by the new outcome-observer attach path that operates on a
 * single batch at a time (one batch per detector run).
 */
export function measureAnomaly(
  input: AnomalyMeasurementInput,
): AnomalyMeasurement {
  if (input.predictions.length !== input.labels.length) {
    throw new RangeError(
      'measureAnomaly: predictions and labels must have equal length',
    );
  }
  if (input.predictions.length === 0) {
    throw new RangeError('measureAnomaly: empty cohort');
  }

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < input.predictions.length; i += 1) {
    const pred = input.predictions[i] === true;
    const label = input.labels[i] === true;
    if (pred && label) tp += 1;
    else if (pred && !label) fp += 1;
    else if (!pred && !label) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return Object.freeze({
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: clamp01(precision),
    recall: clamp01(recall),
    f1: clamp01(f1),
  });
}
