/**
 * Common payment types
 */
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
