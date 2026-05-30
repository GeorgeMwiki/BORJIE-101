/**
 * Gamification System — Streak Service
 *
 * Manages daily activity streaks, streak freezes,
 * milestone detection, and expired streak cleanup.
 *
 * @module core/gamification/streak-service
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { StreakRecord, StreakMilestone } from "./types";
import { STREAK_MILESTONES } from "./point-rules";
import { awardPoints } from "./points-service";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_FREEZES_AVAILABLE = 2;

const DEFAULT_STREAK: Omit<StreakRecord, "userId"> = {
  currentStreak: 0,
  longestStreak: 0,
  lastActivityDate: "",
  freezesAvailable: DEFAULT_FREEZES_AVAILABLE,
  freezesUsed: 0,
};

// ============================================================================
// VALIDATION
// ============================================================================

function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required");
  }
}

// ============================================================================
// DATE HELPERS
// ============================================================================

function getUTCDateString(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 86400000;
  const a = new Date(dateA + "T00:00:00Z").getTime();
  const b = new Date(dateB + "T00:00:00Z").getTime();
  return Math.abs(Math.round((b - a) / msPerDay));
}

// ============================================================================
// RECORD ACTIVITY
// ============================================================================

/**
 * Record a daily activity for streak tracking.
 * Extends or resets the streak based on the last activity date.
 * Awards milestone bonuses when applicable.
 *
 * @returns Updated StreakRecord (immutable)
 */
export async function recordActivity(userId: string): Promise<StreakRecord> {
  validateUserId(userId);

  const current = await getStreak(userId);
  const today = getUTCDateString();

  // Already recorded today — no change
  if (current.lastActivityDate === today) {
    return current;
  }

  const supabase = createServiceClient();
  let updatedStreak: StreakRecord;

  if (current.lastActivityDate === "") {
    // First activity ever
    updatedStreak = {
      ...current,
      userId,
      currentStreak: 1,
      longestStreak: 1,
      lastActivityDate: today,
    };
  } else {
    const gap = daysBetween(current.lastActivityDate, today);

    if (gap === 1) {
      // Consecutive day — extend streak
      const newCurrent = current.currentStreak + 1;
      const newLongest = Math.max(current.longestStreak, newCurrent);
      updatedStreak = {
        ...current,
        currentStreak: newCurrent,
        longestStreak: newLongest,
        lastActivityDate: today,
      };
    } else if (gap === 2 && current.freezesAvailable > 0) {
      // Missed exactly one day but have a freeze — auto-apply
      const newCurrent = current.currentStreak + 1;
      const newLongest = Math.max(current.longestStreak, newCurrent);
      updatedStreak = {
        ...current,
        currentStreak: newCurrent,
        longestStreak: newLongest,
        lastActivityDate: today,
        freezesAvailable: current.freezesAvailable - 1,
        freezesUsed: current.freezesUsed + 1,
      };
    } else {
      // Streak broken — reset
      updatedStreak = {
        ...current,
        currentStreak: 1,
        lastActivityDate: today,
      };
    }
  }

  const { error } = await supabase.from("streak_records").upsert(
    {
      user_id: userId,
      current_streak: updatedStreak.currentStreak,
      longest_streak: updatedStreak.longestStreak,
      last_activity_date: updatedStreak.lastActivityDate,
      freezes_available: updatedStreak.freezesAvailable,
      freezes_used: updatedStreak.freezesUsed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Failed to update streak: ${error.message}`);
  }

  // Check and award milestone bonuses
  const matchedMilestone = STREAK_MILESTONES.find(
    (m) => m.milestone === updatedStreak.currentStreak,
  );
  if (matchedMilestone) {
    try {
      await awardPoints(userId, matchedMilestone.action, {
        milestone: matchedMilestone.milestone,
        streakDays: updatedStreak.currentStreak,
      });
    } catch {
      // Milestone bonus already awarded or ineligible — not a fatal error
    }
  }

  return updatedStreak;
}

// ============================================================================
// GET STREAK
// ============================================================================

/**
 * Get the current streak record for a user.
 * Returns a default zero streak if no record exists.
 */
export async function getStreak(userId: string): Promise<StreakRecord> {
  validateUserId(userId);

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("streak_records")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch streak: ${error.message}`);
  }

  if (!data) {
    return { userId, ...DEFAULT_STREAK };
  }

  return {
    userId: data.user_id,
    currentStreak: data.current_streak ?? 0,
    longestStreak: data.longest_streak ?? 0,
    lastActivityDate: data.last_activity_date ?? "",
    freezesAvailable: data.freezes_available ?? DEFAULT_FREEZES_AVAILABLE,
    freezesUsed: data.freezes_used ?? 0,
  };
}

// ============================================================================
// USE STREAK FREEZE
// ============================================================================

/**
 * Manually use a streak freeze to protect the current streak.
 * Decrements available freezes and increments used count.
 *
 * @returns Updated StreakRecord (immutable)
 */
export async function useStreakFreeze(userId: string): Promise<StreakRecord> {
  validateUserId(userId);

  const current = await getStreak(userId);

  if (current.freezesAvailable <= 0) {
    throw new Error("No streak freezes available");
  }

  const updatedStreak: StreakRecord = {
    ...current,
    freezesAvailable: current.freezesAvailable - 1,
    freezesUsed: current.freezesUsed + 1,
  };

  const supabase = createServiceClient();

  const { error } = await supabase.from("streak_records").upsert(
    {
      user_id: userId,
      current_streak: updatedStreak.currentStreak,
      longest_streak: updatedStreak.longestStreak,
      last_activity_date: updatedStreak.lastActivityDate,
      freezes_available: updatedStreak.freezesAvailable,
      freezes_used: updatedStreak.freezesUsed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Failed to use streak freeze: ${error.message}`);
  }

  return updatedStreak;
}

// ============================================================================
// CHECK STREAK MILESTONE
// ============================================================================

/**
 * Check if the user's current streak matches any milestone.
 * Returns the milestone details and bonus points, or null.
 */
export async function checkStreakMilestone(
  userId: string,
): Promise<{ milestone: number; bonusPoints: number } | null> {
  validateUserId(userId);

  const streak = await getStreak(userId);

  const matchedMilestone: StreakMilestone | undefined = STREAK_MILESTONES.find(
    (m) => m.milestone === streak.currentStreak,
  );

  if (!matchedMilestone) {
    return null;
  }

  return {
    milestone: matchedMilestone.milestone,
    bonusPoints: matchedMilestone.bonusPoints,
  };
}

// ============================================================================
// RESET EXPIRED STREAKS (CRON HELPER)
// ============================================================================

/**
 * Reset streaks that have expired (more than 1 day of inactivity
 * without a freeze). Designed to be called from a daily cron job.
 *
 * @returns Number of streaks reset
 */
export async function resetExpiredStreaks(): Promise<number> {
  const supabase = createServiceClient();
  const yesterday = getUTCDateString(new Date(Date.now() - 86400000));

  // Find active streaks where last activity was before yesterday
  const { data: expired, error: fetchError } = await supabase
    .from("streak_records")
    .select("user_id, current_streak, last_activity_date, freezes_available")
    .gt("current_streak", 0)
    .lt("last_activity_date", yesterday);

  if (fetchError) {
    throw new Error(`Failed to fetch expired streaks: ${fetchError.message}`);
  }

  if (!expired || expired.length === 0) {
    return 0;
  }

  let resetCount = 0;

  for (const record of expired) {
    const gap = daysBetween(record.last_activity_date, getUTCDateString());

    // Only reset if gap is more than 2 days, or gap is 2 and no freezes
    if (gap > 2 || (gap === 2 && record.freezes_available <= 0)) {
      const { error: updateError } = await supabase
        .from("streak_records")
        .update({
          current_streak: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", record.user_id);

      if (!updateError) {
        resetCount += 1;
      }
    }
  }

  return resetCount;
}
