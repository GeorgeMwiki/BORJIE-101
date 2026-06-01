import { describe, expect, it, vi } from 'vitest';
import { retrieve } from '../retriever.js';
import type { DocChunk } from '../chunker.js';
import type { EmbedderPort } from '../../types.js';

const CHUNKS: DocChunk[] = [
  {
    docId: 'd1',
    pageNumber: 1,
    blockIds: ['b-1'],
    text: 'Monthly royalty is TZS 1,250,000 due on the first of each month.',
  },
  {
    docId: 'd1',
    pageNumber: 1,
    blockIds: ['b-2'],
    text: 'The operator is responsible for water and electricity utilities.',
  },
  {
    docId: 'd1',
    pageNumber: 2,
    blockIds: ['b-3'],
    text: 'Licence suspension requires thirty days notice as per the Mining Act 2010.',
  },
];

describe('retrieve (BM25)', () => {
  it('returns the royalty chunk first when asking about royalty', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'how much is the royalty?');
    expect(results[0]!.chunk.text).toContain('royalty');
  });

  it('returns the suspension chunk first when asking about notice', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'how much suspension notice is required');
    expect(results[0]!.chunk.text.toLowerCase()).toContain('suspension');
  });

  it('returns empty list when no terms match', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'pizza taco airplane');
    expect(results).toEqual([]);
  });

  it('honors topK', async () => {
    const results = await retrieve({ chunks: CHUNKS }, 'operator', { topK: 1 });
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
      'royalty',
      { topK: 2 }
    );
    expect(embed).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });
});
