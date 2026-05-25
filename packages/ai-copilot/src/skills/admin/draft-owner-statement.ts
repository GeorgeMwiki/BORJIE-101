/**
 * skill.admin.draft_owner_statement — admin-side wrapper around the existing
 * finance skill (skill.finance.draft_owner_statement).
 *
 * Exists so the admin skill bundle has a uniform-shaped tool the chat widget
 * can bind to. Delegates computation to the canonical finance drafter and
 * adds tenant-isolation + explicit "generate now" semantics.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { OwnerStatementParamsSchema, draftOwnerStatement } from '../domain/finance.js';
import { assertSameTenant, committed, failed, safeParse } from './shared.js';

export const DraftOwnerStatementAdminSchema = OwnerStatementParamsSchema.extend({
  tenantId: z.string().min(1).optional(),
});
export type DraftOwnerStatementAdminParams = z.infer<typeof DraftOwnerStatementAdminSchema>;

export const draftOwnerStatementAdminTool: ToolHandler = {
  name: 'skill.admin.draft_owner_statement',
  description:
    'Generate an owner statement for a specific period/owner from chat. Thin admin wrapper around skill.finance.draft_owner_statement with tenant-isolation enforcement.',
  parameters: {
    type: 'object',
    required: ['ownerId', 'ownerName', 'period', 'properties'],
    properties: {
      tenantId: { type: 'string' },
      ownerId: { type: 'string' },
      ownerName: { type: 'string' },
      period: { type: 'string' },
      properties: { type: 'array', items: { type: 'object' } },
      managementFeePct: { type: 'number' },
      mriWithheldKes: { type: 'number' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(DraftOwnerStatementAdminSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const { tenantId: _tenantId, ...inner } = parsed.data;
    const result = draftOwnerStatement(inner);
    return committed(
      result,
      `Owner statement drafted for ${result.ownerName} @ ${result.period} — net KES ${result.total.netDisbursementKes.toLocaleString()}`
    );
  },
};
