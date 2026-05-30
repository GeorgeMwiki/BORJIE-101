/**
 * Gamification Engine v2 — Extended Type Definitions
 *
 * Complete type system for XP-based gamification with multipliers,
 * achievements, Tanzanian-themed ranks, daily challenges, and
 * learning journey tracking. Extends the existing gamification types.
 *
 * Research basis: Gamification effect size g=0.822 (large).
 *
 * @module core/gamification/xp-types
 */

// ============================================================================
// XP ACTIONS
// ============================================================================

export type XPAction =
  | "quiz_correct"
  | "quiz_perfect"
  | "concept_mastered"
  | "streak_maintained"
  | "challenge_completed"
  | "peer_helped"
  | "review_completed"
  | "first_attempt_correct"
  | "speed_bonus"
  | "difficulty_bonus"
  | "session_completed"
  | "milestone_reached"
  | "simulation_profit"
  | "debate_participated";

// ============================================================================
// XP POINT VALUES (configurable base points)
// ============================================================================

export const XP_VALUES: Readonly<Record<XPAction, number>> = {
  quiz_correct: 10,
  quiz_perfect: 50,
  concept_mastered: 100,
  streak_maintained: 15,
  challenge_completed: 75,
  peer_helped: 30,
  review_completed: 20,
  first_attempt_correct: 25,
  speed_bonus: 15,
  difficulty_bonus: 20,
  session_completed: 10,
  milestone_reached: 200,
  simulation_profit: 40,
  debate_participated: 35,
} as const;

// ============================================================================
// XP EVENT
// ============================================================================

export interface XPEvent {
  readonly userId: string;
  readonly action: XPAction;
  readonly points: number;
  readonly conceptId?: string;
  readonly timestamp: Date;
  readonly multiplier?: number;
}

// ============================================================================
// XP CONTEXT (for multiplier calculation)
// ============================================================================

export interface XPContext {
  readonly streakDays?: number;
  readonly difficulty?: DifficultyLevel;
  readonly timeSeconds?: number;
  readonly conceptId?: string;
  readonly isFirstAttempt?: boolean;
  readonly sessionId?: string;
}

export type DifficultyLevel = "basic" | "medium" | "pro";

// ============================================================================
// XP AWARD RESULT
// ============================================================================

export interface XPAwardResult {
  readonly basePoints: number;
  readonly multiplier: number;
  readonly totalPoints: number;
  readonly newTotalXP: number;
  readonly leveledUp: boolean;
  readonly previousRank: LearnerRank;
  readonly currentRank: LearnerRank;
  readonly newAchievements: ReadonlyArray<Achievement>;
  readonly event: XPEvent;
}

// ============================================================================
// MULTIPLIER BREAKDOWN
// ============================================================================

export interface MultiplierBreakdown {
  readonly streakMultiplier: number;
  readonly difficultyMultiplier: number;
  readonly speedMultiplier: number;
  readonly combinedMultiplier: number;
}

// ============================================================================
// LEARNING STREAK (extended)
// ============================================================================

export interface LearningStreak {
  readonly userId: string;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastActivityDate: string;
  readonly streakType: StreakType;
  readonly freezesRemaining: number;
  readonly totalFreezesBurned: number;
  readonly streakHistory: ReadonlyArray<StreakHistoryEntry>;
}

export type StreakType = "daily" | "weekly";

export type StreakStatus = "active" | "at_risk" | "broken";

export interface StreakHistoryEntry {
  readonly startDate: string;
  readonly endDate: string;
  readonly length: number;
  readonly brokenReason?: string;
}

// ============================================================================
// ACHIEVEMENTS
// ============================================================================

export interface Achievement {
  readonly id: string;
  readonly name: string;
  readonly nameSw: string;
  readonly description: string;
  readonly descriptionSw: string;
  readonly icon: string;
  readonly category: AchievementCategory;
  readonly requirement: AchievementRequirement;
  readonly rarity: AchievementRarity;
  readonly xpReward: number;
  readonly unlockedAt?: Date;
}

export type AchievementCategory =
  | "learning"
  | "mastery"
  | "consistency"
  | "social"
  | "speed"
  | "exploration"
  | "financial"
  | "simulation";

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export interface AchievementRequirement {
  readonly type: AchievementRequirementType;
  readonly metric: string;
  readonly threshold: number;
  readonly conditions?: ReadonlyArray<AchievementRequirement>;
}

export type AchievementRequirementType =
  | "count"
  | "streak"
  | "score"
  | "time"
  | "compound";

export interface AchievementProgress {
  readonly achievementId: string;
  readonly currentValue: number;
  readonly targetValue: number;
  readonly percentComplete: number;
  readonly isUnlocked: boolean;
}

// ============================================================================
// LEARNER RANKS (Tanzanian themed)
// ============================================================================

export interface LearnerRank {
  readonly level: number;
  readonly name: string;
  readonly nameSw: string;
  readonly minXP: number;
  readonly maxXP: number;
  readonly icon: string;
  readonly perks: ReadonlyArray<string>;
}

export interface RankProgress {
  readonly currentRank: LearnerRank;
  readonly nextRank: LearnerRank | null;
  readonly currentXP: number;
  readonly xpInCurrentRank: number;
  readonly xpNeededForNext: number;
  readonly percentToNextRank: number;
}

// ============================================================================
// DAILY / WEEKLY CHALLENGES
// ============================================================================

export interface DailyChallenge {
  readonly id: string;
  readonly title: string;
  readonly titleSw: string;
  readonly description: string;
  readonly descriptionSw: string;
  readonly type: ChallengeType;
  readonly target: number;
  readonly xpReward: number;
  readonly timeLimit?: number;
  readonly expiresAt: Date;
  readonly progress?: number;
  readonly isCompleted?: boolean;
}

export type ChallengeType =
  | "quiz_streak"
  | "concept_explore"
  | "speed_round"
  | "teach_peer"
  | "review_blitz"
  | "simulation_run"
  | "perfect_score";

export interface ChallengeCompletionResult {
  readonly challengeId: string;
  readonly completed: boolean;
  readonly currentProgress: number;
  readonly target: number;
  readonly xpAwarded: number;
}

// ============================================================================
// LEADERBOARD (extended)
// ============================================================================

export interface XPLeaderboardEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly rank: number;
  readonly xpTotal: number;
  readonly level: number;
  readonly streak: number;
  readonly achievementCount: number;
}

// ============================================================================
// LEARNING JOURNEY (unified profile)
// ============================================================================

export interface LearningJourney {
  readonly userId: string;
  readonly totalXP: number;
  readonly currentRank: LearnerRank;
  readonly nextRank: LearnerRank | null;
  readonly progressToNextRank: number;
  readonly achievements: ReadonlyArray<Achievement>;
  readonly activeStreak: LearningStreak;
  readonly activeChallenges: ReadonlyArray<DailyChallenge>;
  readonly completedChallenges: number;
  readonly stats: JourneyStats;
}

export interface JourneyStats {
  readonly totalSessions: number;
  readonly totalQuizzes: number;
  readonly perfectScores: number;
  readonly conceptsMastered: number;
  readonly fastestQuiz: number;
  readonly longestStreak: number;
}

// ============================================================================
// USER GAMIFICATION STATS (for achievement checking)
// ============================================================================

export interface UserGamificationStats {
  readonly userId: string;
  readonly totalQuizzes: number;
  readonly perfectScores: number;
  readonly conceptsMastered: number;
  readonly proMasteries: number;
  readonly totalSessions: number;
  readonly classroomSessions: number;
  readonly peersHelped: number;
  readonly debatesParticipated: number;
  readonly simulationsRun: number;
  readonly profitableSimulations: number;
  readonly fastestQuizSeconds: number;
  readonly fastQuizCount: number;
  readonly financialCalcsCompleted: number;
  readonly cashFlowMastered: boolean;
  readonly fiveCAnalysisPassed: number;
  readonly blockTypesExplored: number;
  readonly nightSessions: number;
  readonly earlySessions: number;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly totalXP: number;
}

// ============================================================================
// CHALLENGE TEMPLATE (for generation)
// ============================================================================

export interface ChallengeTemplate {
  readonly type: ChallengeType;
  readonly titleTemplate: string;
  readonly titleTemplateSw: string;
  readonly descriptionTemplate: string;
  readonly descriptionTemplateSw: string;
  readonly baseTarget: number;
  readonly baseXPReward: number;
  readonly minRankLevel: number;
  readonly targetScaling: number;
  readonly xpScaling: number;
  readonly timeLimitMinutes?: number;
}
