/**
 * Buyer onboarding seed recipe.
 *
 * KYB-grade buyer feed — keyed by `buyer_id` / `tin`, mapped onto
 * `buyers`, with a profile chain into `buyer_offers`,
 * `bid_negotiations`, `marketplace_listings`, `contract_signs`,
 * `settlements`.
 *
 * Tier 2 since buyer KYB carries regulatory weight.
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
  const recognition = recognizeEntityType(sample, 'buyer');
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
  const target = ctx.tables.find((t) => t.table === 'buyers');
  if (target === undefined) {
    throw new DataOnboardingError(
      'no_target_table',
      'no `buyers` table found in tenant schema',
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
    migration_slug: 'buyer_onboarding_evolution',
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
    target_table: 'buyers',
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
    root_entity: 'buyer',
    root_table: 'buyers',
    ctx,
  });
}

async function enrichFn(
  rows: ReadonlyArray<PersistedRow>,
  ctx: EnrichmentCtx,
): Promise<EnrichmentResult> {
  // Buyer enrichment is wave-18W work (sanctions, PEP, KYB
  // registries). Scaffold ships a sealed no-op so the contract is
  // exercised end-to-end.
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
        kind: 'buyer_enrichment_noop',
      }),
      secretId: 'data_onboarding_enrichment_v1',
    }),
  });
}

export const buyerOnboardingRecipe: DataOnboardingRecipe = Object.freeze({
  id: 'buyer_onboarding',
  entity_type: 'buyer',
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
