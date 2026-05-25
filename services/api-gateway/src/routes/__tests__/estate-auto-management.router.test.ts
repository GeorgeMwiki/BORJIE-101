/**
 * estate-auto-management router smoke tests.
 *
 * Verifies the router is mounted and auth gates anonymous callers.
 * Full `forecastFailure` + `maybeTriggerDispatch` behaviour lives
 * in the `@borjie/estate-auto-management` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import estateAutoManagementRouter from '../estate-auto-management.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/estate-auto-management', estateAutoManagementRouter);
  return app;
}

describe('estate-auto-management router — auth gates', () => {
  it('rejects POST /predictive-maintenance without a token', async () => {
    const res = await mount().request(
      '/estate-auto-management/predictive-maintenance',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST /predictive-maintenance with an invalid token', async () => {
    const res = await mount().request(
      '/estate-auto-management/predictive-maintenance',
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
