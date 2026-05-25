/**
 * skill.estate.rent_repricing_advisor — suggest rent adjustments per unit.
 *
 * Balances market-rent gap, occupancy risk, and tenant stability. Emits
 * a recommended new rent within the owner's min/max bounds and the
 * expected renewal probability.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const UnitRepricingRowSchema = z.object({
  unitId: z.string().min(1),
  currentRent: z.number().positive(),
  marketRent: z.number().positive(),
  tenantPaymentScore: z.number().min(0).max(1),
  tenantTenureMonths: z.number().int().nonnegative(),
  vacancyRisk: z.number().min(0).max(1),
});
export type UnitRepricingRow = z.infer<typeof UnitRepricingRowSchema>;

export const RentRepricingParamsSchema = z.object({
  propertyId: z.string().min(1),
  units: z.array(UnitRepricingRowSchema).min(1).max(1000),
  maxIncreasePct: z.number().min(0).max(0.3).default(0.1),
  minFloorRent: z.number().nonnegative().default(0),
});
export type RentRepricingParams = z.infer<typeof RentRepricingParamsSchema>;

export interface UnitRepricingRecommendation {
  readonly unitId: string;
  readonly currentRent: number;
  readonly recommendedRent: number;
  readonly increasePct: number;
  readonly renewalAcceptanceProbability: number;
  readonly rationale: string;
}

export function adviseRentRepricing(
  params: RentRepricingParams
): {
  readonly propertyId: string;
  readonly recommendations: readonly UnitRepricingRecommendation[];
} {
  const parsed = RentRepricingParamsSchema.parse(params);
  const recs: UnitRepricingRecommendation[] = parsed.units.map((u) => {
    const marketGap = (u.marketRent - u.currentRent) / u.currentRent;
    let proposedPct = Math.max(0, Math.min(parsed.maxIncreasePct, marketGap));
    if (u.vacancyRisk > 0.3) proposedPct *= 0.5;
    if (u.tenantPaymentScore < 0.5) proposedPct = 0;
    if (u.tenantTenureMonths < 6) proposedPct *= 0.6;

    const recommendedRent = Math.max(
      parsed.minFloorRent,
      Math.round(u.currentRent * (1 + proposedPct))
    );
    const acceptance =
      0.9 -
      proposedPct * 2 +
      u.tenantPaymentScore * 0.15 -
      u.vacancyRisk * 0.1 +
      Math.min(0.15, u.tenantTenureMonths / 120);

    const rationale =
      proposedPct === 0
        ? 'Holding rent flat to retain a shaky tenant or prevent vacancy.'
        : `Close ${Math.round(marketGap * 100)}% market gap, capped at ${Math.round(parsed.maxIncreasePct * 100)}%.`;

    return {
      unitId: u.unitId,
      currentRent: u.currentRent,
      recommendedRent,
      increasePct: Math.round(proposedPct * 1000) / 1000,
      renewalAcceptanceProbability: Math.max(0, Math.min(1, Math.round(acceptance * 1000) / 1000)),
      rationale,
    };
  });
  return {
    propertyId: parsed.propertyId,
    recommendations: recs,
  };
}

export const rentRepricingAdvisorTool: ToolHandler = {
  name: 'skill.estate.rent_repricing_advisor',
  description:
    'Recommend per-unit rent adjustments based on market gap, occupancy risk, and tenant stability; caps at maxIncreasePct.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'units'],
    properties: {
      propertyId: { type: 'string' },
      units: { type: 'array', items: { type: 'object' } },
      maxIncreasePct: { type: 'number' },
      minFloorRent: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = RentRepricingParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = adviseRentRepricing(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Reprice advice for ${result.recommendations.length} unit(s) on property ${result.propertyId}`,
    };
  },
};
