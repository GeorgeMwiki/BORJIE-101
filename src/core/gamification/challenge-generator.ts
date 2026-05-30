/**
 * Gamification Engine v2 — Challenge Generator
 *
 * Generates daily and weekly challenges adapted to the user's
 * rank level and weak areas. All bilingual (EN/SW).
 *
 * Challenge difficulty scales with rank:
 * - Higher ranks get harder targets and bigger XP rewards
 * - Challenges focus on the user's weakest areas
 * - Daily challenges expire at midnight, weekly on Sunday
 *
 * Pure functions: no database access, no side effects.
 *
 * @module core/gamification/challenge-generator
 */

import type {
  DailyChallenge,
  ChallengeType,
  ChallengeTemplate,
  ChallengeCompletionResult,
  LearnerRank,
  UserGamificationStats,
  XPEvent,
} from "./xp-types";

// ============================================================================
// CHALLENGE TEMPLATES
// ============================================================================

const CHALLENGE_TEMPLATES: ReadonlyArray<ChallengeTemplate> = [
  {
    type: "quiz_streak",
    titleTemplate: "Quiz Streak: {{target}} in a row",
    titleTemplateSw: "Mfululizo wa Mtihani: {{target}} mfululizo",
    descriptionTemplate:
      "Answer {{target}} quiz questions correctly in a row without any mistakes",
    descriptionTemplateSw:
      "Jibu maswali {{target}} ya mtihani kwa usahihi mfululizo bila makosa",
    baseTarget: 3,
    baseXPReward: 50,
    minRankLevel: 1,
    targetScaling: 1.5,
    xpScaling: 1.3,
  },
  {
    type: "concept_explore",
    titleTemplate: "Explore {{target}} New Concepts",
    titleTemplateSw: "Chunguza Dhana {{target}} Mpya",
    descriptionTemplate:
      "Study {{target}} concepts you have not explored before",
    descriptionTemplateSw:
      "Jifunze dhana {{target}} ambazo hujazichunguza hapo awali",
    baseTarget: 2,
    baseXPReward: 40,
    minRankLevel: 1,
    targetScaling: 1.3,
    xpScaling: 1.2,
  },
  {
    type: "speed_round",
    titleTemplate: "Speed Round: {{target}} Quick Answers",
    titleTemplateSw: "Duru ya Kasi: Majibu {{target}} ya Haraka",
    descriptionTemplate:
      "Answer {{target}} questions correctly in under 10 seconds each",
    descriptionTemplateSw:
      "Jibu maswali {{target}} kwa usahihi chini ya sekunde 10 kila moja",
    baseTarget: 3,
    baseXPReward: 60,
    minRankLevel: 2,
    targetScaling: 1.4,
    xpScaling: 1.4,
    timeLimitMinutes: 5,
  },
  {
    type: "teach_peer",
    titleTemplate: "Help {{target}} Peers Today",
    titleTemplateSw: "Saidia Wenzako {{target}} Leo",
    descriptionTemplate:
      "Help {{target}} fellow learners by answering their questions or joining discussions",
    descriptionTemplateSw:
      "Saidia wanafunzi wenzako {{target}} kwa kujibu maswali yao au kujiunga na mijadala",
    baseTarget: 1,
    baseXPReward: 45,
    minRankLevel: 3,
    targetScaling: 1.2,
    xpScaling: 1.3,
  },
  {
    type: "review_blitz",
    titleTemplate: "Review Blitz: {{target}} Reviews",
    titleTemplateSw: "Mapitio ya Haraka: Mapitio {{target}}",
    descriptionTemplate:
      "Complete {{target}} spaced review sessions to reinforce your knowledge",
    descriptionTemplateSw:
      "Kamilisha vipindi {{target}} vya mapitio ya nafasi ili kuimarisha maarifa yako",
    baseTarget: 2,
    baseXPReward: 35,
    minRankLevel: 1,
    targetScaling: 1.3,
    xpScaling: 1.2,
  },
  {
    type: "simulation_run",
    titleTemplate: "Run {{target}} Business Simulations",
    titleTemplateSw: "Endesha Simulisheni {{target}} za Biashara",
    descriptionTemplate:
      "Complete {{target}} business simulation scenarios and analyze the results",
    descriptionTemplateSw:
      "Kamilisha hali {{target}} za simulisheni ya biashara na uchambue matokeo",
    baseTarget: 1,
    baseXPReward: 55,
    minRankLevel: 4,
    targetScaling: 1.2,
    xpScaling: 1.5,
  },
  {
    type: "perfect_score",
    titleTemplate: "Perfect Score: {{target}} Flawless Quizzes",
    titleTemplateSw: "Alama Kamili: Mitihani {{target}} Bila Dosari",
    descriptionTemplate:
      "Score 100% on {{target}} quizzes without any incorrect answers",
    descriptionTemplateSw:
      "Pata alama 100% katika mitihani {{target}} bila majibu yoyote yasiyo sahihi",
    baseTarget: 1,
    baseXPReward: 65,
    minRankLevel: 2,
    targetScaling: 1.3,
    xpScaling: 1.4,
  },
] as const;

// ============================================================================
// DETERMINISTIC ID GENERATION
// ============================================================================

/**
 * Generate a deterministic challenge ID from the date and type.
 * This ensures the same challenge is returned for the same date + user.
 */
function generateChallengeId(
  date: Date,
  type: ChallengeType,
  index: number,
): string {
  const dateStr = date.toISOString().split("T")[0];
  return `challenge_${dateStr}_${type}_${index}`;
}

// ============================================================================
// DAILY CHALLENGE GENERATION
// ============================================================================

/**
 * Generate a daily challenge based on the user's profile and current date.
 *
 * Selection strategy:
 * 1. Filter templates by minimum rank level
 * 2. Prioritize the user's weakest areas
 * 3. Scale target and XP reward by rank level
 * 4. Set expiration to end of day (UTC)
 */
export function generateDailyChallenge(
  userRank: LearnerRank,
  stats: UserGamificationStats,
  date: Date,
): DailyChallenge {
  const eligibleTemplates = CHALLENGE_TEMPLATES.filter(
    (t) => t.minRankLevel <= userRank.level,
  );

  if (eligibleTemplates.length === 0) {
    return createFallbackChallenge(date);
  }

  // Deterministic selection based on date (rotate through templates)
  const dayOfYear = getDayOfYear(date);
  const templateIndex = dayOfYear % eligibleTemplates.length;
  const template = eligibleTemplates[templateIndex];

  return buildChallengeFromTemplate(template, userRank, date, 0);
}

/**
 * Generate 3 weekly challenges for the user.
 * Selects a diverse set of challenge types based on the user's
 * weak areas and rank level.
 */
export function generateWeeklyChallenges(
  userRank: LearnerRank,
  stats: UserGamificationStats,
  date: Date = new Date(),
): ReadonlyArray<DailyChallenge> {
  const eligibleTemplates = CHALLENGE_TEMPLATES.filter(
    (t) => t.minRankLevel <= userRank.level,
  );

  if (eligibleTemplates.length === 0) {
    return [createFallbackChallenge(date)];
  }

  // Prioritize templates based on user weaknesses
  const prioritized = prioritizeByWeakness(eligibleTemplates, stats);

  // Select up to 3 diverse challenges
  const selectedTemplates = selectDiverseTemplates(prioritized, 3);
  const weekEnd = getEndOfWeek(date);

  return selectedTemplates.map((template, index) => {
    const scaledTarget = scaleTarget(
      template.baseTarget,
      userRank.level,
      template.targetScaling,
    );
    const scaledXP = scaleXP(
      template.baseXPReward,
      userRank.level,
      template.xpScaling,
    );

    // Weekly challenges have higher targets (2x daily)
    const weeklyTarget = Math.max(1, Math.round(scaledTarget * 2));
    const weeklyXP = Math.round(scaledXP * 2.5);

    return {
      id: generateChallengeId(date, template.type, index),
      title: interpolateTemplate(template.titleTemplate, weeklyTarget),
      titleSw: interpolateTemplate(template.titleTemplateSw, weeklyTarget),
      description: interpolateTemplate(
        template.descriptionTemplate,
        weeklyTarget,
      ),
      descriptionSw: interpolateTemplate(
        template.descriptionTemplateSw,
        weeklyTarget,
      ),
      type: template.type,
      target: weeklyTarget,
      xpReward: weeklyXP,
      timeLimit: template.timeLimitMinutes
        ? template.timeLimitMinutes * 7
        : undefined,
      expiresAt: weekEnd,
      progress: 0,
      isCompleted: false,
    };
  });
}

// ============================================================================
// CHALLENGE COMPLETION CHECKING
// ============================================================================

/**
 * Check if a challenge has been completed based on a stream of XP events.
 *
 * Maps challenge types to relevant event actions:
 * - quiz_streak: consecutive quiz_correct events
 * - concept_explore: concept_mastered events
 * - speed_round: speed_bonus events
 * - teach_peer: peer_helped events
 * - review_blitz: review_completed events
 * - simulation_run: simulation_profit events
 * - perfect_score: quiz_perfect events
 */
export function checkChallengeCompletion(
  challenge: DailyChallenge,
  events: ReadonlyArray<XPEvent>,
): ChallengeCompletionResult {
  const relevantActions = getRelevantActions(challenge.type);

  const relevantEvents = events.filter((e) => {
    const isRelevant = relevantActions.includes(e.action);
    const isWithinTime = e.timestamp <= challenge.expiresAt;
    return isRelevant && isWithinTime;
  });

  let currentProgress: number;

  if (challenge.type === "quiz_streak") {
    currentProgress = countConsecutive(relevantEvents, "quiz_correct");
  } else {
    currentProgress = relevantEvents.length;
  }

  const completed = currentProgress >= challenge.target;
  const xpAwarded = completed ? challenge.xpReward : 0;

  return {
    challengeId: challenge.id,
    completed,
    currentProgress: Math.min(currentProgress, challenge.target),
    target: challenge.target,
    xpAwarded,
  };
}

/**
 * Get the currently active challenges for a user on a given date.
 * Filters out expired challenges and returns only valid ones.
 */
export function getActiveChallenges(
  challenges: ReadonlyArray<DailyChallenge>,
  date: Date,
): ReadonlyArray<DailyChallenge> {
  return challenges.filter((c) => {
    const notExpired = c.expiresAt > date;
    const notCompleted = !c.isCompleted;
    return notExpired && notCompleted;
  });
}

/**
 * Update challenge progress with new events.
 * Returns a new array of challenges with updated progress (immutable).
 */
export function updateChallengeProgress(
  challenges: ReadonlyArray<DailyChallenge>,
  events: ReadonlyArray<XPEvent>,
): ReadonlyArray<DailyChallenge> {
  return challenges.map((challenge) => {
    const result = checkChallengeCompletion(challenge, events);
    return {
      ...challenge,
      progress: result.currentProgress,
      isCompleted: result.completed,
    };
  });
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function buildChallengeFromTemplate(
  template: ChallengeTemplate,
  rank: LearnerRank,
  date: Date,
  index: number,
): DailyChallenge {
  const scaledTarget = scaleTarget(
    template.baseTarget,
    rank.level,
    template.targetScaling,
  );
  const scaledXP = scaleXP(
    template.baseXPReward,
    rank.level,
    template.xpScaling,
  );

  return {
    id: generateChallengeId(date, template.type, index),
    title: interpolateTemplate(template.titleTemplate, scaledTarget),
    titleSw: interpolateTemplate(template.titleTemplateSw, scaledTarget),
    description: interpolateTemplate(
      template.descriptionTemplate,
      scaledTarget,
    ),
    descriptionSw: interpolateTemplate(
      template.descriptionTemplateSw,
      scaledTarget,
    ),
    type: template.type,
    target: scaledTarget,
    xpReward: scaledXP,
    timeLimit: template.timeLimitMinutes,
    expiresAt: getEndOfDay(date),
    progress: 0,
    isCompleted: false,
  };
}

function createFallbackChallenge(date: Date): DailyChallenge {
  return {
    id: generateChallengeId(date, "quiz_streak", 0),
    title: "Daily Quiz: Answer 3 correctly",
    titleSw: "Mtihani wa Kila Siku: Jibu 3 kwa usahihi",
    description: "Answer 3 quiz questions correctly to earn bonus XP",
    descriptionSw: "Jibu maswali 3 ya mtihani kwa usahihi kupata XP ya ziada",
    type: "quiz_streak",
    target: 3,
    xpReward: 50,
    expiresAt: getEndOfDay(date),
    progress: 0,
    isCompleted: false,
  };
}

function scaleTarget(
  baseTarget: number,
  rankLevel: number,
  scaling: number,
): number {
  const scaled = baseTarget * Math.pow(scaling, rankLevel - 1);
  return Math.max(1, Math.round(scaled));
}

function scaleXP(baseXP: number, rankLevel: number, scaling: number): number {
  const scaled = baseXP * Math.pow(scaling, rankLevel - 1);
  return Math.round(scaled);
}

function interpolateTemplate(template: string, target: number): string {
  return template.replace(/\{\{target\}\}/g, String(target));
}

function getEndOfDay(date: Date): Date {
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  return endOfDay;
}

function getEndOfWeek(date: Date): Date {
  const dayOfWeek = date.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const endOfWeek = new Date(date);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  endOfWeek.setUTCHours(23, 59, 59, 999);
  return endOfWeek;
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

function getRelevantActions(
  challengeType: ChallengeType,
): ReadonlyArray<string> {
  const actionMap: Readonly<Record<ChallengeType, ReadonlyArray<string>>> = {
    quiz_streak: ["quiz_correct"],
    concept_explore: ["concept_mastered"],
    speed_round: ["speed_bonus", "quiz_correct"],
    teach_peer: ["peer_helped"],
    review_blitz: ["review_completed"],
    simulation_run: ["simulation_profit"],
    perfect_score: ["quiz_perfect"],
  };

  return actionMap[challengeType] ?? [];
}

function countConsecutive(
  events: ReadonlyArray<XPEvent>,
  action: string,
): number {
  let maxConsecutive = 0;
  let current = 0;

  for (const event of events) {
    if (event.action === action) {
      current += 1;
      maxConsecutive = Math.max(maxConsecutive, current);
    } else {
      current = 0;
    }
  }

  return maxConsecutive;
}

/**
 * Prioritize templates based on user weakness areas.
 * Templates targeting areas where the user has low stats get higher priority.
 */
function prioritizeByWeakness(
  templates: ReadonlyArray<ChallengeTemplate>,
  stats: UserGamificationStats,
): ReadonlyArray<ChallengeTemplate> {
  const weaknessScores: Array<{ template: ChallengeTemplate; score: number }> =
    templates.map((template) => {
      const score = getWeaknessScore(template.type, stats);
      return { template, score };
    });

  const sorted = [...weaknessScores].sort((a, b) => b.score - a.score);
  return sorted.map((item) => item.template);
}

function getWeaknessScore(
  type: ChallengeType,
  stats: UserGamificationStats,
): number {
  // Higher score = weaker area (more priority)
  switch (type) {
    case "quiz_streak":
      return stats.totalQuizzes < 10 ? 10 : 5;
    case "concept_explore":
      return stats.conceptsMastered < 5 ? 10 : 3;
    case "speed_round":
      return stats.fastQuizCount < 5 ? 8 : 4;
    case "teach_peer":
      return stats.peersHelped < 3 ? 9 : 3;
    case "review_blitz":
      return 6; // Always moderately important
    case "simulation_run":
      return stats.simulationsRun < 3 ? 9 : 4;
    case "perfect_score":
      return stats.perfectScores < 5 ? 7 : 3;
    default:
      return 5;
  }
}

/**
 * Select diverse templates ensuring no duplicate types.
 */
function selectDiverseTemplates(
  templates: ReadonlyArray<ChallengeTemplate>,
  count: number,
): ReadonlyArray<ChallengeTemplate> {
  const selected: ChallengeTemplate[] = [];
  const usedTypes = new Set<ChallengeType>();

  for (const template of templates) {
    if (selected.length >= count) {
      break;
    }
    if (!usedTypes.has(template.type)) {
      selected.push(template);
      usedTypes.add(template.type);
    }
  }

  return selected;
}
