/**
 * inspection_reminder_agent — 48h before a scheduled inspection, reminds
 * both the tenant and the inspector via the notifications dispatcher.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface UpcomingInspection {
  readonly id: string;
  readonly tenantContactId: string | null;
  readonly inspectorId: string | null;
  readonly scheduledFor: string;
  readonly propertyName: string;
}

interface NotificationDispatcherLike {
  dispatch: (input: {
    tenantId: string;
    recipientId: string;
    channel: 'sms' | 'whatsapp' | 'email';
    subject: string;
    body: string;
    correlationId?: string;
  }) => Promise<{ id: string } | void>;
}

const PayloadSchema = z.object({
  leadHours: z.number().int().min(1).max(168).default(48),
});

export const inspectionReminderAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'inspection_reminder_agent',
  title: 'Inspection Reminder',
  description:
    'Nudges tenant + inspector ahead of a scheduled inspection.',
  trigger: { kind: 'cron', cron: '0 * * * *', description: 'Hourly sweep.' },
  guardrails: {
    autonomyDomain: 'communications',
    autonomyAction: 'send_routine_update',
    description: 'Gated on communications.autoSendRoutineUpdates.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listUpcoming = ctx.services.listUpcomingInspections as
      | ((tenantId: string, leadHours: number) => Promise<readonly UpcomingInspection[]>)
      | undefined;
    const dispatcher = (ctx.services.notifications as
      | { dispatcher?: NotificationDispatcherLike }
      | undefined)?.dispatcher;

    if (!listUpcoming || !dispatcher) {
      return {
        outcome: 'no_op',
        summary: 'Inspection lookup or dispatcher missing.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const inspections = await listUpcoming(ctx.tenantId, ctx.payload.leadHours);
    const reminded: Array<{ kind: string; id: string }> = [];
    for (const insp of inspections) {
      for (const recipientId of [insp.tenantContactId, insp.inspectorId].filter(
        (v): v is string => Boolean(v),
      )) {
        try {
          await dispatcher.dispatch({
            tenantId: ctx.tenantId,
            recipientId,
            channel: 'sms',
            subject: `Inspection ${insp.scheduledFor}`,
            body: `Reminder: inspection at ${insp.propertyName} on ${insp.scheduledFor}.`,
            correlationId: ctx.runId,
          });
        } catch {
          /* per-recipient swallow */
        }
      }
      reminded.push({ kind: 'inspection', id: insp.id });
    }
    return {
      outcome: reminded.length ? 'executed' : 'no_op',
      summary: `Reminded parties for ${reminded.length} inspection(s).`,
      data: { count: reminded.length },
      affected: reminded,
    };
  },
};
