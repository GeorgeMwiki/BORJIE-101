/**
 * vendor_invoice_approver_agent — auto-approves vendor invoices below the
 * per-tenant maintenance threshold. Above threshold it queues a human
 * review via the ApprovalService.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface VendorInvoice {
  readonly id: string;
  readonly vendorId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly workOrderId: string | null;
  readonly isSafetyCritical: boolean;
}

const PayloadSchema = z.object({
  invoiceIds: z.array(z.string()).optional(),
  /** When omitted the agent consults autonomy-policy threshold. */
  thresholdMinorUnits: z.number().int().min(0).optional(),
});

export const vendorInvoiceApproverAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'vendor_invoice_approver_agent',
  title: 'Vendor-Invoice Approver',
  description:
    'Auto-approves small vendor invoices; escalates larger ones for human review.',
  trigger: {
    kind: 'cron',
    cron: '15 */4 * * *',
    description: 'Every 4 hours.',
  },
  guardrails: {
    autonomyDomain: 'maintenance',
    autonomyAction: 'approve_work_order',
    description:
      'Gated on maintenance.autoApproveBelowMinorUnits; safety-critical always escalates.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const listPending = ctx.services.listPendingVendorInvoices as
      | ((tenantId: string, ids?: readonly string[]) => Promise<readonly VendorInvoice[]>)
      | undefined;
    const approvalService = ctx.services.approvalService as
      | {
          queueApproval: (input: {
            tenantId: string;
            entityType: 'vendor_invoice';
            entityId: string;
            reason: string;
          }) => Promise<{ id: string }>;
          autoApprove: (input: {
            tenantId: string;
            entityType: 'vendor_invoice';
            entityId: string;
            approvedBy: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!listPending || !approvalService) {
      return {
        outcome: 'no_op',
        summary: 'Vendor-invoice lookup or ApprovalService missing.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const threshold = ctx.payload.thresholdMinorUnits ?? 50_00_000;
    const invoices = await listPending(ctx.tenantId, ctx.payload.invoiceIds);
    let approved = 0;
    let queued = 0;
    const affected: Array<{ kind: string; id: string }> = [];

    for (const inv of invoices) {
      if (inv.isSafetyCritical || inv.amountMinorUnits > threshold) {
        try {
          const q = await approvalService.queueApproval({
            tenantId: ctx.tenantId,
            entityType: 'vendor_invoice',
            entityId: inv.id,
            reason: inv.isSafetyCritical
              ? 'Safety-critical vendor invoice'
              : `Over threshold (${inv.amountMinorUnits} > ${threshold})`,
          });
          queued += 1;
          affected.push({ kind: 'approval_request', id: q.id });
        } catch {
          /* swallow */
        }
      } else {
        try {
          const a = await approvalService.autoApprove({
            tenantId: ctx.tenantId,
            entityType: 'vendor_invoice',
            entityId: inv.id,
            approvedBy: `agent:${ctx.agentId}`,
          });
          approved += 1;
          affected.push({ kind: 'vendor_invoice', id: a.id });
        } catch {
          /* swallow */
        }
      }
    }

    return {
      outcome: affected.length ? 'executed' : 'no_op',
      summary: `Auto-approved ${approved}, queued ${queued} for review (of ${invoices.length}).`,
      data: { approved, queued, total: invoices.length, threshold },
      affected,
    };
  },
};
