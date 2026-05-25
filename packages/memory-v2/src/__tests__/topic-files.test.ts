import { describe, expect, it } from 'vitest';
import { createInMemoryTopicFileStore } from '../topic-files/store-inmemory.js';

const TENANT = 'tenant-1';

describe('topic-files store', () => {
  it('upserts and reads back by topic', async () => {
    const store = createInMemoryTopicFileStore();
    await store.upsertTopic({
      id: 'tf-1',
      tenantId: TENANT,
      topic: 'borrower:abc',
      summary: 'borrower abc summary',
      facts: [],
      episodeIds: ['e1', 'e2'],
      updatedAt: '2026-05-25T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    const found = await store.getByTopic(TENANT, 'borrower:abc');
    expect(found?.summary).toBe('borrower abc summary');
  });

  it('returns null when topic missing', async () => {
    const store = createInMemoryTopicFileStore();
    expect(await store.getByTopic(TENANT, 'nope')).toBeNull();
  });

  it('isolates by tenantId', async () => {
    const store = createInMemoryTopicFileStore();
    await store.upsertTopic({
      id: 'tf-a',
      tenantId: TENANT,
      topic: 'shared',
      summary: 'tenant-1',
      facts: [],
      episodeIds: [],
      updatedAt: '2026-05-25T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    await store.upsertTopic({
      id: 'tf-b',
      tenantId: 'tenant-other',
      topic: 'shared',
      summary: 'tenant-other',
      facts: [],
      episodeIds: [],
      updatedAt: '2026-05-25T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    const a = await store.getByTopic(TENANT, 'shared');
    const b = await store.getByTopic('tenant-other', 'shared');
    expect(a?.summary).toBe('tenant-1');
    expect(b?.summary).toBe('tenant-other');
  });

  it('overwrites on upsert with same topic key', async () => {
    const store = createInMemoryTopicFileStore();
    await store.upsertTopic({
      id: 'tf-1',
      tenantId: TENANT,
      topic: 'shared',
      summary: 'old',
      facts: [],
      episodeIds: [],
      updatedAt: '2026-05-25T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    await store.upsertTopic({
      id: 'tf-1',
      tenantId: TENANT,
      topic: 'shared',
      summary: 'new',
      facts: [],
      episodeIds: [],
      updatedAt: '2026-05-26T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    const found = await store.getByTopic(TENANT, 'shared');
    expect(found?.summary).toBe('new');
  });
});
