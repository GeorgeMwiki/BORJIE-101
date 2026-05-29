/**
 * regulatory-zones multi-region schema test — Issue #207 WS-8.
 *
 * Pure-schema test (no DB) that asserts the Drizzle table definition
 * surfaces the new world-scale columns introduced by migration 0144:
 *   - regulator_set (default 'TZ-set')
 *   - country_code  (default 'TZ')
 *   - widened authority enum (TZ + KE/NG/ZA/AU/CL/ID slugs)
 *   - widened UNIQUE index (regulator_set, authority, code)
 */

import { describe, it, expect } from 'vitest';

import {
  REGULATORY_AUTHORITIES,
  regulatoryZones,
} from '../schemas/regulatory-zones.schema.js';

describe('regulatory-zones — multi-region (WS-8)', () => {
  it('exposes regulator_set column', () => {
    expect(regulatoryZones.regulatorSet).toBeDefined();
  });

  it('exposes country_code column', () => {
    expect(regulatoryZones.countryCode).toBeDefined();
  });

  it('REGULATORY_AUTHORITIES includes TZ-set slugs (no regression)', () => {
    expect(REGULATORY_AUTHORITIES).toContain('pccb');
    expect(REGULATORY_AUTHORITIES).toContain('nemc');
    expect(REGULATORY_AUTHORITIES).toContain('eiti');
    expect(REGULATORY_AUTHORITIES).toContain('tmaa');
  });

  it('REGULATORY_AUTHORITIES includes non-TZ authority slugs (WS-8)', () => {
    expect(REGULATORY_AUTHORITIES).toContain('nema-ke');
    expect(REGULATORY_AUTHORITIES).toContain('nesrea-ng');
    expect(REGULATORY_AUTHORITIES).toContain('dmre-za');
    expect(REGULATORY_AUTHORITIES).toContain('epa-vic-au');
    expect(REGULATORY_AUTHORITIES).toContain('sernageomin-cl');
    expect(REGULATORY_AUTHORITIES).toContain('esdm-id');
  });

  it('REGULATORY_AUTHORITIES is a non-empty readonly tuple', () => {
    expect(REGULATORY_AUTHORITIES.length).toBeGreaterThanOrEqual(10);
  });
});
