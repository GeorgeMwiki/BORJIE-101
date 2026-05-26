/**
 * Priority scorer — impact × urgency × user-attention.
 *
 * Pure function. Same inputs → same output. The scorer is the
 * arbiter that ranks candidates queued by the six different
 * trigger sources (§3 of the spec) onto a single comparable scale.
 *
 * Formula (spec §5):
 *
 *   raw = 0.45·impact + 0.35·urgency + 0.20·attention - 0.10·fatigue
 *   priority = sigmoid(raw)
 *
 * No I/O; no dependencies; safe to call from any tier.
 */

import type { FollowupPriority, ScoringInput } from '../types.js';

/** Impact weight in the raw combiner. */
export const IMPACT_WEIGHT = 0.45;
/** Urgency weight in the raw combiner. */
export const URGENCY_WEIGHT = 0.35;
/** Attention weight in the raw combiner. */
export const ATTENTION_WEIGHT = 0.2;
/** Fatigue penalty per repeat-this-week, capped at 3 incidents. */
export const FATIGUE_PER_REPEAT = 0.1;
/** Repeats this week at which the penalty caps out. */
export const FATIGUE_CAP_REPEATS = 3;

/** Items without a deadline default to a moderate urgency. */
export const NO_DEADLINE_URGENCY = 0.3;
/** Urgency saturates at zero days remaining (deadline today). */
export const URGENCY_WINDOW_DAYS = 30;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Convert `days_until_deadline` (which may be null) to an urgency
 * score in [0, 1]. Negative days (already overdue) saturate at 1.
 */
export function computeUrgency(daysUntilDeadline: number | null): number {
  if (daysUntilDeadline === null) return NO_DEADLINE_URGENCY;
  if (daysUntilDeadline <= 0) return 1;
  const raw = 1 - daysUntilDeadline / URGENCY_WINDOW_DAYS;
  return clamp01(raw);
}

/**
 * Convert `repeat_count_this_week` (>= 0) to a fatigue penalty in
 * [0, 0.3]. The penalty caps at 3 repeats so the scorer cannot
 * push the priority arbitrarily low.
 */
export function computeFatigue(repeatCountThisWeek: number): number {
  if (repeatCountThisWeek <= 0) return 0;
  const capped = Math.min(repeatCountThisWeek, FATIGUE_CAP_REPEATS);
  return capped * FATIGUE_PER_REPEAT;
}

/**
 * Score a candidate. Returns a deterministic FollowupPriority in
 * [0, 1]. Sigmoid keeps the output bounded even when the raw
 * combiner spills outside [0, 1].
 */
export function scoreCandidate(input: ScoringInput): FollowupPriority {
  const impact = clamp01(input.impact_score);
  const urgency = computeUrgency(input.days_until_deadline);
  const attention = clamp01(input.attention_score);
  const fatigue = computeFatigue(input.repeat_count_this_week);

  const raw =
    IMPACT_WEIGHT * impact +
    URGENCY_WEIGHT * urgency +
    ATTENTION_WEIGHT * attention -
    fatigue;

  // We map raw ∈ [-0.3, 1.0] through a centered sigmoid so the
  // mid-of-range raw value (≈ 0.35) lands at priority ≈ 0.59.
  const centered = (raw - 0.35) * 6;
  return clamp01(sigmoid(centered));
}

/**
 * Helper: a candidate is `critical` when the urgency-only score
 * dominates regardless of impact / attention / fatigue. Spec §13
 * mandates regulator items at T-3 or sooner bypass the daily cap.
 */
export function isCriticalDeadline(
  daysUntilDeadline: number | null,
): boolean {
  if (daysUntilDeadline === null) return false;
  return daysUntilDeadline <= 3;
}
