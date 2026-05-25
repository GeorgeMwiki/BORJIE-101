/**
 * rent_reminder_agent — 3 days before due_date sends SMS/WhatsApp/email
 * reminders via the platform notifications surface.
 *
 * Wraps `services.notifications.dispatcher` (the same dispatcher used by
 * the existing notifications router + event-subscribers worker). Does not
 * invent a new path — this agent is the per-tenant on-demand trigger for
 * the same channel.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

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
  leadTimeDays: z.number().int().min(1).max(30).default(3),
  /** When omitted, the agent scans all upcoming invoices; otherwise targeted. */
  invoiceIds: z.array(z.string()).optional(),
  channels: z
    .array(z.enum(['sms', 'whatsapp', 'email']))
    .default(['sms', 'email']),
});

export const rentReminderAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'rent_reminder_agent',
  title: 'Rent Reminder',
  description:
    'Sends rent-due reminders the configured number of days before the due date.',
  trigger: {
    kind: 'cron',
    cron: '0 7 * * *',
    description: 'Daily 07:00 UTC — scan upcoming invoices.',
  },
  guardrails: {
    autonomyDomain: 'finance',
    autonomyAction: 'send_reminder',
    description: 'Requires finance.autoSendReminders to be enabled.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const dispatcher = (ctx.services.notifications as
      | { dispatcher?: NotificationDispatcherLike }
      | undefined)?.dispatcher;
    const invoices = ctx.services.upcomingInvoicesLookup as
      | ((tenantId: string, leadDays: number) => Promise<
          ReadonlyArray<{ id: string; customerId: string; amount: number; dueDate: string }>
        >)
      | undefined;

    const lookup = ctx.payload.invoiceIds?.length
      ? async () =>
          (ctx.payload.invoiceIds ?? []).map((id) => ({
            id,
            customerId: `unknown:${id}`,
            amount: 0,
            dueDate: ctx.now.toISOString(),
          }))
      : invoices
        ? () => invoices(ctx.tenantId, ctx.payload.leadTimeDays)
        : null;

    if (!lookup || !dispatcher) {
      return {
        outcome: 'no_op',
        summary: 'Notifications surface not wired — agent ran but sent nothing.',
        data: { reason: 'missing_dispatcher_or_lookup' },
        affected: [],
      };
    }

    const due = await lookup();
    const sent: Array<{ kind: string; id: string }> = [];
    for (const inv of due) {
      for (const channel of ctx.payload.channels) {
        try {
          await dispatcher.dispatch({
            tenantId: ctx.tenantId,
            recipientId: inv.customerId,
            channel,
            subject: 'Rent reminder',
            body: `Rent due ${inv.dueDate} — ${inv.amount}`,
            correlationId: ctx.runId,
          });
          sent.push({ kind: 'invoice', id: inv.id });
        } catch {
          /* swallow per-recipient — continue loop */
        }
      }
    }
    return {
      outcome: sent.length ? 'executed' : 'no_op',
      summary: `Sent ${sent.length} reminder(s) across ${due.length} invoice(s).`,
      data: { invoiceCount: due.length, dispatches: sent.length },
      affected: sent,
    };
  },
};
