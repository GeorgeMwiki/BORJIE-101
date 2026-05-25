/**
 * license_expiry_monitor_agent — monthly scan of tenant + property
 * licences (business permits, building compliance). Emits a reminder on
 * the 30-day horizon.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface ExpiringLicence {
  readonly id: string;
  readonly kind: 'business_permit' | 'building_compliance' | 'other';
  readonly subjectId: string;
  readonly expiresOn: string;
  readonly daysToExpiry: number;
}

const PayloadSchema = z.object({
  horizonDays: z.number().int().min(7).max(365).default(30),
});

export const licenseExpiryMonitorAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'license_expiry_monitor_agent',
  title: 'Licence Expiry Monitor',
  description:
    'Flags business permits + building compliance licences approaching expiry.',
  trigger: {
    kind: 'cron',
    cron: '0 4 1 * *',
    description: 'Monthly first-of-month at 04:00 UTC.',
  },
  guardrails: {
    autonomyDomain: 'compliance',
    autonomyAction: 'renew_licence',
    description: 'Compliance renewal path; legal notices never auto-send.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listLicences = ctx.services.listExpiringLicences as
      | ((tenantId: string, horizonDays: number) => Promise<readonly ExpiringLicence[]>)
      | undefined;
    const flagger = ctx.services.exceptionInbox as
      | {
          writeFlag: (input: {
            tenantId: string;
            kind: 'licence_expiry';
            subjectId: string;
            daysToExpiry: number;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!listLicences) {
      return {
        outcome: 'no_op',
        summary: 'Licence lookup not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const expiring = await listLicences(ctx.tenantId, ctx.payload.horizonDays);
    const affected: Array<{ kind: string; id: string }> = [];
    if (flagger) {
      for (const row of expiring) {
        try {
          const f = await flagger.writeFlag({
            tenantId: ctx.tenantId,
            kind: 'licence_expiry',
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
      summary: `Flagged ${expiring.length} expiring licence(s).`,
      data: { count: expiring.length, horizonDays: ctx.payload.horizonDays },
      affected,
    };
  },
};
