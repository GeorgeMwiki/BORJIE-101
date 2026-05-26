/**
 * Code-switching tests.
 *
 * Covers:
 *   - Mixed input (Swahili sentence + English brand "PML" + USD number)
 *     yields brand + number + src segments.
 *   - Proper-noun heuristic catches mid-sentence capitalised tokens
 *     ("Geita").
 */

import { describe, expect, it } from 'vitest';
import { assembleGlossary } from '../glossary/glossary-manager.js';
import { SEED_MINING_GLOSSARY } from '../glossary/seed-mining-glossary.js';
import { segmentCodeSwitch } from '../codeswitch/segmenter.js';

describe('code-switch segmenter', () => {
  it('keeps the English brand PML as a brand segment while translating SW context', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const text = 'Parseli imefika kwa PML.';
    const segments = segmentCodeSwitch(text, 'sw', 'en', glossary);
    const tagsByText = new Map<string, string>();
    for (const seg of segments) {
      tagsByText.set(seg.text, seg.tag);
    }
    expect(tagsByText.get('PML')).toBe('brand');
    // Swahili tokens around the brand are still tagged as src so they
    // enter the translator.
    expect(tagsByText.get('Parseli')).toBeDefined();
  });

  it('tags a number-with-unit token as `number`, never as src or tgt', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const text = 'USD 50000 imekamilika';
    const segments = segmentCodeSwitch(text, 'sw', 'en', glossary);
    const numberSeg = segments.find((s) => s.text === '50000');
    expect(numberSeg).toBeDefined();
    expect(numberSeg?.tag).toBe('number');
  });

  it('preserves the proper-noun place-name "Geita" as proper', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const text = 'Naomba ushauri kuhusu Geita.';
    const segments = segmentCodeSwitch(text, 'sw', 'en', glossary);
    const geita = segments.find((s) => s.text === 'Geita');
    expect(geita).toBeDefined();
    expect(geita?.tag).toBe('proper');
  });

  it('recognises placeholder tokens inside the segmenter output', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const text = 'Ndugu, <<G:0001>> imefika kwa <<G:0002>>.';
    const segments = segmentCodeSwitch(text, 'sw', 'en', glossary);
    const placeholders = segments.filter((s) => s.tag === 'placeholder');
    expect(placeholders).toHaveLength(2);
  });
});
