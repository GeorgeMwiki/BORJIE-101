/**
 * skill.admin.assign_work_order — commit a vendor assignment from chat.
 *
 * Use after ranking vendors with skill.maintenance.assign_work_order.
 * High-cost assignments (estimate > threshold) flip to PROPOSED to force
 * an explicit "yes, assign" from the user before committing.
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

export const AssignWorkOrderCommitSchema = z.object({
  tenantId: z.string().min(1).optional(),
  workOrderId: z.string().min(1),
  vendorId: z.string().min(1),
  estimatedCostKes: z.number().nonnegative().default(0),
  startByIso: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  force: z.boolean().default(false),
});
export type AssignWorkOrderCommitParams = z.infer<typeof AssignWorkOrderCommitSchema>;

export interface AssignWorkOrderCommitResult {
  readonly workOrderId: string;
  readonly vendorId: string;
  readonly estimatedCostKes: number;
  readonly assignedAt: string;
}

const HIGH_COST_THRESHOLD_KES = 100_000;

export function buildAssignment(params: AssignWorkOrderCommitParams): AssignWorkOrderCommitResult {
  return {
    workOrderId: params.workOrderId,
    vendorId: params.vendorId,
    estimatedCostKes: params.estimatedCostKes,
    assignedAt: new Date().toISOString(),
  };
}

export const assignWorkOrderCommitTool: ToolHandler = {
  name: 'skill.admin.assign_work_order',
  description:
    'Assign a work order to a vendor. Requires a confirmed workOrderId + vendorId. If the estimatedCostKes exceeds a high-cost threshold (100k KES), returns a PROPOSED action requiring explicit confirmation before commit.',
  parameters: {
    type: 'object',
    required: ['workOrderId', 'vendorId'],
    properties: {
      tenantId: { type: 'string' },
      workOrderId: { type: 'string' },
      vendorId: { type: 'string' },
      estimatedCostKes: { type: 'number' },
      startByIso: { type: 'string' },
      note: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(AssignWorkOrderCommitSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const payload = buildAssignment(parsed.data);
    const needsApproval =
      !parsed.data.force && parsed.data.estimatedCostKes >= HIGH_COST_THRESHOLD_KES;

    if (needsApproval) {
      return proposed(
        payload,
        `Assign vendor ${payload.vendorId} to WO ${payload.workOrderId} @ KES ${payload.estimatedCostKes.toLocaleString()} (above KES ${HIGH_COST_THRESHOLD_KES.toLocaleString()}, requires approval)`
      );
    }

    return committed(
      payload,
      `Vendor ${payload.vendorId} assigned to WO ${payload.workOrderId} @ KES ${payload.estimatedCostKes.toLocaleString()}`
    );
  },
};

export { HIGH_COST_THRESHOLD_KES };
export { HIGH_RISK_THRESHOLDS };
