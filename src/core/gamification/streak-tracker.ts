/**
 * Gamification Engine v2 — Streak Tracker
 *
 * Pure functional streak management with immutable state transitions.
 * Handles daily and weekly streaks, freeze mechanics, bonus calculation,
 * and streak status detection.
 *
 * Complements the existing streak-service.ts (DB-backed) by providing
 * pure calculation functions that can be used without database access.
 *
 * @module core/gamification/streak-tracker
 */

import type {
  LearningStreak,
  StreakStatus,
  StreakType,
  StreakHistoryEntry,
} from "./xp-types";

// ============================================================================
// CONSTANTS
// ============================================================================

const MS_PER_DAY = 86_400_000;
const DAILY_STREAK_GAP_LIMIT = 1;
const WEEKLY_STREAK_GAP_LIMIT = 7;
const DEFAULT_FREEZES = 2;
const MAX_HISTORY_ENTRIES = 20;

const STREAK_BONUS_INTERVAL = 5;
const STREAK_BONUS_PER_INTERVAL = 0.1;
const STREAK_MAX_MULTIPLIER = 2.0;
const STREAK_BASE_MULTIPLIER = 1.0;

// ============================================================================
// DEFAULT STREAK
// ============================================================================

export function createDefaultStreak(
  userId: string,
  streakType: StreakType = "daily",
): LearningStreak {
  return {
    userId,
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: "",
    streakType,
    freezesRemaining: DEFAULT_FREEZES,
    totalFreezesBurned: 0,
    streakHistory: [],
  };
}

// ============================================================================
// DATE HELPERS (pure)
// ============================================================================

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

function daysBetweenDates(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00Z").getTime();
  const b = new Date(dateB + "T00:00:00Z").getTime();
  return Math.abs(Math.round((b - a) / MS_PER_DAY));
}

// ============================================================================
// STREAK UPDATE — CORE LOGIC
// ============================================================================

/**
 * Update a streak based on a new activity date.
 * Returns a new LearningStreak (immutable, never mutates input).
 *
 * Logic:
 * - Same day as last activity: no change
 * - Consecutive day (or within weekly gap for weekly streaks): extend
 * - Missed by exactly 1 extra day + has freeze: extend + burn freeze
 * - Otherwise: break streak, record history, reset to 1
 */
export function updateStreak(
  current: LearningStreak,
  activityDate: Date,
): LearningStreak {
  const today = toDateString(activityDate);

  // Already recorded today
  if (current.lastActivityDate === today) {
    return current;
  }

  // First ever activity
  if (current.lastActivityDate === "") {
    return {
      ...current,
      currentStreak: 1,
      longestStreak: Math.max(current.longestStreak, 1),
      lastActivityDate: today,
    };
  }

  const gap = daysBetweenDates(current.lastActivityDate, today);
  const gapLimit =
    current.streakType === "daily"
      ? DAILY_STREAK_GAP_LIMIT
      : WEEKLY_STREAK_GAP_LIMIT;

  // Consecutive day (within type limit)
  if (gap <= gapLimit) {
    const newStreak = current.currentStreak + 1;
    return {
      ...current,
      currentStreak: newStreak,
      longestStreak: Math.max(current.longestStreak, newStreak),
      lastActivityDate: today,
    };
  }

  // Missed by exactly one extra gap unit, but has a freeze available
  if (gap === gapLimit + 1 && current.freezesRemaining > 0) {
    const newStreak = current.currentStreak + 1;
    return {
      ...current,
      currentStreak: newStreak,
      longestStreak: Math.max(current.longestStreak, newStreak),
      lastActivityDate: today,
      freezesRemaining: current.freezesRemaining - 1,
      totalFreezesBurned: current.totalFreezesBurned + 1,
    };
  }

  // Streak broken: record in history and reset
  const historyEntry: StreakHistoryEntry = {
    startDate: computeStreakStartDate(
      current.lastActivityDate,
      current.currentStreak,
      current.streakType,
    ),
    endDate: current.lastActivityDate,
    length: current.currentStreak,
    brokenReason:
      gap > gapLimit + 1 ? `Missed ${gap} days` : "No freeze available",
  };

  const updatedHistory =
    current.currentStreak > 0
      ? [...current.streakHistory, historyEntry].slice(-MAX_HISTORY_ENTRIES)
      : [...current.streakHistory];

  return {
    ...current,
    currentStreak: 1,
    lastActivityDate: today,
    streakHistory: updatedHistory,
  };
}

// ============================================================================
// STREAK FREEZE MANAGEMENT
// ============================================================================

/**
 * Check if a streak freeze can be used to save the current streak.
 * Returns true if the streak is at risk and a freeze is available.
 */
export function checkStreakFreeze(streak: LearningStreak): boolean {
  if (streak.freezesRemaining <= 0) {
    return false;
  }

  const status = getStreakStatus(streak);
  return status === "at_risk";
}

/**
 * Manually apply a streak freeze to protect the streak.
 * Returns a new LearningStreak with one fewer freeze.
 */
export function applyStreakFreeze(
  streak: LearningStreak,
  currentDate: Date,
): LearningStreak {
  if (streak.freezesRemaining <= 0) {
    throw new Error("No streak freezes available");
  }

  if (getStreakStatus(streak, currentDate) !== "at_risk") {
    throw new Error("Streak is not at risk; freeze not needed");
  }

  return {
    ...streak,
    lastActivityDate: toDateString(currentDate),
    freezesRemaining: streak.freezesRemaining - 1,
    totalFreezesBurned: streak.totalFreezesBurned + 1,
  };
}

/**
 * Add a freeze to the streak (e.g., purchased via reward redemption).
 */
export function addStreakFreeze(
  streak: LearningStreak,
  count: number = 1,
): LearningStreak {
  if (count < 1 || !Number.isInteger(count)) {
    throw new Error("Freeze count must be a positive integer");
  }

  return {
    ...streak,
    freezesRemaining: streak.freezesRemaining + count,
  };
}

// ============================================================================
// STREAK BONUS CALCULATION
// ============================================================================

/**
 * Calculate the XP multiplier bonus from the current streak.
 * Formula: 1.0 + (floor(days / 5) * 0.1), max 2.0
 */
export function calculateStreakBonus(streakDays: number): number {
  const safeDays = Math.max(0, Math.floor(streakDays));
  const intervals = Math.floor(safeDays / STREAK_BONUS_INTERVAL);
  const bonus = intervals * STREAK_BONUS_PER_INTERVAL;
  return Math.min(STREAK_BASE_MULTIPLIER + bonus, STREAK_MAX_MULTIPLIER);
}

// ============================================================================
// STREAK STATUS
// ============================================================================

/**
 * Determine the current status of a streak.
 *
 * - 'active': activity recorded today or within the allowed gap
 * - 'at_risk': one more missed day will break the streak (freeze can save)
 * - 'broken': streak has expired (no freeze, gap exceeded)
 */
export function getStreakStatus(
  streak: LearningStreak,
  referenceDate?: Date,
): StreakStatus {
  if (streak.currentStreak === 0 || streak.lastActivityDate === "") {
    return "broken";
  }

  const today = toDateString(referenceDate ?? new Date());
  const gap = daysBetweenDates(streak.lastActivityDate, today);
  const gapLimit =
    streak.streakType === "daily"
      ? DAILY_STREAK_GAP_LIMIT
      : WEEKLY_STREAK_GAP_LIMIT;

  if (gap <= gapLimit) {
    return "active";
  }

  if (gap === gapLimit + 1 && streak.freezesRemaining > 0) {
    return "at_risk";
  }

  return "broken";
}

// ============================================================================
// STREAK RESET
// ============================================================================

/**
 * Reset a streak while preserving the history.
 * Returns a new LearningStreak with currentStreak = 0 and history updated.
 */
export function resetStreak(streak: LearningStreak): LearningStreak {
  if (streak.currentStreak === 0) {
    return streak;
  }

  const historyEntry: StreakHistoryEntry = {
    startDate: computeStreakStartDate(
      streak.lastActivityDate,
      streak.currentStreak,
      streak.streakType,
    ),
    endDate: streak.lastActivityDate,
    length: streak.currentStreak,
    brokenReason: "Manual reset",
  };

  return {
    ...streak,
    currentStreak: 0,
    lastActivityDate: streak.lastActivityDate,
    streakHistory: [...streak.streakHistory, historyEntry].slice(
      -MAX_HISTORY_ENTRIES,
    ),
  };
}

// ============================================================================
// STREAK STATISTICS
// ============================================================================

/**
 * Get a human-readable summary of the streak for display.
 */
export function getStreakSummary(
  streak: LearningStreak,
  language: "en" | "sw" = "en",
): string {
  const status = getStreakStatus(streak);

  if (language === "sw") {
    if (status === "broken") {
      return "Mfululizo umevunjika. Anza tena leo!";
    }
    if (status === "at_risk") {
      return `Mfululizo wa siku ${streak.currentStreak} uko hatarini! Jifunze leo.`;
    }
    return `Mfululizo wa siku ${streak.currentStreak}. Endelea hivyo!`;
  }

  if (status === "broken") {
    return "Streak broken. Start a new one today!";
  }
  if (status === "at_risk") {
    return `${streak.currentStreak}-day streak is at risk! Learn today to save it.`;
  }
  return `${streak.currentStreak}-day streak. Keep it up!`;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function computeStreakStartDate(
  lastDate: string,
  streakLength: number,
  streakType: StreakType,
): string {
  const multiplier = streakType === "daily" ? 1 : 7;
  const offsetDays = (streakLength - 1) * multiplier;
  const lastMs = new Date(lastDate + "T00:00:00Z").getTime();
  const startMs = lastMs - offsetDays * MS_PER_DAY;
  return toDateString(new Date(startMs));
}
