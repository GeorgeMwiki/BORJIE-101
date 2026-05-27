/**
 * Personas subsystem - unified persona abstraction + default catalog.
 *
 * This module exports TWO public APIs:
 *
 *  1. Legacy (backward-compat): the 12-persona flat catalog exposed as
 *     DEFAULT_PERSONAE, consumed today by brain.ts, orchestrator.ts, and
 *     persona-snapshot.test.ts. Do not remove until every consumer
 *     migrates.
 *
 *  2. Borjie's portal-bound primary personae + differential
 *     sub-persona prompt layers (structure inherited from the pre-fork
 *     lineage; evolved independently), exposed as PRIMARY_PERSONAE,
 *     SUB_PERSONA_LAYERS, resolvePersona, routeToSubPersona,
 *     composePersonaPrompt. This is the cleaner model.
 */

// ----- Legacy catalog (backward compat) -----
export * from './persona.js';
export * from './system-prompts.js';
export * from './personas.catalog.js';

// ----- New portal-bound primary persona API -----
export type {
  BorjiePersona,
  BorjiePersonaId,
  PortalId,
  PersonaCommunicationStyle,
} from './persona-types.js';
export { PORTAL_PERSONA_MAP } from './persona-types.js';

export {
  resolvePersona,
  resolvePersonaById,
  getRegisteredPersonas,
  getAllPrimaryPersonae,
} from './persona-router.js';

// Primary persona factories (individually addressable for tests/DI).
export { createManagerChat } from './manager-chat.js';
export { createCoworker } from './coworker.js';
export { createTenantAssistant } from './tenant-assistant.js';
export { createOwnerAdvisor } from './owner-advisor.js';
export { createBorjieStudio } from './borjie-studio.js';
export { createPublicGuide } from './public-guide.js';

// ----- Mining-domain Master Brain persona (MVP1+) -----
// Replaces the legacy estate-manager Master Brain. Mode-switched single
// persona (8 modes: Build / Strategy / Operations / Document / Finance /
// Risk / Board-Investor / Compliance). Consumed by the api-gateway
// kernel composition root (`brain-kernel-wiring.ts`).
export type {
  MiningCeoPersona,
  MiningCeoMode,
  MiningCeoModeId,
  MiningCeoLanguage,
} from './mining-ceo-persona.js';
export {
  miningCeoPersona,
  getMiningCeoMode,
} from './mining-ceo-persona.js';
export {
  MINING_CEO_MODES,
  BUILD_MODE,
  STRATEGY_MODE,
  OPERATIONS_MODE,
  DOCUMENT_MODE,
  FINANCE_MODE,
  RISK_MODE,
  BOARD_INVESTOR_MODE,
  COMPLIANCE_MODE,
} from './mining-ceo-modes.js';

// ----- Universal-creator meta-tool (Wave 18Q) -----
// Mr. Mwikila dispatches owner intent to the five atomic capabilities:
// research, tab, doc, media, campaign. See
// `Docs/DESIGN/CAPABILITIES_UNIFICATION.md`.
export type {
  AuthorityTier,
  ComposeAnythingCapability,
  ComposeAnythingInput,
  ComposeAnythingOutput,
  ComposeAnythingToolDescriptor,
  DataJoinRef,
} from './tools/compose-anything.js';
export {
  composeAnythingV1Tool,
  COMPOSE_ANYTHING_V1_TOOL_ID,
} from './tools/compose-anything.js';

// ----- New sub-persona differential layer API -----
export type {
  SubPersonaId,
  SubPersonaConfig,
  SubPersonaSignal,
  SubPersonaDetectionResult,
  SubPersonaToneOverrides,
  SubPersonaMetadata,
} from './sub-persona-types.js';
export {
  SUB_PERSONA_REGISTRY,
  SUB_PERSONA_METADATA_REGISTRY,
  getSubPersona,
  getSubPersonaMetadata,
  getSubPersonasForRoute,
  estimateSubPersonaTokensForRoute,
  getSubPersonaVersions,
} from './sub-persona-types.js';

export type {
  SubPersonaRoutingContext,
  SubPersonaRoutingResult,
} from './sub-persona-router.js';
export {
  routeToSubPersona,
  getSubPersonaPromptLayer,
  composePersonaPrompt,
  composeAvailableTools,
  getSubPersonaConfig,
} from './sub-persona-router.js';

// ----- Convenience aggregate exports -----
import { getAllPrimaryPersonae } from './persona-router.js';
import { SUB_PERSONA_REGISTRY } from './sub-persona-types.js';

/**
 * All 6 portal-bound primary personae, frozen.
 */
export const PRIMARY_PERSONAE = Object.freeze(getAllPrimaryPersonae());

/**
 * All 7 differential sub-persona prompt layers, keyed by id.
 */
export const SUB_PERSONA_LAYERS = SUB_PERSONA_REGISTRY;

// ----- Wave-13 amplification: pedagogy standards + teaching style -----
export {
  BLOOM_LEVELS,
  SCAFFOLDING_RUNGS,
  DELIVERY_MODES,
  PEDAGOGY_CONSTANTS,
  PEDAGOGY_STANDARDS_RUBRIC,
  PEDAGOGY_STANDARDS_METADATA,
  type BloomLevel,
  type ScaffoldingRung,
  type DeliveryMode,
} from './sub-personas/pedagogy-standards.js';

export {
  TeachingStyleSchema,
  VerbosityLevelSchema,
  ExamplesDensitySchema,
  SocraticQuestionRateSchema,
  CultureContextSchema,
  DEFAULT_TEACHING_STYLE,
  resolveTeachingStyle,
  verbosityWordBudget,
  examplesPerConcept,
  socraticRatioFloor,
  renderTeachingStyleAddendum,
  safeParseTeachingStyle,
  type TeachingStyle,
  type VerbosityLevel,
  type ExamplesDensity,
  type SocraticQuestionRate,
  type CultureContext,
} from './sub-personas/teaching-style.js';
