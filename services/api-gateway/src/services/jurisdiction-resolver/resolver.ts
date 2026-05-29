/**
 * Jurisdiction resolver — JA-1.
 *
 * Resolves `{country, regulator_set, currency, default_language,
 * locale, time_zone, mineral_authorities, environmental_authority,
 * transparency_initiative, audit_authority}` for a tenant.
 *
 *   - DEFAULT path: reads `tenants.jurisdiction` via the existing
 *     `TenantConfigService.get(tenantId)`. Returns the tenant's
 *     country / regulator_set / currency / language as-is.
 *   - OVERRIDE path: when an optional ISO-3166-1 alpha-2 is passed
 *     (the brain parsed it out of "in Kenya..."), the resolver
 *     returns a snapshot for that country INSTEAD — without
 *     touching the tenant row. Source field flips to 'override'.
 *   - UNSEEDED path: when the override country is not in our
 *     static snapshot, the resolver returns a partially-empty
 *     snapshot with source = 'unseeded' so the brain can ask the
 *     graceful "I don't have Peru regulator details wired yet"
 *     fallback per JA-2.
 *
 * Tenant-config caching: this service does NOT cache the tenant
 * lookup — it delegates to TenantConfigService.get() which itself
 * is uncached (per the #207 design note). When profiling shows a
 * hotspot, the same Redis layer that wraps TenantConfigService
 * will transparently speed this up.
 */

import { getAuthoritiesByCountry } from './authorities.js';
import { getLanguageEntry } from '../tenant-config/language.js';
import {
  getDefaultsByCountry,
  getJurisdictionDefaults,
} from '../tenant-config/jurisdictions.js';
import type { TenantConfig, TenantConfigService } from '../tenant-config/types.js';
import type {
  JurisdictionAuthorities,
  JurisdictionResolver,
  ResolvedJurisdiction,
} from './types.js';

const SUPPORTED_OVERRIDE_CODES = new Set([
  'TZ',
  'KE',
  'UG',
  'NG',
  'ZA',
  'AU',
  'CL',
  'ID',
]);

interface ResolverDeps {
  readonly tenantConfig: TenantConfigService;
}

function localeForLanguage(language: string, country: string): string {
  const entry = getLanguageEntry(language);
  if (entry.bcp47.includes('-')) return entry.bcp47;
  return `${entry.code}-${country}`;
}

function snapshotForCountry(
  country: string,
): {
  readonly countryName: string;
  readonly regulatorSet: TenantConfig['regulatorSet'];
  readonly currency: TenantConfig['defaultCurrency'];
  readonly language: TenantConfig['defaultLanguage'];
  readonly timeZone: string;
  readonly authorities: JurisdictionAuthorities;
  readonly seeded: boolean;
} {
  const defaults = getDefaultsByCountry(country);
  const authorities = getAuthoritiesByCountry(country);
  if (defaults && authorities) {
    return Object.freeze({
      countryName: authorities.countryName,
      regulatorSet: defaults.regulatorSet,
      currency: defaults.defaultCurrency,
      language: defaults.defaultLanguage,
      timeZone: defaults.timezone,
      authorities: Object.freeze({
        mineralAuthority: authorities.mineralAuthority,
        environmentalAuthority: authorities.environmentalAuthority,
        transparencyInitiative: authorities.transparencyInitiative,
        auditAuthority: authorities.auditAuthority,
      }),
      seeded: true,
    });
  }
  // Unseeded — use TZ shape as fallback structure but stamp the
  // requested country code on top. Authorities are intentionally
  // blanked so the brain knows to disclose the gap to the user.
  const tzDefaults = getJurisdictionDefaults('TZ-set');
  return Object.freeze({
    countryName: country,
    regulatorSet: tzDefaults.regulatorSet,
    currency: tzDefaults.defaultCurrency,
    language: tzDefaults.defaultLanguage,
    timeZone: tzDefaults.timezone,
    authorities: Object.freeze({
      mineralAuthority: 'unknown',
      environmentalAuthority: 'unknown',
      transparencyInitiative: 'unknown',
      auditAuthority: 'unknown',
    }),
    seeded: false,
  });
}

class DefaultJurisdictionResolver implements JurisdictionResolver {
  constructor(private readonly deps: ResolverDeps) {}

  async resolve(
    tenantId: string,
    optionalOverride?: string | null,
  ): Promise<ResolvedJurisdiction> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('jurisdiction-resolver: tenantId is required');
    }

    const override = optionalOverride?.trim().toUpperCase() ?? null;
    if (override && override.length > 0) {
      // Override path — return a snapshot for the requested
      // country WITHOUT mutating the tenant row. Honor unseeded
      // gracefully.
      const snap = snapshotForCountry(override);
      const source: ResolvedJurisdiction['source'] = snap.seeded
        ? 'override'
        : 'unseeded';
      return Object.freeze({
        country: override,
        countryName: snap.countryName,
        regulatorSet: snap.regulatorSet,
        currency: snap.currency,
        defaultLanguage: snap.language,
        locale: localeForLanguage(snap.language, override),
        timeZone: snap.timeZone,
        mineralAuthorities: snap.authorities,
        environmentalAuthority: snap.authorities.environmentalAuthority,
        transparencyInitiative: snap.authorities.transparencyInitiative,
        auditAuthority: snap.authorities.auditAuthority,
        source,
      });
    }

    // Default path — read the tenant row through tenant-config.
    const cfg = await this.deps.tenantConfig.get(tenantId);
    const snap = snapshotForCountry(cfg.countryCode);
    return Object.freeze({
      country: cfg.countryCode,
      countryName: snap.countryName,
      regulatorSet: cfg.regulatorSet,
      currency: cfg.defaultCurrency,
      defaultLanguage: cfg.defaultLanguage,
      locale: localeForLanguage(cfg.defaultLanguage, cfg.countryCode),
      timeZone: snap.timeZone,
      mineralAuthorities: snap.authorities,
      environmentalAuthority: snap.authorities.environmentalAuthority,
      transparencyInitiative: snap.authorities.transparencyInitiative,
      auditAuthority: snap.authorities.auditAuthority,
      source: 'tenant',
    });
  }
}

/**
 * Factory for the JurisdictionResolver. Pure constructor — the
 * resolver itself is stateless and composes only the injected
 * TenantConfigService.
 */
export function createJurisdictionResolver(
  deps: ResolverDeps,
): JurisdictionResolver {
  return new DefaultJurisdictionResolver(deps);
}

/**
 * Check whether a country code is seeded in the static authorities
 * snapshot. Used by the brain to decide whether to ask the
 * "I don't have Peru regulator details wired yet" follow-up.
 */
export function isSeededOverride(countryCode: string): boolean {
  return SUPPORTED_OVERRIDE_CODES.has(countryCode.toUpperCase());
}
