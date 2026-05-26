/**
 * Terminology adherence metric tests.
 *
 * Covers:
 *   - Perfect run → 1.0.
 *   - Missing target term → < 1.0; violation entry is captured.
 *   - Empty entries-used list → 1.0 (vacuous).
 */

import { describe, expect, it } from 'vitest';
import type { GlossaryEntry } from '../types.js';
import { computeTerminologyAdherence } from '../evaluation/terminology-adherence.js';

const PML_ENTRY: GlossaryEntry = Object.freeze({
  srcTerm: 'PML',
  srcLang: 'en',
  targetTerm: 'PML',
  targetLang: 'sw',
  domain: 'mining',
  register: 'neutral',
  brand: true,
});

const ROYALTY_ENTRY: GlossaryEntry = Object.freeze({
  srcTerm: 'royalty',
  srcLang: 'en',
  targetTerm: 'mrabaha',
  targetLang: 'sw',
  domain: 'financial',
  register: 'formal',
});

describe('terminology adherence', () => {
  it('returns 1.0 when every target term survives in the final output', () => {
    const out = 'PML imehifadhiwa na mrabaha umekatwa.';
    const result = computeTerminologyAdherence(out, [PML_ENTRY, ROYALTY_ENTRY]);
    expect(result.score).toBe(1);
    expect(result.violated).toHaveLength(0);
    expect(result.survived).toHaveLength(2);
  });

  it('drops below 1.0 when one target term is missing', () => {
    const out = 'PML imehifadhiwa lakini mtaji umekatwa.'; // no "mrabaha"
    const result = computeTerminologyAdherence(out, [PML_ENTRY, ROYALTY_ENTRY]);
    expect(result.score).toBe(0.5);
    expect(result.violated.map((e) => e.srcTerm)).toContain('royalty');
  });

  it('returns 1.0 trivially when no entries were used', () => {
    const result = computeTerminologyAdherence('whatever', []);
    expect(result.score).toBe(1);
    expect(result.violated).toHaveLength(0);
  });
});
