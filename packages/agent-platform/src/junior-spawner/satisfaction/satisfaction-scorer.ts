/**
 * Per-turn satisfaction scorer (Wave 18V-DYNAMIC).
 *
 * Maps the upstream feedback signal (`FeedbackKind`) to a normalised
 * 0..1 satisfaction score and rolls per-junior averages over a
 * sliding window of recent feedback rows.
 *
 * Pure functions only — the scorer is consumed by the lifecycle
 * worker (no I/O here).
 */

import type {
  FeedbackKind,
  JuniorTurnFeedbackRecord,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Per-signal mapping
// ─────────────────────────────────────────────────────────────────────

const FEEDBACK_KIND_TO_SCORE: Record<FeedbackKind, number> = Object.freeze({
  explicit_positive: 1.0,
  explicit_negative: 0.0,
  implicit_completed: 0.7,
  implicit_abandoned: 0.2,
});

/**
 * Map a single feedback kind to a normalised score in [0, 1].
 * If the row already carries an explicit `satisfaction_score`, that
 * value wins — the per-kind table is the fallback.
 */
export function scoreFeedbackRow(record: JuniorTurnFeedbackRecord): number {
  if (record.satisfaction_score !== null) {
    return clamp01(record.satisfaction_score);
  }
  return FEEDBACK_KIND_TO_SCORE[record.feedback_kind];
}

// ─────────────────────────────────────────────────────────────────────
// Rolling average
// ─────────────────────────────────────────────────────────────────────

/**
 * Average satisfaction across `rows`. Returns null when the
 * collection is empty so the caller can distinguish "no signal" from
 * "zero satisfaction".
 */
export function rollingSatisfaction(
  rows: ReadonlyArray<JuniorTurnFeedbackRecord>,
): number | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((acc, row) => acc + scoreFeedbackRow(row), 0);
  return total / rows.length;
}

/**
 * Convenience: window the rows to the last `days` and roll average.
 */
export function rollingSatisfactionLastN(
  rows: ReadonlyArray<JuniorTurnFeedbackRecord>,
  days: number,
  now: Date,
): number | null {
  const cutoff_ms = now.getTime() - days * 86_400_000;
  const windowed = rows.filter(
    (row) => row.recorded_at.getTime() >= cutoff_ms,
  );
  return rollingSatisfaction(windowed);
}

// ─────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
