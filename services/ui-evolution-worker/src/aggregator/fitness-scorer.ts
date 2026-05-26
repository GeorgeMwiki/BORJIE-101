/**
 * Composite fitness scorer.
 *
 * Per the task brief, the score is a single value in [0..1] composed
 * of three weighted components:
 *
 *   score = 0.60 * completion_rate
 *         + 0.25 * (1 - error_rate)
 *         + 0.15 * (1 - max_field_abandonment_rate)
 *
 * The score by itself is informative; the categorical `decision`
 * comes from the §4 thresholds rather than from a score cutoff. The
 * scorer also emits the `failingSignals[]` (what tripped the improve
 * path) and `passingSignals[]` (what supports the lock path) so the
 * proposal generator can cite specific telemetry in its rationale.
 *
 * Thresholds (spec §4):
 *
 *   LOCK candidate:
 *     - completion_rate > 0.80
 *     - per-field error rate < 0.05 across the board
 *     - per-field abandonment < 0.10 across the board
 *
 *   IMPROVE candidate:
 *     - completion_rate < 0.50
 *     - any single field with error rate > 0.15
 *     - any single field with tooltip hit rate > 0.40
 *
 * If neither bucket fully matches, the decision is `neutral`. Note
 * that lock-candidate requires ALL three thresholds; improve-candidate
 * fires on ANY signal — failing closed in both directions.
 */

import type {
  FailingSignal,
  FitnessDecision,
  FitnessReport,
  RecipeMetrics,
} from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds (constants, exposed so tests + decision modules can
// reference the same numbers).
// ---------------------------------------------------------------------------

export const LOCK_COMPLETION_MIN = 0.8;
export const LOCK_FIELD_ERROR_MAX = 0.05;
export const LOCK_FIELD_ABANDONMENT_MAX = 0.1;

export const IMPROVE_COMPLETION_MAX = 0.5;
export const IMPROVE_FIELD_ERROR_MIN = 0.15;
export const IMPROVE_TOOLTIP_HIT_MIN = 0.4;

// Score weights — sum to 1.0.
export const SCORE_WEIGHT_COMPLETION = 0.6;
export const SCORE_WEIGHT_ERROR = 0.25;
export const SCORE_WEIGHT_ABANDONMENT = 0.15;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score one (recipe, version) and decide its policy bucket.
 *
 * `minRendersForDecision` gates trivial early-life recipes: until we
 * see enough render events, the decision is `neutral` regardless of
 * completion rate. Defaults to 10 so a single buggy render doesn't
 * fire an improvement proposal.
 */
export function scoreRecipe(
  metrics: RecipeMetrics,
  options: { readonly minRendersForDecision?: number } = {},
): FitnessReport {
  const minRenders = options.minRendersForDecision ?? 10;

  const score = computeScore(metrics);
  if (metrics.renderCount < minRenders) {
    return {
      tabRecipeId: metrics.tabRecipeId,
      tabRecipeVersion: metrics.tabRecipeVersion,
      score,
      decision: 'neutral',
      failingSignals: [],
      passingSignals: [],
      metrics,
    };
  }

  const failing = collectFailingSignals(metrics);
  const passing = collectPassingSignals(metrics);

  const decision = decideBucket({
    metrics,
    failing,
    passing,
  });

  return {
    tabRecipeId: metrics.tabRecipeId,
    tabRecipeVersion: metrics.tabRecipeVersion,
    score,
    decision,
    failingSignals: failing,
    passingSignals: passing,
    metrics,
  };
}

/**
 * The score function exposed for tests + telemetry. Returns a value
 * clamped into [0..1].
 */
export function computeScore(metrics: RecipeMetrics): number {
  const completionTerm =
    SCORE_WEIGHT_COMPLETION * clamp01(metrics.completionRate);
  const errorTerm =
    SCORE_WEIGHT_ERROR * clamp01(1 - metrics.errorRate);
  const abandonmentTerm =
    SCORE_WEIGHT_ABANDONMENT *
    clamp01(1 - metrics.maxFieldAbandonmentRate);
  return clamp01(completionTerm + errorTerm + abandonmentTerm);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectFailingSignals(
  metrics: RecipeMetrics,
): ReadonlyArray<FailingSignal> {
  const signals: FailingSignal[] = [];
  if (
    metrics.renderCount > 0 &&
    metrics.completionRate < IMPROVE_COMPLETION_MAX
  ) {
    signals.push({
      kind: 'low_completion',
      value: metrics.completionRate,
      threshold: IMPROVE_COMPLETION_MAX,
      humanReadable: `Completion rate ${pct(metrics.completionRate)} is below the ${pct(IMPROVE_COMPLETION_MAX)} improve threshold.`,
    });
  }
  for (const field of metrics.fields) {
    if (field.errorRate > IMPROVE_FIELD_ERROR_MIN) {
      signals.push({
        kind: 'high_field_error',
        fieldId: field.fieldId,
        value: field.errorRate,
        threshold: IMPROVE_FIELD_ERROR_MIN,
        humanReadable: `Field '${field.fieldId}' has ${pct(field.errorRate)} validation errors (threshold ${pct(IMPROVE_FIELD_ERROR_MIN)}).`,
      });
    }
    if (field.tooltipHitRate > IMPROVE_TOOLTIP_HIT_MIN) {
      signals.push({
        kind: 'high_tooltip_hit',
        fieldId: field.fieldId,
        value: field.tooltipHitRate,
        threshold: IMPROVE_TOOLTIP_HIT_MIN,
        humanReadable: `Field '${field.fieldId}' has ${pct(field.tooltipHitRate)} tooltip-hit rate — operators don't understand the field.`,
      });
    }
    // High abandonment is implicitly an improve signal too — it pushes
    // the field below the lock threshold AND tells the LLM where to
    // focus. Use the lock threshold as the trigger to avoid double-
    // counting against the completion signal.
    if (field.abandonmentRate > 0.25) {
      signals.push({
        kind: 'high_field_abandonment',
        fieldId: field.fieldId,
        value: field.abandonmentRate,
        threshold: 0.25,
        humanReadable: `Field '${field.fieldId}' is abandoned ${pct(field.abandonmentRate)} of the time.`,
      });
    }
  }
  return signals;
}

function collectPassingSignals(metrics: RecipeMetrics): ReadonlyArray<string> {
  const out: string[] = [];
  if (metrics.completionRate > LOCK_COMPLETION_MIN) {
    out.push(
      `Completion rate ${pct(metrics.completionRate)} > ${pct(LOCK_COMPLETION_MIN)} lock threshold.`,
    );
  }
  const allFieldsLowError = metrics.fields.every(
    (f) => f.errorRate < LOCK_FIELD_ERROR_MAX,
  );
  if (allFieldsLowError && metrics.fields.length > 0) {
    out.push(
      `All ${metrics.fields.length} fields under ${pct(LOCK_FIELD_ERROR_MAX)} error rate.`,
    );
  }
  const allFieldsLowAbandon = metrics.fields.every(
    (f) => f.abandonmentRate < LOCK_FIELD_ABANDONMENT_MAX,
  );
  if (allFieldsLowAbandon && metrics.fields.length > 0) {
    out.push(
      `All ${metrics.fields.length} fields under ${pct(LOCK_FIELD_ABANDONMENT_MAX)} abandonment rate.`,
    );
  }
  return out;
}

function decideBucket(args: {
  readonly metrics: RecipeMetrics;
  readonly failing: ReadonlyArray<FailingSignal>;
  readonly passing: ReadonlyArray<string>;
}): FitnessDecision {
  const { metrics, failing } = args;

  // Lock requires the FULL conjunction.
  const completionPassesLock = metrics.completionRate > LOCK_COMPLETION_MIN;
  const allFieldsErrorLowEnough = metrics.fields.every(
    (f) => f.errorRate < LOCK_FIELD_ERROR_MAX,
  );
  const allFieldsAbandonLowEnough = metrics.fields.every(
    (f) => f.abandonmentRate < LOCK_FIELD_ABANDONMENT_MAX,
  );
  const locks =
    completionPassesLock &&
    allFieldsErrorLowEnough &&
    allFieldsAbandonLowEnough &&
    // Need at least one field to lock — empty-field recipes (tab-only
    // events) are neutral.
    metrics.fields.length > 0;
  if (locks) return 'lock_candidate';

  // Improve fires on any signal.
  if (failing.length > 0) return 'improve_candidate';

  return 'neutral';
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pct(v: number): string {
  return `${Math.round(clamp01(v) * 100)}%`;
}
