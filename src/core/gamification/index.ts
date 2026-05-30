/**
 * Gamification System — Module Index
 *
 * Complete gamification engine with points, streaks,
 * leaderboards, rewards, privileges, and profiles.
 *
 * @module core/gamification
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  PointTransaction,
  PointTransactionType,
  PointBalance,
  PointEarningRule,
  PointAction,
  StreakRecord,
  StreakMilestone,
  LeaderboardEntry,
  LeaderboardPeriod,
  RewardDefinition,
  RewardType,
  RewardRedemption,
  PrivilegeGrant,
  PrivilegeSource,
  GamificationProfile,
  GamificationTier,
  TierThreshold,
  EarningEligibility,
  UserRank,
  NextRewardProgress,
} from "./types";

// ============================================================================
// POINT RULES & CONSTANTS
// ============================================================================

export {
  POINT_EARNING_RULES,
  STREAK_MILESTONES,
  TIER_THRESHOLDS,
  getEarningRule,
  getTierForPoints,
  getNextTierThreshold,
  getStreakMilestone,
} from "./point-rules";

// ============================================================================
// POINTS SERVICE
// ============================================================================

export {
  awardPoints,
  spendPoints,
  getBalance,
  getTransactionHistory,
  checkEarningEligibility,
} from "./points-service";

// ============================================================================
// STREAK SERVICE
// ============================================================================

export {
  recordActivity,
  getStreak,
  useStreakFreeze,
  checkStreakMilestone,
  resetExpiredStreaks,
} from "./streak-service";

// ============================================================================
// LEADERBOARD SERVICE
// ============================================================================

export {
  getGlobalLeaderboard,
  getOrganizationLeaderboard,
  getUserRank,
  refreshLeaderboardCache,
} from "./leaderboard-service";

// ============================================================================
// REWARD CATALOG
// ============================================================================

export {
  POINT_REWARDS,
  BADGE_REWARDS,
  CERTIFICATE_REWARDS,
  FEATURE_CODES,
  getAllPointRewards,
  getRewardById,
  getRewardForBadge,
  getRewardForCertificate,
  getActiveRewards,
} from "./reward-catalog";

// ============================================================================
// REWARD & PRIVILEGE SERVICE
// ============================================================================

export {
  getAvailableRewards,
  redeemReward,
  getActivePrivileges,
  hasPrivilege,
  grantPrivilegeFromBadge,
  grantPrivilegeFromCertificate,
  cleanupExpiredPrivileges,
} from "./reward-service";

// ============================================================================
// PROFILE SERVICE
// ============================================================================

export {
  getGamificationProfile,
  getProgressToNextReward,
} from "./profile-service";

// ============================================================================
// STATS ASSEMBLER
// ============================================================================

export { assembleUserGamificationStats } from "./stats-assembler";
