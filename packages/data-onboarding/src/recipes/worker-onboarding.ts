/**
 * Worker onboarding seed recipe.
 *
 * Implements the `DataOnboardingRecipe` contract for the canonical
 * worker-feed use case: a spreadsheet of mining workers keyed by
 * NIDA, mapped onto the `workers` table, with a profile chain into
 * `shift_assignments`, `incidents`, `certifications`,
 * `payroll_entries`, `safety_inspections`.
 *
 * Status: `live`. Stage-5 persistence is supplied by the runtime via
 * the `createWorkerOnboardingRecipe(deps)` factory (a Drizzle-backed
 * `RowWriter` + `ProvenanceWriter` bound in the api-gateway composition
 * root). The default singleton export fails closed on `persist` — it
 * never fabricates placeholder rows.
 */

import { recognizeEntityType } from '../intent/entity-recognizer.js';
import {
  sampleTable,
  columnValues,
} from '../discovery/tabular-sampler.js';
import { inferColumn } from '../discovery/column-type-inferer.js';
import { detectPrimaryKey } from '../discovery/primary-key-detector.js';
import { matchColumns } from '../matching/column-matcher.js';
import { findJoinCandidates } from '../matching/join-candidate-finder.js';
import { buildProposals } from '../evolution/proposal-builder.js';
import { buildChainGraph } from '../profile-chain/chain-graph-builder.js';
import {
  enrichRows,
  type EnrichmentAdapters,
} from '../enrichment/enrichment-orchestrator.js';
import { createInMemoryNidaVerifier } from '../enrichment/adapters/nida-verifier.js';
import { createInMemoryNssfVerifier } from '../enrichment/adapters/nssf-verifier.js';
import { createInMemoryLinkedinVerifier } from '../enrichment/adapters/linkedin-verifier.js';
import { createInMemoryCertVerifier } from '../enrichment/adapters/cert-verifier.js';
import { createInMemorySalaryBenchmarker } from '../enrichment/adapters/salary-benchmark.js';
import { buildPersistFn, type RecipePersistDeps } from './persist-fn.js';
import type {
  DataOnboardingRecipe,
  DiscoveredSchema,
  EnrichmentResult,
  EnrichmentCtx,
  ProfileChainGraph,
  SchemaEvolutionProposal,
  SchemaMatchResult,
  TabularSample,
  TenantSchemaCtx,
  EntityType,
  PersistedRow,
} from '../types.js';
import { DataOnboardingError } from '../types.js';

const ADAPTERS: EnrichmentAdapters = Object.freeze({
  nida: createInMemoryNidaVerifier(),
  nssf: createInMemoryNssfVerifier(),
  linkedin: createInMemoryLinkedinVerifier(),
  cert: createInMemoryCertVerifier(),
  salary: createInMemorySalaryBenchmarker(),
});

async function discoverFn(sample: TabularSample): Promise<DiscoveredSchema> {
  const sampled = sampleTable(sample);
  const recognition = recognizeEntityType(sample, 'employees');
  const columns = sampled.headers.map((header, idx) =>
    inferColumn({ name: header, values: columnValues(sampled, idx) }),
  );
  const primary_key = detectPrimaryKey(columns);
  return Object.freeze({
    source_file: sampled.source_file,
    columns: Object.freeze(columns),
    sample_rows_count: sampled.sample_rows_count,
    inferred_entity_type: recognition.inferred_entity_type,
    inferred_primary_key: primary_key,
    entity_confidence: recognition.entity_confidence,
  });
}

async function matchFn(
  discovered: DiscoveredSchema,
  ctx: TenantSchemaCtx,
): Promise<SchemaMatchResult> {
  const target = ctx.tables.find((t) => t.table === 'workers');
  if (target === undefined) {
    throw new DataOnboardingError(
      'no_target_table',
      'no `workers` table found in tenant schema',
    );
  }
  const matched = matchColumns(discovered.columns, target);
  const joins = findJoinCandidates(discovered.columns, ctx.tables);
  return Object.freeze({
    target_table: Object.freeze({ schema: target.schema, table: target.table }),
    column_mappings: matched.mappings,
    unmatched_columns: matched.unmatched,
    join_keys_to_other_tables: joins,
  });
}

async function proposeEvolutionFn(
  match: SchemaMatchResult,
): Promise<ReadonlyArray<SchemaEvolutionProposal>> {
  return buildProposals({
    match,
    highest_existing_migration: 22,
    migration_slug: 'worker_onboarding_evolution',
    research_evidence_ids: Object.freeze([]),
  });
}

async function buildChainFn(
  _entity_type: EntityType,
  ctx: TenantSchemaCtx,
): Promise<ProfileChainGraph> {
  return buildChainGraph({
    root_entity: 'worker',
    root_table: 'workers',
    ctx,
  });
}

async function enrichFn(
  rows: ReadonlyArray<PersistedRow>,
  ctx: EnrichmentCtx,
): Promise<EnrichmentResult> {
  return enrichRows(
    rows.map((r) => Object.freeze({ row: r })),
    ADAPTERS,
    ctx,
  );
}

/**
 * Build a worker-onboarding recipe.
 *
 * @param deps  runtime persistence ports (Drizzle-backed `RowWriter` +
 *              `ProvenanceWriter` bound per onboarding session). Omit
 *              for the fail-closed default singleton used by tests +
 *              the registry.
 */
export function createWorkerOnboardingRecipe(
  deps?: RecipePersistDeps,
): DataOnboardingRecipe {
  return Object.freeze({
    id: 'worker_onboarding',
    entity_type: 'worker',
    version: 1,
    status: 'live',
    discover: discoverFn,
    match: matchFn,
    propose_evolution: proposeEvolutionFn,
    persist: buildPersistFn('worker_onboarding', deps),
    build_chain: buildChainFn,
    enrich: enrichFn,
    authority_tier: 2,
    brand: 'borjie',
  });
}

/**
 * Default singleton — `live` but fail-closed on `persist` until a
 * `RowWriter` is injected via {@link createWorkerOnboardingRecipe}.
 */
export const workerOnboardingRecipe: DataOnboardingRecipe =
  createWorkerOnboardingRecipe();
