/**
 * skill.estate.royalty_repricing_advisor — suggest royalty/price adjustments per consignment.
 *
 * Balances market-price gap, available-capacity risk, and buyer stability.
 * Emits a recommended new price within the owner's min/max bounds and the
 * expected renewal probability.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const ConsignmentRepricingRowSchema = z.object({
  consignmentId: z.string().min(1),
  currentPrice: z.number().positive(),
  marketPrice: z.number().positive(),
  buyerPaymentScore: z.number().min(0).max(1),
  buyerTenureMonths: z.number().int().nonnegative(),
  availableCapacityRisk: z.number().min(0).max(1),
});
export type ConsignmentRepricingRow = z.infer<typeof ConsignmentRepricingRowSchema>;

export const RoyaltyRepricingParamsSchema = z.object({
  siteId: z.string().min(1),
  consignments: z.array(ConsignmentRepricingRowSchema).min(1).max(1000),
  maxIncreasePct: z.number().min(0).max(0.3).default(0.1),
  minFloorPrice: z.number().nonnegative().default(0),
});
export type RoyaltyRepricingParams = z.infer<typeof RoyaltyRepricingParamsSchema>;

export interface ConsignmentRepricingRecommendation {
  readonly consignmentId: string;
  readonly currentPrice: number;
  readonly recommendedPrice: number;
  readonly increasePct: number;
  readonly renewalAcceptanceProbability: number;
  readonly rationale: string;
}

export function adviseRoyaltyRepricing(
  params: RoyaltyRepricingParams
): {
  readonly siteId: string;
  readonly recommendations: readonly ConsignmentRepricingRecommendation[];
} {
  const parsed = RoyaltyRepricingParamsSchema.parse(params);
  const recs: ConsignmentRepricingRecommendation[] = parsed.consignments.map((c) => {
    const marketGap = (c.marketPrice - c.currentPrice) / c.currentPrice;
    let proposedPct = Math.max(0, Math.min(parsed.maxIncreasePct, marketGap));
    if (c.availableCapacityRisk > 0.3) proposedPct *= 0.5;
    if (c.buyerPaymentScore < 0.5) proposedPct = 0;
    if (c.buyerTenureMonths < 6) proposedPct *= 0.6;

    const recommendedPrice = Math.max(
      parsed.minFloorPrice,
      Math.round(c.currentPrice * (1 + proposedPct))
    );
    const acceptance =
      0.9 -
      proposedPct * 2 +
      c.buyerPaymentScore * 0.15 -
      c.availableCapacityRisk * 0.1 +
      Math.min(0.15, c.buyerTenureMonths / 120);

    const rationale =
      proposedPct === 0
        ? 'Holding price flat to retain a shaky buyer or prevent idle capacity.'
        : `Close ${Math.round(marketGap * 100)}% market gap, capped at ${Math.round(parsed.maxIncreasePct * 100)}%.`;

    return {
      consignmentId: c.consignmentId,
      currentPrice: c.currentPrice,
      recommendedPrice,
      increasePct: Math.round(proposedPct * 1000) / 1000,
      renewalAcceptanceProbability: Math.max(0, Math.min(1, Math.round(acceptance * 1000) / 1000)),
      rationale,
    };
  });
  return {
    siteId: parsed.siteId,
    recommendations: recs,
  };
}

export const royaltyRepricingAdvisorTool: ToolHandler = {
  name: 'skill.estate.royalty_repricing_advisor',
  description:
    'Recommend per-consignment price adjustments based on market gap, available-capacity risk, and buyer stability; caps at maxIncreasePct.',
  parameters: {
    type: 'object',
    required: ['siteId', 'consignments'],
    properties: {
      siteId: { type: 'string' },
      consignments: { type: 'array', items: { type: 'object' } },
      maxIncreasePct: { type: 'number' },
      minFloorPrice: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = RoyaltyRepricingParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = adviseRoyaltyRepricing(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Reprice advice for ${result.recommendations.length} consignment(s) on site ${result.siteId}`,
    };
  },
};
