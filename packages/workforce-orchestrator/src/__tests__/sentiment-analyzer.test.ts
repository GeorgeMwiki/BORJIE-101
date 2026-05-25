import { describe, expect, it } from 'vitest';
import { heuristicSentiment, runSentimentAnalysis } from '../sentiment-analyzer.js';
import { makeFixture } from './fixtures.js';

describe('heuristicSentiment', () => {
  it('returns positive for done / fixed / great', () => {
    expect(heuristicSentiment('done, great work today')).toBeGreaterThan(0);
    expect(heuristicSentiment('fixed and resolved')).toBeGreaterThan(0);
  });

  it('returns negative for stuck / failed / broken', () => {
    expect(heuristicSentiment('stuck, broken, failed')).toBeLessThan(0);
  });

  it('returns 0 for neutral / short text', () => {
    expect(heuristicSentiment('hello there')).toBe(0);
  });

  it('caps in [-1, 1]', () => {
    const s = heuristicSentiment('great great great great great great');
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(-1);
  });
});

describe('runSentimentAnalysis', () => {
  it('returns score=0 source=neutral for empty text', async () => {
    const fx = makeFixture();
    const r = await runSentimentAnalysis(fx.deps, { text: '' });
    expect(r.score).toBe(0);
    expect(r.source).toBe('neutral');
  });

  it('uses heuristic when conclusive', async () => {
    const fx = makeFixture();
    const r = await runSentimentAnalysis(fx.deps, { text: 'done, great' });
    expect(r.source).toBe('heuristic');
    expect(r.score).toBeGreaterThan(0);
  });

  it('falls through to kernel when heuristic is 0 and text is substantive', async () => {
    const fx = makeFixture();
    fx.content.sentimentScore = -0.7;
    const r = await runSentimentAnalysis(fx.deps, {
      text: 'I had to call the vendor today because the part was misdelivered yesterday afternoon.',
    });
    expect(r.source).toBe('kernel');
    expect(r.score).toBe(-0.7);
  });

  it('clamps kernel output to [-1, 1]', async () => {
    const fx = makeFixture();
    fx.content.sentimentScore = 5;
    const r = await runSentimentAnalysis(fx.deps, {
      text: 'a long bland message with eight or more tokens here please',
    });
    expect(r.score).toBe(1);
  });

  it('returns neutral when kernel throws', async () => {
    const fx = makeFixture();
    fx.content.inferSentiment = async () => {
      throw new Error('boom');
    };
    const r = await runSentimentAnalysis(fx.deps, {
      text: 'a long bland message with eight or more tokens here please',
    });
    expect(r.source).toBe('neutral');
    expect(r.score).toBe(0);
  });

  it('returns heuristic score for short neutral text without kernel', async () => {
    const fx = makeFixture();
    const r = await runSentimentAnalysis(fx.deps, { text: 'hi' });
    expect(r.source).toBe('heuristic');
    expect(r.score).toBe(0);
  });
});
