/**
 * Gamification Engine v2 — Rank Progression System
 *
 * 10 ranks with Tanzanian Swahili themes. Each rank unlocks
 * perks and features as the learner advances through the
 * XP progression curve.
 *
 * XP curve follows a power-law: early ranks are fast to achieve,
 * later ranks require sustained engagement. Designed to keep
 * learners motivated at every stage.
 *
 * @module core/gamification/rank-progression
 */

import type { LearnerRank, RankProgress } from "./xp-types";

// ============================================================================
// RANK DEFINITIONS — TANZANIAN SWAHILI THEMED
// ============================================================================

export const RANKS: ReadonlyArray<LearnerRank> = [
  {
    level: 1,
    name: "Student",
    nameSw: "Mwanafunzi",
    minXP: 0,
    maxXP: 499,
    icon: "seedling",
    perks: ["Access to basic quizzes", "Daily challenge (1 per day)"],
  },
  {
    level: 2,
    name: "Reader",
    nameSw: "Msomaji",
    minXP: 500,
    maxXP: 1999,
    icon: "book-open",
    perks: ["Streak freeze (1 free)", "Access to medium difficulty"],
  },
  {
    level: 3,
    name: "Explorer",
    nameSw: "Mchunguzi",
    minXP: 2000,
    maxXP: 4999,
    icon: "compass",
    perks: ["Daily challenges (2 per day)", "Leaderboard visibility"],
  },
  {
    level: 4,
    name: "Knowledgeable",
    nameSw: "Mjuzi",
    minXP: 5000,
    maxXP: 9999,
    icon: "lightbulb",
    perks: [
      "Access to pro difficulty",
      "Streak freeze (2 free)",
      "Simulation access",
    ],
  },
  {
    level: 5,
    name: "Junior Teacher",
    nameSw: "Mwalimu Mdogo",
    minXP: 10000,
    maxXP: 19999,
    icon: "graduation-cap",
    perks: [
      "Peer mentoring tools",
      "Weekly challenges unlock",
      "Custom avatar",
    ],
  },
  {
    level: 6,
    name: "Specialist",
    nameSw: "Mtaalamu",
    minXP: 20000,
    maxXP: 39999,
    icon: "award",
    perks: ["Classroom host access", "Priority support", "Badge showcase"],
  },
  {
    level: 7,
    name: "Teacher",
    nameSw: "Mwalimu",
    minXP: 40000,
    maxXP: 74999,
    icon: "star",
    perks: [
      "Create community challenges",
      "Extended streak freezes (3)",
      "Report generation",
    ],
  },
  {
    level: 8,
    name: "Champion",
    nameSw: "Bingwa",
    minXP: 75000,
    maxXP: 124999,
    icon: "trophy",
    perks: [
      "Exclusive champion badge",
      "Beta feature access",
      "XP boost events",
    ],
  },
  {
    level: 9,
    name: "Elder of Knowledge",
    nameSw: "Mzee wa Maarifa",
    minXP: 125000,
    maxXP: 199999,
    icon: "crown",
    perks: [
      "Community leader status",
      "All premium features",
      "Mentorship dashboard",
    ],
  },
  {
    level: 10,
    name: "Professor",
    nameSw: "Profesa",
    minXP: 200000,
    maxXP: Infinity,
    icon: "gem",
    perks: [
      "Legendary status",
      "All perks unlocked",
      "Permanent premium",
      "Hall of Fame entry",
    ],
  },
] as const;

// ============================================================================
// RANK LOOKUP FUNCTIONS
// ============================================================================

/**
 * Find the rank that matches a given XP total.
 * Uses binary-like search through sorted RANKS array.
 */
export function getRankForXP(xp: number): LearnerRank {
  const clampedXP = Math.max(0, Math.floor(xp));

  for (let i = RANKS.length - 1; i >= 0; i -= 1) {
    if (clampedXP >= RANKS[i].minXP) {
      return RANKS[i];
    }
  }

  return RANKS[0];
}

/**
 * Get the next rank above the current one.
 * Returns null if already at max rank (Profesa).
 */
export function getNextRank(currentRank: LearnerRank): LearnerRank | null {
  if (currentRank.level >= RANKS.length) {
    return null;
  }

  const nextIndex = RANKS.findIndex((r) => r.level === currentRank.level + 1);
  return nextIndex >= 0 ? RANKS[nextIndex] : null;
}

/**
 * Calculate the percentage progress within the current rank
 * toward the next rank.
 *
 * @returns 0-100 percentage (100 if at max rank)
 */
export function getRankProgress(xp: number): RankProgress {
  const clampedXP = Math.max(0, Math.floor(xp));
  const currentRank = getRankForXP(clampedXP);
  const nextRank = getNextRank(currentRank);

  if (!nextRank) {
    return {
      currentRank,
      nextRank: null,
      currentXP: clampedXP,
      xpInCurrentRank: clampedXP - currentRank.minXP,
      xpNeededForNext: 0,
      percentToNextRank: 100,
    };
  }

  const xpInCurrentRank = clampedXP - currentRank.minXP;
  const rankSpan = nextRank.minXP - currentRank.minXP;
  const xpNeededForNext = nextRank.minXP - clampedXP;
  const percentToNextRank =
    rankSpan > 0
      ? Math.min(100, Math.round((xpInCurrentRank / rankSpan) * 100))
      : 100;

  return {
    currentRank,
    nextRank,
    currentXP: clampedXP,
    xpInCurrentRank,
    xpNeededForNext,
    percentToNextRank,
  };
}

/**
 * Get the list of perks unlocked at a specific rank.
 * Includes all perks from previous ranks (cumulative).
 */
export function getRankPerks(rank: LearnerRank): ReadonlyArray<string> {
  const allPerks: string[] = [];

  for (const r of RANKS) {
    if (r.level <= rank.level) {
      allPerks.push(...r.perks);
    }
  }

  return allPerks;
}

/**
 * Get cumulative perks for a given XP value.
 */
export function getPerksForXP(xp: number): ReadonlyArray<string> {
  const rank = getRankForXP(xp);
  return getRankPerks(rank);
}

/**
 * Get the level number for a given XP total.
 */
export function getLevelFromXP(xp: number): number {
  return getRankForXP(xp).level;
}
