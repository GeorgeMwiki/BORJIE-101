/**
 * skill.admin.send_rent_reminder — trigger a rent reminder for a tenant/unit.
 *
 * Broadcast-style (many recipients) flips to PROPOSED so the user confirms
 * before sending. Single-recipient reminders commit directly.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  assertSameTenant,
  failed,
  proposed,
  safeParse,
} from './shared.js';

export const SendRentReminderSchema = z.object({
  tenantId: z.string().min(1).optional(),
  recipients: z
    .array(
      z.object({
        tenantUserId: z.string().min(1),
        unitId: z.string().min(1),
        amountDueKes: z.number().nonnegative(),
        dueDateIso: z.string().datetime(),
        preferredChannel: z.enum(['sms', 'whatsapp', 'email']).default('whatsapp'),
      })
    )
    .min(1)
    .max(500),
  locale: z.enum(['en', 'sw']).default('sw'),
  tone: z.enum(['friendly', 'firm', 'final']).default('friendly'),
  force: z.boolean().default(false),
});
export type SendRentReminderParams = z.infer<typeof SendRentReminderSchema>;

export interface SendRentReminderResult {
  readonly total: number;
  readonly byChannel: Record<'sms' | 'whatsapp' | 'email', number>;
  readonly totalOwedKes: number;
  readonly batchId: string;
}

export function planReminderBatch(params: SendRentReminderParams): SendRentReminderResult {
  const byChannel: Record<'sms' | 'whatsapp' | 'email', number> = {
    sms: 0,
    whatsapp: 0,
    email: 0,
  };
  let totalOwedKes = 0;
  for (const r of params.recipients) {
    byChannel[r.preferredChannel] += 1;
    totalOwedKes += r.amountDueKes;
  }
  const batchId = `reminder_${Date.now().toString(36)}_${params.recipients.length}`;
  return {
    total: params.recipients.length,
    byChannel,
    totalOwedKes,
    batchId,
  };
}

export const sendRentReminderTool: ToolHandler = {
  name: 'skill.admin.send_rent_reminder',
  description:
    'Plan reminders for one or more recipients and return a PROPOSED batch for confirmation. This skill does NOT send — dispatch runs through the reminders pipeline (owner reminders + notification_dispatch_log).',
  parameters: {
    type: 'object',
    required: ['recipients'],
    properties: {
      tenantId: { type: 'string' },
      recipients: { type: 'array', items: { type: 'object' } },
      locale: { type: 'string', enum: ['en', 'sw'] },
      tone: { type: 'string', enum: ['friendly', 'firm', 'final'] },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(SendRentReminderSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    // This skill PLANS a reminder batch. The skill-execution context exposes
    // NO delivery port, so it never claims a send — the prior
    // committed('Queued …') was a false-green (nothing was dispatched). It
    // returns a PROPOSAL; the confirming surface routes the batch through the
    // real reminders pipeline (owner reminders + notification_dispatch_log),
    // which is what actually delivers. (Follow-up: thread a notifications port
    // into ToolExecutionContext so the brain can enqueue dispatch rows itself.)
    const result = planReminderBatch(parsed.data);
    const plural = result.total === 1 ? '' : 's';
    return proposed(
      result,
      `Prepared ${result.total} reminder${plural} for review — dispatch runs through the reminders pipeline`,
    );
  },
};
