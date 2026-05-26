/**
 * Tests for the in-memory repositories — verify tenant isolation,
 * upsert semantics, and the audit-hash helpers.
 */

import { describe, expect, it } from 'vitest';
import { buildGraph, entityIdFromName } from '../graph/graph-builder.js';
import { filterRelations, extractRelations } from '../extraction/relation-extractor.js';
import { createInMemoryEntityRepository, seedInMemoryEntities } from '../storage/entity-repository.js';
import { createInMemoryRelationRepository } from '../storage/relation-repository.js';
import { createInMemoryCommunityRepository } from '../storage/community-repository.js';
import {
  hashCommunityRow,
  hashEntityRow,
  hashRelationRow,
  hashSummaryRow,
} from '../audit/audit-chain-link.js';
import type { Community, CommunitySummary, ExtractedEntity } from '../types.js';

describe('entity repository', () => {
  it('isolates tenants', async () => {
    const repo = createInMemoryEntityRepository();
    await repo.upsert({ tenantId: 't1', entity: { name: 'X', type: 'concept', description: 'a' } });
    await repo.upsert({ tenantId: 't2', entity: { name: 'Y', type: 'concept', description: 'a' } });
    expect((await repo.list('t1'))).toHaveLength(1);
    expect((await repo.list('t2'))).toHaveLength(1);
    expect((await repo.list('t3'))).toHaveLength(0);
  });

  it('keeps the longer description on upsert', async () => {
    const repo = createInMemoryEntityRepository();
    await repo.upsert({ tenantId: 't1', entity: { name: 'X', type: 'concept', description: 'long-description' } });
    await repo.upsert({ tenantId: 't1', entity: { name: 'X', type: 'concept', description: 'short' } });
    const list = await repo.list('t1');
    expect(list[0]!.description).toBe('long-description');
  });
});

describe('seedInMemoryEntities', () => {
  it('bulk-loads a batch', async () => {
    const repo = createInMemoryEntityRepository();
    const batch: ExtractedEntity[] = [
      { name: 'A', type: 'concept', description: 'a' },
      { name: 'B', type: 'concept', description: 'b' },
    ];
    const out = await seedInMemoryEntities(repo, 't1', batch);
    expect(out).toHaveLength(2);
    expect((await repo.list('t1'))).toHaveLength(2);
  });
});

describe('relation repository', () => {
  it('increments weight on duplicate upsert', async () => {
    const repo = createInMemoryRelationRepository();
    const fromId = entityIdFromName('A');
    const toId = entityIdFromName('B');
    await repo.upsert({
      tenantId: 't1',
      fromId,
      toId,
      relation: { from: 'A', to: 'B', kind: 'k', description: '' },
    });
    await repo.upsert({
      tenantId: 't1',
      fromId,
      toId,
      relation: { from: 'A', to: 'B', kind: 'k', description: '' },
    });
    const list = await repo.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0]!.weight).toBe(2);
  });

  it('returns empty list for an unknown tenant', async () => {
    const repo = createInMemoryRelationRepository();
    expect(await repo.list('unknown')).toEqual([]);
  });
});

describe('community repository', () => {
  it('upserts and lists communities, then retrieves the latest summary', async () => {
    const repo = createInMemoryCommunityRepository();
    const community: Community = {
      id: 'c1',
      level: 0,
      parentCommunityId: null,
      memberEntityIds: ['n1'],
      signatureHash: 'sig',
    };
    await repo.upsertCommunity({ tenantId: 't1', community });
    const list = await repo.listCommunities('t1');
    expect(list).toHaveLength(1);
    expect(await repo.getLatestSummary({ tenantId: 't1', communityId: 'c1' })).toBeNull();
    const summary: CommunitySummary = {
      id: 's1',
      communityId: 'c1',
      summaryMd: 'x',
      tokenCount: 1,
      modelId: 'm',
      signatureHash: 'sig',
      generatedAt: '2026-05-26T00:00:00.000Z',
    };
    await repo.upsertSummary({ tenantId: 't1', summary });
    expect(
      (await repo.getLatestSummary({ tenantId: 't1', communityId: 'c1' }))!.id,
    ).toBe('s1');
  });

  it('listCommunities returns empty for unknown tenants', async () => {
    const repo = createInMemoryCommunityRepository();
    expect(await repo.listCommunities('nope')).toEqual([]);
    expect(
      await repo.getLatestSummary({ tenantId: 'nope', communityId: 'c1' }),
    ).toBeNull();
  });
});

describe('audit hash helpers', () => {
  it('produces deterministic hashes for the same payload', () => {
    const graph = buildGraph({
      entities: [{ name: 'A', type: 'concept', description: 'd' }],
      relations: [],
    });
    const node = graph.nodes[0]!;
    expect(hashEntityRow({ tenantId: 't1', entity: node })).toBe(
      hashEntityRow({ tenantId: 't1', entity: node }),
    );
  });

  it('hashes change when tenantId changes', () => {
    const graph = buildGraph({
      entities: [{ name: 'A', type: 'concept', description: 'd' }],
      relations: [],
    });
    const node = graph.nodes[0]!;
    expect(hashEntityRow({ tenantId: 't1', entity: node })).not.toBe(
      hashEntityRow({ tenantId: 't2', entity: node }),
    );
  });

  it('all four hash helpers produce non-empty strings', () => {
    const graph = buildGraph({
      entities: [
        { name: 'A', type: 'concept', description: 'd' },
        { name: 'B', type: 'concept', description: 'd' },
      ],
      relations: [{ from: 'A', to: 'B', kind: 'k', description: '' }],
    });
    const community: Community = {
      id: 'c',
      level: 0,
      parentCommunityId: null,
      memberEntityIds: ['x'],
      signatureHash: 's',
    };
    const summary: CommunitySummary = {
      id: 's',
      communityId: 'c',
      summaryMd: 'm',
      tokenCount: 1,
      modelId: 'mid',
      signatureHash: 's',
      generatedAt: 'now',
    };
    expect(hashEntityRow({ tenantId: 't', entity: graph.nodes[0]! }).length).toBeGreaterThan(0);
    expect(hashRelationRow({ tenantId: 't', edge: graph.edges[0]! }).length).toBeGreaterThan(0);
    expect(hashCommunityRow({ tenantId: 't', community }).length).toBeGreaterThan(0);
    expect(hashSummaryRow({ tenantId: 't', summary }).length).toBeGreaterThan(0);
  });
});

describe('filterRelations', () => {
  it('drops relations whose endpoints are not in the entity set', () => {
    const entities: ExtractedEntity[] = [
      { name: 'A', type: 'concept', description: '' },
      { name: 'B', type: 'concept', description: '' },
    ];
    const out = filterRelations({
      entities,
      relations: [
        { from: 'A', to: 'B', kind: 'k', description: '' },
        { from: 'A', to: 'GHOST', kind: 'k', description: '' },
        { from: 'A', to: 'A', kind: 'self', description: '' },
        { from: 'A', to: 'B', kind: 'k', description: '' }, // duplicate
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.from).toBe('A');
  });
});

describe('extractRelations', () => {
  it('returns [] when fewer than two entities', async () => {
    const out = await extractRelations({
      port: { async extract() { return []; } },
      text: 'text',
      entities: [{ name: 'Alone', type: 'concept', description: '' }],
    });
    expect(out).toEqual([]);
  });

  it('returns [] for empty text', async () => {
    const out = await extractRelations({
      port: { async extract() { return []; } },
      text: '   ',
      entities: [
        { name: 'A', type: 'concept', description: '' },
        { name: 'B', type: 'concept', description: '' },
      ],
    });
    expect(out).toEqual([]);
  });

  it('forwards to port and filters results', async () => {
    const out = await extractRelations({
      port: {
        async extract() {
          return [
            { from: 'A', to: 'B', kind: 'k', description: '' },
            { from: 'A', to: 'GHOST', kind: 'k', description: '' },
          ];
        },
      },
      text: 'real text',
      entities: [
        { name: 'A', type: 'concept', description: '' },
        { name: 'B', type: 'concept', description: '' },
      ],
    });
    expect(out).toHaveLength(1);
  });
});

describe('buildGraph', () => {
  it('accumulates over a seed graph', () => {
    const first = buildGraph({
      entities: [{ name: 'A', type: 'concept', description: 'a' }],
      relations: [],
    });
    const second = buildGraph({
      entities: [{ name: 'B', type: 'concept', description: 'b' }],
      relations: [],
      seed: first,
    });
    expect(second.nodes.map((n) => n.name).sort()).toEqual(['A', 'B']);
  });

  it('upgrades node description when the new one is longer', () => {
    const g = buildGraph({
      entities: [
        { name: 'A', type: 'concept', description: 'short' },
        { name: 'A', type: 'concept', description: 'a-much-longer-description' },
      ],
      relations: [],
    });
    expect(g.nodes[0]!.description).toBe('a-much-longer-description');
  });

  it('ignores edges referencing unknown entities', () => {
    const g = buildGraph({
      entities: [
        { name: 'A', type: 'concept', description: '' },
        { name: 'B', type: 'concept', description: '' },
      ],
      relations: [
        { from: 'A', to: 'B', kind: 'k', description: '' },
        { from: 'A', to: 'GHOST', kind: 'k', description: '' },
      ],
    });
    expect(g.edges).toHaveLength(1);
  });

  it('increments edge weight on duplicates', () => {
    const g = buildGraph({
      entities: [
        { name: 'A', type: 'concept', description: '' },
        { name: 'B', type: 'concept', description: '' },
      ],
      relations: [
        { from: 'A', to: 'B', kind: 'k', description: '' },
        { from: 'A', to: 'B', kind: 'k', description: '' },
        { from: 'A', to: 'B', kind: 'k', description: '' },
      ],
    });
    expect(g.edges[0]!.weight).toBe(3);
  });
});
