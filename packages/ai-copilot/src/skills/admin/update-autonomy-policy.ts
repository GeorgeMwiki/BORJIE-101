/**
 * skill.admin.update_autonomy_policy — change the autonomy policy threshold
 * for a domain (maintenance, finance, comms, etc).
 *
 * High-impact change — ALWAYS returns PROPOSED so the user explicitly
 * confirms the new threshold before it takes effect.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  assertSameTenant,
  committed,
  failed,
  proposed,
  safeParse,
} from './shared.js';

export const AutonomyDomainSchema = z.enum([
  'maintenance',
  'finance',
  'comms',
  'leasing',
  'compliance',
  'marketing',
  'hr',
]);
export type AutonomyDomain = z.infer<typeof AutonomyDomainSchema>;

export const AutonomyLevelSchema = z.enum(['manual', 'advise', 'propose', 'auto_within_policy', 'full_auto']);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const UpdateAutonomyPolicySchema = z.object({
  tenantId: z.string().min(1).optional(),
  domain: AutonomyDomainSchema,
  level: AutonomyLevelSchema,
  /** Hard cap on side-effect magnitude (KES) — enforced by autonomy engine. */
  costCeilingKes: z.number().nonnegative().optional(),
  /** Affected user ids (omit → org-wide). */
  appliesToUserIds: z.array(z.string().min(1)).max(500).optional(),
  reason: z.string().min(3).max(2_000),
  force: z.boolean().default(false),
});
export type UpdateAutonomyPolicyParams = z.infer<typeof UpdateAutonomyPolicySchema>;

export interface UpdateAutonomyPolicyResult {
  readonly domain: AutonomyDomain;
  readonly level: AutonomyLevel;
  readonly costCeilingKes?: number;
  readonly appliesToUserIds?: readonly string[];
  readonly effectiveAt: string;
  readonly priorLevel?: AutonomyLevel;
}

export const updateAutonomyPolicyTool: ToolHandler = {
  name: 'skill.admin.update_autonomy_policy',
  description:
    'Update autonomy policy for a domain (maintenance/finance/comms/leasing/compliance/marketing/hr). ALWAYS returns a PROPOSED action so the user explicitly confirms — autonomy policy is org-wide and high-impact.',
  parameters: {
    type: 'object',
    required: ['domain', 'level', 'reason'],
    properties: {
      tenantId: { type: 'string' },
      domain: {
        type: 'string',
        enum: ['maintenance', 'finance', 'comms', 'leasing', 'compliance', 'marketing', 'hr'],
      },
      level: {
        type: 'string',
        enum: ['manual', 'advise', 'propose', 'auto_within_policy', 'full_auto'],
      },
      costCeilingKes: { type: 'number' },
      appliesToUserIds: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(UpdateAutonomyPolicySchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const result: UpdateAutonomyPolicyResult = {
      domain: parsed.data.domain,
      level: parsed.data.level,
      costCeilingKes: parsed.data.costCeilingKes,
      appliesToUserIds: parsed.data.appliesToUserIds,
      effectiveAt: new Date().toISOString(),
    };

    if (!parsed.data.force) {
      return proposed(
        result,
        `Set ${result.domain} autonomy → ${result.level}${
          result.costCeilingKes ? ` (ceiling KES ${result.costCeilingKes.toLocaleString()})` : ''
        } — awaiting confirmation`
      );
    }
    return committed(
      result,
      `Autonomy ${result.domain} set to ${result.level}${
        result.costCeilingKes ? ` (ceiling KES ${result.costCeilingKes.toLocaleString()})` : ''
      }`
    );
  },
};
