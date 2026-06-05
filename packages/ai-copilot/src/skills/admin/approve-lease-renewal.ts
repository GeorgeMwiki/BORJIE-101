/**
 * skill.admin.approve_offtake_renewal — approve a pending offtake renewal within
 * policy limits. Delegates to PROPOSED_ACTION if the price delta exceeds
 * the configured cap — legal-impact + counterparty-facing.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  HIGH_RISK_THRESHOLDS,
  assertSameTenant,
  committed,
  failed,
  proposed,
  safeParse,
} from './shared.js';

export const ApproveOfftakeRenewalSchema = z.object({
  tenantId: z.string().min(1).optional(),
  renewalId: z.string().min(1),
  offtakeId: z.string().min(1),
  currentPriceKes: z.number().positive(),
  proposedPriceKes: z.number().positive(),
  newEndDateIso: z.string().datetime(),
  termMonths: z.number().int().min(1).max(120),
  noticeAlreadySentAt: z.string().datetime().optional(),
  force: z.boolean().default(false),
});
export type ApproveOfftakeRenewalParams = z.infer<typeof ApproveOfftakeRenewalSchema>;

export interface ApproveOfftakeRenewalResult {
  readonly renewalId: string;
  readonly offtakeId: string;
  readonly priceDeltaPct: number;
  readonly approvedAt: string;
  readonly withinPolicy: boolean;
}

export function evaluateRenewal(
  params: ApproveOfftakeRenewalParams
): ApproveOfftakeRenewalResult {
  const delta = (params.proposedPriceKes - params.currentPriceKes) / params.currentPriceKes;
  const priceDeltaPct = Math.round(delta * 10_000) / 10_000;
  return {
    renewalId: params.renewalId,
    offtakeId: params.offtakeId,
    priceDeltaPct,
    approvedAt: new Date().toISOString(),
    withinPolicy: Math.abs(priceDeltaPct) <= HIGH_RISK_THRESHOLDS.renewalPriceDeltaPct,
  };
}

export const approveOfftakeRenewalTool: ToolHandler = {
  name: 'skill.admin.approve_offtake_renewal',
  description:
    'Approve a pending offtake renewal. If the price change exceeds the 10% policy cap, returns a PROPOSED action so the user must explicitly confirm. Otherwise commits the approval.',
  parameters: {
    type: 'object',
    required: ['renewalId', 'offtakeId', 'currentPriceKes', 'proposedPriceKes', 'newEndDateIso', 'termMonths'],
    properties: {
      tenantId: { type: 'string' },
      renewalId: { type: 'string' },
      offtakeId: { type: 'string' },
      currentPriceKes: { type: 'number' },
      proposedPriceKes: { type: 'number' },
      newEndDateIso: { type: 'string' },
      termMonths: { type: 'integer' },
      noticeAlreadySentAt: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(ApproveOfftakeRenewalSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const result = evaluateRenewal(parsed.data);
    const requiresApproval = !parsed.data.force && !result.withinPolicy;

    if (requiresApproval) {
      return proposed(
        result,
        `Price change ${(result.priceDeltaPct * 100).toFixed(1)}% exceeds 10% policy cap on offtake ${result.offtakeId}`
      );
    }

    return committed(
      result,
      `Offtake ${result.offtakeId} renewal approved (${(result.priceDeltaPct * 100).toFixed(1)}% price change)`
    );
  },
};
