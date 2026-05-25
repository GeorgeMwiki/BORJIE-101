/**
 * mastery-policy — boundary definitions + ordering helpers.
 *
 * Why split this from the tracker? The thresholds are policy: product
 * tunes them as we learn what "good" engagement looks like. The
 * tracker is mechanism: it counts. Keeping policy isolated means
 * tweaks land in one file and every consumer (gate, hook, tooltip)
 * re-reads them through the same exported helpers.
 *
 * Boundary semantics: the upper bound of one level is the lower bound
 * of the next (strict less-than-or-equal at top, strict greater-than
 * at bottom). The tests in `mastery-tracker.test.ts` lock the
 * 10/11, 50/51, 200/201 transitions.
 */

import type { MasteryLevel } from './types.js';

export interface MasteryThreshold {
  readonly level: MasteryLevel;
  /** Inclusive upper bound on the weighted action count. */
  readonly maxWeightedActions: number;
}

/**
 * Levels in ascending difficulty. Order is load-bearing: anything that
 * compares levels uses indexOf against this list, so duplicated or
 * re-ordered entries would silently break gating.
 */
export const MASTERY_LEVELS: ReadonlyArray<MasteryLevel> = [
  'novice',
  'intermediate',
  'expert',
  'power-user',
];

/**
 * Thresholds — total weighted actions a user must accumulate to stay
 * at (or above) each tier. The final tier uses `Number.POSITIVE_INFINITY`
 * to express "no upper bound".
 *
 *   novice         0–10    weighted actions
 *   intermediate   11–50
 *   expert         51–200
 *   power-user     201+
 */
export const MASTERY_THRESHOLDS: ReadonlyArray<MasteryThreshold> = [
  { level: 'novice', maxWeightedActions: 10 },
  { level: 'intermediate', maxWeightedActions: 50 },
  { level: 'expert', maxWeightedActions: 200 },
  { level: 'power-user', maxWeightedActions: Number.POSITIVE_INFINITY },
];

/**
 * Classify a weighted action count into a mastery level. The function
 * is deterministic and pure — used by both the tracker and tests.
 */
export function levelFromWeightedActions(
  weightedActions: number,
): MasteryLevel {
  if (!Number.isFinite(weightedActions) || weightedActions < 0) {
    return 'novice';
  }
  for (const threshold of MASTERY_THRESHOLDS) {
    if (weightedActions <= threshold.maxWeightedActions) {
      return threshold.level;
    }
  }
  // Unreachable while the last threshold is +Infinity, but keeps the
  // type checker happy without a non-null assertion.
  return 'power-user';
}

/**
 * Returns the next level above `level`, or null when already at the
 * top. Pure ordering operation — does NOT consult the threshold table.
 */
export function nextLevelAbove(level: MasteryLevel): MasteryLevel | null {
  const idx = MASTERY_LEVELS.indexOf(level);
  if (idx === -1 || idx >= MASTERY_LEVELS.length - 1) {
    return null;
  }
  return MASTERY_LEVELS[idx + 1] ?? null;
}

/**
 * Number of weighted actions needed to advance from `level` to the
 * next tier — i.e. the upper bound of `level` + 1. Returns null when
 * already at the highest tier.
 */
export function nextThresholdAbove(level: MasteryLevel): number | null {
  if (level === 'power-user') return null;
  const threshold = MASTERY_THRESHOLDS.find((t) => t.level === level);
  if (!threshold) return null;
  return threshold.maxWeightedActions + 1;
}

/**
 * Returns -1 / 0 / 1 if `a` is below / equal-to / above `b`. Centralised
 * so gating logic does not depend on the array layout.
 */
export function compareLevels(a: MasteryLevel, b: MasteryLevel): number {
  const ai = MASTERY_LEVELS.indexOf(a);
  const bi = MASTERY_LEVELS.indexOf(b);
  if (ai === bi) return 0;
  return ai < bi ? -1 : 1;
}

/** "At-least" predicate — true if `actual` ≥ `required`. */
export function isLevelAtLeast(
  actual: MasteryLevel,
  required: MasteryLevel,
): boolean {
  return compareLevels(actual, required) >= 0;
}
