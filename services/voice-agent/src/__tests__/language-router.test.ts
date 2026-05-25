import { describe, expect, it } from 'vitest';

import {
  detectLanguage,
  isEnglish,
  isLuganda,
  isNigerianLanguage,
  isSwahiliFamily,
  SUPPORTED_LANGUAGES,
} from '../router/language-router.js';

describe('detectLanguage', () => {
  it('returns the safest default for null / undefined / empty input', () => {
    expect(detectLanguage(undefined)).toBe('en');
    expect(detectLanguage(null)).toBe('en');
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage('   ')).toBe('en');
  });

  it('canonicalises supported tags case-insensitively', () => {
    expect(detectLanguage('EN')).toBe('en');
    expect(detectLanguage('en-KE')).toBe('en-KE');
    expect(detectLanguage('en-ke')).toBe('en-KE');
    expect(detectLanguage('sw')).toBe('sw');
    expect(detectLanguage('sw-tz')).toBe('sw-TZ');
    expect(detectLanguage('Sheng')).toBe('sheng');
    expect(detectLanguage('LUG')).toBe('lug');
    expect(detectLanguage('yo')).toBe('yo');
  });

  it('maps common aliases onto canonical tags', () => {
    expect(detectLanguage('english')).toBe('en');
    expect(detectLanguage('en-GB')).toBe('en');
    expect(detectLanguage('swahili')).toBe('sw');
    expect(detectLanguage('kiswahili')).toBe('sw');
    expect(detectLanguage('luganda')).toBe('lug');
    expect(detectLanguage('yoruba')).toBe('yo');
    expect(detectLanguage('igbo')).toBe('ig');
    expect(detectLanguage('hausa')).toBe('ha');
  });

  it('falls back to "en" on unknown input rather than throwing', () => {
    expect(detectLanguage('klingon')).toBe('en');
    expect(detectLanguage('zh-CN')).toBe('en');
    expect(detectLanguage('xx-XX')).toBe('en');
  });
});

describe('language family predicates', () => {
  it('classifies the Swahili family', () => {
    expect(isSwahiliFamily('sw')).toBe(true);
    expect(isSwahiliFamily('sw-TZ')).toBe(true);
    expect(isSwahiliFamily('sheng')).toBe(true);
    expect(isSwahiliFamily('en')).toBe(false);
    expect(isSwahiliFamily('yo')).toBe(false);
  });

  it('classifies Luganda variants', () => {
    expect(isLuganda('lug')).toBe(true);
    expect(isLuganda('lg')).toBe(true);
    expect(isLuganda('sw')).toBe(false);
  });

  it('classifies Nigerian languages', () => {
    expect(isNigerianLanguage('yo')).toBe(true);
    expect(isNigerianLanguage('ig')).toBe(true);
    expect(isNigerianLanguage('ha')).toBe(true);
    expect(isNigerianLanguage('sw')).toBe(false);
  });

  it('classifies English variants', () => {
    expect(isEnglish('en')).toBe(true);
    expect(isEnglish('en-KE')).toBe(true);
    expect(isEnglish('sw')).toBe(false);
  });
});

describe('SUPPORTED_LANGUAGES', () => {
  it('includes every tag the routing tables key on', () => {
    expect(SUPPORTED_LANGUAGES).toContain('en');
    expect(SUPPORTED_LANGUAGES).toContain('en-KE');
    expect(SUPPORTED_LANGUAGES).toContain('sw');
    expect(SUPPORTED_LANGUAGES).toContain('sw-TZ');
    expect(SUPPORTED_LANGUAGES).toContain('sheng');
    expect(SUPPORTED_LANGUAGES).toContain('lug');
    expect(SUPPORTED_LANGUAGES).toContain('lg');
    expect(SUPPORTED_LANGUAGES).toContain('yo');
    expect(SUPPORTED_LANGUAGES).toContain('ig');
    expect(SUPPORTED_LANGUAGES).toContain('ha');
  });
});
