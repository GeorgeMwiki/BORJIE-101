/**
 * Vendor invoices + 3-way match.
 *
 * The match engine verifies:
 *   1. PO ↔ Receipt — qty invoiced ≤ qty received (no payment for
 *      goods not yet on premises).
 *   2. PO ↔ Invoice — unit prices on the invoice match unit prices on
 *      the PO (tolerance is configurable; default zero).
 *   3. Receipt ↔ Invoice — the invoiced lines line up with received
 *      lines.
 *
 * Match outcomes:
 *   - `matched`: all three checks pass → flips invoice to
 *     `approved_for_payment` and the budget `committed` becomes
 *     `spent`.
 *   - `exception`: routes to accounting with a list of reasons.
 *   - `reject`: caller can flip to `rejected` manually.
 */

import { z } from 'zod';
import type {
  Budget,
  ClockPort,
  CurrencyCode,
  InvoiceId,
  InvoiceLine,
  PoItem,
  ProcurementDataPort,
  PurchaseOrderId,
  ThreeWayMatchResult,
  VendorInvoice,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';

const InvoiceLineSchema = z.object({
  sku: z.string().nullable().optional(),
  description: z.string().min(1),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});

const SubmitInvoiceSchema = z.object({
  tenantId: z.string().min(1),
  vendorId: z.string().min(1),
  poId: z.string().min(1),
  invoiceNumber: z.string().min(1).max(80),
  lineItems: z.array(InvoiceLineSchema).min(1),
  currency: z.string().length(3),
  issuedAt: z.string(),
  dueDate: z.string(),
});

export interface InvoiceService {
  submitInvoice(input: z.input<typeof SubmitInvoiceSchema>): Promise<VendorInvoice>;
  threeWayMatch(args: {
    readonly invoiceId: InvoiceId;
    readonly priceTolerancePct?: number;
  }): Promise<ThreeWayMatchResult>;
  approveForPayment(args: { readonly invoiceId: InvoiceId }): Promise<VendorInvoice>;
  rejectInvoice(args: { readonly invoiceId: InvoiceId; readonly reason: string }): Promise<VendorInvoice>;
  markPaid(args: { readonly invoiceId: InvoiceId }): Promise<VendorInvoice>;
}

export interface InvoiceServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
}

export function createInvoiceService(deps: InvoiceServiceDeps): InvoiceService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async submitInvoice(rawInput) {
      const input = SubmitInvoiceSchema.parse(rawInput);
      const po = await port.findPo(input.poId as PurchaseOrderId);
      if (!po) throw new Error(`PO ${input.poId} not found`);
      if (po.vendorId !== input.vendorId) {
        throw new Error(`Invoice vendor ${input.vendorId} does not match PO vendor ${po.vendorId}`);
      }
      if (po.status === 'cancelled') {
        throw new Error('Cannot invoice a cancelled PO');
      }
      const lineItems: ReadonlyArray<InvoiceLine> = input.lineItems.map((l) => ({
        sku: l.sku ?? null,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        subtotal: round2(l.qty * l.unitPrice),
      }));
      const total = round2(lineItems.reduce((s, l) => s + l.subtotal, 0));
      const invoice: VendorInvoice = {
        id: `inv_${idFactory()}`,
        tenantId: input.tenantId,
        vendorId: input.vendorId as VendorInvoice['vendorId'],
        poId: po.id,
        invoiceNumber: input.invoiceNumber,
        lineItems,
        total,
        currency: input.currency.toUpperCase() as CurrencyCode,
        issuedAt: input.issuedAt,
        dueDate: input.dueDate,
        status: 'submitted',
        submittedAt: clock.now().toISOString(),
        exceptionReasons: [],
      };
      await port.insertInvoice(invoice);
      return invoice;
    },

    async threeWayMatch(args) {
      const invoice = await port.findInvoice(args.invoiceId);
      if (!invoice) throw new Error(`Invoice ${args.invoiceId} not found`);
      const po = await port.findPo(invoice.poId);
      if (!po) throw new Error(`PO ${invoice.poId} not found`);
      const tolerancePct = args.priceTolerancePct ?? 0;

      const discrepancies: Array<string> = [];

      // Currency check
      if (invoice.currency.toUpperCase() !== po.currency.toUpperCase()) {
        discrepancies.push(
          `Currency mismatch: invoice=${invoice.currency} po=${po.currency}`,
        );
      }

      // Price check + qty-invoiced ≤ qty-received check
      let qtyMatched = true;
      let priceMatched = true;
      for (const il of invoice.lineItems) {
        const poItem = findPoItem(po.items, il.sku, il.description);
        if (!poItem) {
          discrepancies.push(`No PO line for invoice item ${il.sku ?? il.description}`);
          priceMatched = false;
          qtyMatched = false;
          continue;
        }
        // Price tolerance
        if (poItem.unitPrice > 0) {
          const diff = Math.abs(il.unitPrice - poItem.unitPrice);
          const allowed = poItem.unitPrice * (tolerancePct / 100);
          if (diff > allowed) {
            priceMatched = false;
            discrepancies.push(
              `Price drift on ${il.sku ?? il.description}: invoice=${il.unitPrice} po=${poItem.unitPrice}`,
            );
          }
        }
        // Qty-received check
        if (il.qty > poItem.qtyReceived) {
          qtyMatched = false;
          discrepancies.push(
            `Invoiced ${il.qty} of ${il.sku ?? il.description} but only ${poItem.qtyReceived} received`,
          );
        }
      }

      // Totals reconciliation (cheap final sanity check).
      const invoiceLinesTotal = round2(invoice.lineItems.reduce((s, l) => s + l.subtotal, 0));
      const totalsReconciled = Math.abs(invoice.total - invoiceLinesTotal) < 0.01;
      if (!totalsReconciled) {
        discrepancies.push(
          `Invoice total ${invoice.total} != sum of line subtotals ${invoiceLinesTotal}`,
        );
      }

      const matched = qtyMatched && priceMatched && totalsReconciled && discrepancies.length === 0;
      const recommendedAction: ThreeWayMatchResult['recommendedAction'] = matched
        ? 'approve'
        : discrepancies.some((d) => d.startsWith('Currency mismatch'))
          ? 'reject'
          : 'route_to_exception';

      // Persist match outcome on the invoice.
      const updated: VendorInvoice = {
        ...invoice,
        status: matched ? 'matched' : 'exception',
        exceptionReasons: matched ? [] : discrepancies,
      };
      await port.updateInvoice(updated);

      return {
        invoiceId: invoice.id,
        poId: po.id,
        matched,
        qtyMatched,
        priceMatched,
        totalsReconciled,
        discrepancies,
        recommendedAction,
      };
    },

    async approveForPayment(args) {
      const invoice = await port.findInvoice(args.invoiceId);
      if (!invoice) throw new Error(`Invoice ${args.invoiceId} not found`);
      if (invoice.status !== 'matched' && invoice.status !== 'exception') {
        throw new Error(`Cannot approve invoice in '${invoice.status}' status`);
      }
      const updated: VendorInvoice = {
        ...invoice,
        status: 'approved_for_payment',
      };
      await port.updateInvoice(updated);
      return updated;
    },

    async rejectInvoice(args) {
      const invoice = await port.findInvoice(args.invoiceId);
      if (!invoice) throw new Error(`Invoice ${args.invoiceId} not found`);
      if (invoice.status === 'paid') {
        throw new Error('Cannot reject a paid invoice');
      }
      const updated: VendorInvoice = {
        ...invoice,
        status: 'rejected',
        exceptionReasons: [...invoice.exceptionReasons, `rejected: ${args.reason}`],
      };
      await port.updateInvoice(updated);
      return updated;
    },

    async markPaid(args) {
      const invoice = await port.findInvoice(args.invoiceId);
      if (!invoice) throw new Error(`Invoice ${args.invoiceId} not found`);
      if (invoice.status !== 'approved_for_payment') {
        throw new Error(`Cannot pay invoice in '${invoice.status}' status`);
      }
      const updated: VendorInvoice = {
        ...invoice,
        status: 'paid',
      };
      await port.updateInvoice(updated);
      // Move committed→spent on the budget (if linked through PO→requisition).
      const po = await port.findPo(invoice.poId);
      if (po?.requisitionId) {
        const requisition = await port.findRequisition(po.requisitionId);
        if (requisition?.budgetId) {
          const budget = await port.findBudget(requisition.budgetId);
          if (budget) {
            const updatedBudget: Budget = {
              ...budget,
              committed: Math.max(0, budget.committed - invoice.total),
              spent: budget.spent + invoice.total,
            };
            await port.updateBudget(updatedBudget);
          }
        }
      }
      return updated;
    },
  };
}

function findPoItem(
  items: ReadonlyArray<PoItem>,
  sku: string | null,
  description: string,
): PoItem | null {
  if (sku) {
    const bySku = items.find((i) => i.sku === sku);
    if (bySku) return bySku;
  }
  // Fallback: description match.
  return items.find((i) => i.description === description) ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
