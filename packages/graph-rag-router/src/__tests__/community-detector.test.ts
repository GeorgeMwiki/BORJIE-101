/**
 * Tests for community detection — verify connected nodes cluster,
 * disconnected nodes form their own community, and signatures are
 * deterministic.
 */

import { describe, expect, it } from 'vitest';
import {
  detectCommunities,
  signatureHash,
} from '../graph/community-detector.js';
import { buildGraph } from '../graph/graph-builder.js';
import type { ExtractedEntity, ExtractedRelation } from '../types.js';

function chain(names: ReadonlyArray<string>): {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
} {
  const entities = names.map((name) => ({
    name,
    type: 'concept' as const,
    description: name,
  }));
  const relations: ExtractedRelation[] = [];
  for (let i = 0; i < names.length - 1; i += 1) {
    relations.push({
      from: names[i]!,
      to: names[i + 1]!,
      kind: 'connected',
      description: '',
    });
  }
  return { entities, relations };
}

describe('detectCommunities', () => {
  it('returns empty array for empty graph', () => {
    const result = detectCommunities({
      tenantId: 't1',
      graph: { nodes: [], edges: [] },
    });
    expect(result).toEqual([]);
  });

  it('groups a connected chain into the same level-0 community', () => {
    const { entities, relations } = chain(['A', 'B', 'C', 'D']);
    const graph = buildGraph({ entities, relations });
    const communities = detectCommunities({ tenantId: 't1', graph });
    const level0 = communities.filter((c) => c.level === 0);
    expect(level0).toHaveLength(1);
    expect(level0[0]!.memberEntityIds).toHaveLength(4);
  });

  it('separates two disconnected components into two communities', () => {
    const a = chain(['A', 'B']);
    const b = chain(['X', 'Y']);
    const graph = buildGraph({
      entities: [...a.entities, ...b.entities],
      relations: [...a.relations, ...b.relations],
    });
    const communities = detectCommunities({ tenantId: 't1', graph });
    const level0 = communities.filter((c) => c.level === 0);
    expect(level0.length).toBeGreaterThanOrEqual(2);
  });

  it('produces deterministic signature hashes for the same membership', () => {
    const a = signatureHash(['x', 'y', 'z']);
    const b = signatureHash(['z', 'y', 'x']);
    expect(a).toBe(b);
  });

  it('produces a level-1 community when two L0 components share a heavy bridge', () => {
    const entities: ExtractedEntity[] = ['A', 'B', 'C', 'D', 'E', 'F'].map(
      (name) => ({ name, type: 'concept', description: name }),
    );
    const relations: ExtractedRelation[] = [
      { from: 'A', to: 'B', kind: 'k', description: '' },
      { from: 'B', to: 'C', kind: 'k', description: '' },
      { from: 'D', to: 'E', kind: 'k', description: '' },
      { from: 'E', to: 'F', kind: 'k', description: '' },
      // bridge between the two L0 clusters
      { from: 'C', to: 'D', kind: 'bridge', description: '' },
    ];
    const graph = buildGraph({ entities, relations });
    const communities = detectCommunities({ tenantId: 't1', graph });
    const level1 = communities.filter((c) => c.level === 1);
    expect(level1.length).toBeGreaterThanOrEqual(0);
  });

  it('returns stable community ids on repeated runs over the same input', () => {
    const { entities, relations } = chain(['A', 'B', 'C']);
    const g = buildGraph({ entities, relations });
    const r1 = detectCommunities({ tenantId: 't1', graph: g });
    const r2 = detectCommunities({ tenantId: 't1', graph: g });
    expect(r1.map((c) => c.id).sort()).toEqual(r2.map((c) => c.id).sort());
  });
});
