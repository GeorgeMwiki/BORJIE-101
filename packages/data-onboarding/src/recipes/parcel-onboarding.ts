/**
 * Parcel onboarding seed recipe.
 *
 * Mining-domain parcels — keyed by `parcel_id` / `lot_id`, mapped onto
 * `ore_parcels`, with a profile chain into `drill_holes`, `assays`,
 * `buyer_offers`, `marketplace_listings`, `contract_signs`,
 * `settlements`.
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
import type {
  DataOnboardingRecipe,
  DiscoveredSchema,
  EnrichmentCtx,
  EnrichmentResult,
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
import { hashChainEntry } from '@borjie/audit-hash-chain';

async function discoverFn(sample: TabularSample): Promise<DiscoveredSchema> {
  const sampled = sampleTable(sample);
  const recognition = recognizeEntityType(sample, 'parcels');
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
  const target = ctx.tables.find((t) => t.table === 'ore_parcels');
  if (target === undefined) {
    throw new DataOnboardingError(
      'no_target_table',
      'no `ore_parcels` table found in tenant schema',
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
    migration_slug: 'parcel_onboarding_evolution',
    research_evidence_ids: Object.freeze([]),
  });
}

async function persistFn(
  rows: ReadonlyArray<Row>,
  _approved_schema: AppliedSchema,
): Promise<PersistResult> {
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
    target_table: 'ore_parcels',
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
    root_entity: 'parcel',
    root_table: 'ore_parcels',
    ctx,
  });
}

async function enrichFn(
  rows: ReadonlyArray<PersistedRow>,
  ctx: EnrichmentCtx,
): Promise<EnrichmentResult> {
  // Parcels enrichment is currently no-op: rows are confirmed by
  // upstream geology systems. Audit-hash so the seal is queryable.
  return Object.freeze({
    per_row: Object.freeze(
      rows.map((r) =>
        Object.freeze({
          row_id: r.target_row_id,
          verifications: Object.freeze([]),
          enriched_fields: Object.freeze([]),
          flagged_issues: Object.freeze([]),
        }),
      ),
    ),
    overall_quality: 'low' as const,
    audit_hash: hashChainEntry({
      payload: Object.freeze({
        tenant_id: ctx.tenant_id,
        rows_count: rows.length,
        kind: 'parcel_enrichment_noop',
      }),
      secretId: 'data_onboarding_enrichment_v1',
    }),
  });
}

export const parcelOnboardingRecipe: DataOnboardingRecipe = Object.freeze({
  id: 'parcel_onboarding',
  entity_type: 'parcel',
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
