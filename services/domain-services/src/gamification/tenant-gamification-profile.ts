/**
 * Tenant gamification profile — entity representation for per-customer
 * state (Layer 1 score/tier, Layer 2 early-pay credit, Layer 3 cashback
 * accumulators).
 *
 * Snapshots are append-only; the current state is the row with the
 * latest asOf for a (tenantId, customerId) pair.
 */
import type { RewardTier } from './reward-policy.js';

export interface TenantGamificationProfile {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;

  // Layer 1
  readonly score: number;
  readonly tier: RewardTier;
  readonly streakMonths: number;
  readonly longestStreakMonths: number;
  readonly totalOnTimePayments: number;
  readonly totalLatePayments: number;

  // Layer 2
  readonly earlyPayCreditBalanceMinor: number;
  readonly earlyPayCreditCurrency: string | null;

  // Layer 3
  readonly cashbackMonthToDateMinor: number;
  readonly cashbackLifetimeMinor: number;

  // Provenance
  readonly asOf: string;
  readonly sourceEventId: string | null;
  readonly createdAt: string;
}

export function initialProfile(args: {
  id: string;
  tenantId: string;
  customerId: string;
  currency?: string;
  now: Date;
}): TenantGamificationProfile {
  const iso = args.now.toISOString();
  return {
    id: args.id,
    tenantId: args.tenantId,
    customerId: args.customerId,
    score: 0,
    tier: 'bronze',
    streakMonths: 0,
    longestStreakMonths: 0,
    totalOnTimePayments: 0,
    totalLatePayments: 0,
    earlyPayCreditBalanceMinor: 0,
    earlyPayCreditCurrency: args.currency ?? null,
    cashbackMonthToDateMinor: 0,
    cashbackLifetimeMinor: 0,
    asOf: iso,
    sourceEventId: null,
    createdAt: iso,
  };
}
