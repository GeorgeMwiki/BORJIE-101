import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryCorpusIndex } from '../in-memory-index.js';
import { createMockEmbedder } from '../embedders.js';
import type { CorpusItem } from '../../types.js';

describe('InMemoryCorpusIndex', () => {
  const embedder = createMockEmbedder({ dimension: 32 });

  async function makeItem(
    id: string,
    text: string,
    overrides: Partial<CorpusItem> = {},
  ): Promise<CorpusItem> {
    const embedding = await embedder.embed(text);
    return {
      id,
      tenantId: overrides.tenantId ?? 't1',
      visibleToUserIds: overrides.visibleToUserIds ?? '*',
      visibleToRoles: overrides.visibleToRoles ?? ['tenant'],
      source: `doc ${id}`,
      citation: { kind: 'document', id },
      content: text,
      embedding,
      ...overrides,
    };
  }

  let index: InMemoryCorpusIndex;
  beforeEach(() => {
    index = new InMemoryCorpusIndex(embedder);
  });

  it('returns empty when no items match the scope', async () => {
    const item = await makeItem('a', 'hello', { tenantId: 'other' });
    index.add(item);
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'hello',
    });
    expect(hits).toEqual([]);
  });

  it('filters by tenantId', async () => {
    index.add(await makeItem('a', 'apartment management'));
    index.add(await makeItem('b', 'apartment management', { tenantId: 'other' }));
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'apartment',
    });
    expect(hits.length).toBe(1);
    expect(hits[0]?.item.id).toBe('a');
  });

  it('filters by role', async () => {
    index.add(await makeItem('a', 'manager dashboard', { visibleToRoles: ['pm'] }));
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'dashboard',
    });
    expect(hits).toEqual([]);
  });

  it('filters by userId when not wildcard', async () => {
    index.add(await makeItem('a', 'private note', { visibleToUserIds: ['other-user'] }));
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'private',
    });
    expect(hits).toEqual([]);
  });

  it('ranks more similar content higher', async () => {
    index.add(await makeItem('a', 'tenant lease renewal'));
    index.add(await makeItem('b', 'roof gutters in winter'));
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'tenant lease renewal',
      k: 2,
    });
    expect(hits[0]?.item.id).toBe('a');
  });

  it('honours k', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      index.add(await makeItem(id, `item ${id}`));
    }
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'item',
      k: 3,
    });
    expect(hits.length).toBe(3);
  });

  it('returns empty when k is 0', async () => {
    index.add(await makeItem('a', 'one'));
    const hits = await index.searchScoped({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      query: 'one',
      k: 0,
    });
    expect(hits).toEqual([]);
  });
});
