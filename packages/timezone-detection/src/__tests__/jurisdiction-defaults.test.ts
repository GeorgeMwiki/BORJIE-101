import { describe, expect, it } from 'vitest';
import { isValidTimezone } from '../detect/validate.js';
import {
  AFRICA_DEFAULTS,
  ALL_JURISDICTION_DEFAULTS,
  JURISDICTION_DEFAULTS_COUNT,
  REST_OF_WORLD_DEFAULTS,
  getJurisdictionDefault,
} from '../jurisdiction-defaults/index.js';

describe('jurisdiction-defaults — Africa coverage', () => {
  it('ships defaults for all 54 African jurisdictions', () => {
    expect(AFRICA_DEFAULTS.length).toBe(54);
  });

  it('every African entry maps to a valid IANA timezone', () => {
    for (const e of AFRICA_DEFAULTS) {
      expect(isValidTimezone(e.timezone), `${e.jurisdiction} → ${e.timezone}`).toBe(
        true,
      );
    }
  });

  it('no African entry observes DST (Africa as of 2026)', () => {
    for (const e of AFRICA_DEFAULTS) {
      expect(e.observesDST, `${e.jurisdiction} should not observe DST`).toBe(false);
    }
  });

  it('every African alpha-2 code is unique', () => {
    const codes = AFRICA_DEFAULTS.map((e) => e.jurisdiction);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('jurisdiction-defaults — Rest of world coverage', () => {
  it('every ROW entry maps to a valid IANA timezone', () => {
    for (const e of REST_OF_WORLD_DEFAULTS) {
      expect(isValidTimezone(e.timezone), `${e.jurisdiction} → ${e.timezone}`).toBe(
        true,
      );
    }
  });

  it('every ROW alpha-2 code is unique', () => {
    const codes = REST_OF_WORLD_DEFAULTS.map((e) => e.jurisdiction);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('US is flagged multi-zone (capital fallback only)', () => {
    const us = REST_OF_WORLD_DEFAULTS.find((e) => e.jurisdiction === 'US');
    expect(us?.isMultiZone).toBe(true);
  });

  it('GB observes DST', () => {
    const gb = REST_OF_WORLD_DEFAULTS.find((e) => e.jurisdiction === 'GB');
    expect(gb?.observesDST).toBe(true);
  });
});

describe('jurisdiction-defaults — combined lookup', () => {
  it('Africa + ROW concatenate to the published count', () => {
    expect(ALL_JURISDICTION_DEFAULTS.length).toBe(JURISDICTION_DEFAULTS_COUNT);
  });

  it('lookup by uppercase alpha-2', () => {
    expect(getJurisdictionDefault('KE')?.timezone).toBe('Africa/Nairobi');
  });

  it('lookup by lowercase alpha-2', () => {
    expect(getJurisdictionDefault('ke')?.timezone).toBe('Africa/Nairobi');
  });

  it('returns undefined for an unknown code', () => {
    expect(getJurisdictionDefault('XX')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(getJurisdictionDefault('')).toBeUndefined();
  });
});
