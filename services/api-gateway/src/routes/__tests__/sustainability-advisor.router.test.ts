/**
 * sustainability-advisor router smoke tests.
 *
 * Verifies the router is mounted and auth gates anonymous callers.
 * Full ESG report behaviour lives in the
 * `@borjie/sustainability-advisor` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import sustainabilityAdvisorRouter from '../sustainability-advisor.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/sustainability-advisor', sustainabilityAdvisorRouter);
  return app;
}

describe('sustainability-advisor router — auth gates', () => {
  it('rejects POST /property-esg-report without a token', async () => {
    const res = await mount().request(
      '/sustainability-advisor/property-esg-report',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST /property-esg-report with an invalid token', async () => {
    const res = await mount().request(
      '/sustainability-advisor/property-esg-report',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer not-a-real-jwt',
        },
      },
    );
    expect(res.status).toBe(401);
  });
});
