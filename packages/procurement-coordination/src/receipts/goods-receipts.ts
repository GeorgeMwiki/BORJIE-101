/**
 * Goods receipts — record arrivals against an issued PO, flag
 * discrepancies, and advance the PO status to `partially_received`
 * or `received` as appropriate.
 *
 * Each receipt is immutable once written. To correct a mistaken
 * receipt, post a corrective receipt with a discrepancy explaining
 * the reversal — this preserves the audit trail.
 */

import { z } from 'zod';
import type {
  ClockPort,
  GoodsReceipt,
  PoItem,
  ProcurementDataPort,
  PurchaseOrder,
  PurchaseOrderId,
  ReceiptDiscrepancy,
  ReceiptItem,
  ReceiptLineCondition,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';
import { logger } from '../logger.js';

const ReceiptItemSchema = z.object({
  poItemSku: z.string().nullable().optional(),
  description: z.string().min(1),
  qtyReceived: z.number().nonnegative(),
  condition: z.enum(['good', 'damaged', 'wrong_item', 'short_shipped', 'over_shipped']),
  photos: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

const RecordReceiptSchema = z.object({
  tenantId: z.string().min(1),
  poId: z.string().min(1),
  receivedBy: z.string().min(1),
  items: z.array(ReceiptItemSchema).min(1),
  notes: z.string().nullable().optional(),
});

export interface GoodsReceiptService {
  recordReceipt(input: z.input<typeof RecordReceiptSchema>): Promise<{
    readonly receipt: GoodsReceipt;
    readonly updatedPo: PurchaseOrder;
  }>;
  listReceiptsForPo(args: { readonly poId: PurchaseOrderId }): Promise<ReadonlyArray<GoodsReceipt>>;
}

export interface GoodsReceiptServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
  readonly notifyVendor?: (args: {
    readonly receipt: GoodsReceipt;
    readonly po: PurchaseOrder;
  }) => Promise<void>;
}

export function createGoodsReceiptService(
  deps: GoodsReceiptServiceDeps,
): GoodsReceiptService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async recordReceipt(rawInput) {
      const input = RecordReceiptSchema.parse(rawInput);
      const po = await port.findPo(input.poId as PurchaseOrderId);
      if (!po) throw new Error(`PO ${input.poId} not found`);
      if (po.status !== 'issued' && po.status !== 'partially_received') {
        throw new Error(`Cannot receive against PO in '${po.status}' status`);
      }

      // Build receipt + detect discrepancies.
      const items: ReadonlyArray<ReceiptItem> = input.items.map((it) => ({
        poItemSku: it.poItemSku ?? null,
        description: it.description,
        qtyReceived: it.qtyReceived,
        condition: it.condition as ReceiptLineCondition,
        photos: it.photos ?? [],
        notes: it.notes ?? null,
      }));
      const discrepancies = detectDiscrepancies(po, items);

      const receipt: GoodsReceipt = {
        id: `gr_${idFactory()}`,
        tenantId: input.tenantId,
        poId: po.id,
        receivedBy: input.receivedBy,
        receivedAt: clock.now().toISOString(),
        items,
        discrepancies,
        notes: input.notes ?? null,
      };
      await port.insertGoodsReceipt(receipt);

      // Update PO line qtyReceived totals.
      const allReceipts = [...(await port.listGoodsReceiptsByPo(po.id))];
      const updatedItems = po.items.map((pi): PoItem => {
        const total = allReceipts
          .flatMap((r) => r.items)
          .filter((r) => skuMatches(r.poItemSku, pi.sku))
          .reduce((s, r) => s + r.qtyReceived, 0);
        return { ...pi, qtyReceived: total };
      });
      const isFullyReceived = updatedItems.every((i) => i.qtyReceived >= i.qty);
      const isAnyReceived = updatedItems.some((i) => i.qtyReceived > 0);
      const newStatus: PurchaseOrder['status'] = isFullyReceived
        ? 'received'
        : isAnyReceived
          ? 'partially_received'
          : po.status;
      const updatedPo: PurchaseOrder = {
        ...po,
        items: updatedItems,
        status: newStatus,
      };
      await port.updatePo(updatedPo);

      if (deps.notifyVendor && discrepancies.length > 0) {
        try {
          await deps.notifyVendor({ receipt, po: updatedPo });
        } catch (err) {
          logger.error(`Receipt notify failed for PO ${po.id}`, { error: err });
        }
      }
      return { receipt, updatedPo };
    },

    async listReceiptsForPo(args) {
      return port.listGoodsReceiptsByPo(args.poId);
    },
  };
}

function detectDiscrepancies(
  po: PurchaseOrder,
  receivedItems: ReadonlyArray<ReceiptItem>,
): ReadonlyArray<ReceiptDiscrepancy> {
  const out: Array<ReceiptDiscrepancy> = [];
  for (const r of receivedItems) {
    if (r.condition === 'damaged') {
      out.push({
        kind: 'damaged',
        poItemSku: r.poItemSku,
        description: `Damaged on arrival: ${r.description}`,
        severity: 'high',
        actionRequired: 'Initiate replacement claim with vendor',
      });
    }
    if (r.condition === 'wrong_item') {
      out.push({
        kind: 'wrong_item',
        poItemSku: r.poItemSku,
        description: `Wrong item delivered: ${r.description}`,
        severity: 'medium',
        actionRequired: 'Return to vendor; request correct SKU',
      });
    }
    if (r.condition === 'short_shipped') {
      const poItem = po.items.find((p) => skuMatches(p.sku, r.poItemSku));
      if (poItem) {
        out.push({
          kind: 'qty_mismatch',
          poItemSku: r.poItemSku,
          description: `Short-shipped ${r.qtyReceived} of ${poItem.qty} for SKU ${r.poItemSku ?? r.description}`,
          severity: 'medium',
          actionRequired: 'Track outstanding qty; chase shipment',
        });
      }
    }
    if (r.condition === 'over_shipped') {
      out.push({
        kind: 'qty_mismatch',
        poItemSku: r.poItemSku,
        description: `Over-shipped: ${r.description}`,
        severity: 'low',
        actionRequired: 'Decide to accept or return excess',
      });
    }
  }
  // Detect late delivery vs PO deliveryDate.
  if (new Date(po.deliveryDate) < new Date()) {
    out.push({
      kind: 'late_delivery',
      poItemSku: null,
      description: `Delivery arrived after promised date ${po.deliveryDate}`,
      severity: 'low',
      actionRequired: 'Note in vendor performance log',
    });
  }
  return out;
}

function skuMatches(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a === b;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
