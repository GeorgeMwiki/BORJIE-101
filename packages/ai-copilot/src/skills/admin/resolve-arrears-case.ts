/**
 * skill.admin.resolve_arrears_case — apply an arrears adjustment.
 *
 * Write-off or adjustment above the configured cap requires a PROPOSED
 * confirmation. Below the cap the adjustment commits directly.
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

export const ResolveArrearsCaseSchema = z.object({
  tenantId: z.string().min(1).optional(),
  arrearsCaseId: z.string().min(1),
  tenantUserId: z.string().min(1),
  adjustmentKes: z.number(),
  resolution: z.enum(['write_off', 'payment_plan', 'late_fee_waived', 'full_payment']),
  note: z.string().max(2_000).optional(),
  force: z.boolean().default(false),
});
export type ResolveArrearsCaseParams = z.infer<typeof ResolveArrearsCaseSchema>;

export interface ResolveArrearsCaseResult {
  readonly arrearsCaseId: string;
  readonly resolution: ResolveArrearsCaseParams['resolution'];
  readonly adjustmentKes: number;
  readonly resolvedAt: string;
  readonly requiresApproval: boolean;
}

export const resolveArrearsCaseTool: ToolHandler = {
  name: 'skill.admin.resolve_arrears_case',
  description:
    'Apply an arrears adjustment for a specific case. Adjustments whose absolute value is at or above the approval cap are returned as PROPOSED actions — user must confirm before commit.',
  parameters: {
    type: 'object',
    required: ['arrearsCaseId', 'tenantUserId', 'adjustmentKes', 'resolution'],
    properties: {
      tenantId: { type: 'string' },
      arrearsCaseId: { type: 'string' },
      tenantUserId: { type: 'string' },
      adjustmentKes: { type: 'number' },
      resolution: {
        type: 'string',
        enum: ['write_off', 'payment_plan', 'late_fee_waived', 'full_payment'],
      },
      note: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(ResolveArrearsCaseSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const requiresApproval =
      Math.abs(parsed.data.adjustmentKes) >= HIGH_RISK_THRESHOLDS.arrearsAdjustmentKes ||
      parsed.data.resolution === 'write_off';

    const result: ResolveArrearsCaseResult = {
      arrearsCaseId: parsed.data.arrearsCaseId,
      resolution: parsed.data.resolution,
      adjustmentKes: parsed.data.adjustmentKes,
      resolvedAt: new Date().toISOString(),
      requiresApproval,
    };

    if (!parsed.data.force && requiresApproval) {
      return proposed(
        result,
        `Arrears ${result.resolution} on ${result.arrearsCaseId} for KES ${result.adjustmentKes.toLocaleString()} — needs approval`
      );
    }
    return committed(
      result,
      `Arrears case ${result.arrearsCaseId} resolved (${result.resolution}, KES ${result.adjustmentKes.toLocaleString()})`
    );
  },
};
