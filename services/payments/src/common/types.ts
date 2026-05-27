/**
 * Common payment types
 */
// UNIV-4: CurrencyCode hardcodes EA launch currencies (TZS launch beachhead).
// Future jurisdictions: type as ISO-4217 string derived from @borjie/jurisdiction-profiles
// currencyCode field. Tracked gh-issue (universal-from-day-one).
// See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
export type CurrencyCode = 'KES' | 'TZS' | 'UGX' | 'USD';

export interface Money {
  amountMinorUnits: number;
  currency: CurrencyCode;
}

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type MobileMoneyProvider = 'mpesa' | 'airtel' | 'tigopesa';

export interface PaymentReference {
  internalId: string;
  externalId?: string;
  provider: MobileMoneyProvider;
}
