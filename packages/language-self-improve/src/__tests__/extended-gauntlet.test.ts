import { describe, expect, it } from 'vitest';

import {
  EXTENDED_GAUNTLET_UTTERANCES,
  EXTENDED_GAUNTLET_VERSION,
  tallyGauntlet,
} from '../gauntlet/extended-gauntlet.js';

describe('extended-gauntlet', () => {
  it('ships exactly 150 new entries (additions to Wave 19F base of 50 → total 200)', () => {
    expect(EXTENDED_GAUNTLET_UTTERANCES).toHaveLength(150);
  });

  it('has version stamp', () => {
    expect(EXTENDED_GAUNTLET_VERSION).toMatch(/^\d+/);
  });

  it('contains all five categories', () => {
    const tally = tallyGauntlet([...EXTENDED_GAUNTLET_UTTERANCES]);
    expect(tally.perCategory.regulatory).toBeGreaterThan(0);
    expect(tally.perCategory.dimensional).toBeGreaterThan(0);
    expect(tally.perCategory.governance).toBeGreaterThan(0);
    expect(tally.perCategory.dialect).toBeGreaterThan(0);
    expect(tally.perCategory.environment).toBeGreaterThan(0);
    expect(tally.perCategory.regulatory).toBe(38);
    expect(tally.perCategory.dimensional).toBe(38);
    expect(tally.perCategory.governance).toBe(30);
    expect(tally.perCategory.dialect).toBe(22);
    expect(tally.perCategory.environment).toBe(22);
  });

  it('is dialect-balanced (Tanzanian-skewed)', () => {
    const tally = tallyGauntlet([...EXTENDED_GAUNTLET_UTTERANCES]);
    // Bongo is the largest dialect — Tanzanian default skew.
    expect(tally.perDialect.bongo).toBeGreaterThan(tally.perDialect.coast);
    expect(tally.perDialect.bongo).toBeGreaterThan(tally.perDialect.sheng);
    // Lake is present (Geita / Mwanza mining belt).
    expect(tally.perDialect.lake).toBeGreaterThan(0);
    // Sheng is the smallest but non-zero (Sheng colouration).
    expect(tally.perDialect.sheng).toBeGreaterThan(0);
  });

  it('every entry has a non-empty referenceTranscript', () => {
    for (const u of EXTENDED_GAUNTLET_UTTERANCES) {
      expect(u.referenceTranscript.trim().length).toBeGreaterThan(0);
      expect(u.id.length).toBeGreaterThan(0);
    }
  });
});
