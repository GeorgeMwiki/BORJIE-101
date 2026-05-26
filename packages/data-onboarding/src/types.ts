/**
 * `@borjie/data-onboarding` — shared types (Wave 18U).
 *
 * The contract from `Docs/DESIGN/DATA_ONBOARDING_SPEC.md`. All types
 * are `readonly` to satisfy the project's immutability rule. Helper
 * constructors in sibling modules always return fresh objects.
 *
 * The 7-stage pipeline:
 *   S1  intent + entity recognition
 *   S2  schema discovery
 *   S3  existing-schema matching
 *   S4  schema evolution proposals (Tier 2 via mutation-authority)
 *   S5  row persistence (UPSERT with provenance)
 *   S6  cross-table linkage + profile-chain graph
 *   S7  deep online research enrichment (Tier 0)
 */

// ---------------------------------------------------------------------------
// Entity types — closed catalogue
// ---------------------------------------------------------------------------

export type EntityType =
  | 'worker'
  | 'parcel'
  | 'contract'
  | 'site'
  | 'buyer'
  | 'asset'
  | 'incident'
  | 'payroll_entry'
  | 'certification'
  | 'shift'
  | 'inspection'
  | 'licence'
  | 'kpi'
  | 'drill_hole'
  | 'assay'
  | 'unknown';

export const ALL_ENTITY_TYPES: ReadonlyArray<EntityType> = Object.freeze([
  'worker',
  'parcel',
  'contract',
  'site',
  'buyer',
  'asset',
  'incident',
  'payroll_entry',
  'certification',
  'shift',
  'inspection',
  'licence',
  'kpi',
  'drill_hole',
  'assay',
  'unknown',
]);

// ---------------------------------------------------------------------------
// Stage 2 — discovery
// ---------------------------------------------------------------------------

export type InferredType =
  | 'string'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum'
  | 'email'
  | 'phone'
  | 'nida'
  | 'tin'
  | 'coordinate'
  | 'url';

export type Cardinality = 'unique' | 'high' | 'low' | 'unknown';

export interface DiscoveredColumn {
  readonly name: string;
  readonly inferred_type: InferredType;
  readonly cardinality: Cardinality;
  /** 0..1 fraction of rows whose value is null/empty. */
  readonly nullability: number;
  readonly enum_values?: ReadonlyArray<string>;
  readonly sample_values: ReadonlyArray<unknown>;
}

export interface DiscoveredSchema {
  readonly source_file: {
    readonly id: string;
    readonly name: string;
    readonly sheet?: string;
  };
  readonly columns: ReadonlyArray<DiscoveredColumn>;
  readonly sample_rows_count: number;
  readonly inferred_entity_type: EntityType;
  readonly inferred_primary_key: string | null;
  /** 0..1 — minimum 0.7 floor to skip a clarifying question. */
  readonly entity_confidence: number;
}

export interface TabularSample {
  readonly source_file: {
    readonly id: string;
    readonly name: string;
    readonly sheet?: string;
  };
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly total_row_count: number;
}

// ---------------------------------------------------------------------------
// Stage 3 — matching
// ---------------------------------------------------------------------------

export type MatchKind =
  | 'exact'
  | 'fuzzy'
  | 'rename_proposed'
  | 'transform_proposed';

export interface TransformSpec {
  readonly kind: 'date_format' | 'currency_normalize' | 'phone_e164' | 'trim' | 'lowercase' | 'uppercase';
  readonly from?: string;
  readonly to?: string;
}

export interface ColumnMapping {
  readonly source_column: string;
  readonly target_field: string;
  readonly match_kind: MatchKind;
  readonly transform?: TransformSpec;
  /** 0..1 confidence in the mapping. */
  readonly confidence: number;
}

export interface JoinCandidate {
  readonly local_field: string;
  readonly foreign_table: string;
  readonly foreign_field: string;
  readonly confidence: number;
}

export interface SchemaMatchResult {
  readonly target_table: { readonly schema: string; readonly table: string };
  readonly column_mappings: ReadonlyArray<ColumnMapping>;
  readonly unmatched_columns: ReadonlyArray<DiscoveredColumn>;
  readonly join_keys_to_other_tables: ReadonlyArray<JoinCandidate>;
}

export interface TenantSchemaCtx {
  readonly tenant_id: string;
  readonly tables: ReadonlyArray<TenantTable>;
}

export interface TenantTable {
  readonly schema: string;
  readonly table: string;
  readonly columns: ReadonlyArray<TenantColumn>;
  readonly entity_type_hint?: EntityType;
}

export interface TenantColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly is_pk: boolean;
  readonly is_unique: boolean;
}

// ---------------------------------------------------------------------------
// Stage 4 — schema evolution proposals
// ---------------------------------------------------------------------------

export type SchemaEvolutionKind =
  | 'add_column'
  | 'add_table'
  | 'add_index'
  | 'add_join_view'
  | 'add_tab'
  | 'modify_column';

export type Reversibility = 'fully' | 'partial' | 'irreversible';

export interface SchemaEvolutionProposal {
  readonly id: string;
  readonly kind: SchemaEvolutionKind;
  /** Raw SQL DDL diff. */
  readonly ddl: string;
  /** Drizzle TypeScript schema delta. */
  readonly drizzle_delta: string;
  readonly migration_filename: string;
  readonly side_effects: ReadonlyArray<string>;
  readonly reversibility: Reversibility;
  /** Schema changes are always Tier 2. */
  readonly authority_tier: 2;
  readonly research_evidence_ids: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Stage 5 — persistence
// ---------------------------------------------------------------------------

export interface Row {
  readonly source_row_number: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface AppliedSchema {
  readonly target_table: { readonly schema: string; readonly table: string };
  readonly column_mappings: ReadonlyArray<ColumnMapping>;
  readonly primary_key_field: string;
}

export type PersistOperation = 'insert' | 'update' | 'skip';

export interface PersistedRow {
  readonly target_row_id: string;
  readonly source_row_number: number;
  readonly operation: PersistOperation;
  readonly audit_hash: string;
}

export interface PersistResult {
  readonly target_table: string;
  readonly rows_inserted: number;
  readonly rows_updated: number;
  readonly rows_skipped: number;
  readonly persisted_rows: ReadonlyArray<PersistedRow>;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Stage 6 — profile chain
// ---------------------------------------------------------------------------

export type ChainCardinality = 'one' | 'many';

export interface AggregateSpec {
  readonly kind: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'latest';
  readonly field?: string;
  readonly label: string;
}

export interface ChainNode {
  readonly entity_type: EntityType;
  readonly table: string;
  readonly join_to_root: {
    readonly local_field: string;
    readonly foreign_field: string;
  };
  readonly cardinality: ChainCardinality;
  readonly aggregates: ReadonlyArray<AggregateSpec>;
}

export interface DetailGroup {
  readonly title: string;
  readonly fields: ReadonlyArray<string>;
}

export interface DrillThrough {
  readonly to_table: string;
  readonly via_field: string;
  readonly label: string;
}

export interface SuggestedTabLayout {
  readonly tab_recipe_id: string;
  readonly list_view_fields: ReadonlyArray<string>;
  readonly detail_view_groups: ReadonlyArray<DetailGroup>;
  readonly drill_through_targets: ReadonlyArray<DrillThrough>;
}

export interface ProfileChainGraph {
  readonly root_entity: EntityType;
  readonly root_table: string;
  readonly chain_nodes: ReadonlyArray<ChainNode>;
  readonly suggested_tab_layout: SuggestedTabLayout;
}

// ---------------------------------------------------------------------------
// Stage 7 — enrichment
// ---------------------------------------------------------------------------

export interface VerificationFinding {
  readonly source: string;
  readonly confirmed: boolean;
  readonly details?: unknown;
}

export interface EnrichedField {
  readonly field: string;
  readonly value: unknown;
  readonly source: string;
  readonly confidence: number;
}

export interface RowEnrichment {
  readonly row_id: string;
  readonly verifications: ReadonlyArray<VerificationFinding>;
  readonly enriched_fields: ReadonlyArray<EnrichedField>;
  readonly flagged_issues: ReadonlyArray<string>;
}

export type EnrichmentQuality = 'high' | 'medium' | 'low';

export interface EnrichmentResult {
  readonly per_row: ReadonlyArray<RowEnrichment>;
  readonly overall_quality: EnrichmentQuality;
  readonly audit_hash: string;
}

export interface EnrichmentCtx {
  readonly tenant_id: string;
  readonly budget_usd_cents: number;
  readonly allowed_adapters: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Recipe contract
// ---------------------------------------------------------------------------

export type RecipeStatus =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

export type AuthorityTier = 0 | 1 | 2;

export interface DataOnboardingRecipe {
  readonly id: string;
  readonly entity_type: EntityType;
  readonly version: number;
  readonly status: RecipeStatus;
  readonly discover: (sample: TabularSample) => Promise<DiscoveredSchema>;
  readonly match: (
    discovered: DiscoveredSchema,
    ctx: TenantSchemaCtx,
  ) => Promise<SchemaMatchResult>;
  readonly propose_evolution: (
    match: SchemaMatchResult,
  ) => Promise<ReadonlyArray<SchemaEvolutionProposal>>;
  readonly persist: (
    rows: ReadonlyArray<Row>,
    approved_schema: AppliedSchema,
  ) => Promise<PersistResult>;
  readonly build_chain: (
    entity_type: EntityType,
    ctx: TenantSchemaCtx,
  ) => Promise<ProfileChainGraph>;
  readonly enrich: (
    rows: ReadonlyArray<PersistedRow>,
    ctx: EnrichmentCtx,
  ) => Promise<EnrichmentResult>;
  readonly authority_tier: AuthorityTier;
  readonly brand: 'borjie';
}

// ---------------------------------------------------------------------------
// Session status (mirrors data_onboarding_sessions.status CHECK)
// ---------------------------------------------------------------------------

export type OnboardingSessionStatus =
  | 'discovering'
  | 'matching'
  | 'proposing'
  | 'awaiting_owner'
  | 'persisting'
  | 'enriching'
  | 'complete'
  | 'failed';

// ---------------------------------------------------------------------------
// Confidence floor — below this, ask the owner instead of guessing.
// ---------------------------------------------------------------------------

export const ENTITY_CONFIDENCE_FLOOR = 0.7;

export const DEFAULT_DISCOVERY_SAMPLE_SIZE = 50;

export const BULK_PERSIST_TIER_2_THRESHOLD = 100;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export type DataOnboardingErrorCode =
  | 'entity_below_confidence_floor'
  | 'unknown_entity_type'
  | 'no_target_table'
  | 'schema_mismatch'
  | 'persist_conflict'
  | 'circular_chain'
  | 'enrichment_budget_exhausted'
  | 'recipe_not_found';

export class DataOnboardingError extends Error {
  public readonly code: DataOnboardingErrorCode;

  constructor(code: DataOnboardingErrorCode, message: string) {
    super(message);
    this.name = 'DataOnboardingError';
    this.code = code;
  }
}
