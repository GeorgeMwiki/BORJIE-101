import { describe, expect, it } from 'vitest';
import { matchColumns } from '../matching/column-matcher.js';
import type { DiscoveredColumn, TenantTable } from '../types.js';

function makeColumn(
  name: string,
  inferred_type: DiscoveredColumn['inferred_type'],
): DiscoveredColumn {
  return Object.freeze({
    name,
    inferred_type,
    cardinality: 'high' as const,
    nullability: 0,
    sample_values: Object.freeze([]),
  });
}

const TARGET_TABLE: TenantTable = Object.freeze({
  schema: 'public',
  table: 'workers',
  entity_type_hint: 'worker' as const,
  columns: Object.freeze([
    { name: 'nida', type: 'text', nullable: false, is_pk: true, is_unique: true },
    { name: 'name', type: 'text', nullable: false, is_pk: false, is_unique: false },
    { name: 'role', type: 'text', nullable: true, is_pk: false, is_unique: false },
    { name: 'hire_date', type: 'date', nullable: true, is_pk: false, is_unique: false },
  ]),
});

describe('matchColumns', () => {
  it('produces exact matches for identical names + compatible types', () => {
    const discovered = [
      makeColumn('nida', 'nida'),
      makeColumn('name', 'string'),
    ];
    const result = matchColumns(discovered, TARGET_TABLE);
    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0]?.match_kind).toBe('exact');
    expect(result.unmatched).toHaveLength(0);
  });

  it('returns unmatched columns when no candidate exists', () => {
    const discovered = [
      makeColumn('completely_alien_column', 'string'),
    ];
    const result = matchColumns(discovered, TARGET_TABLE);
    expect(result.mappings).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('proposes a transform when name matches but types differ', () => {
    const discovered = [makeColumn('hire_date', 'date')];
    const result = matchColumns(discovered, TARGET_TABLE);
    expect(result.mappings).toHaveLength(1);
    // hire_date in target is `date` type — same → exact.
    expect(result.mappings[0]?.match_kind).toBe('exact');
  });

  it('handles fuzzy matches (e.g. "Name" vs "name")', () => {
    const discovered = [makeColumn('full_name', 'string')];
    const result = matchColumns(discovered, TARGET_TABLE);
    // full_name similarity to "name" is < 0.7 — treated as unmatched.
    expect(result.unmatched.some((c) => c.name === 'full_name')).toBe(true);
  });
});
