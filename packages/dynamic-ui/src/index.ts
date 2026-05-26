/**
 * `@borjie/dynamic-ui` — public surface.
 *
 * The Anticipatory UX Layer 1-2-3 building blocks.
 *
 * Source of truth: `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`.
 *
 * Public symbols at a glance:
 *
 *   Types (types.ts)
 *     - TabRecipe, FormSchema, FieldGroup, Field, ActionRef,
 *       TabComposeContext, CitationContract, Intent, BrandValidationResult
 *
 *   Registry (registry.ts)
 *     - TabRecipeRegistry, createTabRecipeRegistry
 *
 *   Composer (composer.ts)
 *     - composeTab, validateFormSchema, actionRef, ComposeError
 *
 *   Brand validator (brand-validator.ts)
 *     - validateBrandTokens, assertBrandTokens, BrandTokenViolationError
 *
 *   Intent recognition (intent-recognition.ts)
 *     - recogniseIntent, MIN_INTENT_CONFIDENCE, DEFAULT_PATTERNS
 *
 *   Field selectors (field-selectors/)
 *     - regulatoryFields, applyDataJoins, applyMasteryTier, FIELD_SELECTORS
 *
 *   Evidence helper (evidence.ts)
 *     - collectCitationContracts, resolveCitation, resolveAllCitations,
 *       hasFullCitationCoverage, citationIdsFromGroups, citationIdsFromField
 *
 *   Reference recipes (recipes/)
 *     - buyerKybStartRecipe, siteInspectionStartRecipe
 */

// ── Types ─────────────────────────────────────────────────────────────
export type {
  ActionRef,
  AuthorityTier,
  BrandValidationResult,
  CitationContract,
  CorpusAccessor,
  DataJoinAccessor,
  Field,
  FieldGroup,
  FieldGroupVisibility,
  FieldKind,
  FieldValidation,
  FormSchema,
  Intent,
  IntentEntity,
  Locale,
  MasteryLevel,
  OperatorContext,
  OwnerPreferenceProfile,
  RegistryLookup,
  TabComposeContext,
  TabRecipe,
  TabRecipeStatus,
} from './types.js';

// ── Registry ──────────────────────────────────────────────────────────
export {
  TabRecipeRegistry,
  TabRecipeRegistryError,
  createTabRecipeRegistry,
} from './registry.js';

// ── Composer ──────────────────────────────────────────────────────────
export {
  composeTab,
  validateFormSchema,
  actionRef,
  ComposeError,
  type ComposeOptions,
} from './composer.js';

// ── Brand validator ───────────────────────────────────────────────────
export {
  validateBrandTokens,
  assertBrandTokens,
  BrandTokenViolationError,
} from './brand-validator.js';

// ── Intent recognition ────────────────────────────────────────────────
export {
  recogniseIntent,
  MIN_INTENT_CONFIDENCE,
  DEFAULT_PATTERNS,
  DEFAULT_RECOGNISER_CONFIG,
  type IntentPattern,
  type EntityExtractor,
  type RecogniserConfig,
} from './intent-recognition.js';

// ── Field selectors ───────────────────────────────────────────────────
export {
  regulatoryFields,
  applyDataJoins,
  applyMasteryTier,
  FIELD_SELECTORS,
  type FieldSelector,
  type FieldGroupTransform,
} from './field-selectors/index.js';
export type {
  RegulatoryGroupSpec,
  RegulatoryRequirement,
  RegulatoryFieldSelectorOptions,
} from './field-selectors/regulatory.js';
export type {
  FieldPrefillRule,
  DataJoinTransformOptions,
} from './field-selectors/data-join.js';
export type {
  MasteryTierTransformOptions,
} from './field-selectors/mastery-tier.js';

// ── Evidence helper ───────────────────────────────────────────────────
export {
  collectCitationContracts,
  resolveCitation,
  resolveAllCitations,
  hasFullCitationCoverage,
  citationIdsFromGroups,
  citationIdsFromField,
  type ResolvedCitation,
} from './evidence.js';

// ── Reference recipes ─────────────────────────────────────────────────
export { buyerKybStartRecipe } from './recipes/buyer-kyb-start.js';
export { siteInspectionStartRecipe } from './recipes/site-inspection-start.js';
