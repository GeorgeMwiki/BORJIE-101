/**
 * PaymentRailPort — catalogue of payment instruments per jurisdiction.
 *
 * Distinct from the legacy `PaymentGateway` list (which is credentials /
 * integration metadata) — this port exposes BUSINESS attributes: settlement
 * SLA, minimum amount, currency, operational mode. The rent-collection
 * router uses these to pick the cheapest viable rail for a given charge.
 */

import type { CurrencyCode } from '../core/types.js';

/** High-level classification — drives UI iconography and fee tiers. */
export type PaymentRailKind =
  | 'mobile-money'
  | 'bank-transfer'
  | 'card'
  | 'open-banking'
  | 'wallet'
  | 'cash-voucher'
  | 'government-portal'
  | 'manual';

export interface PaymentRail {
  /** Stable machine ID, unique within a country (e.g. 'mpesa_ke', 'ach_us'). */
  readonly id: string;
  /** Display label for dashboards / tenant apps. */
  readonly label: string;
  /** Classification. */
  readonly kind: PaymentRailKind;
  /** Settlement currency for this rail. */
  readonly currency: CurrencyCode;
  /**
   * Smallest unit this rail will accept, in minor units. `1` means the rail
   * will process any positive integer. Rails that only accept whole units
   * set this to the currency's minor-unit size (e.g. 100 for USD cents).
   */
  readonly minAmountMinorUnits: number;
  /**
   * Best-case typical settlement lag into the landlord's account, in hours.
   * Used for cash-flow forecasting — NOT a SLA guarantee.
   */
  readonly settlementLagHours: number;
  /**
   * Integration adapter hint — the service-registry module uses this to
   * dispatch. Values align with existing adapters when present, or are
   * `null` for rails that only support manual reconciliation.
   */
  readonly integrationAdapterHint: string | null;
  /**
   * True if this rail supports inbound rent collection (i.e. customer →
   * landlord). False for disbursement-only rails.
   */
  readonly supportsCollection: boolean;
  /**
   * True if this rail supports outbound disbursement (landlord → vendor).
   */
  readonly supportsDisbursement: boolean;
}

export interface PaymentRailPort {
  listRails(): readonly PaymentRail[];
}

/**
 * Default — a Stripe rail plus a manual fallback. Keeps everything on
 * Earth transactable without committing the platform to any country-
 * specific integration.
 */
export const DEFAULT_PAYMENT_RAILS: readonly PaymentRail[] = Object.freeze([
  {
    id: 'stripe',
    label: 'Stripe (card + ACH/SEPA)',
    kind: 'card',
    currency: 'USD',
    minAmountMinorUnits: 50,
    settlementLagHours: 48,
    integrationAdapterHint: 'STRIPE',
    supportsCollection: true,
    supportsDisbursement: true,
  },
  {
    id: 'manual',
    label: 'Manual / bank transfer (reconciled by hand)',
    kind: 'manual',
    currency: 'USD',
    minAmountMinorUnits: 1,
    settlementLagHours: 72,
    integrationAdapterHint: null,
    supportsCollection: true,
    supportsDisbursement: true,
  },
]);

export const DEFAULT_PAYMENT_RAIL_PORT: PaymentRailPort = {
  listRails() {
    return DEFAULT_PAYMENT_RAILS;
  },
};
