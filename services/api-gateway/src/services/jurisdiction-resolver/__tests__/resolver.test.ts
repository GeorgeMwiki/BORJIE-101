/**
 * Jurisdiction resolver tests — JA-1.
 *
 * Covers:
 *   - default resolution from tenant row (TZ + non-TZ)
 *   - override resolution (KE / UG / AU) without tenant mutation
 *   - unseeded override (PE) returns source='unseeded'
 *   - empty tenant id rejected
 *   - detector parses common message patterns
 *   - prompt rendering shape stable
 */

import { describe, it, expect } from 'vitest';

import {
  createJurisdictionResolver,
  detectJurisdiction,
  isSeededOverride,
  renderJurisdictionBlock,
  renderJurisdictionDisclosureRules,
  renderJurisdictionPromptSection,
} from '../index.js';
import type { TenantConfig, TenantConfigService } from '../../tenant-config/types.js';

function fakeTenantConfig(rows: Record<string, TenantConfig>): TenantConfigService {
  return {
    async get(tenantId: string) {
      const row = rows[tenantId];
      if (!row) {
        throw new Error(`tenant-config: tenant not found id=${tenantId}`);
      }
      return row;
    },
  };
}

const TZ_CONFIG: TenantConfig = Object.freeze({
  tenantId: 't-tz-1',
  countryCode: 'TZ',
  defaultCurrency: 'TZS',
  defaultLanguage: 'sw',
  regulatorSet: 'TZ-set',
  allowedMinerals: Object.freeze(['gold', 'tanzanite']),
});

const KE_CONFIG: TenantConfig = Object.freeze({
  tenantId: 't-ke-1',
  countryCode: 'KE',
  defaultCurrency: 'KES',
  defaultLanguage: 'sw-KE',
  regulatorSet: 'KE-set',
  allowedMinerals: Object.freeze(['gold', 'fluorspar']),
});

describe('JurisdictionResolver — default path (tenant row)', () => {
  it('returns the tenant snapshot for a TZ tenant', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const out = await resolver.resolve('t-tz-1');
    expect(out.country).toBe('TZ');
    expect(out.countryName).toBe('Tanzania');
    expect(out.currency).toBe('TZS');
    expect(out.defaultLanguage).toBe('sw');
    expect(out.timeZone).toBe('Africa/Dar_es_Salaam');
    expect(out.mineralAuthorities.mineralAuthority).toBe('PCCB');
    expect(out.environmentalAuthority).toBe('NEMC');
    expect(out.transparencyInitiative).toBe('EITI');
    expect(out.auditAuthority).toBe('TMAA');
    expect(out.source).toBe('tenant');
  });

  it('returns the tenant snapshot for a KE tenant (non-TZ defaults)', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-ke-1': KE_CONFIG }),
    });
    const out = await resolver.resolve('t-ke-1');
    expect(out.country).toBe('KE');
    expect(out.currency).toBe('KES');
    expect(out.mineralAuthorities.mineralAuthority).toBe('State Department of Mining');
    expect(out.environmentalAuthority).toBe('NEMA-KE');
    expect(out.source).toBe('tenant');
    expect(out.locale).toBe('sw-KE');
  });

  it('rejects empty tenant id', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({}),
    });
    await expect(resolver.resolve('')).rejects.toThrow(/tenantId is required/);
  });
});

describe('JurisdictionResolver — override path', () => {
  it('returns KE snapshot when TZ tenant overrides to KE — tenant row NOT mutated', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const out = await resolver.resolve('t-tz-1', 'KE');
    expect(out.country).toBe('KE');
    expect(out.currency).toBe('KES');
    expect(out.mineralAuthorities.mineralAuthority).toBe('State Department of Mining');
    expect(out.source).toBe('override');

    // Default call (no override) still returns TZ — proves we
    // didn't touch the tenant row.
    const after = await resolver.resolve('t-tz-1');
    expect(after.country).toBe('TZ');
  });

  it('returns AU snapshot when AU override applied', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const out = await resolver.resolve('t-tz-1', 'au');
    expect(out.country).toBe('AU');
    expect(out.currency).toBe('AUD');
    expect(out.mineralAuthorities.mineralAuthority).toContain('State Mining Authorities');
    expect(out.source).toBe('override');
  });

  it('returns source=unseeded for Peru override', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const out = await resolver.resolve('t-tz-1', 'PE');
    expect(out.country).toBe('PE');
    expect(out.source).toBe('unseeded');
    expect(out.mineralAuthorities.mineralAuthority).toBe('unknown');
  });
});

describe('isSeededOverride', () => {
  it('returns true for seeded jurisdictions', () => {
    expect(isSeededOverride('TZ')).toBe(true);
    expect(isSeededOverride('KE')).toBe(true);
    expect(isSeededOverride('au')).toBe(true);
    expect(isSeededOverride('id')).toBe(true);
  });

  it('returns false for unseeded codes', () => {
    expect(isSeededOverride('PE')).toBe(false);
    expect(isSeededOverride('ZZ')).toBe(false);
    expect(isSeededOverride('GH')).toBe(false);
  });
});

describe('detectJurisdiction', () => {
  it('detects "in Kenya"', () => {
    expect(detectJurisdiction('in Kenya we file royalties monthly')).toBe('KE');
  });

  it('detects "for our Uganda operation"', () => {
    expect(detectJurisdiction('for our Uganda operation we use NEMA')).toBe('UG');
  });

  it('detects "what if I export to South Africa"', () => {
    expect(detectJurisdiction('what if I export to South Africa next month?')).toBe('ZA');
  });

  it('detects "we operate in Mwadui, Tanzania" → TZ via city OR country', () => {
    const out = detectJurisdiction('we operate in Mwadui, Tanzania');
    expect(out).toBe('TZ');
  });

  it('detects Mwadui (region hint) when country name absent', () => {
    expect(detectJurisdiction('we operate in Mwadui pit area')).toBe('TZ');
  });

  it('detects Peru (unseeded) for graceful fallback path', () => {
    expect(detectJurisdiction('in Peru what is the rate?')).toBe('PE');
  });

  it('returns null when no jurisdiction mentioned', () => {
    expect(detectJurisdiction('what is my royalty rate today?')).toBeNull();
    expect(detectJurisdiction('hello')).toBeNull();
    expect(detectJurisdiction('')).toBeNull();
  });

  it('avoids false positives on common English words (idiot → no ID)', () => {
    expect(detectJurisdiction('I am not an idiot')).toBeNull();
    expect(detectJurisdiction('the kid is here')).toBeNull();
  });

  it('detects alpha-2 only with preposition prefix', () => {
    expect(detectJurisdiction('in CL the rule is different')).toBe('CL');
    expect(detectJurisdiction('our AU mine')).toBe('AU');
    expect(detectJurisdiction('CL is great')).toBeNull(); // no preposition
  });
});

describe('Jurisdiction prompt rendering', () => {
  it('renders the TENANT JURISDICTION block with all fields', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const resolved = await resolver.resolve('t-tz-1');
    const text = renderJurisdictionBlock(resolved);
    expect(text).toContain('## TENANT JURISDICTION');
    expect(text).toContain('Country: TZ');
    expect(text).toContain('PCCB');
    expect(text).toContain('NEMC');
    expect(text).toContain('EITI');
    expect(text).toContain('TMAA');
    expect(text).toContain('Africa/Dar_es_Salaam');
    expect(text).toContain('TZS');
  });

  it('renders the Swahili variant of the block', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const resolved = await resolver.resolve('t-tz-1');
    const text = renderJurisdictionBlock(resolved, { language: 'sw' });
    expect(text).toContain('Nchi: TZ');
    expect(text).toContain('Sarafu');
  });

  it('renders the JURISDICTION DISCLOSURE RULES block', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const resolved = await resolver.resolve('t-tz-1');
    const text = renderJurisdictionDisclosureRules(resolved);
    expect(text).toContain('JURISDICTION DISCLOSURE RULES');
    expect(text).toContain('Currency conversion');
  });

  it('renderJurisdictionPromptSection joins both blocks', async () => {
    const resolver = createJurisdictionResolver({
      tenantConfig: fakeTenantConfig({ 't-tz-1': TZ_CONFIG }),
    });
    const resolved = await resolver.resolve('t-tz-1');
    const text = renderJurisdictionPromptSection(resolved);
    expect(text).toContain('## TENANT JURISDICTION');
    expect(text).toContain('JURISDICTION DISCLOSURE RULES');
  });
});
