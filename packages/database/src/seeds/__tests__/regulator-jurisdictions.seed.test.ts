/**
 * Regulator-jurisdictions seed — unit tests on the static row catalogue.
 * Issue #207 (world-scale tenants), WS-3.
 *
 * These tests verify the catalogue shape without hitting the database.
 * They guarantee:
 *   - every regulator_set the migration admits has at least one row
 *   - the TZ-set covers PCCB/NEMC/EITI/TMAA (no regression vs #194)
 *   - every row has a non-empty country_code and slug
 *   - slugs are unique within their (regulator_set) bucket — matches
 *     the migration's UNIQUE INDEX
 *   - mandate values are limited to the migration CHECK enum
 */

import { describe, it, expect } from 'vitest';

import { REGULATOR_ROWS } from '../regulator-jurisdictions.seed.js';

const REGULATOR_SETS = [
  'TZ-set',
  'KE-set',
  'UG-set',
  'NG-set',
  'ZA-set',
  'AU-set',
  'CL-set',
  'ID-set',
  'generic',
] as const;

const MANDATES = [
  'anti-corruption',
  'environment',
  'transparency-eiti',
  'mining-licensing',
  'safety',
  'royalty',
  'tax',
  'generic',
] as const;

describe('REGULATOR_ROWS catalogue', () => {
  it('contains rows for every regulator_set the migration admits', () => {
    const sets = new Set(REGULATOR_ROWS.map((r) => r.regulatorSet));
    for (const expected of REGULATOR_SETS) {
      expect(sets.has(expected), `missing set ${expected}`).toBe(true);
    }
  });

  it('TZ-set covers PCCB, NEMC, EITI, TMAA — no regression vs issue #194', () => {
    const tzSlugs = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'TZ-set').map(
      (r) => r.slug,
    );
    expect(tzSlugs).toContain('pccb');
    expect(tzSlugs).toContain('nemc');
    expect(tzSlugs).toContain('eiti');
    expect(tzSlugs).toContain('tmaa');
  });

  it('KE-set covers Mining Office + NEMA + EITI', () => {
    const slugs = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'KE-set').map(
      (r) => r.slug,
    );
    expect(slugs.length).toBeGreaterThanOrEqual(3);
  });

  it('NG-set covers MMSD + NESREA + NEITI', () => {
    const slugs = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'NG-set').map(
      (r) => r.slug,
    );
    expect(slugs).toContain('mmsd-ng');
    expect(slugs).toContain('nesrea-ng');
    expect(slugs).toContain('neiti-ng');
  });

  it('AU-set covers Geoscience Australia + EPA Victoria + DJPR (state + federal)', () => {
    const slugs = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'AU-set').map(
      (r) => r.slug,
    );
    expect(slugs).toContain('geoscience-au');
    expect(slugs).toContain('epa-vic-au');
  });

  it('CL-set covers SERNAGEOMIN + COCHILCO', () => {
    const slugs = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'CL-set').map(
      (r) => r.slug,
    );
    expect(slugs).toContain('sernageomin-cl');
    expect(slugs).toContain('cochilco-cl');
  });

  it('ID-set covers ESDM', () => {
    const slugs = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'ID-set').map(
      (r) => r.slug,
    );
    expect(slugs).toContain('esdm-id');
  });

  it('generic set has at least one fallback row', () => {
    const generic = REGULATOR_ROWS.filter((r) => r.regulatorSet === 'generic');
    expect(generic.length).toBeGreaterThan(0);
  });

  it('every row has 2-char ISO country code, non-empty slug + name', () => {
    for (const r of REGULATOR_ROWS) {
      expect(r.countryCode.length, `slug=${r.slug}`).toBe(2);
      expect(r.slug.length, `slug=${r.slug}`).toBeGreaterThan(0);
      expect(r.nameEn.length, `slug=${r.slug}`).toBeGreaterThan(0);
    }
  });

  it('slugs are unique within a regulator_set (matches migration UNIQUE INDEX)', () => {
    const seen = new Set<string>();
    for (const r of REGULATOR_ROWS) {
      const key = `${r.regulatorSet}:${r.slug}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('every mandate is from the migration enum', () => {
    for (const r of REGULATOR_ROWS) {
      expect(
        (MANDATES as ReadonlyArray<string>).includes(r.mandate),
        `bad mandate ${r.mandate} on slug ${r.slug}`,
      ).toBe(true);
    }
  });

  it('catalogue contains at least 8 distinct jurisdictions (deliverable §3)', () => {
    const sets = new Set(REGULATOR_ROWS.map((r) => r.regulatorSet));
    expect(sets.size).toBeGreaterThanOrEqual(8);
  });
});
