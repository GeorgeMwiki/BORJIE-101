/**
 * Gamification System — Reward Catalog
 *
 * Static catalog of all available rewards with their
 * point costs, durations, and feature unlock codes.
 *
 * @module core/gamification/reward-catalog
 */

import type { RewardDefinition } from "./types";

// ============================================================================
// FEATURE CODES
// ============================================================================

export const FEATURE_CODES = {
  PREMIUM_ACCESS: "premium_access",
  LESSON_UNLOCK: "lesson_unlock",
  STREAK_FREEZE: "streak_freeze",
  API_ACCESS: "api_access",
} as const;

// ============================================================================
// POINT-BASED REWARDS
// ============================================================================

export const POINT_REWARDS: ReadonlyArray<RewardDefinition> = [
  {
    id: "reward_premium_24h",
    name: "24-Hour Premium Access",
    description: "Unlock all premium features for 24 hours",
    pointsCost: 500,
    rewardType: "trial_extension",
    durationHours: 24,
    featureCode: FEATURE_CODES.PREMIUM_ACCESS,
    isActive: true,
  },
  {
    id: "reward_premium_7d",
    name: "7-Day Premium Access",
    description: "Unlock all premium features for 7 days",
    pointsCost: 1000,
    rewardType: "trial_extension",
    durationHours: 168,
    featureCode: FEATURE_CODES.PREMIUM_ACCESS,
    isActive: true,
  },
  {
    id: "reward_lesson_unlock",
    name: "Extra Lesson Unlock",
    description: "Unlock 1 additional premium lesson",
    pointsCost: 250,
    rewardType: "feature_unlock",
    durationHours: null,
    featureCode: FEATURE_CODES.LESSON_UNLOCK,
    isActive: true,
  },
  {
    id: "reward_streak_freeze",
    name: "Streak Freeze",
    description: "Get 1 additional streak freeze to protect your streak",
    pointsCost: 100,
    rewardType: "feature_unlock",
    durationHours: null,
    featureCode: FEATURE_CODES.STREAK_FREEZE,
    isActive: true,
  },
] as const;

// ============================================================================
// BADGE-BASED REWARDS (auto-granted)
// ============================================================================

export const BADGE_REWARDS: ReadonlyArray<{
  readonly badgeId: string;
  readonly reward: RewardDefinition;
}> = [
  {
    badgeId: "badge_expert",
    reward: {
      id: "reward_expert_api",
      name: "Expert API Access",
      description: "Earn 7-day API access from your Expert badge",
      pointsCost: 0,
      rewardType: "feature_unlock",
      durationHours: 168,
      featureCode: FEATURE_CODES.API_ACCESS,
      isActive: true,
    },
  },
] as const;

// ============================================================================
// CERTIFICATE-BASED REWARDS (auto-granted)
// ============================================================================

export const CERTIFICATE_REWARDS: ReadonlyArray<{
  readonly certificateLevel: string;
  readonly reward: RewardDefinition;
}> = [
  {
    certificateLevel: "expert",
    reward: {
      id: "reward_cert_expert_premium",
      name: "Expert Certificate Premium",
      description: "Earn 14-day premium access from your Expert certificate",
      pointsCost: 0,
      rewardType: "certificate_boost",
      durationHours: 336,
      featureCode: FEATURE_CODES.PREMIUM_ACCESS,
      isActive: true,
    },
  },
  {
    certificateLevel: "advanced",
    reward: {
      id: "reward_cert_advanced_premium",
      name: "Advanced Certificate Premium",
      description: "Earn 7-day premium access from your Advanced certificate",
      pointsCost: 0,
      rewardType: "certificate_boost",
      durationHours: 168,
      featureCode: FEATURE_CODES.PREMIUM_ACCESS,
      isActive: true,
    },
  },
  {
    certificateLevel: "practitioner",
    reward: {
      id: "reward_cert_practitioner_premium",
      name: "Practitioner Certificate Premium",
      description:
        "Earn 3-day premium access from your Practitioner certificate",
      pointsCost: 0,
      rewardType: "certificate_boost",
      durationHours: 72,
      featureCode: FEATURE_CODES.PREMIUM_ACCESS,
      isActive: true,
    },
  },
] as const;

// ============================================================================
// CATALOG HELPERS
// ============================================================================

/**
 * Get all point-based rewards sorted by cost ascending.
 */
export function getAllPointRewards(): ReadonlyArray<RewardDefinition> {
  return [...POINT_REWARDS].sort((a, b) => a.pointsCost - b.pointsCost);
}

/**
 * Find a reward definition by its ID.
 */
export function getRewardById(rewardId: string): RewardDefinition | null {
  const allRewards: ReadonlyArray<RewardDefinition> = [
    ...POINT_REWARDS,
    ...BADGE_REWARDS.map((br) => br.reward),
    ...CERTIFICATE_REWARDS.map((cr) => cr.reward),
  ];

  return allRewards.find((r) => r.id === rewardId) ?? null;
}

/**
 * Find the reward associated with a badge.
 */
export function getRewardForBadge(badgeId: string): RewardDefinition | null {
  const match = BADGE_REWARDS.find((br) => br.badgeId === badgeId);
  return match?.reward ?? null;
}

/**
 * Find the reward associated with a certificate level.
 */
export function getRewardForCertificate(
  certificateLevel: string,
): RewardDefinition | null {
  const match = CERTIFICATE_REWARDS.find(
    (cr) => cr.certificateLevel === certificateLevel.toLowerCase(),
  );
  return match?.reward ?? null;
}

/**
 * Get all active rewards from the catalog.
 */
export function getActiveRewards(): ReadonlyArray<RewardDefinition> {
  const allRewards: ReadonlyArray<RewardDefinition> = [
    ...POINT_REWARDS,
    ...BADGE_REWARDS.map((br) => br.reward),
    ...CERTIFICATE_REWARDS.map((cr) => cr.reward),
  ];

  return allRewards.filter((r) => r.isActive);
}
