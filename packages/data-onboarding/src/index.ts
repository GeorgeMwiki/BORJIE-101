/**
 * `@borjie/data-onboarding` — public surface (Wave 18U).
 *
 * 7-stage capability for placing owner-uploaded data where it belongs:
 *
 *   S1  Intent + entity recognition           — intent/entity-recognizer
 *   S2  Schema discovery                      — discovery/*
 *   S3  Existing-schema matching              — matching/*
 *   S4  Schema evolution proposals (Tier 2)   — evolution/*
 *   S5  Row persistence (with provenance)     — persistence/*
 *   S6  Profile-chain graph                   — profile-chain/*
 *   S7  Deep online research enrichment       — enrichment/*
 *
 * Implements `Docs/DESIGN/DATA_ONBOARDING_SPEC.md`.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  AggregateSpec,
  AppliedSchema,
  AuthorityTier,
  Cardinality,
  ChainCardinality,
  ChainNode,
  ColumnMapping,
  DataOnboardingErrorCode,
  DataOnboardingRecipe,
  DetailGroup,
  DiscoveredColumn,
  DiscoveredSchema,
  DrillThrough,
  EnrichedField,
  EnrichmentCtx,
  EnrichmentQuality,
  EnrichmentResult,
  EntityType,
  InferredType,
  JoinCandidate,
  MatchKind,
  OnboardingSessionStatus,
  PersistOperation,
  PersistResult,
  PersistedRow,
  ProfileChainGraph,
  RecipeStatus,
  Reversibility,
  Row,
  RowEnrichment,
  SchemaEvolutionKind,
  SchemaEvolutionProposal,
  SchemaMatchResult,
  SuggestedTabLayout,
  TabularSample,
  TenantColumn,
  TenantSchemaCtx,
  TenantTable,
  TransformSpec,
  VerificationFinding,
} from './types.js';

export {
  ALL_ENTITY_TYPES,
  BULK_PERSIST_TIER_2_THRESHOLD,
  DEFAULT_DISCOVERY_SAMPLE_SIZE,
  DataOnboardingError,
  ENTITY_CONFIDENCE_FLOOR,
} from './types.js';

// ── Stage 1 — intent / entity recognition ────────────────────────────
export { recognizeEntityType } from './intent/entity-recognizer.js';

// ── Stage 2 — discovery ──────────────────────────────────────────────
export {
  sampleTable,
  columnValues,
  type SampledTable,
} from './discovery/tabular-sampler.js';
export { inferColumn } from './discovery/column-type-inferer.js';
export { detectPrimaryKey } from './discovery/primary-key-detector.js';

// ── Stage 3 — matching ───────────────────────────────────────────────
export {
  createStaticTenantSchemaLoader,
  type TenantSchemaLoader,
} from './matching/existing-schema-loader.js';
export {
  matchColumns,
  type ColumnMatchOutcome,
} from './matching/column-matcher.js';
export { findJoinCandidates } from './matching/join-candidate-finder.js';

// ── Stage 4 — evolution ──────────────────────────────────────────────
export {
  buildAddColumnDdl,
  buildAddTableDdl,
  buildAddIndexDdl,
  buildModifyColumnDdl,
} from './evolution/ddl-builder.js';
export {
  buildAddColumnDelta,
  buildAddTableDelta,
} from './evolution/drizzle-delta-builder.js';
export {
  nextMigrationFilename,
  isValidMigrationFilename,
} from './evolution/migration-writer.js';
export {
  buildProposals,
  buildAddTableProposal,
  buildAddIndexProposal,
  buildModifyColumnProposal,
  type ProposalBuilderArgs,
} from './evolution/proposal-builder.js';
export {
  buildHandoff,
  createInMemoryTier2Dispatcher,
  type MutationAuthorityHandoff,
  type Tier2Dispatcher,
} from './evolution/tier2-gate.js';

// ── Stage 5 — persistence ────────────────────────────────────────────
export {
  buildDiff,
  type DiffPreview,
  type ExistingRowSnapshot,
  type RowDiffEntry,
} from './persistence/diff-builder.js';
export {
  createInMemoryProvenanceWriter,
  type ProvenanceEntry,
  type ProvenanceWriter,
} from './persistence/row-provenance-writer.js';
export {
  persistRows,
  createInMemoryRowWriter,
  type PersistArgs,
  type RowWriter,
} from './persistence/row-persister.js';

// ── Stage 6 — profile chain ──────────────────────────────────────────
export { buildChainGraph } from './profile-chain/chain-graph-builder.js';
export { extractTabLayout } from './profile-chain/tab-layout-suggester.js';
export {
  buildComposeTabHandoff,
  createInMemoryComposeTabDispatcher,
  type ComposeTabDispatcher,
  type ComposeTabHandoff,
} from './profile-chain/compose-tab-dispatcher.js';

// ── Stage 7 — enrichment ─────────────────────────────────────────────
export {
  enrichRows,
  type EnrichmentAdapters,
  type RowInputForEnrichment,
} from './enrichment/enrichment-orchestrator.js';
export {
  createInMemoryNidaVerifier,
  type NidaVerifier,
  type NidaLookupResult,
} from './enrichment/adapters/nida-verifier.js';
export {
  createInMemoryNssfVerifier,
  type NssfVerifier,
} from './enrichment/adapters/nssf-verifier.js';
export {
  createInMemoryLinkedinVerifier,
  type LinkedinVerifier,
} from './enrichment/adapters/linkedin-verifier.js';
export {
  createInMemoryCertVerifier,
  type CertVerifier,
} from './enrichment/adapters/cert-verifier.js';
export {
  createInMemorySalaryBenchmarker,
  type SalaryBenchmarker,
} from './enrichment/adapters/salary-benchmark.js';

// ── Audit ────────────────────────────────────────────────────────────
export {
  sealAuditEvent,
  type DataOnboardingAuditScope,
} from './audit/audit-chain-link.js';

// ── Recipes ──────────────────────────────────────────────────────────
export { workerOnboardingRecipe } from './recipes/worker-onboarding.js';
export { parcelOnboardingRecipe } from './recipes/parcel-onboarding.js';
export { buyerOnboardingRecipe } from './recipes/buyer-onboarding.js';
export {
  BUILT_IN_RECIPES,
  DataOnboardingRecipeRegistry,
} from './recipes/registry.js';
