/**
 * Public surface of the tenant-config service.
 * Issue #207 — World-scale tenants.
 *
 * Every TZ-locked default (currency, language, regulator, mineral
 * allowlist, phone prefix, timezone) MUST go through this module so
 * adding a new jurisdiction is a config + seed row, not a code change.
 */

export {
  createTenantConfigService,
  createDrizzleTenantConfigService,
  type TenantConfigServiceDeps,
} from './service.js';

export { createDrizzleTenantConfigPersistence } from './persistence.js';

export {
  JURISDICTION_DEFAULTS,
  getJurisdictionDefaults,
  getDefaultsByCountry,
  type JurisdictionDefaults,
} from './jurisdictions.js';

export {
  REGULATOR_SETS,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LANGUAGES,
  type RegulatorSet,
  type SupportedCurrency,
  type SupportedLanguage,
  type TenantConfig,
  type TenantConfigService,
} from './types.js';

// WS-2 — language helpers. Centralises bilingual sw/en lookup so the
// rest of the application never re-implements the "what language does
// this tenant want?" decision.
export {
  LANGUAGE_CATALOGUE,
  bcp47ForTenant,
  bilingualForTenant,
  coerceSupportedLanguage,
  getLanguageEntry,
  type LanguageCatalogueEntry,
} from './language.js';

// WS-3 — regulator lookup. Queries the tenant-AGNOSTIC
// `regulator_jurisdictions` catalogue.
export {
  createDrizzleRegulatorLookup,
  type RegulatorAuthority,
  type RegulatorLookup,
} from './regulators.js';

// WS-4 — phone helpers. Resolves the E.164 dialing code per tenant.
export {
  dialingCodeForTenant,
  dialingPrefixForTenant,
} from './phone.js';

// WS-5 — mineral catalogue + per-tenant allowlist gate.
export {
  MINERAL_CATALOGUE,
  getMineral,
  isMineralAllowedForTenant,
  labelForMineral,
  type MineralCatalogueEntry,
} from './minerals.js';
