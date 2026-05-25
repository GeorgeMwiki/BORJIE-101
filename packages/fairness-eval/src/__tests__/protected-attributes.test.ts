import { describe, expect, it } from 'vitest';
import {
  attributesFor,
  DEFAULT_ATTRIBUTES,
  FAIR_HOUSING_ACT_ATTRIBUTES,
  KE_ANTI_DISCRIMINATION_ATTRIBUTES,
  TZ_ANTI_DISCRIMINATION_ATTRIBUTES,
} from '../protected-attributes.js';

describe('protected-attribute registry', () => {
  it('ships 7 Fair Housing Act categories', () => {
    expect(FAIR_HOUSING_ACT_ATTRIBUTES.map((a) => a.id).sort()).toEqual([
      'color',
      'disability',
      'familial_status',
      'national_origin',
      'race',
      'religion',
      'sex',
    ]);
  });

  it('ships 5 TZ anti-discrimination categories', () => {
    expect(TZ_ANTI_DISCRIMINATION_ATTRIBUTES.map((a) => a.id).sort()).toEqual([
      'disability',
      'gender',
      'marital_status',
      'pregnancy',
      'tribe',
    ]);
  });

  it('ships 6 KE anti-discrimination categories', () => {
    expect(KE_ANTI_DISCRIMINATION_ATTRIBUTES.map((a) => a.id).sort()).toEqual([
      'disability',
      'gender',
      'marital_status',
      'pregnancy',
      'religion',
      'tribe',
    ]);
  });

  it('every spec has a citation', () => {
    for (const spec of DEFAULT_ATTRIBUTES) {
      expect(spec.citation.length).toBeGreaterThan(5);
    }
  });

  it('every spec has at least 2 values to flip across', () => {
    for (const spec of DEFAULT_ATTRIBUTES) {
      expect(spec.values.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('attributesFor(US) returns only Fair Housing Act items', () => {
    const us = attributesFor('US');
    expect(us.map((a) => a.id).sort()).toEqual(
      FAIR_HOUSING_ACT_ATTRIBUTES.map((a) => a.id).sort(),
    );
  });

  it('attributesFor(TZ) returns TZ items', () => {
    const tz = attributesFor('TZ');
    expect(tz.length).toBeGreaterThan(0);
    for (const a of tz) {
      expect(a.jurisdictions).toContain('TZ');
    }
  });

  it('attributesFor de-duplicates by id when registries overlap', () => {
    const ke = attributesFor('KE');
    const ids = ke.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('attributesFor returns empty for unknown jurisdiction', () => {
    expect(attributesFor('ZZ')).toHaveLength(0);
  });
});
