import { describe, it, expect } from 'vitest';
import { reconcileClusters } from '../pipeline/reconciler.js';
import type { Chunk, Cluster } from '../types.js';

describe('reconciler', () => {
  it('surfaces a disagreement when a cluster contains opposing polarity chunks', () => {
    const chunks = new Map<string, Chunk>([
      [
        'pos',
        {
          id: 'pos',
          artifactId: 'a1',
          text: 'permit was approved by regulator yesterday with positive feedback',
          wordCount: 10,
          seq: 0,
        },
      ],
      [
        'neg',
        {
          id: 'neg',
          artifactId: 'a2',
          text: 'permit was rejected by regulator under negative review',
          wordCount: 9,
          seq: 0,
        },
      ],
    ]);
    const cluster: Cluster = {
      id: 'cl1',
      topic: 'topic: permit, regulator, review',
      chunkIds: ['pos', 'neg'],
      avgScore: 0.6,
    };
    const result = reconcileClusters({
      clusters: [cluster],
      chunksById: chunks,
    });
    expect(result.disagreements.length).toBe(1);
    const dis = result.disagreements[0];
    expect(dis).toBeDefined();
    const positions = dis!.positions;
    expect(positions.length).toBe(2);
    const stances = positions.map((p) => p.stance);
    expect(stances).toContain('positive');
    expect(stances).toContain('negative');
    expect(result.reconciled[0]?.contradictions.length ?? 0).toBeGreaterThan(0);
  });

  it('emits no disagreement when chunks all agree on polarity', () => {
    const chunks = new Map<string, Chunk>([
      [
        'a',
        {
          id: 'a',
          artifactId: 'a1',
          text: 'yield increased nicely this quarter',
          wordCount: 6,
          seq: 0,
        },
      ],
      [
        'b',
        {
          id: 'b',
          artifactId: 'a2',
          text: 'yield rose substantially this quarter',
          wordCount: 5,
          seq: 0,
        },
      ],
    ]);
    const cluster: Cluster = {
      id: 'cl1',
      topic: 'topic: yield, quarter',
      chunkIds: ['a', 'b'],
      avgScore: 0.7,
    };
    const result = reconcileClusters({
      clusters: [cluster],
      chunksById: chunks,
    });
    expect(result.disagreements.length).toBe(0);
    expect(result.reconciled[0]?.contradictions.length ?? 0).toBe(0);
  });
});
