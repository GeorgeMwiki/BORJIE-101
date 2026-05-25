/**
 * skill.admin.approve_lease_renewal — approve a pending lease renewal within
 * policy limits. Delegates to PROPOSED_ACTION if the rent delta exceeds
 * the configured cap — legal-impact + tenant-facing.
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

export const ApproveLeaseRenewalSchema = z.object({
  tenantId: z.string().min(1).optional(),
  renewalId: z.string().min(1),
  leaseId: z.string().min(1),
  currentRentKes: z.number().positive(),
  proposedRentKes: z.number().positive(),
  newEndDateIso: z.string().datetime(),
  termMonths: z.number().int().min(1).max(120),
  noticeAlreadySentAt: z.string().datetime().optional(),
  force: z.boolean().default(false),
});
export type ApproveLeaseRenewalParams = z.infer<typeof ApproveLeaseRenewalSchema>;

export interface ApproveLeaseRenewalResult {
  readonly renewalId: string;
  readonly leaseId: string;
  readonly rentDeltaPct: number;
  readonly approvedAt: string;
  readonly withinPolicy: boolean;
}

export function evaluateRenewal(
  params: ApproveLeaseRenewalParams
): ApproveLeaseRenewalResult {
  const delta = (params.proposedRentKes - params.currentRentKes) / params.currentRentKes;
  const rentDeltaPct = Math.round(delta * 10_000) / 10_000;
  return {
    renewalId: params.renewalId,
    leaseId: params.leaseId,
    rentDeltaPct,
    approvedAt: new Date().toISOString(),
    withinPolicy: Math.abs(rentDeltaPct) <= HIGH_RISK_THRESHOLDS.renewalRentDeltaPct,
  };
}

export const approveLeaseRenewalTool: ToolHandler = {
  name: 'skill.admin.approve_lease_renewal',
  description:
    'Approve a pending lease renewal. If the rent change exceeds the 10% policy cap, returns a PROPOSED action so the user must explicitly confirm. Otherwise commits the approval.',
  parameters: {
    type: 'object',
    required: ['renewalId', 'leaseId', 'currentRentKes', 'proposedRentKes', 'newEndDateIso', 'termMonths'],
    properties: {
      tenantId: { type: 'string' },
      renewalId: { type: 'string' },
      leaseId: { type: 'string' },
      currentRentKes: { type: 'number' },
      proposedRentKes: { type: 'number' },
      newEndDateIso: { type: 'string' },
      termMonths: { type: 'integer' },
      noticeAlreadySentAt: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(ApproveLeaseRenewalSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const result = evaluateRenewal(parsed.data);
    const requiresApproval = !parsed.data.force && !result.withinPolicy;

    if (requiresApproval) {
      return proposed(
        result,
        `Rent change ${(result.rentDeltaPct * 100).toFixed(1)}% exceeds 10% policy cap on lease ${result.leaseId}`
      );
    }

    return committed(
      result,
      `Lease ${result.leaseId} renewal approved (${(result.rentDeltaPct * 100).toFixed(1)}% rent change)`
    );
  },
};
