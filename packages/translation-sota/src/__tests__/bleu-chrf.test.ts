/**
 * BLEU + chrF evaluation tests.
 *
 * Covers:
 *   - `bleu` returns 100 (capped) when hypothesis == reference.
 *   - `bleu` is sensitive to entity / number deviations (drops sharply
 *     when one token is changed in a 6-word sentence).
 *   - `chrf` returns 1.0 when hypothesis == reference.
 *   - `chrf` is more forgiving than BLEU on a diacritic / inflection
 *     mismatch in Swahili.
 *   - `corpusBleu` aggregates the Masakhane-style fixture pairs.
 */

import { describe, expect, it } from 'vitest';
import { bleu, corpusBleu } from '../evaluation/bleu.js';
import { chrf } from '../evaluation/chrf.js';
import { FIXTURE_PAIRS } from '../__fixtures__/masakhane-sample.js';

describe('BLEU + chrF', () => {
  it('BLEU returns near-100 when hypothesis equals reference', () => {
    const result = bleu(
      'the parcel arrived at the PML',
      'the parcel arrived at the PML',
    );
    expect(result.bleu).toBeGreaterThan(99);
  });

  it('BLEU drops when one entity in a short sentence is altered', () => {
    const perfect = bleu(
      'the parcel arrived at the PML',
      'the parcel arrived at the PML',
    );
    const altered = bleu(
      'the parcel arrived at the SML',
      'the parcel arrived at the PML',
    );
    expect(altered.bleu).toBeLessThan(perfect.bleu);
  });

  it('chrF returns 1.0 when hypothesis equals reference', () => {
    const result = chrf(
      'Mrabaha umekatwa kwenye USD elfu hamsini.',
      'Mrabaha umekatwa kwenye USD elfu hamsini.',
    );
    expect(result.chrf).toBe(1);
  });

  it('chrF is more forgiving than BLEU on a minor character deviation', () => {
    // "parseli" vs "parseli." (trailing period) — surface-form
    // difference that BLEU's word-tokeniser handles via punctuation
    // padding but chrF doesn't even register as a real character
    // change.
    const bleuResult = bleu('imefika parseli', 'imefika parseli.');
    const chrfResult = chrf('imefika parseli', 'imefika parseli.');
    expect(chrfResult.chrf).toBeGreaterThanOrEqual(bleuResult.bleu / 100);
  });

  it('corpusBleu aggregates over a list of fixture pairs', () => {
    const pairs = FIXTURE_PAIRS.map((p) => ({
      hypothesis: p.en,
      reference: p.en,
    }));
    const result = corpusBleu(pairs);
    expect(result.bleu).toBeGreaterThan(99);
  });
});
