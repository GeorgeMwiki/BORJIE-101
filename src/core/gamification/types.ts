/**
 * Gamification System — Type Definitions
 *
 * Complete type system for points, streaks, leaderboards,
 * rewards, privileges, and gamification profiles.
 *
 * @module core/gamification/types
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type PointTransactionType = "earn" | "spend";

export type RewardType =
  | "feature_unlock"
  | "trial_extension"
  | "badge"
  | "certificate_boost";

export type PrivilegeSource = "points" | "badge" | "certificate" | "streak";

export type LeaderboardPeriod = "all_time" | "monthly" | "weekly";

export type GamificationTier =
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "DIAMOND";

export type PointAction =
  | "concept_mastery"
  | "quiz_perfect"
  | "lesson_complete"
  | "project_milestone"
  | "daily_login"
  | "streak_7_day"
  | "streak_30_day"
  | "streak_100_day"
  | "material_upload_a"
  | "material_upload_b"
  | "material_upload_c"
  | "document_upload"
  | "profile_complete"
  | "first_application"
  | "certificate_earned"
  | "certificate_expert"
  | "help_peer"
  | "feedback_given"
  | "review_5_star"
  | "referral_signup"
  | "group_session_complete"
  | "time_spent_30min";

// ============================================================================
// POINT TRANSACTION
// ============================================================================

export interface PointTransaction {
  readonly id: string;
  readonly userId: string;
  readonly amount: number;
  readonly type: PointTransactionType;
  readonly source: PointAction | string;
  readonly description: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
}

// ============================================================================
// POINT BALANCE
// ============================================================================

export interface PointBalance {
  readonly userId: string;
  readonly totalEarned: number;
  readonly totalSpent: number;
  readonly currentBalance: number;
}

// ============================================================================
// POINT EARNING RULE
// ============================================================================

export interface PointEarningRule {
  readonly action: PointAction;
  readonly points: number;
  readonly description: string;
  readonly cooldownMinutes: number;
  readonly dailyLimit: number;
}

// ============================================================================
// STREAK RECORD
// ============================================================================

export interface StreakRecord {
  readonly userId: string;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastActivityDate: string;
  readonly freezesAvailable: number;
  readonly freezesUsed: number;
}

// ============================================================================
// LEADERBOARD ENTRY
// ============================================================================

export interface LeaderboardEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly points: number;
  readonly rank: number;
  readonly badges: number;
  readonly streak: number;
}

// ============================================================================
// REWARD DEFINITION
// ============================================================================

export interface RewardDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly pointsCost: number;
  readonly rewardType: RewardType;
  readonly durationHours: number | null;
  readonly featureCode: string | null;
  readonly isActive: boolean;
}

// ============================================================================
// REWARD REDEMPTION
// ============================================================================

export interface RewardRedemption {
  readonly id: string;
  readonly userId: string;
  readonly rewardId: string;
  readonly redeemedAt: Date;
  readonly expiresAt: Date | null;
  readonly isActive: boolean;
}

// ============================================================================
// PRIVILEGE GRANT
// ============================================================================

export interface PrivilegeGrant {
  readonly id: string;
  readonly userId: string;
  readonly source: PrivilegeSource;
  readonly sourceId: string | null;
  readonly featureCode: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly isActive: boolean;
}

// ============================================================================
// GAMIFICATION PROFILE
// ============================================================================

export interface GamificationProfile {
  readonly userId: string;
  readonly points: PointBalance;
  readonly streak: StreakRecord;
  readonly badges: ReadonlyArray<string>;
  readonly certificates: ReadonlyArray<string>;
  readonly privileges: ReadonlyArray<PrivilegeGrant>;
  readonly tier: GamificationTier;
}

// ============================================================================
// STREAK MILESTONE
// ============================================================================

export interface StreakMilestone {
  readonly milestone: number;
  readonly bonusPoints: number;
  readonly action: PointAction;
}

// ============================================================================
// EARNING ELIGIBILITY
// ============================================================================

export interface EarningEligibility {
  readonly eligible: boolean;
  readonly reason: string;
  readonly cooldownRemaining: number;
}

// ============================================================================
// USER RANK
// ============================================================================

export interface UserRank {
  readonly rank: number;
  readonly total: number;
  readonly percentile: number;
}

// ============================================================================
// NEXT REWARD PROGRESS
// ============================================================================

export interface NextRewardProgress {
  readonly nextReward: RewardDefinition | null;
  readonly pointsNeeded: number;
  readonly percentComplete: number;
}

// ============================================================================
// TIER THRESHOLDS
// ============================================================================

export interface TierThreshold {
  readonly tier: GamificationTier;
  readonly minPoints: number;
}
