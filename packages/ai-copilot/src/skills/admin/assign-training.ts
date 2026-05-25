/**
 * skill.admin.assign_training — assign a training path to one or more
 * employees. Integrates with the Wave-13 training system.
 *
 * Low-risk commits directly; mass assignments (> 20 employees) flip to
 * PROPOSED so the user confirms before dispatch.
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

export const AssignTrainingSchema = z.object({
  tenantId: z.string().min(1).optional(),
  trainingPathId: z.string().min(1),
  employeeIds: z.array(z.string().min(1)).min(1).max(500),
  dueDateIso: z.string().datetime().optional(),
  mandatory: z.boolean().default(false),
  notifyChannel: z.enum(['email', 'in_app', 'sms']).default('in_app'),
  force: z.boolean().default(false),
});
export type AssignTrainingParams = z.infer<typeof AssignTrainingSchema>;

export interface AssignTrainingResult {
  readonly trainingPathId: string;
  readonly assigneeCount: number;
  readonly assignedAt: string;
  readonly dueDateIso?: string;
  readonly mandatory: boolean;
}

export const assignTrainingTool: ToolHandler = {
  name: 'skill.admin.assign_training',
  description:
    'Assign a training path to one or more employees. Returns PROPOSED if the assignee list exceeds the broadcast cap — user must confirm before dispatch.',
  parameters: {
    type: 'object',
    required: ['trainingPathId', 'employeeIds'],
    properties: {
      tenantId: { type: 'string' },
      trainingPathId: { type: 'string' },
      employeeIds: { type: 'array', items: { type: 'string' } },
      dueDateIso: { type: 'string' },
      mandatory: { type: 'boolean' },
      notifyChannel: { type: 'string', enum: ['email', 'in_app', 'sms'] },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(AssignTrainingSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const result: AssignTrainingResult = {
      trainingPathId: parsed.data.trainingPathId,
      assigneeCount: parsed.data.employeeIds.length,
      assignedAt: new Date().toISOString(),
      dueDateIso: parsed.data.dueDateIso,
      mandatory: parsed.data.mandatory,
    };

    const needsApproval =
      !parsed.data.force && result.assigneeCount > HIGH_RISK_THRESHOLDS.broadcastRecipients;

    if (needsApproval) {
      return proposed(
        result,
        `Assign ${result.trainingPathId} to ${result.assigneeCount} employees (above ${HIGH_RISK_THRESHOLDS.broadcastRecipients} cap)`
      );
    }
    return committed(
      result,
      `Training ${result.trainingPathId} assigned to ${result.assigneeCount} employee(s)`
    );
  },
};
