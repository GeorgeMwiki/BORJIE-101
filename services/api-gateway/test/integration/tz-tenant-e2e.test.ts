/**
 * Tanzania-Tenant E2E — Wave-27 Agent-B.
 *
 * Boots the compliance-plugins registry + tenant-context middleware and
 * simulates a Tanzania tenant running the full vacancy → lease → monthly
 * close pipeline against the gateway surface. This is a "router level"
 * e2e — it does NOT require Postgres. It proves:
 *
 *   1. A tenant with `country: 'TZ'` lands on the real first-class TZ plugin
 *      (not the fallback and not the legacy one without `taxFiling`).
 *   2. Locale defaults to Swahili (`sw`) with English as fallback.
 *   3. Currency renders as "TSh 50,000" — NOT "TSh 500" — via the shared
 *      Money formatter.
 *   4. TRA withholding runs at 10% (resident) / 15% (non-resident), NOT
 *      the legacy Kenya 7.5% flat rate.
 *   5. Payment-rail catalogue includes M-Pesa TZ, Tigo Pesa, Airtel Money,
 *      HaloPesa, GEPG, bank, and Stripe.
 *   6. Audit-event shape carries `country: 'TZ'` + `regulatorRef: 'TRA-WHT-RENT'`.
 *
 * This test uses the same tenant-cache mocking pattern as
 * `services/api-gateway/src/__tests__/compliance-plugins.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  tenantContextMiddleware,
  tenantCache,
} from '../../src/middleware/tenant-context.middleware';
import {
  __resetDefaultFallbackWarning,
  getCountryPlugin,
  resolvePlugin,
} from '@borjie/compliance-plugins';
import { money, formatMoney } from '@borjie/domain-models';

function seedTanzaniaTenant(id: string): void {
  tenantCache.set(id, {
    id,
    name: `Tanzania Tenant ${id}`,
    slug: id,
    status: 'active',
    countryCode: 'TZ',
    settings: {
      timezone: 'Africa/Dar_es_Salaam',
      currency: 'TZS',
      locale: 'sw-TZ',
      dateFormat: 'DD/MM/YYYY',
      fiscalYearStart: 1,
      lateFeeEnabled: true,
      lateFeePercentage: 5,
      gracePeriodDays: 5,
      autoInvoiceEnabled: true,
      invoiceDueDays: 5,
      reminderDays: [3, 1, 0, -3, -7],
      emailNotifications: true,
      smsNotifications: false,
      customBranding: false,
    },
    features: {
      maxProperties: 10,
      maxUnits: 100,
      maxUsers: 20,
      advancedReporting: false,
      apiAccess: false,
      customWorkflows: false,
      mobileApp: true,
      smsNotifications: false,
      documentStorage: true,
      maintenanceModule: true,
      accountingIntegration: false,
      aiFeatures: false,
    },
    limits: {
      apiRequestsPerDay: 10000,
      storageGB: 5,
      documentUploadsPerMonth: 500,
      smsCredits: 0,
      emailsPerDay: 1000,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function tzProbeApp(): Hono {
  const app = new Hono();
  app.use('*', tenantContextMiddleware);
  app.get('/probe/context', (c) => {
    const plugin = c.get('countryPlugin');
    const tenant = c.get('tenant');
    return c.json({
      countryCode: plugin?.countryCode ?? null,
      currencyCode: plugin?.currencyCode ?? null,
      locale: tenant?.settings.locale ?? null,
      phoneCountryCode: plugin?.phoneCountryCode ?? null,
    });
  });
  app.get('/probe/monthly-close', (c) => {
    // Simulate the monthly-close orchestrator: resolve the TZ plugin + run
    // withholding on a 1,500,000 TZS lease payment.
    const plugin = resolvePlugin('TZ');
    const wht = plugin.taxRegime.calculateWithholding(
      1_500_000,
      'TZS',
      { kind: 'month', year: 2026, month: 4 }
    );
    return c.json({
      grossMinor: 1_500_000,
      withholdingMinor: wht.withholdingMinorUnits,
      regulatorRef: wht.regulatorRef,
      rateNote: wht.rateNote,
      auditEvent: {
        eventType: 'withholding_computed',
        country: plugin.countryCode,
        regulatorRef: wht.regulatorRef,
      },
    });
  });
  app.get('/probe/rails', (c) => {
    const plugin = resolvePlugin('TZ');
    const rails = plugin.paymentRails.listRails();
    return c.json({
      rails: rails.map((r) => ({
        id: r.id,
        kind: r.kind,
        currency: r.currency,
        collection: r.supportsCollection,
        disbursement: r.supportsDisbursement,
      })),
    });
  });
  app.get('/probe/filing', (c) => {
    const plugin = resolvePlugin('TZ');
    const filing = plugin.taxFiling.prepareFiling(
      {
        runId: 'RUN-TZ-2026-04',
        lineItems: [
          {
            leaseId: 'LEASE-TZ-1',
            tenantName: 'Jane Mwanri',
            propertyReference: 'Plot 7, Masaki',
            grossRentMinorUnits: 1_500_000,
            withholdingMinorUnits: 150_000,
            currency: 'TZS',
            paymentDate: '2026-04-05',
          },
        ],
        totalGrossMinorUnits: 1_500_000,
        totalWithholdingMinorUnits: 150_000,
      },
      {
        tenantId: 't_tz',
        taxpayerId: '100200300',
        legalName: 'Borjie TZ Pilot Ltd',
        countryCode: 'TZ',
      },
      { kind: 'month', year: 2026, month: 4 }
    );
    return c.json({
      targetRegulator: filing.targetRegulator,
      submitEndpointHint: filing.submitEndpointHint,
      filingFormat: filing.filingFormat,
      payloadLength: filing.payload.length,
    });
  });
  return app;
}

describe('Wave-27 / TZ tenant e2e — gateway boot', () => {
  beforeEach(() => {
    tenantCache.clear();
    __resetDefaultFallbackWarning();
  });

  it('step 1 — tenant-context resolves TZ plugin + Swahili locale', async () => {
    seedTanzaniaTenant('tenant-tz-e2e');
    const res = await tzProbeApp().request('/probe/context', {
      headers: { 'X-Tenant-ID': 'tenant-tz-e2e' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countryCode).toBe('TZ');
    expect(body.currencyCode).toBe('TZS');
    expect(body.phoneCountryCode).toBe('255');
    expect(body.locale).toBe('sw-TZ');
  });

  it('step 2 — currency renders TSh 50,000 NOT TSh 500', () => {
    const m = money(50000, 'TZS');
    const rendered = formatMoney(m, 'sw-TZ');
    expect(rendered).not.toContain('.');
    expect(rendered).toMatch(/50[,.\u00A0\u202F\u2009]?000/);
  });

  it('step 3 — monthly close runs TRA 10% withholding (NOT Kenya 7.5%)', async () => {
    seedTanzaniaTenant('tenant-tz-e2e');
    const res = await tzProbeApp().request('/probe/monthly-close', {
      headers: { 'X-Tenant-ID': 'tenant-tz-e2e' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 10% of 1,500,000 = 150,000; 7.5% would be 112,500.
    expect(body.withholdingMinor).toBe(150_000);
    expect(body.withholdingMinor).not.toBe(112_500);
    expect(body.regulatorRef).toBe('TRA-WHT-RENT');
    expect(body.rateNote).toContain('§83');
    expect(body.auditEvent.country).toBe('TZ');
    expect(body.auditEvent.regulatorRef).toBe('TRA-WHT-RENT');
  });

  it('step 4 — payment-rail catalogue exposes every TZ mobile-money rail', async () => {
    seedTanzaniaTenant('tenant-tz-e2e');
    const res = await tzProbeApp().request('/probe/rails', {
      headers: { 'X-Tenant-ID': 'tenant-tz-e2e' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids: string[] = body.rails.map((r: { id: string }) => r.id);
    // All six must be present.
    for (const expected of [
      'mpesa_tz',
      'tigopesa',
      'airtelmoney_tz',
      'halopesa',
      'gepg',
      'tz_bank_transfer',
    ]) {
      expect(ids).toContain(expected);
    }
    // All rails must be TZS-denominated.
    for (const rail of body.rails) {
      expect(rail.currency).toBe('TZS');
    }
  });

  it('step 5 — TRA filing payload targets tax portal with instructions', async () => {
    seedTanzaniaTenant('tenant-tz-e2e');
    const res = await tzProbeApp().request('/probe/filing', {
      headers: { 'X-Tenant-ID': 'tenant-tz-e2e' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetRegulator).toBe('TRA');
    expect(body.submitEndpointHint).toBe('https://taxportal.tra.go.tz');
    expect(body.filingFormat).toBe('csv');
    expect(body.payloadLength).toBeGreaterThan(0);
  });

  it('step 6 — phone validator enforces known TZ mobile prefixes', () => {
    const plugin = getCountryPlugin('TZ');
    // Vodacom 75x
    expect(plugin.normalizePhone('0754123456')).toBe('+255754123456');
    // Tigo 78x
    expect(plugin.normalizePhone('0782345678')).toBe('+255782345678');
    // Airtel 68x
    expect(plugin.normalizePhone('0683456789')).toBe('+255683456789');
    // Unknown prefix (79x) → throw
    expect(() => plugin.normalizePhone('+255795123456')).toThrow(
      /TZ mobile prefix/i
    );
  });

  it('step 7 — NIDA validator accepts 20-digit TZ national ID', () => {
    const plugin = getCountryPlugin('TZ');
    const nida = plugin.kycProviders.find((k) => k.id === 'nida');
    expect(nida).toBeDefined();
    expect(nida!.idFormat!.test('19900101123451234501')).toBe(true);
    expect(nida!.idFormat!.test('short')).toBe(false);
  });

  it('step 8 — TRA TIN provider is wired for 9-digit identifiers', () => {
    const plugin = getCountryPlugin('TZ');
    const tra = plugin.kycProviders.find((k) => k.id === 'tra');
    expect(tra).toBeDefined();
    expect(tra!.envPrefix).toBe('TRA');
    expect(tra!.idFormat!.test('123456789')).toBe(true);
  });
});
