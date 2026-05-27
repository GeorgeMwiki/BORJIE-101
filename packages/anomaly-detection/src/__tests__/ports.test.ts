/**
 * Port adapters — One-Class SVM stub + autoencoder stub.
 */

import { describe, expect, it } from 'vitest';

import {
  createAutoencoderStub,
  quantileThreshold,
  scoreAutoencoder,
} from '../detectors/autoencoder-port.js';
import {
  createOneClassSvmStub,
  scoreOneClassSvm,
} from '../detectors/one-class-svm-port.js';

describe('one-class-svm-port stub', () => {
  it('flags negative decision-function values as anomalous (sklearn convention)', async () => {
    const port = createOneClassSvmStub((point) => -Math.abs(point[0]!));
    const result = await scoreOneClassSvm(port, [3]);
    expect(result.scoreKind).toBe('one-class-svm');
    expect(result.anomalous).toBe(true);
    expect(result.score).toBe(-3);
  });

  it('honours a custom threshold', async () => {
    const port = createOneClassSvmStub(() => 0.05);
    const result = await scoreOneClassSvm(port, [1], { threshold: 0.1 });
    expect(result.anomalous).toBe(true);
  });
});

describe('autoencoder-port stub', () => {
  it('flags reconstruction error above the threshold', async () => {
    const port = createAutoencoderStub((point) => Math.abs(point[0]!));
    const threshold = quantileThreshold([0.1, 0.2, 0.3, 0.4, 0.5], 0.99);
    expect(threshold).toBeCloseTo(0.5, 6);
    const high = await scoreAutoencoder(port, [1.0], threshold);
    expect(high.anomalous).toBe(true);
    expect(high.scoreKind).toBe('autoencoder');
    const low = await scoreAutoencoder(port, [0.2], threshold);
    expect(low.anomalous).toBe(false);
  });

  it('quantileThreshold rejects out-of-range q', () => {
    expect(() => quantileThreshold([1, 2, 3], -0.1)).toThrow();
    expect(() => quantileThreshold([1, 2, 3], 1.1)).toThrow();
  });

  it('quantileThreshold rejects empty vector', () => {
    expect(() => quantileThreshold([], 0.99)).toThrow();
  });
});
