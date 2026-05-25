/**
 * skill.admin.reissue_letter — regenerate and resend a previously-generated
 * legal letter. Tenant-facing — always flagged PROPOSED unless the caller
 * explicitly passes `force:true` after a confirmation turn.
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

export const ReissueLetterSchema = z.object({
  tenantId: z.string().min(1).optional(),
  originalLetterId: z.string().min(1),
  reason: z.enum([
    'address_change',
    'bounced_delivery',
    'rewording',
    'tenant_dispute',
    'escalation',
    'other',
  ]),
  deliveryChannel: z.enum(['post', 'email', 'whatsapp', 'sms']).default('email'),
  forwardToUserIds: z.array(z.string().min(1)).max(20).default([]),
  regenerateBody: z.boolean().default(false),
  force: z.boolean().default(false),
});
export type ReissueLetterParams = z.infer<typeof ReissueLetterSchema>;

export interface ReissueLetterResult {
  readonly originalLetterId: string;
  readonly newLetterId: string;
  readonly deliveryChannel: ReissueLetterParams['deliveryChannel'];
  readonly queuedAt: string;
}

export const reissueLetterTool: ToolHandler = {
  name: 'skill.admin.reissue_letter',
  description:
    'Regenerate and resend a previously-issued legal letter. Tenant-facing — always returns a PROPOSED action first so the user explicitly re-authorises delivery.',
  parameters: {
    type: 'object',
    required: ['originalLetterId', 'reason'],
    properties: {
      tenantId: { type: 'string' },
      originalLetterId: { type: 'string' },
      reason: {
        type: 'string',
        enum: ['address_change', 'bounced_delivery', 'rewording', 'tenant_dispute', 'escalation', 'other'],
      },
      deliveryChannel: { type: 'string', enum: ['post', 'email', 'whatsapp', 'sms'] },
      forwardToUserIds: { type: 'array', items: { type: 'string' } },
      regenerateBody: { type: 'boolean' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(ReissueLetterSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const newLetterId = `letter_${parsed.data.originalLetterId}_re_${Date.now().toString(36)}`;
    const result: ReissueLetterResult = {
      originalLetterId: parsed.data.originalLetterId,
      newLetterId,
      deliveryChannel: parsed.data.deliveryChannel,
      queuedAt: new Date().toISOString(),
    };

    if (!parsed.data.force) {
      return proposed(
        result,
        `Reissue letter ${result.originalLetterId} via ${result.deliveryChannel} (reason: ${parsed.data.reason})`
      );
    }
    return committed(
      result,
      `Letter ${result.originalLetterId} reissued as ${result.newLetterId} via ${result.deliveryChannel}`
    );
  },
};
