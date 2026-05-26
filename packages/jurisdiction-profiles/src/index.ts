/**
 * `@borjie/jurisdiction-profiles` — public surface (Wave UNIV-1).
 *
 * Pluggable universal-from-day-one registry of:
 *   - Jurisdiction profiles (per-country / per-subdivision rule sets)
 *   - Compliance frameworks (GDPR, TZ DPA, CCPA, LGPD, …)
 *   - Framework control mappings (article → Borjie package impl)
 *   - Regulator definitions (TRA, Tumemadini, NEMC, BoT, …)
 *
 * Adding a new jurisdiction = adding a new profile package
 * (`@borjie/jurisdiction-profile-{cc}`) and one composition-root
 * registration call. No core code touched.
 *
 * Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md
 * Lock: Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  AddressFormat,
  ArticleEntry,
  ArticleRegistry,
  ComplianceFramework,
  ControlKind,
  DataResidencyKind,
  FilingKind,
  FrameworkControlMapping,
  JurisdictionProfile,
  QuietHours,
  RegulatorDefinition,
  RegulatorDomain,
} from './types.js';

export {
  AddressFormatSchema,
  ArticleEntrySchema,
  ArticleRegistrySchema,
  CONTROL_KINDS,
  ComplianceFrameworkSchema,
  DATA_RESIDENCY_KINDS,
  FilingKindSchema,
  FrameworkControlMappingSchema,
  JurisdictionProfileSchema,
  QuietHoursSchema,
  REGULATOR_DOMAINS,
  RegulatorDefinitionSchema,
} from './types.js';

// ── Profile registry ─────────────────────────────────────────────────
export type { ProfileRegistry } from './registry/profile-registry.js';
export {
  emptyProfileRegistry,
  registerProfile,
  registerProfiles,
  findProfile,
  requireProfile,
  listProfileIds,
  findProfilesByDataProtectionLaw,
  findProfilesByLanguagePack,
  findProfilesByResidencyKind,
} from './registry/profile-registry.js';

// ── Framework registry ───────────────────────────────────────────────
export type { FrameworkRegistry } from './registry/framework-registry.js';
export {
  emptyFrameworkRegistry,
  registerFramework,
  registerFrameworks,
  registerControlMapping,
  registerControlMappings,
  findFramework,
  requireFramework,
  listFrameworkIds,
  findMappingsForFramework,
  findMappingsByControlKind,
  findFrameworksForJurisdiction,
} from './registry/framework-registry.js';

// ── Regulator registry ───────────────────────────────────────────────
export type { RegulatorRegistry } from './registry/regulator-registry.js';
export {
  emptyRegulatorRegistry,
  registerRegulator,
  registerRegulators,
  findRegulator,
  requireRegulator,
  listRegulatorIds,
  findRegulatorsForJurisdiction,
  findRegulatorsByDomain,
} from './registry/regulator-registry.js';

// ── Audit-link helper ────────────────────────────────────────────────
export { linkRegistryRow, GENESIS_HASH } from './registry/audit-link.js';
