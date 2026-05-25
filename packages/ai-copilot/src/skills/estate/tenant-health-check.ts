/**
 * skill.estate.tenant_health_check — the 5Ps tenancy risk score.
 *
 * Scores a tenancy on:
 *   Payment      — history of on-time rent
 *   Property     — unit maintenance/usage
 *   Purpose      — stated use vs observed use
 *   Person       — KYC, references, community standing
 *   Protection   — deposit, guarantor, insurance
 *
 * Each dimension scores 0-1; composite is weighted mean. Returns a
 * traffic-light label + the factor that dragged the score down.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const TenantHealthParamsSchema = z.object({
  tenantId: z.string().min(1),
  unitId: z.string().min(1),
  paymentOnTimeRatio: z.number().min(0).max(1).default(0.8),
  paymentDaysLateAvg: z.number().nonnegative().default(0),
  propertyConditionScore: z.number().min(0).max(1).default(0.8),
  complaintsLast12m: z.number().int().nonnegative().default(0),
  statedUse: z.string().max(200).default('residential'),
  observedUseFlags: z.array(z.string()).max(20).default([]),
  kycComplete: z.boolean().default(false),
  referencesCount: z.number().int().nonnegative().default(0),
  depositPaid: z.boolean().default(true),
  guarantorPresent: z.boolean().default(false),
  insuranceOnFile: z.boolean().default(false),
});
export type TenantHealthParams = z.infer<typeof TenantHealthParamsSchema>;

export interface TenantHealthResult {
  readonly tenantId: string;
  readonly unitId: string;
  readonly scores: {
    readonly payment: number;
    readonly property: number;
    readonly purpose: number;
    readonly person: number;
    readonly protection: number;
  };
  readonly composite: number;
  readonly rating: 'green' | 'amber' | 'red';
  readonly weakestDimension: keyof TenantHealthResult['scores'];
  readonly recommendations: readonly string[];
}

export function tenantHealthCheck(params: TenantHealthParams): TenantHealthResult {
  const parsed = TenantHealthParamsSchema.parse(params);

  const paymentScore = Math.max(
    0,
    Math.min(1, parsed.paymentOnTimeRatio - parsed.paymentDaysLateAvg / 90)
  );
  const propertyScore = Math.max(
    0,
    Math.min(1, parsed.propertyConditionScore - parsed.complaintsLast12m * 0.05)
  );
  const purposeScore = parsed.observedUseFlags.length === 0 ? 1 : Math.max(0, 1 - parsed.observedUseFlags.length * 0.2);
  const personBase = (parsed.kycComplete ? 0.5 : 0.2) + Math.min(0.5, parsed.referencesCount * 0.1);
  const personScore = Math.min(1, personBase);
  const protectionScore =
    (parsed.depositPaid ? 0.5 : 0) +
    (parsed.guarantorPresent ? 0.3 : 0) +
    (parsed.insuranceOnFile ? 0.2 : 0);

  const scores = {
    payment: round(paymentScore),
    property: round(propertyScore),
    purpose: round(purposeScore),
    person: round(personScore),
    protection: round(protectionScore),
  };

  const composite = round(
    scores.payment * 0.3 +
      scores.property * 0.2 +
      scores.purpose * 0.15 +
      scores.person * 0.15 +
      scores.protection * 0.2
  );

  const rating: TenantHealthResult['rating'] =
    composite >= 0.75 ? 'green' : composite >= 0.5 ? 'amber' : 'red';
  const weakestDimension = (Object.keys(scores) as Array<keyof typeof scores>).reduce((a, b) =>
    scores[a] < scores[b] ? a : b
  );

  const recommendations: string[] = [];
  if (scores.payment < 0.6) recommendations.push('Move to advance-standing-order or guarantor-backed payment.');
  if (scores.property < 0.6) recommendations.push('Schedule a joint unit inspection within 14 days.');
  if (scores.purpose < 0.7) recommendations.push('Clarify use with the tenant; check sublet compliance.');
  if (scores.person < 0.6) recommendations.push('Refresh KYC; request two new references.');
  if (scores.protection < 0.6) recommendations.push('Require guarantor or rent-guarantee insurance on renewal.');

  return {
    tenantId: parsed.tenantId,
    unitId: parsed.unitId,
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

export const tenantHealthCheckTool: ToolHandler = {
  name: 'skill.estate.tenant_health_check',
  description:
    'Score a tenancy on the 5Ps (Payment, Property, Purpose, Person, Protection). Returns composite + weakest dimension + recommendations.',
  parameters: {
    type: 'object',
    required: ['tenantId', 'unitId'],
    properties: {
      tenantId: { type: 'string' },
      unitId: { type: 'string' },
      paymentOnTimeRatio: { type: 'number' },
      paymentDaysLateAvg: { type: 'number' },
      propertyConditionScore: { type: 'number' },
      complaintsLast12m: { type: 'number' },
      statedUse: { type: 'string' },
      observedUseFlags: { type: 'array', items: { type: 'string' } },
      kycComplete: { type: 'boolean' },
      referencesCount: { type: 'number' },
      depositPaid: { type: 'boolean' },
      guarantorPresent: { type: 'boolean' },
      insuranceOnFile: { type: 'boolean' },
    },
  },
  async execute(params) {
    const parsed = TenantHealthParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = tenantHealthCheck(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Tenant ${result.tenantId}: ${result.rating} (${result.composite}); weakest=${result.weakestDimension}`,
    };
  },
};
