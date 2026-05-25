import { describe, expect, it } from 'vitest';
import { InMemoryEntityResolver, stringSimilarity } from '../in-memory-adapters.js';
import { resolveEntities } from '../resolve/index.js';
import type { ExtractedField } from '../extract/entity-extractor.js';

function field(key: string, value: string): ExtractedField {
  return {
    key,
    value,
    confidence: 0.9,
    extractionKind: 'entity',
    sourceMethod: 'rule',
    page: null,
    bbox: null,
    matchedText: value,
  };
}

describe('stringSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(stringSimilarity('asha mwangi', 'asha mwangi')).toBe(1);
  });

  it('high for tokens-out-of-order', () => {
    expect(stringSimilarity('asha mwangi', 'mwangi asha')).toBeGreaterThan(0.6);
  });

  it('high for typos', () => {
    expect(stringSimilarity('asha mwangi', 'asha mwanji')).toBeGreaterThan(0.7);
  });

  it('low for unrelated', () => {
    expect(stringSimilarity('asha mwangi', 'patricia mwafula')).toBeLessThan(0.6);
  });
});

describe('resolveEntities — exact + fuzzy', () => {
  it('resolves an exact name match', async () => {
    const resolver = new InMemoryEntityResolver();
    resolver.seed('tenant-a', [
      { entityId: 'lessee-001', displayName: 'Asha Mwangi' },
      { entityId: 'lessee-002', displayName: 'Patricia Mwafula' },
    ]);
    const out = await resolveEntities(
      'tenant-a',
      [
        {
          extraction: field('applicant_name', 'Asha Mwangi'),
          queryText: 'Asha Mwangi',
        },
      ],
      resolver,
    );
    expect(out[0]?.resolvedEntityId).toBe('lessee-001');
    expect(out[0]?.resolutionMethod).toBe('exact_match');
    expect(out[0]?.resolutionConfidence).toBe(1);
  });

  it('resolves a fuzzy match (case + typo)', async () => {
    const resolver = new InMemoryEntityResolver();
    resolver.seed('tenant-a', [
      { entityId: 'lessee-001', displayName: 'Asha Mwangi' },
    ]);
    const out = await resolveEntities(
      'tenant-a',
      [
        {
          extraction: field('applicant_name', 'asha mwanji'),
          queryText: 'asha mwanji',
        },
      ],
      resolver,
    );
    expect(out[0]?.resolvedEntityId).toBe('lessee-001');
    expect(out[0]?.resolutionMethod).toBe('fuzzy');
    expect(out[0]?.resolutionConfidence).toBeGreaterThan(0.75);
  });

  it('flags HITL when nobody matches well', async () => {
    const resolver = new InMemoryEntityResolver();
    resolver.seed('tenant-a', [
      { entityId: 'lessee-001', displayName: 'Joseph Kibwana' },
    ]);
    const out = await resolveEntities(
      'tenant-a',
      [
        {
          extraction: field('applicant_name', 'Asha Mwangi'),
          queryText: 'Asha Mwangi',
        },
      ],
      resolver,
    );
    expect(out[0]?.hitlStatus).toBe('pending');
  });

  it('handles empty pool gracefully', async () => {
    const resolver = new InMemoryEntityResolver();
    const out = await resolveEntities(
      'tenant-a',
      [
        {
          extraction: field('applicant_name', 'Asha Mwangi'),
          queryText: 'Asha Mwangi',
        },
      ],
      resolver,
    );
    expect(out[0]?.resolvedEntityId).toBeNull();
    expect(out[0]?.resolutionConfidence).toBe(0);
  });

  it('skips empty query', async () => {
    const resolver = new InMemoryEntityResolver();
    const out = await resolveEntities(
      'tenant-a',
      [
        {
          extraction: field('applicant_name', ''),
          queryText: '   ',
        },
      ],
      resolver,
    );
    expect(out[0]?.resolutionConfidence).toBe(0);
  });

  it('keeps tenants isolated', async () => {
    const resolver = new InMemoryEntityResolver();
    resolver.seed('tenant-a', [
      { entityId: 'lessee-001', displayName: 'Asha Mwangi' },
    ]);
    // tenant-b: nothing seeded.
    const out = await resolveEntities(
      'tenant-b',
      [
        {
          extraction: field('applicant_name', 'Asha Mwangi'),
          queryText: 'Asha Mwangi',
        },
      ],
      resolver,
    );
    expect(out[0]?.resolvedEntityId).toBeNull();
  });
});
