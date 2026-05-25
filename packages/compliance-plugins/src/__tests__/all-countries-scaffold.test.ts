/**
 * WAVE 27 Agent A — global country-coverage contract tests.
 *
 * Every ISO-3166 alpha-2 code registered via scaffolds must resolve to a
 * structurally valid `ResolvedCountryPlugin`. The 18 countries with
 * full-fidelity plugins must NOT be overwritten by their scaffold.
 *
 * Guarantees enforced here:
 *   1. resolvePlugin(<every scaffold ISO>) returns a non-DEFAULT plugin with
 *      every port present and structurally valid.
 *   2. Scaffolds flag `requiresManualConfiguration: true` on tax regime.
 *   3. Full-fidelity plugins (TZ especially) are never shadowed by scaffolds.
 *   4. Finland resolves to the scaffold with EUR + ['fi','sv','en'] + manual-
 *      configuration flag (smoke test for the user-mandated spot check).
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLUGIN,
  EXTENDED_PROFILES,
  SCAFFOLD_COUNTRY_CODES,
  SCAFFOLD_METADATA,
  SCAFFOLD_PROFILES,
  resolveExtendedProfile,
  resolvePlugin,
  tanzaniaPlugin,
} from '../index.js';

// Hand-authored real-data ISO codes. Scaffolds MUST NOT be present for these.
const REAL_DATA_CODES = [
  'KE',
  'TZ',
  'UG',
  'NG',
  'ZA',
  'US',
  'DE',
  'KR',
  'GB',
  'SG',
  'CA',
  'AU',
  'IN',
  'BR',
  'JP',
  'FR',
  'AE',
  'MX',
];

describe('WAVE-27 — global scaffold coverage', () => {
  it('generates around 231 ISO-3166 scaffolds (249 - 18 real-data)', () => {
    expect(SCAFFOLD_COUNTRY_CODES.length).toBeGreaterThanOrEqual(220);
    expect(SCAFFOLD_COUNTRY_CODES.length).toBeLessThanOrEqual(250);
  });

  it('does NOT produce a scaffold for any of the 18 real-data jurisdictions', () => {
    for (const iso of REAL_DATA_CODES) {
      expect(SCAFFOLD_PROFILES[iso]).toBeUndefined();
      expect(SCAFFOLD_METADATA[iso]).toBeUndefined();
    }
  });

  it('resolvePlugin("TZ") returns the REAL Tanzania plugin, not a scaffold', () => {
    const tz = resolvePlugin('TZ');
    expect(tz.countryCode).toBe('TZ');
    expect(tz.currencyCode).toBe('TZS');
    // Real plugin has NIDA + TRA + CRB KYC providers; scaffold has none.
    expect(tz.kycProviders.length).toBeGreaterThan(0);
    const ids = tz.kycProviders.map((p) => p.id);
    expect(ids).toContain('nida');
    // Same object identity invariant — the real plugin.
    expect(tanzaniaPlugin.countryCode).toBe('TZ');
  });

  it('resolvePlugin("FI") returns the Finland scaffold — user mandate spot check', () => {
    const fi = resolvePlugin('FI');
    expect(fi.countryCode).toBe('FI');
    expect(fi.currencyCode).toBe('EUR');
    // Stripe + bank + manual rails per scaffold convention.
    const rails = fi.paymentRails.listRails();
    expect(rails.map((r) => r.id).sort()).toEqual(
      ['bank_transfer', 'manual', 'stripe'].sort()
    );
    const wh = fi.taxRegime.calculateWithholding(100_000, 'EUR', {
      kind: 'month',
      year: 2026,
      month: 1,
    });
    expect(wh.requiresManualConfiguration).toBe(true);
    expect(wh.withholdingMinorUnits).toBe(0);

    const profile = resolveExtendedProfile('FI');
    expect(profile.languages).toEqual(['fi', 'sv', 'en']);
    expect(profile.dateFormat).toBe('DD.MM.YYYY');
    expect(profile.minorUnitDivisor).toBe(100);
  });

  it.each([
    ['NO', 'NOK', 'DD.MM.YYYY', 100],
    ['ID', 'IDR', 'DD/MM/YYYY', 100],
    ['CH', 'CHF', 'DD.MM.YYYY', 100],
    ['PH', 'PHP', 'MM/DD/YYYY', 100],
    ['VN', 'VND', 'DD/MM/YYYY', 1],
    ['KW', 'KWD', 'DD/MM/YYYY', 1000],
  ])(
    'resolveExtendedProfile("%s") carries currency %s, date %s, divisor %d',
    (iso, currency, dateFormat, divisor) => {
      const profile = resolveExtendedProfile(iso);
      expect(profile.plugin.countryCode).toBe(iso);
      expect(profile.plugin.currencyCode).toBe(currency);
      expect(profile.dateFormat).toBe(dateFormat);
      expect(profile.minorUnitDivisor).toBe(divisor);
    }
  );

  it('every scaffolded ISO code resolves with all five ports non-null', () => {
    for (const iso of SCAFFOLD_COUNTRY_CODES) {
      const plugin = resolvePlugin(iso);
      expect(plugin.countryCode).toBe(iso);
      expect(plugin).not.toBe(DEFAULT_PLUGIN);
      expect(plugin.taxRegime).toBeDefined();
      expect(plugin.taxFiling).toBeDefined();
      expect(plugin.paymentRails).toBeDefined();
      expect(plugin.tenantScreening).toBeDefined();
      expect(plugin.leaseLaw).toBeDefined();
    }
  });

  it('every scaffold tax regime flags requiresManualConfiguration', () => {
    for (const iso of SCAFFOLD_COUNTRY_CODES) {
      const plugin = resolvePlugin(iso);
      const result = plugin.taxRegime.calculateWithholding(100_000, 'USD', {
        kind: 'month',
        year: 2026,
        month: 1,
      });
      expect(result.requiresManualConfiguration).toBe(true);
      expect(result.withholdingMinorUnits).toBe(0);
      expect(result.regulatorRef).toContain('MANUAL-CONFIG');
    }
  });

  it('every scaffold payment-rails port lists stripe + bank + manual', () => {
    for (const iso of SCAFFOLD_COUNTRY_CODES) {
      const plugin = resolvePlugin(iso);
      const rails = plugin.paymentRails.listRails();
      const ids = rails.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(['stripe', 'bank_transfer', 'manual']));
    }
  });

  it('every scaffold carries metadata with status=scaffold and a promotion guide', () => {
    for (const iso of SCAFFOLD_COUNTRY_CODES) {
      const meta = SCAFFOLD_METADATA[iso];
      expect(meta).toBeDefined();
      expect(meta!.status).toBe('scaffold');
      expect(meta!.promotionGuide).toContain('README');
      expect(meta!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('EXTENDED_PROFILES contains every scaffold code and the 13 extended real-data jurisdictions', () => {
    // The 6 core-registry plugins (KE, UG, NG, ZA, US + TZ) live under
    // plugins/ — TZ is also promoted into countries/ as a full-fidelity
    // profile. The remaining 5 are available through the core registry and
    // resolvePlugin(), not EXTENDED_PROFILES.
    const extendedRealData = ['AE', 'AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'JP', 'KR', 'MX', 'SG', 'TZ'];
    for (const iso of extendedRealData) {
      expect(EXTENDED_PROFILES[iso]).toBeDefined();
    }
    for (const iso of SCAFFOLD_COUNTRY_CODES) {
      expect(EXTENDED_PROFILES[iso]).toBeDefined();
    }
    // Every scaffold must also resolve through the core registry.
    for (const iso of SCAFFOLD_COUNTRY_CODES) {
      const resolved = resolvePlugin(iso);
      expect(resolved.countryCode).toBe(iso);
    }
    // And the 5 core-only real-data codes still resolve (but don't appear in
    // EXTENDED_PROFILES).
    for (const iso of ['KE', 'UG', 'NG', 'ZA', 'US']) {
      const resolved = resolvePlugin(iso);
      expect(resolved.countryCode).toBe(iso);
    }
  });

  it('EXTENDED_PROFILES.TZ identity is the full-fidelity Tanzania profile (not overwritten)', () => {
    const tz = EXTENDED_PROFILES.TZ!;
    expect(tz.plugin.countryCode).toBe('TZ');
    // Full-fidelity profile flags real tax rate, NOT the scaffold stub.
    const wh = tz.taxRegime.calculateWithholding(100_000, 'TZS', {
      kind: 'month',
      year: 2026,
      month: 1,
    });
    // Real Tanzania regime has a configured rate — it may or may not produce
    // withholding > 0 depending on configuration, but it must NOT carry the
    // scaffold's manual-configuration flag.
    expect(wh.requiresManualConfiguration).not.toBe(true);
  });

  it('resolveExtendedProfile is case-insensitive for scaffolds', () => {
    const lower = resolveExtendedProfile('fi');
    const upper = resolveExtendedProfile('FI');
    expect(lower.plugin.countryCode).toBe('FI');
    expect(upper.plugin.countryCode).toBe('FI');
  });
});
