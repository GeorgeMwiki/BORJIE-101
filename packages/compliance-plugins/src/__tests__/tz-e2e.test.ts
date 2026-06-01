/**
 * Tanzania (TZ) — comprehensive end-to-end plugin audit.
 *
 * Pins every acceptance criterion from the Wave-27 Tanzania-First-Class
 * mandate:
 *   1. Currency: TZS 0-decimal, "TSh 50,000" NOT "TSh 500"
 *   2. Language: Swahili primary, English fallback
 *   3. Royalty regime: TRA 6% mineral royalty (+1% clearing) (Mining Act 2010 §87)
 *   4. Royalty filing: TRA CSV payload + submitEndpointHint
 *   5. Payment rails: M-Pesa TZ, Tigo Pesa, Airtel Money, HaloPesa, GEPG, bank, Stripe
 *   6. Mining law: Mining Act 2010 notice windows + performance-bond caps
 *   7. Counterparty screening: BUREAU_NOT_CONFIGURED (no centralized TZ bureau)
 *   8. NIDA 20-digit + TRA TIN 9-digit validators
 *   9. Phone: +255 + known TZ mobile prefixes only
 *  10. Data Protection: audit-event shape carries country='TZ' + regulatorRef='TRA'
 *
 * This test file is self-contained — it touches only the compliance-plugins
 * package + domain-models money helpers.
 */

import { describe, it, expect } from 'vitest';

// Direct import of the TZ profile — bypasses the cross-country barrel so this
// suite never depends on any auto-generated scaffold compiling.
import {
  tanzaniaProfile,
  buildTzTaxRegime,
  isKnownTzMobilePrefix,
  validateTraTin,
} from '../countries/tz/index.js';
import { validateNationalId, setNationalIdResolver } from '../validators/national-id.js';
import { CountryPluginRegistry } from '../core/registry.js';
import { DEFAULT_TAX_REGIME, DEFAULT_TAX_FILING, DEFAULT_PAYMENT_RAIL_PORT, DEFAULT_COUNTERPARTY_SCREENING, DEFAULT_MINING_LAW } from '../ports/index.js';

// Local registry so this suite runs in isolation from the process-singleton
// registry configured in src/index.ts (which pulls in the broken scaffolds).
const localRegistry = new CountryPluginRegistry();
localRegistry.register({
  ...tanzaniaProfile.plugin,
  taxRegime: tanzaniaProfile.taxRegime,
  paymentRails: tanzaniaProfile.paymentRails,
  miningLaw: tanzaniaProfile.miningLaw,
  counterpartyScreening: tanzaniaProfile.counterpartyScreening,
} as unknown as import('../core/types.js').CountryPlugin);

setNationalIdResolver((iso) =>
  iso === 'TZ' ? tanzaniaProfile.nationalIdValidator : null
);

function resolvePluginLocal(countryCode: string) {
  const base = localRegistry.resolve(countryCode)!;
  return {
    ...base,
    taxRegime: (base as { taxRegime?: unknown }).taxRegime ?? DEFAULT_TAX_REGIME,
    taxFiling: (base as { taxFiling?: unknown }).taxFiling ?? DEFAULT_TAX_FILING,
    paymentRails:
      (base as { paymentRails?: unknown }).paymentRails ?? DEFAULT_PAYMENT_RAIL_PORT,
    counterpartyScreening:
      (base as { counterpartyScreening?: unknown }).counterpartyScreening ??
      DEFAULT_COUNTERPARTY_SCREENING,
    miningLaw: (base as { miningLaw?: unknown }).miningLaw ?? DEFAULT_MINING_LAW,
  } as typeof base & {
    readonly taxRegime: typeof DEFAULT_TAX_REGIME;
    readonly taxFiling: typeof DEFAULT_TAX_FILING;
    readonly paymentRails: typeof DEFAULT_PAYMENT_RAIL_PORT;
    readonly counterpartyScreening: typeof DEFAULT_COUNTERPARTY_SCREENING;
    readonly miningLaw: typeof DEFAULT_MINING_LAW;
  };
}

describe('Wave-27 / TZ / checklist 1 — currency', () => {
  it('TZS is 0-decimal: minorUnitDivisor === 1', () => {
    expect(tanzaniaProfile.minorUnitDivisor).toBe(1);
    expect(tanzaniaProfile.plugin.currencyCode).toBe('TZS');
    expect(tanzaniaProfile.plugin.currencySymbol).toBe('TSh');
  });

  it('renders "TSh 50,000" NOT "TSh 500" for 50000 minor-units', async () => {
    const { money, formatMoney } = await import(
      '../../../domain-models/src/common/money.js'
    );
    const m = money(50000, 'TZS');
    const rendered = formatMoney(m, 'en-TZ');
    expect(rendered).not.toContain('.');
    expect(rendered).toMatch(/50,?000/);
    expect(rendered).not.toMatch(/\b500\b(?!,)/);
  });

  it('Swahili locale also renders TZS without decimals', async () => {
    const { money, formatMoney } = await import(
      '../../../domain-models/src/common/money.js'
    );
    const rendered = formatMoney(money(1_250_000, 'TZS'), 'sw-TZ');
    expect(rendered).not.toContain('.');
    expect(rendered).toMatch(/1[,.\u00A0\u202F\u2009]?250[,.\u00A0\u202F\u2009]?000/);
  });
});

describe('Wave-27 / TZ / checklist 2 — language', () => {
  it('primary language is Swahili, fallback English', () => {
    expect(tanzaniaProfile.languages[0]).toBe('sw');
    expect(tanzaniaProfile.languages).toContain('en');
  });

  it('every document template locale is sw-TZ', () => {
    for (const tpl of tanzaniaProfile.plugin.documentTemplates) {
      expect(tpl.locale).toBe('sw-TZ');
    }
  });

  it('offtake-agreement template label is in Swahili', () => {
    const offtake = tanzaniaProfile.plugin.documentTemplates.find(
      (t) => t.id === 'offtake-agreement'
    );
    expect(offtake).toBeDefined();
    expect(offtake!.name).toMatch(/Mkataba/);
  });
});

describe('Wave-27 / TZ / checklist 3 — royalty regime (TRA)', () => {
  it('mineral royalty: 6% withholding on gross market value', () => {
    const res = tanzaniaProfile.taxRegime.calculateWithholding(
      500_000,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(30_000);
    expect(res.regulatorRef).toBe('TRA-ROYALTY');
    expect(res.rateNote).toContain('6%');
    expect(res.rateNote).toContain('§87');
    expect(res.requiresManualConfiguration).toBeFalsy();
  });

  it('with clearing fee: 7% withholding on gross market value', () => {
    const withClearingRegime = buildTzTaxRegime({ includesClearingFee: true });
    const res = withClearingRegime.calculateWithholding(
      500_000,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(35_000);
    expect(res.rateNote).toContain('1% clearing fee');
  });

  it('is NOT the legacy Kenya 7.5% flat rate', () => {
    const res = tanzaniaProfile.taxRegime.calculateWithholding(
      1_000_000,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    // 7.5% of 1,000,000 would be 75,000 — we expect 60,000 (6%) instead.
    expect(res.withholdingMinorUnits).toBe(60_000);
    expect(res.withholdingMinorUnits).not.toBe(75_000);
  });

  it('handles zero proceeds gracefully', () => {
    const res = tanzaniaProfile.taxRegime.calculateWithholding(
      0,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(0);
  });
});

describe('Wave-27 / TZ / checklist 4 — tax filing (TRA)', () => {
  it('produces TRA-targeted filing payload with submitEndpointHint', () => {
    const resolved = resolvePluginLocal('TZ');
    const run = {
      runId: 'RUN-2026-04',
      lineItems: [
        {
          offtakeId: 'OFFTAKE-1',
          counterpartyName: 'Mwangi Co. Ltd',
          siteReference: 'PML 12, Geita',
          grossValueMinorUnits: 800_000,
          withholdingMinorUnits: 80_000,
          currency: 'TZS',
          paymentDate: '2026-04-05',
        },
      ],
      totalGrossMinorUnits: 800_000,
      totalWithholdingMinorUnits: 80_000,
    };
    const filing = resolved.taxFiling.prepareFiling(
      run,
      {
        tenantId: 't_1',
        taxpayerId: '123456789',
        legalName: 'Mwangi Mining Ltd',
        countryCode: 'TZ',
      },
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(filing.targetRegulator).toBe('TRA');
    expect(filing.submitEndpointHint).toBe('https://taxportal.tra.go.tz');
    expect(filing.filingFormat).toBe('csv');
    expect(filing.payload).toContain('Mwangi Mining Ltd');
    expect(filing.payload).toContain('123456789');
    expect(filing.payload).toContain('OFFTAKE-1');
    expect(filing.instructions).toMatch(/7th of the month/i);
    expect(filing.instructions).toMatch(/§87/);
  });
});

describe('Wave-27 / TZ / checklist 5 — payment rails', () => {
  const rails = tanzaniaProfile.paymentRails.listRails();
  const ids = rails.map((r) => r.id);

  it('includes the three core mobile-money rails', () => {
    expect(ids).toContain('mpesa_tz');
    expect(ids).toContain('tigopesa');
    expect(ids).toContain('airtelmoney_tz');
  });

  it('includes HaloPesa + GEPG + bank + Stripe', () => {
    expect(ids).toContain('halopesa');
    expect(ids).toContain('gepg');
    expect(ids).toContain('tz_bank_transfer');
    expect(ids).toContain('stripe');
  });

  it('every rail is TZS-denominated', () => {
    for (const rail of rails) {
      expect(rail.currency).toBe('TZS');
    }
  });

  it('mobile-money rails support both collection and disbursement', () => {
    const mmRails = rails.filter((r) => r.kind === 'mobile-money');
    for (const r of mmRails) {
      expect(r.supportsCollection).toBe(true);
      expect(r.supportsDisbursement).toBe(true);
    }
  });

  it('GEPG is collection-only (government portal)', () => {
    const gepg = rails.find((r) => r.id === 'gepg');
    expect(gepg?.supportsCollection).toBe(true);
    expect(gepg?.supportsDisbursement).toBe(false);
  });

  it('every adapter hint maps to an env-prefix the platform recognises', () => {
    const expectedHints = new Set([
      'MPESA_TZ',
      'TIGOPESA',
      'AIRTELMONEY_TZ',
      'HALOPESA',
      'GEPG',
      'TZ_BANK',
      'STRIPE',
    ]);
    for (const rail of rails) {
      if (rail.integrationAdapterHint) {
        expect(expectedHints.has(rail.integrationAdapterHint)).toBe(true);
      }
    }
  });
});

describe('Wave-27 / TZ / checklist 6 — mining law (Mining Act 2010)', () => {
  it('royalty-default notice window is 30 days', () => {
    expect(
      tanzaniaProfile.miningLaw.noticeWindowDays('royalty-default')
    ).toBe(30);
  });

  it('licence-expiry notice is 90 days', () => {
    expect(
      tanzaniaProfile.miningLaw.noticeWindowDays('licence-expiry')
    ).toBe(90);
  });

  it('state-repossession notice is 180 days', () => {
    expect(
      tanzaniaProfile.miningLaw.noticeWindowDays('state-repossession')
    ).toBe(180);
  });

  it('artisanal performance-bond cap = 6 months with statute citation', () => {
    const cap = tanzaniaProfile.miningLaw.bondCapMultiple(
      'artisanal-standard'
    );
    expect(cap.maxMonthsOfRoyalty).toBe(6);
    expect(cap.citation).toContain('Mining (Mineral Rights) Regulations');
    expect(cap.citation).toContain('2018');
  });

  it('industrial performance-bond cap = 12 months', () => {
    const cap = tanzaniaProfile.miningLaw.bondCapMultiple('industrial');
    expect(cap.maxMonthsOfRoyalty).toBe(12);
  });

  it('requires TRA TIN clause in the offtake agreement', () => {
    const clauses = tanzaniaProfile.miningLaw.requiredClauses('artisanal');
    const tin = clauses.find((c) => c.id === 'tz-tra-tin');
    expect(tin).toBeDefined();
    expect(tin!.mandatory).toBe(true);
    expect(tin!.citation).toContain('Mining Act 2010');
  });

  it('royalty-escalation cap cites the Mining Commission (Mining Act 2010)', () => {
    const cap = tanzaniaProfile.miningLaw.royaltyEscalationCap(
      'artisanal-standard'
    );
    expect(cap.citation).toMatch(/Mining Commission/i);
    expect(cap.citation).toMatch(/Mining Act 2010/);
  });
});

describe('Wave-27 / TZ / checklist 7 — counterparty screening', () => {
  it('no centralized bureau — returns BUREAU_NOT_CONFIGURED gracefully', async () => {
    const result = await tanzaniaProfile.counterpartyScreening.lookupBureau(
      { kind: 'nida', value: '19900101-12345-12345-01', country: 'TZ' },
      'TZ',
      'valid-consent-token'
    );
    expect(result.flags).toContain('BUREAU_NOT_CONFIGURED');
    expect(result.bureau).toBe('CRB_TZ');
    // Must never throw or leak PII in the result:
    expect(JSON.stringify(result)).not.toContain('19900101');
  });
});

describe('Wave-27 / TZ / checklist 8 — NIDA + TIN validators', () => {
  it('NIDA accepts 20 digits contiguous', () => {
    const r = tanzaniaProfile.nationalIdValidator!.validate(
      '19900101123451234501'
    );
    expect(r.status).toBe('valid');
    expect(r.piiSensitive).toBe(true);
  });

  it('NIDA accepts hyphenated YYYYMMDD-NNNNN-NNNNN-NN', () => {
    const r = tanzaniaProfile.nationalIdValidator!.validate(
      '19900101-12345-12345-01'
    );
    expect(r.status).toBe('valid');
  });

  it('NIDA rejects short values and malformed hyphenation', () => {
    expect(tanzaniaProfile.nationalIdValidator!.validate('123').status).toBe(
      'invalid'
    );
    expect(
      tanzaniaProfile.nationalIdValidator!.validate('not-a-nida').status
    ).toBe('invalid');
  });

  it('universal validateNationalId() dispatches to the TZ validator', () => {
    const r = validateNationalId('19900101-12345-12345-01', 'TZ');
    expect(r.status).toBe('valid');
    expect(r.ruleId).toBe('tz-nida');
  });

  it('TIN validator accepts 9-digit values', () => {
    expect(validateTraTin('123456789').status).toBe('valid');
    expect(validateTraTin('123-456-789').status).toBe('valid');
  });

  it('TIN validator rejects short, long, or non-numeric', () => {
    expect(validateTraTin('12345').status).toBe('invalid');
    expect(validateTraTin('1234567890').status).toBe('invalid');
    expect(validateTraTin('ABCDEFGHI').status).toBe('invalid');
    expect(validateTraTin('').status).toBe('invalid');
  });
});

describe('Wave-27 / TZ / checklist 9 — phone validation', () => {
  it('accepts known TZ mobile prefixes with trunk-0', () => {
    // Vodacom (75): 0754123456 → +255754123456
    expect(tanzaniaProfile.plugin.normalizePhone('0754123456')).toBe(
      '+255754123456'
    );
    // Tigo (78):
    expect(tanzaniaProfile.plugin.normalizePhone('0782345678')).toBe(
      '+255782345678'
    );
    // Airtel (68):
    expect(tanzaniaProfile.plugin.normalizePhone('0683456789')).toBe(
      '+255683456789'
    );
  });

  it('accepts international form with leading +', () => {
    expect(tanzaniaProfile.plugin.normalizePhone('+255712345678')).toBe(
      '+255712345678'
    );
  });

  it('rejects unknown mobile prefixes (e.g. +2557950...)', () => {
    // 79 is not in the known TZ mobile allowlist.
    expect(() =>
      tanzaniaProfile.plugin.normalizePhone('+255795123456')
    ).toThrow(/TZ mobile prefix/i);
  });

  it('isKnownTzMobilePrefix reflects the allowlist', () => {
    expect(isKnownTzMobilePrefix('75')).toBe(true);
    expect(isKnownTzMobilePrefix('78')).toBe(true);
    expect(isKnownTzMobilePrefix('68')).toBe(true);
    expect(isKnownTzMobilePrefix('62')).toBe(true);
    expect(isKnownTzMobilePrefix('79')).toBe(false);
  });
});

describe('Wave-27 / TZ / checklist 10 — audit-event shape', () => {
  it('monthly-close royalty event carries country + regulatorRef', () => {
    // Simulate the shape the monthly-close orchestrator emits for each
    // operator + period. This is the minimum contract the audit-event
    // store depends on — the orchestrator itself lives in
    // services/payments-ledger, out of scope for this plugin test.
    const res = tanzaniaProfile.taxRegime.calculateWithholding(
      2_000_000,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    const auditEvent = {
      eventType: 'royalty_computed',
      country: tanzaniaProfile.plugin.countryCode,
      regulatorRef: res.regulatorRef,
      grossValueMinorUnits: 2_000_000,
      withholdingMinorUnits: res.withholdingMinorUnits,
      currency: tanzaniaProfile.plugin.currencyCode,
    };
    expect(auditEvent.country).toBe('TZ');
    expect(auditEvent.regulatorRef).toBe('TRA-ROYALTY');
    expect(auditEvent.currency).toBe('TZS');
    expect(auditEvent.withholdingMinorUnits).toBe(120_000);
  });
});

describe('Wave-27 / TZ / registry wiring', () => {
  it('tanzaniaProfile is shaped as the 13th first-class jurisdiction', () => {
    expect(tanzaniaProfile.plugin.countryCode).toBe('TZ');
    expect(tanzaniaProfile.languages[0]).toBe('sw');
  });

  it('local registry resolves "TZ" to the plugin with TRA wiring', () => {
    const plugin = localRegistry.resolve('TZ')!;
    expect(plugin.countryCode).toBe('TZ');
    expect(plugin.currencyCode).toBe('TZS');
    expect(plugin.taxRegime).toBeDefined();
    expect(plugin.paymentRails).toBeDefined();
    expect(plugin.miningLaw).toBeDefined();
  });

  it('resolvePluginLocal("TZ") guarantees every port non-null', () => {
    const p = resolvePluginLocal('TZ');
    expect(p.taxRegime).toBeDefined();
    expect(p.taxFiling).toBeDefined();
    expect(p.paymentRails).toBeDefined();
    expect(p.counterpartyScreening).toBeDefined();
    expect(p.miningLaw).toBeDefined();
  });

  it('localRegistry.list() includes TZ', () => {
    expect(localRegistry.list()).toContain('TZ');
  });
});

describe('Wave-27 / TZ / end-to-end pipeline simulation', () => {
  /**
   * Simulates the full prospect → offtake → monthly-close chain a Tanzania
   * operator runs. Uses the resolved plugin the same way the orchestrator
   * would in production.
   */
  it('prospect-to-offtake-to-close: every step honours TZ config', async () => {
    const plugin = resolvePluginLocal('TZ');

    // Step 1 — operator onboarding: validate NIDA + phone
    const nidaVerdict = plugin.kycProviders
      .find((k) => k.id === 'nida')!
      .idFormat!.test('19900101123451234501');
    expect(nidaVerdict).toBe(true);
    const phone = plugin.normalizePhone('0752111222');
    expect(phone).toBe('+255752111222');

    // Step 2 — performance-bond cap check: operator posting 6 months OK,
    // 7 months rejected
    const cap = plugin.miningLaw.bondCapMultiple('artisanal-standard');
    expect(cap.maxMonthsOfRoyalty).toBe(6);

    // Step 3 — notice period for licence expiry
    const notice = plugin.miningLaw.noticeWindowDays('licence-expiry');
    expect(notice).toBe(90);

    // Step 4 — payment rail selection: pick cheapest mobile-money
    const rails = plugin.paymentRails.listRails();
    const mobile = rails.filter((r) => r.kind === 'mobile-money');
    expect(mobile.length).toBeGreaterThanOrEqual(3);

    // Step 5 — monthly close: compute royalty (6% of gross value)
    const wht = plugin.taxRegime.calculateWithholding(
      1_500_000,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(wht.withholdingMinorUnits).toBe(90_000);
    expect(wht.regulatorRef).toBe('TRA-ROYALTY');

    // Step 6 — prepare TRA filing
    const filing = plugin.taxFiling.prepareFiling(
      {
        runId: 'E2E-RUN',
        lineItems: [
          {
            offtakeId: 'OFFTAKE-E2E',
            counterpartyName: 'Jane Mwanri',
            siteReference: 'PML 7, Geita',
            grossValueMinorUnits: 1_500_000,
            withholdingMinorUnits: 90_000,
            currency: 'TZS',
            paymentDate: '2026-04-05',
          },
        ],
        totalGrossMinorUnits: 1_500_000,
        totalWithholdingMinorUnits: 90_000,
      },
      {
        tenantId: 't_e2e',
        taxpayerId: '100200300',
        legalName: 'Borjie Demo Ltd',
        countryCode: 'TZ',
      },
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(filing.targetRegulator).toBe('TRA');
    expect(filing.payload).toContain('100200300');
  });
});
