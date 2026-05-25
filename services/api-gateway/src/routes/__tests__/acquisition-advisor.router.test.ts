/**
 * acquisition-advisor router smoke tests.
 *
 * Verifies the router is mounted and the auth middleware gates
 * anonymous callers before any advisor logic runs. Full numeric
 * behaviour of `recommendAcquisition` lives in the
 * `@borjie/acquisition-advisor` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import acquisitionAdvisorRouter from '../acquisition-advisor.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/acquisition-advisor', acquisitionAdvisorRouter);
  return app;
}

describe('acquisition-advisor router — auth gates', () => {
  it('rejects POST /recommend without a token', async () => {
    const res = await mount().request('/acquisition-advisor/recommend', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /recommend with an invalid token', async () => {
    const res = await mount().request('/acquisition-advisor/recommend', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not-a-real-jwt',
      },
    });
    expect(res.status).toBe(401);
  });
});
