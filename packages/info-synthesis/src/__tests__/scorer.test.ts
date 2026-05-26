import { describe, it, expect } from 'vitest';
import { scoreChunks } from '../pipeline/scorer.js';
import type { Chunk, CorpusArtifact } from '../types.js';

describe('scorer', () => {
  it('assigns higher relevance to chunks containing query tokens', () => {
    const chunks: ReadonlyArray<Chunk> = [
      {
        id: 'c1',
        artifactId: 'a1',
        text: 'tumemadini royalty calculation review pending action item',
        wordCount: 8,
        seq: 0,
      },
      {
        id: 'c2',
        artifactId: 'a2',
        text: 'unrelated weather news at coastal regions today',
        wordCount: 7,
        seq: 0,
      },
    ];
    const corpus = new Map<string, CorpusArtifact>([
      [
        'a1',
        {
          id: 'a1',
          source: 'audit-2026-01',
          text: 'tumemadini royalty calculation review pending action item',
          reliability: 0.9,
        },
      ],
      [
        'a2',
        {
          id: 'a2',
          source: 'news-2026-01',
          text: 'unrelated weather news at coastal regions today',
          reliability: 0.4,
        },
      ],
    ]);
    const scored = scoreChunks({
      query: 'tumemadini royalty review',
      chunks,
      corpusById: corpus,
    });
    const c1 = scored.find((s) => s.id === 'c1');
    const c2 = scored.find((s) => s.id === 'c2');
    expect(c1?.relevance ?? 0).toBeGreaterThan(c2?.relevance ?? 0);
    expect(c1?.score ?? 0).toBeGreaterThan(c2?.score ?? 0);
  });

  it('applies recency decay for older artifacts when publishedAt is known', () => {
    const chunks: ReadonlyArray<Chunk> = [
      {
        id: 'fresh',
        artifactId: 'fresh',
        text: 'royalty update',
        wordCount: 2,
        seq: 0,
      },
      {
        id: 'stale',
        artifactId: 'stale',
        text: 'royalty update',
        wordCount: 2,
        seq: 0,
      },
    ];
    const corpus = new Map<string, CorpusArtifact>([
      [
        'fresh',
        {
          id: 'fresh',
          source: 's',
          text: 'royalty update',
          publishedAt: '2026-01-01T00:00:00Z',
        },
      ],
      [
        'stale',
        {
          id: 'stale',
          source: 's',
          text: 'royalty update',
          publishedAt: '2020-01-01T00:00:00Z',
        },
      ],
    ]);
    const scored = scoreChunks({
      query: 'royalty',
      chunks,
      corpusById: corpus,
      nowIso: '2026-02-01T00:00:00Z',
    });
    const fresh = scored.find((c) => c.id === 'fresh');
    const stale = scored.find((c) => c.id === 'stale');
    expect((fresh?.recencyDecay ?? 0)).toBeGreaterThan(
      stale?.recencyDecay ?? 0,
    );
  });
});
