/**
 * Gamification System — Leaderboard Service
 *
 * Manages global and organization leaderboards, user rankings,
 * and percentile calculations. Uses cached leaderboard data
 * for performance with periodic refresh.
 *
 * @module core/gamification/leaderboard-service
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { LeaderboardEntry, UserRank } from "./types";

// ============================================================================
// VALIDATION
// ============================================================================

function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required");
  }
}

function validateLimit(limit: number): void {
  if (typeof limit !== "number" || limit < 1 || limit > 500) {
    throw new Error("Limit must be between 1 and 500");
  }
}

function validateOffset(offset: number): void {
  if (typeof offset !== "number" || offset < 0) {
    throw new Error("Offset must be non-negative");
  }
}

// ============================================================================
// GLOBAL LEADERBOARD
// ============================================================================

/**
 * Get the global leaderboard, sorted by total points descending.
 * Uses the leaderboard_cache table for fast retrieval.
 */
export async function getGlobalLeaderboard(
  limit: number = 50,
  offset: number = 0,
): Promise<ReadonlyArray<LeaderboardEntry>> {
  validateLimit(limit);
  validateOffset(offset);

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("leaderboard_cache")
    .select("*")
    .eq("period", "all_time")
    .order("total_points", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch global leaderboard: ${error.message}`);
  }

  return (data ?? []).map((row, index) =>
    mapLeaderboardEntry(row, offset + index + 1),
  );
}

// ============================================================================
// ORGANIZATION LEADERBOARD
// ============================================================================

/**
 * Get the leaderboard for a specific organization.
 * Joins leaderboard_cache with organization membership.
 */
export async function getOrganizationLeaderboard(
  orgId: string,
  limit: number = 50,
): Promise<ReadonlyArray<LeaderboardEntry>> {
  if (!orgId || typeof orgId !== "string" || orgId.trim().length === 0) {
    throw new Error("Valid orgId is required");
  }
  validateLimit(limit);

  const supabase = createServiceClient();

  // Get organization members
  const { data: members, error: membersError } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  if (membersError) {
    throw new Error(
      `Failed to fetch organization members: ${membersError.message}`,
    );
  }

  if (!members || members.length === 0) {
    return [];
  }

  const memberIds = members.map((m) => m.user_id);

  const { data, error } = await supabase
    .from("leaderboard_cache")
    .select("*")
    .eq("period", "all_time")
    .in("user_id", memberIds)
    .order("total_points", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch org leaderboard: ${error.message}`);
  }

  return (data ?? []).map((row, index) => mapLeaderboardEntry(row, index + 1));
}

// ============================================================================
// USER RANK
// ============================================================================

/**
 * Get a specific user's rank in the global leaderboard.
 * Returns rank, total participants, and percentile.
 */
export async function getUserRank(userId: string): Promise<UserRank> {
  validateUserId(userId);

  const supabase = createServiceClient();

  // Get user's points
  const { data: userEntry, error: userError } = await supabase
    .from("leaderboard_cache")
    .select("total_points")
    .eq("user_id", userId)
    .eq("period", "all_time")
    .maybeSingle();

  if (userError) {
    throw new Error(`Failed to fetch user rank: ${userError.message}`);
  }

  // Get total participants
  const { count: totalCount, error: countError } = await supabase
    .from("leaderboard_cache")
    .select("user_id", { count: "exact", head: true })
    .eq("period", "all_time");

  if (countError) {
    throw new Error(
      `Failed to count leaderboard entries: ${countError.message}`,
    );
  }

  const total = totalCount ?? 0;

  if (!userEntry || total === 0) {
    return { rank: 0, total, percentile: 0 };
  }

  // Count users with more points (rank = users above + 1)
  const { count: aboveCount, error: aboveError } = await supabase
    .from("leaderboard_cache")
    .select("user_id", { count: "exact", head: true })
    .eq("period", "all_time")
    .gt("total_points", userEntry.total_points);

  if (aboveError) {
    throw new Error(`Failed to compute rank: ${aboveError.message}`);
  }

  const rank = (aboveCount ?? 0) + 1;
  const percentile =
    total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;

  return { rank, total, percentile };
}

// ============================================================================
// REFRESH LEADERBOARD CACHE
// ============================================================================

/**
 * Refresh the leaderboard cache from point_balances.
 * Designed to be called from a periodic cron job.
 *
 * @returns Number of entries refreshed
 */
export async function refreshLeaderboardCache(): Promise<number> {
  const supabase = createServiceClient();

  // Fetch all balances with profile data
  const { data: balances, error: balanceError } = await supabase
    .from("point_balances")
    .select("user_id, total_earned, current_balance");

  if (balanceError) {
    throw new Error(`Failed to fetch balances: ${balanceError.message}`);
  }

  if (!balances || balances.length === 0) {
    return 0;
  }

  // Fetch streak data for all users
  const userIds = balances.map((b) => b.user_id);
  const { data: streaks } = await supabase
    .from("streak_records")
    .select("user_id, current_streak")
    .in("user_id", userIds);

  const streakMap = new Map(
    (streaks ?? []).map((s) => [s.user_id, s.current_streak ?? 0]),
  );

  // Build cache entries
  const cacheEntries = balances.map((b) => ({
    user_id: b.user_id,
    display_name: "",
    total_points: b.total_earned ?? 0,
    badge_count: 0,
    current_streak: streakMap.get(b.user_id) ?? 0,
    rank: 0,
    period: "all_time",
    updated_at: new Date().toISOString(),
  }));

  // Sort by points and assign ranks
  const sorted = [...cacheEntries].sort(
    (a, b) => b.total_points - a.total_points,
  );
  const ranked = sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));

  // Upsert in batches (Supabase limit)
  const batchSize = 100;
  let refreshedCount = 0;

  for (let i = 0; i < ranked.length; i += batchSize) {
    const batch = ranked.slice(i, i + batchSize);
    const { error: upsertError } = await supabase
      .from("leaderboard_cache")
      .upsert(batch, { onConflict: "user_id,period" });

    if (!upsertError) {
      refreshedCount += batch.length;
    }
  }

  return refreshedCount;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Map a database row to a LeaderboardEntry object.
 */
function mapLeaderboardEntry(
  row: Record<string, unknown>,
  computedRank: number,
): LeaderboardEntry {
  return {
    userId: row.user_id as string,
    displayName: (row.display_name as string) || "Anonymous",
    points: (row.total_points as number) ?? 0,
    rank: (row.rank as number) || computedRank,
    badges: (row.badge_count as number) ?? 0,
    streak: (row.current_streak as number) ?? 0,
  };
}
