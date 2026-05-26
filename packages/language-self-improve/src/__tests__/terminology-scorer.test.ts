import { describe, expect, it } from 'vitest';

import {
  computeGlossaryAdherence,
  MINING_GLOSSARY,
} from '../score/terminology-scorer.js';

describe('terminology-scorer', () => {
  it('returns 1.0 for text that uses canonical glossary terms', () => {
    const result = computeGlossaryAdherence(
      'tafadhali nipe namba ya leseni ya tumemadini',
      'sw',
      MINING_GLOSSARY,
    );
    expect(result.applicable).toBeGreaterThan(0);
    expect(result.canonicalHits.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('returns 0.7 weighting when accepted alternates are used', () => {
    const result = computeGlossaryAdherence(
      'I have a Parcel ready for shipment',
      'sw',
      MINING_GLOSSARY,
    );
    expect(result.applicable).toBeGreaterThan(0);
    expect(result.acceptedHits.length).toBeGreaterThan(0);
    expect(result.canonicalHits.length).toBe(0);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('returns score=1 when no glossary term is applicable', () => {
    const result = computeGlossaryAdherence(
      'pikipiki nyingi zinapita karibu nasi',
      'sw',
      MINING_GLOSSARY,
    );
    expect(result.applicable).toBe(0);
    expect(result.score).toBe(1);
  });

  it('returns score=1 on empty text', () => {
    const result = computeGlossaryAdherence('', 'sw', MINING_GLOSSARY);
    expect(result.score).toBe(1);
  });
});
