/**
 * phone helpers — Issue #207 (world-scale tenants), WS-4.
 */

import { describe, it, expect } from 'vitest';

import { dialingCodeForTenant, dialingPrefixForTenant } from '../phone.js';
import type { TenantConfig } from '../types.js';

function cfg(
  countryCode: string,
  regulatorSet: TenantConfig['regulatorSet'],
): TenantConfig {
  return Object.freeze({
    tenantId: 't',
    countryCode,
    defaultCurrency: 'TZS',
    defaultLanguage: 'sw',
    regulatorSet,
    allowedMinerals: Object.freeze([]),
  });
}

describe('dialingCodeForTenant', () => {
  it('TZ tenant -> 255', () => {
    expect(dialingCodeForTenant(cfg('TZ', 'TZ-set'))).toBe('255');
  });
  it('KE tenant -> 254', () => {
    expect(dialingCodeForTenant(cfg('KE', 'KE-set'))).toBe('254');
  });
  it('NG tenant -> 234', () => {
    expect(dialingCodeForTenant(cfg('NG', 'NG-set'))).toBe('234');
  });
  it('ZA tenant -> 27', () => {
    expect(dialingCodeForTenant(cfg('ZA', 'ZA-set'))).toBe('27');
  });
  it('AU tenant -> 61', () => {
    expect(dialingCodeForTenant(cfg('AU', 'AU-set'))).toBe('61');
  });
  it('CL tenant -> 56', () => {
    expect(dialingCodeForTenant(cfg('CL', 'CL-set'))).toBe('56');
  });
  it('ID tenant -> 62', () => {
    expect(dialingCodeForTenant(cfg('ID', 'ID-set'))).toBe('62');
  });
  it('UG tenant -> 256', () => {
    expect(dialingCodeForTenant(cfg('UG', 'UG-set'))).toBe('256');
  });

  it('falls back to regulator-set defaults when country is unknown', () => {
    expect(dialingCodeForTenant(cfg('ZZ', 'KE-set'))).toBe('254');
  });

  it('falls back to TZ when both country and regulator-set are unknown', () => {
    expect(
      dialingCodeForTenant(
        cfg('ZZ', 'NOPE' as unknown as TenantConfig['regulatorSet']),
      ),
    ).toBe('255');
  });
});

describe('dialingPrefixForTenant', () => {
  it('prepends + to the dialing code', () => {
    expect(dialingPrefixForTenant(cfg('CL', 'CL-set'))).toBe('+56');
    expect(dialingPrefixForTenant(cfg('NG', 'NG-set'))).toBe('+234');
  });
});
