import { describe, it, expect } from 'vitest';
import { createFtsSearcher } from '../search/fts-search.js';
import { createInMemorySearchIndexRepository } from '../repositories/search-index-repository.js';
import { BlackboardIntelError } from '../types.js';

describe('createFtsSearcher', () => {
  it('returns only the calling tenant\'s rows', async () => {
    const repo = createInMemorySearchIndexRepository();
    await repo.upsert({
      postId: 'p-a',
      tenantId: 'tenant-a',
      content: 'fuel consumption spike on loader-7',
      auditHash: 'h1',
    });
    await repo.upsert({
      postId: 'p-b',
      tenantId: 'tenant-b',
      content: 'fuel consumption spike on loader-7',
      auditHash: 'h2',
    });
    const fts = createFtsSearcher({ repo });
    const result = await fts.search({
      tenantId: 'tenant-a',
      text: 'fuel loader',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.postId).toBe('p-a');
    expect(result[0]?.tenantId).toBe('tenant-a');
  });

  it('ranks results — tighter coverage outranks loose hits', async () => {
    const repo = createInMemorySearchIndexRepository();
    // The shorter post matches more tightly per token.
    await repo.upsert({
      postId: 'p-short',
      tenantId: 'tenant-a',
      content: 'fuel spike',
      auditHash: 'h1',
    });
    await repo.upsert({
      postId: 'p-long',
      tenantId: 'tenant-a',
      content:
        'fuel spike on the loader after the night shift maintenance routine',
      auditHash: 'h2',
    });
    const fts = createFtsSearcher({ repo });
    const result = await fts.search({
      tenantId: 'tenant-a',
      text: 'fuel spike',
    });
    expect(result.map((r) => r.postId)).toEqual(['p-short', 'p-long']);
    expect(result[0]?.score ?? 0).toBeGreaterThan(result[1]?.score ?? 0);
  });

  it('throws EMPTY_QUERY when the query text is whitespace', async () => {
    const repo = createInMemorySearchIndexRepository();
    const fts = createFtsSearcher({ repo });
    await expect(
      fts.search({ tenantId: 'tenant-a', text: '  ' }),
    ).rejects.toBeInstanceOf(BlackboardIntelError);
  });
});
