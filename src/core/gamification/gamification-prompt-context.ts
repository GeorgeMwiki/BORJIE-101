/**
 * Gamification Engine v2  - AI Prompt Context Builder
 *
 * Converts the user's gamification state into a text block
 * that can be injected into the AI system prompt. This gives
 * the AI awareness of the learner's progress, achievements,
 * and challenges so it can provide contextual encouragement.
 *
 * Supports EN and SW output.
 *
 * @module core/gamification/gamification-prompt-context
 */

import type {
  LearningJourney,
  Achievement,
  DailyChallenge,
  LearningStreak,
} from "./xp-types";

// ============================================================================
// MAIN CONTEXT BUILDER
// ============================================================================

/**
 * Convert a LearningJourney into a concise prompt context string.
 *
 * Includes:
 * - Current rank and XP progress
 * - Active streak status
 * - Pending challenges
 * - Recent achievements
 * - Next unlock preview
 *
 * @param journey - The user's complete learning journey state
 * @param language - Output language ('en' or 'sw')
 * @returns A string ready to inject into the AI system prompt
 */
export function gamificationToPromptContext(
  journey: LearningJourney,
  language: "en" | "sw" = "en",
): string {
  const sections: string[] = [];

  sections.push(buildRankSection(journey, language));
  sections.push(buildStreakSection(journey.activeStreak, language));
  sections.push(buildChallengeSection(journey.activeChallenges, language));
  sections.push(buildAchievementSection(journey, language));
  sections.push(buildStatsSection(journey, language));

  const header =
    language === "sw"
      ? "[Muktadha wa Gamification ya Mwanafunzi]"
      : "[Learner Gamification Context]";

  return `${header}\n${sections.filter(Boolean).join("\n")}`;
}

// ============================================================================
// SECTION BUILDERS
// ============================================================================

function buildRankSection(
  journey: LearningJourney,
  language: "en" | "sw",
): string {
  const rank = journey.currentRank;
  const nextRank = journey.nextRank;
  const progress = journey.progressToNextRank;

  const rankName = language === "sw" ? rank.nameSw : rank.name;

  if (!nextRank) {
    return language === "sw"
      ? `Cheo: Kiwango ${rank.level} (${rankName})  - Kiwango cha juu! XP: ${formatNumber(journey.totalXP)}.`
      : `Rank: Level ${rank.level} (${rankName})  - Max rank achieved! XP: ${formatNumber(journey.totalXP)}.`;
  }

  const nextRankName = language === "sw" ? nextRank.nameSw : nextRank.name;
  const xpNeeded = nextRank.minXP - journey.totalXP;

  return language === "sw"
    ? `Cheo: Kiwango ${rank.level} (${rankName}), ${formatNumber(journey.totalXP)}/${formatNumber(nextRank.minXP)} XP hadi ${nextRankName} (${progress}%). Unahitaji XP ${formatNumber(xpNeeded)} zaidi.`
    : `Rank: Level ${rank.level} (${rankName}), ${formatNumber(journey.totalXP)}/${formatNumber(nextRank.minXP)} XP to ${nextRankName} (${progress}%). Needs ${formatNumber(xpNeeded)} more XP.`;
}

function buildStreakSection(
  streak: LearningStreak,
  language: "en" | "sw",
): string {
  if (streak.currentStreak === 0) {
    return language === "sw"
      ? "Mfululizo: Hakuna mfululizo wa sasa. Himiza kuanza leo."
      : "Streak: No active streak. Encourage starting one today.";
  }

  const freezeInfo =
    streak.freezesRemaining > 0
      ? language === "sw"
        ? ` Kufungia kunapatikana: ${streak.freezesRemaining}.`
        : ` Freezes available: ${streak.freezesRemaining}.`
      : "";

  return language === "sw"
    ? `Mfululizo: Siku ${streak.currentStreak} za mfululizo (rekodi: siku ${streak.longestStreak}).${freezeInfo}`
    : `Streak: ${streak.currentStreak}-day active streak (record: ${streak.longestStreak} days).${freezeInfo}`;
}

function buildChallengeSection(
  challenges: ReadonlyArray<DailyChallenge>,
  language: "en" | "sw",
): string {
  const active = challenges.filter((c) => !c.isCompleted);

  if (active.length === 0) {
    return language === "sw"
      ? "Changamoto: Hakuna changamoto zinazoendelea."
      : "Challenges: No active challenges.";
  }

  const challengeLines = active.map((c) => {
    const title = language === "sw" ? c.titleSw : c.title;
    const progressPct =
      c.target > 0 ? Math.round(((c.progress ?? 0) / c.target) * 100) : 0;

    return language === "sw"
      ? `  - ${title} (${c.progress ?? 0}/${c.target}, ${progressPct}%)  - XP ${c.xpReward}`
      : `  - ${title} (${c.progress ?? 0}/${c.target}, ${progressPct}%)  - ${c.xpReward} XP`;
  });

  const header =
    language === "sw"
      ? `Changamoto (${active.length} zinazoendelea):`
      : `Challenges (${active.length} active):`;

  return `${header}\n${challengeLines.join("\n")}`;
}

function buildAchievementSection(
  journey: LearningJourney,
  language: "en" | "sw",
): string {
  const total = journey.achievements.length;
  const recent = getRecentAchievements(journey.achievements, 3);

  const recentNames = recent.map((a) =>
    language === "sw" ? a.nameSw : a.name,
  );

  const recentLine =
    recentNames.length > 0
      ? language === "sw"
        ? ` Hivi karibuni: ${recentNames.join(", ")}.`
        : ` Recent: ${recentNames.join(", ")}.`
      : "";

  return language === "sw"
    ? `Mafanikio: ${total} yamefunguliwa.${recentLine}`
    : `Achievements: ${total} unlocked.${recentLine}`;
}

function buildStatsSection(
  journey: LearningJourney,
  language: "en" | "sw",
): string {
  const stats = journey.stats;

  return language === "sw"
    ? `Takwimu: Vipindi ${stats.totalSessions}, mitihani ${stats.totalQuizzes}, alama kamili ${stats.perfectScores}, dhana ${stats.conceptsMastered} zilizomilikiwa.`
    : `Stats: ${stats.totalSessions} sessions, ${stats.totalQuizzes} quizzes, ${stats.perfectScores} perfect scores, ${stats.conceptsMastered} concepts mastered.`;
}

// ============================================================================
// COMPACT CONTEXT (for token-constrained prompts)
// ============================================================================

/**
 * Build a compact single-line context for use when tokens are limited.
 * Contains only the most critical gamification info.
 */
export function gamificationToCompactContext(
  journey: LearningJourney,
  language: "en" | "sw" = "en",
): string {
  const rank = journey.currentRank;
  const rankName = language === "sw" ? rank.nameSw : rank.name;
  const streak = journey.activeStreak.currentStreak;
  const activeChallenges = journey.activeChallenges.filter(
    (c) => !c.isCompleted,
  ).length;

  return language === "sw"
    ? `[Gamification: Kiwango ${rank.level} ${rankName}, XP ${formatNumber(journey.totalXP)}, mfululizo siku ${streak}, changamoto ${activeChallenges}, mafanikio ${journey.achievements.length}]`
    : `[Gamification: Lv${rank.level} ${rankName}, ${formatNumber(journey.totalXP)} XP, ${streak}-day streak, ${activeChallenges} challenges, ${journey.achievements.length} achievements]`;
}

// ============================================================================
// ENCOURAGEMENT GENERATOR
// ============================================================================

/**
 * Generate a contextual encouragement message based on the journey state.
 * Can be used by the AI to naturally weave gamification into conversation.
 */
export function generateEncouragement(
  journey: LearningJourney,
  language: "en" | "sw" = "en",
): string | null {
  // Priority 1: About to level up (>85% progress)
  if (journey.progressToNextRank > 85 && journey.nextRank) {
    const nextName =
      language === "sw" ? journey.nextRank.nameSw : journey.nextRank.name;
    const xpNeeded = journey.nextRank.minXP - journey.totalXP;
    return language === "sw"
      ? `Uko karibu sana na kiwango cha ${nextName}! XP ${formatNumber(xpNeeded)} tu zaidi.`
      : `So close to ${nextName} rank! Just ${formatNumber(xpNeeded)} more XP.`;
  }

  // Priority 2: Streak at risk
  if (
    journey.activeStreak.currentStreak > 0 &&
    journey.activeStreak.freezesRemaining === 0
  ) {
    return language === "sw"
      ? `Mfululizo wako wa siku ${journey.activeStreak.currentStreak} ni muhimu. Endelea kujifunza leo!`
      : `Your ${journey.activeStreak.currentStreak}-day streak matters. Keep learning today!`;
  }

  // Priority 3: Challenge almost complete
  const almostDone = journey.activeChallenges.find((c) => {
    if (c.isCompleted || !c.progress) return false;
    return c.progress / c.target >= 0.75;
  });

  if (almostDone) {
    const title = language === "sw" ? almostDone.titleSw : almostDone.title;
    const remaining = almostDone.target - (almostDone.progress ?? 0);
    return language === "sw"
      ? `Changamoto "${title}" iko karibu kukamilika! ${remaining} tu zimebaki.`
      : `Challenge "${title}" is almost done! Just ${remaining} more to go.`;
  }

  return null;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatNumber(num: number): string {
  if (num >= 1000) {
    return num.toLocaleString("en-US");
  }
  return String(num);
}

function getRecentAchievements(
  achievements: ReadonlyArray<Achievement>,
  count: number,
): ReadonlyArray<Achievement> {
  const withDates = achievements.filter((a) => a.unlockedAt);
  const sorted = [...withDates].sort((a, b) => {
    const dateA = a.unlockedAt?.getTime() ?? 0;
    const dateB = b.unlockedAt?.getTime() ?? 0;
    return dateB - dateA;
  });
  return sorted.slice(0, count);
}
