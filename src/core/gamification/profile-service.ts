/**
 * Gamification System — Profile Service
 *
 * Aggregates all gamification data into a unified profile view.
 * Provides progress tracking toward next reward and tier.
 *
 * @module core/gamification/profile-service
 */

import type { GamificationProfile, NextRewardProgress } from "./types";
import { getBalance } from "./points-service";
import { getStreak } from "./streak-service";
import { getActivePrivileges } from "./reward-service";
import { getTierForPoints } from "./point-rules";
import { POINT_REWARDS } from "./reward-catalog";

// ============================================================================
// VALIDATION
// ============================================================================

function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required");
  }
}

// ============================================================================
// GET GAMIFICATION PROFILE
// ============================================================================

/**
 * Get the full gamification profile for a user.
 * Aggregates points, streaks, badges, certificates, privileges, and tier.
 */
export async function getGamificationProfile(
  userId: string,
): Promise<GamificationProfile> {
  validateUserId(userId);

  const [points, streak, privileges] = await Promise.all([
    getBalance(userId),
    getStreak(userId),
    getActivePrivileges(userId),
  ]);

  const tier = getTierForPoints(points.totalEarned);

  // Extract badge and certificate source IDs from privileges
  const badges: ReadonlyArray<string> = privileges
    .filter((p) => p.source === "badge")
    .map((p) => p.sourceId)
    .filter((id): id is string => id !== null);

  const certificates: ReadonlyArray<string> = privileges
    .filter((p) => p.source === "certificate")
    .map((p) => p.sourceId)
    .filter((id): id is string => id !== null);

  return {
    userId,
    points,
    streak,
    badges,
    certificates,
    privileges,
    tier,
  };
}

// ============================================================================
// GET PROGRESS TO NEXT REWARD
// ============================================================================

/**
 * Calculate progress toward the next affordable reward.
 * Returns the cheapest reward the user cannot yet afford,
 * along with points needed and percent complete.
 */
export async function getProgressToNextReward(
  userId: string,
): Promise<NextRewardProgress> {
  validateUserId(userId);

  const balance = await getBalance(userId);
  const currentPoints = balance.currentBalance;

  // Find cheapest reward user cannot yet afford
  const sortedRewards = [...POINT_REWARDS]
    .filter((r) => r.isActive)
    .sort((a, b) => a.pointsCost - b.pointsCost);

  const nextReward = sortedRewards.find((r) => r.pointsCost > currentPoints);

  if (!nextReward) {
    // User can afford all rewards
    const mostExpensive = sortedRewards[sortedRewards.length - 1] ?? null;
    return {
      nextReward: mostExpensive,
      pointsNeeded: 0,
      percentComplete: 100,
    };
  }

  const pointsNeeded = nextReward.pointsCost - currentPoints;
  const percentComplete =
    nextReward.pointsCost > 0
      ? Math.min(100, Math.round((currentPoints / nextReward.pointsCost) * 100))
      : 100;

  return {
    nextReward,
    pointsNeeded,
    percentComplete,
  };
}
