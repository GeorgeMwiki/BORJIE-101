/**
 * XP System
 *
 * Experience point and leveling system for the Borjie dopamine design.
 * Defines XP values for all platform actions, level thresholds with
 * bilingual titles, and pure utility functions for XP calculations.
 *
 * All functions are pure with no side effects.
 * All data structures are readonly/immutable.
 *
 * @module core/dopamine-design/xp-system
 */

// ============================================================================
// XP ACTION VALUES
// ============================================================================

export type XPActionType =
  | "quiz_correct"
  | "quiz_streak"
  | "concept_mastered"
  | "module_completed"
  | "document_uploaded"
  | "form_section_completed"
  | "daily_login"
  | "perfect_quiz"
  | "streak_bonus"
  | "readiness_milestone"
  | "brs_increase"
  | "first_login"
  | "loan_submitted"
  | "graduation"
  | "level_up"
  | "form_completed";

export interface XPActionDefinition {
  readonly baseXP: number;
  readonly description: {
    readonly en: string;
    readonly sw: string;
  };
}

export const XP_ACTIONS: Readonly<Record<XPActionType, XPActionDefinition>> = {
  quiz_correct: {
    baseXP: 10,
    description: {
      en: "Answer a quiz question correctly",
      sw: "Jibu swali la mtihani kwa usahihi",
    },
  },
  quiz_streak: {
    baseXP: 15,
    description: {
      en: "Continue a correct answer streak",
      sw: "Endelea na mfululizo wa majibu sahihi",
    },
  },
  concept_mastered: {
    baseXP: 50,
    description: {
      en: "Master a learning concept",
      sw: "Elewa dhana ya kujifunza",
    },
  },
  module_completed: {
    baseXP: 100,
    description: {
      en: "Complete a full learning module",
      sw: "Kamilisha somo kamili",
    },
  },
  document_uploaded: {
    baseXP: 15,
    description: {
      en: "Upload a supporting document",
      sw: "Pakia hati ya kuunga mkono",
    },
  },
  form_section_completed: {
    baseXP: 20,
    description: {
      en: "Complete a form section",
      sw: "Kamilisha sehemu ya fomu",
    },
  },
  daily_login: {
    baseXP: 5,
    description: {
      en: "Log in for the day",
      sw: "Ingia kwa siku",
    },
  },
  perfect_quiz: {
    baseXP: 25,
    description: {
      en: "Score perfectly on a quiz",
      sw: "Pata alama kamili kwenye mtihani",
    },
  },
  streak_bonus: {
    baseXP: 10,
    description: {
      en: "Daily streak bonus (multiplied by streak days)",
      sw: "Bonasi ya mfululizo wa kila siku (ikizidishwa na siku)",
    },
  },
  readiness_milestone: {
    baseXP: 75,
    description: {
      en: "Reach a readiness milestone",
      sw: "Fikia hatua ya utayari",
    },
  },
  brs_increase: {
    baseXP: 20,
    description: {
      en: "Increase your Business Readiness Score",
      sw: "Ongeza Alama yako ya Utayari wa Biashara",
    },
  },
  first_login: {
    baseXP: 25,
    description: {
      en: "Welcome bonus for first login",
      sw: "Bonasi ya karibu kwa kuingia mara ya kwanza",
    },
  },
  loan_submitted: {
    baseXP: 200,
    description: {
      en: "Submit a credit application",
      sw: "Wasilisha maombi ya mkopo",
    },
  },
  graduation: {
    baseXP: 500,
    description: {
      en: "Graduate from a learning program",
      sw: "Hitimu kutoka programu ya kujifunza",
    },
  },
  level_up: {
    baseXP: 0,
    description: {
      en: "Level up reward (XP comes from the triggering action)",
      sw: "Tuzo ya kiwango kipya (XP inatoka kwa kitendo kilichosababisha)",
    },
  },
  form_completed: {
    baseXP: 20,
    description: {
      en: "Complete an entire form",
      sw: "Kamilisha fomu nzima",
    },
  },
} as const;

// ============================================================================
// LEVEL DEFINITIONS
// ============================================================================

export interface LevelDefinition {
  readonly level: number;
  readonly xpRequired: number;
  readonly title: {
    readonly en: string;
    readonly sw: string;
  };
  readonly color: string;
}

export const LEVEL_THRESHOLDS: readonly LevelDefinition[] = [
  {
    level: 1,
    xpRequired: 0,
    title: { en: "Newcomer", sw: "Mgeni" },
    color: "#9ca3af",
  },
  {
    level: 2,
    xpRequired: 50,
    title: { en: "Beginner", sw: "Mwanzo" },
    color: "#78716c",
  },
  {
    level: 3,
    xpRequired: 150,
    title: { en: "Learner", sw: "Mwanafunzi" },
    color: "#84cc16",
  },
  {
    level: 4,
    xpRequired: 300,
    title: { en: "Explorer", sw: "Mtafiti" },
    color: "#22c55e",
  },
  {
    level: 5,
    xpRequired: 500,
    title: { en: "Rising Entrepreneur", sw: "Mjasiriamali Anayeinuka" },
    color: "#10b981",
  },
  {
    level: 6,
    xpRequired: 750,
    title: { en: "Achiever", sw: "Mfanikishaji" },
    color: "#14b8a6",
  },
  {
    level: 7,
    xpRequired: 1000,
    title: { en: "Skilled Planner", sw: "Mpangaji Stadi" },
    color: "#06b6d4",
  },
  {
    level: 8,
    xpRequired: 1500,
    title: { en: "Business Builder", sw: "Mjenzi wa Biashara" },
    color: "#3b82f6",
  },
  {
    level: 9,
    xpRequired: 2000,
    title: { en: "Financial Thinker", sw: "Mfikiriaji wa Fedha" },
    color: "#6366f1",
  },
  {
    level: 10,
    xpRequired: 2750,
    title: { en: "Credit Scholar", sw: "Msomi wa Mikopo" },
    color: "#8b5cf6",
  },
  {
    level: 11,
    xpRequired: 3500,
    title: { en: "Market Analyst", sw: "Mchambuzi wa Soko" },
    color: "#a855f7",
  },
  {
    level: 12,
    xpRequired: 4500,
    title: { en: "Risk Navigator", sw: "Rubani wa Hatari" },
    color: "#d946ef",
  },
  {
    level: 13,
    xpRequired: 5500,
    title: { en: "Strategy Expert", sw: "Mtaalamu wa Mikakati" },
    color: "#ec4899",
  },
  {
    level: 14,
    xpRequired: 6500,
    title: { en: "Business Leader", sw: "Kiongozi wa Biashara" },
    color: "#f43f5e",
  },
  {
    level: 15,
    xpRequired: 7500,
    title: { en: "Master Planner", sw: "Mpangaji Mkuu" },
    color: "#ef4444",
  },
  {
    level: 16,
    xpRequired: 8000,
    title: { en: "Credit Champion", sw: "Bingwa wa Mikopo" },
    color: "#f97316",
  },
  {
    level: 17,
    xpRequired: 8500,
    title: { en: "Innovation Pioneer", sw: "Mtangulizi wa Ubunifu" },
    color: "#eab308",
  },
  {
    level: 18,
    xpRequired: 9000,
    title: { en: "Visionary", sw: "Mwenye Maono" },
    color: "#fbbf24",
  },
  {
    level: 19,
    xpRequired: 9500,
    title: { en: "Elite Entrepreneur", sw: "Mjasiriamali Bora" },
    color: "#fcd34d",
  },
  {
    level: 20,
    xpRequired: 10000,
    title: { en: "Legend", sw: "Hadithi ya Mafanikio" },
    color: "#fef08a",
  },
] as const;

// ============================================================================
// PURE CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate the current level based on total XP.
 * Returns the highest level whose XP threshold has been met.
 */
export function calculateLevel(xp: number): number {
  let level = 1;
  for (const threshold of LEVEL_THRESHOLDS) {
    if (xp >= threshold.xpRequired) {
      level = threshold.level;
    } else {
      break;
    }
  }
  return level;
}

/**
 * Calculate how much XP is needed to reach the next level.
 * Returns 0 if already at max level.
 */
export function xpToNextLevel(xp: number): number {
  const currentLevel = calculateLevel(xp);
  const nextThreshold = LEVEL_THRESHOLDS.find(
    (t) => t.level === currentLevel + 1,
  );
  if (!nextThreshold) return 0;
  return Math.max(0, nextThreshold.xpRequired - xp);
}

/**
 * Get the bilingual title for a given level.
 * Returns the title in the requested language.
 */
export function getLevelTitle(level: number, language: "en" | "sw"): string {
  const clampedLevel = Math.max(1, Math.min(level, LEVEL_THRESHOLDS.length));
  const definition = LEVEL_THRESHOLDS.find((t) => t.level === clampedLevel);
  if (!definition) return LEVEL_THRESHOLDS[0]?.title[language] ?? "";
  return definition.title[language];
}

/**
 * Get the color associated with a given level.
 */
export function getLevelColor(level: number): string {
  const clampedLevel = Math.max(1, Math.min(level, LEVEL_THRESHOLDS.length));
  const definition = LEVEL_THRESHOLDS.find((t) => t.level === clampedLevel);
  if (!definition) return LEVEL_THRESHOLDS[0]?.color ?? "#888888";
  return definition.color;
}

/**
 * Calculate the progress percentage within the current level.
 * Returns a number between 0 and 100.
 */
export function getProgressPercentage(xp: number): number {
  const currentLevel = calculateLevel(xp);
  const currentThreshold = LEVEL_THRESHOLDS.find(
    (t) => t.level === currentLevel,
  );
  const nextThreshold = LEVEL_THRESHOLDS.find(
    (t) => t.level === currentLevel + 1,
  );

  if (!currentThreshold || !nextThreshold) return 100;

  const xpInLevel = xp - currentThreshold.xpRequired;
  const xpForLevel = nextThreshold.xpRequired - currentThreshold.xpRequired;

  if (xpForLevel <= 0) return 100;
  return Math.min(100, Math.max(0, (xpInLevel / xpForLevel) * 100));
}

/**
 * Get the full level definition for a given level number.
 */
export function getLevelDefinition(level: number): LevelDefinition {
  const clampedLevel = Math.max(1, Math.min(level, LEVEL_THRESHOLDS.length));
  const definition = LEVEL_THRESHOLDS.find((t) => t.level === clampedLevel);
  return definition ?? LEVEL_THRESHOLDS[0];
}

/**
 * Calculate XP for a streak bonus action.
 * Streak bonus = baseXP * streakDays (capped at 365).
 */
export function calculateStreakBonusXP(streakDays: number): number {
  const cappedDays = Math.min(Math.max(0, streakDays), 365);
  return XP_ACTIONS.streak_bonus.baseXP * cappedDays;
}

/**
 * Get the XP value for a given action type.
 * For streak_bonus, use calculateStreakBonusXP instead.
 */
export function getXPForAction(action: XPActionType): number {
  return XP_ACTIONS[action].baseXP;
}
