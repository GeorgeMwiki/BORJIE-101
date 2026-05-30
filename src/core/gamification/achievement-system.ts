/**
 * Gamification Engine v2 — Achievement System
 *
 * 32 achievements across 8 categories, all bilingual (EN/SW).
 * Pure functional: checkAchievements returns newly unlocked achievements
 * without side effects.
 *
 * Categories:
 * - Learning (4): quiz and concept milestones
 * - Mastery (3): pro-level mastery achievements
 * - Consistency (4): streak-based achievements
 * - Speed (3): time-based performance
 * - Social (3): peer interaction achievements
 * - Financial (3): financial literacy milestones
 * - Simulation (3): business simulation achievements
 * - Exploration (4): platform discovery achievements
 *
 * @module core/gamification/achievement-system
 */

import type {
  Achievement,
  AchievementCategory,
  AchievementProgress,
  AchievementRequirement,
  UserGamificationStats,
  XPEvent,
} from "./xp-types";

// ============================================================================
// ACHIEVEMENT DEFINITIONS — 32 ACHIEVEMENTS
// ============================================================================

export const ACHIEVEMENTS: ReadonlyArray<Achievement> = [
  // ── LEARNING (4) ──────────────────────────────────────────────────────
  {
    id: "ach_first_steps",
    name: "First Steps",
    nameSw: "Hatua za Kwanza",
    description: "Complete your first quiz",
    descriptionSw: "Kamilisha mtihani wako wa kwanza",
    icon: "footprints",
    category: "learning",
    requirement: { type: "count", metric: "totalQuizzes", threshold: 1 },
    rarity: "common",
    xpReward: 25,
  },
  {
    id: "ach_knowledge_seeker",
    name: "Knowledge Seeker",
    nameSw: "Mtafutaji wa Maarifa",
    description: "Master 10 concepts",
    descriptionSw: "Miliki dhana 10",
    icon: "search",
    category: "learning",
    requirement: { type: "count", metric: "conceptsMastered", threshold: 10 },
    rarity: "common",
    xpReward: 100,
  },
  {
    id: "ach_scholar",
    name: "Scholar",
    nameSw: "Msomi",
    description: "Master 50 concepts",
    descriptionSw: "Miliki dhana 50",
    icon: "book",
    category: "learning",
    requirement: { type: "count", metric: "conceptsMastered", threshold: 50 },
    rarity: "rare",
    xpReward: 300,
  },
  {
    id: "ach_walking_encyclopedia",
    name: "Walking Encyclopedia",
    nameSw: "Ensaiklopidia Hai",
    description: "Master 100 concepts",
    descriptionSw: "Miliki dhana 100",
    icon: "library",
    category: "learning",
    requirement: { type: "count", metric: "conceptsMastered", threshold: 100 },
    rarity: "epic",
    xpReward: 750,
  },

  // ── MASTERY (3) ───────────────────────────────────────────────────────
  {
    id: "ach_sharp_mind",
    name: "Sharp Mind",
    nameSw: "Akili Kali",
    description: "Achieve your first pro-level mastery",
    descriptionSw: "Fikia umilisi wa kiwango cha juu kwanza",
    icon: "brain",
    category: "mastery",
    requirement: { type: "count", metric: "proMasteries", threshold: 1 },
    rarity: "rare",
    xpReward: 200,
  },
  {
    id: "ach_diamond_standard",
    name: "Diamond Standard",
    nameSw: "Kiwango cha Almasi",
    description: "Achieve 10 pro-level masteries",
    descriptionSw: "Fikia umilisi 10 wa kiwango cha juu",
    icon: "diamond",
    category: "mastery",
    requirement: { type: "count", metric: "proMasteries", threshold: 10 },
    rarity: "epic",
    xpReward: 500,
  },
  {
    id: "ach_grandmaster",
    name: "Grandmaster",
    nameSw: "Mkuu wa Wakuu",
    description: "Master all concepts at pro level",
    descriptionSw: "Miliki dhana zote kwa kiwango cha juu",
    icon: "infinity",
    category: "mastery",
    requirement: { type: "count", metric: "proMasteries", threshold: 74 },
    rarity: "legendary",
    xpReward: 2000,
  },

  // ── CONSISTENCY (4) ───────────────────────────────────────────────────
  {
    id: "ach_three_day_flame",
    name: "Three Day Flame",
    nameSw: "Moto wa Siku Tatu",
    description: "Maintain a 3-day learning streak",
    descriptionSw: "Dumisha mfululizo wa siku 3 wa kujifunza",
    icon: "flame",
    category: "consistency",
    requirement: { type: "streak", metric: "currentStreak", threshold: 3 },
    rarity: "common",
    xpReward: 30,
  },
  {
    id: "ach_week_warrior",
    name: "Week Warrior",
    nameSw: "Shujaa wa Wiki",
    description: "Maintain a 7-day learning streak",
    descriptionSw: "Dumisha mfululizo wa siku 7 wa kujifunza",
    icon: "shield",
    category: "consistency",
    requirement: { type: "streak", metric: "currentStreak", threshold: 7 },
    rarity: "common",
    xpReward: 75,
  },
  {
    id: "ach_monthly_marathon",
    name: "Monthly Marathon",
    nameSw: "Mbio za Mwezi",
    description: "Maintain a 30-day learning streak",
    descriptionSw: "Dumisha mfululizo wa siku 30 wa kujifunza",
    icon: "calendar-check",
    category: "consistency",
    requirement: { type: "streak", metric: "currentStreak", threshold: 30 },
    rarity: "epic",
    xpReward: 400,
  },
  {
    id: "ach_eternal_student",
    name: "Eternal Student",
    nameSw: "Mwanafunzi wa Milele",
    description: "Maintain a 100-day learning streak",
    descriptionSw: "Dumisha mfululizo wa siku 100 wa kujifunza",
    icon: "sun",
    category: "consistency",
    requirement: { type: "streak", metric: "longestStreak", threshold: 100 },
    rarity: "legendary",
    xpReward: 1500,
  },

  // ── SPEED (3) ─────────────────────────────────────────────────────────
  {
    id: "ach_lightning_round",
    name: "Lightning Round",
    nameSw: "Duru ya Umeme",
    description: "Answer a quiz question correctly in under 5 seconds",
    descriptionSw: "Jibu swali la mtihani kwa usahihi chini ya sekunde 5",
    icon: "zap",
    category: "speed",
    requirement: { type: "time", metric: "fastestQuizSeconds", threshold: 5 },
    rarity: "rare",
    xpReward: 100,
  },
  {
    id: "ach_speed_demon",
    name: "Speed Demon",
    nameSw: "Shetani wa Kasi",
    description: "Complete 10 quizzes with each answered under 10 seconds",
    descriptionSw:
      "Kamilisha mitihani 10 kila moja ikijibiwa chini ya sekunde 10",
    icon: "rocket",
    category: "speed",
    requirement: { type: "count", metric: "fastQuizCount", threshold: 10 },
    rarity: "epic",
    xpReward: 350,
  },
  {
    id: "ach_time_lord",
    name: "Time Lord",
    nameSw: "Bwana wa Wakati",
    description: "Complete 50 quizzes under 10 seconds each",
    descriptionSw: "Kamilisha mitihani 50 chini ya sekunde 10 kila moja",
    icon: "clock",
    category: "speed",
    requirement: { type: "count", metric: "fastQuizCount", threshold: 50 },
    rarity: "legendary",
    xpReward: 800,
  },

  // ── SOCIAL (3) ────────────────────────────────────────────────────────
  {
    id: "ach_team_player",
    name: "Team Player",
    nameSw: "Mchezaji wa Timu",
    description: "Participate in your first peer debate",
    descriptionSw: "Shiriki katika mjadala wako wa kwanza na wenzako",
    icon: "users",
    category: "social",
    requirement: {
      type: "count",
      metric: "debatesParticipated",
      threshold: 1,
    },
    rarity: "common",
    xpReward: 50,
  },
  {
    id: "ach_mentor",
    name: "Mentor",
    nameSw: "Mshauri",
    description: "Help 5 peers with their learning",
    descriptionSw: "Saidia wenzako 5 katika kujifunza kwao",
    icon: "hand-helping",
    category: "social",
    requirement: { type: "count", metric: "peersHelped", threshold: 5 },
    rarity: "rare",
    xpReward: 200,
  },
  {
    id: "ach_community_leader",
    name: "Community Leader",
    nameSw: "Kiongozi wa Jamii",
    description: "Host or participate in 10 classroom sessions",
    descriptionSw: "Shiriki au ongoza vipindi 10 vya darasa",
    icon: "megaphone",
    category: "social",
    requirement: {
      type: "count",
      metric: "classroomSessions",
      threshold: 10,
    },
    rarity: "epic",
    xpReward: 500,
  },

  // ── FINANCIAL (3) ─────────────────────────────────────────────────────
  {
    id: "ach_budget_builder",
    name: "Budget Builder",
    nameSw: "Mjenzi wa Bajeti",
    description: "Complete a financial calculation exercise",
    descriptionSw: "Kamilisha zoezi la hesabu za kifedha",
    icon: "calculator",
    category: "financial",
    requirement: {
      type: "count",
      metric: "financialCalcsCompleted",
      threshold: 1,
    },
    rarity: "common",
    xpReward: 50,
  },
  {
    id: "ach_cash_flow_king",
    name: "Cash Flow King",
    nameSw: "Mfalme wa Mtiririko wa Pesa",
    description: "Master cash flow concepts",
    descriptionSw: "Miliki dhana za mtiririko wa pesa",
    icon: "trending-up",
    category: "financial",
    requirement: {
      type: "count",
      metric: "cashFlowMastered",
      threshold: 1,
    },
    rarity: "rare",
    xpReward: 200,
  },
  {
    id: "ach_credit_worthy",
    name: "Credit Worthy",
    nameSw: "Mstahiki Mkopo",
    description: "Pass 5 five-C credit analysis assessments",
    descriptionSw: "Pita tathmini 5 za uchambuzi wa mikopo ya 5C",
    icon: "check-circle",
    category: "financial",
    requirement: {
      type: "count",
      metric: "fiveCAnalysisPassed",
      threshold: 5,
    },
    rarity: "epic",
    xpReward: 400,
  },

  // ── SIMULATION (3) ────────────────────────────────────────────────────
  {
    id: "ach_first_trade",
    name: "First Trade",
    nameSw: "Biashara ya Kwanza",
    description: "Complete your first business simulation",
    descriptionSw: "Kamilisha simulisheni yako ya kwanza ya biashara",
    icon: "briefcase",
    category: "simulation",
    requirement: { type: "count", metric: "simulationsRun", threshold: 1 },
    rarity: "common",
    xpReward: 50,
  },
  {
    id: "ach_profit_maker",
    name: "Profit Maker",
    nameSw: "Mtengenezaji wa Faida",
    description: "Achieve a profitable outcome in a simulation",
    descriptionSw: "Fikia matokeo ya faida katika simulisheni",
    icon: "dollar-sign",
    category: "simulation",
    requirement: {
      type: "count",
      metric: "profitableSimulations",
      threshold: 1,
    },
    rarity: "rare",
    xpReward: 150,
  },
  {
    id: "ach_business_mogul",
    name: "Business Mogul",
    nameSw: "Tajiri wa Biashara",
    description: "Achieve 10 profitable simulation outcomes",
    descriptionSw: "Fikia matokeo 10 ya faida katika simulisheni",
    icon: "building",
    category: "simulation",
    requirement: {
      type: "count",
      metric: "profitableSimulations",
      threshold: 10,
    },
    rarity: "epic",
    xpReward: 600,
  },

  // ── EXPLORATION (4) ───────────────────────────────────────────────────
  {
    id: "ach_curious_cat",
    name: "Curious Cat",
    nameSw: "Paka Mdadisi",
    description: "Try all interactive block types in the chat",
    descriptionSw:
      "Jaribu aina zote za vizuizi vya mwingiliano kwenye mazungumzo",
    icon: "sparkles",
    category: "exploration",
    requirement: {
      type: "count",
      metric: "blockTypesExplored",
      threshold: 8,
    },
    rarity: "rare",
    xpReward: 150,
  },
  {
    id: "ach_night_owl",
    name: "Night Owl",
    nameSw: "Bundi wa Usiku",
    description: "Complete a learning session after 10 PM",
    descriptionSw: "Kamilisha kipindi cha kujifunza baada ya saa 4 usiku",
    icon: "moon",
    category: "exploration",
    requirement: { type: "count", metric: "nightSessions", threshold: 1 },
    rarity: "common",
    xpReward: 25,
  },
  {
    id: "ach_early_bird",
    name: "Early Bird",
    nameSw: "Ndege wa Asubuhi",
    description: "Complete a learning session before 6 AM",
    descriptionSw: "Kamilisha kipindi cha kujifunza kabla ya saa 12 asubuhi",
    icon: "sunrise",
    category: "exploration",
    requirement: { type: "count", metric: "earlySessions", threshold: 1 },
    rarity: "common",
    xpReward: 25,
  },
  {
    id: "ach_perfect_streak",
    name: "Perfectionist",
    nameSw: "Mkamilifu",
    description: "Score perfectly on 10 consecutive quizzes",
    descriptionSw: "Pata alama kamili katika mitihani 10 mfululizo",
    icon: "target",
    category: "exploration",
    requirement: { type: "count", metric: "perfectScores", threshold: 10 },
    rarity: "epic",
    xpReward: 500,
  },
] as const;

// ============================================================================
// ACHIEVEMENT INDEX (for fast lookup)
// ============================================================================

const ACHIEVEMENT_BY_ID = new Map<string, Achievement>(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

const ACHIEVEMENTS_BY_CATEGORY = new Map<
  AchievementCategory,
  ReadonlyArray<Achievement>
>();

// Build category index
for (const achievement of ACHIEVEMENTS) {
  const existing = ACHIEVEMENTS_BY_CATEGORY.get(achievement.category) ?? [];
  ACHIEVEMENTS_BY_CATEGORY.set(achievement.category, [
    ...existing,
    achievement,
  ]);
}

// ============================================================================
// ACHIEVEMENT CHECKING — CORE LOGIC
// ============================================================================

/**
 * Check if any new achievements have been unlocked based on
 * the current event and user stats.
 *
 * Pure function: does not persist anything. Returns only newly
 * unlocked achievements (not already in currentAchievements).
 */
export function checkAchievements(
  userId: string,
  event: XPEvent,
  currentAchievements: ReadonlyArray<Achievement>,
  stats: UserGamificationStats,
): ReadonlyArray<Achievement> {
  const unlockedIds = new Set(currentAchievements.map((a) => a.id));
  const newlyUnlocked: Achievement[] = [];

  for (const achievement of ACHIEVEMENTS) {
    if (unlockedIds.has(achievement.id)) {
      continue;
    }

    if (evaluateRequirement(achievement.requirement, stats)) {
      newlyUnlocked.push({
        ...achievement,
        unlockedAt: event.timestamp,
      });
    }
  }

  return newlyUnlocked;
}

/**
 * Get the progress toward a specific achievement.
 * Returns the current value, target, and percentage.
 */
export function getAchievementProgress(
  userId: string,
  achievement: Achievement,
  stats: UserGamificationStats,
): AchievementProgress {
  const currentValue = getMetricValue(achievement.requirement.metric, stats);
  const targetValue = achievement.requirement.threshold;
  const percentComplete =
    targetValue > 0
      ? Math.min(100, Math.round((currentValue / targetValue) * 100))
      : 100;

  return {
    achievementId: achievement.id,
    currentValue,
    targetValue,
    percentComplete,
    isUnlocked: percentComplete >= 100,
  };
}

/**
 * Get progress for all achievements.
 */
export function getAllAchievementProgress(
  userId: string,
  stats: UserGamificationStats,
): ReadonlyArray<AchievementProgress> {
  return ACHIEVEMENTS.map((achievement) =>
    getAchievementProgress(userId, achievement, stats),
  );
}

/**
 * Get achievements filtered by category.
 */
export function getAchievementsByCategory(
  category: AchievementCategory,
): ReadonlyArray<Achievement> {
  return ACHIEVEMENTS_BY_CATEGORY.get(category) ?? [];
}

/**
 * Get a single achievement by ID.
 */
export function getAchievementById(id: string): Achievement | null {
  return ACHIEVEMENT_BY_ID.get(id) ?? null;
}

/**
 * Count achievements by rarity.
 */
export function countByRarity(
  achievements: ReadonlyArray<Achievement>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {
    common: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
  };

  for (const a of achievements) {
    counts[a.rarity] = (counts[a.rarity] ?? 0) + 1;
  }

  return counts;
}

/**
 * Get the total XP reward for a set of achievements.
 */
export function totalAchievementXP(
  achievements: ReadonlyArray<Achievement>,
): number {
  return achievements.reduce((sum, a) => sum + a.xpReward, 0);
}

/**
 * Get the next closest achievement the user can unlock.
 * Returns the achievement with the highest progress that isn't yet complete.
 */
export function getNextClosestAchievement(
  userId: string,
  currentAchievements: ReadonlyArray<Achievement>,
  stats: UserGamificationStats,
): AchievementProgress | null {
  const unlockedIds = new Set(currentAchievements.map((a) => a.id));

  let bestProgress: AchievementProgress | null = null;

  for (const achievement of ACHIEVEMENTS) {
    if (unlockedIds.has(achievement.id)) {
      continue;
    }

    const progress = getAchievementProgress(userId, achievement, stats);

    if (progress.isUnlocked) {
      continue;
    }

    if (
      !bestProgress ||
      progress.percentComplete > bestProgress.percentComplete
    ) {
      bestProgress = progress;
    }
  }

  return bestProgress;
}

// ============================================================================
// REQUIREMENT EVALUATION
// ============================================================================

function evaluateRequirement(
  requirement: AchievementRequirement,
  stats: UserGamificationStats,
): boolean {
  switch (requirement.type) {
    case "count":
      return evaluateCountRequirement(requirement, stats);
    case "streak":
      return evaluateStreakRequirement(requirement, stats);
    case "score":
      return evaluateScoreRequirement(requirement, stats);
    case "time":
      return evaluateTimeRequirement(requirement, stats);
    case "compound":
      return evaluateCompoundRequirement(requirement, stats);
    default:
      return false;
  }
}

function evaluateCountRequirement(
  requirement: AchievementRequirement,
  stats: UserGamificationStats,
): boolean {
  const value = getMetricValue(requirement.metric, stats);
  return value >= requirement.threshold;
}

function evaluateStreakRequirement(
  requirement: AchievementRequirement,
  stats: UserGamificationStats,
): boolean {
  const value = getMetricValue(requirement.metric, stats);
  return value >= requirement.threshold;
}

function evaluateScoreRequirement(
  requirement: AchievementRequirement,
  stats: UserGamificationStats,
): boolean {
  const value = getMetricValue(requirement.metric, stats);
  return value >= requirement.threshold;
}

function evaluateTimeRequirement(
  requirement: AchievementRequirement,
  stats: UserGamificationStats,
): boolean {
  const value = getMetricValue(requirement.metric, stats);
  // For time requirements, the value must be LESS than or equal to threshold
  // (e.g., fastest quiz under 5 seconds)
  return value > 0 && value <= requirement.threshold;
}

function evaluateCompoundRequirement(
  requirement: AchievementRequirement,
  stats: UserGamificationStats,
): boolean {
  if (!requirement.conditions || requirement.conditions.length === 0) {
    return false;
  }

  return requirement.conditions.every((condition) =>
    evaluateRequirement(condition, stats),
  );
}

// ============================================================================
// METRIC VALUE EXTRACTION
// ============================================================================

function getMetricValue(metric: string, stats: UserGamificationStats): number {
  switch (metric) {
    case "totalQuizzes":
      return stats.totalQuizzes;
    case "perfectScores":
      return stats.perfectScores;
    case "conceptsMastered":
      return stats.conceptsMastered;
    case "proMasteries":
      return stats.proMasteries;
    case "totalSessions":
      return stats.totalSessions;
    case "classroomSessions":
      return stats.classroomSessions;
    case "peersHelped":
      return stats.peersHelped;
    case "debatesParticipated":
      return stats.debatesParticipated;
    case "simulationsRun":
      return stats.simulationsRun;
    case "profitableSimulations":
      return stats.profitableSimulations;
    case "fastestQuizSeconds":
      return stats.fastestQuizSeconds;
    case "fastQuizCount":
      return stats.fastQuizCount;
    case "financialCalcsCompleted":
      return stats.financialCalcsCompleted;
    case "cashFlowMastered":
      return stats.cashFlowMastered ? 1 : 0;
    case "fiveCAnalysisPassed":
      return stats.fiveCAnalysisPassed;
    case "blockTypesExplored":
      return stats.blockTypesExplored;
    case "nightSessions":
      return stats.nightSessions;
    case "earlySessions":
      return stats.earlySessions;
    case "currentStreak":
      return stats.currentStreak;
    case "longestStreak":
      return stats.longestStreak;
    case "totalXP":
      return stats.totalXP;
    default:
      return 0;
  }
}
