/**
 * Core type definitions for the country mining-compliance plugin system.
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
 * Sub-supply model (sub-contracting / assignment of an offtake or supply
 * agreement to a third-party operator):
 *   - 'consent-required'  → owner must approve before sub-supply begins.
 *   - 'notice-only'       → counterparty notifies; owner may object on narrow grounds.
 *   - 'prohibited'        → sub-supply forbidden absent explicit clause.
 */
export type SubSupplyConsentModel =
  | 'consent-required'
  | 'notice-only'
  | 'prohibited';

/**
 * Per-country rules that shape how the offtake / supply-agreement lifecycle
 * runs. All numbers are positive; `null` means "no statutory cap" and callers
 * should fall back to the offtake / supply agreement.
 */
export interface CompliancePolicy {
  /** Minimum performance bond expressed as months of royalty/payment. */
  readonly minBondMonths: number;
  /** Maximum performance bond expressed as months of royalty/payment. */
  readonly maxBondMonths: number;
  /** Notice period for non-renewal of an offtake/supply agreement, in days. */
  readonly noticePeriodDays: number;
  /** Minimum permissible offtake/supply term in months. */
  readonly minimumTermMonths: number;
  /** Sub-supply consent model in force. */
  readonly subSupplyConsent: SubSupplyConsentModel;
  /** Statutory cap on late fees expressed as a fraction of the payment (e.g. 0.10). */
  readonly lateFeeCapRate: number | null;
  /** Performance-bond return deadline after agreement termination, in days. */
  readonly bondReturnDays: number;
}

export interface DocumentTemplate {
  /** Stable template ID (e.g. 'offtake-agreement', 'notice-of-suspension'). */
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
import type { CounterpartyScreeningPort } from '../ports/counterparty-screening.port.js';
import type { MiningLawPort } from '../ports/mining-law.port.js';

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
  /** Mineral-royalty / sales withholding. */
  readonly taxRegime?: TaxRegimePort;
  /** Regulator-ready royalty-return / filing payload producer. */
  readonly taxFiling?: TaxFilingPort;
  /** Preferred payment instruments. */
  readonly paymentRails?: PaymentRailPort;
  /** External credit-bureau / counterparty-screening adapter (env-gated, consent-required). */
  readonly counterpartyScreening?: CounterpartyScreeningPort;
  /** Jurisdiction-specific mining law. */
  readonly miningLaw?: MiningLawPort;
}
