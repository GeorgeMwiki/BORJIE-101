/**
 * Reward event — append-only event type for the gamification bundle.
 *
 * All state changes produce a new reward_event row. Dedup via
 * `dedupKey` (e.g. paymentId + eventType). Consumers never mutate
 * prior events.
 */
import type { RewardTier } from './reward-policy.js';

export type RewardEventType =
  | 'payment_posted'
  | 'on_time_payment'
  | 'early_payment'
  | 'late_payment'
  | 'streak_continued'
  | 'streak_broken'
  | 'tier_upgraded'
  | 'tier_downgraded'
  | 'early_pay_credit_granted'
  | 'early_pay_credit_redeemed'
  | 'cashback_queued'
  | 'cashback_paid'
  | 'late_fee_applied'
  | 'policy_updated';

export interface RewardEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly eventType: RewardEventType;
  readonly policyId: string | null;
  readonly scoreDelta: number;
  readonly creditDeltaMinor: number;
  readonly cashbackDeltaMinor: number;
  readonly currency: string | null;
  readonly paymentId: string | null;
  readonly invoiceId: string | null;
  readonly fromTier: RewardTier | null;
  readonly toTier: RewardTier | null;
  readonly payload: Record<string, unknown>;
  readonly dedupKey: string | null;
  readonly occurredAt: string;
  readonly createdAt: string;
}

export function newRewardEvent(
  fields: Omit<RewardEvent, 'id' | 'createdAt'> & { id: string }
): RewardEvent {
  return {
    ...fields,
    createdAt: new Date().toISOString(),
  };
}
