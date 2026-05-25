/**
 * Core type definitions for the country compliance plugin system.
 *
 * Every country BORJIE supports is represented by a `CountryPlugin`.
 * Plugins are pure data + pure functions — no I/O, no side effects —
 * so they're safe to freeze and share across all requests.
 *
 * Naming conventions:
 *   - ISO-3166-1 alpha-2 for country codes (upper-case, 2 letters).
 *   - ISO-4217 for currency codes (upper-case, 3 letters).
 *   - E.164 for normalized phone numbers (with leading '+').
 */

/** ISO-3166-1 alpha-2 (e.g. 'TZ', 'KE'). Two upper-case letters. */
export type CountryCode = string;

/** ISO-4217 (e.g. 'TZS', 'KES'). Three upper-case letters. */
export type CurrencyCode = string;

/** Phone-number normalization contract. Returns E.164 format with leading '+'. */
export type PhoneNormalizer = (rawPhone: string) => string;

/** Classification of KYC / regulatory identity providers. */
export type KycProviderKind =
  | 'national-id'
  | 'credit-bureau'
  | 'business-registry'
  | 'tax-authority';

export interface KycProvider {
  /** Stable machine ID within the country (e.g. 'nida', 'crb-tz'). */
  readonly id: string;
  /** Display name (e.g. 'National Identification Authority'). */
  readonly name: string;
  /** What this provider verifies. */
  readonly kind: KycProviderKind;
  /**
   * Env-var name prefix for credentials (e.g. 'NIDA'). Never embed the
   * actual secret in the plugin — callers read `process.env[prefix + '_KEY']`.
   */
  readonly envPrefix: string;
  /** Optional regex the issued ID must match. */
  readonly idFormat?: RegExp;
}

export type PaymentGatewayKind =
  | 'mobile-money'
  | 'bank-rail'
  | 'card'
  | 'government-portal';

export interface PaymentGateway {
  readonly id: string;
  readonly name: string;
  readonly kind: PaymentGatewayKind;
  /** Env-var prefix for this gateway's credentials (e.g. 'MPESA'). */
  readonly envPrefix: string;
}

/**
 * Sublease model:
 *   - 'consent-required'  → landlord must approve before sublease begins.
 *   - 'notice-only'       → tenant notifies; landlord may object on narrow grounds.
 *   - 'prohibited'        → sublease forbidden absent explicit clause.
 */
export type SubleaseConsentModel =
  | 'consent-required'
  | 'notice-only'
  | 'prohibited';

/**
 * Per-country rules that shape how lease lifecycle logic runs.
 * All numbers are positive; `null` means "no statutory cap" and callers
 * should fall back to the lease agreement.
 */
export interface CompliancePolicy {
  /** Minimum security deposit expressed as months of rent. */
  readonly minDepositMonths: number;
  /** Maximum security deposit expressed as months of rent. */
  readonly maxDepositMonths: number;
  /** Notice period for non-renewal of residential lease, in days. */
  readonly noticePeriodDays: number;
  /** Minimum permissible lease term in months. */
  readonly minimumLeaseMonths: number;
  /** Sublease consent model in force. */
  readonly subleaseConsent: SubleaseConsentModel;
  /** Statutory cap on late fees expressed as a fraction of rent (e.g. 0.10). */
  readonly lateFeeCapRate: number | null;
  /** Security-deposit return deadline after lease termination, in days. */
  readonly depositReturnDays: number;
}

export interface DocumentTemplate {
  /** Stable template ID (e.g. 'lease-agreement', 'notice-of-termination'). */
  readonly id: string;
  readonly name: string;
  /** Path relative to the plugin — consumers load from their own CMS. */
  readonly templatePath: string;
  /** BCP-47 language tag (e.g. 'sw-TZ'). */
  readonly locale: string;
}

// Forward-declared port types (full definitions in ../ports/). These are
// imported as types only to avoid a circular-barrel at runtime.
import type { TaxRegimePort } from '../ports/tax-regime.port.js';
import type { TaxFilingPort } from '../ports/tax-filing.port.js';
import type { PaymentRailPort } from '../ports/payment-rail.port.js';
import type { TenantScreeningPort } from '../ports/tenant-screening.port.js';
import type { LeaseLawPort } from '../ports/lease-law.port.js';

export interface CountryPlugin {
  /** ISO-3166-1 alpha-2 — upper-case, exactly 2 letters. */
  readonly countryCode: CountryCode;
  /** Human-readable name in English. */
  readonly countryName: string;
  /** ISO-4217 currency. */
  readonly currencyCode: CurrencyCode;
  /** Currency symbol for UI display. */
  readonly currencySymbol: string;
  /** International dialing prefix without '+' (e.g. '255'). */
  readonly phoneCountryCode: string;
  /** Pure function: raw input → E.164 with leading '+'. */
  readonly normalizePhone: PhoneNormalizer;
  /** KYC / verification providers in use. */
  readonly kycProviders: readonly KycProvider[];
  /** Payment gateways offered. */
  readonly paymentGateways: readonly PaymentGateway[];
  /** Regulatory rules. */
  readonly compliance: CompliancePolicy;
  /** Document templates available for this country. */
  readonly documentTemplates: readonly DocumentTemplate[];
  // -------------------------------------------------------------------------
  // Pluggable ports — every country plugin SHOULD implement all five. The
  // `resolvePlugin()` registry layers DEFAULT_* implementations for any
  // plugin that does not, so callers can rely on non-null access.
  // -------------------------------------------------------------------------
  /** Rental-income withholding. */
  readonly taxRegime?: TaxRegimePort;
  /** Regulator-ready filing payload producer. */
  readonly taxFiling?: TaxFilingPort;
  /** Preferred payment instruments. */
  readonly paymentRails?: PaymentRailPort;
  /** External credit-bureau adapter (env-gated, consent-required). */
  readonly tenantScreening?: TenantScreeningPort;
  /** Jurisdiction-specific lease law. */
  readonly leaseLaw?: LeaseLawPort;
}
