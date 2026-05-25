/**
 * Invoice adjustment Drizzle adapter — TODO(borjie-hard-fork) stub.
 *
 * The HQ-tier `platform.adjust_invoice` tool used to read/write the
 * `invoices` table that lived in the deleted property-domain schema.
 * Mining-domain billing (royalty notices, levy adjustments) will live
 * in `treasury.schema.ts` once the marketplace ships; until then this
 * service throws on every mutation so accidental wiring fails loud.
 */

import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

export type InvoiceAdjustmentCategory =
  | 'refund'
  | 'credit'
  | 'discount'
  | 'tax-correction'
  | 'manual';

export interface InvoiceSnapshot {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly balanceCents: number;
}

export interface ApplyAdjustmentArgs {
  readonly invoiceId: string;
  readonly adjustmentCents: number;
  readonly reason: string;
  readonly category: InvoiceAdjustmentCategory;
}

export interface AdjustmentResult {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly adjustmentId: string;
  readonly adjustmentCents: number;
  readonly category: InvoiceAdjustmentCategory;
  readonly reason: string;
  readonly newBalanceCents: number;
  readonly appliedAt: string;
}

export interface ReverseAdjustmentArgs {
  readonly invoiceId: string;
  readonly adjustmentId: string;
  readonly reason: string;
}

export interface PlatformInvoiceAdjustmentService {
  loadInvoice(invoiceId: string): Promise<InvoiceSnapshot | null>;
  applyAdjustment(args: ApplyAdjustmentArgs): Promise<AdjustmentResult>;
  reverseAdjustment(args: ReverseAdjustmentArgs): Promise<void>;
}

export function createPlatformInvoiceAdjustmentService(
  _db: DatabaseClient,
): PlatformInvoiceAdjustmentService {
  return {
    async loadInvoice(invoiceId) {
      logger.warn(
        'platform.invoice-adjustment.loadInvoice: stub (mining-domain rewrite pending)',
        { invoiceId },
      );
      return null;
    },
    async applyAdjustment(args) {
      throw new Error(
        `platform.adjust_invoice not available: property-domain invoices table removed (invoiceId=${args.invoiceId})`,
      );
    },
    async reverseAdjustment(args) {
      throw new Error(
        `platform.adjust_invoice.reverse not available: property-domain invoices table removed (invoiceId=${args.invoiceId})`,
      );
    },
  };
}
