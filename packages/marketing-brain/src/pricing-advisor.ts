/**
 * Pricing Advisor — suggests a tier based on portfolio size + role.
 *
 * Pure data. The gateway wraps this and returns the advice as a structured
 * marketing-chat card. Mr. Mwikila quotes the monthly price and explains
 * what's included.
 */

import { z } from 'zod';

export const PricingTierSchema = z.enum(['starter', 'growth', 'estate', 'enterprise']);
export type PricingTier = z.infer<typeof PricingTierSchema>;

export interface TierDefinition {
  readonly id: PricingTier;
  readonly name: string;
  readonly priceMonthlyUsd: number;
  readonly unitCeiling: number;
  readonly includes: readonly string[];
  readonly aiCopilotTurnsPerMonth: number;
  readonly audienceSummary: string;
}

export const TIERS: readonly TierDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceMonthlyUsd: 19,
    unitCeiling: 10,
    aiCopilotTurnsPerMonth: 500,
    audienceSummary: 'Solo owners with up to 10 units. Manual-first, AI where it helps.',
    includes: [
      'Rent & service-charge tracking',
      'M-Pesa / Azam / MTN reconciliation',
      'Tenant & lease basics',
      'Mr. Mwikila AI copilot (500 turns/month)',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthlyUsd: 79,
    unitCeiling: 50,
    aiCopilotTurnsPerMonth: 3000,
    audienceSummary: 'Growing owners and small agencies running 11-50 units.',
    includes: [
      'Everything in Starter',
      'Maintenance work-order dispatch',
      'Owner reports on a schedule',
      'Tenant 5P health scoring',
      'Mr. Mwikila AI copilot (3,000 turns/month)',
    ],
  },
  {
    id: 'estate',
    name: 'Estate',
    priceMonthlyUsd: 249,
    unitCeiling: 250,
    aiCopilotTurnsPerMonth: 15000,
    audienceSummary: 'Estate managers and agencies running 51-250 units.',
    includes: [
      'Everything in Growth',
      'Multi-property dashboards',
      'IoT gate / meter integration',
      'Compliance plugins (KE, TZ, UG)',
      'Station-master voice-log module',
      'Mr. Mwikila AI copilot (15,000 turns/month)',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthlyUsd: 0,
    unitCeiling: Number.POSITIVE_INFINITY,
    aiCopilotTurnsPerMonth: Number.POSITIVE_INFINITY,
    audienceSummary: 'Portfolios above 250 units. Priced by scope.',
    includes: [
      'Everything in Estate',
      'Dedicated tenant instance',
      'Custom compliance plugins',
      'White-label portals',
      'SLA-backed support',
    ],
  },
];

export const PricingAdviceInputSchema = z.object({
  unitCount: z.number().int().nonnegative().optional(),
  portfolioSize: z.enum(['micro', 'small', 'mid', 'large']).optional(),
  role: z.enum(['owner', 'tenant', 'manager', 'station_master', 'unknown']).optional(),
  country: z.enum(['KE', 'TZ', 'UG', 'other']).optional(),
});

export interface PricingAdvice {
  readonly recommendedTier: PricingTier;
  readonly rationale: string;
  readonly alternativeTier: PricingTier | null;
  readonly monthlyPriceUsd: number;
  readonly breakdown: {
    readonly tier: TierDefinition;
    readonly reasonsToChoose: readonly string[];
  };
}

export function adviseTier(input: z.infer<typeof PricingAdviceInputSchema>): PricingAdvice {
  const parsed = PricingAdviceInputSchema.parse(input);

  const estimatedUnits = parsed.unitCount ?? estimateUnitsFromSize(parsed.portfolioSize);

  const tier = TIERS.find((t) => estimatedUnits <= t.unitCeiling) ?? TIERS[TIERS.length - 1];

  const alternativeTier =
    tier.id === 'enterprise' || tier.id === 'starter'
      ? null
      : TIERS[TIERS.indexOf(tier) + 1]?.id ?? null;

  const reasonsToChoose: string[] = [];
  if (parsed.role === 'manager') reasonsToChoose.push('You manage on behalf of owners — the Estate tier unlocks owner reporting.');
  if (parsed.role === 'station_master') reasonsToChoose.push('Station-master voice logging is included from the Estate tier up.');
  if (estimatedUnits > 0) reasonsToChoose.push(`Your ~${estimatedUnits} units fit inside the ${tier.name} ceiling of ${tier.unitCeiling === Number.POSITIVE_INFINITY ? 'unlimited' : tier.unitCeiling}.`);
  if (parsed.country && parsed.country !== 'other') reasonsToChoose.push(`Compliance plugin for ${parsed.country} is bundled from the Estate tier.`);

  const rationale = parsed.unitCount
    ? `Based on ${parsed.unitCount} units, the ${tier.name} tier fits you today.`
    : `Based on a ${parsed.portfolioSize ?? 'small'} portfolio, the ${tier.name} tier fits you today.`;

  return {
    recommendedTier: tier.id,
    rationale,
    alternativeTier,
    monthlyPriceUsd: tier.priceMonthlyUsd,
    breakdown: { tier, reasonsToChoose },
  };
}

function estimateUnitsFromSize(size: z.infer<typeof PricingAdviceInputSchema>['portfolioSize']): number {
  if (size === 'micro') return 5;
  if (size === 'small') return 20;
  if (size === 'mid') return 100;
  if (size === 'large') return 400;
  return 5;
}
