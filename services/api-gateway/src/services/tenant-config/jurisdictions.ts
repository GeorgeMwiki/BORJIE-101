/**
 * Jurisdiction defaults — static map from regulator-set / country to
 * the platform's launch defaults (currency, language, mineral list,
 * phone country code).
 *
 * Issue #207 — World-scale tenants.
 *
 * USED BY:
 *   - signup-wiring.ts (to pre-populate tenant rows at first create)
 *   - the `borjie-world-tenants.seed.ts` script (to spin up demo rows)
 *   - test fixtures
 *
 * NOT USED BY production code paths once the row exists — those go
 * through `tenant-config/service.ts`. This file is a one-shot
 * "starting point" lookup, NEVER a runtime cache.
 *
 * The TZ row stays first so its values are the platform-wide defaults
 * (CLAUDE.md "Multi-currency, TZS-primary" + "Swahili-first").
 */

import type { RegulatorSet, SupportedCurrency, SupportedLanguage } from './types.js';

export interface JurisdictionDefaults {
  /** Regulator-set identifier (joins `tenants.regulator_set`). */
  readonly regulatorSet: RegulatorSet;
  /** ISO-3166-1 alpha-2. */
  readonly countryCode: string;
  /** Platform launch default for this jurisdiction. */
  readonly defaultCurrency: SupportedCurrency;
  /** Platform launch default for this jurisdiction. */
  readonly defaultLanguage: SupportedLanguage;
  /** Dialing code (E.164 prefix), no leading '+'. */
  readonly phonePrefix: string;
  /** IANA timezone — drives daily-brief HH:MM resolution. */
  readonly timezone: string;
  /** Canonical mineral slugs the jurisdiction's regulator licenses. */
  readonly mineralAllowlist: ReadonlyArray<string>;
}

/**
 * Frozen registry. Adding a row here is the FIRST step of adding a
 * new jurisdiction; the migration / seed scripts then read from it.
 */
export const JURISDICTION_DEFAULTS: ReadonlyArray<JurisdictionDefaults> =
  Object.freeze([
    Object.freeze({
      regulatorSet: 'TZ-set',
      countryCode: 'TZ',
      defaultCurrency: 'TZS',
      defaultLanguage: 'sw',
      phonePrefix: '255',
      timezone: 'Africa/Dar_es_Salaam',
      mineralAllowlist: Object.freeze([
        'gold',
        'tanzanite',
        'ruby',
        'sapphire',
        'copper',
        'coal',
        'iron-ore',
        'nickel',
        'lithium',
        'graphite',
        'gemstone',
        'diamond',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'KE-set',
      countryCode: 'KE',
      defaultCurrency: 'KES',
      defaultLanguage: 'sw-KE',
      phonePrefix: '254',
      timezone: 'Africa/Nairobi',
      mineralAllowlist: Object.freeze([
        'gold',
        'titanium-bearing-sands',
        'gypsum',
        'limestone',
        'gemstone',
        'fluorspar',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'UG-set',
      countryCode: 'UG',
      defaultCurrency: 'UGX',
      defaultLanguage: 'en',
      phonePrefix: '256',
      timezone: 'Africa/Kampala',
      mineralAllowlist: Object.freeze([
        'gold',
        'copper',
        'cobalt',
        'tungsten',
        'tin',
        'limestone',
        'phosphate',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'NG-set',
      countryCode: 'NG',
      defaultCurrency: 'NGN',
      defaultLanguage: 'en',
      phonePrefix: '234',
      timezone: 'Africa/Lagos',
      mineralAllowlist: Object.freeze([
        'gold',
        'lead-zinc',
        'tin',
        'columbite',
        'bitumen',
        'coal',
        'iron-ore',
        'limestone',
        'gemstone',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'ZA-set',
      countryCode: 'ZA',
      defaultCurrency: 'ZAR',
      defaultLanguage: 'en',
      phonePrefix: '27',
      timezone: 'Africa/Johannesburg',
      mineralAllowlist: Object.freeze([
        'gold',
        'platinum',
        'coal',
        'iron-ore',
        'manganese',
        'chrome',
        'diamond',
        'palladium',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'AU-set',
      countryCode: 'AU',
      defaultCurrency: 'AUD',
      defaultLanguage: 'en',
      phonePrefix: '61',
      timezone: 'Australia/Perth',
      mineralAllowlist: Object.freeze([
        'gold',
        'iron-ore',
        'bauxite',
        'coal',
        'lithium',
        'copper',
        'nickel',
        'rare-earths',
        'zinc',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'CL-set',
      countryCode: 'CL',
      defaultCurrency: 'CLP',
      defaultLanguage: 'es',
      phonePrefix: '56',
      timezone: 'America/Santiago',
      mineralAllowlist: Object.freeze([
        'copper',
        'lithium',
        'gold',
        'silver',
        'molybdenum',
        'iron-ore',
      ]),
    }),
    Object.freeze({
      regulatorSet: 'ID-set',
      countryCode: 'ID',
      defaultCurrency: 'IDR',
      defaultLanguage: 'id',
      phonePrefix: '62',
      timezone: 'Asia/Jakarta',
      mineralAllowlist: Object.freeze([
        'gold',
        'copper',
        'nickel',
        'tin',
        'coal',
        'bauxite',
      ]),
    }),
  ]);

// TZ is the platform-wide fallback (CLAUDE.md "Swahili-first" +
// "Multi-currency, TZS-primary"). Keep this row first AND surface it
// as the typed fallback when callers ask for an unknown regulator set.
const PLATFORM_FALLBACK = JURISDICTION_DEFAULTS[0] as JurisdictionDefaults;

/**
 * Lookup by regulator-set. Returns the TZ defaults when the set is
 * unknown (matches the column-default behaviour).
 */
export function getJurisdictionDefaults(
  regulatorSet: string,
): JurisdictionDefaults {
  const match = JURISDICTION_DEFAULTS.find(
    (j) => j.regulatorSet === regulatorSet,
  );
  return match ?? PLATFORM_FALLBACK;
}

/**
 * Lookup by ISO-3166-1 alpha-2 country code.
 */
export function getDefaultsByCountry(
  countryCode: string,
): JurisdictionDefaults | null {
  return (
    JURISDICTION_DEFAULTS.find((j) => j.countryCode === countryCode) ?? null
  );
}
