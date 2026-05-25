import { describe, expect, it } from 'vitest';
import {
  ALL_JURISDICTIONS,
  KE_ART27_PROTECTIONS,
  PROTECTION_REGISTRY,
  TZ_ART13_PROTECTIONS,
  UK_EQUALITY_ACT_PROTECTIONS,
  US_ECOA_PROTECTIONS,
  US_FHA_PROTECTIONS,
  getApplicableProtections,
} from '../registry.js';

describe('PROTECTION_REGISTRY', () => {
  it('covers all 5 jurisdictions', () => {
    expect([...ALL_JURISDICTIONS].sort()).toEqual(['KE', 'TZ', 'UK', 'US-ECOA', 'US-FHA']);
    expect(Object.keys(PROTECTION_REGISTRY).sort()).toEqual(
      ['KE', 'TZ', 'UK', 'US-ECOA', 'US-FHA'],
    );
  });

  it('US-FHA lists the 7 statutory categories', () => {
    expect(US_FHA_PROTECTIONS.length).toBe(7);
    const ids = US_FHA_PROTECTIONS.map((p) => p.id).sort();
    expect(ids).toContain('race');
    expect(ids).toContain('color');
    expect(ids).toContain('religion');
    expect(ids).toContain('sex');
    expect(ids).toContain('familial_status');
    expect(ids).toContain('national_origin');
    expect(ids).toContain('disability');
  });

  it('US-ECOA lists 9 prohibited bases', () => {
    expect(US_ECOA_PROTECTIONS.length).toBe(9);
  });

  it('UK Equality Act lists 9 protected characteristics', () => {
    expect(UK_EQUALITY_ACT_PROTECTIONS.length).toBe(9);
  });

  it('KE Article 27 lists the 13 enumerated grounds', () => {
    expect(KE_ART27_PROTECTIONS.length).toBe(13);
  });

  it('TZ Article 13 lists 11 grounds (incl. PWD Act + ELRA carve-outs)', () => {
    expect(TZ_ART13_PROTECTIONS.length).toBe(11);
  });

  it('every protection has a non-empty citation', () => {
    for (const j of ALL_JURISDICTIONS) {
      for (const p of PROTECTION_REGISTRY[j]) {
        expect(p.citation.length).toBeGreaterThan(0);
        expect(p.contexts.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('getApplicableProtections', () => {
  it('returns full list when no context supplied', () => {
    const out = getApplicableProtections({ jurisdiction: 'UK' });
    expect(out.length).toBe(9);
  });

  it('filters by context — ECOA "public_assistance" only in credit', () => {
    const credit = getApplicableProtections({ jurisdiction: 'US-ECOA', context: 'credit' });
    expect(credit.some((p) => p.id === 'public_assistance')).toBe(true);
    const housing = getApplicableProtections({ jurisdiction: 'US-ECOA', context: 'housing' });
    expect(housing.some((p) => p.id === 'public_assistance')).toBe(false);
  });

  it('returns FHA categories under "housing" context', () => {
    const housing = getApplicableProtections({ jurisdiction: 'US-FHA', context: 'housing' });
    expect(housing.length).toBe(7);
  });

  it('throws for unknown jurisdiction', () => {
    expect(() => getApplicableProtections({ jurisdiction: 'ZZ' })).toThrow();
  });

  it('TZ "age" + "pregnancy" surface in employment context', () => {
    const employment = getApplicableProtections({ jurisdiction: 'TZ', context: 'employment' });
    const ids = employment.map((p) => p.id);
    expect(ids).toContain('age');
    expect(ids).toContain('pregnancy');
  });
});
