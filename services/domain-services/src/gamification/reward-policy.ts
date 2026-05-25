/**
 * Reward policy — types and validation for the gamification bundle
 * (NEW 9). Implements the 3-layer Till-model described in
 * Docs/analysis/RESEARCH_ANSWERS.md Q3.
 */
import { z } from 'zod';

export const RewardTierSchema = z.enum(['bronze', 'silver', 'gold', 'platinum']);
export type RewardTier = z.infer<typeof RewardTierSchema>;

export const CashbackProviderSchema = z.enum([
  'mpesa_b2c',
  'airtel_b2c',
  'tigopesa_b2c',
]);
export type CashbackProvider = z.infer<typeof CashbackProviderSchema>;

export const RewardPolicySchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    version: z.number().int().positive().default(1),
    active: z.boolean().default(true),

    // Layer 1 — scoring
    onTimePoints: z.number().int().default(10),
    earlyPaymentBonusPoints: z.number().int().default(5),
    latePenaltyPoints: z.number().int().default(-15),
    streakBonusPoints: z.number().int().default(2),

    // Tier thresholds (ascending)
    bronzeThreshold: z.number().int().default(0),
    silverThreshold: z.number().int().default(100),
    goldThreshold: z.number().int().default(300),
    platinumThreshold: z.number().int().default(600),

    // Layer 2 — early-pay credit (off-ledger bucket)
    earlyPayDiscountBps: z.number().int().min(0).max(10000).default(0),
    earlyPayMinDaysBefore: z.number().int().min(0).default(3),
    earlyPayMaxCreditMinor: z.number().int().min(0).default(0),

    // Late fee (structural, not reward but paired with policy)
    lateFeeBps: z.number().int().min(0).max(10000).default(0),
    lateFeeGraceDays: z.number().int().min(0).default(3),
    lateFeeMaxMinor: z.number().int().min(0).default(0),

    // Layer 3 — MNO cashback (optional)
    cashbackEnabled: z.boolean().default(false),
    cashbackBps: z.number().int().min(0).max(10000).default(0),
    cashbackMonthlyCapMinor: z.number().int().min(0).default(0),
    cashbackProvider: CashbackProviderSchema.optional(),

    extra: z.record(z.string(), z.unknown()).default({}),

    createdAt: z.string().datetime(),
    createdBy: z.string().optional(),
    effectiveFrom: z.string().datetime(),
    effectiveUntil: z.string().datetime().optional(),
  })
  .refine(
    (p) =>
      p.bronzeThreshold <= p.silverThreshold &&
      p.silverThreshold <= p.goldThreshold &&
      p.goldThreshold <= p.platinumThreshold,
    { message: 'Tier thresholds must be ascending' }
  )
  .refine(
    (p) => (!p.cashbackEnabled ? true : p.cashbackProvider !== undefined),
    { message: 'cashbackProvider required when cashback is enabled' }
  );

export type RewardPolicy = z.infer<typeof RewardPolicySchema>;

export function tierForScore(policy: RewardPolicy, score: number): RewardTier {
  if (score >= policy.platinumThreshold) return 'platinum';
  if (score >= policy.goldThreshold) return 'gold';
  if (score >= policy.silverThreshold) return 'silver';
  return 'bronze';
}

export const DEFAULT_REWARD_POLICY: Omit<
  RewardPolicy,
  'id' | 'tenantId' | 'createdAt' | 'effectiveFrom'
> = {
  version: 1,
  active: true,
  onTimePoints: 10,
  earlyPaymentBonusPoints: 5,
  latePenaltyPoints: -15,
  streakBonusPoints: 2,
  bronzeThreshold: 0,
  silverThreshold: 100,
  goldThreshold: 300,
  platinumThreshold: 600,
  earlyPayDiscountBps: 0,
  earlyPayMinDaysBefore: 3,
  earlyPayMaxCreditMinor: 0,
  lateFeeBps: 0,
  lateFeeGraceDays: 3,
  lateFeeMaxMinor: 0,
  cashbackEnabled: false,
  cashbackBps: 0,
  cashbackMonthlyCapMinor: 0,
  extra: {},
};
