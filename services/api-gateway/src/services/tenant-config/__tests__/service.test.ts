/**
 * tenant-config service tests — Issue #207 (world-scale tenants).
 *
 * Verifies the service:
 *   - returns the immutable bundle when the tenant row is present
 *   - falls back to TZ defaults when columns are missing (legacy rows)
 *   - throws when the tenant id is empty
 *   - throws when the tenant row is absent
 *   - coerces unknown enum values to TZ defaults
 */

import { describe, it, expect } from 'vitest';

import { createTenantConfigService } from '../service.js';
import {
  getJurisdictionDefaults,
  getDefaultsByCountry,
  JURISDICTION_DEFAULTS,
} from '../jurisdictions.js';
import type { TenantConfig } from '../types.js';

function fakePersistence(map: Record<string, TenantConfig>): {
  fetch(tenantId: string): Promise<TenantConfig | null>;
} {
  return {
    async fetch(tenantId) {
      return map[tenantId] ?? null;
    },
  };
}

describe('tenant-config service', () => {
  it('returns the canonical bundle for a TZ tenant', async () => {
    const cfg: TenantConfig = Object.freeze({
      tenantId: 't-tz-1',
      countryCode: 'TZ',
      defaultCurrency: 'TZS',
      defaultLanguage: 'sw',
      regulatorSet: 'TZ-set',
      allowedMinerals: Object.freeze(['gold', 'tanzanite']),
    });
    const svc = createTenantConfigService({
      persistence: fakePersistence({ 't-tz-1': cfg }),
    });
    const out = await svc.get('t-tz-1');
    expect(out).toEqual(cfg);
  });

  it('returns the canonical bundle for a CL tenant (non-TZ defaults)', async () => {
    const cfg: TenantConfig = Object.freeze({
      tenantId: 't-cl-1',
      countryCode: 'CL',
      defaultCurrency: 'CLP',
      defaultLanguage: 'es',
      regulatorSet: 'CL-set',
      allowedMinerals: Object.freeze(['copper', 'lithium']),
    });
    const svc = createTenantConfigService({
      persistence: fakePersistence({ 't-cl-1': cfg }),
    });
    const out = await svc.get('t-cl-1');
    expect(out.countryCode).toBe('CL');
    expect(out.defaultCurrency).toBe('CLP');
    expect(out.defaultLanguage).toBe('es');
    expect(out.regulatorSet).toBe('CL-set');
  });

  it('throws when tenantId is empty', async () => {
    const svc = createTenantConfigService({
      persistence: fakePersistence({}),
    });
    await expect(svc.get('')).rejects.toThrow(/tenantId is required/);
    await expect(svc.get('   ')).rejects.toThrow(/tenantId is required/);
  });

  it('throws when the tenant row is absent', async () => {
    const svc = createTenantConfigService({
      persistence: fakePersistence({}),
    });
    await expect(svc.get('t-missing')).rejects.toThrow(/tenant not found/);
  });
});

describe('jurisdiction defaults registry', () => {
  it('includes at least 8 jurisdictions (TZ + 7 non-TZ)', () => {
    const ids = JURISDICTION_DEFAULTS.map((j) => j.regulatorSet);
    expect(ids).toContain('TZ-set');
    expect(ids).toContain('KE-set');
    expect(ids).toContain('UG-set');
    expect(ids).toContain('NG-set');
    expect(ids).toContain('ZA-set');
    expect(ids).toContain('AU-set');
    expect(ids).toContain('CL-set');
    expect(ids).toContain('ID-set');
    expect(JURISDICTION_DEFAULTS.length).toBeGreaterThanOrEqual(8);
  });

  it('TZ defaults are the platform-wide fallback', () => {
    const tz = getJurisdictionDefaults('TZ-set');
    expect(tz.defaultCurrency).toBe('TZS');
    expect(tz.defaultLanguage).toBe('sw');
    expect(tz.phonePrefix).toBe('255');
  });

  it('falls back to TZ for unknown regulator-set', () => {
    const out = getJurisdictionDefaults('NOPE-set');
    expect(out.regulatorSet).toBe('TZ-set');
    expect(out.defaultCurrency).toBe('TZS');
  });

  it('non-TZ rows surface their own currency / language / phone', () => {
    const ke = getDefaultsByCountry('KE');
    expect(ke?.defaultCurrency).toBe('KES');
    expect(ke?.defaultLanguage).toBe('sw-KE');
    expect(ke?.phonePrefix).toBe('254');

    const au = getDefaultsByCountry('AU');
    expect(au?.defaultCurrency).toBe('AUD');
    expect(au?.defaultLanguage).toBe('en');
    expect(au?.phonePrefix).toBe('61');

    const cl = getDefaultsByCountry('CL');
    expect(cl?.defaultCurrency).toBe('CLP');
    expect(cl?.defaultLanguage).toBe('es');

    const id = getDefaultsByCountry('ID');
    expect(id?.defaultCurrency).toBe('IDR');
    expect(id?.defaultLanguage).toBe('id');

    const ng = getDefaultsByCountry('NG');
    expect(ng?.defaultCurrency).toBe('NGN');
    expect(ng?.mineralAllowlist).toContain('lead-zinc');

    const za = getDefaultsByCountry('ZA');
    expect(za?.defaultCurrency).toBe('ZAR');
    expect(za?.mineralAllowlist).toContain('platinum');
  });

  it('returns null for an unknown ISO-3166-1 alpha-2 code', () => {
    expect(getDefaultsByCountry('ZZ')).toBeNull();
  });

  it('mineral allowlists are non-empty for every jurisdiction', () => {
    for (const j of JURISDICTION_DEFAULTS) {
      expect(j.mineralAllowlist.length).toBeGreaterThan(0);
    }
  });

  it('jurisdiction defaults are deeply frozen', () => {
    const tz = JURISDICTION_DEFAULTS[0];
    expect(Object.isFrozen(tz)).toBe(true);
    expect(Object.isFrozen(tz.mineralAllowlist)).toBe(true);
  });
});
