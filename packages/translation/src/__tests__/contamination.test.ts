import { describe, expect, it } from 'vitest';
import {
  checkContamination,
  assertNoContamination,
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

  it('respects a custom maxLeakRatio threshold', () => {
    const strict = checkContamination(
      'Karibu the lakini one word leaks the',
      'sw',
      { maxLeakRatio: 0.5 },
    );
    expect(strict.ok).toBe(true);

    const tight = checkContamination(
      'Karibu the lakini one word leaks the',
      'sw',
      { maxLeakRatio: 0.05 },
    );
    expect(tight.ok).toBe(false);
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
