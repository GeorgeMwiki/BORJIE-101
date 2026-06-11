/**
 * Invoice adjustment Drizzle adapter — honest-degrade refusal.
 *
 * The HQ-tier `platform.adjust_invoice` tool used to read/write the
 * `invoices` table that lived in the deleted property-domain schema.
 * Mining-domain billing (royalty notices, levy adjustments) will live
 * in a future `treasury`/`platform_invoices` migration; that table does
 * not exist yet.
 *
 * Audit finding `platform-invoice-adjust-throws-10`: the previous stub
 * threw a raw `Error` on every mutation, which `withHqTelemetry` turned
 * into an opaque `executor-failed` with no actionable reason. Fix:
 *
 *   - `loadInvoice` returns `null` (no invoice exists). The tool spec's
 *     `execute` body checks this FIRST and short-circuits to a clean
 *     `refusal('TENANT_NOT_FOUND')` BEFORE `applyAdjustment` is ever
 *     reached — so the admin sees a structured, actionable refusal, not
 *     a crash. This is the primary graceful path.
 *   - `applyAdjustment` / `reverseAdjustment` still throw (defence in
 *     depth — they should be unreachable through the tool), but now with
 *     a deterministic, non-leaky, refusal-shaped message that mirrors
 *     the kernel's NotYetWired pattern. `withHqTelemetry` reads
 *     `err.message` into the failed envelope, so the message never
 *     contains driver internals or sensitive data.
 *
 * Hard rules: pino logger only; no raw driver error leaks to clients;
 * never an unhandled throw that escapes the executor.
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

export interface InvoiceAdjustmentDeps {
  /** Caller id resolver, for audit attribution when the table lands. */
  readonly resolveActor?: () => string;
}

export interface PlatformInvoiceAdjustmentService {
  loadInvoice(invoiceId: string): Promise<InvoiceSnapshot | null>;
  applyAdjustment(args: ApplyAdjustmentArgs): Promise<AdjustmentResult>;
  reverseAdjustment(args: ReverseAdjustmentArgs): Promise<void>;
}

/**
 * Deterministic, non-leaky refusal message. Surfaced to the admin via
 * the executor's failed-envelope; mirrors the kernel's NotYetWired
 * reason tokens so the reason stays stable across builds.
 */
const NOT_WIRED_REASON =
  'platform.adjust_invoice not yet available: mining-domain billing ledger pending (no platform invoices table). Use the treasury ledger for corrections until billing ships.';

/**
 * Thrown by the mutation methods. Carries a `reasonCode` so a future
 * caller that wants to branch on it can, while the message stays
 * client-safe. Extends Error so `withHqTelemetry` reads `.message`.
 */
class InvoiceAdjustmentNotWiredError extends Error {
  // Specific, stable branch token — platform billing ledger is pending (no
  // platform invoices table). More descriptive than a generic marker.
  readonly reasonCode = 'PLATFORM_BILLING_PENDING' as const;
  constructor() {
    super(NOT_WIRED_REASON);
    this.name = 'InvoiceAdjustmentNotWiredError';
  }
}

export function createPlatformInvoiceAdjustmentService(
  _db: DatabaseClient,
  _deps: InvoiceAdjustmentDeps = {},
): PlatformInvoiceAdjustmentService {
  return {
    async loadInvoice(invoiceId) {
      // No platform invoices table exists yet — returning null makes the
      // adjust_invoice tool short-circuit to a clean TENANT_NOT_FOUND
      // refusal before it ever attempts a mutation.
      logger.debug(
        'platform.invoice-adjustment.loadInvoice: no invoices table; returning null (clean refusal upstream)',
        { invoiceId },
      );
      return null;
    },
    async applyAdjustment(args) {
      logger.warn(
        'platform.invoice-adjustment.applyAdjustment refused: subsystem not yet wired',
        { invoiceId: args.invoiceId, category: args.category },
      );
      throw new InvoiceAdjustmentNotWiredError();
    },
    async reverseAdjustment(args) {
      logger.warn(
        'platform.invoice-adjustment.reverseAdjustment refused: subsystem not yet wired',
        { invoiceId: args.invoiceId, adjustmentId: args.adjustmentId },
      );
      throw new InvoiceAdjustmentNotWiredError();
    },
  };
}
