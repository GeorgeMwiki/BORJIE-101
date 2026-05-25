/**
 * Judge-score + confidence histogram registration (D6).
 *
 * Exposes two OTel histograms keyed off the global meter so all
 * services that emit judge / confidence telemetry can route through a
 * single registry. The histograms are 0..1 valued (matching how the
 * judge and the confidence scorer normalise their outputs) and use
 * fixed quality-tier buckets so Grafana panels can render the same
 * shape regardless of which service produced the sample.
 *
 *   - `judge_score_seconds`        — buckets 0.1 / 0.25 / 0.5 / 0.75 / 0.9
 *   - `confidence_overall_seconds` — same bucket layout
 *
 * Naming note: we keep the `_seconds` suffix per Prometheus
 * convention for histogram base names so the `_bucket`, `_sum`, and
 * `_count` time-series sit in the obvious place when scraped. The
 * "unit" is a normalised 0..1 score, NOT seconds — the suffix is
 * cosmetic and matches the established BORJIE convention for
 * histogram metric names.
 */

import { type Histogram, type Meter } from '@opentelemetry/api';
import { getMeter } from './metrics.js';

/** Fixed bucket layout for both judge and confidence histograms. */
export const JUDGE_CONFIDENCE_BUCKETS: ReadonlyArray<number> = [
  0.1, 0.25, 0.5, 0.75, 0.9,
] as const;

const METER_NAME = '@borjie/observability/judge-confidence';

/**
 * Lazily-built histogram registry. Histograms in OTel are
 * idempotent at the meter level — re-asking for the same name returns
 * the same instrument — but we cache the handle anyway so callers
 * don't pay the lookup cost on every observe.
 */
interface HistogramRegistry {
  readonly meter: Meter;
  readonly judgeScore: Histogram;
  readonly confidenceOverall: Histogram;
}

let registry: HistogramRegistry | null = null;

/**
 * Register (or fetch) the judge-score + confidence histograms.
 *
 * The OTel JS API doesn't currently expose `advisory.explicitBucketBoundaries`
 * on the public `createHistogram` overload across every SDK build — when
 * we move to a build that DOES expose it we'll pass {@link JUDGE_CONFIDENCE_BUCKETS}
 * here. Until then the constants are still exported so dashboards +
 * alert rules can reference identical bucket boundaries.
 */
export function registerJudgeConfidenceHistograms(): HistogramRegistry {
  if (registry) return registry;
  const meter = getMeter(METER_NAME, '0.1.0');
  const judgeScore = meter.createHistogram('judge_score_seconds', {
    description:
      'Self-review judge score (0..1). Low values mean the judge flagged the draft for regen.',
    unit: 'ratio',
  });
  const confidenceOverall = meter.createHistogram(
    'confidence_overall_seconds',
    {
      description:
        'Aggregate confidence score (0..1) from kernel scoreConfidence — combines groundedness, stability, review, numerical consistency.',
      unit: 'ratio',
    },
  );
  registry = { meter, judgeScore, confidenceOverall };
  return registry;
}

/**
 * Reset the cached registry — exported for test isolation only. Do
 * NOT call from production code paths.
 */
export function __resetJudgeConfidenceHistogramRegistryForTests(): void {
  registry = null;
}

/**
 * Record a single judge score sample.
 *
 * @param score   Normalised score in [0,1]. Out-of-range values are
 *                clamped before observation so a noisy upstream judge
 *                can't poison the histogram.
 * @param labels  Optional label set (e.g. `{ agent, stakes }`).
 */
export function recordJudgeScore(
  score: number,
  labels: Record<string, string> = {},
): void {
  const reg = registerJudgeConfidenceHistograms();
  const clamped = clampZeroOne(score);
  reg.judgeScore.record(clamped, labels);
}

/**
 * Record a single confidence sample.
 *
 * @param overall  Normalised overall confidence in [0,1].
 * @param labels   Optional label set.
 */
export function recordConfidenceOverall(
  overall: number,
  labels: Record<string, string> = {},
): void {
  const reg = registerJudgeConfidenceHistograms();
  const clamped = clampZeroOne(overall);
  reg.confidenceOverall.record(clamped, labels);
}

const clampZeroOne = (n: number): number => {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

/**
 * Direct handle access for advanced callers (e.g. a test harness that
 * wants to attach a custom view or aggregator). Most callers should
 * use {@link recordJudgeScore} / {@link recordConfidenceOverall}.
 */
export function getJudgeConfidenceHistograms(): {
  readonly judgeScore: Histogram;
  readonly confidenceOverall: Histogram;
} {
  const reg = registerJudgeConfidenceHistograms();
  return {
    judgeScore: reg.judgeScore,
    confidenceOverall: reg.confidenceOverall,
  };
}
