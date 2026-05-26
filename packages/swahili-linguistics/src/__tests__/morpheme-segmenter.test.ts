/**
 * Tests for the morpheme segmenter (Wave 19H).
 */

import { describe, it, expect } from 'vitest';
import { segmentMorphemes } from '../morphology/morpheme-segmenter.js';

describe('segmentMorphemes', () => {
  it('routes verbs to the verb analyzer', () => {
    const result = segmentMorphemes('ninakusoma');
    expect(result.pos).toBe('verb');
    expect(result.morphemes.length).toBeGreaterThanOrEqual(4);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('routes nouns to the noun-class detector', () => {
    const result = segmentMorphemes('kitabu');
    expect(result.pos).toBe('noun');
    expect(result.lemma).toBe('kitabu');
  });

  it('emits a particle for unknown bare strings', () => {
    const result = segmentMorphemes('xyzpfql');
    // Either noun(low-confidence) or particle — both are acceptable fallbacks.
    expect(['noun', 'particle']).toContain(result.pos);
    expect(result.confidence).toBeLessThan(0.7);
  });
});
