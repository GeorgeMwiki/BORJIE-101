/**
 * `@borjie/dynamic-ui` — public types.
 *
 * Source of truth: `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §3.
 *
 * These contracts mirror the Tab Recipe / FormSchema shape sketched in
 * the spec so a `FormSchema` projects cleanly down onto the existing
 * `prefill-form` / `multistep-wizard` UiParts in `@borjie/genui`.
 *
 * Anti-pattern enforcement here is structural:
 *   - all collections are `ReadonlyArray<T>` so composer outputs cannot
 *     be mutated downstream,
 *   - `brand` is forced to the literal `'borjie'` so nothing off-brand
 *     can declare itself a Tab Recipe,
 *   - `authority_tier` is a numeric union — no implicit Tier-3 ever
 *     ships,
 *   - `MasteryLevel` is shared with `@borjie/chat-ui`'s `user-mastery`
 *     module shape so the composer can consume the same tier values
 *     the renderer already exposes.
 *
 * No I/O. No DB. No React. Pure typed primitives + pure composer
 * functions. The package is server-safe (Node + Edge) and browser-safe.
 */

// ---------------------------------------------------------------------------
// Authority + mastery
// ---------------------------------------------------------------------------

/**
 * Authority tier of a Tab Recipe — see §5 of the spec.
 *
 *  - 0 → Mr. Mwikila may auto-apply copy / ordering changes within a
 *        single field group.
 *  - 1 → Adding / removing fields, regrouping, splitting steps —
 *        requires owner approval.
 *  - 2 → Changing submit action, required-vs-optional, primary brand
 *        treatment — requires owner approval AND a second authoriser.
 */
export type AuthorityTier = 0 | 1 | 2;

/** Lifecycle status of a Tab Recipe version. */
export type TabRecipeStatus =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

/**
 * Mastery level — duplicated on purpose so this package has no runtime
 * dependency on `@borjie/chat-ui`. Keep this in sync with
 * `packages/chat-ui/src/lib/user-mastery/types.ts`.
 */
export type MasteryLevel =
  | 'novice'
  | 'intermediate'
  | 'expert'
  | 'power-user';

/** Locale Mr. Mwikila composes for. Bilingual-mandatory. */
export type Locale = 'en' | 'sw';

// ---------------------------------------------------------------------------
// Form schema primitives
// ---------------------------------------------------------------------------

/** Field input kinds the brand-locked primitive set can render. */
export type FieldKind =
  | 'text'
  | 'number'
  | 'date'
  | 'enum'
  | 'currency'
  | 'phone'
  | 'multiline'
  | 'file';

/**
 * Validation rule — kept tiny on purpose; the composer never invents
 * untyped validators.
 */
export interface FieldValidation {
  readonly kind: 'regex' | 'min' | 'max' | 'enum';
  readonly payload: unknown;
}

/**
 * Citation contract — every regulatory-required field MUST point back
 * to a corpus passage explaining WHY the field is required.
 *
 * `citation_id` is the stable corpus reference (e.g. `TUMEMADINI-4.2`).
 * `rule` is the human-readable shorthand surfaced in the UI tooltip.
 */
export interface CitationContract {
  readonly rule: string;
  readonly citation_id: string;
}

/**
 * Field — one input in a FieldGroup.
 *
 * `required_because` is REQUIRED when `required === true` for any
 * regulatory rule. The brand-validator does not enforce this, but the
 * composer-level evidence helper does.
 */
export interface Field {
  readonly id: string;
  readonly kind: FieldKind;
  readonly label_en: string;
  readonly label_sw: string;
  readonly required: boolean;
  readonly required_because?: CitationContract;
  readonly default?: unknown;
  readonly validate?: FieldValidation;
  readonly help_en?: string;
  readonly help_sw?: string;
  /**
   * Pre-filled value from the joins accessor. Surfaced read-only by
   * the renderer until the operator explicitly edits.
   */
  readonly prefill?: unknown;
  /**
   * Field is owner-only — ops staff see it but cannot complete /
   * submit it.
   */
  readonly owner_only?: boolean;
}

export type FieldGroupVisibility = 'always' | 'gated_expert' | 'gated_power_user';

/** Field group — one collapsible / one wizard step. */
export interface FieldGroup {
  readonly id: string;
  readonly title_en: string;
  readonly title_sw: string;
  readonly fields: ReadonlyArray<Field>;
  readonly visibility?: FieldGroupVisibility;
}

/**
 * ActionRef — where the form posts on submit.
 *
 * Mirrors the `PrefillFormPartSchema.action` regex in `@borjie/genui`:
 * either a relative `/api/gateway/forms/<form-id>` path or a fully
 * qualified `https://…/api/gateway/forms/<form-id>` URL. Validated by
 * `composer.ts` before a recipe ships.
 */
export interface ActionRef {
  readonly form_id: string;
  readonly url: string;
  /**
   * `POST` is the only verb the gateway accepts for form submissions
   * today — left typed so future verbs can be added without changing
   * the contract shape.
   */
  readonly method: 'POST';
}

/** FormSchema — the composer's output. */
export interface FormSchema {
  readonly title_en: string;
  readonly title_sw: string;
  readonly groups: ReadonlyArray<FieldGroup>;
  readonly submit_action: ActionRef;
  /**
   * Corpus citation IDs for the WHY of every regulatory-required
   * field. The renderer surfaces these as "Why this field?" tooltips.
   */
  readonly evidence_ids: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Compose context
// ---------------------------------------------------------------------------

/**
 * CorpusAccessor — read-side handle on the regulator pack + internal
 * SLA library. Composers query the corpus for rules that justify a
 * field's inclusion.
 *
 * The runtime implementation lives outside this package (Phase 2
 * `compliance-pack` integration). This is the shape composers code
 * against.
 */
export interface CorpusAccessor {
  /** Returns true if a citation exists for the given id. */
  readonly hasCitation: (citationId: string) => Promise<boolean>;
  /** Returns the rule body keyed by citation_id, or null if unknown. */
  readonly lookup: (
    citationId: string,
  ) => Promise<{ readonly rule_en: string; readonly rule_sw: string } | null>;
}

/**
 * DataJoinAccessor — typed read-side on the operator's existing
 * tenant data. Composers consult this to pre-fill fields the operator
 * has already declared elsewhere.
 *
 * Generic so a recipe can pull `{ buyer, parcel }`, `{ inspector,
 * site }`, etc. Implementations live outside this package.
 */
export interface DataJoinAccessor {
  /**
   * Returns the joined record by key. `null` if the join is empty for
   * the operator's tenant.
   */
  readonly get: <T>(joinKey: string) => Promise<T | null>;
}

/** Owner preference profile — which fields the owner does personally. */
export interface OwnerPreferenceProfile {
  readonly owner_only_keys: ReadonlyArray<string>;
  readonly ops_default_keys: ReadonlyArray<string>;
  readonly auto_keys: ReadonlyArray<string>;
}

/** Operator identity + mastery — passed to every composer. */
export interface OperatorContext {
  readonly userId: string;
  readonly masteryLevel: MasteryLevel;
}

/**
 * TabComposeContext — the only thing a composer reads.
 *
 * The composer is a PURE function of this context — same input must
 * always produce the same FormSchema. That property is what enables
 * `compose(ctx)` to be unit-tested without spinning a database.
 */
export interface TabComposeContext {
  readonly tenantId: string;
  readonly operator: OperatorContext;
  readonly corpus: CorpusAccessor;
  readonly joins: DataJoinAccessor;
  readonly ownerPreferences: OwnerPreferenceProfile;
  readonly locale: Locale;
}

// ---------------------------------------------------------------------------
// Tab Recipe
// ---------------------------------------------------------------------------

/**
 * TabRecipe — the bound thing in the registry.
 *
 * `brand` is forced to the literal `'borjie'`. There is no escape. A
 * recipe that doesn't carry this literal will not pass `tsc`.
 */
export interface TabRecipe {
  readonly id: string;
  readonly intent: string;
  readonly version: number;
  readonly status: TabRecipeStatus;
  readonly compose: (ctx: TabComposeContext) => Promise<FormSchema>;
  readonly telemetry_key: string;
  readonly brand: 'borjie';
  readonly authority_tier: AuthorityTier;
}

// ---------------------------------------------------------------------------
// Intent recognition (Layer 1)
// ---------------------------------------------------------------------------

/**
 * Intent — the typed classification of an operator turn.
 *
 * The Layer 1 recogniser emits this from chat / voice / browser
 * perception streams. Each Intent is bound to exactly one Tab Recipe
 * in the registry.
 *
 * Confidence is a 0..1 floor; the recogniser returns `null` when
 * confidence is below `MIN_INTENT_CONFIDENCE`. This matches the
 * tab-need-detector's ≥ 0.7 contract (§1, Layer 1).
 */
export interface Intent {
  readonly kind: string;
  readonly confidence: number;
  readonly entities: ReadonlyArray<IntentEntity>;
  /** Free-text source span; opaque to the registry. */
  readonly source_excerpt: string;
}

/** Entity extracted from the source turn (light-weight NER hook). */
export interface IntentEntity {
  readonly kind: string;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Brand validator
// ---------------------------------------------------------------------------

/** Outcome of the runtime brand-token validator (`brand-validator.ts`). */
export type BrandValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: ReadonlyArray<string> };

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Lookup result for `TabRecipeRegistry.lookup`. */
export interface RegistryLookup {
  readonly recipe: TabRecipe;
  readonly liveVersion: number;
  readonly shadowVersion?: number;
}
