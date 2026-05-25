import { describe, it, expect } from 'vitest';
import {
  buildGlossaryRegistry,
  getDefaultGlossaryRegistry,
  lookupTerm,
  searchByText,
  byJurisdiction,
  byCategory,
  translate,
  computeCoverage,
} from '../lookup.js';
import { TENANCY_ENTRIES } from '../glossary-data/tenancy.js';

describe('estate-glossary/lookup', () => {
  const registry = getDefaultGlossaryRegistry();

  it('builds a non-empty registry', () => {
    expect(registry.size).toBeGreaterThan(300);
    expect(registry.entries.length).toBe(registry.size);
  });

  it('refuses duplicate termIds in a custom corpus', () => {
    const first = TENANCY_ENTRIES[0];
    expect(() => buildGlossaryRegistry([first, first])).toThrowError(/duplicate/i);
  });

  it('looks up a canonical term by id', () => {
    const entry = lookupTerm('tenancy.lease');
    expect(entry).toBeDefined();
    expect(entry?.english).toBe('lease');
    expect(entry?.category).toBe('tenancy');
  });

  it('returns undefined for unknown ids', () => {
    expect(lookupTerm('made.up.id')).toBeUndefined();
  });

  it('searches English text case-insensitively', () => {
    const hits = searchByText('LEASE');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((e) => e.termId === 'tenancy.lease')).toBe(true);
  });

  it('searches by Swahili translation when locale filter is given', () => {
    const hits = searchByText('kodi', { locale: 'sw' });
    expect(hits.some((e) => e.termId === 'finance.rent')).toBe(true);
  });

  it('filters results by jurisdiction and category', () => {
    const kenyanTenancy = searchByText('tenancy', { jurisdiction: 'KE', category: 'tenancy' });
    expect(kenyanTenancy.every((e) => e.jurisdictions.includes('KE'))).toBe(true);
    expect(kenyanTenancy.every((e) => e.category === 'tenancy')).toBe(true);
  });

  it('applies a limit when given', () => {
    const limited = byCategory('finance', { limit: 3 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it('returns jurisdiction-scoped entries', () => {
    const keEntries = byJurisdiction('KE');
    expect(keEntries.length).toBeGreaterThan(0);
    expect(keEntries.every((e) => e.jurisdictions.includes('KE'))).toBe(true);
  });

  it('translates to locale when available and falls back to English', () => {
    expect(translate('finance.rent', 'sw')).toBe('kodi');
    // A locale where translation is empty must fall back to English
    const hindi = translate('finance.rent', 'hi');
    expect(hindi).toBeTruthy();
  });

  it('produces a coverage report with all locales present', () => {
    const cov = computeCoverage();
    expect(cov.totalEntries).toBe(registry.size);
    expect(cov.translationCoverage.en).toBe(registry.size);
    expect(cov.byCategory.tenancy).toBeGreaterThan(0);
    expect(cov.byCategory.finance).toBeGreaterThan(0);
    expect(cov.byCategory.compliance).toBeGreaterThan(0);
    expect(cov.byJurisdiction.KE).toBeGreaterThan(0);
    expect(cov.entriesWithCitations).toBeGreaterThan(0);
  });

  it('returns empty array for blank queries', () => {
    expect(searchByText('')).toEqual([]);
    expect(searchByText('   ')).toEqual([]);
  });
});
