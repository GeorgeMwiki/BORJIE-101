/**
 * late_fee_calculator_agent — daily, finds overdue invoices past grace
 * period and proposes a late-fee line item.
 *
 * Fee size: per-tenant configured via autonomy-policy finance block —
 * we use `finance.autoApproveWaiversMinorUnits` (inverted: under this
 * bound the agent may auto-propose; over the bound it queues approval).
 * The service called is the existing ArrearsService's proposal surface
 * — we invoke via `services.arrearsService.proposeLineItem` when present.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface OverdueInvoice {
  readonly id: string;
  readonly customerId: string;
  readonly amountMinorUnits: number;
  readonly daysOverdue: number;
  readonly currency: string;
}

const PayloadSchema = z.object({
  graceDays: z.number().int().min(0).max(30).default(5),
  feeRatePct: z.number().min(0).max(50).default(5),
  flatFeeMinorUnits: z.number().int().min(0).default(0),
});

export const lateFeeCalculatorAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'late_fee_calculator_agent',
  title: 'Late-Fee Calculator',
  description:
    'Proposes late-fee adjustments on invoices past grace period.',
  trigger: { kind: 'cron', cron: '30 6 * * *', description: 'Daily 06:30 UTC.' },
  guardrails: {
    autonomyDomain: 'finance',
    autonomyAction: 'act_on_arrears',
    description:
      'Checked against finance.escalateArrearsAboveMinorUnits; auto when under.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listOverdue = ctx.services.listOverdueInvoices as
      | ((tenantId: string, graceDays: number) => Promise<readonly OverdueInvoice[]>)
      | undefined;
    const proposer = ctx.services.arrearsProposer as
      | {
          proposeLateFee: (input: {
            tenantId: string;
            customerId: string;
            invoiceId: string;
            amountMinorUnits: number;
            currency: string;
            reason: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!listOverdue || !proposer) {
      return {
        outcome: 'no_op',
        summary: 'Overdue lookup or arrears proposer not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const overdue = await listOverdue(ctx.tenantId, ctx.payload.graceDays);
    const proposed: Array<{ kind: string; id: string }> = [];
    for (const inv of overdue) {
      const pctFee = Math.floor(
        (inv.amountMinorUnits * ctx.payload.feeRatePct) / 100,
      );
      const amount = Math.max(pctFee, ctx.payload.flatFeeMinorUnits);
      if (amount <= 0) continue;
      try {
        const p = await proposer.proposeLateFee({
          tenantId: ctx.tenantId,
          customerId: inv.customerId,
          invoiceId: inv.id,
          amountMinorUnits: amount,
          currency: inv.currency,
          reason: `Late fee — ${inv.daysOverdue} days overdue (> ${ctx.payload.graceDays}d grace)`,
        });
        proposed.push({ kind: 'arrears_proposal', id: p.id });
      } catch {
        /* per-invoice failure — continue */
      }
    }
    return {
      outcome: proposed.length ? 'executed' : 'no_op',
      summary: `Proposed ${proposed.length} late-fee line item(s) against ${overdue.length} overdue invoice(s).`,
      data: { overdueCount: overdue.length, proposalCount: proposed.length },
      affected: proposed,
    };
  },
};
