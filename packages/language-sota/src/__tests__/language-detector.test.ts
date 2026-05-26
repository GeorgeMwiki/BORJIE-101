import { describe, expect, it } from 'vitest';
import {
  detectLanguage,
  reduceVotes,
} from '../detection/language-detector.js';
import type {
  DetectorPort,
  DetectorVote,
  Language,
} from '../types.js';
import { LanguageSotaError } from '../types.js';

function fakeDetector(
  source: DetectorVote['source'],
  lang: Language,
  confidence: number,
): DetectorPort {
  return {
    source,
    async detect() {
      return { source, lang, confidence };
    },
  };
}

describe('language-detector ensemble', () => {
  it('detects English when all detectors agree', async () => {
    const detectors = [
      fakeDetector('fasttext', 'en', 0.95),
      fakeDetector('llm', 'en', 0.92),
      fakeDetector('whisper', 'en', 0.88),
    ];
    const result = await detectLanguage(detectors, 'Hello, how are you today?');
    expect(result.lang).toBe('en');
    expect(result.votes).toHaveLength(3);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detects Swahili when all detectors agree', async () => {
    const detectors = [
      fakeDetector('fasttext', 'sw', 0.93),
      fakeDetector('llm', 'sw', 0.91),
      fakeDetector('whisper', 'sw', 0.89),
    ];
    const result = await detectLanguage(detectors, 'Habari yako leo asubuhi?');
    expect(result.lang).toBe('sw');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('routes mixed utterances to code-switch when that wins', async () => {
    const detectors = [
      fakeDetector('fasttext', 'code-switch', 0.78),
      fakeDetector('llm', 'code-switch', 0.81),
      fakeDetector('whisper', 'en', 0.6),
    ];
    const result = await detectLanguage(
      detectors,
      "Mteja anataka tone 5, sasa price ni dollar elfu mbili.",
    );
    expect(result.lang).toBe('code-switch');
  });

  it('breaks 2-1 ties via confidence', async () => {
    // sw appears twice with low confidence; en once but with the
    // single-highest confidence — sw still wins on weighted sum.
    const detectors = [
      fakeDetector('fasttext', 'sw', 0.55),
      fakeDetector('whisper', 'sw', 0.5),
      fakeDetector('llm', 'en', 0.95),
    ];
    const result = await detectLanguage(detectors, 'Habari');
    expect(result.lang).toBe('sw');
  });

  it('refuses an empty detector list', async () => {
    await expect(detectLanguage([], 'hi')).rejects.toBeInstanceOf(
      LanguageSotaError,
    );
  });

  it('reduceVotes is pure and deterministic', () => {
    const votes: DetectorVote[] = [
      { source: 'fasttext', lang: 'en', confidence: 0.7 },
      { source: 'llm', lang: 'en', confidence: 0.6 },
    ];
    const first = reduceVotes(votes);
    const second = reduceVotes(votes);
    expect(first).toEqual(second);
    expect(first.lang).toBe('en');
  });
});
