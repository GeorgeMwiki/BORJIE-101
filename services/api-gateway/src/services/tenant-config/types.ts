/**
 * Public types for the tenant-config service.
 * Issue #207 — World-scale tenants.
 *
 * Borjie is global from day one. Tanzania is the GTM beachhead, NOT
 * a hardcode. Every TZS / sw / +255 / PCCB-style value the application
 * surfaces MUST be sourced from a tenant-config lookup so that adding
 * Kenya / Nigeria / Australia / Chile / Indonesia / South Africa /
 * Uganda is a config row, not a code change.
 *
 * This module's contract is intentionally tiny:
 *   - `TenantConfig` is the canonical bundle of locale-bearing fields
 *     (country, currency, language, regulator-set, allowed minerals).
 *   - `TenantConfigService.get(tenantId)` returns it as a readonly
 *     immutable object.
 *
 * Callers MUST treat the returned object as immutable. Mutation breaks
 * the immutability invariant (CLAUDE.md hard rule).
 */

/**
 * ISO-4217 currency codes the platform admits at the column-CHECK
 * level (migration 0143). The list is deliberately conservative —
 * adding a new currency is one migration line + one seed update.
 */
export const SUPPORTED_CURRENCIES = [
  'TZS',
  'USD',
  'KES',
  'UGX',
  'NGN',
  'EUR',
  'ZAR',
  'AUD',
  'CLP',
  'IDR',
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * BCP-47 language tags the platform admits at the column-CHECK level
 * (migration 0143). sw remains the default per CLAUDE.md Swahili-first;
 * jurisdictions outside Tanzania pick their own value at signup.
 */
export const SUPPORTED_LANGUAGES = [
  'sw',
  'en',
  'fr',
  'pt',
  'sw-KE',
  'es',
  'id',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Regulator-set identifier. Joins `tenants.regulator_set` to
 * `regulator_jurisdictions.regulator_set`.
 */
export const REGULATOR_SETS = [
  'TZ-set',
  'KE-set',
  'UG-set',
  'NG-set',
  'ZA-set',
  'AU-set',
  'CL-set',
  'ID-set',
  'generic',
] as const;
export type RegulatorSet = (typeof REGULATOR_SETS)[number];

/**
 * Immutable tenant-config snapshot returned by the service. The
 * canonical source of truth for every locale-bearing field the
 * application reads.
 */
export interface TenantConfig {
  readonly tenantId: string;
  /** ISO-3166-1 alpha-2. */
  readonly countryCode: string;
  /** ISO-4217. */
  readonly defaultCurrency: SupportedCurrency;
  /** BCP-47. */
  readonly defaultLanguage: SupportedLanguage;
  /** Regulator-set identifier. */
  readonly regulatorSet: RegulatorSet;
  /** Canonical mineral slugs the tenant is licensed to handle. */
  readonly allowedMinerals: ReadonlyArray<string>;
}

/**
 * Service contract. `get` is the only operation — every consumer reads
 * the immutable bundle. Mutation paths (admin console edit) bypass
 * this service and hit Drizzle directly; the next `get` reflects the
 * change because no caching is layered on top.
 */
export interface TenantConfigService {
  /**
   * Returns the immutable tenant-config bundle. Throws when the tenant
   * row is missing — every code path that needs config MUST have a
   * tenant id, and a missing row is a programmer error, not a runtime
   * fallback.
   */
  get(tenantId: string): Promise<TenantConfig>;
}
