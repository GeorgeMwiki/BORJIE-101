import { describe, it, expect } from 'vitest';
import { clusterChunks } from '../pipeline/clusterer.js';
import type { ScoredChunk } from '../types.js';

describe('clusterer', () => {
  it('merges topically similar chunks into a single cluster', () => {
    const scored: ReadonlyArray<ScoredChunk> = [
      mk(
        'c1',
        'a1',
        'royalty calculation tumemadini audit findings indicate elevated risk',
        0.8,
      ),
      mk(
        'c2',
        'a2',
        'royalty calculation tumemadini audit indicates further risk drift',
        0.7,
      ),
      mk(
        'c3',
        'a3',
        'weather forecast coastal cyclone surf advisory warning today',
        0.6,
      ),
    ];
    const clusters = clusterChunks(scored, { maxClusters: 5 });
    // c1 + c2 should share a cluster, c3 separate.
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    const clusterContaining = (id: string) =>
      clusters.find((c) => c.chunkIds.includes(id));
    const c1cluster = clusterContaining('c1');
    const c2cluster = clusterContaining('c2');
    const c3cluster = clusterContaining('c3');
    expect(c1cluster?.id).toBe(c2cluster?.id);
    expect(c3cluster?.id).not.toBe(c1cluster?.id);
  });

  it('respects maxClusters cap', () => {
    const scored: ReadonlyArray<ScoredChunk> = [
      mk('a', 'a1', 'topic alpha discussion vocabulary primary set', 0.9),
      mk('b', 'a2', 'topic beta discussion vocabulary primary set', 0.8),
      mk('c', 'a3', 'topic gamma discussion vocabulary primary set', 0.7),
      mk('d', 'a4', 'topic delta discussion vocabulary primary set', 0.6),
    ];
    const clusters = clusterChunks(scored, {
      maxClusters: 2,
      mergeThreshold: 0.95,
    });
    expect(clusters.length).toBeLessThanOrEqual(2);
  });
});

function mk(
  id: string,
  artifactId: string,
  text: string,
  score: number,
): ScoredChunk {
  return {
    id,
    artifactId,
    text,
    wordCount: text.split(/\s+/).length,
    seq: 0,
    relevance: score,
    quality: 0.7,
    recencyDecay: 0.8,
    score,
  };
}
