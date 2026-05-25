/**
 * platform.adjust_invoice — credit / refund / line-item edit on an
 * existing invoice.
 *
 * Risk tier: billing. Requires four-eye approval AND the cost-ceiling
 * gate. Sovereign-ledger persisted.
 *
 * Rollback: reverse the adjustment by booking an offsetting line-item.
 * We do NOT delete the original adjustment row — the audit chain must
 * remain intact. The reversal carries a `reversalOfAdjustmentId` link.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAllScopes,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

export const AdjustInvoiceInputSchema = z.object({
  invoiceId: z.string().min(1).max(64),
  adjustmentCents: z.number().int(),
  reason: z.string().min(8).max(500),
  category: z
    .enum(['refund', 'credit', 'discount', 'tax-correction', 'manual'])
    .optional(),
});

export const AdjustInvoiceOutputSchema = z.object({
  invoiceId: z.string(),
  tenantId: z.string(),
  adjustmentId: z.string(),
  adjustmentCents: z.number().int(),
  category: z.enum(['refund', 'credit', 'discount', 'tax-correction', 'manual']),
  reason: z.string(),
  newBalanceCents: z.number().int(),
  appliedAt: z.string(),
});

export type AdjustInvoiceInput = z.infer<typeof AdjustInvoiceInputSchema>;
export type AdjustInvoiceOutput = z.infer<typeof AdjustInvoiceOutputSchema>;

export interface InvoiceAdjustmentPort {
  loadInvoice(invoiceId: string): Promise<{
    readonly invoiceId: string;
    readonly tenantId: string;
    readonly balanceCents: number;
  } | null>;
  applyAdjustment(args: {
    readonly invoiceId: string;
    readonly adjustmentCents: number;
    readonly reason: string;
    readonly category: AdjustInvoiceInput['category'] extends infer C
      ? C extends undefined
        ? 'manual'
        : Exclude<C, undefined>
      : 'manual';
  }): Promise<AdjustInvoiceOutput>;
  reverseAdjustment(args: {
    readonly invoiceId: string;
    readonly adjustmentId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface AdjustInvoiceDeps {
  readonly invoices: InvoiceAdjustmentPort;
  /**
   * Hard ceiling for a single adjustment, in USD cents (absolute value).
   * Calls exceeding this are refused with `COST_CEILING_EXCEEDED` even
   * after four-eye approval — the ceiling is the FINAL gate.
   */
  readonly maxAdjustmentUsdCents: number;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:billing:write',
  'platform:ops:write',
];

/** Conservative pre-call cost estimate — used for the OTel attribute. */
const COST_ESTIMATE_USD = 0.05;

export function createAdjustInvoiceTool(
  deps: AdjustInvoiceDeps,
): HqToolSpec<AdjustInvoiceInput, AdjustInvoiceOutput> {
  return {
    name: 'platform.adjust_invoice',
    riskTier: 'billing',
    description:
      'Adjust an existing invoice (credit / refund / line-item correction). Four-eye approval + cost-ceiling gate. Reversible via offsetting adjustment.',
    inputSchema: AdjustInvoiceInputSchema,
    outputSchema: AdjustInvoiceOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    costEstimateUsd: COST_ESTIMATE_USD,
    rollback: async (output, _ctx) => {
      await deps.invoices.reverseAdjustment({
        invoiceId: output.invoiceId,
        adjustmentId: output.adjustmentId,
        reason: `automated rollback of ${output.adjustmentId}`,
      });
    },
    async execute(
      input: AdjustInvoiceInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<AdjustInvoiceOutput>> {
      return withHqTelemetry({
        toolName: 'platform.adjust_invoice',
        riskTier: 'billing',
        approvalRequired: true,
        costEstimateUsd: COST_ESTIMATE_USD,
        tenantId: null, // determined inside body after invoice load
        ctx,
        input,
        body: async () => {
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:billing:write + platform:ops:write scopes',
            );
          }
          if (Math.abs(input.adjustmentCents) > deps.maxAdjustmentUsdCents) {
            return refusal(
              'COST_CEILING_EXCEEDED',
              `adjustment of ${input.adjustmentCents} cents exceeds ceiling ${deps.maxAdjustmentUsdCents}`,
            );
          }
          const invoice = await deps.invoices.loadInvoice(input.invoiceId);
          if (!invoice) {
            return refusal(
              'TENANT_NOT_FOUND',
              `invoice ${input.invoiceId} not found`,
            );
          }
          if (!callerCanReachTenant(ctx.caller, invoice.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${invoice.tenantId}`,
            );
          }
          const applied = await deps.invoices.applyAdjustment({
            invoiceId: input.invoiceId,
            adjustmentCents: input.adjustmentCents,
            reason: input.reason,
            category: input.category ?? 'manual',
          });
          return { kind: 'ok', output: applied };
        },
      });
    },
  };
}
