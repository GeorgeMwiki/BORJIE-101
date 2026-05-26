import { describe, expect, it } from 'vitest';
import {
  buildProposals,
  buildAddTableProposal,
} from '../evolution/proposal-builder.js';
import type {
  DiscoveredColumn,
  SchemaMatchResult,
} from '../types.js';

function makeColumn(name: string): DiscoveredColumn {
  return Object.freeze({
    name,
    inferred_type: 'string' as const,
    cardinality: 'high' as const,
    nullability: 0.1,
    sample_values: Object.freeze(['sample1', 'sample2']),
  });
}

const MATCH: SchemaMatchResult = Object.freeze({
  target_table: Object.freeze({ schema: 'public', table: 'workers' }),
  column_mappings: Object.freeze([]),
  unmatched_columns: Object.freeze([
    makeColumn('next_of_kin_phone'),
    makeColumn('blood_type'),
  ]),
  join_keys_to_other_tables: Object.freeze([]),
});

describe('buildProposals', () => {
  it('emits one add_column proposal per unmatched column', () => {
    const proposals = buildProposals({
      match: MATCH,
      highest_existing_migration: 22,
      migration_slug: 'worker_add',
      research_evidence_ids: ['evidence1'],
    });
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.kind === 'add_column')).toBe(true);
    expect(proposals.every((p) => p.authority_tier === 2)).toBe(true);
    expect(proposals.every((p) => p.reversibility === 'fully')).toBe(true);
  });

  it('returns empty when no unmatched columns', () => {
    const result = buildProposals({
      match: Object.freeze({
        ...MATCH,
        unmatched_columns: Object.freeze([]),
      }),
      highest_existing_migration: 22,
      migration_slug: 'x',
      research_evidence_ids: Object.freeze([]),
    });
    expect(result).toHaveLength(0);
  });

  it('encodes evidence ids in proposals', () => {
    const proposals = buildProposals({
      match: MATCH,
      highest_existing_migration: 22,
      migration_slug: 'worker_add',
      research_evidence_ids: ['evidence_X', 'evidence_Y'],
    });
    expect(proposals[0]?.research_evidence_ids).toEqual([
      'evidence_X',
      'evidence_Y',
    ]);
  });
});

describe('buildAddTableProposal', () => {
  it('emits a fully reversible add_table proposal', () => {
    const proposal = buildAddTableProposal({
      table: 'worker_emergency_info',
      columns: [makeColumn('blood_type'), makeColumn('swimming_ability')],
      primary_key: null,
      highest_existing_migration: 22,
      migration_slug: 'add_worker_emergency_info',
      research_evidence_ids: [],
    });
    expect(proposal.kind).toBe('add_table');
    expect(proposal.reversibility).toBe('fully');
    expect(proposal.ddl).toContain('CREATE TABLE');
    expect(proposal.migration_filename).toMatch(/^\d{4}_/);
  });
});
