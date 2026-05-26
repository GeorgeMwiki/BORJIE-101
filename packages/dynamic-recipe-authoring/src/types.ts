/**
 * `@borjie/dynamic-recipe-authoring` — public types.
 *
 * Wave 18M. Mirrors the persistence shape introduced by migration
 * `0066_dynamic_authored_recipes.sql`:
 *
 *   - AuthoredRecipe       — one row in `dynamic_authored_recipes`.
 *                             Carries the validated, frozen spec plus
 *                             lifecycle + audit-chain metadata.
 *   - RecipeAuthorRequest  — what an operator turn (or upstream
 *                             agent) hands the authoring orchestrator.
 *   - RecipeAuthorResult   — the orchestrator's discriminated-union
 *                             return type. Carries the persisted row
 *                             on success or the accumulated validation
 *                             errors on failure.
 *
 * Plus the value enumerations the storage layer enforces. All shapes
 * are immutable (`readonly` everywhere) per coding-style.md.
 *
 * Spec: Docs/DESIGN/DYNAMIC_RECIPE_AUTHORING_SPEC.md.
 */

// ---------------------------------------------------------------------------
// Value enumerations — match the SQL CHECK constraints in 0066_*.sql
// ---------------------------------------------------------------------------

/**
 * Five recognised authoring kinds. The author orchestrator emits
 * exactly one of these per request. `tab` and `doc` are the v1
 * fully-authored kinds; `media | campaign | tool` are reserved for
 * follow-up waves but already enforced by the validator's shape gate.
 */
export type RecipeKind = 'tab' | 'doc' | 'media' | 'campaign' | 'tool';

export const RECIPE_KINDS: ReadonlyArray<RecipeKind> = Object.freeze([
  'tab',
  'doc',
  'media',
  'campaign',
  'tool',
]);

/**
 * Lifecycle state of an authored recipe row. Mirrors the catalogue's
 * five-state machine (Wave CAPABILITY) verbatim so authored recipes
 * share the same governance plane as every other capability Mr.
 * Mwikila exercises:
 *
 *   draft     → shadow         (LLM authored, owner has not yet acted)
 *   shadow    → live           (capability-measurement worker promotes)
 *   live      → locked         (Tier-2 override — pause promotion)
 *   locked    → live           (re-approval)
 *   live      → deprecated     (terminal; removed from dispatch)
 *   shadow    → deprecated     (terminal; failed shadow eval)
 *   draft     → deprecated     (terminal; rejected at author time)
 *
 * `deprecated` is terminal. `locked` is reachable from any forward
 * state.
 */
export type RecipeLifecycle =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

export const RECIPE_LIFECYCLE_STATES: ReadonlyArray<RecipeLifecycle> =
  Object.freeze(['draft', 'shadow', 'live', 'locked', 'deprecated']);

// ---------------------------------------------------------------------------
// AuthoredRecipe — the persisted row + its spec payload
// ---------------------------------------------------------------------------

/**
 * The persisted shape of an LLM-authored recipe. `spec` is opaque at
 * the persistence boundary; the validator narrows it to the kind-
 * specific contract before persistence.
 */
export interface AuthoredRecipe {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: RecipeKind;
  readonly name: string;
  readonly version: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly lifecycleState: RecipeLifecycle;
  readonly authoredAt: Date;
  readonly authoredBy: string;
  readonly prevHash: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// RecipeAuthorRequest — what the orchestrator consumes
// ---------------------------------------------------------------------------

/**
 * An authoring request. The orchestrator picks the kind-specific
 * prompt template (in `prompts/`), invokes the injected `LlmAuthorPort`,
 * validates the response, and persists on success.
 */
export interface RecipeAuthorRequest {
  readonly tenantId: string;
  readonly kind: RecipeKind;
  /** The operator's free-text turn. */
  readonly intentUtterance: string;
  /** Optional name override. When absent the orchestrator derives a
   *  slug from the utterance. */
  readonly desiredName?: string;
  /** `mr-mwikila` when LLM-authored, `tenant-user:<uuid>` for
   *  direct operator authoring. */
  readonly authoredBy: string;
  /**
   * Optional version override. Defaults to `0.1.0` so the first
   * authoring per (tenant, kind, name) lands as a clean semver.
   */
  readonly desiredVersion?: string;
}

// ---------------------------------------------------------------------------
// LlmAuthorPort — what the orchestrator calls
// ---------------------------------------------------------------------------

/**
 * Port the orchestrator calls to ask an LLM for a candidate recipe
 * spec. Tests inject a deterministic stub; production binds the
 * Anthropic SDK with the kind-specific prompt template assembled in
 * `prompts/`. The LLM's job: emit a JSON object that satisfies the
 * Wave 18B / 18C contract for the requested kind.
 *
 * The port is intentionally permissive at the boundary — the
 * validator is the gate. A malformed response surfaces a
 * `RecipeAuthorResult` with `ok: false` and the accumulated errors,
 * not an exception.
 */
export type LlmAuthorPort = (input: {
  readonly kind: RecipeKind;
  readonly intentUtterance: string;
  /** The fully-assembled prompt (system + user). The port may ignore
   *  it (for stubs) or feed it directly to the model. */
  readonly prompt: string;
}) => Promise<{
  /** The LLM's emitted JSON object. */
  readonly spec: unknown;
  /** The model id used (e.g. `claude-opus-4-7`). Surfaced into the
   *  audit payload so a future replay knows which model authored. */
  readonly modelId: string;
}>;

// ---------------------------------------------------------------------------
// RecipeAuthorResult — the orchestrator's return type
// ---------------------------------------------------------------------------

/**
 * Discriminated union — the orchestrator never throws on bad input
 * shape; it surfaces the accumulated errors instead so the caller UI
 * can render every problem at once.
 */
export type RecipeAuthorResult =
  | {
      readonly ok: true;
      readonly recipe: AuthoredRecipe;
      /** The next lifecycle states the owner can promote to. */
      readonly nextTransitions: ReadonlyArray<RecipeLifecycle>;
    }
  | {
      readonly ok: false;
      readonly code: AuthorErrorCode;
      readonly errors: ReadonlyArray<string>;
    };

export type AuthorErrorCode =
  | 'invalid_request'
  | 'invalid_spec'
  | 'persistence_error'
  | 'unsupported_kind';

// ---------------------------------------------------------------------------
// Repository contract
// ---------------------------------------------------------------------------

export interface AuthoredRecipeRepository {
  insert(input: {
    readonly tenantId: string;
    readonly kind: RecipeKind;
    readonly name: string;
    readonly version: string;
    readonly spec: Readonly<Record<string, unknown>>;
    readonly authoredBy: string;
  }): Promise<AuthoredRecipe>;
  findById(tenantId: string, id: string): Promise<AuthoredRecipe | null>;
  listForTenant(
    tenantId: string,
    filter?: {
      readonly kind?: RecipeKind;
      readonly lifecycleState?: RecipeLifecycle;
    },
  ): Promise<ReadonlyArray<AuthoredRecipe>>;
  transitionLifecycle(
    tenantId: string,
    id: string,
    next: RecipeLifecycle,
  ): Promise<AuthoredRecipe>;
}

// ---------------------------------------------------------------------------
// Constants — mirror the SQL CHECK constraints + the lifecycle graph
// ---------------------------------------------------------------------------

/**
 * Lifecycle transitions allowed by the state machine. Outer keys =
 * from-state; inner array = allowed to-states. `deprecated` is
 * terminal.
 */
export const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<RecipeLifecycle, ReadonlyArray<RecipeLifecycle>>
> = Object.freeze({
  draft: Object.freeze(['shadow', 'deprecated'] as ReadonlyArray<RecipeLifecycle>),
  shadow: Object.freeze([
    'live',
    'locked',
    'deprecated',
  ] as ReadonlyArray<RecipeLifecycle>),
  live: Object.freeze([
    'locked',
    'deprecated',
  ] as ReadonlyArray<RecipeLifecycle>),
  locked: Object.freeze(['live', 'deprecated'] as ReadonlyArray<RecipeLifecycle>),
  deprecated: Object.freeze([] as ReadonlyArray<RecipeLifecycle>),
});

export const DEFAULT_VERSION = '0.1.0';
export const LLM_AUTHOR_IDENTITY = 'mr-mwikila';

// ---------------------------------------------------------------------------
// Domain error
// ---------------------------------------------------------------------------

export class DynamicRecipeAuthoringError extends Error {
  public readonly code: AuthorErrorCode;
  public readonly detail: ReadonlyArray<string>;
  constructor(
    code: AuthorErrorCode,
    message: string,
    detail: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'DynamicRecipeAuthoringError';
    this.code = code;
    this.detail = detail;
  }
}
