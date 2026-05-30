/**
 * Gamification Engine v2 -- Stats Assembler
 *
 * Queries learning tables in parallel to build the UserGamificationStats
 * object required by the achievement system and challenge generator.
 *
 * All queries use the service client (bypasses RLS) since this is
 * called from authenticated API routes that have already verified the user.
 *
 * @module core/gamification/stats-assembler
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserGamificationStats } from "./xp-types";

// ============================================================================
// DEFAULT STATS
// ============================================================================

// eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
const DEFAULT_STATS: Omit<UserGamificationStats, "userId"> = {
  totalQuizzes: 0,
  perfectScores: 0,
  conceptsMastered: 0,
  proMasteries: 0,
  totalSessions: 0,
  classroomSessions: 0,
  peersHelped: 0,
  debatesParticipated: 0,
  simulationsRun: 0,
  profitableSimulations: 0,
  fastestQuizSeconds: 0,
  fastQuizCount: 0,
  financialCalcsCompleted: 0,
  cashFlowMastered: false,
  fiveCAnalysisPassed: 0,
  blockTypesExplored: 0,
  nightSessions: 0,
  earlySessions: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalXP: 0,
};

// ============================================================================
// ASSEMBLE USER GAMIFICATION STATS
// ============================================================================

/**
 * Build a complete UserGamificationStats object by querying
 * learning tables in parallel. Gracefully falls back to defaults
 * when tables or rows are missing.
 */
export async function assembleUserGamificationStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserGamificationStats> {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required for stats assembly");
  }

  const [
    learningProgress,
    streakRecord,
    pointBalance,
    xpEvents,
    conceptMastery,
  ] = await Promise.all([
    fetchLearningProgress(supabase, userId),
    fetchStreakRecord(supabase, userId),
    fetchPointBalance(supabase, userId),
    fetchXPEventCounts(supabase, userId),
    fetchConceptMastery(supabase, userId),
  ]);

  return {
    userId,
    totalQuizzes: learningProgress.totalQuizzes,
    perfectScores: learningProgress.perfectScores,
    conceptsMastered: conceptMastery.totalMastered,
    proMasteries: conceptMastery.proMasteries,
    totalSessions: learningProgress.totalSessions,
    classroomSessions: xpEvents.classroomSessions,
    peersHelped: xpEvents.peersHelped,
    debatesParticipated: xpEvents.debatesParticipated,
    simulationsRun: xpEvents.simulationsRun,
    profitableSimulations: xpEvents.profitableSimulations,
    fastestQuizSeconds: learningProgress.fastestQuizSeconds,
    fastQuizCount: learningProgress.fastQuizCount,
    financialCalcsCompleted: xpEvents.financialCalcsCompleted,
    cashFlowMastered: conceptMastery.cashFlowMastered,
    fiveCAnalysisPassed: xpEvents.fiveCAnalysisPassed,
    blockTypesExplored: xpEvents.blockTypesExplored,
    nightSessions: xpEvents.nightSessions,
    earlySessions: xpEvents.earlySessions,
    currentStreak: streakRecord.currentStreak,
    longestStreak: streakRecord.longestStreak,
    totalXP: pointBalance.totalXP,
  };
}

// ============================================================================
// INTERNAL QUERY HELPERS
// ============================================================================

interface LearningProgressResult {
  readonly totalQuizzes: number;
  readonly perfectScores: number;
  readonly totalSessions: number;
  readonly fastestQuizSeconds: number;
  readonly fastQuizCount: number;
}

async function fetchLearningProgress(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningProgressResult> {
  const { data, error } = await supabase
    .from("borrower_learning_progress")
    .select("total_xp, current_streak, completed_lessons, badges")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      totalQuizzes: 0,
      perfectScores: 0,
      totalSessions: 0,
      fastestQuizSeconds: 0,
      fastQuizCount: 0,
    };
  }

  const completedLessons = Array.isArray(data.completed_lessons)
    ? data.completed_lessons
    : [];

  return {
    totalQuizzes: completedLessons.length,
    perfectScores: 0,
    totalSessions: completedLessons.length,
    fastestQuizSeconds: 0,
    fastQuizCount: 0,
  };
}

interface StreakResult {
  readonly currentStreak: number;
  readonly longestStreak: number;
}

async function fetchStreakRecord(
  supabase: SupabaseClient,
  userId: string,
): Promise<StreakResult> {
  const { data, error } = await supabase
    .from("streak_records")
    .select("current_streak, longest_streak")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  return {
    currentStreak: data.current_streak ?? 0,
    longestStreak: data.longest_streak ?? 0,
  };
}

interface PointBalanceResult {
  readonly totalXP: number;
}

async function fetchPointBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<PointBalanceResult> {
  const { data, error } = await supabase
    .from("point_balances")
    .select("total_earned")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { totalXP: 0 };
  }

  return { totalXP: data.total_earned ?? 0 };
}

interface XPEventCounts {
  readonly classroomSessions: number;
  readonly peersHelped: number;
  readonly debatesParticipated: number;
  readonly simulationsRun: number;
  readonly profitableSimulations: number;
  readonly financialCalcsCompleted: number;
  readonly fiveCAnalysisPassed: number;
  readonly blockTypesExplored: number;
  readonly nightSessions: number;
  readonly earlySessions: number;
}

async function fetchXPEventCounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<XPEventCounts> {
  const { data, error } = await supabase
    .from("point_transactions")
    .select("action")
    .eq("user_id", userId)
    .eq("type", "earn");

  if (error || !data) {
    return {
      classroomSessions: 0,
      peersHelped: 0,
      debatesParticipated: 0,
      simulationsRun: 0,
      profitableSimulations: 0,
      financialCalcsCompleted: 0,
      fiveCAnalysisPassed: 0,
      blockTypesExplored: 0,
      nightSessions: 0,
      earlySessions: 0,
    };
  }

  const actionCounts = new Map<string, number>();
  for (const row of data) {
    const action = row.action as string;
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
  }

  return {
    classroomSessions: actionCounts.get("group_session_complete") ?? 0,
    peersHelped: actionCounts.get("help_peer") ?? 0,
    debatesParticipated: actionCounts.get("feedback_given") ?? 0,
    simulationsRun: actionCounts.get("project_milestone") ?? 0,
    profitableSimulations: actionCounts.get("review_5_star") ?? 0,
    financialCalcsCompleted: actionCounts.get("material_upload_a") ?? 0,
    fiveCAnalysisPassed: actionCounts.get("material_upload_b") ?? 0,
    blockTypesExplored: actionCounts.get("material_upload_c") ?? 0,
    nightSessions: actionCounts.get("time_spent_30min") ?? 0,
    earlySessions: actionCounts.get("daily_login") ?? 0,
  };
}

interface ConceptMasteryResult {
  readonly totalMastered: number;
  readonly proMasteries: number;
  readonly cashFlowMastered: boolean;
}

async function fetchConceptMastery(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConceptMasteryResult> {
  const { data, error } = await supabase
    .from("concept_mastery")
    .select("concept_id, mastery_level, difficulty_level")
    .eq("user_id", userId);

  if (error || !data) {
    return { totalMastered: 0, proMasteries: 0, cashFlowMastered: false };
  }

  const mastered = data.filter((row) => (row.mastery_level ?? 0) >= 0.8);
  const proMastered = data.filter(
    (row) => row.difficulty_level === "pro" && (row.mastery_level ?? 0) >= 0.8,
  );
  const cashFlowMastered = data.some(
    (row) =>
      (row.concept_id as string)?.includes("cash_flow") &&
      (row.mastery_level ?? 0) >= 0.8,
  );

  return {
    totalMastered: mastered.length,
    proMasteries: proMastered.length,
    cashFlowMastered,
  };
}
