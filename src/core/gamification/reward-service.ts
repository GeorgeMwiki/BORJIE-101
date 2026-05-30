/**
 * Gamification System — Reward & Privilege Service
 *
 * Manages reward redemption, privilege grants, and privilege
 * checks. Supports point-based, badge-based, and certificate-based
 * reward granting with expiration tracking.
 *
 * @module core/gamification/reward-service
 */

import { createServiceClient } from "@/lib/supabase/server";
import type {
  RewardDefinition,
  RewardRedemption,
  PrivilegeGrant,
} from "./types";
import { getBalance, spendPoints } from "./points-service";
import {
  POINT_REWARDS,
  getRewardById,
  getRewardForBadge,
  getRewardForCertificate,
  FEATURE_CODES,
} from "./reward-catalog";

// ============================================================================
// VALIDATION
// ============================================================================

function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required");
  }
}

function validateRewardId(rewardId: string): void {
  if (
    !rewardId ||
    typeof rewardId !== "string" ||
    rewardId.trim().length === 0
  ) {
    throw new Error("Valid rewardId is required");
  }
}

// ============================================================================
// GET AVAILABLE REWARDS
// ============================================================================

/**
 * Get rewards the user can currently afford.
 * Filters point-based rewards by the user's current balance.
 */
export async function getAvailableRewards(
  userId: string,
): Promise<ReadonlyArray<RewardDefinition>> {
  validateUserId(userId);

  const balance = await getBalance(userId);

  return POINT_REWARDS.filter(
    (reward) => reward.isActive && reward.pointsCost <= balance.currentBalance,
  );
}

// ============================================================================
// REDEEM REWARD
// ============================================================================

/**
 * Redeem a reward by spending points and creating the associated privilege.
 * Validates the reward exists, is active, and the user can afford it.
 *
 * @returns The RewardRedemption record
 */
export async function redeemReward(
  userId: string,
  rewardId: string,
): Promise<RewardRedemption> {
  validateUserId(userId);
  validateRewardId(rewardId);

  const reward = getRewardById(rewardId);
  if (!reward) {
    throw new Error(`Reward not found: ${rewardId}`);
  }
  if (!reward.isActive) {
    throw new Error(`Reward is not active: ${rewardId}`);
  }

  // Handle streak freeze reward specially
  if (reward.featureCode === FEATURE_CODES.STREAK_FREEZE) {
    return await redeemStreakFreeze(userId, reward);
  }

  // Spend points (validates balance internally)
  if (reward.pointsCost > 0) {
    await spendPoints(userId, reward.pointsCost, `Redeemed: ${reward.name}`);
  }

  const supabase = createServiceClient();
  const now = new Date();
  const expiresAt = reward.durationHours
    ? new Date(now.getTime() + reward.durationHours * 3600000)
    : null;

  // Create redemption record
  const { data: redemption, error: redeemError } = await supabase
    .from("reward_redemptions")
    .insert({
      user_id: userId,
      reward_id: rewardId,
      redeemed_at: now.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (redeemError) {
    throw new Error(`Failed to create redemption: ${redeemError.message}`);
  }

  // Create privilege grant if reward unlocks a feature
  if (reward.featureCode) {
    await createPrivilegeGrant(
      userId,
      "points",
      rewardId,
      reward.featureCode,
      expiresAt,
    );
  }

  return mapRedemption(redemption);
}

// ============================================================================
// GET ACTIVE PRIVILEGES
// ============================================================================

/**
 * Get all active (non-expired) privilege grants for a user.
 */
export async function getActivePrivileges(
  userId: string,
): Promise<ReadonlyArray<PrivilegeGrant>> {
  validateUserId(userId);

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("privilege_grants")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  if (error) {
    throw new Error(`Failed to fetch privileges: ${error.message}`);
  }

  return (data ?? []).map(mapPrivilege);
}

// ============================================================================
// HAS PRIVILEGE
// ============================================================================

/**
 * Check if a user currently has an active privilege for a feature.
 */
export async function hasPrivilege(
  userId: string,
  featureCode: string,
): Promise<boolean> {
  validateUserId(userId);

  if (!featureCode || typeof featureCode !== "string") {
    throw new Error("Valid featureCode is required");
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { count, error } = await supabase
    .from("privilege_grants")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("feature_code", featureCode)
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  if (error) {
    throw new Error(`Failed to check privilege: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

// ============================================================================
// GRANT PRIVILEGE FROM BADGE
// ============================================================================

/**
 * Grant a privilege based on a badge achievement.
 * Returns null if no reward is associated with the badge.
 */
export async function grantPrivilegeFromBadge(
  userId: string,
  badgeId: string,
): Promise<PrivilegeGrant | null> {
  validateUserId(userId);

  if (!badgeId || typeof badgeId !== "string") {
    throw new Error("Valid badgeId is required");
  }

  const reward = getRewardForBadge(badgeId);
  if (!reward) {
    return null;
  }

  const now = new Date();
  const expiresAt = reward.durationHours
    ? new Date(now.getTime() + reward.durationHours * 3600000)
    : null;

  if (!reward.featureCode) {
    return null;
  }

  return await createPrivilegeGrant(
    userId,
    "badge",
    badgeId,
    reward.featureCode,
    expiresAt,
  );
}

// ============================================================================
// GRANT PRIVILEGE FROM CERTIFICATE
// ============================================================================

/**
 * Grant a privilege based on a certificate level.
 * Returns null if no reward is associated with the certificate level.
 */
export async function grantPrivilegeFromCertificate(
  userId: string,
  certificateLevel: string,
): Promise<PrivilegeGrant | null> {
  validateUserId(userId);

  if (!certificateLevel || typeof certificateLevel !== "string") {
    throw new Error("Valid certificateLevel is required");
  }

  const reward = getRewardForCertificate(certificateLevel);
  if (!reward) {
    return null;
  }

  const now = new Date();
  const expiresAt = reward.durationHours
    ? new Date(now.getTime() + reward.durationHours * 3600000)
    : null;

  if (!reward.featureCode) {
    return null;
  }

  return await createPrivilegeGrant(
    userId,
    "certificate",
    certificateLevel,
    reward.featureCode,
    expiresAt,
  );
}

// ============================================================================
// CLEANUP EXPIRED PRIVILEGES
// ============================================================================

/**
 * Deactivate privileges that have expired.
 * Designed to be called from a periodic cron job.
 *
 * @returns Number of privileges deactivated
 */
export async function cleanupExpiredPrivileges(): Promise<number> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("privilege_grants")
    .update({ is_active: false })
    .eq("is_active", true)
    .lt("expires_at", now)
    .not("expires_at", "is", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to cleanup expired privileges: ${error.message}`);
  }

  return data?.length ?? 0;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Handle streak freeze redemption by updating the streak record directly.
 */
async function redeemStreakFreeze(
  userId: string,
  reward: RewardDefinition,
): Promise<RewardRedemption> {
  // Spend points
  if (reward.pointsCost > 0) {
    await spendPoints(userId, reward.pointsCost, `Redeemed: ${reward.name}`);
  }

  const supabase = createServiceClient();

  // Increment freezes_available in streak_records
  const { data: streakData } = await supabase
    .from("streak_records")
    .select("freezes_available")
    .eq("user_id", userId)
    .maybeSingle();

  const currentFreezes = streakData?.freezes_available ?? 2;

  await supabase.from("streak_records").upsert(
    {
      user_id: userId,
      freezes_available: currentFreezes + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // Create redemption record
  const { data: redemption, error: redeemError } = await supabase
    .from("reward_redemptions")
    .insert({
      user_id: userId,
      reward_id: reward.id,
      redeemed_at: new Date().toISOString(),
      expires_at: null,
      is_active: true,
    })
    .select()
    .single();

  if (redeemError) {
    throw new Error(`Failed to create redemption: ${redeemError.message}`);
  }

  return mapRedemption(redemption);
}

/**
 * Create a privilege grant record in the database.
 */
async function createPrivilegeGrant(
  userId: string,
  source: PrivilegeGrant["source"],
  sourceId: string,
  featureCode: string,
  expiresAt: Date | null,
): Promise<PrivilegeGrant> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("privilege_grants")
    .insert({
      user_id: userId,
      source,
      source_id: sourceId,
      feature_code: featureCode,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt?.toISOString() ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create privilege grant: ${error.message}`);
  }

  return mapPrivilege(data);
}

/**
 * Map a database row to a RewardRedemption object.
 */
function mapRedemption(row: Record<string, unknown>): RewardRedemption {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    rewardId: row.reward_id as string,
    redeemedAt: new Date(row.redeemed_at as string),
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    isActive: row.is_active as boolean,
  };
}

/**
 * Map a database row to a PrivilegeGrant object.
 */
function mapPrivilege(row: Record<string, unknown>): PrivilegeGrant {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    source: row.source as PrivilegeGrant["source"],
    sourceId: (row.source_id as string) ?? null,
    featureCode: row.feature_code as string,
    grantedAt: new Date(row.granted_at as string),
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    isActive: row.is_active as boolean,
  };
}
