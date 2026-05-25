import { describe, expect, it } from 'vitest';
import { createInMemoryEpisodicStore } from '../episodic/store-inmemory.js';
import type { Episode, EpisodeFact } from '../types.js';

const TENANT = 'tenant-1';

function buildEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    tenantId: TENANT,
    userId: 'user-1',
    surface: 'owner_portal',
    subject: 'property:123',
    title: 'Tenant inquiry',
    summary: 'Tenant asked about lease renewal terms.',
    validFrom: '2026-05-20T10:00:00.000Z',
    validTo: '2026-05-20T11:00:00.000Z',
    recordedAt: new Date().toISOString(),
    embedding: [0.1, 0.2, 0.3, 0.4],
    tags: ['lease', 'renewal'],
    ...overrides,
  };
}

describe('episodic store — upsert + retrieval', () => {
  it('upserts an episode and returns it unchanged', async () => {
    const store = createInMemoryEpisodicStore();
    const ep = buildEpisode();
    const out = await store.upsertEpisode(ep);
    expect(out.id).toBe('ep-1');
    expect(out.tenantId).toBe(TENANT);
  });

  it('records bi-temporal facts attached to an episode', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(buildEpisode());
    const fact: EpisodeFact = {
      id: 'fact-1',
      episodeId: 'ep-1',
      subject: 'tenant:abc',
      predicate: 'requested',
      object: 'lease_renewal',
      confidence: 0.9,
      validFrom: '2026-05-20T10:00:00.000Z',
      validTo: null,
      recordedAt: new Date().toISOString(),
    };
    await store.recordFact(fact);
    const facts = await store.listFactsForEpisode('ep-1');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.predicate).toBe('requested');
  });

  it('isolates by tenantId on retrieval', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(buildEpisode());
    await store.upsertEpisode(
      buildEpisode({ id: 'ep-2', tenantId: 'tenant-other' }),
    );
    const results = await store.retrieveByRelevance({ tenantId: TENANT });
    expect(results).toHaveLength(1);
    expect(results[0]?.episode.id).toBe('ep-1');
  });

  it('filters by userId when provided', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(buildEpisode({ id: 'ep-1', userId: 'a' }));
    await store.upsertEpisode(buildEpisode({ id: 'ep-2', userId: 'b' }));
    const results = await store.retrieveByRelevance({
      tenantId: TENANT,
      userId: 'a',
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.episode.userId).toBe('a');
  });

  it('filters by surface when provided', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(buildEpisode({ id: 'ep-1', surface: 'owner_portal' }));
    await store.upsertEpisode(
      buildEpisode({ id: 'ep-2', surface: 'tenant_chat' }),
    );
    const results = await store.retrieveByRelevance({
      tenantId: TENANT,
      surface: 'tenant_chat',
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.episode.surface).toBe('tenant_chat');
  });

  it('filters by validity window (validAt)', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(
      buildEpisode({
        id: 'past',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-01-31T00:00:00.000Z',
      }),
    );
    await store.upsertEpisode(
      buildEpisode({
        id: 'current',
        validFrom: '2026-05-01T00:00:00.000Z',
        validTo: null,
      }),
    );
    const past = await store.retrieveByRelevance({
      tenantId: TENANT,
      validAt: '2026-01-15T00:00:00.000Z',
    });
    expect(past.map((r) => r.episode.id)).toEqual(['past']);
    const current = await store.retrieveByRelevance({
      tenantId: TENANT,
      validAt: '2026-05-15T00:00:00.000Z',
    });
    expect(current.map((r) => r.episode.id)).toEqual(['current']);
  });

  it('scores higher for embedding similarity', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(
      buildEpisode({ id: 'close', embedding: [1, 0, 0, 0] }),
    );
    await store.upsertEpisode(
      buildEpisode({ id: 'far', embedding: [0, 1, 0, 0] }),
    );
    const results = await store.retrieveByRelevance({
      tenantId: TENANT,
      queryEmbedding: [1, 0, 0, 0],
    });
    expect(results[0]?.episode.id).toBe('close');
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('boosts score when queryText matches title/summary', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(
      buildEpisode({ id: 'match', title: 'lease renewal request' }),
    );
    await store.upsertEpisode(
      buildEpisode({ id: 'nomatch', title: 'water bill question' }),
    );
    const results = await store.retrieveByRelevance({
      tenantId: TENANT,
      queryText: 'lease renewal',
    });
    expect(results[0]?.episode.id).toBe('match');
  });

  it('respects the limit parameter', async () => {
    const store = createInMemoryEpisodicStore();
    for (let i = 0; i < 5; i++) {
      await store.upsertEpisode(buildEpisode({ id: `ep-${i}` }));
    }
    const results = await store.retrieveByRelevance({
      tenantId: TENANT,
      limit: 2,
    });
    expect(results).toHaveLength(2);
  });

  it('returns scores in [0, 1]', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(buildEpisode());
    const results = await store.retrieveByRelevance({ tenantId: TENANT });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('handles empty embeddings without crashing', async () => {
    const store = createInMemoryEpisodicStore();
    await store.upsertEpisode(buildEpisode({ embedding: [] }));
    const results = await store.retrieveByRelevance({
      tenantId: TENANT,
      queryEmbedding: [0.1, 0.2],
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.score).toBeGreaterThanOrEqual(0);
  });
});
