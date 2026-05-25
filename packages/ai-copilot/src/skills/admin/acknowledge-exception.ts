/**
 * skill.admin.acknowledge_exception — acknowledge an exception-inbox item.
 *
 * Integrates with the Wave-14 autonomy flow: an autonomy engine decision
 * that fell outside policy lands in the exception inbox; this skill lets
 * an admin clear it from chat (with audit trail preserved upstream).
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { assertSameTenant, committed, failed, safeParse } from './shared.js';

export const AcknowledgeExceptionSchema = z.object({
  tenantId: z.string().min(1).optional(),
  exceptionId: z.string().min(1),
  resolution: z.enum([
    'accept_autonomy_decision',
    'override_manual',
    'escalate',
    'defer',
    'duplicate',
  ]),
  note: z.string().max(2_000).optional(),
  followUpSkill: z.string().max(200).optional(),
});
export type AcknowledgeExceptionParams = z.infer<typeof AcknowledgeExceptionSchema>;

export interface AcknowledgeExceptionResult {
  readonly exceptionId: string;
  readonly resolution: AcknowledgeExceptionParams['resolution'];
  readonly acknowledgedAt: string;
  readonly followUpSkill?: string;
}

export const acknowledgeExceptionTool: ToolHandler = {
  name: 'skill.admin.acknowledge_exception',
  description:
    'Acknowledge an item in the autonomy exception inbox. Resolutions: accept_autonomy_decision, override_manual, escalate, defer, duplicate. Optionally chain a follow-up skill name the orchestrator will invoke next.',
  parameters: {
    type: 'object',
    required: ['exceptionId', 'resolution'],
    properties: {
      tenantId: { type: 'string' },
      exceptionId: { type: 'string' },
      resolution: {
        type: 'string',
        enum: ['accept_autonomy_decision', 'override_manual', 'escalate', 'defer', 'duplicate'],
      },
      note: { type: 'string' },
      followUpSkill: { type: 'string' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(AcknowledgeExceptionSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const result: AcknowledgeExceptionResult = {
      exceptionId: parsed.data.exceptionId,
      resolution: parsed.data.resolution,
      acknowledgedAt: new Date().toISOString(),
      followUpSkill: parsed.data.followUpSkill,
    };
    return committed(
      result,
      `Exception ${result.exceptionId} acknowledged (${result.resolution})${result.followUpSkill ? `, next: ${result.followUpSkill}` : ''}`
    );
  },
};
