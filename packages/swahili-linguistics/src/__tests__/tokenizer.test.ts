/**
 * Tests for the morphology-aware tokenizer (Wave 19H).
 */

import { describe, it, expect } from 'vitest';
import { tokenize, detokenize, tokenizeWord } from '../tokenize/swahili-tokenizer.js';

describe('swahili tokenizer', () => {
  it('tags morphological slots on a verb', () => {
    const tokens = tokenizeWord('ninakusoma');
    const tags = tokens.map((t) => t.tag);
    expect(tags).toContain('SUBJ');
    expect(tags).toContain('TAM');
    expect(tags).toContain('OBJ');
    expect(tags).toContain('ROOT');
    expect(tags).toContain('FV');
  });

  it('round-trips a sentence losslessly', () => {
    const sentence = 'ninakusoma kitabu cha mrabaha';
    const tokens = tokenize(sentence);
    expect(detokenize(tokens)).toBe(sentence);
  });

  it('preserves leading + trailing spaces in detokenisation', () => {
    const sentence = '  habari ya asubuhi  ';
    expect(detokenize(tokenize(sentence))).toBe(sentence);
  });

  it('handles an empty string', () => {
    expect(detokenize(tokenize(''))).toBe('');
  });
});
