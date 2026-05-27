/**
 * Mining-domain anomaly wrappers — Mr. Mwikila persona.
 *
 * Each wrapper picks the right detector for the operational signal
 * and shapes the result into an `AnomalyVerdict` ready to drop into
 * the `anomaly_detections` table.
 *
 * Domain logic ("fuel L/h", "ore tonnage", "check-in minutes",
 * "effective royalty rate", "RMS vibration mm/s") lives **only**
 * here — the detectors themselves know nothing about mining.
 *
 * The five wrappers below cover the five operational signals Mr.
 * Mwikila lists as his daily decision points (Docs/DESIGN/
 * ANOMALY_DETECTION_SOTA_2026.md §1):
 *
 *   1. fuelConsumptionSpike       — MAD + z-score ensemble per asset.
 *   2. weightBridgeDeviation      — z-score on pit/buyer ratio.
 *   3. workerCheckInMiss          — Page-Hinkley on clock-in deltas.
 *   4. royaltyFilingIrregularity  — MAD on per-quarter effective rate.
 *   5. equipmentVibrationOutlier  — Isolation Forest on accelerometer
 *                                   feature matrix.
 *
 * @module @borjie/anomaly-detection/domain/mining-anomalies
 */

import { detectMadAnomaly } from '../detectors/mad-threshold.js';
import { detectZScoreAnomaly } from '../detectors/zscore-threshold.js';
import {
  detectIsolationForestAnomalies,
  fitIsolationForest,
  scoreIsolationForest,
} from '../detectors/isolation-forest.js';
import { combineVotes } from '../ensemble/voting-ensemble.js';
import {
  createPageHinkleyState,
  updatePageHinkley,
  type PageHinkleyState,
} from '../drift/page-hinkley.js';
import type { AnomalyVerdict, PageHinkleyConfig } from '../types.js';

const NOW_ISO = (): string => new Date().toISOString();

// ──────────────────────────────────────────────────────────────────
// 1. Fuel consumption spike.
// ──────────────────────────────────────────────────────────────────

export interface FuelConsumptionInput {
  readonly tenantId: string;
  readonly assetId: string;
  readonly baseline: ReadonlyArray<number>; // historic L/h
  readonly current: number; // most-recent L/h
  readonly detectedAtIso?: string;
}

/**
 * Ensemble of MAD (robust to occasional past spikes) and z-score
 * (sensitive to a clean baseline). Majority of 2 = both must fire to
 * flag, which is the operationally-safe choice.
 */
export function fuelConsumptionSpike(input: FuelConsumptionInput): AnomalyVerdict {
  const mad = detectMadAnomaly(input.baseline, input.current);
  const z = detectZScoreAnomaly(input.baseline, input.current);
  const ensemble = combineVotes(
    [
      { detectorId: 'mad', score: mad },
      { detectorId: 'zscore', score: z },
    ],
    { mode: 'majority' },
  );
  return Object.freeze({
    tenantId: input.tenantId,
    detector: 'fuel-consumption-spike',
    target: `asset:${input.assetId}`,
    value: input.current,
    score: ensemble.combinedScore,
    threshold: ensemble.threshold,
    anomalous: ensemble.anomalous,
    evidence: Object.freeze({
      unit: 'L/h',
      baselineN: input.baseline.length,
      madScore: mad.score,
      madAnomalous: mad.anomalous,
      zScore: z.score,
      zAnomalous: z.anomalous,
      ensembleVotes: ensemble.votes,
    }),
    detectedAtIso: input.detectedAtIso ?? NOW_ISO(),
  });
}

// ──────────────────────────────────────────────────────────────────
// 2. Weight-bridge deviation.
// ──────────────────────────────────────────────────────────────────

export interface WeightBridgeInput {
  readonly tenantId: string;
  readonly truckId: string;
  /** Historic ratios buyer_weight / pit_weight, ideally ≈ 1. */
  readonly historicRatios: ReadonlyArray<number>;
  readonly pitWeight: number;
  readonly buyerWeight: number;
  readonly detectedAtIso?: string;
}

/**
 * Compute the (buyer / pit) ratio and z-score against historic
 * ratios. A ratio < 1 by more than the z-threshold means the buyer
 * is receiving less than the pit recorded — the operationally
 * dangerous direction.
 */
export function weightBridgeDeviation(
  input: WeightBridgeInput,
): AnomalyVerdict {
  if (input.pitWeight <= 0) {
    throw new Error('weightBridgeDeviation: pitWeight must be positive');
  }
  const ratio = input.buyerWeight / input.pitWeight;
  const z = detectZScoreAnomaly(input.historicRatios, ratio);
  return Object.freeze({
    tenantId: input.tenantId,
    detector: 'weight-bridge-deviation',
    target: `truck:${input.truckId}`,
    value: ratio,
    score: z.score,
    threshold: z.threshold,
    anomalous: z.anomalous,
    evidence: Object.freeze({
      unit: 'ratio',
      pitWeight: input.pitWeight,
      buyerWeight: input.buyerWeight,
      historicN: input.historicRatios.length,
    }),
    detectedAtIso: input.detectedAtIso ?? NOW_ISO(),
  });
}

// ──────────────────────────────────────────────────────────────────
// 3. Worker check-in miss.
// ──────────────────────────────────────────────────────────────────

export interface WorkerCheckInInput {
  readonly tenantId: string;
  readonly workerId: string;
  /** Daily deltas (minutes late) since e.g. start-of-quarter. */
  readonly deltas: ReadonlyArray<number>;
  readonly config?: PageHinkleyConfig;
  readonly detectedAtIso?: string;
}

/**
 * Run Page-Hinkley over the full delta series. If the cumulative
 * drift signal fires at any point, the most-recent delta is the one
 * that pushed it over — that's what we report.
 */
export function workerCheckInMiss(input: WorkerCheckInInput): AnomalyVerdict {
  if (input.deltas.length === 0) {
    throw new Error('workerCheckInMiss: deltas must be non-empty');
  }
  let state: PageHinkleyState = createPageHinkleyState(input.config ?? {});
  let lastStatistic = 0;
  let drifted = false;
  for (const d of input.deltas) {
    const step = updatePageHinkley(state, d);
    state = step.state;
    lastStatistic = step.signal.statistic;
    if (step.signal.driftDetected) drifted = true;
  }
  const lastValue = input.deltas[input.deltas.length - 1]!;
  return Object.freeze({
    tenantId: input.tenantId,
    detector: 'worker-check-in-miss',
    target: `worker:${input.workerId}`,
    value: lastValue,
    score: lastStatistic,
    threshold: state.threshold,
    anomalous: drifted,
    evidence: Object.freeze({
      unit: 'minutes',
      n: input.deltas.length,
      meanDelta: state.mean,
    }),
    detectedAtIso: input.detectedAtIso ?? NOW_ISO(),
  });
}

// ──────────────────────────────────────────────────────────────────
// 4. Royalty filing irregularity.
// ──────────────────────────────────────────────────────────────────

export interface RoyaltyFilingInput {
  readonly tenantId: string;
  readonly quarter: string; // e.g. '2026-Q2'
  readonly historicRates: ReadonlyArray<number>; // last N quarters
  readonly currentRate: number;
  readonly detectedAtIso?: string;
}

/**
 * MAD over historic effective rates — robust to one-off classification
 * changes that legitimately moved the rate.
 */
export function royaltyFilingIrregularity(
  input: RoyaltyFilingInput,
): AnomalyVerdict {
  const mad = detectMadAnomaly(input.historicRates, input.currentRate);
  return Object.freeze({
    tenantId: input.tenantId,
    detector: 'royalty-filing-irregularity',
    target: `quarter:${input.quarter}`,
    value: input.currentRate,
    score: mad.score,
    threshold: mad.threshold,
    anomalous: mad.anomalous,
    evidence: Object.freeze({
      unit: 'rate',
      historicN: input.historicRates.length,
    }),
    detectedAtIso: input.detectedAtIso ?? NOW_ISO(),
  });
}

// ──────────────────────────────────────────────────────────────────
// 5. Equipment vibration outlier.
// ──────────────────────────────────────────────────────────────────

export interface EquipmentVibrationInput {
  readonly tenantId: string;
  readonly equipmentId: string;
  /** Historic feature matrix — each row is [rms, peak, dominantFreq,
   *  harmonic1Amp, harmonic2Amp, ...]. */
  readonly historicFeatures: ReadonlyArray<ReadonlyArray<number>>;
  readonly currentFeatures: ReadonlyArray<number>;
  readonly detectedAtIso?: string;
  readonly seed?: number;
}

/**
 * Train iForest on `historicFeatures` and score the current reading.
 * The reported `value` is the dominant scalar feature (RMS — the
 * first column by convention).
 */
export function equipmentVibrationOutlier(
  input: EquipmentVibrationInput,
): AnomalyVerdict {
  if (input.historicFeatures.length === 0) {
    throw new Error('equipmentVibrationOutlier: historicFeatures empty');
  }
  const model = fitIsolationForest(input.historicFeatures, {
    nTrees: 100,
    psi: Math.min(256, input.historicFeatures.length),
    seed: input.seed ?? 1337,
  });
  const score = scoreIsolationForest(
    model,
    input.currentFeatures,
    input.currentFeatures[0]!,
  );
  return Object.freeze({
    tenantId: input.tenantId,
    detector: 'equipment-vibration-outlier',
    target: `equipment:${input.equipmentId}`,
    value: score.value,
    score: score.score,
    threshold: score.threshold,
    anomalous: score.anomalous,
    evidence: Object.freeze({
      unit: 'mm/s_RMS',
      historicN: input.historicFeatures.length,
      features: input.currentFeatures.length,
      forestPsi: model.psi,
    }),
    detectedAtIso: input.detectedAtIso ?? NOW_ISO(),
  });
}

// Re-exported helper for the rare case where a host wants the full
// batch scoring path directly.
export { detectIsolationForestAnomalies };
