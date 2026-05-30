/**
 * Gamification System — Point Earning Rules
 *
 * Defines all point earning rules with their amounts,
 * cooldowns, daily limits, and descriptions.
 *
 * @module core/gamification/point-rules
 */

import type {
  PointAction,
  PointEarningRule,
  TierThreshold,
  StreakMilestone,
} from "./types";

// ============================================================================
// POINT EARNING RULES
// ============================================================================

export const POINT_EARNING_RULES: Readonly<
  Record<PointAction, PointEarningRule>
> = {
  concept_mastery: {
    action: "concept_mastery",
    points: 10,
    description: "Master a learning concept",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  quiz_perfect: {
    action: "quiz_perfect",
    points: 15,
    description: "Achieve a perfect quiz score",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  lesson_complete: {
    action: "lesson_complete",
    points: 5,
    description: "Complete a lesson module",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  project_milestone: {
    action: "project_milestone",
    points: 25,
    description: "Reach a project milestone",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  daily_login: {
    action: "daily_login",
    points: 2,
    description: "Log in for the day",
    cooldownMinutes: 1440,
    dailyLimit: 1,
  },
  streak_7_day: {
    action: "streak_7_day",
    points: 50,
    description: "Maintain a 7-day activity streak",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  streak_30_day: {
    action: "streak_30_day",
    points: 200,
    description: "Maintain a 30-day activity streak",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  streak_100_day: {
    action: "streak_100_day",
    points: 1000,
    description: "Maintain a 100-day activity streak",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  material_upload_a: {
    action: "material_upload_a",
    points: 50,
    description: "Upload grade-A material for community",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  material_upload_b: {
    action: "material_upload_b",
    points: 25,
    description: "Upload grade-B material for community",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  material_upload_c: {
    action: "material_upload_c",
    points: 10,
    description: "Upload grade-C material for community",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  document_upload: {
    action: "document_upload",
    points: 5,
    description: "Upload a supporting document",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  profile_complete: {
    action: "profile_complete",
    points: 20,
    description: "Complete your user profile",
    cooldownMinutes: 0,
    dailyLimit: 1,
  },
  first_application: {
    action: "first_application",
    points: 30,
    description: "Submit your first loan application",
    cooldownMinutes: 0,
    dailyLimit: 1,
  },
  certificate_earned: {
    action: "certificate_earned",
    points: 100,
    description: "Earn a course certificate",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  certificate_expert: {
    action: "certificate_expert",
    points: 250,
    description: "Earn an expert-level certificate",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  help_peer: {
    action: "help_peer",
    points: 15,
    description: "Help a peer learner",
    cooldownMinutes: 30,
    dailyLimit: 5,
  },
  feedback_given: {
    action: "feedback_given",
    points: 5,
    description: "Provide feedback on learning content",
    cooldownMinutes: 10,
    dailyLimit: 10,
  },
  review_5_star: {
    action: "review_5_star",
    points: 10,
    description: "Receive a 5-star review from a peer",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  referral_signup: {
    action: "referral_signup",
    points: 100,
    description: "Refer a new user who signs up",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  group_session_complete: {
    action: "group_session_complete",
    points: 20,
    description: "Complete a group learning session",
    cooldownMinutes: 0,
    dailyLimit: 0,
  },
  time_spent_30min: {
    action: "time_spent_30min",
    points: 3,
    description: "Spend 30 minutes learning on the platform",
    cooldownMinutes: 30,
    dailyLimit: 5,
  },
} as const;

// ============================================================================
// STREAK MILESTONES
// ============================================================================

export const STREAK_MILESTONES: ReadonlyArray<StreakMilestone> = [
  { milestone: 7, bonusPoints: 50, action: "streak_7_day" },
  { milestone: 30, bonusPoints: 200, action: "streak_30_day" },
  { milestone: 100, bonusPoints: 1000, action: "streak_100_day" },
] as const;

// ============================================================================
// TIER THRESHOLDS
// ============================================================================

export const TIER_THRESHOLDS: ReadonlyArray<TierThreshold> = [
  { tier: "DIAMOND", minPoints: 10000 },
  { tier: "PLATINUM", minPoints: 5000 },
  { tier: "GOLD", minPoints: 2000 },
  { tier: "SILVER", minPoints: 500 },
  { tier: "BRONZE", minPoints: 0 },
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the point earning rule for a given action.
 * Throws if the action is not recognized.
 */
export function getEarningRule(action: PointAction): PointEarningRule {
  const rule = POINT_EARNING_RULES[action];
  if (!rule) {
    throw new Error(`Unknown point action: ${action}`);
  }
  return rule;
}

/**
 * Determine the gamification tier for a given total earned points.
 */
export function getTierForPoints(
  totalEarned: number,
): import("./types").GamificationTier {
  for (const threshold of TIER_THRESHOLDS) {
    if (totalEarned >= threshold.minPoints) {
      return threshold.tier;
    }
  }
  return "BRONZE";
}

/**
 * Get the next tier threshold above the user's current points.
 * Returns null if already at the highest tier.
 */
export function getNextTierThreshold(
  totalEarned: number,
): TierThreshold | null {
  const sorted = [...TIER_THRESHOLDS].sort((a, b) => a.minPoints - b.minPoints);
  for (const threshold of sorted) {
    if (totalEarned < threshold.minPoints) {
      return threshold;
    }
  }
  return null;
}

/**
 * Check if a streak value matches any milestone.
 */
export function getStreakMilestone(streakDays: number): StreakMilestone | null {
  const match = STREAK_MILESTONES.find((m) => m.milestone === streakDays);
  return match ?? null;
}
