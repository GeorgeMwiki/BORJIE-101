/**
 * Integration tests — compliance-plugins wiring.
 *
 * Covers:
 *   1. Tenant context resolves `countryPlugin` from the tenant's country.
 *   2. Unknown country codes fall back to DEFAULT_COUNTRY_ID.
 *   3. The admin GET /compliance-plugins endpoint returns >= 6 countries
 *      once auth is provided.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import {
  tenantContextMiddleware,
  tenantCache,
} from '../middleware/tenant-context.middleware';
import { compliancePluginsRouter } from '../routes/compliance-plugins.router';
import {
  __resetDefaultFallbackWarning,
  availableCountries,
} from '@borjie/compliance-plugins';
import { getJwtSecret } from '../config/jwt';

function seedTenant(id: string, country: string | null): void {
  tenantCache.set(id, {
    id,
    name: `Tenant ${id}`,
    slug: id,
    status: 'active',
    countryCode: country,
    settings: {
      timezone: 'UTC',
      currency: 'USD',
      locale: 'en',
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

function mintJwt(tenantId: string): string {
  return jwt.sign(
    {
      userId: 'user-001',
      tenantId,
      role: 'TENANT_ADMIN',
      permissions: ['*'],
      propertyAccess: ['*'],
    },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
}

function probeApp(): Hono {
  const app = new Hono();
  app.use('*', tenantContextMiddleware);
  app.get('/probe', (c) => {
    const plugin = c.get('countryPlugin');
    const tenant = c.get('tenant');
    return c.json({
      countryCode: plugin?.countryCode ?? null,
      currencyCode: plugin?.currencyCode ?? null,
      phoneCountryCode: plugin?.phoneCountryCode ?? null,
      tenantCountryCode: tenant?.countryCode ?? null,
    });
  });
  return app;
}

describe('tenant-context middleware — country plugin wiring', () => {
  beforeEach(() => {
    tenantCache.clear();
    __resetDefaultFallbackWarning();
  });

  it('resolves the TZ plugin when tenant.countryCode === "TZ"', async () => {
    seedTenant('tenant-tz', 'TZ');
    const res = await probeApp().request('/probe', {
      headers: { 'X-Tenant-ID': 'tenant-tz' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countryCode).toBe('TZ');
    expect(body.currencyCode).toBe('TZS');
    expect(body.phoneCountryCode).toBe('255');
  });

  it('resolves the KE plugin when tenant.countryCode === "KE"', async () => {
    seedTenant('tenant-ke', 'KE');
    const res = await probeApp().request('/probe', {
      headers: { 'X-Tenant-ID': 'tenant-ke' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countryCode).toBe('KE');
    expect(body.currencyCode).toBe('KES');
    expect(body.phoneCountryCode).toBe('254');
  });

  it('falls back to the DEFAULT plugin when country is unknown', async () => {
    seedTenant('tenant-xx', 'XX');
    const res = await probeApp().request('/probe', {
      headers: { 'X-Tenant-ID': 'tenant-xx' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // DEFAULT_COUNTRY_ID is 'TZ' — the fallback is deterministic and
    // emits a one-shot warning so operators can catch the drift.
    expect(body.countryCode).toBe('TZ');
  });

  it('falls back to the DEFAULT plugin when country is null (pre-migration tenant)', async () => {
    seedTenant('tenant-legacy', null);
    const res = await probeApp().request('/probe', {
      headers: { 'X-Tenant-ID': 'tenant-legacy' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countryCode).toBe('TZ');
  });
});

describe('GET /compliance-plugins', () => {
  beforeEach(() => {
    tenantCache.clear();
  });

  it('returns >= 6 countries for authenticated callers', async () => {
    seedTenant('tenant-tz', 'TZ');
    const app = new Hono();
    app.route('/compliance-plugins', compliancePluginsRouter);
    const token = mintJwt('tenant-tz');
    const res = await app.request('/compliance-plugins', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.defaultCountryCode).toBe('TZ');
    expect(body.data.count).toBeGreaterThanOrEqual(6);
    const codes = body.data.countries.map(
      (country: { countryCode: string }) => country.countryCode
    );
    for (const expected of ['TZ', 'KE', 'UG', 'NG', 'ZA', 'US']) {
      expect(codes).toContain(expected);
    }
  });

  it('rejects unauthenticated callers with 401', async () => {
    const app = new Hono();
    app.route('/compliance-plugins', compliancePluginsRouter);
    const res = await app.request('/compliance-plugins');
    expect(res.status).toBe(401);
  });

  it('matches the compliance-plugins registry snapshot', async () => {
    seedTenant('tenant-tz', 'TZ');
    const app = new Hono();
    app.route('/compliance-plugins', compliancePluginsRouter);
    const token = mintJwt('tenant-tz');
    const res = await app.request('/compliance-plugins', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const apiCodes = body.data.countries
      .map((c: { countryCode: string }) => c.countryCode)
      .sort();
    const registryCodes = [...availableCountries()].sort();
    expect(apiCodes).toEqual(registryCodes);
  });
});
