import { describe, expect, it } from 'vitest';
import { buildNarrativeArcs } from '../narrative/arc-builder.js';
import { createInMemoryNarrativeStore } from '../narrative/store-inmemory.js';
import type { Episode } from '../types.js';

const TENANT = 'tenant-1';

function ep(
  id: string,
  validFromDays: number,
  overrides: Partial<Episode> = {},
): Episode {
  const base = new Date('2026-05-01T00:00:00.000Z').getTime();
  const t = new Date(base + validFromDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    id,
    tenantId: TENANT,
    userId: 'user-1',
    surface: 'owner_portal',
    subject: 'property:123',
    title: `episode ${id}`,
    summary: `summary for ${id}`,
    validFrom: t,
    validTo: null,
    recordedAt: t,
    embedding: [],
    tags: ['leasing'],
    ...overrides,
  };
}

function idFactory(): string {
  let n = 0;
  return `arc-${n++}`;
}

describe('narrative arc builder', () => {
  it('returns empty arcs for empty input', () => {
    const arcs = buildNarrativeArcs([], {
      tenantId: TENANT,
      idFactory: () => 'arc-0',
      now: () => '2026-05-25T00:00:00.000Z',
    });
    expect(arcs).toEqual([]);
  });

  it('clusters episodes sharing a subject within the time window', () => {
    const episodes = [
      ep('a', 0, { subject: 'property:1', tags: [] }),
      ep('b', 2, { subject: 'property:1', tags: [] }),
      ep('c', 5, { subject: 'property:1', tags: [] }),
    ];
    let counter = 0;
    const arcs = buildNarrativeArcs(episodes, {
      tenantId: TENANT,
      idFactory: () => `arc-${counter++}`,
      now: () => '2026-05-25T00:00:00.000Z',
    });
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.episodeIds).toEqual(['a', 'b', 'c']);
  });

  it('splits clusters that exceed the window', () => {
    const episodes = [
      ep('a', 0, { subject: 'property:1', tags: [] }),
      ep('b', 30, { subject: 'property:1', tags: [] }),
    ];
    let counter = 0;
    const arcs = buildNarrativeArcs(episodes, {
      tenantId: TENANT,
      idFactory: () => `arc-${counter++}`,
      now: () => '2026-05-25T00:00:00.000Z',
      windowMs: 14 * 24 * 60 * 60 * 1000,
    });
    // Single-episode clusters are filtered (length >= 2 required)
    expect(arcs).toHaveLength(0);
  });

  it('clusters by tag overlap when subjects differ', () => {
    const episodes = [
      ep('a', 0, { subject: 'property:1', tags: ['eviction'] }),
      ep('b', 2, { subject: 'property:2', tags: ['eviction'] }),
    ];
    let counter = 0;
    const arcs = buildNarrativeArcs(episodes, {
      tenantId: TENANT,
      idFactory: () => `arc-${counter++}`,
      now: () => '2026-05-25T00:00:00.000Z',
    });
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.episodeIds).toEqual(['a', 'b']);
  });

  it('filters episodes from other tenants', () => {
    const episodes = [
      ep('a', 0, { subject: 'property:1' }),
      ep('b', 1, { tenantId: 'tenant-other', subject: 'property:1' }),
    ];
    let counter = 0;
    const arcs = buildNarrativeArcs(episodes, {
      tenantId: TENANT,
      idFactory: () => `arc-${counter++}`,
      now: () => '2026-05-25T00:00:00.000Z',
    });
    expect(arcs).toHaveLength(0);
  });

  it('picks the most-frequent tags as the arc tag set', () => {
    const episodes = [
      ep('a', 0, { subject: 'p1', tags: ['t1', 't2'] }),
      ep('b', 1, { subject: 'p1', tags: ['t1', 't3'] }),
      ep('c', 2, { subject: 'p1', tags: ['t1', 't4'] }),
    ];
    let counter = 0;
    const arcs = buildNarrativeArcs(episodes, {
      tenantId: TENANT,
      idFactory: () => `arc-${counter++}`,
      now: () => '2026-05-25T00:00:00.000Z',
    });
    expect(arcs[0]?.tags[0]).toBe('t1');
  });
});

describe('narrative store', () => {
  it('upserts and lists arcs by tenant', async () => {
    const store = createInMemoryNarrativeStore();
    await store.upsertArc({
      id: 'a1',
      tenantId: TENANT,
      title: 'arc 1',
      summary: 's',
      episodeIds: ['e1'],
      startedAt: '2026-05-01T00:00:00.000Z',
      endedAt: null,
      tags: [],
      recordedAt: '2026-05-01T00:00:00.000Z',
    });
    await store.upsertArc({
      id: 'a2',
      tenantId: 'other',
      title: 'arc 2',
      summary: 's',
      episodeIds: ['e2'],
      startedAt: '2026-05-02T00:00:00.000Z',
      endedAt: null,
      tags: [],
      recordedAt: '2026-05-02T00:00:00.000Z',
    });
    const list = await store.listArcsForTenant(TENANT);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('a1');
  });

  it('orders by recordedAt descending', async () => {
    const store = createInMemoryNarrativeStore();
    await store.upsertArc({
      id: 'older',
      tenantId: TENANT,
      title: '',
      summary: '',
      episodeIds: [],
      startedAt: '',
      endedAt: null,
      tags: [],
      recordedAt: '2026-05-01T00:00:00.000Z',
    });
    await store.upsertArc({
      id: 'newer',
      tenantId: TENANT,
      title: '',
      summary: '',
      episodeIds: [],
      startedAt: '',
      endedAt: null,
      tags: [],
      recordedAt: '2026-05-25T00:00:00.000Z',
    });
    const list = await store.listArcsForTenant(TENANT);
    expect(list[0]?.id).toBe('newer');
  });
});
