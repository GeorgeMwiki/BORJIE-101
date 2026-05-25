/**
 * Invoice adjustment Drizzle adapter — backs the HQ-tier
 * `platform.adjust_invoice` tool (Central Command Phase B — B1, TIER 2).
 *
 * Wires to the existing `invoices` table in `payment.schema.ts`. The
 * adjustment is booked as a transactional update to `invoices`:
 *   - `total_amount` and `balance_amount` shift by `adjustmentCents`
 *   - the adjustment row is captured in `line_items` as a structured
 *     entry `{ kind: 'platform.adjustment', category, reason,
 *     adjustmentCents, appliedAt }` so the audit trail survives
 *
 * Rollback contract: `reverseAdjustment` books an offsetting line item
 * tagged `{ kind: 'platform.adjustment.reversal', reversalOfAdjustmentId,
 * reason, reversedAt }`. We do NOT delete the original — the audit chain
 * must remain intact.
 *
 * Hard DB failures:
 *   - loadInvoice            : returns `null` on error (caller treats as not-found)
 *   - applyAdjustment        : RE-THROWS — billing tier requires the
 *                              caller knows the write failed
 *   - reverseAdjustment      : RE-THROWS
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { invoices } from '../../schemas/payment.schema.js';
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

interface AdjustmentLineItem {
  kind: 'platform.adjustment';
  adjustmentId: string;
  category: InvoiceAdjustmentCategory;
  reason: string;
  adjustmentCents: number;
  appliedAt: string;
}

interface ReversalLineItem {
  kind: 'platform.adjustment.reversal';
  adjustmentId: string;
  reversalOfAdjustmentId: string;
  reason: string;
  reversedAt: string;
}

function safeLineItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return [...raw];
  return [];
}

export function createPlatformInvoiceAdjustmentService(
  db: DatabaseClient,
): PlatformInvoiceAdjustmentService {
  return {
    async loadInvoice(invoiceId) {
      try {
        if (!invoiceId) return null;
        const rows = (await db
          .select({
            id: invoices.id,
            tenantId: invoices.tenantId,
            balanceAmount: invoices.balanceAmount,
          })
          .from(invoices)
          .where(eq(invoices.id, invoiceId))
          .limit(1)) as ReadonlyArray<{
          id: string;
          tenantId: string;
          balanceAmount: number;
        }>;
        const r = rows[0];
        if (!r) return null;
        return {
          invoiceId: r.id,
          tenantId: r.tenantId,
          balanceCents: Number(r.balanceAmount ?? 0),
        };
      } catch (error) {
        logger.error('platform.invoices.loadInvoice failed', { error: error });
        return null;
      }
    },

    async applyAdjustment(args) {
      if (!args.invoiceId) {
        throw new Error(
          'platform.invoices.applyAdjustment: invoiceId is required',
        );
      }
      const adjustmentId = randomUUID();
      const now = new Date();
      try {
        const tx = db as unknown as {
          transaction<T>(cb: (t: typeof db) => Promise<T>): Promise<T>;
        };
        return await tx.transaction(async (t) => {
          const rows = (await t
            .select({
              id: invoices.id,
              tenantId: invoices.tenantId,
              totalAmount: invoices.totalAmount,
              balanceAmount: invoices.balanceAmount,
              lineItems: invoices.lineItems,
            })
            .from(invoices)
            .where(eq(invoices.id, args.invoiceId))
            .limit(1)) as ReadonlyArray<{
            id: string;
            tenantId: string;
            totalAmount: number;
            balanceAmount: number;
            lineItems: unknown;
          }>;
          const r = rows[0];
          if (!r) {
            throw new Error(
              `platform.invoices.applyAdjustment: invoice ${args.invoiceId} not found`,
            );
          }
          const newTotal = Number(r.totalAmount ?? 0) + args.adjustmentCents;
          const newBalance = Number(r.balanceAmount ?? 0) + args.adjustmentCents;
          const entry: AdjustmentLineItem = {
            kind: 'platform.adjustment',
            adjustmentId,
            category: args.category,
            reason: args.reason,
            adjustmentCents: args.adjustmentCents,
            appliedAt: now.toISOString(),
          };
          const nextLineItems = [...safeLineItems(r.lineItems), entry];
          await t
            .update(invoices)
            .set({
              totalAmount: newTotal,
              balanceAmount: newBalance,
              lineItems: nextLineItems as never,
              updatedAt: now,
            } as never)
            .where(eq(invoices.id, args.invoiceId));
          return {
            invoiceId: args.invoiceId,
            tenantId: r.tenantId,
            adjustmentId,
            adjustmentCents: args.adjustmentCents,
            category: args.category,
            reason: args.reason,
            newBalanceCents: newBalance,
            appliedAt: now.toISOString(),
          };
        });
      } catch (error) {
        logger.error('platform.invoices.applyAdjustment failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.invoices.applyAdjustment failed');
      }
    },

    async reverseAdjustment(args) {
      if (!args.invoiceId || !args.adjustmentId) {
        throw new Error(
          'platform.invoices.reverseAdjustment: invoiceId and adjustmentId are required',
        );
      }
      const now = new Date();
      try {
        const tx = db as unknown as {
          transaction<T>(cb: (t: typeof db) => Promise<T>): Promise<T>;
        };
        await tx.transaction(async (t) => {
          const rows = (await t
            .select({
              totalAmount: invoices.totalAmount,
              balanceAmount: invoices.balanceAmount,
              lineItems: invoices.lineItems,
            })
            .from(invoices)
            .where(eq(invoices.id, args.invoiceId))
            .limit(1)) as ReadonlyArray<{
            totalAmount: number;
            balanceAmount: number;
            lineItems: unknown;
          }>;
          const r = rows[0];
          if (!r) {
            throw new Error(
              `platform.invoices.reverseAdjustment: invoice ${args.invoiceId} not found`,
            );
          }
          const items = safeLineItems(r.lineItems);
          const original = items.find(
            (it) =>
              typeof it === 'object' &&
              it !== null &&
              (it as Record<string, unknown>).kind === 'platform.adjustment' &&
              (it as Record<string, unknown>).adjustmentId === args.adjustmentId,
          ) as AdjustmentLineItem | undefined;
          // If we can't find the original (or it was already reversed),
          // we still book the reversal line item — but we cannot
          // mathematically reverse a delta we don't know. Audit trail
          // wins: emit the line item, leave amounts alone.
          let newTotal = Number(r.totalAmount ?? 0);
          let newBalance = Number(r.balanceAmount ?? 0);
          if (original && typeof original.adjustmentCents === 'number') {
            newTotal -= original.adjustmentCents;
            newBalance -= original.adjustmentCents;
          }
          const entry: ReversalLineItem = {
            kind: 'platform.adjustment.reversal',
            adjustmentId: randomUUID(),
            reversalOfAdjustmentId: args.adjustmentId,
            reason: args.reason,
            reversedAt: now.toISOString(),
          };
          const nextLineItems = [...items, entry];
          await t
            .update(invoices)
            .set({
              totalAmount: newTotal,
              balanceAmount: newBalance,
              lineItems: nextLineItems as never,
              updatedAt: now,
            } as never)
            .where(eq(invoices.id, args.invoiceId));
        });
      } catch (error) {
        logger.error('platform.invoices.reverseAdjustment failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.invoices.reverseAdjustment failed');
      }
    },
  };
}
