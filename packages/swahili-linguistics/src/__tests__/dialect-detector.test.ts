/**
 * Tests for the dialect-detector + register-classifier (Wave 19H).
 */

import { describe, it, expect } from 'vitest';
import { detectDialect } from '../dialect/dialect-detector.js';
import { classifyRegister } from '../dialect/register-classifier.js';

describe('detectDialect', () => {
  it('scores a TZ-Bongo utterance toward bongo', () => {
    const result = detectDialect(
      'mambo bongo nimepiga deal na mzee wa mrabaha kuhusu Tumemadini',
    );
    expect(result.topDialect).toBe('bongo');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('scores a Coastal utterance toward coastal', () => {
    const result = detectDialect('hodi karibu sana bwana, jambo, kheri njema');
    expect(result.topDialect).toBe('coastal');
  });

  it('scores a Sheng utterance toward sheng', () => {
    const result = detectDialect(
      'manze nikuje kwa base, mathree iko fiti, soo moja',
    );
    expect(result.topDialect).toBe('sheng');
  });

  it('returns standard for an empty utterance', () => {
    const result = detectDialect('');
    expect(result.topDialect).toBe('standard');
    expect(result.confidence).toBe(0);
  });
});

describe('classifyRegister', () => {
  it('marks a formal request as formal', () => {
    expect(
      classifyRegister(
        'Tafadhali nipe taarifa kuhusu leseni ya uchimbaji mdogo.',
      ),
    ).toBe('formal');
  });

  it('marks a Sheng-laden utterance as sheng', () => {
    expect(classifyRegister('manze mathree iko fiti msee soo moja')).toBe(
      'sheng',
    );
  });

  it('marks a colloquial utterance', () => {
    expect(classifyRegister('haya sawa basi, yaani kweli kabisa')).toBe(
      'colloquial',
    );
  });
});
