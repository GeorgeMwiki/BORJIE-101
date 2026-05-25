/**
 * lease_renewal_scheduler_agent — 90 days before lease_end, drafts a
 * renewal proposal via the existing RenewalService.
 *
 * Wraps `services.renewalService.proposeRenewal` — does NOT invent a new
 * lifecycle. We only surface the already-built service via this uniform
 * task-agent contract so a scheduler / approvals UI can invoke it.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface LeaseNearEnd {
  readonly leaseId: string;
  readonly currentRent: number;
  readonly daysToExpiry: number;
}

const PayloadSchema = z.object({
  horizonDays: z.number().int().min(30).max(180).default(90),
  /** Bump the proposed rent by this percent over the current rent. */
  proposedIncreasePct: z.number().min(0).max(50).default(0),
});

export const leaseRenewalSchedulerAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'lease_renewal_scheduler_agent',
  title: 'Lease Renewal Scheduler',
  description:
    'Drafts renewal proposals on leases entering the renewal window.',
  trigger: {
    kind: 'cron',
    cron: '0 4 * * *',
    description: 'Daily 04:00 UTC — scan leases entering the renewal window.',
  },
  guardrails: {
    autonomyDomain: 'leasing',
    autonomyAction: 'approve_renewal',
    description:
      'Checked against leasing.autoApproveRenewalsSameTerms + maxAutoApproveRentIncreasePct.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listLeases = ctx.services.listLeasesNearExpiry as
      | ((tenantId: string, horizonDays: number) => Promise<readonly LeaseNearEnd[]>)
      | undefined;
    const renewalService = ctx.services.renewalService as
      | {
          proposeRenewal: (input: {
            tenantId: string;
            leaseId: string;
            proposedRent: number;
            proposedBy: string;
          }) => Promise<{ id?: string; leaseId?: string } | null>;
        }
      | undefined;

    if (!listLeases || !renewalService) {
      return {
        outcome: 'no_op',
        summary: 'Renewal service or lease lookup not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const leases = await listLeases(ctx.tenantId, ctx.payload.horizonDays);
    const proposed: Array<{ kind: string; id: string }> = [];
    for (const lease of leases) {
      const proposedRent = Math.round(
        lease.currentRent * (1 + ctx.payload.proposedIncreasePct / 100),
      );
      try {
        const res = await renewalService.proposeRenewal({
          tenantId: ctx.tenantId,
          leaseId: lease.leaseId,
          proposedRent,
          proposedBy: `agent:${ctx.agentId}`,
        });
        if (res) proposed.push({ kind: 'lease', id: lease.leaseId });
      } catch {
        /* swallow per-lease */
      }
    }
    return {
      outcome: proposed.length ? 'executed' : 'no_op',
      summary: `Drafted ${proposed.length} renewal proposal(s) across ${leases.length} lease(s).`,
      data: { leasesConsidered: leases.length, proposals: proposed.length },
      affected: proposed,
    };
  },
};
