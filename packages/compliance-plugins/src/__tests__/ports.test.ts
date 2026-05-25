/**
 * Port coverage + per-country port behaviour tests.
 *
 * Pins:
 *  - Every existing country plugin implements every port.
 *  - Defaults fire cleanly for unknown countries and null/undefined input.
 *  - `flatRateWithholding` rounds half-away-from-zero.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLUGIN,
  DEFAULT_TAX_REGIME,
  availableCountries,
  flatRateWithholding,
  getPortCoverageMatrix,
  resolvePlugin,
  type TaxPeriod,
} from '../index.js';

const PERIOD: TaxPeriod = { kind: 'month', year: 2026, month: 3 };

describe('port coverage matrix', () => {
  // The six bundled first-class plugins PhZ-GLOBAL owns. Extended profiles
  // contributed by other waves may land in the registry later and can
  // partially implement ports — those are asserted elsewhere.
  const BUNDLED_COUNTRIES = ['TZ', 'KE', 'UG', 'NG', 'ZA', 'US'] as const;

  it('every bundled country implements every port', () => {
    const matrix = getPortCoverageMatrix();
    expect(matrix.length).toBeGreaterThanOrEqual(6);
    const byCode = new Map(matrix.map((row) => [row.countryCode, row]));
    for (const code of BUNDLED_COUNTRIES) {
      const row = byCode.get(code);
      expect(row, `country ${code} missing from coverage matrix`).toBeDefined();
      expect(row, `country ${code}`).toMatchObject({
        taxRegime: true,
        taxFiling: true,
        paymentRails: true,
        tenantScreening: true,
        leaseLaw: true,
      });
    }
  });

  it('exposes expected country set', () => {
    const codes = availableCountries();
    expect(codes).toEqual(
      expect.arrayContaining(['TZ', 'KE', 'UG', 'NG', 'ZA', 'US'])
    );
  });
});

describe('resolvePlugin', () => {
  it('returns the concrete plugin for a known country', () => {
    const ke = resolvePlugin('KE');
    expect(ke.countryCode).toBe('KE');
    expect(ke.taxRegime).toBeDefined();
    expect(ke.taxFiling).toBeDefined();
    expect(ke.paymentRails).toBeDefined();
    expect(ke.tenantScreening).toBeDefined();
    expect(ke.leaseLaw).toBeDefined();
  });

  it('falls back to DEFAULT_PLUGIN for unknown country without throwing', () => {
    expect(resolvePlugin('XX')).toBe(DEFAULT_PLUGIN);
    expect(resolvePlugin('ZZ')).toBe(DEFAULT_PLUGIN);
  });

  it('falls back to DEFAULT_PLUGIN for null / undefined / empty', () => {
    expect(resolvePlugin(null)).toBe(DEFAULT_PLUGIN);
    expect(resolvePlugin(undefined)).toBe(DEFAULT_PLUGIN);
    expect(resolvePlugin('')).toBe(DEFAULT_PLUGIN);
    expect(resolvePlugin('   ')).toBe(DEFAULT_PLUGIN);
  });

  it('DEFAULT_PLUGIN carries USD/English with zero withholding', () => {
    expect(DEFAULT_PLUGIN.currencyCode).toBe('USD');
    const result = DEFAULT_PLUGIN.taxRegime.calculateWithholding(
      100_000_00,
      'USD',
      PERIOD
    );
    expect(result.withholdingMinorUnits).toBe(0);
    expect(result.requiresManualConfiguration).toBe(true);
  });
});

describe('flatRateWithholding helper', () => {
  it('rounds half-away-from-zero', () => {
    expect(flatRateWithholding(1_000_000, 7.5, 'KRA-MRI', '').withholdingMinorUnits).toBe(75_000);
    expect(flatRateWithholding(3, 10, 'TEST', '').withholdingMinorUnits).toBe(0);
    expect(flatRateWithholding(5, 10, 'TEST', '').withholdingMinorUnits).toBe(1);
  });

  it('clamps negative input to 0', () => {
    expect(flatRateWithholding(-1000, 10, 'T', '').withholdingMinorUnits).toBe(0);
  });

  it('treats non-integer input as 0', () => {
    expect(flatRateWithholding(10.5 as unknown as number, 10, 'T', '').withholdingMinorUnits).toBe(0);
  });
});

describe('DEFAULT_TAX_REGIME behaviour', () => {
  it('returns configure note on valid input', () => {
    const r = DEFAULT_TAX_REGIME.calculateWithholding(100_000, 'USD', PERIOD);
    expect(r.rateNote).toMatch(/CONFIGURE_FOR_YOUR_JURISDICTION/);
    expect(r.regulatorRef).toBe('GENERIC');
  });

  it('returns configure note on invalid input', () => {
    const r = DEFAULT_TAX_REGIME.calculateWithholding(-1, 'USD', PERIOD);
    expect(r.requiresManualConfiguration).toBe(true);
  });
});

describe.each(['TZ', 'KE', 'UG', 'NG', 'ZA', 'US'])(
  'tax regime — %s',
  (code) => {
    it('computes a non-null withholding result', () => {
      const plugin = resolvePlugin(code);
      const result = plugin.taxRegime.calculateWithholding(
        1_000_000_00,
        plugin.currencyCode,
        PERIOD
      );
      expect(result.withholdingMinorUnits).toBeGreaterThanOrEqual(0);
      expect(result.regulatorRef).toBeTruthy();
      expect(result.rateNote).toBeTruthy();
    });

    it('exposes a non-empty rails list with currency matching the country', () => {
      const plugin = resolvePlugin(code);
      const rails = plugin.paymentRails.listRails();
      expect(rails.length).toBeGreaterThan(0);
      for (const rail of rails) {
        expect(rail.currency).toBe(plugin.currencyCode);
      }
    });

    it('lease-law exposes a residential clause set', () => {
      const clauses = resolvePlugin(code).leaseLaw.requiredClauses('residential');
      expect(clauses.length).toBeGreaterThanOrEqual(3);
      expect(clauses.every((c) => c.citation.length > 0)).toBe(true);
    });

    it('lease-law returns a numeric non-payment notice window', () => {
      const days = resolvePlugin(code).leaseLaw.noticeWindowDays('non-payment');
      expect(days).not.toBeNull();
      expect(days).toBeGreaterThan(0);
    });

    it('deposit-cap returns a residential-standard figure', () => {
      const cap = resolvePlugin(code).leaseLaw.depositCapMultiple('residential-standard');
      expect(cap.citation.length).toBeGreaterThan(0);
    });

    it('tenant-screening returns BUREAU_NOT_CONFIGURED without real adapter', async () => {
      const plugin = resolvePlugin(code);
      const result = await plugin.tenantScreening.lookupBureau(
        { kind: 'national-id', value: 'REDACTED', country: code },
        code,
        'consent-token'
      );
      expect(result.flags).toContain('BUREAU_NOT_CONFIGURED');
      expect(result.bureau).toBeTruthy();
    });

    it('tax-filing returns a payload with a regulator ref', () => {
      const plugin = resolvePlugin(code);
      const result = plugin.taxFiling.prepareFiling(
        {
          runId: 'run-1',
          lineItems: [
            {
              leaseId: 'L1',
              tenantName: 'Test',
              propertyReference: 'P1',
              grossRentMinorUnits: 1_000_000,
              withholdingMinorUnits: 75_000,
              currency: plugin.currencyCode,
              paymentDate: '2026-03-28',
            },
          ],
          totalGrossMinorUnits: 1_000_000,
          totalWithholdingMinorUnits: 75_000,
        },
        {
          tenantId: 't1',
          taxpayerId: 'TAX1',
          legalName: 'Test LLC',
          countryCode: code,
        },
        PERIOD
      );
      expect(result.targetRegulator).toBeTruthy();
      expect(['csv', 'xml', 'json']).toContain(result.filingFormat);
      expect(result.payload.length).toBeGreaterThan(0);
    });
  }
);

describe('Kenya tax regime specifics', () => {
  it('applies 7.5% MRI on gross rent', () => {
    const r = resolvePlugin('KE').taxRegime.calculateWithholding(
      10_000_000,
      'KES',
      PERIOD
    );
    expect(r.withholdingMinorUnits).toBe(750_000);
    expect(r.regulatorRef).toBe('KRA-MRI');
  });
});

describe('US tax regime specifics', () => {
  it('returns 0% federal withholding for residents', () => {
    const r = resolvePlugin('US').taxRegime.calculateWithholding(
      10_000_000,
      'USD',
      PERIOD
    );
    expect(r.withholdingMinorUnits).toBe(0);
    expect(r.regulatorRef).toContain('IRS');
  });
});

describe('Kenya payment rails', () => {
  it('lists M-Pesa first-class as a collection-capable rail', () => {
    const rails = resolvePlugin('KE').paymentRails.listRails();
    const mpesa = rails.find((r) => r.id === 'mpesa_ke');
    expect(mpesa).toBeDefined();
    expect(mpesa?.supportsCollection).toBe(true);
  });
});

describe('Kenya lease law', () => {
  it('uses 14-day non-payment notice window', () => {
    expect(resolvePlugin('KE').leaseLaw.noticeWindowDays('non-payment')).toBe(14);
  });

  it('caps residential deposit at 3 months', () => {
    const cap = resolvePlugin('KE').leaseLaw.depositCapMultiple(
      'residential-standard'
    );
    expect(cap.maxMonthsOfRent).toBe(3);
  });
});

describe('Uganda lease law', () => {
  it('applies 10% rent-increase cap', () => {
    const cap = resolvePlugin('UG').leaseLaw.rentIncreaseCap(
      'residential-standard'
    );
    expect(cap.pctPerAnnum).toBe(10);
  });
});
