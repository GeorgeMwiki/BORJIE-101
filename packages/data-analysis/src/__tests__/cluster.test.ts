/**
 * Cluster — k-means convergence, DBSCAN noise, hierarchical structure.
 */

import { describe as suite, it, expect } from 'vitest';
import { kmeans, silhouetteScore } from '../cluster/kmeans.js';
import { dbscan } from '../cluster/dbscan.js';
import { hierarchical } from '../cluster/hierarchical.js';

const TWO_BLOBS = [
  // Blob 0 near (0, 0)
  [0.1, 0.0], [-0.05, 0.05], [0.0, -0.1], [0.05, -0.05], [-0.1, 0.0],
  // Blob 1 near (10, 10)
  [10.0, 10.1], [10.05, 9.95], [9.9, 10.0], [10.1, 10.05], [10.0, 9.9],
] as const;

suite('cluster — reference vectors', () => {
  it('k-means with k=2 on two well-separated blobs converges and gives clean split', () => {
    const r = kmeans(TWO_BLOBS, 2, { seed: 42 });
    expect(r.converged).toBe(true);
    // All blob-0 points should share a label; all blob-1 likewise.
    const labels0 = r.labels.slice(0, 5);
    const labels1 = r.labels.slice(5, 10);
    const allSame0 = labels0.every((l) => l === labels0[0]);
    const allSame1 = labels1.every((l) => l === labels1[0]);
    expect(allSame0).toBe(true);
    expect(allSame1).toBe(true);
    expect(labels0[0]).not.toBe(labels1[0]);
  });

  it('silhouetteScore on the same two-blob split is > 0.9', () => {
    const r = kmeans(TWO_BLOBS, 2, { seed: 42 });
    const s = silhouetteScore(TWO_BLOBS, r.labels);
    expect(s).toBeGreaterThan(0.9);
  });

  it('DBSCAN tags outlier as noise (-1)', () => {
    const points = [
      [0, 0], [0.1, 0.1], [0.2, 0.0], [0.0, 0.2],
      [10, 10], [10.1, 10.1], [10.2, 10.0], [10.0, 10.2],
      [50, 50], // outlier
    ];
    const r = dbscan(points, 0.5, 3);
    expect(r.labels[8]).toBe(-1); // outlier is noise
    expect(r.nClusters).toBe(2);
  });

  it('hierarchical (average linkage) recovers two-blob structure', () => {
    const r = hierarchical(TWO_BLOBS, 2, 'average');
    const labels0 = r.labels.slice(0, 5);
    const labels1 = r.labels.slice(5, 10);
    const allSame0 = labels0.every((l) => l === labels0[0]);
    const allSame1 = labels1.every((l) => l === labels1[0]);
    expect(allSame0).toBe(true);
    expect(allSame1).toBe(true);
    expect(labels0[0]).not.toBe(labels1[0]);
  });
});
