import { describe, expect, it } from 'vitest';
import type { Entity } from '../../types.js';
import { mergeEntities } from '../merge.js';

function entity(
  id: string,
  attrs: Record<string, unknown>,
  updatedAt = '2026-05-01T00:00:00.000Z',
): Entity {
  return {
    id,
    kind: 'tenant',
    tenantId: 't1',
    attributes: attrs,
    updatedAt,
    schemaVersion: 1,
  };
}

describe('mergeEntities — prefer_winner', () => {
  it('keeps winner attrs and adopts loser-only attrs', () => {
    const winner = entity('w', { name: 'Jane', email: 'jane@example.com' });
    const loser = entity('l', {
      name: 'Janet',
      phone: '+254700000000',
      email: 'janet@example.com',
    });
    const proposal = mergeEntities({
      winner,
      losers: [loser],
      strategy: 'prefer_winner',
    });
    expect(proposal.merged.attributes.name).toBe('Jane');
    expect(proposal.merged.attributes.email).toBe('jane@example.com');
    expect(proposal.merged.attributes.phone).toBe('+254700000000');
    expect(proposal.fieldOrigins.phone).toBe('l');
    expect(proposal.fieldOrigins.name).toBe('w');
  });
});

describe('mergeEntities — union', () => {
  it('unions all attributes, first-non-null wins', () => {
    const winner = entity('w', { name: null, email: 'jane@example.com' });
    const loser = entity('l', { name: 'Jane', phone: '+254' });
    const proposal = mergeEntities({
      winner,
      losers: [loser],
      strategy: 'union',
    });
    // winner.name is null so union should NOT pick it
    expect(proposal.merged.attributes.name).toBe('Jane');
    expect(proposal.merged.attributes.email).toBe('jane@example.com');
    expect(proposal.merged.attributes.phone).toBe('+254');
  });
});

describe('mergeEntities — most_recent', () => {
  it('picks the freshest value per attribute', () => {
    const winner = entity(
      'w',
      { name: 'Old', email: 'old@example.com' },
      '2026-01-01T00:00:00.000Z',
    );
    const loser = entity(
      'l',
      { name: 'New', phone: '+254' },
      '2026-04-01T00:00:00.000Z',
    );
    const proposal = mergeEntities({
      winner,
      losers: [loser],
      strategy: 'most_recent',
    });
    expect(proposal.merged.attributes.name).toBe('New');
    expect(proposal.merged.attributes.email).toBe('old@example.com');
    expect(proposal.merged.attributes.phone).toBe('+254');
    expect(proposal.merged.updatedAt).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('mergeEntities — idempotence + key stability', () => {
  it('returns same proposalKey for the same logical input', () => {
    const winner = entity('w', { name: 'Jane' });
    const loserA = entity('a', { phone: '+1' });
    const loserB = entity('b', { phone: '+2' });
    const p1 = mergeEntities({
      winner,
      losers: [loserA, loserB],
      strategy: 'prefer_winner',
    });
    const p2 = mergeEntities({
      winner,
      losers: [loserB, loserA], // shuffled
      strategy: 'prefer_winner',
    });
    expect(p2.proposalKey).toBe(p1.proposalKey);
    expect(p2.merged).toEqual(p1.merged);
  });

  it('changes proposalKey when strategy changes', () => {
    const winner = entity('w', { name: 'Jane' });
    const loser = entity('l', { phone: '+1' });
    const a = mergeEntities({ winner, losers: [loser], strategy: 'union' });
    const b = mergeEntities({
      winner,
      losers: [loser],
      strategy: 'most_recent',
    });
    expect(a.proposalKey).not.toBe(b.proposalKey);
  });

  it('throws for unknown strategy', () => {
    const winner = entity('w', {});
    expect(() =>
      mergeEntities({
        winner,
        losers: [],
        strategy: 'bogus' as unknown as 'union',
      }),
    ).toThrow();
  });
});

describe('mergeEntities — schema versioning', () => {
  it('keeps the highest schemaVersion across inputs', () => {
    const winner: Entity = { ...entity('w', { name: 'Jane' }), schemaVersion: 2 };
    const loser: Entity = { ...entity('l', {}), schemaVersion: 5 };
    const proposal = mergeEntities({
      winner,
      losers: [loser],
      strategy: 'prefer_winner',
    });
    expect(proposal.merged.schemaVersion).toBe(5);
  });
});
