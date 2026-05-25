import { describe, expect, it } from 'vitest';
import {
  createInMemoryMemoryV2,
  createMemoryV2,
  createInMemoryEpisodicStore,
  createInMemoryNarrativeStore,
  createInMemoryProceduralStore,
  createInMemoryReflectiveStore,
  createInMemoryTopicFileStore,
  createInMemoryCohortCacheStore,
} from '../index.js';

describe('createMemoryV2', () => {
  it('returns the supplied stores untouched', () => {
    const stores = {
      episodic: createInMemoryEpisodicStore(),
      narrative: createInMemoryNarrativeStore(),
      procedural: createInMemoryProceduralStore(),
      reflective: createInMemoryReflectiveStore(),
      topics: createInMemoryTopicFileStore(),
      cohort: createInMemoryCohortCacheStore(),
    };
    const m = createMemoryV2({ stores });
    expect(m.stores).toBe(stores);
    expect(m.embedder).toBeNull();
    expect(m.brain).toBeNull();
  });

  it('accepts an embedder and brain', async () => {
    const m = createMemoryV2({
      stores: {
        episodic: createInMemoryEpisodicStore(),
        narrative: createInMemoryNarrativeStore(),
        procedural: createInMemoryProceduralStore(),
        reflective: createInMemoryReflectiveStore(),
        topics: createInMemoryTopicFileStore(),
        cohort: createInMemoryCohortCacheStore(),
      },
      embedder: { async embed() { return [0.1]; } },
      brain: { async summarise() { return '{}'; } },
    });
    expect(m.embedder).not.toBeNull();
    expect(m.brain).not.toBeNull();
    expect(await m.embedder?.embed('x')).toEqual([0.1]);
  });
});

describe('createInMemoryMemoryV2', () => {
  it('builds all six in-memory stores', () => {
    const m = createInMemoryMemoryV2();
    expect(m.stores.episodic).toBeDefined();
    expect(m.stores.narrative).toBeDefined();
    expect(m.stores.procedural).toBeDefined();
    expect(m.stores.reflective).toBeDefined();
    expect(m.stores.topics).toBeDefined();
    expect(m.stores.cohort).toBeDefined();
  });

  it('honours per-store overrides', () => {
    const cohort = createInMemoryCohortCacheStore();
    const m = createInMemoryMemoryV2({ cohort });
    expect(m.stores.cohort).toBe(cohort);
  });

  it('round-trips an episode end-to-end', async () => {
    const m = createInMemoryMemoryV2();
    await m.stores.episodic.upsertEpisode({
      id: 'e1',
      tenantId: 't1',
      userId: 'u1',
      surface: 'owner_portal',
      subject: null,
      title: null,
      summary: null,
      validFrom: '2026-05-25T00:00:00.000Z',
      validTo: null,
      recordedAt: '2026-05-25T00:00:00.000Z',
      embedding: [],
      tags: [],
    });
    const out = await m.stores.episodic.retrieveByRelevance({
      tenantId: 't1',
    });
    expect(out).toHaveLength(1);
  });
});
