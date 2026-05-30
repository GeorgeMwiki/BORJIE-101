/**
 * Gamification System — Points Service
 *
 * Manages point transactions, balances, and earning eligibility.
 * All operations are immutable and use Supabase for persistence.
 *
 * @module core/gamification/points-service
 */

import { createServiceClient } from "@/lib/supabase/server";
import type {
  PointTransaction,
  PointBalance,
  PointAction,
  EarningEligibility,
} from "./types";
import { getEarningRule, POINT_EARNING_RULES } from "./point-rules";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_BALANCE: Omit<PointBalance, "userId"> = {
  totalEarned: 0,
  totalSpent: 0,
  currentBalance: 0,
};

// ============================================================================
// VALIDATION
// ============================================================================

function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Valid userId is required");
  }
}

function validateAmount(amount: number): void {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive finite number");
  }
}

function validateAction(action: string): asserts action is PointAction {
  if (!action || !(action in POINT_EARNING_RULES)) {
    throw new Error(`Unknown point action: ${action}`);
  }
}

// ============================================================================
// AWARD POINTS
// ============================================================================

/**
 * Award points to a user for a specific action.
 * Validates earning eligibility (cooldowns, daily limits) before awarding.
 * Updates the user's balance atomically.
 *
 * @returns A new PointTransaction record
 */
export async function awardPoints(
  userId: string,
  action: PointAction,
  metadata?: Record<string, unknown>,
): Promise<PointTransaction> {
  validateUserId(userId);
  validateAction(action);

  const eligibility = await checkEarningEligibility(userId, action);
  if (!eligibility.eligible) {
    throw new Error(`Cannot award points: ${eligibility.reason}`);
  }

  const rule = getEarningRule(action);
  const supabase = createServiceClient();

  const transactionData = {
    user_id: userId,
    amount: rule.points,
    type: "earn" as const,
    action,
    source: action,
    description: rule.description,
    metadata: metadata ?? null,
  };

  const { data: transaction, error: txError } = await supabase
    .from("point_transactions")
    .insert(transactionData)
    .select()
    .single();

  if (txError) {
    throw new Error(`Failed to create point transaction: ${txError.message}`);
  }

  await upsertBalance(userId, rule.points, "earn");

  return mapTransaction(transaction);
}

// ============================================================================
// SPEND POINTS
// ============================================================================

/**
 * Spend points from a user's balance.
 * Validates sufficient balance before deducting.
 *
 * @returns A new PointTransaction record for the spend
 */
export async function spendPoints(
  userId: string,
  amount: number,
  reason: string,
): Promise<PointTransaction> {
  validateUserId(userId);
  validateAmount(amount);

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("Reason is required for spending points");
  }

  const balance = await getBalance(userId);
  if (balance.currentBalance < amount) {
    throw new Error(
      `Insufficient points: has ${balance.currentBalance}, needs ${amount}`,
    );
  }

  const supabase = createServiceClient();

  const transactionData = {
    user_id: userId,
    amount,
    type: "spend" as const,
    action: "redemption",
    source: "reward_redemption",
    description: reason,
    metadata: null,
  };

  const { data: transaction, error: txError } = await supabase
    .from("point_transactions")
    .insert(transactionData)
    .select()
    .single();

  if (txError) {
    throw new Error(`Failed to create spend transaction: ${txError.message}`);
  }

  await upsertBalance(userId, amount, "spend");

  return mapTransaction(transaction);
}

// ============================================================================
// GET BALANCE
// ============================================================================

/**
 * Get the current point balance for a user.
 * Returns a default zero balance if no record exists.
 */
export async function getBalance(userId: string): Promise<PointBalance> {
  validateUserId(userId);

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("point_balances")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch point balance: ${error.message}`);
  }

  if (!data) {
    return { userId, ...DEFAULT_BALANCE };
  }

  return {
    userId: data.user_id,
    totalEarned: data.total_earned ?? 0,
    totalSpent: data.total_spent ?? 0,
    currentBalance: data.current_balance ?? 0,
  };
}

// ============================================================================
// GET TRANSACTION HISTORY
// ============================================================================

/**
 * Get point transaction history for a user, ordered newest first.
 */
export async function getTransactionHistory(
  userId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<ReadonlyArray<PointTransaction>> {
  validateUserId(userId);

  if (limit < 1 || limit > 200) {
    throw new Error("Limit must be between 1 and 200");
  }
  if (offset < 0) {
    throw new Error("Offset must be non-negative");
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch transaction history: ${error.message}`);
  }

  return (data ?? []).map(mapTransaction);
}

// ============================================================================
// CHECK EARNING ELIGIBILITY
// ============================================================================

/**
 * Check if a user is eligible to earn points for a given action.
 * Validates cooldown periods and daily limits.
 */
export async function checkEarningEligibility(
  userId: string,
  action: PointAction,
): Promise<EarningEligibility> {
  validateUserId(userId);
  validateAction(action);

  const rule = getEarningRule(action);
  const supabase = createServiceClient();

  // Check cooldown
  if (rule.cooldownMinutes > 0) {
    const cooldownCutoff = new Date(
      Date.now() - rule.cooldownMinutes * 60 * 1000,
    ).toISOString();

    const { data: recentTx, error: cooldownError } = await supabase
      .from("point_transactions")
      .select("created_at")
      .eq("user_id", userId)
      .eq("action", action)
      .eq("type", "earn")
      .gte("created_at", cooldownCutoff)
      .order("created_at", { ascending: false })
      .limit(1);

    if (cooldownError) {
      throw new Error(`Failed to check cooldown: ${cooldownError.message}`);
    }

    if (recentTx && recentTx.length > 0) {
      const lastEarnedAt = new Date(recentTx[0].created_at).getTime();
      const cooldownEndsAt = lastEarnedAt + rule.cooldownMinutes * 60 * 1000;
      const remainingMs = Math.max(0, cooldownEndsAt - Date.now());
      const remainingMinutes = Math.ceil(remainingMs / 60000);

      return {
        eligible: false,
        reason: `Cooldown active: ${remainingMinutes} minute(s) remaining`,
        cooldownRemaining: remainingMinutes,
      };
    }
  }

  // Check daily limit
  if (rule.dailyLimit > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count, error: limitError } = await supabase
      .from("point_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .eq("type", "earn")
      .gte("created_at", todayStart.toISOString());

    if (limitError) {
      throw new Error(`Failed to check daily limit: ${limitError.message}`);
    }

    const todayCount = count ?? 0;
    if (todayCount >= rule.dailyLimit) {
      return {
        eligible: false,
        reason: `Daily limit reached: ${todayCount}/${rule.dailyLimit}`,
        cooldownRemaining: 0,
      };
    }
  }

  return {
    eligible: true,
    reason: "Eligible to earn",
    cooldownRemaining: 0,
  };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Upsert the user's point balance after a transaction.
 */
async function upsertBalance(
  userId: string,
  amount: number,
  type: "earn" | "spend",
): Promise<void> {
  const supabase = createServiceClient();

  const current = await getBalance(userId);

  const updatedBalance =
    type === "earn"
      ? {
          user_id: userId,
          total_earned: current.totalEarned + amount,
          total_spent: current.totalSpent,
          current_balance: current.currentBalance + amount,
          updated_at: new Date().toISOString(),
        }
      : {
          user_id: userId,
          total_earned: current.totalEarned,
          total_spent: current.totalSpent + amount,
          current_balance: current.currentBalance - amount,
          updated_at: new Date().toISOString(),
        };

  const { error } = await supabase
    .from("point_balances")
    .upsert(updatedBalance, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to update point balance: ${error.message}`);
  }
}

/**
 * Map a database row to a PointTransaction object.
 */
function mapTransaction(row: Record<string, unknown>): PointTransaction {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    amount: row.amount as number,
    type: row.type as PointTransaction["type"],
    source: row.source as string,
    description: row.description as string,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}
