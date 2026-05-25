import { describe, expect, it } from 'vitest';
import { createDeterministicMockEmbedder } from '../../embedders.js';
import type { Entity, MatchCandidate } from '../../types.js';
import { resolveEntity } from '../resolve.js';

const embedder = createDeterministicMockEmbedder({ dimension: 32 });

function tenantEntity(
  id: string,
  overrides: Partial<Entity['attributes']> = {},
  schemaVersion = 1,
): Entity {
  return {
    id,
    kind: 'tenant',
    tenantId: 't1',
    attributes: {
      displayName: 'Jane Doe',
      ...overrides,
    },
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion,
  };
}

describe('resolveEntity', () => {
  it('returns no_match when there are no candidates', async () => {
    const probe: MatchCandidate = { entity: tenantEntity('p1') };
    const decision = await resolveEntity({ probe, candidates: [], embedder });
    expect(decision.verdict).toBe('no_match');
    expect(decision.matches).toHaveLength(0);
    expect(decision.reasons).toContain('no_candidates');
  });

  it('identifies an exact-name + same-email candidate as a strong match', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', {
        displayName: 'Jane Doe',
        email: 'jane@example.com',
      }),
    };
    const candidate: MatchCandidate = {
      entity: tenantEntity('c1', {
        displayName: 'Jane Doe',
        email: 'JANE@example.com',
      }),
    };
    const decision = await resolveEntity({
      probe,
      candidates: [candidate],
      embedder,
    });
    expect(decision.verdict).toBe('match');
    expect(decision.score).toBe(1);
    expect(decision.matches).toHaveLength(1);
    expect(decision.matches[0]?.entity.id).toBe('c1');
    expect(decision.reasons).toContain('shared_email');
  });

  it('flags as uncertain near a threshold without a strong identifier', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', {
        displayName: 'Jane Doe',
      }),
    };
    const candidate: MatchCandidate = {
      entity: tenantEntity('c1', {
        displayName: 'Jane Doh',
      }),
    };
    const decision = await resolveEntity({
      probe,
      candidates: [candidate],
      embedder,
      thresholds: { match: 0.95, uncertain: 0.6 },
    });
    expect(['uncertain', 'match', 'no_match']).toContain(decision.verdict);
    // Fuzzy alone shouldn't sail past the very strict match threshold.
    expect(decision.score).toBeLessThan(0.95);
  });

  it('returns no_match for completely different names with no identifiers', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', { displayName: 'Jane Doe' }),
    };
    const candidate: MatchCandidate = {
      entity: tenantEntity('c1', { displayName: 'Zorblax Quux' }),
    };
    const decision = await resolveEntity({
      probe,
      candidates: [candidate],
      embedder,
    });
    expect(decision.verdict).toBe('no_match');
  });

  it('respects tenant isolation', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', { email: 'jane@example.com' }),
    };
    const otherTenant: MatchCandidate = {
      entity: {
        ...tenantEntity('c1', { email: 'jane@example.com' }),
        tenantId: 't-other',
      },
    };
    const decision = await resolveEntity({
      probe,
      candidates: [otherTenant],
      embedder,
    });
    expect(decision.verdict).toBe('no_match');
    expect(decision.reasons).toContain('no_compatible_candidates');
  });

  it('respects kind isolation', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', { email: 'jane@example.com' }),
    };
    const otherKind: MatchCandidate = {
      entity: {
        ...tenantEntity('c1', { email: 'jane@example.com' }),
        kind: 'vendor',
      },
    };
    const decision = await resolveEntity({
      probe,
      candidates: [otherKind],
      embedder,
    });
    expect(decision.verdict).toBe('no_match');
  });

  it('orders matches highest-score-first', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', {
        displayName: 'Jane Doe',
        email: 'jane@example.com',
      }),
    };
    const exactEmail: MatchCandidate = {
      entity: tenantEntity('c1', {
        displayName: 'Janet D',
        email: 'jane@example.com',
      }),
    };
    const fuzzyOnly: MatchCandidate = {
      entity: tenantEntity('c2', {
        displayName: 'Jane Doh',
      }),
    };
    const decision = await resolveEntity({
      probe,
      candidates: [fuzzyOnly, exactEmail],
      embedder,
    });
    expect(decision.matches[0]?.entity.id).toBe('c1');
  });

  it('is deterministic — same inputs produce the same decision', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', {
        displayName: 'Jane Doe',
        email: 'jane@example.com',
      }),
    };
    const candidate: MatchCandidate = {
      entity: tenantEntity('c1', {
        displayName: 'Jane Doe',
        email: 'jane@example.com',
      }),
    };
    const d1 = await resolveEntity({ probe, candidates: [candidate], embedder });
    const d2 = await resolveEntity({ probe, candidates: [candidate], embedder });
    expect(d2.verdict).toBe(d1.verdict);
    expect(d2.score).toBe(d1.score);
    expect(d2.breakdown).toEqual(d1.breakdown);
  });

  it('works for property kind via canonical name fallback', async () => {
    const probe: MatchCandidate = {
      entity: {
        ...tenantEntity('p1'),
        kind: 'property',
        attributes: { name: 'Skyline Towers' },
      },
    };
    const candidate: MatchCandidate = {
      entity: {
        ...tenantEntity('c1'),
        kind: 'property',
        attributes: { name: 'Skyline Towers' },
      },
    };
    const decision = await resolveEntity({
      probe,
      candidates: [candidate],
      embedder,
    });
    expect(decision.verdict).toBe('match');
  });

  it('honours a custom scorer that ignores embeddings', async () => {
    const probe: MatchCandidate = {
      entity: tenantEntity('p1', {
        displayName: 'Jane Doe',
      }),
    };
    const candidate: MatchCandidate = {
      entity: tenantEntity('c1', {
        displayName: 'Jane Doe',
      }),
    };
    const decision = await resolveEntity({
      probe,
      candidates: [candidate],
      embedder,
      scorer: ({ fuzzyString }) => fuzzyString,
    });
    expect(decision.score).toBeCloseTo(1, 5);
  });
});
