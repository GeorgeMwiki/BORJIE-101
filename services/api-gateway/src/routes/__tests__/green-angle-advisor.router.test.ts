/**
 * green-angle-advisor router smoke tests.
 *
 * Verifies the router is mounted and auth gates anonymous callers.
 * Full `generateVeteranExpertReport` behaviour lives in the
 * `@borjie/green-angle-advisor` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import greenAngleAdvisorRouter from '../green-angle-advisor.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/green-angle-advisor', greenAngleAdvisorRouter);
  return app;
}

describe('green-angle-advisor router — auth gates', () => {
  it('rejects POST /veteran-expert-report without a token', async () => {
    const res = await mount().request(
      '/green-angle-advisor/veteran-expert-report',
      {
        method: 'POST',
        body: JSON.stringify({ description: 'solar farm' }),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST /veteran-expert-report with an invalid token', async () => {
    const res = await mount().request(
      '/green-angle-advisor/veteran-expert-report',
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
