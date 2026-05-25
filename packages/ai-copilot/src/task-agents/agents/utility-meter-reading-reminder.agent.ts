/**
 * utility_meter_reading_reminder_agent — monthly before month-end close,
 * reminds field staff to record meter readings per unit.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface UnitMissingReading {
  readonly unitId: string;
  readonly propertyId: string;
  readonly lastReadingDate: string | null;
  readonly fieldStaffId: string | null;
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
  monthEndDaysBefore: z.number().int().min(1).max(10).default(3),
});

export const utilityMeterReadingReminderAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'utility_meter_reading_reminder_agent',
  title: 'Utility Meter-Reading Reminder',
  description:
    'Nudges field staff to capture meter readings before month-end close.',
  trigger: {
    kind: 'cron',
    cron: '0 7 25-31 * *',
    description: 'Daily 07:00 UTC within the last week of each month.',
  },
  guardrails: {
    autonomyDomain: 'communications',
    autonomyAction: 'send_routine_update',
    description: 'Routine internal reminder to staff.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listUnits = ctx.services.listUnitsMissingMeterReading as
      | ((tenantId: string) => Promise<readonly UnitMissingReading[]>)
      | undefined;
    const dispatcher = (ctx.services.notifications as
      | { dispatcher?: NotificationDispatcherLike }
      | undefined)?.dispatcher;
    if (!listUnits || !dispatcher) {
      return {
        outcome: 'no_op',
        summary: 'Unit lookup or dispatcher missing.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }
    const units = await listUnits(ctx.tenantId);
    const affected: Array<{ kind: string; id: string }> = [];
    for (const u of units) {
      if (!u.fieldStaffId) continue;
      try {
        await dispatcher.dispatch({
          tenantId: ctx.tenantId,
          recipientId: u.fieldStaffId,
          channel: 'sms',
          subject: 'Meter reading due',
          body: `Please capture meter reading for unit ${u.unitId}.`,
          correlationId: ctx.runId,
        });
        affected.push({ kind: 'unit', id: u.unitId });
      } catch {
        /* swallow per-unit */
      }
    }
    return {
      outcome: affected.length ? 'executed' : 'no_op',
      summary: `Nudged ${affected.length} field-staff assignments across ${units.length} unit(s).`,
      data: { unitCount: units.length, nudged: affected.length },
      affected,
    };
  },
};
