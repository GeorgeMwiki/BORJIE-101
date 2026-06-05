/**
 * skill.estate.buyer_health_check — the 5Ps counterparty risk score.
 *
 * Scores a buyer / counterparty on:
 *   Payment      — history of on-time settlement
 *   Performance  — offtake lifting / handling discipline
 *   Purpose      — stated use vs observed use
 *   Person       — KYC, references, standing
 *   Protection   — performance bond, guarantor, insurance
 *
 * Each dimension scores 0-1; composite is weighted mean. Returns a
 * traffic-light label + the factor that dragged the score down.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const BuyerHealthParamsSchema = z.object({
  buyerId: z.string().min(1),
  consignmentId: z.string().min(1),
  paymentOnTimeRatio: z.number().min(0).max(1).default(0.8),
  paymentDaysLateAvg: z.number().nonnegative().default(0),
  performanceScore: z.number().min(0).max(1).default(0.8),
  disputesLast12m: z.number().int().nonnegative().default(0),
  statedUse: z.string().max(200).default('export'),
  observedUseFlags: z.array(z.string()).max(20).default([]),
  kycComplete: z.boolean().default(false),
  referencesCount: z.number().int().nonnegative().default(0),
  performanceBondPaid: z.boolean().default(true),
  guarantorPresent: z.boolean().default(false),
  insuranceOnFile: z.boolean().default(false),
});
export type BuyerHealthParams = z.infer<typeof BuyerHealthParamsSchema>;

export interface BuyerHealthResult {
  readonly buyerId: string;
  readonly consignmentId: string;
  readonly scores: {
    readonly payment: number;
    readonly performance: number;
    readonly purpose: number;
    readonly person: number;
    readonly protection: number;
  };
  readonly composite: number;
  readonly rating: 'green' | 'amber' | 'red';
  readonly weakestDimension: keyof BuyerHealthResult['scores'];
  readonly recommendations: readonly string[];
}

export function buyerHealthCheck(params: BuyerHealthParams): BuyerHealthResult {
  const parsed = BuyerHealthParamsSchema.parse(params);

  const paymentScore = Math.max(
    0,
    Math.min(1, parsed.paymentOnTimeRatio - parsed.paymentDaysLateAvg / 90)
  );
  const performanceScore = Math.max(
    0,
    Math.min(1, parsed.performanceScore - parsed.disputesLast12m * 0.05)
  );
  const purposeScore = parsed.observedUseFlags.length === 0 ? 1 : Math.max(0, 1 - parsed.observedUseFlags.length * 0.2);
  const personBase = (parsed.kycComplete ? 0.5 : 0.2) + Math.min(0.5, parsed.referencesCount * 0.1);
  const personScore = Math.min(1, personBase);
  const protectionScore =
    (parsed.performanceBondPaid ? 0.5 : 0) +
    (parsed.guarantorPresent ? 0.3 : 0) +
    (parsed.insuranceOnFile ? 0.2 : 0);

  const scores = {
    payment: round(paymentScore),
    performance: round(performanceScore),
    purpose: round(purposeScore),
    person: round(personScore),
    protection: round(protectionScore),
  };

  const composite = round(
    scores.payment * 0.3 +
      scores.performance * 0.2 +
      scores.purpose * 0.15 +
      scores.person * 0.15 +
      scores.protection * 0.2
  );

  const rating: BuyerHealthResult['rating'] =
    composite >= 0.75 ? 'green' : composite >= 0.5 ? 'amber' : 'red';
  const weakestDimension = (Object.keys(scores) as Array<keyof typeof scores>).reduce((a, b) =>
    scores[a] < scores[b] ? a : b
  );

  const recommendations: string[] = [];
  if (scores.payment < 0.6) recommendations.push('Move to advance-payment or guarantor-backed settlement.');
  if (scores.performance < 0.6) recommendations.push('Schedule a joint lifting review within 14 days.');
  if (scores.purpose < 0.7) recommendations.push('Clarify use with the buyer; check assignment compliance.');
  if (scores.person < 0.6) recommendations.push('Refresh KYC; request two new references.');
  if (scores.protection < 0.6) recommendations.push('Require guarantor or performance-bond insurance on renewal.');

  return {
    buyerId: parsed.buyerId,
    consignmentId: parsed.consignmentId,
    scores,
    composite,
    rating,
    weakestDimension,
    recommendations,
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export const buyerHealthCheckTool: ToolHandler = {
  name: 'skill.estate.buyer_health_check',
  description:
    'Score a buyer / counterparty on the 5Ps (Payment, Performance, Purpose, Person, Protection). Returns composite + weakest dimension + recommendations.',
  parameters: {
    type: 'object',
    required: ['buyerId', 'consignmentId'],
    properties: {
      buyerId: { type: 'string' },
      consignmentId: { type: 'string' },
      paymentOnTimeRatio: { type: 'number' },
      paymentDaysLateAvg: { type: 'number' },
      performanceScore: { type: 'number' },
      disputesLast12m: { type: 'number' },
      statedUse: { type: 'string' },
      observedUseFlags: { type: 'array', items: { type: 'string' } },
      kycComplete: { type: 'boolean' },
      referencesCount: { type: 'number' },
      performanceBondPaid: { type: 'boolean' },
      guarantorPresent: { type: 'boolean' },
      insuranceOnFile: { type: 'boolean' },
    },
  },
  async execute(params) {
    const parsed = BuyerHealthParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = buyerHealthCheck(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Buyer ${result.buyerId}: ${result.rating} (${result.composite}); weakest=${result.weakestDimension}`,
    };
  },
};
