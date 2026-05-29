/**
 * Jurisdiction-resolver types — JA-1.
 *
 * Sits ABOVE tenant-config (#207). Tenant-config answers
 * "what is the tenant's country / currency / language / regulator
 * set?" — the resolver layers on per-turn override + named
 * authorities (mineral, environmental, transparency, audit) so
 * brain prompts and tools can inject a complete jurisdiction
 * snapshot without re-shape work at the call site.
 *
 * The platform default is TZ (tenant.jurisdiction) per CLAUDE.md
 * Multi-currency, TZS-primary + Swahili-first. When a user message
 * explicitly mentions another jurisdiction, the resolver returns
 * the override view for THAT turn only — the tenant row is NOT
 * mutated unless the JA-5 `mwikila.jurisdiction.switch` tool fires
 * with `scope: 'permanent'`.
 */

import type {
  RegulatorSet,
  SupportedCurrency,
  SupportedLanguage,
} from '../tenant-config/types.js';

/**
 * Named regulatory authorities for a jurisdiction. The 4 mandates
 * (data, environment, transparency, audit) are first-class fields
 * because every Borjie compliance flow reaches for them by mandate,
 * not by slug.
 *
 * `mineralAuthority` is the bureau that issues mining/extraction
 * licences (PCCB in TZ, Mining Office in KE, MID in NG, etc).
 */
export interface JurisdictionAuthorities {
  /** Mining licence + permit authority (e.g. PCCB in TZ). */
  readonly mineralAuthority: string;
  /** Environmental authority (e.g. NEMC in TZ). */
  readonly environmentalAuthority: string;
  /** Transparency initiative (e.g. EITI). */
  readonly transparencyInitiative: string;
  /** Audit authority (e.g. TMAA in TZ). */
  readonly auditAuthority: string;
}

/**
 * Resolved jurisdiction snapshot. Returned by
 * `resolve(tenantId, optionalOverride?)`. Immutable — callers MUST
 * NOT mutate fields.
 */
export interface ResolvedJurisdiction {
  /** ISO-3166-1 alpha-2 country code (e.g. `TZ`). */
  readonly country: string;
  /** Regulator-set identifier (joins `regulator_jurisdictions`). */
  readonly regulatorSet: RegulatorSet;
  /** ISO-4217 currency code. */
  readonly currency: SupportedCurrency;
  /** BCP-47 base language. */
  readonly defaultLanguage: SupportedLanguage;
  /** BCP-47 locale string (e.g. `en-KE`). */
  readonly locale: string;
  /** IANA timezone (e.g. `Africa/Dar_es_Salaam`). */
  readonly timeZone: string;
  /** Named regulatory authorities. */
  readonly mineralAuthorities: JurisdictionAuthorities;
  /** Direct duplicate fields for prompt rendering ergonomics. */
  readonly environmentalAuthority: string;
  readonly transparencyInitiative: string;
  readonly auditAuthority: string;
  /**
   * `tenant` when the snapshot reflects the tenant row, `override`
   * when an explicit jurisdiction override applied (for-this-turn
   * disclosure), `unseeded` when the requested country is not yet
   * in the seed table.
   */
  readonly source: 'tenant' | 'override' | 'unseeded';
  /**
   * Country name (English) — surfaced for prompt rendering and
   * settings UI labels.
   */
  readonly countryName: string;
}

/**
 * Resolver service contract.
 */
export interface JurisdictionResolver {
  /**
   * Resolve the tenant's jurisdiction.
   *
   * @param tenantId tenant UUID
   * @param optionalOverride ISO-3166-1 alpha-2 (e.g. `KE`) — set
   *        when the brain detected an explicit "in Kenya" mention.
   */
  resolve(
    tenantId: string,
    optionalOverride?: string | null,
  ): Promise<ResolvedJurisdiction>;
}
