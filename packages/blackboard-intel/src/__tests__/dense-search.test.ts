import { describe, it, expect } from 'vitest';
import { createDenseSearcher } from '../search/dense-search.js';
import {
  createInMemoryDenseSearchIndex,
  createInMemorySearchIndexRepository,
} from '../repositories/search-index-repository.js';
import {
  createConstantEmbeddingPort,
  createFixtureEmbeddingPort,
  V_A,
  V_A_NEAR,
  V_B,
  V_C,
} from '../__fixtures__/deterministic-embeddings.js';
import { BlackboardIntelError } from '../types.js';

async function seed(): Promise<{
  dense: ReturnType<typeof createInMemoryDenseSearchIndex>;
  contentRepo: ReturnType<typeof createInMemorySearchIndexRepository>;
}> {
  const dense = createInMemoryDenseSearchIndex();
  const contentRepo = createInMemorySearchIndexRepository();
  // Tenant A has three posts.
  await dense.upsert({ postId: 'p1', tenantId: 'tenant-a', embedding: V_A });
  await contentRepo.upsert({
    postId: 'p1',
    tenantId: 'tenant-a',
    content: 'fuel content',
    auditHash: 'h1',
  });
  await dense.upsert({
    postId: 'p2',
    tenantId: 'tenant-a',
    embedding: V_A_NEAR,
  });
  await contentRepo.upsert({
    postId: 'p2',
    tenantId: 'tenant-a',
    content: 'fuel related text',
    auditHash: 'h2',
  });
  await dense.upsert({ postId: 'p3', tenantId: 'tenant-a', embedding: V_B });
  await contentRepo.upsert({
    postId: 'p3',
    tenantId: 'tenant-a',
    content: 'unrelated weight talk',
    auditHash: 'h3',
  });
  // Tenant B has one post — used for cross-tenant probe.
  await dense.upsert({ postId: 'p4', tenantId: 'tenant-b', embedding: V_A });
  await contentRepo.upsert({
    postId: 'p4',
    tenantId: 'tenant-b',
    content: 'fuel content (tenant b)',
    auditHash: 'h4',
  });
  return { dense, contentRepo };
}

describe('createDenseSearcher', () => {
  it('returns only the calling tenant\'s posts ranked by similarity', async () => {
    const { dense, contentRepo } = await seed();
    const embedding = createFixtureEmbeddingPort();
    const searcher = createDenseSearcher({ dense, embedding, contentRepo });
    const result = await searcher.search({
      tenantId: 'tenant-a',
      text: 'fuel anything',
    });
    expect(result.map((r) => r.postId)).toEqual(['p1', 'p2', 'p3']);
    // p4 belongs to tenant-b — must not appear.
    expect(result.find((r) => r.postId === 'p4')).toBeUndefined();
  });

  it('rejects cross-tenant probes loudly', async () => {
    const dense = createInMemoryDenseSearchIndex();
    // The dense port leaks a post from tenant-b when scoped to tenant-a.
    const leakyDense = {
      upsert: dense.upsert,
      async search(_tenantId: string) {
        return Object.freeze([
          Object.freeze({ postId: 'leaked', similarity: 1.0 }),
        ]);
      },
    };
    const contentRepo = createInMemorySearchIndexRepository();
    // Content repo has no row for 'leaked' under tenant-a — it would
    // be present only under tenant-b. dense-search must throw.
    const embedding = createConstantEmbeddingPort(V_C);
    const searcher = createDenseSearcher({
      dense: leakyDense,
      embedding,
      contentRepo,
    });
    await expect(
      searcher.search({ tenantId: 'tenant-a', text: 'irrelevant' }),
    ).rejects.toBeInstanceOf(BlackboardIntelError);
  });

  it('throws EMBEDDING_DIM_MISMATCH when the port returns the wrong dim', async () => {
    const dense = createInMemoryDenseSearchIndex();
    const contentRepo = createInMemorySearchIndexRepository();
    const embedding = createConstantEmbeddingPort([1, 2, 3]);
    const searcher = createDenseSearcher({ dense, embedding, contentRepo });
    await expect(
      searcher.search({ tenantId: 'tenant-a', text: 'whatever' }),
    ).rejects.toBeInstanceOf(BlackboardIntelError);
  });
});
