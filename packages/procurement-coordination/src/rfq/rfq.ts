/**
 * RFQ / Tender service — publish, bid, close, award.
 *
 * Two modes of publication:
 *   - explicit vendor list (`publishedTo: VendorId[]`) — visible only
 *     to invited vendors.
 *   - marketplace (`publishedTo: 'marketplace'`) — broadcast to all
 *     marketplace-registered vendors per questionnaire Section 7.
 *
 * Sealed bidding: when `sealedBidding=true`, bid totals + line prices
 * MUST NOT be returned from `listBidsForVendor()` until the RFQ
 * closes. The public API enforces this by setting bid `status='sealed'`
 * at submission and flipping to `'visible'` at close.
 *
 * Award flow: `awardBid()` flips the winning bid to `awarded`, every
 * other bid to `lost`, the RFQ to `awarded`, and returns the PO
 * skeleton — the PO service consumes that skeleton to create the
 * actual purchase order.
 */

import { z } from 'zod';
import type {
  Bid,
  BidId,
  BidLine,
  ClockPort,
  ProcurementDataPort,
  PurchaseOrderId,
  RequisitionId,
  Rfq,
  RfqId,
  RfqLine,
  Vendor,
  VendorId,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';
import { logger } from '../logger.js';

const RfqLineSchema = z.object({
  sku: z.string().nullable().optional(),
  description: z.string().min(1),
  qty: z.number().positive(),
  unit: z.string().min(1),
});

const PublishRfqSchema = z.object({
  tenantId: z.string().min(1),
  requisitionId: z.string().min(1),
  scope: z.string().min(1).max(2000),
  items: z.array(RfqLineSchema).min(1),
  deliveryAddress: z.string().min(1).max(500),
  dueDate: z.string(),
  publishedTo: z.union([z.array(z.string()).min(1), z.literal('marketplace')]),
  sealedBidding: z.boolean().default(true),
  currency: z.string().length(3),
});

const SubmitBidSchema = z.object({
  rfqId: z.string().min(1),
  vendorId: z.string().min(1),
  lines: z
    .array(
      z.object({
        sku: z.string().nullable().optional(),
        description: z.string().min(1),
        qty: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .min(1),
  deliveryDays: z.number().int().nonnegative(),
  validUntil: z.string(),
  notes: z.string().nullable().optional(),
});

export interface RfqService {
  createRfq(input: z.input<typeof PublishRfqSchema>): Promise<Rfq>;
  publishRfq(args: { readonly id: RfqId }): Promise<Rfq>;
  submitBid(input: z.input<typeof SubmitBidSchema>): Promise<Bid>;
  /**
   * Returns bids for the RFQ. If `forVendorId` is provided, returns
   * only that vendor's bids (own bids visible even when sealed).
   * Other vendors' bids are excluded entirely if sealed-bidding is on
   * and the RFQ is open.
   */
  listBidsForVendor(args: {
    readonly rfqId: RfqId;
    readonly forVendorId?: VendorId;
  }): Promise<ReadonlyArray<Bid>>;
  /**
   * Buyer-side bid view. Returns all bids, but if the RFQ is sealed
   * AND still open, hides line prices + totals.
   */
  listBidsForBuyer(args: { readonly rfqId: RfqId }): Promise<ReadonlyArray<Bid>>;
  withdrawBid(args: { readonly bidId: BidId; readonly vendorId: VendorId }): Promise<Bid>;
  closeRfq(args: { readonly id: RfqId }): Promise<Rfq>;
  awardBid(args: { readonly bidId: BidId }): Promise<{
    readonly rfq: Rfq;
    readonly winningBid: Bid;
    readonly losingBids: ReadonlyArray<Bid>;
  }>;
  cancelRfq(args: { readonly id: RfqId; readonly reason: string }): Promise<Rfq>;
}

export interface RfqServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
  /**
   * Called when an RFQ is published to a vendor list — used to fan
   * out invitations (email/SMS). Optional; default is a no-op.
   */
  readonly notifyVendors?: (args: {
    readonly rfq: Rfq;
    readonly vendor: Vendor;
  }) => Promise<void>;
}

export function createRfqService(deps: RfqServiceDeps): RfqService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async createRfq(rawInput) {
      const input = PublishRfqSchema.parse(rawInput);
      if (new Date(input.dueDate) <= clock.now()) {
        throw new Error('RFQ dueDate must be in the future');
      }
      const items: ReadonlyArray<RfqLine> = input.items.map((it) => ({
        sku: it.sku ?? null,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
      }));
      const rfq: Rfq = {
        id: `rfq_${idFactory()}`,
        tenantId: input.tenantId,
        requisitionId: input.requisitionId as RequisitionId,
        scope: input.scope,
        items,
        deliveryAddress: input.deliveryAddress,
        dueDate: input.dueDate,
        publishedTo:
          input.publishedTo === 'marketplace'
            ? 'marketplace'
            : (input.publishedTo as ReadonlyArray<VendorId>),
        sealedBidding: input.sealedBidding ?? true,
        status: 'draft',
        publishedAt: null,
        closedAt: null,
        awardedBidId: null,
        currency: input.currency.toUpperCase(),
      };
      await port.insertRfq(rfq);
      return rfq;
    },

    async publishRfq(args) {
      const rfq = await port.findRfq(args.id);
      if (!rfq) throw new Error(`RFQ ${args.id} not found`);
      if (rfq.status !== 'draft') {
        throw new Error(`Cannot publish RFQ in '${rfq.status}' status`);
      }
      const updated: Rfq = {
        ...rfq,
        status: 'published',
        publishedAt: clock.now().toISOString(),
      };
      await port.updateRfq(updated);

      if (Array.isArray(rfq.publishedTo) && deps.notifyVendors) {
        for (const vendorId of rfq.publishedTo) {
          const vendor = await port.findVendor(vendorId);
          if (vendor) {
            try {
              await deps.notifyVendors({ rfq: updated, vendor });
            } catch (err) {
              logger.error(`RFQ notify failed for vendor ${vendorId}`, { error: err });
            }
          }
        }
      }
      return updated;
    },

    async submitBid(rawInput) {
      const input = SubmitBidSchema.parse(rawInput);
      const rfq = await port.findRfq(input.rfqId as RfqId);
      if (!rfq) throw new Error(`RFQ ${input.rfqId} not found`);
      if (rfq.status !== 'published') {
        throw new Error(`Cannot submit bid: RFQ is '${rfq.status}'`);
      }
      if (new Date(rfq.dueDate) <= clock.now()) {
        throw new Error(`Cannot submit bid: RFQ closed at ${rfq.dueDate}`);
      }
      if (
        Array.isArray(rfq.publishedTo) &&
        !rfq.publishedTo.includes(input.vendorId as VendorId)
      ) {
        throw new Error(`Vendor ${input.vendorId} is not invited to RFQ ${rfq.id}`);
      }
      const lines: ReadonlyArray<BidLine> = input.lines.map((l) => ({
        sku: l.sku ?? null,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        subtotal: round2(l.qty * l.unitPrice),
      }));
      const total = round2(lines.reduce((s, l) => s + l.subtotal, 0));
      const bid: Bid = {
        id: `bid_${idFactory()}`,
        rfqId: rfq.id,
        vendorId: input.vendorId as VendorId,
        lines,
        total,
        currency: rfq.currency,
        deliveryDays: input.deliveryDays,
        validUntil: input.validUntil,
        notes: input.notes ?? null,
        status: rfq.sealedBidding ? 'sealed' : 'visible',
        submittedAt: clock.now().toISOString(),
      };
      await port.insertBid(bid);
      return bid;
    },

    async listBidsForVendor(args) {
      const rfq = await port.findRfq(args.rfqId);
      if (!rfq) throw new Error(`RFQ ${args.rfqId} not found`);
      const all = await port.listBids(args.rfqId);
      if (args.forVendorId) {
        return all.filter((b) => b.vendorId === args.forVendorId);
      }
      // No vendor filter — only return non-sealed.
      if (rfq.sealedBidding && rfq.status === 'published') {
        return [];
      }
      return all;
    },

    async listBidsForBuyer(args) {
      const rfq = await port.findRfq(args.rfqId);
      if (!rfq) throw new Error(`RFQ ${args.rfqId} not found`);
      const all = await port.listBids(args.rfqId);
      if (rfq.sealedBidding && rfq.status === 'published') {
        // Buyer can see the names + that bids exist, but not prices.
        return all.map((b) => ({
          ...b,
          total: 0,
          lines: b.lines.map((l) => ({
            ...l,
            unitPrice: 0,
            subtotal: 0,
          })),
        }));
      }
      return all;
    },

    async withdrawBid(args) {
      const bid = await port.findBid(args.bidId);
      if (!bid) throw new Error(`Bid ${args.bidId} not found`);
      if (bid.vendorId !== args.vendorId) {
        throw new Error(`Bid ${args.bidId} does not belong to vendor ${args.vendorId}`);
      }
      if (bid.status === 'awarded' || bid.status === 'lost') {
        throw new Error('Cannot withdraw a finalised bid');
      }
      const updated: Bid = { ...bid, status: 'withdrawn' };
      await port.updateBid(updated);
      return updated;
    },

    async closeRfq(args) {
      const rfq = await port.findRfq(args.id);
      if (!rfq) throw new Error(`RFQ ${args.id} not found`);
      if (rfq.status !== 'published') {
        throw new Error(`Cannot close RFQ in '${rfq.status}' status`);
      }
      const updated: Rfq = {
        ...rfq,
        status: 'closed',
        closedAt: clock.now().toISOString(),
      };
      await port.updateRfq(updated);
      // Unseal bids on close.
      const bids = await port.listBids(rfq.id);
      for (const b of bids.filter((b) => b.status === 'sealed')) {
        await port.updateBid({ ...b, status: 'visible' });
      }
      return updated;
    },

    async awardBid(args) {
      const winning = await port.findBid(args.bidId);
      if (!winning) throw new Error(`Bid ${args.bidId} not found`);
      const rfq = await port.findRfq(winning.rfqId);
      if (!rfq) throw new Error(`RFQ ${winning.rfqId} not found`);
      if (rfq.status !== 'closed' && rfq.status !== 'published') {
        throw new Error(`Cannot award: RFQ is '${rfq.status}'`);
      }
      const allBids = await port.listBids(rfq.id);
      const losing = allBids.filter(
        (b) => b.id !== winning.id && b.status !== 'withdrawn',
      );
      const awarded: Bid = { ...winning, status: 'awarded' };
      const losers: Array<Bid> = [];
      await port.updateBid(awarded);
      for (const l of losing) {
        const loserUpdated: Bid = { ...l, status: 'lost' };
        await port.updateBid(loserUpdated);
        losers.push(loserUpdated);
      }
      const finalRfq: Rfq = {
        ...rfq,
        status: 'awarded',
        awardedBidId: winning.id,
        closedAt: rfq.closedAt ?? clock.now().toISOString(),
      };
      await port.updateRfq(finalRfq);
      return { rfq: finalRfq, winningBid: awarded, losingBids: losers };
    },

    async cancelRfq(args) {
      const rfq = await port.findRfq(args.id);
      if (!rfq) throw new Error(`RFQ ${args.id} not found`);
      if (rfq.status === 'awarded') {
        throw new Error('Cannot cancel an awarded RFQ');
      }
      const updated: Rfq = {
        ...rfq,
        status: 'cancelled',
        scope: `${rfq.scope}\n\n[cancelled] ${args.reason}`,
      };
      await port.updateRfq(updated);
      return updated;
    },
  };
}

export interface PoSkeletonFromBid {
  readonly tenantId: string;
  readonly vendorId: VendorId;
  readonly requisitionId: RequisitionId;
  readonly rfqId: RfqId;
  readonly bidId: BidId;
  readonly items: ReadonlyArray<{
    readonly sku: string | null;
    readonly description: string;
    readonly qty: number;
    readonly unit: string;
    readonly unitPrice: number;
  }>;
  readonly total: number;
  readonly currency: string;
}

export function poSkeletonFromBid(rfq: Rfq, bid: Bid): PoSkeletonFromBid {
  return {
    tenantId: rfq.tenantId,
    vendorId: bid.vendorId,
    requisitionId: rfq.requisitionId,
    rfqId: rfq.id,
    bidId: bid.id,
    items: bid.lines.map((l, idx) => ({
      sku: l.sku ?? rfq.items[idx]?.sku ?? null,
      description: l.description,
      qty: l.qty,
      unit: rfq.items[idx]?.unit ?? 'ea',
      unitPrice: l.unitPrice,
    })),
    total: bid.total,
    currency: bid.currency,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { PurchaseOrderId };

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
