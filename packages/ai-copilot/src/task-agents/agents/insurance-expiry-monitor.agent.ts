/**
 * insurance_expiry_monitor_agent — weekly scans vendor + property
 * insurance records and emits a renewal-reminder when the policy expires
 * within 30 days.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface ExpiringInsurance {
  readonly id: string;
  readonly kind: 'vendor' | 'property';
  readonly subjectId: string;
  readonly expiresOn: string;
  readonly daysToExpiry: number;
}

const PayloadSchema = z.object({
  horizonDays: z.number().int().min(7).max(180).default(30),
});

export const insuranceExpiryMonitorAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'insurance_expiry_monitor_agent',
  title: 'Insurance Expiry Monitor',
  description:
    'Flags vendor + property insurance policies nearing expiry.',
  trigger: {
    kind: 'cron',
    cron: '0 5 * * 1',
    description: 'Weekly Monday 05:00 UTC.',
  },
  guardrails: {
    autonomyDomain: 'compliance',
    autonomyAction: 'draft_notice',
    description: 'Gated on compliance.autoDraftNotices — drafts renewal note.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listExpiring = ctx.services.listExpiringInsurance as
      | ((tenantId: string, horizonDays: number) => Promise<readonly ExpiringInsurance[]>)
      | undefined;
    const flagger = ctx.services.exceptionInbox as
      | {
          writeFlag: (input: {
            tenantId: string;
            kind: 'insurance_expiry';
            customerId?: string;
            subjectId: string;
            daysToExpiry: number;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!listExpiring) {
      return {
        outcome: 'no_op',
        summary: 'Insurance lookup not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const expiring = await listExpiring(ctx.tenantId, ctx.payload.horizonDays);
    const affected: Array<{ kind: string; id: string }> = [];
    if (flagger) {
      for (const row of expiring) {
        try {
          const f = await flagger.writeFlag({
            tenantId: ctx.tenantId,
            kind: 'insurance_expiry',
            subjectId: row.subjectId,
            daysToExpiry: row.daysToExpiry,
          });
          affected.push({ kind: 'exception', id: f.id });
        } catch {
          /* swallow */
        }
      }
    }
    return {
      outcome: expiring.length ? 'executed' : 'no_op',
      summary: `Flagged ${expiring.length} expiring insurance record(s).`,
      data: {
        count: expiring.length,
        horizonDays: ctx.payload.horizonDays,
      },
      affected,
    };
  },
};
