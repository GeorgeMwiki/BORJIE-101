import { describe, expect, it } from 'vitest';
import {
  checkContamination,
  assertNoContamination,
  hasOffTargetLeak,
  offTargetRatio,
  ContaminationError,
} from '../contamination.js';

describe('checkContamination', () => {
  it('passes pure Swahili output when target is sw', () => {
    const result = checkContamination(
      'Karibu Borjie. Akaunti yako iko tayari kwa matumizi.',
      'sw',
    );
    expect(result.ok).toBe(true);
    expect(result.leakedTokens).toEqual([]);
  });

  it('flags English leak inside Swahili output', () => {
    const result = checkContamination(
      'Karibu Borjie. The account is ready for you to use because it was created today.',
      'sw',
    );
    expect(result.ok).toBe(false);
    expect(result.leakedTokens).toContain('the');
    expect(result.leakedTokens).toContain('because');
  });

  it('flags Swahili leak inside English output', () => {
    const result = checkContamination(
      'Welcome. Akaunti yako ni ready kwa matumizi.',
      'en',
    );
    expect(result.ok).toBe(false);
    expect(result.leakedTokens).toContain('kwa');
    expect(result.leakedTokens).toContain('na' === 'na' ? 'ni' : 'ni');
  });

  it('returns ok=true for empty text', () => {
    const result = checkContamination('', 'sw');
    expect(result.ok).toBe(true);
    expect(result.tokensChecked).toBe(0);
  });

  it('respects a custom maxLeakRatio threshold when hard-leak failure is OFF', () => {
    const lenient = checkContamination(
      'Karibu the lakini one word leaks the',
      'sw',
      { maxLeakRatio: 0.5, failOnHardLeak: false },
    );
    expect(lenient.ok).toBe(true);

    const tight = checkContamination(
      'Karibu the lakini one word leaks the',
      'sw',
      { maxLeakRatio: 0.05, failOnHardLeak: false },
    );
    expect(tight.ok).toBe(false);
  });

  it('fails CLOSED by default: a single wrong-language token is not ok', () => {
    // Even a high ratio tolerance cannot save it once hard-leak failure
    // is on (the default) - this is the zero-mix guarantee.
    const result = checkContamination(
      'Karibu the lakini one word leaks the',
      'sw',
      { maxLeakRatio: 0.9 },
    );
    expect(result.ok).toBe(false);
    expect(result.hasHardLeak).toBe(true);
  });
});

describe('assertNoContamination', () => {
  it('throws ContaminationError on leak', () => {
    expect(() =>
      assertNoContamination(
        'Karibu the because while which would these',
        'sw',
      ),
    ).toThrow(ContaminationError);
  });

  it('does not throw on clean Swahili', () => {
    expect(() =>
      assertNoContamination('Karibu Borjie. Akaunti yako iko tayari.', 'sw'),
    ).not.toThrow();
  });
});

describe('checkContamination content-word leaks (zero-mix)', () => {
  it('catches a single Swahili CONTENT word in an English reply', () => {
    // The module docstring example: a content-word leak the old
    // function-word-only lexicon scored as 0 leak and shipped MIXED.
    const result = checkContamination('AI Credit biashara Officer', 'en');
    expect(result.ok).toBe(false);
    expect(result.hasHardLeak).toBe(true);
    expect(result.leakedTokens).toContain('biashara');
  });

  it('catches an unlisted Swahili token by morphology, not dictionary', () => {
    // "wakala" (agent) and "kitabu" (book) are NOT in any lexicon here;
    // they are caught by Bantu-prefix + vowel-final shape.
    const result = checkContamination(
      'The report names the wakala and the kitabu.',
      'en',
    );
    expect(result.ok).toBe(false);
    expect(result.hasHardLeak).toBe(true);
  });

  it('does not flag a clean English sentence', () => {
    const result = checkContamination(
      'The report is ready and the account balance is available today.',
      'en',
    );
    expect(result.ok).toBe(true);
    expect(result.hasHardLeak).toBe(false);
    expect(result.leakedTokens).toEqual([]);
  });

  it('does not flag a clean Swahili sentence', () => {
    const result = checkContamination(
      'Ripoti iko tayari na salio la akaunti linapatikana leo.',
      'sw',
    );
    expect(result.ok).toBe(true);
    expect(result.hasHardLeak).toBe(false);
  });
});

describe('offTargetRatio + hasOffTargetLeak', () => {
  it('hasOffTargetLeak is true for a lone content-word leak whose ratio is tiny', () => {
    const text =
      'The mining royalty report for the quarter is ready and the ' +
      'account balance is available for review by the officer biashara.';
    // The ratio is small (one leak in many tokens) but the hard-leak
    // signal still fires - this is what makes the rewriter fail-closed.
    expect(offTargetRatio(text, 'en')).toBeGreaterThan(0);
    expect(offTargetRatio(text, 'en')).toBeLessThan(0.1);
    expect(hasOffTargetLeak(text, 'en')).toBe(true);
  });

  it('hasOffTargetLeak is false for clean text', () => {
    expect(hasOffTargetLeak('The account is ready today.', 'en')).toBe(false);
    expect(offTargetRatio('The account is ready today.', 'en')).toBe(0);
  });
});
