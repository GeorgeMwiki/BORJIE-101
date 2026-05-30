/**
 * Dopamine Design System — Module Index
 *
 * Comprehensive dopamine-banking system for the Borjie platform.
 * Provides micro-celebrations, XP/leveling, streak tracking,
 * achievement badges, and animated UI components that make
 * the platform engaging and addictive.
 *
 * Inspired by Duolingo's dopamine banking and fintech gamification.
 *
 * @module core/dopamine-design
 */

// ============================================================================
// CELEBRATION ENGINE
// ============================================================================

export type {
  CelebrationType,
  ConfettiStyle,
  SoundCue,
  CelebrationSpec,
  CelebrationEventDetail,
  XPGainedEventDetail,
  AchievementUnlockedEventDetail,
} from "./celebration-engine";

export {
  CELEBRATION_CONFIG,
  CELEBRATION_EVENT,
  XP_GAINED_EVENT,
  ACHIEVEMENT_UNLOCKED_EVENT,
  triggerCelebration,
  dispatchXPGained,
  dispatchAchievementUnlocked,
  triggerFullCelebration,
} from "./celebration-engine";

// ============================================================================
// XP SYSTEM
// ============================================================================

export type {
  XPActionType,
  XPActionDefinition,
  LevelDefinition,
} from "./xp-system";

export {
  XP_ACTIONS,
  LEVEL_THRESHOLDS,
  calculateLevel,
  xpToNextLevel,
  getLevelTitle,
  getLevelColor,
  getProgressPercentage,
  getLevelDefinition,
  calculateStreakBonusXP,
  getXPForAction,
} from "./xp-system";

// ============================================================================
// STREAK TRACKER
// ============================================================================

export type { StreakMilestoneDefinition } from "./streak-tracker";

export {
  STREAK_MILESTONES,
  calculateStreak,
  isStreakActive,
  getStreakReward,
  getAchievedMilestones,
  getNextMilestone,
  getStreakMessage,
  getStreakProgressToNextMilestone,
} from "./streak-tracker";

// ============================================================================
// ACHIEVEMENT BADGES
// ============================================================================

export type {
  BadgeRarity,
  BadgeCategory,
  BadgeCriteria,
  AchievementBadge,
  UserStats,
} from "./achievement-badges";

export {
  RARITY_CONFIG,
  ACHIEVEMENT_BADGES,
  checkBadgeEligibility,
  getEligibleBadges,
  getBadgesByCategory,
  getBadgesByRarity,
  getBadgeById,
  getNewlyEarnedBadges,
  calculateBadgeXPTotal,
} from "./achievement-badges";
