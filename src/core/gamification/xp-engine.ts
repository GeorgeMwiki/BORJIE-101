/**
 * Gamification Engine v2 — XP Calculation Engine
 *
 * Pure functional XP calculation with multiplier stacking:
 * - Streak bonus: +10% per 5 days, max 2x
 * - Difficulty bonus: basic 1x, medium 1.5x, pro 2x
 * - Speed bonus: under 10s = 1.3x, under 5s = 1.5x
 *
 * All functions are pure (no side effects, no mutation).
 * The awardXP pipeline orchestrates: calculate -> apply -> check achievements -> return.
 *
 * @module core/gamification/xp-engine
 */

import {
  XP_VALUES,
  type XPAction,
  type XPContext,
  type XPEvent,
  type XPAwardResult,
  type MultiplierBreakdown,
  type DifficultyLevel,
  type Achievement,
  type UserGamificationStats,
} from "./xp-types";
import { getRankForXP, getRankProgress } from "./rank-progression";
import { checkAchievements } from "./achievement-system";

// ============================================================================
// MULTIPLIER CONSTANTS
// ============================================================================

const STREAK_BONUS_PER_INTERVAL = 0.1;
const STREAK_INTERVAL_DAYS = 5;
const STREAK_MAX_MULTIPLIER = 2.0;
const STREAK_BASE_MULTIPLIER = 1.0;

const DIFFICULTY_MULTIPLIERS: Readonly<Record<DifficultyLevel, number>> = {
  basic: 1.0,
  medium: 1.5,
  pro: 2.0,
} as const;

const SPEED_THRESHOLD_FAST = 10;
const SPEED_THRESHOLD_ULTRA = 5;
const SPEED_BONUS_FAST = 1.3;
const SPEED_BONUS_ULTRA = 1.5;
const SPEED_DEFAULT_MULTIPLIER = 1.0;

const MIN_MULTIPLIER = 1.0;
const MAX_COMBINED_MULTIPLIER = 5.0;

// ============================================================================
// XP CALCULATION — PURE FUNCTIONS
// ============================================================================

/**
 * Calculate base XP points for a given action.
 * Returns the configured base value from XP_VALUES.
 */
export function calculateBaseXP(action: XPAction): number {
  const base = XP_VALUES[action];
  if (typeof base !== "number" || base <= 0) {
    throw new Error(`Unknown or invalid XP action: ${action}`);
  }
  return base;
}

/**
 * Calculate the streak multiplier based on consecutive active days.
 * Formula: 1.0 + (floor(days / 5) * 0.1), capped at 2.0
 *
 * Examples:
 *   0-4 days  -> 1.0x
 *   5-9 days  -> 1.1x
 *   10-14 days -> 1.2x
 *   50+ days  -> 2.0x (capped)
 */
export function calculateStreakMultiplier(streakDays: number): number {
  const safeDays = Math.max(0, Math.floor(streakDays));
  const intervals = Math.floor(safeDays / STREAK_INTERVAL_DAYS);
  const bonus = intervals * STREAK_BONUS_PER_INTERVAL;
  return Math.min(STREAK_BASE_MULTIPLIER + bonus, STREAK_MAX_MULTIPLIER);
}

/**
 * Calculate the difficulty multiplier.
 * basic = 1x, medium = 1.5x, pro = 2x
 */
export function calculateDifficultyMultiplier(
  difficulty?: DifficultyLevel,
): number {
  if (!difficulty) {
    return MIN_MULTIPLIER;
  }
  return DIFFICULTY_MULTIPLIERS[difficulty] ?? MIN_MULTIPLIER;
}

/**
 * Calculate speed bonus multiplier based on response time.
 * Under 5s = 1.5x, under 10s = 1.3x, otherwise 1.0x
 */
export function calculateSpeedMultiplier(timeSeconds?: number): number {
  if (timeSeconds === undefined || timeSeconds === null || timeSeconds <= 0) {
    return SPEED_DEFAULT_MULTIPLIER;
  }

  if (timeSeconds <= SPEED_THRESHOLD_ULTRA) {
    return SPEED_BONUS_ULTRA;
  }

  if (timeSeconds <= SPEED_THRESHOLD_FAST) {
    return SPEED_BONUS_FAST;
  }

  return SPEED_DEFAULT_MULTIPLIER;
}

/**
 * Apply all multipliers to base XP and return the breakdown.
 * Combined multiplier = streak * difficulty * speed, capped at 5.0x
 *
 * All multipliers are multiplicative (not additive) for rewarding
 * learners who combine multiple engagement factors.
 */
export function applyMultipliers(
  basePoints: number,
  streakDays?: number,
  difficulty?: DifficultyLevel,
  timeSeconds?: number,
): MultiplierBreakdown {
  const streakMultiplier = calculateStreakMultiplier(streakDays ?? 0);
  const difficultyMultiplier = calculateDifficultyMultiplier(difficulty);
  const speedMultiplier = calculateSpeedMultiplier(timeSeconds);

  const rawCombined = streakMultiplier * difficultyMultiplier * speedMultiplier;
  const combinedMultiplier = Math.min(rawCombined, MAX_COMBINED_MULTIPLIER);

  return {
    streakMultiplier,
    difficultyMultiplier,
    speedMultiplier,
    combinedMultiplier,
  };
}

/**
 * Calculate total XP for an action with full context.
 * Returns the final integer XP value after all multipliers.
 */
export function calculateXP(action: XPAction, context: XPContext): number {
  const base = calculateBaseXP(action);

  const { combinedMultiplier } = applyMultipliers(
    base,
    context.streakDays,
    context.difficulty,
    context.timeSeconds,
  );

  return Math.round(base * combinedMultiplier);
}

/**
 * Get the level number from a total XP value.
 */
export function getLevelFromXP(totalXP: number): number {
  return getRankForXP(totalXP).level;
}

/**
 * Get the percentage progress toward the next rank.
 */
export function getProgressToNextLevel(totalXP: number): number {
  const progress = getRankProgress(totalXP);
  return progress.percentToNextRank;
}

// ============================================================================
// XP AWARD PIPELINE
// ============================================================================

/**
 * Full XP award pipeline: calculate -> check rank -> check achievements -> return result.
 *
 * This is the primary entry point for awarding XP. It:
 * 1. Calculates base XP + multipliers
 * 2. Determines if the user leveled up
 * 3. Checks for newly unlocked achievements
 * 4. Returns a comprehensive result object
 *
 * Pure function: does not persist anything. The caller is responsible
 * for saving the result to the database.
 */
export function awardXP(
  userId: string,
  action: XPAction,
  context: XPContext,
  currentTotalXP: number,
  currentAchievements: ReadonlyArray<Achievement>,
  stats: UserGamificationStats,
): XPAwardResult {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required");
  }

  const base = calculateBaseXP(action);

  const multiplierBreakdown = applyMultipliers(
    base,
    context.streakDays,
    context.difficulty,
    context.timeSeconds,
  );

  const totalPoints = Math.round(base * multiplierBreakdown.combinedMultiplier);
  const newTotalXP = currentTotalXP + totalPoints;

  const previousRank = getRankForXP(currentTotalXP);
  const currentRank = getRankForXP(newTotalXP);
  const leveledUp = currentRank.level > previousRank.level;

  const event: XPEvent = {
    userId,
    action,
    points: totalPoints,
    conceptId: context.conceptId,
    timestamp: new Date(),
    multiplier: multiplierBreakdown.combinedMultiplier,
  };

  const newAchievements = checkAchievements(
    userId,
    event,
    currentAchievements,
    stats,
  );

  return {
    basePoints: base,
    multiplier: multiplierBreakdown.combinedMultiplier,
    totalPoints,
    newTotalXP,
    leveledUp,
    previousRank,
    currentRank,
    newAchievements,
    event,
  };
}

// ============================================================================
// XP PROJECTION UTILITIES
// ============================================================================

/**
 * Project how many actions of a given type are needed to reach a target XP.
 * Useful for showing "X more quizzes to reach next rank" messages.
 */
export function projectActionsToTarget(
  action: XPAction,
  currentXP: number,
  targetXP: number,
  context: XPContext,
): number {
  if (currentXP >= targetXP) {
    return 0;
  }

  const xpPerAction = calculateXP(action, context);
  if (xpPerAction <= 0) {
    return Infinity;
  }

  return Math.ceil((targetXP - currentXP) / xpPerAction);
}

/**
 * Estimate XP earned per session based on typical activity patterns.
 * Useful for projecting rank-up timelines.
 */
export function estimateSessionXP(
  averageQuizzes: number,
  averageCorrectRate: number,
  streakDays: number,
  difficulty: DifficultyLevel,
): number {
  const quizCorrectXP = calculateXP("quiz_correct", {
    streakDays,
    difficulty,
  });
  const sessionXP = calculateBaseXP("session_completed");

  const correctQuizzes = Math.round(averageQuizzes * averageCorrectRate);
  const quizXP = correctQuizzes * quizCorrectXP;

  return quizXP + sessionXP;
}
