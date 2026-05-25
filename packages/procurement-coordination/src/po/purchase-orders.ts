/**
 * Purchase order service — create, approve, issue, partially receive,
 * close, cancel. Hooks the document studio port to render a PDF on
 * issuance and emits a budget commitment so spend analytics + the
 * budget controls see the encumbrance immediately.
 *
 * PO numbering: tenant-prefixed sequential — `<slug>-PO-<yyyy>-<seq>`.
 * The sequence comes from the data port so every PO number is unique
 * per (tenantId, year) without a race condition between concurrent
 * requesters (the port adapter wraps the read-modify-write in a
 * transaction in the Postgres-backed impl).
 */

import { z } from 'zod';
import type {
  ApprovalEnginePort,
  Budget,
  ClockPort,
  CurrencyCode,
  DocumentStudioPort,
  PoItem,
  ProcurementDataPort,
  PurchaseOrder,
  PurchaseOrderId,
  Vendor,
  VendorCategory,
  VendorId,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';
import { logger } from '../logger.js';

const PoItemSchema = z.object({
  sku: z.string().nullable().optional(),
  description: z.string().min(1).max(500),
  qty: z.number().positive(),
  unit: z.string().min(1).max(20),
  unitPrice: z.number().nonnegative(),
});

const CreatePoSchema = z.object({
  tenantId: z.string().min(1),
  tenantSlug: z.string().min(1).max(40),
  vendorId: z.string().min(1),
  requisitionId: z.string().nullable().optional(),
  rfqId: z.string().nullable().optional(),
  bidId: z.string().nullable().optional(),
  frameworkAgreementId: z.string().nullable().optional(),
  items: z.array(PoItemSchema).min(1),
  currency: z.string().length(3),
  deliveryDate: z.string(),
  deliveryAddress: z.string().min(1).max(500),
  paymentTerms: z.string().default('NET30'),
  budgetId: z.string().nullable().optional(),
  category: z.string().optional(),
});

export interface PurchaseOrderService {
  createPo(input: z.input<typeof CreatePoSchema>): Promise<PurchaseOrder>;
  approvePo(args: {
    readonly id: PurchaseOrderId;
    readonly chainOutcome: 'approved' | 'rejected';
  }): Promise<PurchaseOrder>;
  issuePo(args: { readonly id: PurchaseOrderId }): Promise<PurchaseOrder>;
  cancelPo(args: { readonly id: PurchaseOrderId; readonly reason: string }): Promise<PurchaseOrder>;
  closePo(args: { readonly id: PurchaseOrderId }): Promise<PurchaseOrder>;
}

export interface PurchaseOrderServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly approvalEngine: ApprovalEnginePort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
  readonly documentStudio?: DocumentStudioPort;
  readonly notifyVendor?: (args: {
    readonly po: PurchaseOrder;
    readonly vendor: Vendor;
  }) => Promise<void>;
}

export function createPurchaseOrderService(
  deps: PurchaseOrderServiceDeps,
): PurchaseOrderService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async createPo(rawInput) {
      const input = CreatePoSchema.parse(rawInput);
      const items: ReadonlyArray<PoItem> = input.items.map((it) => ({
        sku: it.sku ?? null,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice,
        subtotal: round2(it.qty * it.unitPrice),
        qtyReceived: 0,
      }));
      const total = round2(items.reduce((s, i) => s + i.subtotal, 0));
      const year = clock.now().getUTCFullYear();
      const seq = await port.nextPoSequence(input.tenantId, year);
      const poNumber = `${input.tenantSlug}-PO-${year}-${seq.toString().padStart(5, '0')}`;
      const currency = input.currency.toUpperCase() as CurrencyCode;

      // Approval chain
      const chain = await deps.approvalEngine.resolveChain({
        tenantId: input.tenantId,
        subjectKind: 'po',
        subjectId: `po_${seq}`,
        amount: total,
        currency,
        category: (input.category as VendorCategory | 'all') ?? 'all',
      });

      const po: PurchaseOrder = {
        id: `po_${idFactory()}`,
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        poNumber,
        vendorId: input.vendorId as VendorId,
        requisitionId: (input.requisitionId as PurchaseOrder['requisitionId']) ?? null,
        rfqId: (input.rfqId as PurchaseOrder['rfqId']) ?? null,
        bidId: (input.bidId as PurchaseOrder['bidId']) ?? null,
        frameworkAgreementId:
          (input.frameworkAgreementId as PurchaseOrder['frameworkAgreementId']) ?? null,
        items,
        total,
        currency,
        deliveryDate: input.deliveryDate,
        deliveryAddress: input.deliveryAddress,
        paymentTerms: input.paymentTerms ?? 'NET30',
        approvalChainId: chain.id,
        status: 'pending_approval',
        createdAt: clock.now().toISOString(),
        issuedAt: null,
        cancelledAt: null,
        closedAt: null,
        pdfUrl: null,
      };
      await port.insertPo(po);
      return po;
    },

    async approvePo(args) {
      const po = await port.findPo(args.id);
      if (!po) throw new Error(`PO ${args.id} not found`);
      if (po.status !== 'pending_approval') {
        throw new Error(`Cannot finalise approval: PO is '${po.status}'`);
      }
      const status: PurchaseOrder['status'] =
        args.chainOutcome === 'approved' ? 'approved' : 'cancelled';
      const updated: PurchaseOrder = {
        ...po,
        status,
        cancelledAt: status === 'cancelled' ? clock.now().toISOString() : po.cancelledAt,
      };
      await port.updatePo(updated);
      return updated;
    },

    async issuePo(args) {
      const po = await port.findPo(args.id);
      if (!po) throw new Error(`PO ${args.id} not found`);
      if (po.status !== 'approved') {
        throw new Error(`Cannot issue: PO is '${po.status}', expected 'approved'`);
      }
      const vendor = await port.findVendor(po.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${po.vendorId} not found for PO ${args.id}`);
      }
      if (vendor.kycStatus !== 'approved') {
        throw new Error(
          `Cannot issue PO to vendor ${vendor.id} — KYC status '${vendor.kycStatus}'`,
        );
      }
      if (vendor.preferredStatus === 'blacklisted') {
        throw new Error(`Cannot issue PO to blacklisted vendor ${vendor.id}`);
      }

      // Commit the spend against the linked requisition's budget, if any.
      if (po.requisitionId) {
        const requisition = await port.findRequisition(po.requisitionId);
        if (requisition?.budgetId) {
          const budget = await port.findBudget(requisition.budgetId);
          if (budget) {
            // Release reservation, add commitment.
            const updatedBudget: Budget = {
              ...budget,
              reserved: Math.max(0, budget.reserved - requisition.estimatedTotal),
              committed: budget.committed + po.total,
            };
            await port.updateBudget(updatedBudget);
          }
        }
      }

      let pdfUrl: string | null = null;
      if (deps.documentStudio) {
        try {
          const render = await deps.documentStudio.renderPoPdf(po, vendor);
          pdfUrl = render.url;
        } catch (err) {
          logger.error(`PO ${args.id} PDF render failed`, { error: err });
        }
      }
      const issued: PurchaseOrder = {
        ...po,
        status: 'issued',
        issuedAt: clock.now().toISOString(),
        pdfUrl,
      };
      await port.updatePo(issued);

      if (deps.notifyVendor) {
        try {
          await deps.notifyVendor({ po: issued, vendor });
        } catch (err) {
          logger.error(`PO ${args.id} vendor-notification failed`, { error: err });
        }
      }
      return issued;
    },

    async cancelPo(args) {
      const po = await port.findPo(args.id);
      if (!po) throw new Error(`PO ${args.id} not found`);
      if (po.status === 'closed' || po.status === 'received') {
        throw new Error(`Cannot cancel a ${po.status} PO`);
      }
      // Release commitment if it was issued.
      if (po.status === 'issued' || po.status === 'partially_received') {
        if (po.requisitionId) {
          const requisition = await port.findRequisition(po.requisitionId);
          if (requisition?.budgetId) {
            const budget = await port.findBudget(requisition.budgetId);
            if (budget) {
              const updatedBudget: Budget = {
                ...budget,
                committed: Math.max(0, budget.committed - po.total),
              };
              await port.updateBudget(updatedBudget);
            }
          }
        }
      }
      const updated: PurchaseOrder = {
        ...po,
        status: 'cancelled',
        cancelledAt: clock.now().toISOString(),
        paymentTerms: `${po.paymentTerms} | cancelled: ${args.reason}`,
      };
      await port.updatePo(updated);
      return updated;
    },

    async closePo(args) {
      const po = await port.findPo(args.id);
      if (!po) throw new Error(`PO ${args.id} not found`);
      if (po.status !== 'received' && po.status !== 'partially_received') {
        throw new Error(`Cannot close PO in '${po.status}' status`);
      }
      const updated: PurchaseOrder = {
        ...po,
        status: 'closed',
        closedAt: clock.now().toISOString(),
      };
      await port.updatePo(updated);
      return updated;
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
