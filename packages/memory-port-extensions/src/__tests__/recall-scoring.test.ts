import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECALL_CONFIG,
  scoreBatch,
  scoreRecall,
} from '../recall-scoring.js';

describe('recall-scoring', () => {
  it('auto-accepts a strong, well-reranked, high-precision recall', () => {
    const out = scoreRecall({
      value: 'fact',
      retrievalScore: 0.95,
      rerankScore: 0.95,
      historicalPrecision: 0.95,
    });
    expect(out.verdict).toBe('auto-accept');
  });

  it('rejects a weak recall', () => {
    const out = scoreRecall({
      value: 'fact',
      retrievalScore: 0.05,
      rerankScore: 0.05,
      historicalPrecision: 0.1,
    });
    expect(out.verdict).toBe('reject');
  });

  it('routes mid-confidence to verify', () => {
    const out = scoreRecall({
      value: 'fact',
      retrievalScore: 0.6,
      rerankScore: 0.6,
      historicalPrecision: 0.5,
    });
    expect(out.verdict).toBe('verify');
  });

  it('falls back to retrievalScore for rerank when missing', () => {
    const out = scoreRecall({
      value: 'fact',
      retrievalScore: 0.9,
      historicalPrecision: 0.9,
    });
    expect(out.confidence).toBeGreaterThan(0.8);
  });

  it('falls back to neutral prior when historicalPrecision missing', () => {
    const out = scoreRecall({ value: 'fact', retrievalScore: 0.9, rerankScore: 0.9 });
    // 0.45*0.9 + 0.35*0.9 + 0.2*0.5 = 0.82
    expect(out.confidence).toBeCloseTo(0.82, 2);
  });

  it('clamps out-of-range scores', () => {
    const out = scoreRecall({
      value: 'fact',
      retrievalScore: 99,
      rerankScore: -99,
      historicalPrecision: 0.5,
    });
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
  });

  it('confidence is monotone-non-decreasing in retrievalScore', () => {
    const low = scoreRecall({ value: 'f', retrievalScore: 0.3, rerankScore: 0.5, historicalPrecision: 0.5 });
    const high = scoreRecall({ value: 'f', retrievalScore: 0.9, rerankScore: 0.5, historicalPrecision: 0.5 });
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });

  it('scoreBatch partitions correctly', () => {
    const out = scoreBatch([
      { value: 'a', retrievalScore: 0.95, rerankScore: 0.95, historicalPrecision: 0.95 },
      { value: 'b', retrievalScore: 0.6, rerankScore: 0.6, historicalPrecision: 0.5 },
      { value: 'c', retrievalScore: 0.1, rerankScore: 0.1, historicalPrecision: 0.1 },
    ]);
    expect(out.autoAccepted.length).toBe(1);
    expect(out.toVerify.length).toBe(1);
    expect(out.rejected.length).toBe(1);
  });

  it('respects custom thresholds', () => {
    const out = scoreRecall(
      { value: 'fact', retrievalScore: 0.6, rerankScore: 0.6, historicalPrecision: 0.5 },
      { autoAcceptThreshold: 0.5, rejectThreshold: 0.2, weights: DEFAULT_RECALL_CONFIG.weights },
    );
    expect(out.verdict).toBe('auto-accept');
  });

  it('config defaults sum approximately to 1', () => {
    const w = DEFAULT_RECALL_CONFIG.weights;
    expect(w.retrieval + w.rerank + w.precision).toBeCloseTo(1, 2);
  });
});
