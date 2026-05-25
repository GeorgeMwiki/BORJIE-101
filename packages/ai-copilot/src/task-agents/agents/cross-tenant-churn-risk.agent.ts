/**
 * cross_tenant_churn_risk_agent — weekly computes churn probability per
 * active lease using the existing 5Ps framework (churn-predictor service).
 * Emits an alert when risk crosses the configured threshold.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface ChurnRow {
  readonly customerId: string;
  readonly leaseId: string;
  readonly churnProbability: number;
  readonly topDrivers: readonly string[];
}

const PayloadSchema = z.object({
  alertAbove: z.number().min(0).max(1).default(0.65),
});

export const crossTenantChurnRiskAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'cross_tenant_churn_risk_agent',
  title: 'Cross-Tenant Churn Risk',
  description:
    'Weekly 5Ps churn-risk recompute + alerts above threshold.',
  trigger: {
    kind: 'cron',
    cron: '0 6 * * 1',
    description: 'Weekly Monday 06:00 UTC.',
  },
  guardrails: {
    autonomyDomain: 'communications',
    autonomyAction: 'send_routine_update',
    description: 'Internal ops alert; communications domain.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const churn = ctx.services.churnPredictor as
      | {
          recomputeActiveLeases: (input: {
            tenantId: string;
          }) => Promise<readonly ChurnRow[]>;
        }
      | undefined;
    const flagger = ctx.services.exceptionInbox as
      | {
          writeFlag: (input: {
            tenantId: string;
            kind: 'churn_risk';
            customerId: string;
            churnProbability: number;
            drivers: readonly string[];
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!churn) {
      return {
        outcome: 'no_op',
        summary: 'Churn predictor not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }
    const rows = await churn.recomputeActiveLeases({ tenantId: ctx.tenantId });
    const alerts = rows.filter((r) => r.churnProbability >= ctx.payload.alertAbove);
    const affected: Array<{ kind: string; id: string }> = [];
    if (flagger) {
      for (const row of alerts) {
        try {
          const f = await flagger.writeFlag({
            tenantId: ctx.tenantId,
            kind: 'churn_risk',
            customerId: row.customerId,
            churnProbability: row.churnProbability,
            drivers: row.topDrivers,
          });
          affected.push({ kind: 'exception', id: f.id });
        } catch {
          /* swallow */
        }
      }
    }
    return {
      outcome: alerts.length ? 'executed' : 'no_op',
      summary: `Computed ${rows.length} risks; alerted on ${alerts.length} at threshold ${ctx.payload.alertAbove}.`,
      data: {
        totalRows: rows.length,
        alerted: alerts.length,
        threshold: ctx.payload.alertAbove,
      },
      affected,
    };
  },
};
