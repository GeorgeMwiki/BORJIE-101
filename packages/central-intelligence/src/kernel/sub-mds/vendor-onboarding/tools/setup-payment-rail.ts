/**
 * `vendor.setup_payment_rail` — mutate tier (reversible).
 *
 * Adds the vendor to the payment-method registry. Reversible — the
 * registry entry can be removed within `recallWindowMs` (default 5
 * minutes) before any payout has been processed against it.
 *
 * Refuses to run if the MSA has not been signed (the policy gate
 * enforces this, but the function double-checks defensively).
 */

export type PaymentRail = 'mpesa' | 'airtel-money' | 'opay' | 'bank-transfer' | 'card';

export interface PaymentMethodRecord {
  readonly vendorId: string;
  readonly rail: PaymentRail;
  /** Token, NOT the raw account number. */
  readonly accountToken: string;
  readonly accountLabel: string;
  readonly currency: string;
}

export interface PaymentRegistryPort {
  add(args: {
    readonly record: PaymentMethodRecord;
    readonly correlationId: string;
  }): Promise<{ readonly registryEntryId: string }>;
  remove(args: { readonly registryEntryId: string }): Promise<void>;
}

export interface SetupPaymentRailArgs {
  readonly record: PaymentMethodRecord;
  readonly msaSigned: boolean;
  readonly registry: PaymentRegistryPort;
  readonly correlationId: string;
  readonly recallWindowMs?: number;
}

export interface SetupPaymentRailResult {
  readonly status: 'added' | 'blocked-msa-unsigned' | 'failed';
  readonly registryEntryId?: string;
  readonly recallableUntilMs?: number;
  readonly reason?: string;
}

const DEFAULT_RECALL_WINDOW_MS = 5 * 60 * 1000;

export async function setupPaymentRail(
  args: SetupPaymentRailArgs,
  nowMs: number,
): Promise<SetupPaymentRailResult> {
  if (!args.msaSigned) {
    return Object.freeze({
      status: 'blocked-msa-unsigned',
      reason: 'MSA must be signed by the owner before a payment rail is added',
    });
  }
  try {
    const r = await args.registry.add({
      record: args.record,
      correlationId: args.correlationId,
    });
    return Object.freeze({
      status: 'added',
      registryEntryId: r.registryEntryId,
      recallableUntilMs: nowMs + (args.recallWindowMs ?? DEFAULT_RECALL_WINDOW_MS),
    });
  } catch (err) {
    return Object.freeze({
      status: 'failed',
      reason: err instanceof Error ? err.message : 'registry-error',
    });
  }
}
