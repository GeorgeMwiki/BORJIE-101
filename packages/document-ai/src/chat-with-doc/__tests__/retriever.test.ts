import { describe, expect, it, vi } from 'vitest';
import { retrieve } from '../retriever.js';
import type { DocChunk } from '../chunker.js';
import type { EmbedderPort } from '../../types.js';

const CHUNKS: DocChunk[] = [
  {
    docId: 'd1',
    pageNumber: 1,
    blockIds: ['b-1'],
    text: 'Monthly rent is TZS 1,250,000 due on the first of each month.',
  },
  {
    docId: 'd1',
    pageNumber: 1,
    blockIds: ['b-2'],
    text: 'The tenant is responsible for water and electricity utilities.',
  },
  {
    docId: 'd1',
    pageNumber: 2,
    blockIds: ['b-3'],
    text: 'Eviction requires thirty days notice as per Tanzania Land Act.',
  },
];

describe('retrieve (BM25)', () => {
  it('returns the rent chunk first when asking about rent', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'how much is the rent?');
    expect(results[0]!.chunk.text).toContain('rent');
  });

  it('returns the eviction chunk first when asking about notice', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'how much eviction notice is required');
    expect(results[0]!.chunk.text.toLowerCase()).toContain('eviction');
  });

  it('returns empty list when no terms match', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'pizza taco airplane');
    expect(results).toEqual([]);
  });

  it('honors topK', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'tenant', { topK: 1 });
    expect(results).toHaveLength(1);
  });
});

describe('retrieve with embedder re-rank', () => {
  it('uses the embedder when supplied', async () => {
    const embed = vi.fn(async (texts: ReadonlyArray<string>) =>
      texts.map((_, i) => [i + 1, i + 2, i + 3] as ReadonlyArray<number>)
    );
    const embedder: EmbedderPort = { embed };
    const results = await retrieve(
      { chunks: CHUNKS, embedder },
      'rent',
      { topK: 2 }
    );
    expect(embed).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });
});
