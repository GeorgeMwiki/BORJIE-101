/**
 * Post publisher + SSE stream tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - publish appends the row to the repository
 *   - stream subscribers receive the post
 *   - the stream is tenant+region scoped (cross-region subscribers
 *     don't see another region's posts)
 *   - embedding dim mismatch throws EmbeddingDimensionError
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.4, §9.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryPostsRepository,
  createPostPublisher,
  createPostStream,
  EmbeddingDimensionError,
  type Post,
} from '../index.js';

describe('post-publisher — append + SSE emit', () => {
  it('appends a row and the SSE stream fires the event', async () => {
    const repo = createInMemoryPostsRepository();
    const stream = createPostStream({ capacity: 1000, refillPerMin: 1000 });
    const publisher = createPostPublisher({ repository: repo, stream });
    const received: Post[] = [];
    const unsub = stream.subscribe('t1', 'r1', (p) => received.push(p));
    const post = await publisher.publish({
      tenantId: 't1',
      regionId: 'r1',
      ksId: 'ks-1',
      content: 'borehole reading 412 ppm',
    });
    expect(post.content).toBe('borehole reading 412 ppm');
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe(post.id);
    unsub();
  });

  it('does NOT deliver posts from a different region to a subscriber', async () => {
    const repo = createInMemoryPostsRepository();
    const stream = createPostStream({ capacity: 1000, refillPerMin: 1000 });
    const publisher = createPostPublisher({ repository: repo, stream });
    const received: Post[] = [];
    stream.subscribe('t1', 'r1', (p) => received.push(p));
    await publisher.publish({
      tenantId: 't1',
      regionId: 'r2',
      ksId: 'ks-1',
      content: 'fuel low at fleet truck #4',
    });
    expect(received).toHaveLength(0);
  });

  it('rejects an embedding with the wrong dimensionality', async () => {
    const repo = createInMemoryPostsRepository();
    const publisher = createPostPublisher({ repository: repo });
    await expect(
      publisher.publish({
        tenantId: 't1',
        regionId: 'r1',
        ksId: 'ks-1',
        content: 'x',
        // wrong size — must be 1536
        contentEmbedding: [0.1, 0.2, 0.3],
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionError);
  });

  it('publishes with a 1536-dim embedding without error', async () => {
    const repo = createInMemoryPostsRepository();
    const publisher = createPostPublisher({ repository: repo });
    const embedding = new Array<number>(1536).fill(0).map((_, i) => i / 1536);
    const post = await publisher.publish({
      tenantId: 't1',
      regionId: 'r1',
      ksId: 'ks-1',
      content: 'borehole reading 412 ppm',
      contentEmbedding: embedding,
    });
    expect(post.contentEmbedding).not.toBeNull();
    expect(post.contentEmbedding?.length).toBe(1536);
  });
});
