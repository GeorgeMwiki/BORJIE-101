/**
 * Tests for the noun-class detector (Wave 19H).
 *
 * Covers ten example words across the canonical Swahili noun classes,
 * plus the plural-derivation helper.
 */

import { describe, it, expect } from 'vitest';
import {
  detectNounClass,
  derivePluralClass,
  derivePluralSurface,
} from '../morphology/noun-class-detector.js';
import { SwahiliLinguisticsError } from '../types.js';

describe('detectNounClass', () => {
  it('detects class 1/2 — mtu / watu (human)', () => {
    const mtu = detectNounClass('mtu');
    expect(mtu.nounClass).toBe(1);
    expect(mtu.pluralClass).toBe(2);
    expect(mtu.isAnimate).toBe(true);

    const watu = detectNounClass('watu');
    expect(watu.nounClass).toBe(2);
    expect(watu.isAnimate).toBe(true);
  });

  it('detects class 3/4 — mgodi / migodi (mine)', () => {
    const mgodi = detectNounClass('mgodi');
    expect(mgodi.nounClass).toBe(3);
    expect(mgodi.pluralClass).toBe(4);
    expect(mgodi.isAnimate).toBe(false);

    const migodi = detectNounClass('migodi');
    expect(migodi.nounClass).toBe(4);
  });

  it('detects class 5/6 — jambo / mambo + jiwe / mawe', () => {
    expect(detectNounClass('jambo').nounClass).toBe(5);
    expect(detectNounClass('mambo').nounClass).toBe(6);
    expect(detectNounClass('jiwe').nounClass).toBe(5);
    expect(detectNounClass('mawe').nounClass).toBe(6);
  });

  it('detects class 7/8 — kitabu / vitabu + kibali / vibali', () => {
    const kitabu = detectNounClass('kitabu');
    expect(kitabu.nounClass).toBe(7);
    expect(kitabu.pluralClass).toBe(8);

    expect(detectNounClass('vitabu').nounClass).toBe(8);
    expect(detectNounClass('kibali').nounClass).toBe(7);
    expect(detectNounClass('vibali').nounClass).toBe(8);
  });

  it('detects class 9/10 — ndizi (invariant)', () => {
    expect(detectNounClass('ndizi').nounClass).toBe(9);
    expect(detectNounClass('dhahabu').nounClass).toBe(9);
    expect(detectNounClass('almasi').nounClass).toBe(9);
  });

  it('detects class 11 — uchimbaji (act of mining)', () => {
    const uchimbaji = detectNounClass('uchimbaji');
    expect(uchimbaji.nounClass).toBe(11);
    expect(uchimbaji.pluralClass).toBeNull();
  });

  it('detects class 15 — kuchimba (infinitive verbal noun)', () => {
    expect(detectNounClass('kuchimba').nounClass).toBe(15);
  });

  it('detects class 16 — mahali (definite location)', () => {
    expect(detectNounClass('mahali').nounClass).toBe(16);
  });

  it('applies animate-override on kiongozi (formally cl. 7, animate cl. 1)', () => {
    const result = detectNounClass('kiongozi');
    expect(result.nounClass).toBe(7);
    expect(result.isAnimate).toBe(true);
  });

  it('mchimbaji / wachimbaji round-trip (cl. 1 → cl. 2 animate)', () => {
    const mchimbaji = detectNounClass('mchimbaji');
    expect(mchimbaji.nounClass).toBe(1);
    expect(mchimbaji.pluralClass).toBe(2);
    expect(mchimbaji.isAnimate).toBe(true);

    const wachimbaji = detectNounClass('wachimbaji');
    expect(wachimbaji.nounClass).toBe(2);
    expect(wachimbaji.isAnimate).toBe(true);
  });

  it('throws on empty input', () => {
    expect(() => detectNounClass('')).toThrow(SwahiliLinguisticsError);
    expect(() => detectNounClass('   ')).toThrow(SwahiliLinguisticsError);
  });
});

describe('derivePluralClass', () => {
  it('maps singular → plural class pairings canonically', () => {
    expect(derivePluralClass(1)).toBe(2);
    expect(derivePluralClass(3)).toBe(4);
    expect(derivePluralClass(5)).toBe(6);
    expect(derivePluralClass(7)).toBe(8);
    expect(derivePluralClass(9)).toBe(10);
    expect(derivePluralClass(11)).toBe(10);
    expect(derivePluralClass(15)).toBeNull();
  });
});

describe('derivePluralSurface', () => {
  it('produces watu from mtu via override', () => {
    expect(derivePluralSurface('mtu')).toBe('watu');
  });
  it('produces vitabu from kitabu via prefix swap', () => {
    expect(derivePluralSurface('kitabu')).toBe('vitabu');
  });
  it('keeps ndizi invariant for class 9 → 10', () => {
    expect(derivePluralSurface('ndizi')).toBe('ndizi');
  });
});
