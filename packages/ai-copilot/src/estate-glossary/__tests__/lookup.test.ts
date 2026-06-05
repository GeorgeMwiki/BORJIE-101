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
import { MINING_RIGHTS_ENTRIES } from '../glossary-data/mining-rights.js';

describe('estate-glossary/lookup', () => {
  const registry = getDefaultGlossaryRegistry();

  it('builds a non-empty registry', () => {
    expect(registry.size).toBeGreaterThan(300);
    expect(registry.entries.length).toBe(registry.size);
  });

  it('refuses duplicate termIds in a custom corpus', () => {
    const first = MINING_RIGHTS_ENTRIES[0];
    expect(() => buildGlossaryRegistry([first, first])).toThrowError(/duplicate/i);
  });

  it('looks up a canonical term by id', () => {
    const entry = lookupTerm('tenancy.mineral_right');
    expect(entry).toBeDefined();
    expect(entry?.english).toBe('mineral right');
    expect(entry?.category).toBe('tenancy');
  });

  it('returns undefined for unknown ids', () => {
    expect(lookupTerm('made.up.id')).toBeUndefined();
  });

  it('searches English text case-insensitively', () => {
    const hits = searchByText('MINERAL RIGHT');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((e) => e.termId === 'tenancy.mineral_right')).toBe(true);
  });

  it('searches by Swahili translation when locale filter is given', () => {
    const hits = searchByText('mrabaha', { locale: 'sw' });
    expect(hits.some((e) => e.termId === 'finance.royalty')).toBe(true);
  });

  it('filters results by jurisdiction and category', () => {
    const tzMineralRights = searchByText('mineral', { jurisdiction: 'TZ', category: 'tenancy' });
    expect(tzMineralRights.every((e) => e.jurisdictions.includes('TZ'))).toBe(true);
    expect(tzMineralRights.every((e) => e.category === 'tenancy')).toBe(true);
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
    expect(translate('finance.royalty', 'sw')).toBe('mrabaha');
    // A locale where translation is empty must fall back to English
    const hindi = translate('finance.royalty', 'hi');
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
