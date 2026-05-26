/**
 * Worker onboarding seed recipe.
 *
 * Implements the `DataOnboardingRecipe` contract for the canonical
 * worker-feed use case: a spreadsheet of mining workers keyed by
 * NIDA, mapped onto the `workers` table, with a profile chain into
 * `shift_assignments`, `incidents`, `certifications`,
 * `payroll_entries`, `safety_inspections`.
 *
 * Status: `shadow` at scaffold time. Promoted to `live` after the
 * first owner-led test session.
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
import type {
  DataOnboardingRecipe,
  DiscoveredSchema,
  EnrichmentResult,
  EnrichmentCtx,
  PersistResult,
  PersistedRow,
  ProfileChainGraph,
  SchemaEvolutionProposal,
  SchemaMatchResult,
  TabularSample,
  TenantSchemaCtx,
  EntityType,
  Row,
  AppliedSchema,
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

async function persistFn(
  rows: ReadonlyArray<Row>,
  _approved_schema: AppliedSchema,
): Promise<PersistResult> {
  // Persistence requires runtime-injected RowWriter + ProvenanceWriter;
  // the seed recipe ships a stub PersistResult so the contract is
  // exercised end-to-end in tests. Production wiring overrides.
  const persisted_rows: ReadonlyArray<PersistedRow> = Object.freeze(
    rows.map((r, i) =>
      Object.freeze({
        target_row_id: `stub_${i}`,
        source_row_number: r.source_row_number,
        operation: 'insert' as const,
        audit_hash: '',
      }),
    ),
  );
  return Object.freeze({
    target_table: 'workers',
    rows_inserted: rows.length,
    rows_updated: 0,
    rows_skipped: 0,
    persisted_rows,
    audit_hash: '',
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

export const workerOnboardingRecipe: DataOnboardingRecipe = Object.freeze({
  id: 'worker_onboarding',
  entity_type: 'worker',
  version: 1,
  status: 'shadow',
  discover: discoverFn,
  match: matchFn,
  propose_evolution: proposeEvolutionFn,
  persist: persistFn,
  build_chain: buildChainFn,
  enrich: enrichFn,
  authority_tier: 2,
  brand: 'borjie',
});
