/**
 * expansion-advisor router smoke tests.
 *
 * Verifies the router is mounted and auth gates anonymous callers.
 * Full domain behaviour of `recommendExpansion` is exercised in
 * the `@borjie/expansion-advisor` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import expansionAdvisorRouter from '../expansion-advisor.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/expansion-advisor', expansionAdvisorRouter);
  return app;
}

describe('expansion-advisor router — auth gates', () => {
  it('rejects POST /recommend without a token', async () => {
    const res = await mount().request('/expansion-advisor/recommend', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /recommend with an invalid token', async () => {
    const res = await mount().request('/expansion-advisor/recommend', {
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
