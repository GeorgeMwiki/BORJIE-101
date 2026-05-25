/**
 * payment_plan_proposer_agent — when the arrears ladder reaches 30 days on
 * a case, auto-drafts an installment plan proposal through the arrears
 * proposer surface (services/api-gateway/src/composition/arrears-infrastructure.ts).
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface ArrearsCase30Day {
  readonly id: string;
  readonly customerId: string;
  readonly balanceMinorUnits: number;
  readonly currency: string;
  readonly daysOverdue: number;
}

const PayloadSchema = z.object({
  installments: z.number().int().min(2).max(12).default(3),
  /** Minimum days overdue before the agent will act. */
  minDaysOverdue: z.number().int().min(7).max(120).default(30),
});

export const paymentPlanProposerAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'payment_plan_proposer_agent',
  title: 'Payment Plan Proposer',
  description:
    'Drafts installment plans on arrears cases reaching 30 days overdue.',
  trigger: { kind: 'cron', cron: '0 8 * * *', description: 'Daily 08:00 UTC.' },
  guardrails: {
    autonomyDomain: 'finance',
    autonomyAction: 'act_on_arrears',
    description: 'Gated on finance arrears policy; escalation above ceiling.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listCases = ctx.services.listArrearsCasesOverDays as
      | ((tenantId: string, minDays: number) => Promise<readonly ArrearsCase30Day[]>)
      | undefined;
    const proposer = ctx.services.arrearsProposer as
      | {
          proposePaymentPlan: (input: {
            tenantId: string;
            customerId: string;
            arrearsCaseId: string;
            amountMinorUnits: number;
            currency: string;
            installments: number;
            reason: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!listCases || !proposer) {
      return {
        outcome: 'no_op',
        summary: 'Arrears case lookup or proposer missing.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const cases = await listCases(ctx.tenantId, ctx.payload.minDaysOverdue);
    const affected: Array<{ kind: string; id: string }> = [];
    for (const c of cases) {
      try {
        const p = await proposer.proposePaymentPlan({
          tenantId: ctx.tenantId,
          customerId: c.customerId,
          arrearsCaseId: c.id,
          amountMinorUnits: c.balanceMinorUnits,
          currency: c.currency,
          installments: ctx.payload.installments,
          reason: `Auto-drafted ${ctx.payload.installments}-installment plan (${c.daysOverdue}d overdue).`,
        });
        affected.push({ kind: 'arrears_proposal', id: p.id });
      } catch {
        /* swallow per-case */
      }
    }
    return {
      outcome: affected.length ? 'executed' : 'no_op',
      summary: `Drafted ${affected.length} installment plan(s) across ${cases.length} case(s).`,
      data: { casesConsidered: cases.length, plansDrafted: affected.length },
      affected,
    };
  },
};
