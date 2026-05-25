/**
 * geo-platform router smoke tests.
 *
 * Verifies the router is mounted and auth gates anonymous callers.
 * Full `fetchAreaInsights` behaviour (including Google API
 * fan-out) lives in the `@borjie/geo-platform` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import geoPlatformRouter from '../geo-platform.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/geo-platform', geoPlatformRouter);
  return app;
}

describe('geo-platform router — auth gates', () => {
  it('rejects POST /area-insights without a token', async () => {
    const res = await mount().request('/geo-platform/area-insights', {
      method: 'POST',
      body: JSON.stringify({ lat: -6.8, lng: 39.28 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /area-insights with an invalid token', async () => {
    const res = await mount().request('/geo-platform/area-insights', {
      method: 'POST',
      body: JSON.stringify({ lat: -6.8, lng: 39.28 }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not-a-real-jwt',
      },
    });
    expect(res.status).toBe(401);
  });
});
