import { describe, it, expect } from 'vitest';
import { calibrate } from '../pipeline/calibrator.js';
import type { Citation, Disagreement, ReconciledCluster } from '../types.js';

function mkCluster(
  id: string,
  avgScore: number,
  chunkIds: string[] = ['c1', 'c2'],
): ReconciledCluster {
  return {
    id,
    topic: `topic: ${id}`,
    chunkIds,
    avgScore,
    contradictions: [],
    summary: 'summary',
  };
}

describe('calibrator', () => {
  it('shrinks confidence when disagreements are present', () => {
    const clusters = [mkCluster('a', 0.8), mkCluster('b', 0.7)];
    const noDisagreement = calibrate({
      clusters,
      disagreements: [],
      citations: [] as ReadonlyArray<Citation>,
      chunkCount: 10,
      sourceCount: 4,
    });
    const withDisagreement = calibrate({
      clusters,
      disagreements: [
        {
          topic: 'topic: a',
          positions: [
            { stance: 'positive', sources: ['s1'], chunkIds: [] },
            { stance: 'negative', sources: ['s2'], chunkIds: [] },
          ],
        } satisfies Disagreement,
      ],
      citations: [] as ReadonlyArray<Citation>,
      chunkCount: 10,
      sourceCount: 4,
    });
    expect(withDisagreement.calibrated).toBeLessThan(noDisagreement.calibrated);
    expect(withDisagreement.factors.some((f) => f.name === 'disagreements')).toBe(
      true,
    );
  });

  it('penalises single-source corpora and very small chunk counts', () => {
    const clusters = [mkCluster('a', 0.7, ['c1'])];
    const calib = calibrate({
      clusters,
      disagreements: [],
      citations: [],
      chunkCount: 1,
      sourceCount: 1,
    });
    const names = new Set(calib.factors.map((f) => f.name));
    expect(names.has('small_corpus')).toBe(true);
    expect(names.has('single_source')).toBe(true);
    expect(calib.calibrated).toBeLessThan(0.7);
  });

  it('returns an interval that brackets the calibrated value within [0,1]', () => {
    const clusters = [mkCluster('a', 0.5)];
    const calib = calibrate({
      clusters,
      disagreements: [],
      citations: [],
      chunkCount: 5,
      sourceCount: 3,
    });
    expect(calib.interval.lower).toBeLessThanOrEqual(calib.calibrated);
    expect(calib.interval.upper).toBeGreaterThanOrEqual(calib.calibrated);
    expect(calib.interval.lower).toBeGreaterThanOrEqual(0);
    expect(calib.interval.upper).toBeLessThanOrEqual(1);
  });
});
