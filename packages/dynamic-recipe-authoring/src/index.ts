/**
 * `@borjie/dynamic-recipe-authoring` — public surface.
 *
 * Wave 18M. Mr. Mwikila authors NEW tab + document + media +
 * campaign + tool recipes on demand via an LLM, validates them
 * against the Wave 18B / 18C / Wave M7-M9 contracts, persists them
 * as `draft`, and advances them through the catalogue's
 * draft → shadow → live → locked → deprecated lifecycle.
 *
 * Spec: Docs/DESIGN/DYNAMIC_RECIPE_AUTHORING_SPEC.md.
 * Persona: Mr. Mwikila. Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AuthorErrorCode,
  AuthoredRecipe,
  AuthoredRecipeRepository,
  LlmAuthorPort,
  RecipeAuthorRequest,
  RecipeAuthorResult,
  RecipeKind,
  RecipeLifecycle,
} from './types.js';

export {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  DEFAULT_VERSION,
  DynamicRecipeAuthoringError,
  LLM_AUTHOR_IDENTITY,
  RECIPE_KINDS,
  RECIPE_LIFECYCLE_STATES,
} from './types.js';

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export {
  validateRecipe,
  validateTabRecipe,
  validateDocRecipe,
  type RecipeValidationResult,
} from './validator/recipe-validator.js';

// ---------------------------------------------------------------------------
// Lifecycle bridge
// ---------------------------------------------------------------------------

export {
  canTransition,
  isTerminal,
  nextTransitions,
  toCatalogueLifecycle,
  type LifecycleTransitionAttempt,
  type LifecycleTransitionResult,
} from './lifecycle/lifecycle-bridge.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export {
  TAB_RECIPE_SYSTEM_PROMPT,
  buildTabRecipePrompt,
  buildTabRecipeUserPrompt,
  type TabPromptArgs,
} from './prompts/tab-recipe-prompt.js';

export {
  DOC_RECIPE_SYSTEM_PROMPT,
  buildDocRecipePrompt,
  buildDocRecipeUserPrompt,
  type DocPromptArgs,
} from './prompts/doc-recipe-prompt.js';

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export {
  createRecipeAuthor,
  type PromptBuilder,
  type PromptBuilders,
  type RecipeAuthorDeps,
} from './author/recipe-author.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export {
  createInMemoryAuthoredRecipeRepository,
  createSqlAuthoredRecipeRepository,
  type InMemoryAuthoredRecipeRepoDeps,
  type SqlAuthoredRecipeDriver,
  type SqlAuthoredRecipeRepoDeps,
} from './repositories/authored-recipe-repository.js';

// ---------------------------------------------------------------------------
// Audit + logger
// ---------------------------------------------------------------------------

export {
  computeAuthoredRecipeAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';

export {
  buildAuthoringLogger,
  type AuthoringLoggerOptions,
} from './logger.js';
