/**
 * user-mastery public barrel.
 *
 * Anything outside this directory imports from here, not from the
 * individual files — that way internal moves (e.g. splitting the
 * tracker) do not break consumers.
 */

export type {
  MasteryLevel,
  MasteryScore,
  UserActionEvent,
  UserActionRecord,
  UserActionStore,
} from './types.js';

export {
  MASTERY_LEVELS,
  MASTERY_THRESHOLDS,
  levelFromWeightedActions,
  nextLevelAbove,
  nextThresholdAbove,
  compareLevels,
  isLevelAtLeast,
  type MasteryThreshold,
} from './mastery-policy.js';

export {
  computeMasteryScore,
  computeRecencyWeight,
  loadMasteryScore,
  recordUserAction,
  MIN_RECENCY_WEIGHT,
  RECENT_WINDOW_MS,
  STALE_WINDOW_MS,
  type ComputeOptions,
} from './mastery-tracker.js';
