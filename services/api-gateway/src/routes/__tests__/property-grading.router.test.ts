/**
 * property-grading router smoke tests.
 *
 * Verifies every endpoint gates auth. A full integration suite lives in
 * the domain-services package (Postgres-backed).
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import propertyGradingRouter from '../property-grading.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/property-grading', propertyGradingRouter);
  return app;
}

describe('property-grading router — auth gates', () => {
  it('rejects GET /property/:id without a token', async () => {
    const res = await mount().request('/property-grading/property/prop-1');
    expect(res.status).toBe(401);
  });

  it('rejects GET /property/:id/history without a token', async () => {
    const res = await mount().request(
      '/property-grading/property/prop-1/history?months=6',
    );
    expect(res.status).toBe(401);
  });

  it('rejects GET /portfolio without a token', async () => {
    const res = await mount().request(
      '/property-grading/portfolio?weightBy=unit_count',
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST /recompute/:id without a token', async () => {
    const res = await mount().request('/property-grading/recompute/prop-1', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET /weights without a token', async () => {
    const res = await mount().request('/property-grading/weights');
    expect(res.status).toBe(401);
  });

  it('rejects PUT /weights without a token', async () => {
    const res = await mount().request('/property-grading/weights', {
      method: 'PUT',
      body: JSON.stringify({
        income: 0.25,
        expense: 0.2,
        maintenance: 0.2,
        occupancy: 0.15,
        compliance: 0.1,
        tenant: 0.1,
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});
