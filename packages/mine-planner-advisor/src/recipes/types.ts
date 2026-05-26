/**
 * Local recipe contracts for Ms. Sifa's tab and doc recipes.
 *
 * These shapes mirror the structure used by `@borjie/dynamic-ui` (tab
 * recipes) and the document-composition layer (doc recipes), but live
 * here as lightweight value descriptors so the junior package can ship
 * recipe definitions without taking a hard dependency on dynamic-ui /
 * document-studio at compile time. The persona-runtime composition
 * root maps these to the real registries at boot.
 */

/**
 * Brand identifier the recipe is locked to. Matches `borjie` until the
 * brand-DNA spec extends it.
 */
export type RecipeBrand = 'borjie';

/**
 * Authority tier required to commit a mutation flowing out of the
 * recipe. Mirrors `JuniorScope.authority_tier_max` semantics.
 */
export type RecipeAuthorityTier = 0 | 1 | 2;

/**
 * Tab recipe descriptor — composed by `compose_tab_v1` and rendered by
 * the dynamic-ui composer. Ms. Sifa owns `shift_plan_review` and
 * `crew_assignment`.
 */
export interface MiningTabRecipeDescriptor {
  readonly id: string;
  readonly intent: string;
  readonly version: number;
  readonly status: 'live' | 'draft' | 'deprecated';
  readonly brand: RecipeBrand;
  readonly authority_tier: RecipeAuthorityTier;
  /**
   * Tables the composer is allowed to read when prefilling fields.
   * Validated against `JuniorScope.data_tables` at composition time.
   */
  readonly data_sources: ReadonlyArray<string>;
  /** Telemetry key written to the tab-event-log on every render. */
  readonly telemetry_key: string;
  /** Human-readable summary surfaced in the recipe registry index. */
  readonly summary: string;
}

/**
 * Doc recipe descriptor — composed by `compose_doc_v1` and rendered by
 * the document-composition layer. Ms. Sifa owns
 * `weekly_production_brief`.
 */
export interface MiningDocRecipeDescriptor {
  readonly id: string;
  readonly version: number;
  readonly status: 'live' | 'draft' | 'deprecated';
  readonly brand: RecipeBrand;
  /** Output formats the recipe can emit. */
  readonly outputs: ReadonlyArray<'pdf' | 'docx' | 'md'>;
  /** Tables the doc composer pulls data from. */
  readonly data_sources: ReadonlyArray<string>;
  /** Telemetry key written to the doc-event-log on every render. */
  readonly telemetry_key: string;
  /** Owner gate — 'none' / 'approval' / 'double-verify'. */
  readonly owner_gate: 'none' | 'approval' | 'double-verify';
  /** Human-readable summary. */
  readonly summary: string;
}
