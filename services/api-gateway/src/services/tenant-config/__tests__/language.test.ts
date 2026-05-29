/**
 * language helpers — Issue #207 (world-scale tenants), WS-2.
 */

import { describe, it, expect } from 'vitest';

import {
  LANGUAGE_CATALOGUE,
  bcp47ForTenant,
  bilingualForTenant,
  coerceSupportedLanguage,
  getLanguageEntry,
} from '../language.js';
import type { TenantConfig } from '../types.js';

function cfg(language: TenantConfig['defaultLanguage']): TenantConfig {
  return Object.freeze({
    tenantId: 't',
    countryCode: 'TZ',
    defaultCurrency: 'TZS',
    defaultLanguage: language,
    regulatorSet: 'TZ-set',
    allowedMinerals: Object.freeze([]),
  });
}

describe('LANGUAGE_CATALOGUE', () => {
  it('covers sw, en, fr, pt, sw-KE, es, id (>= 7 entries)', () => {
    const codes = LANGUAGE_CATALOGUE.map((e) => e.code);
    expect(codes).toContain('sw');
    expect(codes).toContain('en');
    expect(codes).toContain('fr');
    expect(codes).toContain('pt');
    expect(codes).toContain('sw-KE');
    expect(codes).toContain('es');
    expect(codes).toContain('id');
    expect(LANGUAGE_CATALOGUE.length).toBeGreaterThanOrEqual(7);
  });

  it('sw fallback is en (CLAUDE.md Swahili-first stays english as last resort)', () => {
    const sw = getLanguageEntry('sw');
    expect(sw.fallbackTo).toBe('en');
  });

  it('sw-KE fallback is sw (kenyan Swahili shares vocabulary)', () => {
    const swKe = getLanguageEntry('sw-KE');
    expect(swKe.fallbackTo).toBe('sw');
  });

  it('unknown code returns the english entry', () => {
    expect(getLanguageEntry('zz').code).toBe('en');
  });
});

describe('bcp47ForTenant', () => {
  it('returns sw-TZ for a TZ tenant', () => {
    expect(bcp47ForTenant(cfg('sw'))).toBe('sw-TZ');
  });
  it('returns sw-KE for a KE tenant', () => {
    expect(bcp47ForTenant(cfg('sw-KE'))).toBe('sw-KE');
  });
  it('returns es-CL for a CL tenant', () => {
    expect(bcp47ForTenant(cfg('es'))).toBe('es-CL');
  });
  it('returns id-ID for an ID tenant', () => {
    expect(bcp47ForTenant(cfg('id'))).toBe('id-ID');
  });
});

describe('bilingualForTenant', () => {
  it('returns primary in tenant language, fallback in english', () => {
    const out = bilingualForTenant(cfg('sw'), {
      sw: 'Habari',
      en: 'Hello',
    });
    expect(out.primary).toBe('Habari');
    expect(out.fallback).toBe('Hello');
  });

  it('falls back to the language family when own row is missing', () => {
    const out = bilingualForTenant(cfg('sw-KE'), {
      sw: 'Habari',
      en: 'Hello',
    });
    expect(out.primary).toBe('Habari');
  });

  it('falls back to english when nothing else matches', () => {
    const out = bilingualForTenant(cfg('fr'), {
      en: 'Hello',
    });
    expect(out.primary).toBe('Hello');
    expect(out.fallback).toBe('Hello');
  });
});

describe('coerceSupportedLanguage', () => {
  it('passes through valid codes', () => {
    expect(coerceSupportedLanguage('sw')).toBe('sw');
    expect(coerceSupportedLanguage('fr')).toBe('fr');
    expect(coerceSupportedLanguage('id')).toBe('id');
  });

  it('coerces unknown to en (NOT sw — the world default outside TZ is english)', () => {
    expect(coerceSupportedLanguage('zz')).toBe('en');
    expect(coerceSupportedLanguage(null)).toBe('en');
    expect(coerceSupportedLanguage(undefined)).toBe('en');
    expect(coerceSupportedLanguage(123)).toBe('en');
  });
});
