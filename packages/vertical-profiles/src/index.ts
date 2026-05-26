/**
 * `@borjie/vertical-profiles` — public surface (Wave VP-1).
 *
 * Canonical universal vertical-profile registry. Companion spec:
 * `Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md`. Founder lock:
 * `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`.
 *
 * Three concerns exposed:
 *
 *   - types      — VerticalProfileDefinition + VerticalWorkflowDefinition
 *                  shapes, status / vertical / cadence enums, Citation,
 *                  and the zod schemas backing them.
 *   - registry   — port + in-memory adapter (CRUD + filtered list).
 *   - seeds      — 74 reserved profiles + a seed loader that takes
 *                  live profile bundles from @borjie/vertical-profile-* sister
 *                  packages and idempotently upserts everything.
 *
 * @module @borjie/vertical-profiles
 */

// Types
export {
  PROFILE_STATUSES,
  VERTICALS,
  CADENCES,
  CitationSchema,
  VerticalEntityDefinitionSchema,
  GlossaryEntrySchema,
  RegulatorBindingSchema,
  VerticalProfileDefinitionSchema,
  WorkflowContractShapeSchema,
  VerticalWorkflowDefinitionSchema,
  VerticalProfileError,
  type Citation,
  type Cadence,
  type EntityAttribute,
  type GlossaryEntry,
  type ProfileStatus,
  type RegistryListFilter,
  type RegulatorBinding,
  type Vertical,
  type VerticalEntityDefinition,
  type VerticalProfileDefinition,
  type VerticalProfileErrorCode,
  type VerticalWorkflowDefinition,
  type WorkflowContractShape,
} from './types.js';

// Logger
export { buildVerticalProfilesLogger } from './logger.js';
export type { VerticalProfilesLoggerOptions } from './logger.js';

// Registry
export {
  createInMemoryRegistry,
  type VerticalProfileRegistry,
} from './registry/in-memory-registry.js';

// Seeds
export {
  loadSeedProfiles,
  type SeedBundle,
  type SeedResult,
} from './seeds/loader.js';
export { RESERVED_PROFILES } from './seeds/reserved-profiles.js';
export {
  ICMM_MINING,
  EITI_STANDARD,
  USDA_FAS,
  FAO_FOREST,
  API_STANDARDS,
  FSC_STANDARDS,
  UN_REDD,
  ISO_14001,
  GRI_STANDARDS,
  UNWTO,
  IFRS_16,
  VERTICAL_ANCHORS,
} from './seeds/citations.js';
export { VERTICAL_ENTITY_TEMPLATES } from './seeds/entity-templates.js';
