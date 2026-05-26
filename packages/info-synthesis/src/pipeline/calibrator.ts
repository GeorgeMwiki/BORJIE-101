/**
 * Pipeline stage 7 — calibrator.
 *
 * INFORMATION_SYNTHESIS_SOTA_SPEC §7: produces a CalibratedScore from
 * the pipeline's intermediate outputs. The calibrator never invents
 * confidence — it shrinks the raw "we have N high-quality clusters"
 * confidence by the disagreement count, source diversity, recency,
 * and corpus size.
 *
 * Inspired by the Brier-score and ECE-calibration literature
 * (see packages/calibration-monitor). The output is a calibrated
 * 0..1 confidence plus a 95% interval and the list of factor
 * adjustments that produced it — so the writer can footnote "why".
 *
 * Pure function. Deterministic. No I/O.
 */

import type {
  CalibratedScore,
  CalibrationFactor,
  Citation,
  Disagreement,
  ReconciledCluster,
} from '../types.js';

export interface CalibratorInput {
  readonly clusters: ReadonlyArray<ReconciledCluster>;
  readonly disagreements: ReadonlyArray<Disagreement>;
  readonly citations: ReadonlyArray<Citation>;
  /** Total number of chunks the pipeline ingested before clustering. */
  readonly chunkCount: number;
  /** Distinct source artifact count. */
  readonly sourceCount: number;
}

const BASELINE_CONFIDENCE = 0.5;
const PER_CLUSTER_BOOST = 0.05;
const PER_DISAGREEMENT_PENALTY = 0.08;
const SMALL_CORPUS_PENALTY_THRESHOLD = 3;
const SMALL_CORPUS_PENALTY = 0.15;
const SINGLE_SOURCE_PENALTY = 0.2;
const INTERVAL_HALFWIDTH_FLOOR = 0.05;
const INTERVAL_HALFWIDTH_PER_DISAGREEMENT = 0.04;

export function calibrate(input: CalibratorInput): CalibratedScore {
  const factors: CalibrationFactor[] = [];

  // Start from a baseline raw — average cluster avgScore weighted by
  // chunk count.
  const raw = computeRawConfidence(input.clusters);
  factors.push({
    name: 'raw_cluster_score',
    delta: raw - BASELINE_CONFIDENCE,
    description: `weighted-avg cluster score = ${raw.toFixed(3)}`,
  });

  let calibrated = raw;

  // + 0.05 per high-quality cluster (capped at 5).
  const highQualityClusters = input.clusters.filter(
    (c) => c.avgScore >= 0.6 && c.contradictions.length === 0,
  ).length;
  const clusterBoost = Math.min(5, highQualityClusters) * PER_CLUSTER_BOOST;
  calibrated += clusterBoost;
  if (clusterBoost > 0) {
    factors.push({
      name: 'high_quality_clusters',
      delta: clusterBoost,
      description: `${highQualityClusters} clusters with avgScore >= 0.6 and no contradictions`,
    });
  }

  // - 0.08 per detected disagreement (capped).
  const disagreementPenalty = Math.min(
    input.disagreements.length * PER_DISAGREEMENT_PENALTY,
    0.4,
  );
  calibrated -= disagreementPenalty;
  if (disagreementPenalty > 0) {
    factors.push({
      name: 'disagreements',
      delta: -disagreementPenalty,
      description: `${input.disagreements.length} disagreements surfaced`,
    });
  }

  // - 0.15 if corpus had < 3 chunks total.
  if (input.chunkCount < SMALL_CORPUS_PENALTY_THRESHOLD) {
    calibrated -= SMALL_CORPUS_PENALTY;
    factors.push({
      name: 'small_corpus',
      delta: -SMALL_CORPUS_PENALTY,
      description: `chunkCount = ${input.chunkCount} (< ${SMALL_CORPUS_PENALTY_THRESHOLD})`,
    });
  }

  // - 0.20 if only a single source artifact contributed.
  if (input.sourceCount <= 1) {
    calibrated -= SINGLE_SOURCE_PENALTY;
    factors.push({
      name: 'single_source',
      delta: -SINGLE_SOURCE_PENALTY,
      description: `only ${input.sourceCount} distinct source artifact(s)`,
    });
  }

  const finalCalibrated = clamp01(calibrated);
  const halfWidth = clamp01(
    INTERVAL_HALFWIDTH_FLOOR +
      input.disagreements.length * INTERVAL_HALFWIDTH_PER_DISAGREEMENT,
  );

  return Object.freeze({
    raw: round3(raw),
    calibrated: round3(finalCalibrated),
    interval: Object.freeze({
      lower: round3(clamp01(finalCalibrated - halfWidth)),
      upper: round3(clamp01(finalCalibrated + halfWidth)),
    }),
    factors: Object.freeze([...factors]),
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function computeRawConfidence(
  clusters: ReadonlyArray<ReconciledCluster>,
): number {
  if (clusters.length === 0) {
    return 0;
  }
  let totalWeight = 0;
  let weightedSum = 0;
  for (const c of clusters) {
    const weight = c.chunkIds.length;
    totalWeight += weight;
    weightedSum += c.avgScore * weight;
  }
  if (totalWeight === 0) {
    return 0;
  }
  return clamp01(weightedSum / totalWeight);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
