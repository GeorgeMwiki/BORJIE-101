/**
 * Unit tests for the WER metric. All inputs are deterministic strings; no I/O.
 *
 * Targets:
 *   - identical input returns WER 0
 *   - one substitution / one insertion / one deletion each cost 1
 *   - Swahili hyphen-segmentation differences are absorbed by the normaliser
 *   - punctuation differences don't penalise the hypothesis
 *   - empty hypothesis on non-empty reference flags as deletions
 */

import { describe, expect, it } from 'vitest';

import {
  normaliseTranscript,
  tokenise,
  wordErrorRate,
  WER_AGGREGATE_TARGET,
} from '../metrics/wer.js';

describe('normaliseTranscript', () => {
  it('lowercases + strips punctuation + collapses whitespace', () => {
    expect(normaliseTranscript('  Habari, ZAKO! ')).toBe('habari zako');
  });

  it('rejoins hyphenated morpheme segmentation', () => {
    expect(normaliseTranscript('tu-ta-kwenda')).toBe('tutakwenda');
  });

  it('returns empty string for empty input', () => {
    expect(normaliseTranscript('')).toBe('');
  });
});

describe('tokenise', () => {
  it('returns words from a normalised string', () => {
    expect(tokenise('habari zako')).toEqual(['habari', 'zako']);
  });

  it('returns empty array for empty input', () => {
    expect(tokenise('')).toEqual([]);
  });
});

describe('wordErrorRate', () => {
  it('returns 0 on identical reference + hypothesis', () => {
    const result = wordErrorRate('parseli ya gramu mia tisa', 'parseli ya gramu mia tisa');
    expect(result.wer).toBe(0);
    expect(result.substitutions).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('scores one substitution as 1/N', () => {
    const result = wordErrorRate('parseli ya gramu mia tisa', 'parseli ya gramu mia tatu');
    expect(result.substitutions).toBe(1);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.wer).toBeCloseTo(1 / 5, 5);
  });

  it('scores one insertion', () => {
    const result = wordErrorRate('habari zako', 'habari zako sana');
    expect(result.insertions).toBe(1);
    expect(result.wer).toBeCloseTo(0.5, 5);
  });

  it('scores one deletion', () => {
    const result = wordErrorRate('habari zako sana', 'habari sana');
    expect(result.deletions).toBe(1);
    expect(result.wer).toBeCloseTo(1 / 3, 5);
  });

  it('treats Swahili agglutination segmentation as equal', () => {
    const result = wordErrorRate('tutakwenda mgodini', 'tu-ta-kwenda mgodini');
    expect(result.wer).toBe(0);
  });

  it('ignores punctuation differences', () => {
    const result = wordErrorRate('parseli, ya gramu.', 'parseli ya gramu');
    expect(result.wer).toBe(0);
  });

  it('handles empty hypothesis as full deletions', () => {
    const result = wordErrorRate('habari zako sana', '');
    expect(result.deletions).toBe(3);
    expect(result.wer).toBe(1);
  });

  it('handles empty reference + non-empty hypothesis with floor 1 denominator', () => {
    const result = wordErrorRate('', 'habari');
    expect(result.insertions).toBe(1);
    expect(result.wer).toBe(1);
  });
});

describe('WER target constants', () => {
  it('aggregate target is the spec value 8%', () => {
    expect(WER_AGGREGATE_TARGET).toBeCloseTo(0.08, 5);
  });
});
