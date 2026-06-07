/**
 * Jurisdiction profile registry — composition-root wiring (Wave UNIV-1).
 *
 * Loads the `@borjie/jurisdiction-profile-tz` launch-beachhead profile +
 * its four regulators (TRA / Tumemadini / NEMC / BoT) into the pluggable
 * `@borjie/jurisdiction-profiles` registries at app bootstrap, exactly as
 * the profile package's own header prescribes:
 *
 *   const profiles   = registerProfile(emptyProfileRegistry(), tzProfile);
 *   const regulators = registerRegulators(emptyRegulatorRegistry(), tzRegulators);
 *
 * It also installs the universal compliance-framework seed (GDPR / TZ DPA
 * 2022 / … from `@borjie/jurisdiction-profiles/seed`) so the TZ profile's
 * `data_protection_laws: ['tz_dpa_2022']` reference resolves to a real
 * framework row.
 *
 * Why a singleton here (not a per-request build): the registries are pure,
 * immutable, frozen-Map snapshots of static jurisdiction LAW — there is no
 * tenant data and no I/O. Building them once at boot and reading through the
 * accessors below keeps the hot path allocation-free. Adding a new
 * jurisdiction = add its `@borjie/jurisdiction-profile-{cc}` package and one
 * `registerProfile` / `registerRegulators` call in `buildJurisdictionRegistry`
 * — no core edit elsewhere.
 *
 * Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md §7
 *
 * Consumers: `composition/brain-tools/data-analysis-tools.ts` reads the
 * resolved TZ profile (currency / timezone / regulators) to stamp every
 * statistical result with its jurisdiction provenance (CLAUDE.md
 * evidence-required + currency-neutral: the currency code is READ from the
 * profile, never hard-coded). Bootstrap calls `initJurisdictionRegistry()`
 * once from `services/api-gateway/src/index.ts`.
 */

import {
  emptyProfileRegistry,
  emptyRegulatorRegistry,
  emptyFrameworkRegistry,
  registerProfile,
  registerRegulators,
  registerFrameworks,
  registerControlMappings,
  findProfile,
  findRegulatorsForJurisdiction,
  findFramework,
  type ProfileRegistry,
  type RegulatorRegistry,
  type FrameworkRegistry,
  type JurisdictionProfile,
  type RegulatorDefinition,
  type ComplianceFramework,
} from '@borjie/jurisdiction-profiles';
import {
  ALL_FRAMEWORKS,
  ALL_CONTROL_MAPPINGS,
} from '@borjie/jurisdiction-profiles/seed';
import { tzProfile, tzRegulators } from '@borjie/jurisdiction-profile-tz';
import { logger } from '../utils/logger.js';

export interface JurisdictionRegistry {
  readonly profiles: ProfileRegistry;
  readonly regulators: RegulatorRegistry;
  readonly frameworks: FrameworkRegistry;
}

/**
 * Build the immutable jurisdiction registry. Pure — no I/O, no env reads.
 * Exported (not just the memoised accessor) so tests can build a fresh
 * registry without touching process-level state.
 */
export function buildJurisdictionRegistry(): JurisdictionRegistry {
  // TZ launch beachhead — the only jurisdiction package shipped at launch.
  const profiles = registerProfile(emptyProfileRegistry(), tzProfile);
  const regulators = registerRegulators(emptyRegulatorRegistry(), tzRegulators);

  // Universal compliance-framework catalogue (GDPR / TZ DPA 2022 / …) so the
  // TZ profile's `data_protection_laws` reference resolves to a real row.
  const frameworks = registerControlMappings(
    registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS),
    ALL_CONTROL_MAPPINGS,
  );

  return Object.freeze({ profiles, regulators, frameworks });
}

let cached: JurisdictionRegistry | null = null;

/**
 * Initialise + memoise the registry. Idempotent — safe to call from the
 * bootstrap more than once (returns the same frozen snapshot). Logs the
 * loaded jurisdiction ids once so the deploy log proves the profile is live.
 */
export function initJurisdictionRegistry(): JurisdictionRegistry {
  if (cached) return cached;
  cached = buildJurisdictionRegistry();
  logger.info(
    {
      profiles: [...cached.profiles.entries.keys()],
      regulators: [...cached.regulators.regulators.keys()],
    },
    'jurisdiction registry initialised',
  );
  return cached;
}

/** Return the memoised registry, initialising it on first access. */
export function getJurisdictionRegistry(): JurisdictionRegistry {
  return cached ?? initJurisdictionRegistry();
}

// ---------------------------------------------------------------------------
// Read accessors — the only surface consumers should depend on.
// ---------------------------------------------------------------------------

/** The full jurisdiction profile for an id (e.g. 'tz'), or undefined. */
export function getJurisdictionProfile(
  id: string,
): JurisdictionProfile | undefined {
  return findProfile(getJurisdictionRegistry().profiles, id);
}

/** The regulators registered for a jurisdiction id (TRA / Tumemadini / …). */
export function getJurisdictionRegulators(
  jurisdictionId: string,
): ReadonlyArray<RegulatorDefinition> {
  return findRegulatorsForJurisdiction(
    getJurisdictionRegistry().regulators,
    jurisdictionId,
  );
}

/** A compliance framework by id (e.g. 'tz_dpa_2022'), or undefined. */
export function getComplianceFramework(
  id: string,
): ComplianceFramework | undefined {
  return findFramework(getJurisdictionRegistry().frameworks, id);
}

/**
 * Compact, evidence-bearing jurisdiction context for a profile id. Returned
 * shape is currency-neutral (the code is READ from the profile) and carries
 * the regulator ids so an AI tool can cite them. `undefined` when the
 * jurisdiction is not registered (the caller degrades honestly).
 */
export interface JurisdictionContext {
  readonly jurisdictionId: string;
  readonly countryName: string;
  readonly currencyCode: string;
  readonly timezone: string;
  readonly dataProtectionLaws: ReadonlyArray<string>;
  readonly regulatorIds: ReadonlyArray<string>;
  readonly profileSourceTitle: string;
  readonly profileSourceUrl: string;
}

export function getJurisdictionContext(
  id: string,
): JurisdictionContext | undefined {
  const profile = getJurisdictionProfile(id);
  if (!profile) return undefined;
  const regulators = getJurisdictionRegulators(id);
  return Object.freeze({
    jurisdictionId: profile.id,
    countryName: profile.display_name,
    currencyCode: profile.currency_code,
    timezone: profile.timezone_default,
    dataProtectionLaws: [...profile.data_protection_laws],
    regulatorIds: regulators.map((r) => r.id),
    profileSourceTitle: profile.profile_source_title,
    profileSourceUrl: profile.profile_source_url,
  });
}

/** Test-only: drop the memo so a unit test can rebuild with a clean slate. */
export function __resetJurisdictionRegistryForTests(): void {
  cached = null;
}
