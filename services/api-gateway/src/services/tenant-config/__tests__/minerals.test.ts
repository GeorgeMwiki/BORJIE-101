/**
 * Mineral catalogue + tenant gate tests — Issue #207 (world-scale), WS-5.
 */

import { describe, it, expect } from 'vitest';

import {
  MINERAL_CATALOGUE,
  getMineral,
  isMineralAllowedForTenant,
  labelForMineral,
} from '../minerals.js';
import { JURISDICTION_DEFAULTS } from '../jurisdictions.js';
import type { TenantConfig } from '../types.js';

function tenant(
  allowed: ReadonlyArray<string>,
  lang: TenantConfig['defaultLanguage'] = 'en',
): TenantConfig {
  return Object.freeze({
    tenantId: 't',
    countryCode: 'TZ',
    defaultCurrency: 'TZS',
    defaultLanguage: lang,
    regulatorSet: 'TZ-set',
    allowedMinerals: allowed,
  });
}

describe('MINERAL_CATALOGUE', () => {
  it('contains gold, copper, lithium, coal, diamond, tanzanite, ruby, sapphire', () => {
    const slugs = MINERAL_CATALOGUE.map((m) => m.slug);
    expect(slugs).toContain('gold');
    expect(slugs).toContain('copper');
    expect(slugs).toContain('lithium');
    expect(slugs).toContain('coal');
    expect(slugs).toContain('diamond');
    expect(slugs).toContain('tanzanite');
    expect(slugs).toContain('ruby');
    expect(slugs).toContain('sapphire');
  });

  it('covers every mineral listed in any jurisdiction default', () => {
    const inJur = new Set(
      JURISDICTION_DEFAULTS.flatMap((j) => [...j.mineralAllowlist]),
    );
    const inCatalogue = new Set(MINERAL_CATALOGUE.map((m) => m.slug));
    for (const slug of inJur) {
      expect(
        inCatalogue.has(slug),
        `jurisdiction default ${slug} missing from MINERAL_CATALOGUE`,
      ).toBe(true);
    }
  });

  it('has unique slugs', () => {
    const seen = new Set<string>();
    for (const m of MINERAL_CATALOGUE) {
      expect(seen.has(m.slug), `duplicate ${m.slug}`).toBe(false);
      seen.add(m.slug);
    }
  });

  it('every entry has non-empty english + swahili labels', () => {
    for (const m of MINERAL_CATALOGUE) {
      expect(m.nameEn.length).toBeGreaterThan(0);
      expect(m.nameSw.length).toBeGreaterThan(0);
    }
  });
});

describe('getMineral', () => {
  it('returns the catalogue row by slug', () => {
    const gold = getMineral('gold');
    expect(gold?.nameEn).toBe('Gold');
    expect(gold?.nameSw).toBe('Dhahabu');
  });
  it('returns null for unknown slug', () => {
    expect(getMineral('unobtanium')).toBeNull();
  });
});

describe('isMineralAllowedForTenant', () => {
  it('returns true when the slug is in the allowlist', () => {
    expect(isMineralAllowedForTenant(tenant(['gold']), 'gold')).toBe(true);
  });
  it('returns false when the slug is NOT in the allowlist', () => {
    expect(isMineralAllowedForTenant(tenant(['gold']), 'lithium')).toBe(false);
  });
  it('returns false for an empty allowlist (zero-allow tenant)', () => {
    expect(isMineralAllowedForTenant(tenant([]), 'gold')).toBe(false);
  });
});

describe('labelForMineral', () => {
  it('returns en + sw labels for a TZ tenant', () => {
    const labels = labelForMineral(tenant(['gold'], 'sw'), 'gold');
    expect(labels.en).toBe('Gold');
    expect(labels.sw).toBe('Dhahabu');
    // No local label for sw — it's already the primary
    expect(labels.local).toBeNull();
  });

  it('returns es local label for a CL tenant', () => {
    const labels = labelForMineral(tenant(['copper'], 'es'), 'copper');
    expect(labels.local).toBe('Cobre');
  });

  it('returns id local label for an ID tenant', () => {
    const labels = labelForMineral(tenant(['nickel'], 'id'), 'nickel');
    expect(labels.local).toBe('Nikel');
  });

  it('falls back to slug for unknown mineral', () => {
    const labels = labelForMineral(tenant(['gold'], 'en'), 'unobtanium');
    expect(labels.en).toBe('unobtanium');
  });
});
