/**
 * Wire-level types for the marketing buyer signup wizard.
 *
 * These mirror the discriminated union accepted by
 * `services/api-gateway/src/routes/buyers/signup.hono.ts`
 * (see `BuyerSignupRequestSchema`). The marketing site holds
 * draft state in this same shape so it can be POSTed verbatim
 * after a single client-side zod parse.
 *
 * We pin the constant tuples here instead of importing from
 * `@borjie/database` because the marketing app is intentionally
 * decoupled from the database package (it never queries Drizzle).
 * The unit tests below assert these tuples match the source of
 * truth, so a future drift fails fast.
 */

export const BUYER_COUNTRY_CODES = [
  'TZ',
  'KE',
  'UG',
  'NG',
  'CN',
  'IN',
  'AE',
  'EU',
  'OTHER',
] as const;
export type BuyerCountryCode = (typeof BUYER_COUNTRY_CODES)[number];

export const BUYER_CURRENCY_CODES = [
  'USD',
  'TZS',
  'KES',
  'EUR',
  'CNY',
  'INR',
] as const;
export type BuyerCurrencyCode = (typeof BUYER_CURRENCY_CODES)[number];

export const BUYER_LANGUAGE_CODES = ['sw', 'en'] as const;
export type BuyerLanguageCode = (typeof BUYER_LANGUAGE_CODES)[number];

export const BUYER_BUSINESS_KINDS = [
  'refiner',
  'broker',
  'fabricator',
  'investor',
  'other',
] as const;
export type BuyerBusinessKind = (typeof BUYER_BUSINESS_KINDS)[number];

export type BuyerAccountKind = 'individual' | 'business';

export interface IndividualBuyerDraft {
  readonly kind: 'individual';
  readonly country: BuyerCountryCode;
  readonly fullName: string;
  readonly phoneE164: string;
  readonly email: string;
  readonly preferredCurrency: BuyerCurrencyCode;
  readonly preferredLanguage: BuyerLanguageCode;
  readonly nationalIdNumber: string;
}

export interface BusinessBuyerDraft {
  readonly kind: 'business';
  readonly country: BuyerCountryCode;
  readonly orgName: string;
  readonly businessKind: BuyerBusinessKind;
  readonly businessRegistrationNumber: string;
  readonly taxId: string;
  readonly contactFullName: string;
  readonly contactPhoneE164: string;
  readonly contactEmail: string;
  readonly preferredCurrency: BuyerCurrencyCode;
  readonly preferredLanguage: BuyerLanguageCode;
}

export type BuyerSignupDraft = IndividualBuyerDraft | BusinessBuyerDraft;

/**
 * Server response shape on the happy path (201). Matches the JSON
 * payload returned by the api-gateway buyer signup handler.
 */
export interface BuyerSignupSuccess {
  readonly buyerOrgId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly kind: BuyerAccountKind;
  readonly otpRequired: boolean;
  readonly signupStatus: 'pending_otp_verification';
}

/** Error response shape on 4xx / 5xx. */
export interface BuyerSignupError {
  readonly error: string;
  readonly message?: string;
  readonly issues?: ReadonlyArray<{
    readonly path: string;
    readonly code: string;
    readonly message: string;
  }>;
}
