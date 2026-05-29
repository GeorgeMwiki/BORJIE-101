/**
 * Recommendation measurer — reduces top-K click-feedback observations
 * to the three capability-catalogue axes.
 *
 * Spec §3.6 of Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * Competence : top-K hit rate — for each call, was any of the top-K
 *              recommendations clicked within the feedback window?
 *              Cohort competence rate = hits / cohort.
 *              Cremonesi, Koren & Turrin, "Performance of recommender
 *              algorithms on top-n recommendation tasks", ACM RecSys
 *              2010. https://dl.acm.org/doi/10.1145/1864708.1864721
 *
 * Calibration: reliability-diagram check — bucket the predicted
 *              click-probability score into 10 equally-spaced buckets,
 *              compute the average predicted score and average empirical
 *              click rate per bucket, return the bucket-weighted
 *              mean absolute deviation (also known as the Expected
 *              Calibration Error). DeGroot & Fienberg, "The Comparison
 *              and Evaluation of Forecasters", The Statistician 32
 *              (1983): 12–22. https://www.jstor.org/stable/2987588
 *
 * Utility    : conversion / dismissal rate. `accepted` / `modified`
 *              ⇒ 1 ; `rejected` / `ignored` ⇒ 0.
 *
 * @module @borjie/intel-self-improve/measure/recommendation-measurer
 */

import type {
  ObservedOutcome,
  UserFollowthrough,
} from '@borjie/capability-catalogue';

// ---------------------------------------------------------------------------
// Per-call observation
// ---------------------------------------------------------------------------

export interface RecommendationObservation {
  readonly topK: ReadonlyArray<string>;
  readonly clickedItemIds: ReadonlyArray<string>;
  readonly predictedScoresByItemId: Readonly<Record<string, number>>;
  readonly userFollowthrough: UserFollowthrough;
}

// ---------------------------------------------------------------------------
// Aggregate output
// ---------------------------------------------------------------------------

export interface RecommendationMeasurementResult {
  readonly competenceRate: number;
  readonly calibrationError: number;
  readonly utilityRate: number;
  readonly nObservations: number;
  readonly hitCount: number;
  readonly expectedCalibrationError: number;
}

const BUCKET_COUNT = 10;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function measureRecommendations(
  observations: ReadonlyArray<RecommendationObservation>,
): RecommendationMeasurementResult {
  if (observations.length === 0) {
    throw new RangeError('measureRecommendations: empty observations cohort');
  }

  let hitCount = 0;
  let utilityCount = 0;

  // Reliability-diagram buckets — equal-width over [0, 1].
  const bucketTotals = new Array<number>(BUCKET_COUNT).fill(0);
  const bucketClicks = new Array<number>(BUCKET_COUNT).fill(0);
  const bucketSumPred = new Array<number>(BUCKET_COUNT).fill(0);

  for (const obs of observations) {
    const clicked = new Set(obs.clickedItemIds);
    const topSet = new Set(obs.topK);
    const anyTopClick = [...clicked].some((id) => topSet.has(id));
    if (anyTopClick) hitCount += 1;

    for (const itemId of obs.topK) {
      const raw = obs.predictedScoresByItemId[itemId];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const score = clamp01(raw);
      const bucket = Math.min(
        BUCKET_COUNT - 1,
        Math.max(0, Math.floor(score * BUCKET_COUNT)),
      );
      const total = bucketTotals[bucket] ?? 0;
      bucketTotals[bucket] = total + 1;
      const sumPred = bucketSumPred[bucket] ?? 0;
      bucketSumPred[bucket] = sumPred + score;
      if (clicked.has(itemId)) {
        const clicks = bucketClicks[bucket] ?? 0;
        bucketClicks[bucket] = clicks + 1;
      }
    }

    if (
      obs.userFollowthrough === 'accepted' ||
      obs.userFollowthrough === 'modified'
    ) {
      utilityCount += 1;
    }
  }

  let totalItems = 0;
  for (const n of bucketTotals) totalItems += n;
  let ece = 0;
  if (totalItems > 0) {
    for (let b = 0; b < BUCKET_COUNT; b += 1) {
      const n = bucketTotals[b] ?? 0;
      if (n === 0) continue;
      const sumPred = bucketSumPred[b] ?? 0;
      const clicks = bucketClicks[b] ?? 0;
      const meanPred = sumPred / n;
      const meanClick = clicks / n;
      ece += (n / totalItems) * Math.abs(meanPred - meanClick);
    }
  }

  return Object.freeze({
    competenceRate: clamp01(hitCount / observations.length),
    calibrationError: clamp01(ece),
    utilityRate: clamp01(utilityCount / observations.length),
    nObservations: observations.length,
    hitCount,
    expectedCalibrationError: clamp01(ece),
  });
}

// ---------------------------------------------------------------------------
// Per-call top-K hit measurement
// ---------------------------------------------------------------------------

export interface RecommendationMeasurementInput {
  readonly recommended: ReadonlyArray<string>;
  readonly clicked: ReadonlyArray<string>;
  readonly k: number;
}

export interface RecommendationMeasurement {
  readonly hit: boolean;
  readonly hitRate: number;
  readonly competence: number;
  readonly observedOutcome: ObservedOutcome;
}

/**
 * Per-call recommendation measurement — was at least one of the
 * top-K recommended items clicked? Returns the boolean hit, the
 * per-call hit rate (clicked-in-top-K / K), the competence reward,
 * and the `ObservedOutcome` enum.
 *
 * `recommended` is truncated to the top `k` items; trailing items
 * beyond `k` are not consulted. Empty `recommended` is treated as
 * a deterministic miss (hit=false, rate=0).
 */
export function measureRecommendation(
  input: RecommendationMeasurementInput,
): RecommendationMeasurement {
  if (!Number.isInteger(input.k) || input.k <= 0) {
    throw new RangeError('measureRecommendation: k must be a positive integer');
  }
  const topK = input.recommended.slice(0, input.k);
  const clicked = new Set(input.clicked);
  let hitCount = 0;
  for (const item of topK) if (clicked.has(item)) hitCount += 1;
  const hit = hitCount > 0;
  const rate = topK.length === 0 ? 0 : hitCount / input.k;
  return Object.freeze({
    hit,
    hitRate: rate,
    competence: hit ? 1 : 0,
    observedOutcome: hit ? 'confirmed' : 'disconfirmed',
  });
}

// ---------------------------------------------------------------------------
// Cohort summary for per-call measurements
// ---------------------------------------------------------------------------

export interface RecommendationCohortSummary {
  readonly n: number;
  readonly hitCount: number;
  readonly hitFraction: number;
}

/**
 * Summarise a cohort of per-call measurements. `hitFraction` is the
 * share of cohort items that had at least one top-K click.
 */
export function summariseRecommendationCohort(
  measurements: ReadonlyArray<RecommendationMeasurement>,
): RecommendationCohortSummary {
  if (measurements.length === 0) {
    throw new RangeError(
      'summariseRecommendationCohort: empty measurements cohort',
    );
  }
  let hits = 0;
  for (const m of measurements) if (m.hit) hits += 1;
  return Object.freeze({
    n: measurements.length,
    hitCount: hits,
    hitFraction: hits / measurements.length,
  });
}
